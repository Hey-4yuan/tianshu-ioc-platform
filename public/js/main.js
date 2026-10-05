/* ============================================================
 * main.js — 启动流程、导航、各页渲染、供应商面板、联动刷新
 * ============================================================ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };

  // 安全构建「标签 <b>值</b>」行：数据一律走 textContent，避免 innerHTML 拼接注入
  const kv = (label, value, bcls) => {
    const s = h('span', null, label + ' ');
    s.appendChild(h('b', bcls || null, value == null ? '' : String(value)));
    return s;
  };
  // 状态类名映射（中文状态 → ASCII 稳定类名，与 style.css 对应）
  const SEV_CLS = { 严重: 'sev-crit', 一般: 'sev-warn', 提示: 'sev-info' };
  const TK_CLS = { 待派单: 'tk-st-open', 已派单: 'tk-st-assigned', 现场处理中: 'tk-st-doing', 已完成: 'tk-st-done' };
  const sevCls = (sev) => ('sev-' + sev) + (SEV_CLS[sev] ? ' ' + SEV_CLS[sev] : '');
  const tkCls = (status) => ('tk-status ' + status) + (TK_CLS[status] ? ' ' + TK_CLS[status] : '');

  /* ============================================================
   * 片头
   * ============================================================ */
  function bootIntro() {
    Scene3D.startIntro(() => enterApp());
    $('intro-skip').addEventListener('click', () => {
      Scene3D.stopIntro();
      enterApp();
    });
  }

  let entered = false;
  function enterApp() {
    if (entered) return;
    entered = true;
    const intro = $('intro');
    intro.classList.add('fade-out');
    setTimeout(() => intro.remove(), 800);
    $('app').classList.remove('hidden');
    Scene3D.initScenes();
    Scene3D.setRackClick(showRackPop);
    renderAll();
    Agent.init();
    initProviders();
    showPage('总览');
  }

  /* ============================================================
   * 导航 / 页面切换
   * ============================================================ */
  const PAGE_IDS = {
    总览: 'page-overview',
    机房监控: 'page-monitor',
    资产管理: 'page-assets',
    能效管理: 'page-energy',
    告警中心: 'page-alarms',
    运维工单: 'page-tickets',
    设备检视: 'page-inspect',
  };

  function showPage(page) {
    for (const name in PAGE_IDS) {
      $(PAGE_IDS[name]).classList.toggle('active', name === page);
    }
    document.querySelectorAll('.nav-item').forEach((n) =>
      n.classList.toggle('active', n.dataset.page === page));

    if (page === '机房监控') {
      Scene3D.setView('room');
      const old = document.querySelector('#room-stage .rack-pop');
      if (old) old.remove();
      popEl = null;
    } else if (page === '设备检视') Scene3D.setView('inspect');
    else Scene3D.setView(null);

    Charts.initPage(page);
    if (page === '机房监控' || page === '设备检视') {
      setTimeout(() => Scene3D.resizeActive(), 80);
    }
  }

  document.querySelectorAll('.nav-item').forEach((n) => {
    n.addEventListener('click', () => showPage(n.dataset.page));
    // 键盘可达性：Enter / 空格 触发导航
    n.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showPage(n.dataset.page);
      }
    });
  });

  /* ============================================================
   * 1) 总览
   * ============================================================ */
  function renderOverview() {
    const c = AppData.constants;
    // 环境卡片
    const env = $('ov-env-cards');
    env.innerHTML = '';
    [
      { v: c.roomTemp + '℃', l: '机房温度' },
      { v: c.humidity + '%', l: '相对湿度' },
      { v: c.pue, l: 'PUE' },
    ].forEach((d) => {
      const card = h('div', 'env-card');
      card.appendChild(h('div', 'v', d.v));
      card.appendChild(h('div', 'l', d.l));
      env.appendChild(card);
    });
    // 评分下方数字
    const nums = $('ov-score-nums');
    nums.innerHTML = '';
    [
      ['总数', c.ledgerTotal, ''],
      ['在线', c.online, ''],
      ['告警', c.activeAlarm, '#ff4d4f'],
      ['维护', c.maintenance, ''],
    ].forEach(([l, v, color]) => {
      const s = h('span');
      s.appendChild(document.createTextNode(l + ' '));
      const b = h('b', null, String(v));
      if (color) b.style.color = color;
      s.appendChild(b);
      nums.appendChild(s);
    });
    // 底部状态栏（与 AppData 联动；仅替换数值文本节点，保留 <em> 单位）
    const setFootVal = (id, val) => {
      const el = $(id);
      if (!el) return;
      const em = el.querySelector('em');
      el.textContent = '';
      el.appendChild(document.createTextNode(String(val)));
      if (em) el.appendChild(em);
    };
    setFootVal('foot-racks', c.ledgerTotal);
    setFootVal('foot-power', c.totalPower);
    setFootVal('foot-pue', c.pue);
    setFootVal('foot-avail', c.availability);
    // 今日能耗
    $('ov-energy-num').textContent = c.todayEnergy.toLocaleString();
    const delta = $('ov-energy-delta');
    delta.textContent = `较昨日 ${c.energyDelta}%　kWh`;
    delta.style.color = 'var(--green)';

    // 迷你三维（俯视点阵）
    const mini = $('ov-mini3d');
    mini.innerHTML = '';
    for (const r of AppData.racks) {
      const dot = h('span');
      const alarm = !!r.alarmType;
      dot.style.cssText =
        `position:absolute;width:${alarm ? 9 : 6}px;height:${alarm ? 9 : 6}px;border-radius:2px;` +
        `left:${((r.x + 10) / 20) * 100}%;top:${((r.z + 10) / 20) * 100}%;` +
        `transform:translate(-50%,-50%);background:${alarm ? '#ff4d4f' : '#1f7f96'};` +
        (alarm ? 'box-shadow:0 0 8px #ff4d4f;' : '');
      mini.appendChild(dot);
    }
    // 迷你告警卡：跟随实际告警状态（不再硬编码 A-02）
    const alarms = AppData.activeAlarms();
    const alarmBox = $('ov-mini-alarm');
    alarmBox.innerHTML = '';
    if (alarms.length) {
      const a = alarms[0];
      const ar = AppData.getRack(a.rackId);
      alarmBox.appendChild(h('b', null, `${a.rackId} ${a.type} · ${a.severity}`));
      alarmBox.appendChild(h('br'));
      alarmBox.appendChild(document.createTextNode(
        ar ? `温度 ${ar.temp}℃ · 负载 ${ar.load}%` : a.detail));
    } else {
      alarmBox.appendChild(h('b', null, '当前无活动告警'));
      alarmBox.appendChild(h('br'));
      alarmBox.appendChild(document.createTextNode('场景运行参数正常'));
    }
  }

  /* ============================================================
   * 2) 机房监控
   * ============================================================ */
  function renderMonitor() {
    // 机柜下拉
    const sel = $('locate-select');
    sel.innerHTML = '';
    AppData.racks.forEach((r) => {
      sel.appendChild(h('option', null, r.id + (r.alarmType ? '（告警）' : '')));
    });
    $('locate-go').onclick = () => {
      const id = sel.value.split('（')[0];
      Scene3D.focusRack(id);
      Scene3D.highlight(id, true);
      popAtRack(id);
    };
    // 区悬浮温度
    const zt = $('zone-temps');
    zt.innerHTML = '';
    for (const z of Object.keys(AppData.ZONES)) {
      const s = h('span', 'zone-temp');
      s.appendChild(kv(z + ' 区', AppData.ZONES[z].temp + '℃'));
      zt.appendChild(s);
    }
    renderLocateAlarms();
  }

  function renderLocateAlarms() {
    const ul = $('locate-alarms');
    ul.innerHTML = '';
    AppData.activeAlarms().forEach((a) => {
      const li = h('li', sevCls(a.severity));
      li.appendChild(h('span', 'rk', a.rackId));
      li.appendChild(document.createTextNode(` ${a.type} · ${a.severity}`));
      const tag = h('div', 'confirmed-tag', a.confirmed ? '已确认' : '待确认');
      if (!a.confirmed) tag.style.color = '#ffb547';
      li.appendChild(tag);
      li.onclick = () => {
        Scene3D.focusRack(a.rackId);
        Scene3D.highlight(a.rackId, true);
      };
      ul.appendChild(li);
    });
  }

  // 机柜弹卡
  let popEl = null;
  const POP_W = 226, POP_H = 268;
  function positionPop(x, y) {
    const stage = $('room-stage');
    popEl.style.left = Math.max(0, Math.min(x, stage.clientWidth - POP_W - 4)) + 'px';
    popEl.style.top = Math.max(0, Math.min(y, stage.clientHeight - POP_H - 4)) + 'px';
  }
  function showRackPop(id, x, y) {
    buildPop(id);
    positionPop(x + 12, y + 12);
  }
  function popAtRack(id) {
    const r = AppData.getRack(id);
    if (!r) return;
    const stage = $('room-stage');
    buildPop(id);
    const x = ((r.x + 10) / 20) * stage.clientWidth * 0.6 + 30;
    const y = ((r.z + 10) / 20) * stage.clientHeight * 0.5;
    positionPop(x, y);
  }
  function buildPop(id) {
    const r = AppData.getRack(id);
    if (!r) return;
    if (!popEl) {
      popEl = h('div', 'rack-pop');
      $('room-stage').appendChild(popEl);
    }
    const tempCls = r.alarmType && r.temp > 28 ? 'temp-hot' : '';
    popEl.innerHTML = '';
    const title = h('div', 'rp-title');
    title.appendChild(h('span', null, r.id));
    title.appendChild(h('span', null, r.zone + ' 区'));
    popEl.appendChild(title);
    [
      ['资产编号', r.assetNo, null],
      ['规格', r.u + 'U', null],
      ['进风温度', r.temp + '℃', tempCls || null],
      ['IT 负载', r.load + '%', null],
      ['功率', r.power + ' kW', null],
    ].forEach(([l, v, cls]) => {
      const row = h('div', 'rp-row');
      row.appendChild(kv(l, v, cls));
      popEl.appendChild(row);
    });
    const stRow = h('div', 'rp-row');
    const stB = h('b', null, r.alarmType || '正常');
    stB.style.color = r.status === '正常' ? '#28e0a4' : r.status === '严重' ? '#ff4d4f' : '#ffb547';
    stRow.appendChild(document.createTextNode('状态 '));
    stRow.appendChild(stB);
    popEl.appendChild(stRow);
    const acts = h('div', 'rp-actions');
    const b1 = h('button', 'btn cyan', '进入检视');
    b1.onclick = () => openInspect(r.id);
    const b2 = h('button', 'btn', '小维巡检');
    b2.onclick = () => Agent.handleUser(`去看看 ${r.id}`);
    acts.appendChild(b1); acts.appendChild(b2);
    popEl.appendChild(acts);
  }

  /* ============================================================
   * 3) 设备检视
   * ============================================================ */
  // 当前检视中的机柜（供 refreshAll 联动刷新）
  let currentInspectRack = null;

  function openInspect(rackId) {
    const r = AppData.getRack(rackId);
    if (!r) return;
    currentInspectRack = r.id;
    Scene3D.loadInspect(r);
    renderInspectInfo(r);
    showPage('设备检视');
  }

  function renderInspectInfo(r) {
    const box = $('inspect-info');
    box.innerHTML = '';

    const b1 = h('div', 'info-block');
    b1.appendChild(h('h4', null, '基本信息'));
    [
      ['机柜编号', r.id, null],
      ['资产编号', r.assetNo, null],
      ['所在位置', r.zone + ' 区', null],
      ['机柜规格', r.u + 'U', null],
    ].forEach(([l, v, cls]) => {
      const x = h('div', 'info-row');
      x.appendChild(kv(l, v, cls));
      b1.appendChild(x);
    });
    box.appendChild(b1);

    const b2 = h('div', 'info-block');
    b2.appendChild(h('h4', null, '实时状态'));
    const hot = r.alarmType && r.temp > 28;
    [
      ['进风温度', r.temp + '℃', hot ? 'temp-hot' : null],
      ['IT 负载', r.load + '%', null],
      ['功率', r.power + ' kW', null],
    ].forEach(([l, v, cls]) => {
      const x = h('div', 'info-row');
      x.appendChild(kv(l, v, cls));
      b2.appendChild(x);
    });
    const stRow2 = h('div', 'info-row');
    const stB2 = h('b', null, r.alarmType || '正常');
    stB2.style.color = r.status === '正常' ? '#28e0a4' : r.status === '严重' ? '#ff4d4f' : '#ffb547';
    stRow2.appendChild(document.createTextNode('运行状态 '));
    stRow2.appendChild(stB2);
    b2.appendChild(stRow2);
    box.appendChild(b2);

    const b3 = h('div', 'info-block');
    b3.appendChild(h('h4', null, '巡检报告'));
    b3.appendChild(h('div', 'report-item', `上次维保：${r.lastMaintenance}`));
    b3.appendChild(h('div', 'report-item', `下次维保：${r.nextMaintenance}`));
    b3.appendChild(h('div', 'report-item', '提示：检查温湿度与冷凝通道，确认传感器读数'));
    b3.appendChild(h('div', 'report-note', '注：以上为示例数据'));
    box.appendChild(b3);
  }

  $('door-toggle').onclick = () => Scene3D.toggleDoor();
  $('inspect-back').onclick = () => showPage('机房监控');

  /* ============================================================
   * 4) 资产管理
   * ============================================================ */
  let assetZone = '全部';
  let assetKw = '';

  function renderAssets() {
    const c = AppData.constants;
    const ov = $('asset-overview');
    ov.innerHTML = '';
    const pills = h('div', 'ov-pills');
    [
      { v: c.sceneCount, l: '场景机柜' },
      { v: c.sceneNormal, l: '正常' },
      { v: c.sceneAlarm, l: '告警', alarm: true },
      { v: c.usedU.toLocaleString() + 'U', l: '已用空间' },
    ].forEach((d) => {
      const p = h('div', 'ov-pill' + (d.alarm ? ' alarm' : ''));
      p.appendChild(h('div', 'pv', d.v));
      p.appendChild(h('div', 'pl', d.l));
      pills.appendChild(p);
    });
    ov.appendChild(pills);

    // 区筛选
    const zf = $('asset-zone-filter');
    zf.innerHTML = '';
    ['全部', 'A', 'B', 'C', 'D', 'E'].forEach((z) => {
      const chip = h('span', 'zone-chip' + (assetZone === z ? ' active' : ''), z + (z === '全部' ? '' : ' 区'));
      chip.onclick = () => { assetZone = z; renderAssets(); };
      zf.appendChild(chip);
    });

    $('asset-search').oninput = (e) => { assetKw = e.target.value.trim(); renderAssetTable(); };
    renderAssetTable();
  }

  function renderAssetTable() {
    const tb = $('asset-table').querySelector('tbody');
    tb.innerHTML = '';
    let rows = AppData.racks;
    if (assetZone !== '全部') rows = rows.filter((r) => r.zone === assetZone);
    if (assetKw) {
      const k = assetKw.toUpperCase();
      rows = rows.filter((r) => r.id.indexOf(k) >= 0 || r.assetNo.indexOf(k) >= 0);
    }
    rows.forEach((r) => {
      const tr = h('tr');
      tr.appendChild(h('td', null, r.id));
      tr.appendChild(h('td', null, `${r.zone} 区 / ${r.assetNo}`));
      const td = h('td');
      td.appendChild(h('span', r.alarmType && r.temp > 28 ? 'temp-hot' : null, r.temp + '℃'));
      tr.appendChild(td);
      tr.appendChild(h('td', null, r.load + '%'));
      const st = h('td');
      const tag = h('span', 'status-tag ' + r.status + (SEV_CLS[r.status] ? ' ' + SEV_CLS[r.status] : ''), r.status);
      tag.title = r.alarmType || '正常';
      st.appendChild(tag);
      tr.appendChild(st);
      const ops = h('td');
      const wrap = h('div', 'row-actions');
      const b1 = h('button', 'btn', '三维检视'); b1.onclick = () => openInspect(r.id);
      const b2 = h('button', 'btn cyan', '小维巡检'); b2.onclick = () => Agent.handleUser(`去看看 ${r.id}`);
      wrap.appendChild(b1); wrap.appendChild(b2); ops.appendChild(wrap); tr.appendChild(ops);
      tb.appendChild(tr);
    });
  }

  /* ============================================================
   * 5) 能效管理
   * ============================================================ */
  function renderEnergy() {
    const c = AppData.constants;
    const top = $('energy-top');
    top.innerHTML = '';
    const pills = h('div', 'ov-pills');
    [
      { v: c.weekEnergy.toLocaleString(), l: '近 7 天用电（kWh）' },
      { v: c.pue, l: '当前 PUE' },
      { v: c.energyDelta + '%', l: '同比变化' },
      { v: c.pueTarget, l: 'PUE 目标' },
    ].forEach((d) => {
      const p = h('div', 'ov-pill');
      p.appendChild(h('div', 'pv', d.v));
      p.appendChild(h('div', 'pl', d.l));
      pills.appendChild(p);
    });
    top.appendChild(pills);

    document.querySelectorAll('.seg-btn').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        Charts.renderEnergyTrend(b.dataset.range);
      };
    });
  }

  /* ============================================================
   * 6) 告警中心
   * ============================================================ */
  let selectedAlarm = 'A-02';

  function renderAlarms() {
    const alarms = AppData.activeAlarms();
    // 选中的机柜若已无告警，自动回退到第一条活动告警
    if (!alarms.some((a) => a.rackId === selectedAlarm)) {
      selectedAlarm = alarms.length ? alarms[0].rackId : null;
    }
    const sum = AppData.listAlarms('全部');
    const stats = $('alarm-stats');
    stats.innerHTML = '';
    const pills = h('div', 'stat-pills');
    [
      { v: sum.total, l: '当前告警', cls: '' },
      { v: sum.crit, l: '严重', cls: 'crit' },
      { v: sum.normal, l: '一般', cls: '' },
      { v: sum.confirmed, l: '已确认', cls: '' },
    ].forEach((d) => {
      const p = h('div', 'stat-pill ' + d.cls);
      p.appendChild(h('span', 'sl', d.l));
      p.appendChild(h('span', 'sv', d.v));
      pills.appendChild(p);
    });
    stats.appendChild(pills);

    const ul = $('alarm-pending-list');
    ul.innerHTML = '';
    alarms.forEach((a) => {
      const li = h('li', sevCls(a.severity) + (selectedAlarm === a.rackId ? ' active' : ''));
      const top = h('div', 'ap-top');
      top.appendChild(h('span', 'rk', a.rackId));
      top.appendChild(h('span', null, a.severity));
      li.appendChild(top);
      li.appendChild(h('div', 'ap-desc', a.type));
      const meta = h('div', 'ap-meta');
      meta.appendChild(document.createTextNode(a.time + ' · '));
      meta.appendChild(h('span', a.confirmed ? 'confirmed' : 'unconfirmed', a.confirmed ? '已确认' : '待确认'));
      li.appendChild(meta);
      li.onclick = () => { selectedAlarm = a.rackId; renderAlarms(); };
      ul.appendChild(li);
    });

    renderAlarmDetail();
  }

  function renderAlarmDetail() {
    const box = $('alarm-detail');
    box.innerHTML = '';
    const r = AppData.getRack(selectedAlarm);
    if (!r || !r.alarmType) {
      box.innerHTML = '<div class="alarm-detail"><p>该机柜无活动告警。</p></div>';
      return;
    }
    const sum = AppData.activeAlarms().find((a) => a.rackId === selectedAlarm);
    if (!sum) {
      box.innerHTML = '<div class="alarm-detail"><p>该机柜无活动告警。</p></div>';
      return;
    }
    const wrap = h('div', 'alarm-detail');
    wrap.appendChild(h('div', 'ad-head', `${r.id} · ${r.alarmType}`));
    [
      ['当前值', r.temp + '℃', null],
      ['阈值', sum.threshold, null],
      ['发生时间', '2024-11-02 ' + sum.time, null],
    ].forEach(([l, v, cls]) => {
      const x = h('div', 'ad-row');
      x.appendChild(kv(l, v, cls));
      wrap.appendChild(x);
    });
    const confRow = h('div', 'ad-row');
    const confB = h('b', null, sum.confirmed ? '已确认' : '待确认');
    confB.style.color = sum.confirmed ? '#28e0a4' : '#ffb547';
    confRow.appendChild(document.createTextNode('确认状态 '));
    confRow.appendChild(confB);
    wrap.appendChild(confRow);

    wrap.appendChild(h('h5', null, '处置建议'));
    const adv = AppData.getAdvice(r.id);
    const ul = h('ul', 'ad-advice');
    (adv.advice || []).forEach((a) => ul.appendChild(h('li', null, a)));
    wrap.appendChild(ul);

    const btns = h('div', 'ad-btns');
    const bc = h('button', 'btn', '确认告警');
    bc.onclick = () => { AppData.confirmAlarm(r.id); refreshAll(); };
    const bt = h('button', 'btn cyan', '生成工单');
    bt.onclick = () => { AppData.createTicket(r.id); refreshAll(); };
    const bx = h('button', 'btn', '小维巡检');
    bx.onclick = () => Agent.handleUser(`去看看 ${r.id}`);
    const bv = h('button', 'btn', '查看三维设备');
    bv.onclick = () => openInspect(r.id);
    [bc, bt, bx, bv].forEach((b) => btns.appendChild(b));
    wrap.appendChild(btns);
    box.appendChild(wrap);
  }

  /* ============================================================
   * 7) 运维工单
   * ============================================================ */
  let selectedTicket = null;

  function renderTickets() {
    const ul = $('ticket-list');
    ul.innerHTML = '';
    if (!selectedTicket && AppData.tickets.length) selectedTicket = AppData.tickets[0].no;
    AppData.tickets.forEach((t) => {
      const li = h('li', selectedTicket === t.no ? 'active' : '');
      li.appendChild(h('div', 'tk-no', t.no));
      li.appendChild(h('div', 'tk-title', t.title));
      const meta = h('div', 'tk-meta');
      meta.appendChild(h('span', null, `${t.rackId} · ${t.assignee}`));
      meta.appendChild(h('span', tkCls(t.status), t.status));
      li.appendChild(meta);
      li.onclick = () => { selectedTicket = t.no; renderTickets(); };
      ul.appendChild(li);
    });
    renderTicketDetail();
  }

  function renderTicketDetail() {
    const box = $('ticket-detail');
    box.innerHTML = '';
    const t = AppData.tickets.find((x) => x.no === selectedTicket);
    if (!t) { box.textContent = '暂无工单'; return; }
    const wrap = h('div', 'ticket-detail');
    [
      ['工单编号', t.no, null],
      ['关联机柜', t.rackId, null],
      ['负责人', t.assignee, null],
    ].forEach(([l, v, cls]) => {
      const r = h('div', 'td-row');
      r.appendChild(kv(l, v, cls));
      wrap.appendChild(r);
    });
    const stRow3 = h('div', 'td-row');
    stRow3.appendChild(document.createTextNode('状态 '));
    const stWrap = h('b');
    stWrap.appendChild(h('span', tkCls(t.status), t.status));
    stRow3.appendChild(stWrap);
    wrap.appendChild(stRow3);
    const ctRow = h('div', 'td-row');
    ctRow.appendChild(kv('创建时间', t.createdAt, null));
    wrap.appendChild(ctRow);

    const tl = h('ul', 'timeline');
    t.timeline.forEach((s) => {
      const li = h('li');
      li.appendChild(h('div', 'tl-t', s.t));
      li.appendChild(h('div', 'tl-x', s.text));
      tl.appendChild(li);
    });
    wrap.appendChild(tl);
    box.appendChild(wrap);
  }

  /* ============================================================
   * 右侧：设备详情 Tab
   * ============================================================ */
  function renderDeviceTab(rackId) {
    const r = AppData.getRack(rackId);
    const box = $('device-pane-body');
    box.innerHTML = '';
    if (!r) { box.appendChild(h('div', 'dp-empty', '暂无机柜')); return; }
    const wrap = h('div', 'ticket-detail');
    wrap.appendChild(h('div', 'ad-head', r.id + ' 设备详情'));
    [
      ['资产编号', r.assetNo, null],
      ['规格', `${r.u}U（已用 ${r.usedU}U）`, null],
      ['进风温度', r.temp + '℃', r.alarmType && r.temp > 28 ? 'temp-hot' : null],
      ['IT 负载', r.load + '%', null],
      ['功率', r.power + ' kW', null],
      ['状态', r.alarmType || '正常', null],
      ['上次维保', r.lastMaintenance, null],
      ['下次维保', r.nextMaintenance, null],
    ].forEach(([l, v, cls]) => {
      const x = h('div', 'td-row');
      x.appendChild(kv(l, v, cls));
      wrap.appendChild(x);
    });
    const b = h('button', 'btn cyan', '进入三维检视');
    b.style.marginTop = '10px';
    b.onclick = () => openInspect(r.id);
    wrap.appendChild(b);
    box.appendChild(wrap);
  }
  function openDeviceTab() {
    document.querySelectorAll('.as-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === 'device'));
    $('pane-chat').classList.remove('active');
    $('pane-device').classList.add('active');
  }

  // assistant tabs
  document.querySelectorAll('.as-tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.as-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      $('pane-chat').classList.toggle('active', t.dataset.tab === 'chat');
      $('pane-device').classList.toggle('active', t.dataset.tab === 'device');
    });
  });

  // 快捷指令
  const QUICK = [
    '去看看 A-02', '当前有哪些告警', 'A-02 怎么处理',
    '给 A-02 派单', '复测 A-02', '切换到能效管理',
  ];
  const qc = $('quick-cmds');
  QUICK.forEach((q) => {
    const b = h('button', null, q);
    b.onclick = () => Agent.handleUser(q);
    qc.appendChild(b);
  });

  /* ============================================================
   * 供应商面板
   * ============================================================ */
  let providerData = [];

  async function initProviders() {
    await loadProviderOptions();
    const sel = $('provider-select');
    sel.addEventListener('change', () => {
      Agent.setProvider(sel.value || null);
      const p = providerData.find((x) => x.id === sel.value);
      if (p) { $('model-input').value = p.defaultModel; fillModels(p); Agent.setModel(p.defaultModel); }
      else { $('model-input').value = ''; Agent.setModel(null); }
    });
    $('model-input').addEventListener('change', () => Agent.setModel($('model-input').value));
    $('model-input').addEventListener('input', () => Agent.setModel($('model-input').value));

    $('custom-entry').onclick = () => $('custom-modal').classList.remove('hidden');
    $('cm-cancel').onclick = () => $('custom-modal').classList.add('hidden');
    $('cm-save').onclick = saveCustom;
  }

  async function loadProviderOptions() {
    let data;
    try { data = await fetch('/api/providers').then((r) => r.json()); }
    catch (e) { data = { providers: [] }; }
    providerData = data.providers;
    const sel = $('provider-select');
    sel.innerHTML = '';
    sel.appendChild(h('option', null, '自动（Failover）'));
    providerData.forEach((p) => {
      const o = h('option', null, p.name + (p.keyConfigured ? '' : '（未配置）'));
      o.value = p.id;
      if (!p.keyConfigured) o.disabled = true;
      sel.appendChild(o);
    });
    // 默认模型列表
    $('model-list').innerHTML = '';
  }
  function fillModels(p) {
    const dl = $('model-list');
    dl.innerHTML = '';
    (p.models || []).forEach((m) => dl.appendChild(h('option', null, m)));
  }

  async function saveCustom() {
    const body = {
      name: $('cm-name').value.trim(),
      baseUrl: $('cm-base').value.trim(),
      apiKey: $('cm-key').value.trim(),
      model: $('cm-model').value.trim() || 'gpt-4o-mini',
    };
    if (!body.baseUrl) { alert('请填写 BaseUrl'); return; }
    const r = await fetch('/api/providers/custom', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((x) => x.json());
    if (r.ok) {
      $('custom-modal').classList.add('hidden');
      ['cm-name', 'cm-base', 'cm-key', 'cm-model'].forEach((i) => $(i).value = '');
      await loadProviderOptions();
      const sel = $('provider-select');
      sel.value = r.id;
      sel.dispatchEvent(new Event('change'));
    }
  }

  /* ============================================================
   * 全局渲染 / 刷新
   * ============================================================ */
  function renderAll() {
    renderOverview();
    renderMonitor();
    renderAssets();
    renderEnergy();
    renderAlarms();
    renderTickets();
    renderDeviceTab(null);
  }
  function refreshAll() {
    renderLocateAlarms();
    renderAssets();
    renderAlarms();
    renderTickets();
    renderOverview();
    // 若检视页打开，同步当前检视机柜的实时数据
    if ($('page-inspect').classList.contains('active') && currentInspectRack) {
      const r = AppData.getRack(currentInspectRack);
      if (r) {
        renderInspectInfo(r);
        if (typeof Scene3D.refreshRack === 'function') Scene3D.refreshRack(r);
      }
    }
  }

  global.Main = {
    showPage, openInspect, refreshAll,
    renderDeviceTab, openDeviceTab,
  };

  // 窗口尺寸变化
  window.addEventListener('resize', () => {
    Scene3D.resizeActive();
    Charts.resizeAll();
  });

  // 启动
  bootIntro();
})(window);
