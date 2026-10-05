'use strict';
/**
 * IOC 智能运维管理平台 - 后端服务
 * 仅依赖 express；Node18+ 原生 fetch。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  getPublicProviders,
  saveLocal,
  loadProviders,
  maskKey,
} = require('./llm/providers');
const { toolPhase, streamFinal } = require('./llm/router');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 扩展位开关（外部 API，默认关闭）----------
function extensionFlags() {
  return {
    weather: { enabled: !!process.env.QWEATHER_KEY, label: '和风天气（联动制冷/PUE）' },
    feishuWebhook: { enabled: !!process.env.FEISHU_WEBHOOK, label: '飞书 webhook（工单/复测推送）' },
    dingtalkWebhook: { enabled: !!process.env.DINGTALK_WEBHOOK, label: '钉钉 webhook' },
    wecomWebhook: { enabled: !!process.env.WECOM_WEBHOOK, label: '企业微信 webhook' },
    rag: { enabled: false, label: 'RAG 知识库（预留）' },
    vision: { enabled: false, label: '视觉识别（预留）' },
    webSearch: { enabled: false, label: '联网搜索（预留）' },
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/extensions', (req, res) => {
  res.json(extensionFlags());
});

// ---------- 供应商列表（不返回 key）----------
app.get('/api/providers', (req, res) => {
  res.json({ providers: getPublicProviders() });
});

// ---------- 新增 / 修改自定义中转站或覆盖配置 ----------
app.post('/api/providers/custom', (req, res) => {
  const { id, name, baseUrl, apiKey, model, models, features, action } = req.body || {};
  if (action === 'delete') {
    saveLocal((data) => {
      data.customs = (data.customs || []).filter((c) => c.id !== id);
    });
    return res.json({ ok: true });
  }
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    return res.status(400).json({ ok: false, error: 'baseUrl 不合法，需以 http(s):// 开头' });
  }
  const customId = id || 'relay-' + Date.now().toString(36);
  saveLocal((data) => {
    data.customs = data.customs || [];
    const idx = data.customs.findIndex((c) => c.id === customId);
    const record = {
      id: customId,
      name: name || '自定义中转站',
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey: apiKey || '',
      model: model || 'gpt-4o-mini',
      models: models && models.length ? models : [model || 'gpt-4o-mini'],
      features: features || { tools: true, stream: true, vision: false },
    };
    if (idx >= 0) data.customs[idx] = record;
    else data.customs.push(record);
  });
  console.log(`[providers] 保存自定义中转站 ${customId}，key=${maskKey(apiKey)}`);
  res.json({ ok: true, id: customId, providers: getPublicProviders() });
});

app.delete('/api/providers/custom/:id', (req, res) => {
  const id = req.params.id;
  saveLocal((data) => {
    data.customs = (data.customs || []).filter((c) => c.id !== id);
  });
  res.json({ ok: true });
});

// ---------- 对话：两阶段 ----------
app.post('/api/chat', async (req, res) => {
  const { messages, provider, model, stage } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ ok: false, error: 'messages 必须为数组' });
  }

  // 阶段二：SSE 流式最终回复
  if (stage === 'final') {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders && res.flushHeaders();
    try {
      const meta = await streamFinal({ messages, provider, model, res });
      console.log(`[chat] 最终回复完成 provider=${meta.provider || 'offline'} model=${meta.model || '-'} switches=${meta.switches.length}`);
    } catch (e) {
      console.warn('[chat] SSE 异常:', e.message);
      if (!res.headersSent) res.status(500).end();
      else { res.write('data: {"offline":true}\n\n'); res.write('data: [DONE]\n\n'); res.end(); }
    }
    return;
  }

  // 阶段一：带工具请求，解析动作
  try {
    const result = await toolPhase({ messages, provider, model });
    res.json(result);
  } catch (e) {
    console.warn('[chat] plan 阶段异常:', e.message);
    res.json({ type: 'offline', switches: [], error: e.message });
  }
});

// SPA 回退（Express 5 不再支持 '*' 通配写法）
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

app.listen(PORT, () => {
  const providers = loadProviders();
  const avail = providers.filter((p) => p.available).map((p) => p.id);
  console.log('==============================================');
  console.log(' IOC 智能运维管理平台 已启动');
  console.log(` 访问地址: http://localhost:${PORT}`);
  console.log(` 已配置 Key 的供应商: ${avail.length ? avail.join(', ') : '无（将使用内置离线规则模式）'}`);
  console.log('==============================================');
});
