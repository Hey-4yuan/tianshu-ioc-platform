/* ============================================================
 * agent.js — 小维对话 Agent（LLM 驱动，无固定剧本）
 *  用户输入 → /api/chat 计划 → 执行工具 → /api/chat 最终 SSE → TTS
 *  离线：关键词意图识别 + 同一套工具 + 规则口语回复
 * ============================================================ */
(function (global) {
  'use strict';

  const state = {
    history: [],
    currentRack: null,
    isMoving: false,
    provider: null,
    model: null,
    lastResults: [],
    lastLevel: 1,
  };

  const PAGES = ['总览', '机房监控', '资产管理', '能效管理', '告警中心', '运维工单'];

  /* ---------------- DOM 消息 ---------------- */
  const stream = () => document.getElementById('msg-stream');

  function addMsg(role, text, meta) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    if (meta) {
      const m = document.createElement('span');
      m.className = 'msg-meta'; m.textContent = meta; el.appendChild(m);
    }
    const s = stream();
    if (!s) return el;
    s.appendChild(el);
    s.scrollTop = s.scrollHeight;
    return el;
  }

  // 对话历史封顶，避免只增不减无限膨胀（保留最近 HISTORY_MAX 条）
  const HISTORY_MAX = 20;
  function pushHistory(msg) {
    state.history.push(msg);
    if (state.history.length > HISTORY_MAX) {
      state.history.splice(0, state.history.length - HISTORY_MAX);
    }
  }

  function setConn(mode, providerNameArg, model) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    if (mode === 'offline') {
      el.textContent = '离线模式 · 内置规则';
      el.className = 'conn offline';
    } else if (mode === 'connecting') {
      el.textContent = '连接中…'; el.className = 'conn';
    } else {
      el.textContent = `在线 · ${providerNameArg} / ${model || '默认模型'}`;
      el.className = 'conn';
    }
  }
  function setSwitchLog(switches) {
    const box = document.getElementById('switch-log');
    if (!box) return;
    if (!switches || !switches.length) { box.textContent = ''; return; }
    box.textContent = '切换：' + switches.map((s) => `${s.from}→（${s.reason.slice(0, 24)}）`).join('；');
  }

  /* ============================================================
   * 工具实现（操作 AppData / Scene3D / Main），返回可 JSON 序列化对象
   * ============================================================ */
  const Tools = {
    go_to_rack(args) {
      const rackId = normalizeRack(args.rackId);
      return new Promise((resolve) => {
        if (!rackId) {
          return resolve({ ok: false, error: '未指定机柜编号，请说明要去的机柜（如 A-02）' });
        }
        const rack = AppData.getRack(rackId);
        if (!rack) return resolve({ ok: false, error: `机柜 ${args.rackId || rackId} 不存在` });
        Main.showPage('机房监控');
        state.isMoving = true; state.currentRack = rackId;
        const progEl = addMsg('sys', `正在前往 ${rackId}… 0%`);
        Scene3D.moveRobot(
          rackId,
          (p) => { progEl.textContent = `正在前往 ${rackId}… ${Math.round(p * 100)}%`; },
          (ok) => {
            state.isMoving = false;
            if (!ok) {
              progEl.textContent = `前往 ${rackId} 失败`;
              return resolve({ ok: false, error: '移动失败' });
            }
            Scene3D.highlight(rackId, true);
            Main.renderDeviceTab(rackId);
            Main.openDeviceTab();
            progEl.textContent = `已到达 ${rackId}`;
            resolve(statusOf(rack));
          }
        );
      });
    },

    get_rack_status(args) {
      const rackId = normalizeRack(args.rackId || state.currentRack);
      const rack = AppData.getRack(rackId);
      if (!rack) return { ok: false, error: `机柜 ${rackId} 不存在` };
      state.currentRack = rackId;
      return statusOf(rack);
    },

    list_alarms(args) {
      const sev = (args && args.severity) || '全部';
      return Object.assign({ ok: true }, AppData.listAlarms(sev));
    },

    get_rack_advice(args) {
      const rackId = normalizeRack(args.rackId || state.currentRack);
      return AppData.getAdvice(rackId);
    },

    create_ticket(args) {
      const rackId = normalizeRack(args.rackId || state.currentRack);
      const r = AppData.createTicket(rackId, args && args.assignee);
      if (!r.ok) return r;
      Main.refreshAll();
      const t = r.ticket;
      return { ok: true, rackId, ticketNo: t.no, assignee: t.assignee, status: t.status, already: !!r.already };
    },

    run_retest(args) {
      const rackId = normalizeRack(args.rackId || state.currentRack);
      const r = AppData.runRetest(rackId);
      if (!r.ok) return r;
      Scene3D.refreshRack(rackId);
      Scene3D.highlight(rackId, false);
      Main.refreshAll();
      return { ok: true, rackId, temp: r.temp, ticketNo: r.ticketNo, alarmCleared: true };
    },

    navigate(args) {
      const page = args.page;
      if (!PAGES.includes(page)) return { ok: false, error: '未知页面 ' + page };
      Main.showPage(page);
      return { ok: true, page, metrics: AppData.pageMetrics(page) };
    },
  };

  function statusOf(rack) {
    // severity 取告警明细里的严重级别（rack.status 仅是展示口径，避免语义混用）
    const alarmRec = AppData.activeAlarms().find((a) => a.rackId === rack.id);
    return {
      ok: true, rackId: rack.id, assetNo: rack.assetNo, u: rack.u,
      temp: rack.temp, load: rack.load, power: rack.power,
      alarm: rack.alarmType
        ? {
            type: rack.alarmType,
            severity: (alarmRec && alarmRec.severity) || (rack.status === '正常' ? '一般' : rack.status),
            confirmed: rack.alarmConfirmed,
          }
        : null,
      lastMaintenance: rack.lastMaintenance, nextMaintenance: rack.nextMaintenance,
    };
  }

  async function executeCall(name, args) {
    const fn = Tools[name];
    if (!fn) return { ok: false, error: '未知工具 ' + name };
    try {
      return await fn(args || {});
    } catch (e) {
      return { ok: false, error: '工具执行异常: ' + e.message };
    }
  }

  /* ============================================================
   * 主入口
   * ============================================================ */
  async function handleUser(text) {
    text = (text || '').trim();
    if (!text) return;
    addMsg('user', text);
    pushHistory({ role: 'user', content: text });

    setConn('connecting');
    let plan;
    try {
      plan = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.history,
          provider: state.provider, model: state.model, stage: 'plan',
        }),
      }).then((r) => r.json());
    } catch (e) {
      plan = { type: 'offline' };
    }

    if (plan.switches && plan.switches.length) setSwitchLog(plan.switches);
    state.lastLevel = plan.level || 1;

    if (plan.type === 'offline') {
      setConn('offline');
      return runOffline(text);
    }

    if (plan.type === 'text') {
      setConn('online', providerName(plan.provider), plan.model);
      addMsg('bot', plan.text);
      maybeTTS(plan.text);
      if (plan.degraded) addMsg('sys', '当前供应商不支持动作联动，仅可对话');
      pushHistory({ role: 'assistant', content: plan.text });
      return;
    }

    setConn('online', providerName(plan.provider), plan.model);
    if (plan.level === 3 || plan.degraded) addMsg('sys', '当前供应商不支持动作联动');
    const calls = plan.tool_calls || [];
    const results = [];
    for (const c of calls) {
      const result = await executeCall(c.name, c.args);
      results.push({ id: c.id, name: c.name, result });
    }
    state.lastResults = results;

    let finalMessages;
    if (plan.level === 2) {
      // 工具结果以 user 角色回灌（部分供应商不支持 tool 角色），仅用于本轮生成，不写入历史
      const resText = '以下是工具执行结果（JSON），据此生成简短口语回复，不要照抄 JSON：\n'
        + results.map((r) => `工具 ${r.name} 结果：${JSON.stringify(r.result)}`).join('\n');
      finalMessages = state.history.concat([{ role: 'user', content: resText }]);
    } else {
      const asst = {
        role: 'assistant', content: null,
        tool_calls: calls.map((c) => ({
          id: c.id, type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        })),
      };
      const toolMsgs = results.map((r) => ({
        role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result),
      }));
      finalMessages = state.history.concat([asst], toolMsgs);
    }

    const bubble = addMsg('bot', '');
    bubble.classList.add('cursor-blink');
    let reply = '';
    let gotOffline = false;
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: finalMessages,
          provider: plan.provider, model: plan.model, stage: 'final',
        }),
      });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const consumeLine = (ln) => {
        const t = ln.trim();
        if (!t.startsWith('data:')) return;
        const d = t.slice(5).trim();
        if (d === '[DONE]') return;
        try {
          const j = JSON.parse(d);
          if (j.offline) { gotOffline = true; return; }
          if (j.delta) {
            reply += j.delta;
            bubble.textContent = reply;
            const s = stream();
            if (s) s.scrollTop = s.scrollHeight;
          }
        } catch (e) { /* 忽略非标准片段 */ }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        lines.forEach(consumeLine);
      }
      // 冲刷解码器残留并处理末行无换行的残余数据，避免丢最后一段
      buf += decoder.decode();
      if (buf.trim()) consumeLine(buf);
    } catch (e) { gotOffline = true; }

    bubble.classList.remove('cursor-blink');
    if (gotOffline || !reply) {
      const local = localReplyFromResults(results);
      bubble.textContent = local; reply = local;
      setConn('offline');
    }
    if (reply) {
      maybeTTS(reply);
      pushHistory({ role: 'assistant', content: reply });
    }
  }

  /* ============================================================
   * 离线意图引擎
   * ============================================================ */
  function runOffline(text) {
    const rackId = extractRack(text);
    let calls = [];

    if (/复测/.test(text) && rackId) calls.push({ name: 'run_retest', args: { rackId } });
    else if (/(工单|派单)/.test(text) && rackId) calls.push({ name: 'create_ticket', args: { rackId } });
    else if (/(建议|怎么办|怎么处理|处置|如何处理|咋整|咋弄)/.test(text) && rackId) calls.push({ name: 'get_rack_advice', args: { rackId } });
    else if (/(去|前往|看看|看下|去看|巡检)/.test(text) && rackId) calls.push({ name: 'go_to_rack', args: { rackId } });
    else if (/(状态|怎么样|情况|温度)/.test(text) && rackId) calls.push({ name: 'get_rack_status', args: { rackId } });
    else if (/(告警|报警|故障)/.test(text)) {
      const sev = /严重/.test(text) ? '严重' : /一般/.test(text) ? '一般' : '全部';
      calls.push({ name: 'list_alarms', args: { severity: sev } });
    } else {
      const page = PAGES.find((p) => text.indexOf(p) >= 0);
      if (page) calls.push({ name: 'navigate', args: { page } });
    }

    (async () => {
      if (!calls.length) {
        const reply = '我在的，可以让我去机柜看看、查告警、出工单或做复测';
        addMsg('bot', reply); maybeTTS(reply); return;
      }
      const results = [];
      for (const c of calls) {
        const result = await executeCall(c.name, c.args);
        results.push({ id: 'off', name: c.name, result });
      }
      state.lastResults = results;
      const reply = localReplyFromResults(results);
      addMsg('bot', reply); maybeTTS(reply);
    })();
  }

  function localReplyFromResults(results) {
    const parts = [];
    for (const r of results) {
      const d = r.result;
      if (!d || d.ok === false) { parts.push(d && d.error ? d.error : `${r.name} 执行失败`); continue; }
      switch (r.name) {
        case 'go_to_rack':
        case 'get_rack_status':
          parts.push(
            d.alarm
              ? `${d.rackId}温度${d.temp}度，有${d.alarm.type}${d.alarm.severity}告警`
              : `${d.rackId}温度${d.temp}度，负载${d.load}%，运行正常`
          );
          break;
        case 'list_alarms':
          parts.push(`当前${d.total}个告警，严重${d.crit}个，一般${d.normal}个，已确认${d.confirmed}个`);
          break;
        case 'get_rack_advice':
          parts.push(d.type ? `${d.advice[0]}，${d.advice[1]}` : d.advice[0]);
          break;
        case 'create_ticket':
          parts.push(d.already ? `工单${d.ticketNo}已存在，负责人${d.assignee}` : `已开工单${d.ticketNo}，派给${d.assignee}，请现场处理`);
          break;
        case 'run_retest':
          parts.push(`复测温度${d.temp}度，告警已解除，工单${d.ticketNo || ''}已归档`);
          break;
        case 'navigate':
          parts.push(d.metrics);
          break;
        default: parts.push('已完成');
      }
    }
    let out = parts.join('。');
    if (out.length > 80) {
      // 优先在句号处截断，避免半句被硬切
      const cut = out.lastIndexOf('。', 80);
      out = cut > 20 ? out.slice(0, cut + 1) : out.slice(0, 80);
    }
    return out;
  }

  /* ---------------- 工具函数 ---------------- */
  function normalizeRack(raw) { return extractRack(raw); }
  function extractRack(raw) {
    if (!raw) return null;
    const s = String(raw);
    // 带分隔符形式：A-02 / a_2 / E–05；或紧凑两位数字形式：A02
    // 单字母+单数字（如"B2"）不再匹配，避免把普通词误认成机柜号
    let m = s.match(/(?:^|[^A-Za-z0-9])([A-Ea-e])\s*[-–_/]\s*(\d{1,2})(?![0-9])/);
    if (!m) m = s.match(/(?:^|[^A-Za-z0-9])([A-Ea-e])\s*(\d{2})(?![0-9])/);
    if (!m) return null;
    return `${m[1].toUpperCase()}-${String(parseInt(m[2], 10)).padStart(2, '0')}`;
  }
  function providerName(id) {
    const sel = document.getElementById('provider-select');
    if (!sel || !id) return id;
    const opt = Array.from(sel.options).find((o) => o.value === id);
    return opt ? opt.textContent : id;
  }
  function maybeTTS(text) {
    const toggle = document.getElementById('tts-toggle');
    if (toggle && toggle.checked) Voice.speak(text);
  }

  function init() {
    setConn('offline');
    document.getElementById('send-btn').addEventListener('click', submit);
    const input = document.getElementById('chat-text');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    function submit() {
      const v = input.value;
      if (!v.trim()) return;
      input.value = '';
      handleUser(v);
    }

    function bindMic(btn) {
      btn.addEventListener('click', () => {
        if (!Voice.recognitionSupported) {
          addMsg('sys', '当前环境不支持语音识别，请用文字输入'); return;
        }
        if (Voice.isListening()) { Voice.stopListen(); btn.classList.remove('listening'); return; }
        btn.classList.add('listening');
        Voice.listen({
          onResult(t) { input.value = t; btn.classList.remove('listening'); submit(); },
          onError(err) {
            btn.classList.remove('listening');
            if (err === 'not-allowed') addMsg('sys', '麦克风权限被拒绝，请用文字');
          },
          onEnd() { btn.classList.remove('listening'); },
        });
      });
    }
    bindMic(document.getElementById('mic-btn'));
    bindMic(document.getElementById('mic-fab'));
  }

  global.Agent = {
    init, handleUser,
    setProvider(id) { state.provider = id || null; },
    setModel(m) { state.model = m || null; },
  };
})(window);
