/* ============================================================
 * soft3d.js — Canvas 2D 软件 3D 兜底渲染器
 *  当 WebGL 不可用（沙箱禁用 GPU）时自动启用，接口与 Scene3D 对齐：
 *  片头 / 机房俯视+机器人巡检 / 设备环绕检视，支持拖动、缩放、点击拾取。
 *  正常有 GPU 的环境仍使用 Three.js（见 scene.js）。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 向量 ---------------- */
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    norm: (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
  };

  /* ---------------- 相机 ---------------- */
  function Camera(fov) {
    this.fov = fov;
    this.eye = [0, 10, 20];
    this.target = [0, 1, 0];
  }
  Camera.prototype.look = function (eye, target) {
    this.eye = eye.slice(); this.target = target.slice();
    const f = V.norm(V.sub(target, eye));
    const up = [0, 1, 0];
    const r = V.norm(V.cross(f, up));
    const u = V.cross(r, f);
    this.f = f; this.r = r; this.u = u;
  };
  Camera.prototype.project = function (p, w, h) {
    const rel = V.sub(p, this.eye);
    const depth = V.dot(rel, this.f);
    const sx = V.dot(rel, this.r);
    const sy = V.dot(rel, this.u);
    const focal = h / 2 / Math.tan((this.fov * Math.PI / 180) / 2);
    const sc = focal / depth;
    return { x: w / 2 + sx * sc, y: h / 2 - sy * sc, depth, sc };
  };
  Camera.prototype.ray = function (nx, ny, aspect) {
    const tan = Math.tan((this.fov * Math.PI / 180) / 2);
    let dir = V.add(this.f, V.scale(this.r, nx * tan * aspect));
    dir = V.add(dir, V.scale(this.u, ny * tan));
    return { origin: this.eye.slice(), dir: V.norm(dir) };
  };

  /* ---------------- 盒面几何 ---------------- */
  const CORNER_SIGNS = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const FACE_DEFS = [
    { idx: [4, 5, 6, 7], n: [0, 0, 1] },
    { idx: [1, 0, 3, 2], n: [0, 0, -1] },
    { idx: [5, 1, 2, 6], n: [1, 0, 0] },
    { idx: [0, 4, 7, 3], n: [-1, 0, 0] },
    { idx: [3, 7, 6, 2], n: [0, 1, 0] },
    { idx: [4, 0, 1, 5], n: [0, -1, 0] },
  ];
  function boxCorners(c, h) {
    return CORNER_SIGNS.map((s) => [
      c[0] + s[0] * h[0], c[1] + s[1] * h[1], c[2] + s[2] * h[2],
    ]);
  }

  /* ---------------- 颜色 ---------------- */
  function shade(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
    const b = Math.min(255, Math.round((n & 255) * factor));
    return `rgb(${r},${g},${b})`;
  }
  const LIGHT = V.norm([6, 12, 5]);
  function faceFill(baseHex, normal, ambient) {
    const d = Math.max(0, V.dot(normal, LIGHT));
    return shade(baseHex, (ambient || 0.55) + d * 0.55);
  }

  /* ---------------- 轨道状态 ---------------- */
  function Orbit(target, radius, theta, phi) {
    this.tx = target[0]; this.ty = target[1]; this.tz = target[2];
    this.radius = radius; this.theta = theta; this.phi = phi;
  }
  Orbit.prototype.eye = function () {
    return [
      this.tx + this.radius * Math.sin(this.phi) * Math.cos(this.theta),
      this.ty + this.radius * Math.cos(this.phi),
      this.tz + this.radius * Math.sin(this.phi) * Math.sin(this.theta),
    ];
  };
  Orbit.prototype.target = function () { return [this.tx, this.ty, this.tz]; };

  function bindDrag(canvas, orbit, onClick, limits) {
    let drag = false, sx = 0, sy = 0, moved = 0, didDrag = false;
    // 多指状态：双指捏合缩放
    const pointers = new Map();
    let pinchDist = 0;

    function applyZoom(factor) {
      orbit.radius *= factor;
      orbit.radius = Math.max(limits.minR, Math.min(limits.maxR, orbit.radius));
    }
    function rotateBy(dx, dy) {
      orbit.theta -= dx * 0.006;
      orbit.phi -= dy * 0.006;
      orbit.phi = Math.max(limits.minPhi, Math.min(limits.maxPhi, orbit.phi));
    }
    function startDrag(x, y) {
      drag = true; sx = x; sy = y; moved = 0; didDrag = false;
    }
    function moveDrag(x, y) {
      const dx = x - sx, dy = y - sy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved >= 6) didDrag = true; // 移动阈值抑制误选
      sx = x; sy = y;
      rotateBy(dx, dy);
    }
    function pinchLength() {
      const arr = Array.from(pointers.values());
      return Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    }
    function touchDist(t0, t1) {
      return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    }

    // 选择统一走原生 click（真实点击与自动化派发的 MouseEvent 都触发）；拖动/缩放后抑制误选
    canvas.addEventListener('click', (e) => {
      if (!didDrag && typeof onClick === 'function') onClick(e);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      applyZoom(1 + Math.sign(e.deltaY) * 0.09); // 滚轮缩放
    }, { passive: false });

    if (window.PointerEvent) {
      // Pointer Events：鼠标/触摸/触控笔统一处理（拖动旋转、双指缩放、点击拾取）
      canvas.style.touchAction = 'none'; // 阻止触摸滚动，保证拖动旋转
      canvas.addEventListener('pointerdown', (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
          startDrag(e.clientX, e.clientY);
          if (canvas.setPointerCapture) {
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
          }
        } else if (pointers.size === 2) {
          drag = false; // 转入捏合缩放
          pinchDist = pinchLength();
          didDrag = true; // 缩放后抑制误选
        }
      });
      canvas.addEventListener('pointermove', (e) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX; p.y = e.clientY;
        if (pointers.size >= 2) {
          const d = pinchLength();
          if (pinchDist > 0 && d > 0) applyZoom(pinchDist / d); // 双指拉开→拉近
          pinchDist = d;
          didDrag = true;
        } else if (drag) {
          moveDrag(e.clientX, e.clientY);
        }
      });
      const release = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
        if (pointers.size === 0) drag = false;
      };
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
    } else {
      // 旧浏览器兜底：鼠标 + 触摸事件
      canvas.addEventListener('mousedown', (e) => { startDrag(e.clientX, e.clientY); });
      window.addEventListener('mousemove', (e) => { if (drag) moveDrag(e.clientX, e.clientY); });
      window.addEventListener('mouseup', () => { drag = false; });
      canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          startDrag(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
          drag = false; didDrag = true;
          pinchDist = touchDist(e.touches[0], e.touches[1]);
        }
      }, { passive: true });
      canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length >= 2) {
          e.preventDefault();
          const d = touchDist(e.touches[0], e.touches[1]);
          if (pinchDist > 0 && d > 0) applyZoom(pinchDist / d);
          pinchDist = d;
          didDrag = true;
        } else if (drag && e.touches.length === 1) {
          e.preventDefault(); // 阻止页面滚动；轻点仍会合成 click 完成拾取
          moveDrag(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });
      canvas.addEventListener('touchend', () => {
        drag = false; pinchDist = 0;
      });
    }
  }

  /* ---------------- 近平面裁剪（Sutherland-Hodgman） ----------------
   * 相机空间深度 depth = dot(p - eye, f)；将多边形裁剪到 depth >= NEAR，
   * 避免跨近面的面片整面被丢弃（而不是只丢弃不裁剪）。 */
  const NEAR = 0.1;
  function clipNear(pts, cam) {
    const d = pts.map((p) => V.dot(V.sub(p, cam.eye), cam.f));
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const di = d[i], dj = d[j];
      const inI = di >= NEAR;
      if (inI) out.push(pts[i]);
      if (inI !== (dj >= NEAR)) {
        const t = (NEAR - di) / (dj - di); // 与近平面交点插值
        out.push(V.add(pts[i], V.scale(V.sub(pts[j], pts[i]), t)));
      }
    }
    return out;
  }

  /* ============================================================
   * 通用渲染收集器
   * ============================================================ */
  function Frame() { this.faces = []; this.lines = []; this.labels = []; }
  Frame.prototype.addBox = function (center, half, baseHex, opts) {
    opts = opts || {};
    const corners = boxCorners(center, half);
    for (const f of FACE_DEFS) {
      // 背面剔除（相对相机）
      const fc = [0, 1, 2].map((k) =>
        f.idx.reduce((s, vi) => s + corners[vi][k], 0) / 4);
      const toCam = V.norm(V.sub(this.cam.eye, fc));
      if (V.dot(f.n, toCam) <= 0.02) continue;
      const pts = f.idx.map((vi) => corners[vi]);
      const depth = pts.reduce((s, p) => s + V.dot(V.sub(p, this.cam.eye), this.cam.f), 0) / 4;
      this.faces.push({
        pts, depth,
        fill: opts.emissive ? shade(baseHex, 1.0) : faceFill(baseHex, f.n, opts.ambient),
        stroke: opts.stroke || null,
      });
    }
  };
  Frame.prototype.addLabel = function (anchor, text, color, bg) {
    this.labels.push({ anchor, text, color, bg });
  };
  Frame.prototype.addRing = function (center, radius, color) {
    const pts = [];
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      pts.push([center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius]);
    }
    this.lines.push({ pts, color });
  };
  Frame.prototype.draw = function (ctx, cam, w, h) {
    // 面：先做近平面裁剪，再按深度远→近（画家算法）绘制
    const polys = [];
    for (const f of this.faces) {
      const clipped = clipNear(f.pts, cam);
      if (clipped.length < 3) continue;
      const pp = clipped.map((p) => cam.project(p, w, h));
      // 深度取裁剪后均值，保证排序正确
      polys.push({
        pp,
        depth: pp.reduce((s, q) => s + q.depth, 0) / pp.length,
        fill: f.fill,
        stroke: f.stroke,
      });
    }
    polys.sort((a, b) => b.depth - a.depth);
    for (const p of polys) {
      ctx.beginPath();
      ctx.moveTo(p.pp[0].x, p.pp[0].y);
      for (let i = 1; i < p.pp.length; i++) ctx.lineTo(p.pp[i].x, p.pp[i].y);
      ctx.closePath();
      ctx.fillStyle = p.fill; ctx.fill();
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // 线（保守处理：折线跨近面时断开分段绘制，不做逐段裁剪）
    for (const ln of this.lines) {
      const pp = ln.pts.map((p) => cam.project(p, w, h));
      ctx.beginPath();
      let move = true;
      for (const q of pp) {
        if (q.depth <= NEAR) { move = true; continue; }
        if (move) { ctx.moveTo(q.x, q.y); move = false; } else ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = ln.color; ctx.lineWidth = 1.6; ctx.stroke();
    }
    // 标签（按深度远→近）
    const labs = this.labels.map((l) => ({ l, pr: cam.project(l.anchor, w, h) }))
      .filter((x) => x.pr.depth > NEAR)
      .sort((a, b) => b.pr.depth - a.pr.depth);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Microsoft YaHei';
    for (const { l, pr } of labs) {
      const tw = ctx.measureText(l.text).width;
      if (l.bg) {
        ctx.fillStyle = l.bg;
        roundRectFill(ctx, pr.x - tw / 2 - 6, pr.y - 10, tw + 12, 20, 4);
      }
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, pr.x, pr.y);
    }
  };
  function roundRectFill(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fill();
  }

  /* ============================================================
   * 机房（软件）
   * ============================================================ */
  const Room = {
    canvas: null, ctx: null, cam: null, orbit: null,
    robotPos: [-9.6, 0, -6.85],
    moving: null, fly: null, highlighted: new Set(),

    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cam = new Camera(50);
      this.orbit = new Orbit([0, 0, 0], 23, Math.PI * 0.25, 0.62);
      bindDrag(canvas, this.orbit, (e) => this.click(e),
        { minPhi: 0.12, maxPhi: 1.45, minR: 2.5, maxR: 40 });
      this.resize();
    },

    click(e) {
      const rect = this.canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.cam.look(this.orbit.eye(), this.orbit.target());
      const ray = this.cam.ray(nx, ny, rect.width / rect.height);
      let best = null;
      for (const r of AppData.racks) {
        const t = rayBox(ray, [r.x, 1.3, r.z], [0.6, 1.3, 0.5]);
        if (t != null && (best == null || t < best.t)) best = { t, id: r.id };
      }
      if (best && typeof this.onPick === 'function') {
        this.onPick(best.id, e.clientX - rect.left, e.clientY - rect.top);
      }
    },

    focusRack(id, done) {
      const r = AppData.getRack(id);
      if (!r) { done && done(); return; }
      const target = [r.x, 1.3, r.z];
      const eye = [r.x, 1.7, r.z + 4.2];
      const rel = V.sub(eye, target);
      const radius = Math.hypot(rel[0], rel[1], rel[2]) || 1;
      // 方位角走最短弧，避免绕远（与 scene.js 一致）
      let dTheta = Math.atan2(rel[2], rel[0]) - this.orbit.theta;
      dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
      this.fly = {
        t: 0, dur: 1.1,
        f0: { tx: this.orbit.tx, ty: this.orbit.ty, tz: this.orbit.tz, radius: this.orbit.radius, theta: this.orbit.theta, phi: this.orbit.phi },
        f1: {
          tx: target[0], ty: target[1], tz: target[2], radius,
          theta: this.orbit.theta + dTheta,
          phi: Math.acos(Math.max(-1, Math.min(1, rel[1] / radius))),
        },
        done,
      };
    },
    updateFly(dt) {
      const f = this.fly; f.t += dt / f.dur;
      const k = Math.min(f.t, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      for (const key of ['tx', 'ty', 'tz', 'radius', 'theta', 'phi']) {
        this.orbit[key] = f.f0[key] + (f.f1[key] - f.f0[key]) * e;
      }
      if (k >= 1) { this.fly = null; f.done && f.done(); }
    },

    moveRobot(id, prog, done) {
      const r = AppData.getRack(id);
      if (!r) { done && done(false); return; }
      const tx = r.x, tz = r.z + AppData.RACK_FRONT;
      const edgeX = this.robotPos[0] <= tx ? 11 : -11;
      const pts = [
        this.robotPos.slice(),
        [edgeX, 0, this.robotPos[2]],
        [edgeX, 0, tz],
        [tx, 0, tz],
      ];
      const segs = []; let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
        if (d > 0.01) { segs.push({ a: pts[i - 1], b: pts[i], d }); total += d; }
      }
      // 零长度路径守卫：机器人已在目标位时直接完成，避免 segs[0] 取值崩溃
      if (!segs.length || total < 0.01) {
        this.robotPos = [tx, 0, tz];
        prog && prog(1);
        done && done(true);
        return;
      }
      this.moving = { segs, total, travelled: 0, speed: 6.2, prog, done };
    },
    updateMoving(dt) {
      const m = this.moving;
      if (!m) return;
      // 零长度路径守卫（防御 moveRobot 已过滤之外的异常状态）
      if (!m.segs.length || m.total < 0.01) {
        this.moving = null;
        m.prog && m.prog(1);
        m.done && m.done(true);
        return;
      }
      m.travelled += m.speed * dt;
      const p = Math.min(m.travelled / m.total, 1);
      let dist = p * m.total, pos = m.segs[0].a.slice(), head = m.segs[0].b;
      for (const s of m.segs) {
        if (dist <= s.d) {
          const k = dist / s.d;
          pos = [s.a[0] + (s.b[0] - s.a[0]) * k, 0, s.a[2] + (s.b[2] - s.a[2]) * k];
          head = s.b; break;
        }
        dist -= s.d; pos = s.b.slice(); head = s.b;
      }
      this.robotPos = pos.slice(); this.robotHead = head;
      m.prog && m.prog(p);
      this.orbit.tx += (pos[0] - this.orbit.tx) * 0.08;
      this.orbit.tz += (pos[2] - this.orbit.tz) * 0.08;
      if (p >= 1) { this.moving = null; m.done && m.done(true); }
    },

    render(dt, tSec) {
      const { ctx, canvas } = this;
      // 投影统一使用 CSS 像素（canvas._w/_h），与 ctx 的 dpr 变换配套，避免高 DPI 下放大偏移
      const w = canvas._w || canvas.clientWidth || 800;
      const h = canvas._h || canvas.clientHeight || 600;
      if (this.moving) this.updateMoving(dt);
      if (this.fly) this.updateFly(dt);
      this.cam.look(this.orbit.eye(), this.orbit.target());

      const fr = new Frame(); fr.cam = this.cam;
      // 地板
      fr.addBox([0, -0.03, 0], [30, 0.02, 20], '#071120', { ambient: 0.9 });
      // 网格线
      for (let x = -30; x <= 30; x += 2) fr.lines.push({ pts: [[x, 0, -20], [x, 0, 20]], color: 'rgba(16,70,96,0.5)' });
      for (let z = -20; z <= 20; z += 2) fr.lines.push({ pts: [[-30, 0, z], [30, 0, z]], color: 'rgba(16,60,84,0.5)' });

      // 机柜
      for (const r of AppData.racks) {
        const alarm = !!r.alarmType;
        fr.addBox([r.x, 1.3, r.z], [0.6, 1.3, 0.5],
          alarm ? '#7a1620' : '#12305a',
          { stroke: alarm ? '#ff5252' : '#1b8fb0', ambient: alarm ? 0.7 : 0.5 });
        // LED 条
        fr.addBox([r.x, 2.45, r.z + 0.5], [0.45, 0.03, 0.02],
          alarm ? '#ff4d4f' : '#28e0a4', { emissive: true });
        if (alarm) fr.addLabel([r.x, 3.2, r.z], '⚠ ' + r.temp + '℃', '#ff8080', 'rgba(50,8,12,0.75)');
      }

      // 高亮环
      for (const id of this.highlighted) {
        const r = AppData.getRack(id);
        if (r) fr.addRing([r.x, 0.06, r.z], 0.95, '#00e5ff');
      }

      // 机器人
      const rp = this.robotPos;
      fr.addBox([rp[0], 0.1, rp[2]], [0.3, 0.1, 0.3], '#0d3a4a', { stroke: '#16a8c0' });
      fr.addBox([rp[0], 0.62, rp[2]], [0.2, 0.32, 0.2], '#12b8c8');
      fr.addBox([rp[0], 1.12, rp[2]], [0.18, 0.18, 0.18], '#dffaff');
      fr.addLabel([rp[0], 1.6, rp[2]], '小维', '#00e5ff', 'rgba(4,16,28,0.8)');

      fr.draw(ctx, this.cam, w, h);
    },

    resize() { sizeCanvas(this.canvas); },
  };

  /* ---------------- 射线 vs AABB ---------------- */
  function rayBox(ray, c, h) {
    const lo = [c[0] - h[0], c[1] - h[1], c[2] - h[2]];
    const hi = [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
    let tmin = -Infinity, tmax = Infinity;
    for (let k = 0; k < 3; k++) {
      const o = ray.origin[k], d = ray.dir[k];
      if (Math.abs(d) < 1e-8) { if (o < lo[k] || o > hi[k]) return null; continue; }
      let t1 = (lo[k] - o) / d, t2 = (hi[k] - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    return Math.max(tmin, 0);
  }

  /* ============================================================
   * 设备检视（软件）
   * ============================================================ */
  const Inspect = {
    canvas: null, ctx: null, cam: null, orbit: null, rack: null,
    doorOpen: false, doorAngle: 0, leds: [],

    init(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.cam = new Camera(48);
      this.orbit = new Orbit([0, 1.3, 0], 3.6, Math.PI * 0.25, 1.18);
      bindDrag(canvas, this.orbit, () => {},
        { minPhi: 0.3, maxPhi: 1.5, minR: 2, maxR: 7 });
      this.resize();
    },
    load(rack) {
      this.rack = rack; this.doorOpen = false; this.doorAngle = 0;
      this.leds = [];
      for (let i = 0; i < 12; i++) this.leds.push({ phase: Math.random() * 6, hot: rack.alarmType && i === 8 });
    },
    toggleDoor() { this.doorOpen = !this.doorOpen; },

    render(dt, tSec) {
      const { ctx, canvas } = this;
      // 投影统一使用 CSS 像素（canvas._w/_h），与 ctx 的 dpr 变换配套，避免高 DPI 下放大偏移
      const w = canvas._w || canvas.clientWidth || 800;
      const h = canvas._h || canvas.clientHeight || 600;
      this.cam.look(this.orbit.eye(), this.orbit.target());
      const target = this.doorOpen ? -1.9 : 0;
      this.doorAngle += (target - this.doorAngle) * 0.14;

      const fr = new Frame(); fr.cam = this.cam;
      const W = 1.3, H = 2.7, D = 1.05;
      // 立柱
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        fr.addBox([(sx * W) / 2, H / 2, (sz * D) / 2], [0.035, H / 2, 0.035], '#1a3a5c', { stroke: '#2a6a90' });
      }
      fr.addBox([0, H, 0], [W / 2, 0.035, D / 2], '#1a3a5c');
      fr.addBox([0, 0.04, 0], [W / 2, 0.035, D / 2], '#1a3a5c');

      // 分层模块
      for (let i = 0; i < 12; i++) {
        const y = 0.25 + i * ((H - 0.5) / 12);
        const hot = this.rack.alarmType && i === 8;
        fr.addBox([0, y, 0], [(W - 0.16) / 2, 0.075, (D - 0.18) / 2],
          hot ? '#7a1620' : '#12263f', { ambient: hot ? 0.7 : 0.5 });
        fr.addBox([0, y, D / 2 - 0.06], [(W - 0.2) / 2, 0.065, 0.01], '#0c1c30');
        const on = Math.sin(tSec * 4 + this.leds[i].phase) > -0.2;
        if (on) fr.addBox([W / 2 - 0.18, y, D / 2 - 0.04], [0.015, 0.015, 0.01],
          hot ? '#ff4d4f' : '#28e0a4', { emissive: true });
      }

      // 柜门（摆动）
      const hinge = [-W / 2, 0, D / 2 + 0.02];
      const a = this.doorAngle;
      // 门相对铰链的局部点，绕 y 旋转
      const lx = W, ly = H - 0.12;
      const local = [[0, 0], [lx, 0], [lx, ly], [0, ly]];
      const doorPts = local.map(([u, v]) => {
        const rx = u * Math.cos(a);
        const rz = -u * Math.sin(a);
        return [hinge[0] + rx, v + 0.06, hinge[2] + rz];
      });
      const depth = doorPts.reduce((s, p) => s + V.dot(V.sub(p, this.cam.eye), this.cam.f), 0) / 4;
      fr.faces.push({ pts: doorPts, depth, fill: 'rgba(14,40,58,0.55)', stroke: '#1b8fb0' });
      // 把手
      const hx = (lx - 0.1) * Math.cos(a), hz = -(lx - 0.1) * Math.sin(a);
      fr.addBox([hinge[0] + hx, H / 2, hinge[2] + hz], [0.025, 0.2, 0.03], '#00e5ff', { emissive: true });

      fr.addLabel([0, H + 0.35, 0],
        this.rack.id + (this.rack.alarmType ? '  ⚠' : ''),
        this.rack.alarmType ? '#ff8080' : '#00e5ff', 'rgba(4,16,28,0.8)');

      fr.draw(ctx, this.cam, w, h);
    },
    resize() { sizeCanvas(this.canvas); },
  };

  function sizeCanvas(canvas) {
    const parent = canvas.parentElement;
    const w = parent.clientWidth || 800, h = parent.clientHeight || 600;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas._w = w; canvas._h = h;
  }

  /* ============================================================
   * 片头（软件）
   * ============================================================ */
  const Intro = {
    canvas: null, ctx: null, cam: null, running: false,
    init(canvas, onDone) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.cam = new Camera(55);
      this.boxes = [];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 11; c++) {
        this.boxes.push({
          c: [(c - 5) * 1.7, 1.2, (r - 3) * 2.4],
          h: [0.55, 1.2, 0.475],
          strip: Math.random() < 0.2 ? '#ffb547' : '#28e0a4',
        });
      }
      this.t0 = performance.now(); this.onDone = onDone;
      this.running = true; this.resize(); this.loop();
    },
    loop() {
      if (!this.running) return;
      const t = (performance.now() - this.t0) / 1000;
      const k = Math.min(t / 9, 1);
      const w = this.canvas._w || this.canvas.clientWidth;
      const h = this.canvas._h || this.canvas.clientHeight;
      this.cam.look([0, 26 - 18 * k, 34 - 27 * k], [0, 1.2, 0]);
      const fr = new Frame(); fr.cam = this.cam;
      fr.addBox([0, -0.02, 0], [12, 0.02, 9], '#071120', { ambient: 0.9 });
      for (const b of this.boxes) {
        fr.addBox(b.c, b.h, '#173863', { stroke: '#1b6f90', ambient: 0.6 });
        fr.addBox([b.c[0], 2.2, b.c[2] + 0.5], [0.4, 0.025, 0.015], b.strip, { emissive: true });
      }
      fr.draw(this.ctx, this.cam, w, h);
      if (t >= 9.4) { this.running = false; this.onDone && this.onDone(); return; }
      requestAnimationFrame(() => this.loop());
    },
    resize() {
      const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = w * dpr; this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.canvas._w = w; this.canvas._h = h;
    },
    stop() { this.running = false; },
  };

  /* ============================================================
   * 对外 Scene3D 兼容接口
   * ========================================================= */
  let view = null;
  let roomCanvas = null, inspectCanvas = null;
  let lastT = performance.now();

  function masterLoop() {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    if (view === 'room' && roomCanvas) Room.render(dt, now / 1000);
    else if (view === 'inspect' && inspectCanvas) Inspect.render(dt, now / 1000);
    requestAnimationFrame(masterLoop);
  }

  global.Soft3D = {
    startIntro(onDone) { Intro.init(document.getElementById('intro-canvas'), onDone); },
    stopIntro() { Intro.stop(); },

    initScenes() {
      const rc = document.createElement('canvas');
      document.getElementById('room-canvas').appendChild(rc);
      roomCanvas = rc; Room.init(rc);

      const ic = document.createElement('canvas');
      document.getElementById('inspect-canvas').appendChild(ic);
      inspectCanvas = ic; Inspect.init(ic);

      masterLoop();
    },
    setView(v) {
      view = v;
      if (v === 'room') Room.resize();
      if (v === 'inspect') Inspect.resize();
    },
    resizeActive() {
      if (view === 'room') Room.resize();
      if (view === 'inspect') Inspect.resize();
    },

    setRackClick(fn) { Room.onPick = fn; },
    focusRack(id, done) { Room.focusRack(id, done); },
    moveRobot(id, prog, done) { Room.moveRobot(id, prog, done); },
    highlight(id, on) {
      if (on) Room.highlighted.add(id); else Room.highlighted.delete(id);
    },
    refreshRack(id) { /* 每帧从 AppData 读取，自动同步 */ },

    loadInspect(rack) { Inspect.load(rack); },
    toggleDoor() { Inspect.toggleDoor(); },
  };
})(window);
