'use strict';
/**
 * LLM 路由：统一 OpenAI 兼容调用 + failover + 三级工具降级 + SSE 流式
 */
const { getAvailableOrdered, getProvider, maskKey } = require('./providers');
const { SYSTEM_PROMPT, TOOLS, buildPromptFallbackTools } = require('./prompt');

const TIMEOUT_MS = 15000;
const RETRYABLE_STATUS = new Set([401, 402, 429, 500, 502, 503, 504]);

function isRetryableStatus(status) {
  if (RETRYABLE_STATUS.has(status)) return true;
  return status >= 500;
}

/**
 * 单次非流式调用，超时 15s。成功返回 json，失败抛出带 retryable 标记的错误。
 */
async function callOnce(provider, model, body) {
  const url = (provider.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.resolvedKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error('network: ' + (e.name === 'AbortError' ? 'timeout' : e.message));
    err.retryable = true;
    throw err;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`http ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    err.retryable = isRetryableStatus(resp.status);
    throw err;
  }
  return await resp.json();
}

/**
 * 阶段一：带工具请求，解析动作。
 * 返回 { type:'tool_calls'|'text'|'offline', provider, model, tool_calls, text, level, switches }
 */
async function toolPhase({ messages, provider, model }) {
  const chain = getAvailableOrdered(provider);
  const switches = [];
  if (chain.length === 0) return { type: 'offline', switches };

  let lastErr = null;
  for (const p of chain) {
    const useModel = model || p.defaultModel;
    const nativeTools = p.features && p.features.tools;
    const body = {
      model: useModel,
      messages: buildMessages(messages, nativeTools),
      temperature: 0.3,
    };
    if (nativeTools) {
      body.tools = TOOLS;
      body.tool_choice = 'auto';
    }
    try {
      const json = await callOnce(p, useModel, body);
      const choice = json.choices && json.choices[0];
      const msg = (choice && choice.message) || {};
      // 原生 function calling
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        const tool_calls = msg.tool_calls.map((tc) => {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = {}; }
          return { id: tc.id, name: tc.function.name, args };
        });
        return { type: 'tool_calls', provider: p.id, model: useModel, tool_calls, level: 1, switches };
      }
      const content = msg.content || '';
      // 降级②：解析 JSON 动作协议
      if (!nativeTools) {
        const parsed = tryParseActionJson(content);
        if (parsed && parsed.actions && parsed.actions.length) {
          const tool_calls = parsed.actions.map((a, i) => ({
            id: 'fallback-' + i,
            name: a.tool,
            args: a.args || {},
          }));
          return { type: 'tool_calls', provider: p.id, model: useModel, tool_calls, level: 2, switches };
        }
        // 降级③：JSON 不稳定 → 纯对话
        return {
          type: 'text', provider: p.id, model: useModel,
          text: content.trim(), level: 3, degraded: true, switches,
        };
      }
      // 原生工具但模型选择直接回复
      if (content.trim()) {
        return { type: 'text', provider: p.id, model: useModel, text: content.trim(), level: 1, switches };
      }
      return { type: 'text', provider: p.id, model: useModel, text: '', level: 1, switches };
    } catch (e) {
      lastErr = e;
      switches.push({
        from: p.id, model: useModel,
        reason: e.message,
        at: new Date().toISOString(),
        retryable: !!e.retryable,
      });
      console.warn(`[router] ${p.id}/${useModel} 调用失败 -> ${e.retryable ? '切换' : '终止'} | key=${maskKey(p.resolvedKey)} | ${e.message}`);
      if (!e.retryable) break;
    }
  }
  console.warn('[router] 全部供应商失败，进入离线模式:', lastErr && lastErr.message);
  return { type: 'offline', switches, error: lastErr && lastErr.message };
}

function buildMessages(messages, nativeTools) {
  const sys = { role: 'system', content: nativeTools ? SYSTEM_PROMPT : buildPromptFallbackTools() };
  return [sys, ...messages];
}

function tryParseActionJson(text) {
  if (!text) return null;
  // 去除可能的 ```json 包裹
  let t = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (obj && Array.isArray(obj.actions)) return obj;
  } catch (e) {}
  return null;
}

/**
 * 阶段二：拿到工具结果后，SSE 流式输出最终口语回复。
 * 向 express res 写 SSE：data:{"delta":"..."}\n\n ... data:[DONE]\n\n
 * 全部失败时写 data:{"offline":true}。
 * 返回 { provider, model, switches, attempted }。
 */
async function streamFinal({ messages, provider, model, res }) {
  const chain = getAvailableOrdered(provider);
  const switches = [];
  if (chain.length === 0) {
    res.write('data: {"offline":true}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return { provider: null, model: null, switches };
  }

  for (const p of chain) {
    const useModel = model || p.defaultModel;
    const nativeTools = p.features && p.features.tools;
    const body = {
      model: useModel,
      messages: buildMessages(messages, nativeTools),
      stream: true,
      temperature: 0.3,
    };
    try {
      const result = await pumpStream(p, useModel, body, res);
      if (result.completed) {
        res.write('data: [DONE]\n\n');
        res.end();
        return { provider: p.id, model: useModel, switches };
      }
      // 未产出任何 delta 即断流 → 切换
      throw result.error;
    } catch (e) {
      switches.push({ from: p.id, model: useModel, reason: e.message, at: new Date().toISOString(), retryable: !!e.retryable });
      console.warn(`[router] SSE ${p.id} 失败 -> ${e.retryable ? '切换' : '终止'} | ${e.message}`);
      if (!e.retryable) break;
    }
  }
  // 全部失败
  res.write('data: {"offline":true}\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
  return { provider: null, model: null, switches };
}

async function pumpStream(provider, useModel, body, res) {
  const url = (provider.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.resolvedKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error('network: ' + (e.name === 'AbortError' ? 'timeout' : e.message));
    err.retryable = true;
    return { completed: false, error: err, produced: false };
  }

  if (!resp.ok) {
    clearTimeout(timer);
    const text = await resp.text().catch(() => '');
    const err = new Error(`http ${resp.status}: ${text.slice(0, 150)}`);
    err.status = resp.status;
    err.retryable = isRetryableStatus(resp.status);
    return { completed: false, error: err, produced: false };
  }

  let produced = false;
  try {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          clearTimeout(timer);
          return { completed: true, produced };
        }
        try {
          const json = JSON.parse(data);
          const delta =
            (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || '';
          if (delta) {
            produced = true;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        } catch (e) { /* 忽略非标准片段 */ }
      }
    }
    clearTimeout(timer);
    return { completed: true, produced };
  } catch (e) {
    clearTimeout(timer);
    const err = new Error('stream interrupted: ' + (e.name === 'AbortError' ? 'timeout' : e.message));
    // 已产出内容的中途断流：为避免重复文本，标记不可重试直接收尾；未产出则切换
    err.retryable = !produced;
    return { completed: false, error: err, produced };
  }
}

module.exports = { toolPhase, streamFinal };
