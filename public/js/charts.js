/* ============================================================
 * charts.js — ECharts 图表（按页初始化，处理隐藏容器尺寸 0）
 * ============================================================ */
(function (global) {
  'use strict';

  const instances = {};
  const builtPages = new Set();

  const AXIS = {
    axisLine: { lineStyle: { color: 'rgba(0,229,255,0.2)' } },
    axisLabel: { color: '#8aa3bd', fontSize: 11 },
    splitLine: { lineStyle: { color: 'rgba(0,229,255,0.08)' } },
  };
  const TOOLTIP = {
    trigger: 'axis',
    backgroundColor: 'rgba(8,17,32,0.94)',
    borderColor: 'rgba(0,229,255,0.4)',
    textStyle: { color: '#d7e6f5', fontSize: 12 },
  };

  function get(id) {
    const dom = document.getElementById(id);
    if (!dom) return null;
    if (!instances[id]) instances[id] = echarts.init(dom);
    return instances[id];
  }

  /** 判空安全的 setOption：get() 在容器不存在时返回 null，此处跳过而非空引用崩溃 */
  function setOption(id, option, notMerge) {
    const chart = get(id);
    if (!chart) return;
    chart.setOption(option, notMerge);
  }

  /* ---------------- 总览 ---------------- */
  function buildOverview() {
    const c = AppData.constants;

    // 健康评分 gauge
    setOption('ov-score-chart', {
      series: [{
        type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 100,
        radius: '95%', center: ['50%', '62%'],
        progress: { show: true, width: 12, itemStyle: { color: '#28e0a4' } },
        axisLine: { lineStyle: { width: 12, color: [[1, 'rgba(0,229,255,0.12)']] } },
        pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true, fontSize: 34, color: '#28e0a4',
          formatter: '{value}', offsetCenter: [0, '-6%'],
          textShadowColor: 'rgba(40,224,164,0.7)', textShadowBlur: 12,
        },
        data: [{ value: c.score }],
      }],
    });

    // 三条迷你折线（3 个 grid）
    const sp = AppData.series.spark;
    setOption('ov-spark-chart', {
      animation: false,
      title: [
        { text: '温度℃', left: 4, top: 2, textStyle: { color: '#8aa3bd', fontSize: 10 } },
        { text: '湿度%', left: 4, top: 34, textStyle: { color: '#8aa3bd', fontSize: 10 } },
        { text: 'PUE', left: 4, top: 66, textStyle: { color: '#8aa3bd', fontSize: 10 } },
      ],
      grid: [
        { left: 46, right: 12, top: 4, height: 24 },
        { left: 46, right: 12, top: 36, height: 24 },
        { left: 46, right: 12, top: 68, height: 24 },
      ],
      xAxis: [0, 1, 2].map(() => ({
        type: 'category', show: false, data: sp.temp.map((_, i) => i), boundaryGap: false,
      })),
      yAxis: [0, 1, 2].map((i) => ({
        type: 'value', show: false, scale: true,
        min: (v) => Math.min(...[sp.temp, sp.hum, sp.pue][i]) - 0.5,
        max: (v) => Math.max(...[sp.temp, sp.hum, sp.pue][i]) + 0.5,
      })),
      series: [
        { type: 'line', data: sp.temp, smooth: true, showSymbol: false, lineStyle: { color: '#00e5ff', width: 1.6 }, areaStyle: { color: 'rgba(0,229,255,0.15)' }, xAxisIndex: 0, yAxisIndex: 0 },
        { type: 'line', data: sp.hum, smooth: true, showSymbol: false, lineStyle: { color: '#28e0a4', width: 1.6 }, xAxisIndex: 1, yAxisIndex: 1 },
        { type: 'line', data: sp.pue, smooth: true, showSymbol: false, lineStyle: { color: '#ffb547', width: 1.6 }, xAxisIndex: 2, yAxisIndex: 2 },
      ],
    });

    // 近24h 告警堆叠柱
    const a = AppData.series.alarm24h;
    setOption('ov-alarm24-chart', {
      tooltip: Object.assign({}, TOOLTIP),
      legend: { data: ['严重', '一般', '提示'], textStyle: { color: '#8aa3bd', fontSize: 11 }, top: 0, right: 4 },
      grid: { left: 34, right: 12, top: 28, bottom: 24 },
      xAxis: Object.assign({ type: 'category', data: a.buckets }, AXIS),
      yAxis: Object.assign({ type: 'value' }, AXIS),
      series: [
        { name: '严重', type: 'bar', stack: 't', data: a.crit, itemStyle: { color: '#ff4d4f' }, barWidth: '55%' },
        { name: '一般', type: 'bar', stack: 't', data: a.normal, itemStyle: { color: '#ffb547' } },
        { name: '提示', type: 'bar', stack: 't', data: a.info, itemStyle: { color: '#00e5ff' } },
      ],
    });

    // IT 负载环形
    setOption('ov-itload-chart', {
      title: {
        text: `${c.itLoadPct}%`, subtext: `${c.itLoadNow} / ${c.itLoadCap} MW`,
        left: 'center', top: '38%',
        textStyle: { color: '#00e5ff', fontSize: 30, textShadowColor: 'rgba(0,229,255,0.7)', textShadowBlur: 12 },
        subtextStyle: { color: '#8aa3bd', fontSize: 12 },
      },
      series: [{
        type: 'pie', radius: ['62%', '80%'], center: ['50%', '50%'],
        label: { show: false }, silent: true,
        data: [
          { value: c.itLoadPct, itemStyle: { color: '#00e5ff' } },
          { value: 100 - c.itLoadPct, itemStyle: { color: 'rgba(0,229,255,0.1)' } },
        ],
      }],
    });

    // 设备类型环形
    const td = c.typeDistribution;
    setOption('ov-devtype-chart', {
      tooltip: { trigger: 'item', backgroundColor: 'rgba(8,17,32,0.94)', borderColor: 'rgba(0,229,255,0.4)', textStyle: { color: '#d7e6f5' } },
      legend: { bottom: 0, textStyle: { color: '#8aa3bd', fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      color: ['#00e5ff', '#28e0a4', '#ffb547', '#ff7eb0', '#7c8cff'],
      series: [{
        type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
        label: { color: '#d7e6f5', fontSize: 11, formatter: '{b} {d}%' },
        data: Object.keys(td).map((k) => ({ name: k, value: td[k] })),
      }],
    });
  }

  /* ---------------- 能效 ---------------- */
  function buildEnergy() {
    renderEnergyTrend('week');
    renderPue();
    renderEnergyComp();
  }

  function renderEnergyTrend(range) {
    const e = AppData.series.energyDays;
    let dates = e.dates, values = e.values;
    if (range === 'today') { dates = [e.dates[6]]; values = [e.values[6]]; }
    setOption('energy-trend-chart', {
      tooltip: Object.assign({}, TOOLTIP, { valueFormatter: (v) => v.toLocaleString() + ' kWh' }),
      grid: { left: 60, right: 18, top: 24, bottom: 30 },
      xAxis: Object.assign({ type: 'category', data: dates }, AXIS),
      yAxis: Object.assign({ type: 'value', axisLabel: { color: '#8aa3bd', fontSize: 11, formatter: (v) => v / 1000 + 'k' } }, AXIS),
      series: [{
        type: 'bar', data: values, barWidth: '46%',
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#00e5ff' }, { offset: 1, color: 'rgba(0,229,255,0.2)' },
          ]),
        },
        label: { show: true, position: 'top', color: '#8aa3bd', fontSize: 10, formatter: (p) => (p.value / 1000).toFixed(1) + 'k' },
      }],
    }, true);
  }

  function renderPue() {
    const p = AppData.series.pueDays;
    setOption('pue-chart', {
      tooltip: Object.assign({}, TOOLTIP),
      grid: { left: 48, right: 18, top: 24, bottom: 30 },
      xAxis: Object.assign({ type: 'category', data: p.dates }, AXIS),
      yAxis: Object.assign({ type: 'value', min: 1.32, max: 1.42 }, AXIS),
      series: [{
        type: 'line', data: p.values, smooth: true, symbolSize: 7,
        lineStyle: { color: '#ffb547', width: 2.4 }, itemStyle: { color: '#ffb547' },
        areaStyle: { color: 'rgba(255,181,71,0.12)' },
        markLine: {
          symbol: 'none', label: { color: '#28e0a4', formatter: '目标 1.40' },
          lineStyle: { color: '#28e0a4', type: 'dashed' },
          data: [{ yAxis: AppData.constants.pueTarget }],
        },
      }],
    });
  }

  function renderEnergyComp() {
    const ec = AppData.constants.energyComposition;
    setOption('energy-comp-chart', {
      tooltip: { trigger: 'item', backgroundColor: 'rgba(8,17,32,0.94)', borderColor: 'rgba(0,229,255,0.4)', textStyle: { color: '#d7e6f5' }, formatter: '{b}: {c}%' },
      legend: { bottom: 0, textStyle: { color: '#8aa3bd', fontSize: 11 } },
      color: ['#00e5ff', '#28e0a4', '#ffb547', '#7c8cff'],
      series: [{
        type: 'pie', radius: ['45%', '70%'], center: ['50%', '44%'],
        label: { color: '#d7e6f5', fontSize: 11, formatter: '{b}\n{c}%' },
        data: Object.keys(ec).map((k) => ({ name: k, value: ec[k] })),
      }],
    });
  }

  /* ---------------- 公共 ---------------- */
  function initPage(page) {
    if (page === '总览') { if (!builtPages.has(page)) { buildOverview(); builtPages.add(page); } else resizeAll(); }
    if (page === '能效管理') { if (!builtPages.has(page)) { buildEnergy(); builtPages.add(page); } else resizeAll(); }
    // 其它页面无 ECharts
    requestFrameResize();
  }

  function requestFrameResize() {
    setTimeout(resizeAll, 60);
  }

  function resizeAll() {
    for (const id in instances) {
      const d = document.getElementById(id);
      if (d && d.offsetWidth > 0 && d.offsetHeight > 0) instances[id].resize();
    }
  }

  global.Charts = {
    initPage, resizeAll, renderEnergyTrend,
    refreshOverview() { builtPages.delete('总览'); buildOverview(); builtPages.add('总览'); },
  };
})(window);
