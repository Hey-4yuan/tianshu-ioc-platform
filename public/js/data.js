/* ============================================================
 * data.js  — 单一数据源（演示数据）
 * 台账口径 256 台；三维场景展示 42 台代表机柜。
 * ============================================================ */
(function (global) {
  'use strict';

  // 区配置：数量、悬浮温度、行 z 坐标
  const ZONES = {
    A: { count: 9, temp: 24.1, z: -8 },
    B: { count: 8, temp: 23.8, z: -4 },
    C: { count: 8, temp: 24.5, z: 0 },
    D: { count: 8, temp: 24.0, z: 4 },
    E: { count: 9, temp: 23.7, z: 8 },
  };
  const RACK_GAP = 2.0;
  const RACK_FRONT = 1.15; // 柜门前 z 偏移（机器人停靠点）

  // 固定告警机柜的明细
  const ALARM_DEFS = {
    'A-02': {
      type: '进风温度过高', severity: '严重', time: '14:21:08', confirmed: false,
      detail: '进风温度 31.8℃，超过阈值 ≤28℃',
      threshold: '≤28℃',
    },
    'D-07': {
      type: '网络设备离线', severity: '严重', time: '13:47:55', confirmed: false,
      detail: '核心交换机端口 Gi1/0/24 链路 Down，设备心跳丢失',
      threshold: '链路在线',
    },
    'E-05': {
      type: 'PDU 负载偏高', severity: '一般', time: '12:53:40', confirmed: false,
      detail: 'PDU-A 回路负载率 86%，接近冗余阈值',
      threshold: '≤80%',
    },
    'C-05': {
      type: '散热风扇故障', severity: '严重', time: '14:18:32', confirmed: true,
      detail: '第 3 组风扇转速为 0，风道风压异常',
      threshold: '风扇转速正常',
    },
  };

  // 处置知识库（按告警类型）
  const ADVICE_KB = {
    '进风温度过高': [
      '检查进风通道是否堵塞，清理线缆与杂物',
      '确认冷通道封闭与送风地板开度，调整空调送风',
      '核对进风温度传感器读数，排除传感器误报',
    ],
    '网络设备离线': [
      '检查设备端口状态与指示灯，确认是否掉电',
      '核查光纤/网线链路与对端端口，必要时更换模块',
      '登录交换机核对端口配置与最近变更日志',
    ],
    'PDU 负载偏高': [
      '核对各回路负载，将设备均衡到低负载回路',
      '确认冗余电源分接不同 PDU，避免单回路过载',
      '查看峰值电流记录，评估是否需要扩容',
    ],
    '散热风扇故障': [
      '查看风扇转速与告警，定位故障风扇位',
      '现场更换故障风扇，恢复冗余风道',
      '更换后检查风道风压与各层温度',
    ],
  };

  const DEVICE_TYPES = ['服务器', '存储', '网络', '安全', '其他'];
  const TYPE_DISTRIBUTION = { 服务器: 58, 存储: 18, 网络: 12, 安全: 7, 其他: 5 };

  // 伪随机（确定性，保证每次加载数据一致）
  function seeded(seed) {
    let s = seed;
    return function () {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  function buildRacks() {
    const racks = [];
    const rnd = seeded(20241102);
    for (const zone of Object.keys(ZONES)) {
      const zc = ZONES[zone];
      for (let i = 1; i <= zc.count; i++) {
        const id = `${zone}-${String(i).padStart(2, '0')}`;
        const x = (i - (zc.count + 1) / 2) * RACK_GAP;
        const z = zc.z;
        const alarm = ALARM_DEFS[id] || null;
        let temp, load, power, status;
        if (id === 'A-02') { temp = 31.8; load = 49; power = 2.23; }
        else if (alarm) {
          temp = +(zc.temp + 0.6 + rnd() * 0.8).toFixed(1);
          load = id === 'E-05' ? 86 : Math.round(40 + rnd() * 30);
          power = +(1.8 + rnd() * 0.9).toFixed(2);
        } else {
          temp = +(22.5 + rnd() * 2.2).toFixed(1);
          load = Math.round(30 + rnd() * 45);
          power = +(1.4 + rnd() * 1.3).toFixed(2);
        }
        status = alarm ? (alarm.severity === '严重' ? '严重' : '一般') : '正常';
        // 设备类型按分布确定性分配
        const type = pickType(rnd);
        racks.push({
          id, zone, x, z,
          assetNo: `DC01-${zone}-${String(i).padStart(3, '0')}`,
          u: 42,
          usedU: Math.round(30 + rnd() * 10),
          temp, load, power, status,
          alarmType: alarm ? alarm.type : null,
          alarmConfirmed: alarm ? alarm.confirmed : false,
          deviceType: type,
          lastMaintenance: '2024-10-28',
          nextMaintenance: '2024-11-25',
        });
      }
    }
    return racks;
  }

  // 机柜号字符串 → 数值种子（供确定性复测温度使用）
  function hashCode(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 100000;
    return h;
  }

  function pickType(rnd) {
    const r = rnd() * 100;
    let acc = 0;
    for (const t of DEVICE_TYPES) {
      acc += TYPE_DISTRIBUTION[t];
      if (r <= acc) return t;
    }
    return '服务器';
  }

  const racks = buildRacks();

  // ---------- 工单 ----------
  const tickets = [
    {
      no: 'WO-20241102-001',
      rackId: 'C-05',
      title: 'C-05 散热风扇故障更换',
      assignee: '李工',
      status: '现场处理中',
      createdAt: '2024-11-02 14:20:11',
      timeline: [
        { t: '2024-11-02 14:18:32', text: '系统检测到 C-05 第 3 组风扇故障告警' },
        { t: '2024-11-02 14:19:02', text: '值班人员确认告警' },
        { t: '2024-11-02 14:20:11', text: '生成工单并派单给 李工' },
        { t: '2024-11-02 14:31:45', text: '李工到达现场开始处理' },
      ],
    },
  ];

  const ASSIGNEES = ['张工', '李工', '王工'];

  // ---------- 图表序列 ----------
  const energyDays = {
    dates: ['10/27', '10/28', '10/29', '10/30', '10/31', '11/01', '11/02'],
    values: [30240, 31120, 29860, 30540, 28980, 31615, 28430], // 合计 210,785
  };
  const pueDays = {
    dates: ['10/27', '10/28', '10/29', '10/30', '10/31', '11/01', '11/02'],
    values: [1.38, 1.37, 1.39, 1.36, 1.40, 1.37, 1.36],
  };
  // 近24h 告警（12 个两小时桶，堆叠：严重/一般/提示），合计 12
  const alarm24h = {
    buckets: ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'],
    crit: [0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0],
    normal: [0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0],
    info: [1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 0],
  };
  const spark = {
    temp: [23.8, 23.9, 24.0, 24.1, 24.2, 24.3, 24.3],
    hum: [44.1, 44.5, 44.8, 45.0, 45.1, 45.2, 45.2],
    pue: [1.39, 1.38, 1.37, 1.37, 1.36, 1.36, 1.36],
  };

  const Data = {
    ZONES, RACK_GAP, RACK_FRONT,
    racks,
    tickets,
    ASSIGNEES,
    series: { energyDays, pueDays, alarm24h, spark },
    constants: {
      ledgerTotal: 256, maintenance: 0,
      // 以下几项随告警状态联动（解警/派单后自动更新）
      get activeAlarm() { return racks.filter((r) => r.alarmType).length; },
      get online() { return this.ledgerTotal - this.activeAlarm - this.maintenance; },
      get sceneAlarm() { return this.activeAlarm; },
      get sceneNormal() { return this.sceneCount - this.activeAlarm; },
      score: 98, roomTemp: 24.3, humidity: 45.2, pue: 1.36,
      itLoadPct: 68, itLoadNow: 12.6, itLoadCap: 18.5,
      todayEnergy: 28430, energyDelta: -6.8, weekEnergy: 210785, pueTarget: 1.40,
      totalPower: 32.6, availability: 99.99,
      sceneCount: 42, usedU: 1512,
      typeDistribution: TYPE_DISTRIBUTION,
      energyComposition: { IT: 60, 制冷: 25, 供配电: 10, 照明其他: 5 },
    },

    getRack(id) {
      id = String(id).toUpperCase().trim();
      return racks.find((r) => r.id === id) || null;
    },
    rackPosition(id) {
      const r = this.getRack(id);
      return r ? { x: r.x, z: r.z } : null;
    },

    activeAlarms() {
      return racks
        .filter((r) => r.alarmType && ALARM_DEFS[r.id])
        .map((r) => {
          const d = ALARM_DEFS[r.id];
          return {
            rackId: r.id, type: r.alarmType, severity: d.severity,
            time: d.time, confirmed: d.confirmed, detail: d.detail, threshold: d.threshold,
          };
        });
    },
    listAlarms(severity) {
      const all = this.activeAlarms();
      const statsOf = (arr) => ({
        total: arr.length,
        crit: arr.filter((a) => a.severity === '严重').length,
        normal: arr.filter((a) => a.severity === '一般').length,
        confirmed: arr.filter((a) => a.confirmed).length,
      });
      const list = severity && severity !== '全部'
        ? all.filter((a) => a.severity === severity)
        : all;
      // 顶层统计与 list 同口径；global 为不过滤的全量统计
      return Object.assign(statsOf(list), { severity: severity || '全部', list, global: statsOf(all) });
    },
    confirmAlarm(rackId) {
      const r = this.getRack(rackId);
      if (!r || !r.alarmType) return { ok: false, error: '该机柜无活动告警' };
      const d = ALARM_DEFS[r.id];
      if (!d) return { ok: false, error: '告警记录不存在' };
      const already = d.confirmed;
      d.confirmed = true; r.alarmConfirmed = true;
      return { ok: true, already, rackId: r.id };
    },
    getAdvice(rackId) {
      const r = this.getRack(rackId);
      if (!r) return { ok: false, error: '机柜不存在' };
      if (!r.alarmType) return { ok: true, rackId, type: null, advice: ['该机柜当前无活动告警，运行参数正常'] };
      const advice = ADVICE_KB[r.alarmType]
        || ['知识库暂无该告警类型条目', '请按现场巡检规程人工检查，勿凭告警信号直接定根因'];
      return { ok: true, rackId, type: r.alarmType, advice };
    },
    createTicket(rackId, assignee) {
      const r = this.getRack(rackId);
      if (!r) return { ok: false, error: '机柜不存在' };
      if (!r.alarmType) return { ok: false, error: '该机柜无活动告警，无需派单' };
      const existing = tickets.find((t) => t.rackId === r.id && t.status !== '已完成');
      if (existing) return { ok: true, already: true, ticket: existing };
      const d = ALARM_DEFS[r.id];
      if (!d) return { ok: false, error: '告警记录不存在' };
      d.confirmed = true; r.alarmConfirmed = true;
      const who = assignee || ASSIGNEES[tickets.length % ASSIGNEES.length];
      const now = '2024-11-02 ' + d.time;
      const no = `WO-20241102-${String(tickets.length + 1).padStart(3, '0')}`;
      const ticket = {
        no, rackId: r.id, title: `${r.id} ${r.alarmType}处置`,
        assignee: who, status: '已派单', createdAt: now,
        timeline: [
          { t: `2024-11-02 ${d.time}`, text: `系统检测到 ${r.id} ${r.alarmType}告警` },
          { t: now, text: `确认告警并生成工单，派单给 ${who}` },
        ],
      };
      tickets.push(ticket);
      return { ok: true, ticket };
    },
    runRetest(rackId) {
      const r = this.getRack(rackId);
      if (!r) return { ok: false, error: '机柜不存在' };
      if (!r.alarmType) return { ok: false, error: '该机柜无活动告警，无需复测' };
      // 确定性复测温度（22–25℃）：由机柜号 + 复测次数生成，保证可复现
      const rndRetest = seeded(hashCode(r.id) + (r.retestCount || 0) * 7919 + 1);
      const newTemp = +(22 + rndRetest() * 3).toFixed(1);
      r.retestCount = (r.retestCount || 0) + 1;
      const ticket = tickets.find((t) => t.rackId === r.id && t.status !== '已完成');
      // 解除告警
      delete ALARM_DEFS[r.id];
      r.alarmType = null; r.alarmConfirmed = false;
      r.temp = newTemp; r.status = '正常'; r.load = Math.min(r.load, 55);
      if (ticket) {
        ticket.status = '已完成';
        ticket.timeline.push({ t: '2024-11-02 15:02:18', text: `现场复测完成，温度 ${newTemp}℃，告警解除` });
        ticket.timeline.push({ t: '2024-11-02 15:02:30', text: '工单完成并归档' });
      }
      return { ok: true, rackId: r.id, temp: newTemp, ticketNo: ticket ? ticket.no : null };
    },
    pageMetrics(page) {
      const c = this.constants;
      const map = {
        总览: `健康评分 ${c.score}，在线 ${c.online}/${c.ledgerTotal}，当前告警 ${c.activeAlarm}`,
        机房监控: `场景展示 ${c.sceneCount} 台代表机柜，当前告警 ${c.activeAlarm}`,
        资产管理: `台账 ${c.ledgerTotal} 台，场景 ${c.sceneCount} 台，已用 ${c.usedU}U`,
        能效管理: `今日能耗 ${c.todayEnergy.toLocaleString()} kWh，PUE ${c.pue}`,
        告警中心: (() => { const a = this.listAlarms('全部'); return `当前告警 ${a.total}，严重 ${a.crit}，一般 ${a.normal}`; })(),
        运维工单: `进行中工单 ${tickets.filter((t) => t.status !== '已完成').length} 个`,
      };
      return map[page] || '已切换页面';
    },
  };

  global.AppData = Data;
})(window);
