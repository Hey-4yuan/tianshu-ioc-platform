/* ============================================================
 * scene.js — Three.js 三维场景
 *  1) 片头镜头推进  2) 机房俯视+机器人巡检  3) 设备环绕检视
 *  自研轨道控制器（不依赖 examples/OrbitControls）
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 通用：文字 Sprite ---------- */
  function makeTextSprite(text, color, bg) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const fs = 44;
    ctx.font = `bold ${fs}px Microsoft YaHei`;
    const w = Math.ceil(ctx.measureText(text).width) + 28;
    cv.width = w; cv.height = fs + 22;
    ctx.font = `bold ${fs}px Microsoft YaHei`;
    if (bg) {
      ctx.fillStyle = bg;
      roundRect(ctx, 0, 0, cv.width, cv.height, 10);
      ctx.fill();
    }
    ctx.fillStyle = color || '#00e5ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cv.width / 2, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(mat);
    const scale = 0.0085;
    sp.scale.set(cv.width * scale, cv.height * scale, 1);
    return sp;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- 释放对象树的几何体/材质/贴图（防止重建时泄漏） ---------- */
  function disposeObject3D(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (m.map) m.map.dispose(); // Sprite 贴图
        m.dispose();
      }
    });
  }

  /* ---------- 自研球面轨道控制 ---------- */
  function OrbitState(target, radius, theta, phi) {
    this.target = target.clone();
    this.radius = radius; this.theta = theta; this.phi = phi;
    this.minR = 2.2; this.maxR = 40;
    this.minPhi = 0.12; this.maxPhi = 1.45;
  }
  OrbitState.prototype.apply = function (cam) {
    const x = this.target.x + this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    const y = this.target.y + this.radius * Math.cos(this.phi);
    const z = this.target.z + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    cam.position.set(x, y, z);
    cam.lookAt(this.target);
  };

  function bindDrag(dom, orbit, opts) {
    opts = opts || {};
    let dragging = false, sx = 0, sy = 0, moved = 0;
    dom.addEventListener('pointerdown', (e) => {
      dragging = true; sx = e.clientX; sy = e.clientY; moved = 0;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      sx = e.clientX; sy = e.clientY;
      orbit.theta -= dx * 0.006;
      orbit.phi -= dy * 0.006;
      orbit.phi = Math.max(orbit.minPhi, Math.min(orbit.maxPhi, orbit.phi));
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      if (moved < 6 && opts.onClick) opts.onClick(e);
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      orbit.radius *= 1 + Math.sign(e.deltaY) * 0.09;
      orbit.radius = Math.max(orbit.minR, Math.min(orbit.maxR, orbit.radius));
    }, { passive: false });
  }

  /* ============================================================
   * 片头
   * ============================================================ */
  const Intro = {
    init(onDone) {
      const cv = document.getElementById('intro-canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x040b18);
      this.scene.fog = new THREE.Fog(0x040b18, 26, 82);
      this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
      this.camera.position.set(0, 26, 34);
      this.scene.add(new THREE.AmbientLight(0x6fa0d0, 1.15));
      const dir = new THREE.DirectionalLight(0xcfeaff, 1.25);
      dir.position.set(10, 24, 12); this.scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0x2f7fff, 0.5);
      dir2.position.set(-12, 12, -10); this.scene.add(dir2);

      // 简化机柜阵列
      const grp = new THREE.Group();
      const geo = new THREE.BoxGeometry(1.1, 2.4, 0.95);
      const mat = new THREE.MeshStandardMaterial({ color: 0x173863, emissive: 0x0a2747, metalness: 0.5, roughness: 0.55 });
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 11; c++) {
          const m = new THREE.Mesh(geo, mat);
          m.position.set((c - 5) * 1.7, 1.2, (r - 3) * 2.4);
          grp.add(m);
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.03),
            new THREE.MeshBasicMaterial({ color: Math.random() < 0.2 ? '#ffb547' : '#28e0a4' }));
          strip.position.set(m.position.x, 2.2, m.position.z + 0.5);
          grp.add(strip);
        }
      }
      const grid = new THREE.GridHelper(40, 40, 0x1686a8, 0x103c55);
      grid.position.y = -0.01;
      this.scene.add(grp, grid);
      this.t0 = performance.now();
      this.onDone = onDone;
      this.resize();
      this.running = true;
      this.loop();
    },
    loop() {
      if (!this.running) return;
      const t = (performance.now() - this.t0) / 1000;
      const k = Math.min(t / 9, 1);
      // 推进 + 下降
      this.camera.position.set(0, 26 - 18 * k, 34 - 27 * k);
      this.camera.lookAt(0, 1.2, 0);
      this.renderer.render(this.scene, this.camera);
      if (t >= 9.4) { this.running = false; this.onDone && this.onDone(); return; }
      requestAnimationFrame(() => this.loop());
    },
    resize() {
      const cv = this.renderer.domElement;
      const w = cv.clientWidth || innerWidth, h = cv.clientHeight || innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    },
    stop() { this.running = false; this.renderer.dispose(); },
  };

  /* ============================================================
   * 机房场景
   * ============================================================ */
  const Room = {
    init() {
      const wrap = document.getElementById('room-canvas');
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      wrap.appendChild(this.renderer.domElement);
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x050b16);
      this.scene.fog = new THREE.Fog(0x050b16, 30, 64);
      this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
      this.orbit = new OrbitState(new THREE.Vector3(0, 0, 0), 24, Math.PI * 0.25, 0.62);

      this.scene.add(new THREE.AmbientLight(0x4a7bb0, 0.75));
      const key = new THREE.DirectionalLight(0xbfe6ff, 0.9);
      key.position.set(12, 26, 10); this.scene.add(key);
      const fill = new THREE.DirectionalLight(0x2e6cff, 0.35);
      fill.position.set(-14, 10, -12); this.scene.add(fill);

      this.buildFloor();
      this.rackMeshes = [];
      this.rackGroups = {};
      this.buildRacks();
      this.buildRobot();

      bindDrag(this.renderer.domElement, this.orbit, {
        onClick: (e) => this.handleClick(e),
      });
      this.fly = null;
      this.resize();
    },

    buildFloor() {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 40),
        new THREE.MeshStandardMaterial({ color: 0x071120, roughness: 0.95, metalness: 0.1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      this.scene.add(floor);
      const grid = new THREE.GridHelper(60, 60, 0x0c4660, 0x0a2236);
      grid.position.y = 0;
      this.scene.add(grid);
    },

    /** 构建单柜组（独立几何体/材质，便于重建时整体释放；与 refreshRack 共用同一逻辑） */
    makeRackGroup(r) {
      const g = new THREE.Group();
      const alarm = !!r.alarmType;
      const bodyGeo = new THREE.BoxGeometry(1.2, 2.6, 1.0);
      const mat = new THREE.MeshStandardMaterial({
        color: alarm ? 0x3a1018 : 0x10264a,
        emissive: alarm ? 0x5a0a10 : 0x071a30,
        metalness: 0.45, roughness: 0.55,
      });
      const body = new THREE.Mesh(bodyGeo, mat);
      body.position.y = 1.3;
      body.userData.rackId = r.id;
      g.add(body);

      // 正面青色描边
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo),
        new THREE.LineBasicMaterial({ color: alarm ? 0xff5252 : 0x1b8fb0 }));
      edges.position.y = 1.3;
      g.add(edges);

      // 正面 LED 条
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.06, 0.02),
        new THREE.MeshBasicMaterial({ color: alarm ? 0xff4d4f : 0x28e0a4 })
      );
      led.position.set(0, 2.45, 0.51);
      g.add(led);

      if (alarm) {
        // 红色辉光 Sprite + 温度标签
        const glow = makeTextSprite('⚠ ' + r.temp + '℃', '#ff6b6b', 'rgba(60,8,12,0.7)');
        glow.position.set(0, 3.3, 0);
        g.add(glow);
        const pl = new THREE.PointLight(0xff3b3b, 0.9, 5);
        pl.position.set(0, 1.6, 0.6);
        g.add(pl);
      }

      g.position.set(r.x, 0, r.z);
      return { grp: g, body };
    },

    buildRacks() {
      for (const r of AppData.racks) {
        const built = this.makeRackGroup(r);
        this.scene.add(built.grp);
        this.rackGroups[r.id] = built.grp;
        this.rackMeshes.push(built.body);
      }
    },

    refreshRack(rackId) {
      // 数据变更后重建该柜外观（解除告警等）：
      // 1) 先 dispose 旧组的几何体/材质/贴图，防止内存泄漏
      // 2) 重建走 makeRackGroup，与初始构建一致（含告警辉光 Sprite / 点光）
      // 3) 保留选中环（高亮）状态
      const grp = this.rackGroups[rackId];
      if (!grp) return;
      const selected = !!grp.getObjectByName('sel-ring');
      this.scene.remove(grp);
      disposeObject3D(grp);
      delete this.rackGroups[rackId];
      this.rackMeshes = this.rackMeshes.filter((m) => m.userData.rackId !== rackId);
      const r = AppData.getRack(rackId);
      if (!r) return;
      const built = this.makeRackGroup(r);
      this.scene.add(built.grp);
      this.rackGroups[r.id] = built.grp;
      this.rackMeshes.push(built.body);
      if (selected) this.highlight(rackId, true);
    },

    buildRobot() {
      const rob = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.18, 18),
        new THREE.MeshStandardMaterial({ color: 0x0d3a4a, metalness: 0.6, roughness: 0.4 }));
      base.position.y = 0.1; rob.add(base);
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x12b8c8, emissive: 0x06505c, metalness: 0.3, roughness: 0.5 }));
      torso.position.y = 0.62; rob.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 18),
        new THREE.MeshStandardMaterial({ color: 0xdffaff, emissive: 0x2a8a99, metalness: 0.2, roughness: 0.4 }));
      head.position.y = 1.12; rob.add(head);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.03),
        new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
      eye.position.set(0, 1.14, 0.17); rob.add(eye);
      const name = makeTextSprite('小维', '#00e5ff', 'rgba(4,16,28,0.75)');
      name.position.set(0, 1.62, 0); rob.add(name);
      this.scene.add(rob);
      this.robot = rob;
      this.robotPos = new THREE.Vector3(-9.6, 0, -6.85);
      rob.position.copy(this.robotPos);
    },

    /** 规划巡检路径：经 x=11 外围通道到目标柜前 */
    planPath(tx, tz) {
      const sx = this.robotPos.x, sz = this.robotPos.z;
      const edgeX = sx <= tx ? 11 : -11;
      return [
        new THREE.Vector3(edgeX, 0, sz),
        new THREE.Vector3(edgeX, 0, tz),
        new THREE.Vector3(tx, 0, tz),
      ];
    },

    /** 移动机器人；onProgress(p), onDone() */
    moveTo(rackId, onProgress, onDone) {
      const r = AppData.getRack(rackId);
      if (!r) { onDone && onDone(false); return; }
      const tx = r.x, tz = r.z + AppData.RACK_FRONT;
      const pts = [this.robotPos.clone(), ...this.planPath(tx, tz)];
      // 累计长度
      const segs = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = pts[i].distanceTo(pts[i - 1]);
        if (d > 0.01) { segs.push({ a: pts[i - 1], b: pts[i], d }); total += d; }
      }
      // 零长度路径守卫：机器人已在目标位时直接完成，避免 segs[0] 取值崩溃
      if (!segs.length || total < 0.01) {
        this.robotPos.set(tx, 0, tz);
        this.robot.position.set(tx, 0, tz);
        onProgress && onProgress(1);
        onDone && onDone(true);
        return;
      }
      const speed = 6.2;
      let travelled = 0;
      this.moving = { segs, total, travelled, speed, onProgress, onDone, rackId };
    },

    updateMoving(dt) {
      const m = this.moving;
      if (!m) return;
      // 零长度路径守卫（防御 moveTo 已过滤之外的异常状态）
      if (!m.segs.length || m.total < 0.01) {
        this.moving = null;
        m.onProgress && m.onProgress(1);
        m.onDone && m.onDone(true);
        return;
      }
      m.travelled += m.speed * dt;
      const p = Math.min(m.travelled / m.total, 1);
      // 求位置
      let dist = p * m.total;
      let pos = m.segs[0].a.clone(), head = m.segs[0].b;
      for (const s of m.segs) {
        if (dist <= s.d) {
          pos = s.a.clone().lerp(s.b, dist / s.d); head = s.b; break;
        }
        dist -= s.d; pos = s.b.clone(); head = s.b;
      }
      this.robotPos.copy(pos);
      this.robot.position.set(pos.x, 0, pos.z);
      this.robot.lookAt(head.x, 0, head.z);
      m.onProgress && m.onProgress(p);
      // 镜头跟随
      this.orbit.target.lerp(new THREE.Vector3(pos.x, 0, pos.z), 0.08);
      if (p >= 1) {
        this.moving = null;
        m.onDone && m.onDone(true);
      }
    },

    /** 飞行聚焦到机柜：全程驱动球面轨道参数（与 soft3d 一致），避免结束后镜头弹回 */
    focusRack(rackId, onDone) {
      const r = AppData.getRack(rackId);
      if (!r) { onDone && onDone(); return; }
      const targetPos = new THREE.Vector3(r.x, 1.3, r.z);
      // 相机停在柜前
      const camDesired = new THREE.Vector3(r.x, 1.7, r.z + 4.2);
      // 由期望机位反解球面参数（target / 方位角 / 俯仰角 / 距离）
      const rel = camDesired.clone().sub(targetPos);
      const radius = rel.length() || 1;
      let dTheta = Math.atan2(rel.z, rel.x) - this.orbit.theta;
      dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta)); // 方位角走最短弧
      this.fly = {
        t: 0, dur: 1.1,
        f0: {
          tx: this.orbit.target.x, ty: this.orbit.target.y, tz: this.orbit.target.z,
          radius: this.orbit.radius, theta: this.orbit.theta, phi: this.orbit.phi,
        },
        f1: {
          tx: targetPos.x, ty: targetPos.y, tz: targetPos.z,
          radius,
          theta: this.orbit.theta + dTheta,
          phi: Math.acos(Math.max(-1, Math.min(1, rel.y / radius))),
        },
        onDone,
      };
    },
    updateFly(dt) {
      if (!this.fly) return;
      const f = this.fly;
      f.t += dt / f.dur;
      const k = Math.min(f.t, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      // 同步球面轨道参数，相机位置由 render 中 orbit.apply 统一推导
      const o = this.orbit;
      o.target.set(
        f.f0.tx + (f.f1.tx - f.f0.tx) * e,
        f.f0.ty + (f.f1.ty - f.f0.ty) * e,
        f.f0.tz + (f.f1.tz - f.f0.tz) * e
      );
      o.radius = f.f0.radius + (f.f1.radius - f.f0.radius) * e;
      o.theta = f.f0.theta + (f.f1.theta - f.f0.theta) * e;
      o.phi = f.f0.phi + (f.f1.phi - f.f0.phi) * e;
      if (k >= 1) { this.fly = null; f.onDone && f.onDone(); }
    },

    handleClick(e) {
      const ray = new THREE.Raycaster();
      const rect = this.renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      const hits = ray.intersectObjects(this.rackMeshes, false);
      if (hits.length) {
        const id = hits[0].object.userData.rackId;
        this.onRackClick && this.onRackClick(id, e.clientX - rect.left, e.clientY - rect.top);
      }
    },

    highlight(rackId, on) {
      const g = this.rackGroups[rackId];
      if (!g) return;
      let ring = g.getObjectByName('sel-ring');
      if (on && !ring) {
        ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 32),
          new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
        ring.name = 'sel-ring'; ring.rotation.x = Math.PI / 2; ring.position.y = 0.06;
        g.add(ring);
      } else if (!on && ring) g.remove(ring);
    },

    resize() {
      const wrap = document.getElementById('room-canvas');
      const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    },
    render(dt) {
      if (this.moving) this.updateMoving(dt);
      if (this.fly) this.updateFly(dt);
      // 每帧同步相机到轨道状态：机器人移动中平滑跟随、飞行中平滑推进，无结束瞬间跳变
      this.orbit.apply(this.camera);
      this.renderer.render(this.scene, this.camera);
    },
  };

  /* ============================================================
   * 设备检视场景
   * ============================================================ */
  const Inspect = {
    init() {
      const wrap = document.getElementById('inspect-canvas');
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      wrap.appendChild(this.renderer.domElement);
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x050b16);
      this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
      this.orbit = new OrbitState(new THREE.Vector3(0, 1.3, 0), 3.6, Math.PI * 0.25, 1.18);
      this.orbit.minR = 2.0; this.orbit.maxR = 7; this.orbit.maxPhi = 1.5;
      this.scene.add(new THREE.AmbientLight(0x6090c0, 0.85));
      const key = new THREE.DirectionalLight(0xcfeaff, 1.0);
      key.position.set(5, 8, 6); this.scene.add(key);
      const rim = new THREE.DirectionalLight(0x2e6cff, 0.5);
      rim.position.set(-6, 4, -5); this.scene.add(rim);
      bindDrag(this.renderer.domElement, this.orbit);
      this.leds = [];
      this.resize();
    },

    load(rack) {
      this.rack = rack;
      // 重建前释放旧组几何体/材质/贴图，防止泄漏
      if (this.rackGroup) {
        this.scene.remove(this.rackGroup);
        disposeObject3D(this.rackGroup);
      }
      this.leds = [];
      const g = new THREE.Group();
      const W = 1.3, H = 2.7, D = 1.05;
      const alarm = !!rack.alarmType;

      // 框架
      const postMat = new THREE.MeshStandardMaterial({ color: 0x1a3a5c, metalness: 0.7, roughness: 0.35 });
      const postGeo = new THREE.BoxGeometry(0.07, H, 0.07);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set((sx * W) / 2, H / 2, (sz * D) / 2); g.add(p);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), postMat);
      top.position.y = H; g.add(top);
      const bot = new THREE.Mesh(new THREE.BoxGeometry(W, 0.07, D), postMat);
      bot.position.y = 0.04; g.add(bot);

      // 柜内分层服务器模块
      const layers = 12;
      for (let i = 0; i < layers; i++) {
        const y = 0.25 + i * ((H - 0.5) / layers);
        const sMat = new THREE.MeshStandardMaterial({
          color: 0x12263f, emissive: alarm && i === 8 ? 0x3a0a10 : 0x05131f,
          metalness: 0.5, roughness: 0.6,
        });
        const srv = new THREE.Mesh(new THREE.BoxGeometry(W - 0.16, 0.15, D - 0.18), sMat);
        srv.position.y = y; g.add(srv);
        // 前面板
        const face = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.13, 0.02),
          new THREE.MeshStandardMaterial({ color: 0x0c1c30, metalness: 0.4, roughness: 0.7 }));
        face.position.set(0, y, D / 2 - 0.06); g.add(face);
        // LED
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02),
          new THREE.MeshBasicMaterial({ color: alarm && i === 8 ? 0xff4d4f : 0x28e0a4 }));
        led.position.set(W / 2 - 0.18, y, D / 2 - 0.04);
        g.add(led); this.leds.push({ m: led, phase: Math.random() * 6 });
      }

      // 柜门（左铰链，pivot）
      this.doorPivot = new THREE.Group();
      this.doorPivot.position.set(-W / 2, 0, D / 2 + 0.02);
      const door = new THREE.Mesh(new THREE.BoxGeometry(W, H - 0.12, 0.04),
        new THREE.MeshStandardMaterial({
          color: 0x0a2030, transparent: true, opacity: 0.32,
          metalness: 0.3, roughness: 0.3, emissive: alarm ? 0x2a070a : 0x000000,
        }));
      door.position.set(W / 2, H / 2, 0);
      this.doorPivot.add(door);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x006677 }));
      handle.position.set(W - 0.1, H / 2, 0.03);
      this.doorPivot.add(handle);
      g.add(this.doorPivot);
      this.doorOpen = false; this.doorAngle = 0;

      // 顶部编号
      const tag = makeTextSprite(rack.id + (alarm ? '  ⚠' : ''), alarm ? '#ff6b6b' : '#00e5ff', 'rgba(4,16,28,0.7)');
      tag.position.set(0, H + 0.35, 0); g.add(tag);

      this.rackGroup = g;
      this.scene.add(g);
    },

    toggleDoor() {
      this.doorOpen = !this.doorOpen;
    },
    updateDoor() {
      if (!this.doorPivot) return;
      const target = this.doorOpen ? -1.9 : 0;
      this.doorAngle += (target - this.doorAngle) * 0.14;
      this.doorPivot.rotation.y = this.doorAngle;
    },

    resize() {
      const wrap = document.getElementById('inspect-canvas');
      const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    },
    render(dt, t) {
      this.updateDoor();
      // LED 闪烁
      for (const l of this.leds) {
        const on = Math.sin(t * 4 + l.phase) > -0.2;
        l.m.visible = on;
      }
      this.orbit.apply(this.camera);
      this.renderer.render(this.scene, this.camera);
    },
  };

  /* ============================================================
   * 主循环 & 对外接口
   * ============================================================ */
  let currentView = null;
  let lastT = performance.now();
  function masterLoop() {
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    if (currentView === 'room') Room.render(dt);
    else if (currentView === 'inspect') Inspect.render(dt, now / 1000);
    requestAnimationFrame(masterLoop);
  }

  global.Scene3D = {
    startIntro(onDone) { Intro.init(onDone); },
    stopIntro() { Intro.stop(); },

    initScenes() { Room.init(); Inspect.init(); masterLoop(); },
    setView(v) {
      currentView = v;
      if (v === 'room') Room.resize();
      if (v === 'inspect') Inspect.resize();
    },
    resizeActive() {
      if (currentView === 'room') Room.resize();
      if (currentView === 'inspect') Inspect.resize();
    },

    // 机房
    onRackClick: null,
    setRackClick(fn) { Room.onRackClick = fn; },
    focusRack(id, done) { Room.focusRack(id, done); },
    moveRobot(id, prog, done) { Room.moveTo(id, prog, done); },
    highlight(id, on) { Room.highlight(id, on); },
    refreshRack(id) { Room.refreshRack(id); },
    // 检视
    loadInspect(rack) { Inspect.load(rack); },
    toggleDoor() { Inspect.toggleDoor(); },
  };

  // WebGL 能力检测（结果缓存，只探测一次；探测用上下文立即释放）
  // 不可用（沙箱禁用 GPU）时自动切换到 Canvas2D 软件渲染兜底
  let webglOk = null;
  function webglAvailable() {
    if (webglOk !== null) return webglOk;
    let ok = false;
    try {
      const c = document.createElement('canvas');
      const gl =
        window.WebGLRenderingContext &&
        (c.getContext('webgl') || c.getContext('experimental-webgl'));
      ok = !!gl;
      if (gl) {
        const lose = gl.getExtension && gl.getExtension('WEBGL_lose_context');
        if (lose && lose.loseContext) lose.loseContext(); // 释放探测用上下文
      }
    } catch (e) { ok = false; }
    webglOk = ok;
    return ok;
  }

  /* 极端兜底：THREE 与 Soft3D 均不可用时提供空实现，保证调用方不抛错 */
  function createNoopScene3D() {
    const warn = () => console.warn('[scene] 三维渲染不可用（THREE 与 Soft3D 均未加载）');
    return {
      startIntro(onDone) { warn(); onDone && onDone(); },
      stopIntro() {},
      initScenes() { warn(); },
      setView() {},
      resizeActive() {},
      setRackClick() {},
      focusRack(id, done) { done && done(); },
      moveRobot(id, prog, done) { done && done(false); },
      highlight() {},
      refreshRack() {},
      loadInspect() {},
      toggleDoor() {},
    };
  }

  const RealScene3D = global.Scene3D;
  // THREE 缺失/加载失败时同样回退软件渲染，不向外抛错
  const threeOk = typeof global.THREE !== 'undefined' && !!global.THREE.Scene;
  const useThree = threeOk && webglAvailable();
  global.Scene3D = useThree ? RealScene3D : (global.Soft3D || createNoopScene3D());
  global.Scene3DRenderer = useThree ? 'three' : 'software';
})(window);
