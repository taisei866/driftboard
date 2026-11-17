/* 今夜の星空（プラネタリウム） */
(() => {
  const BODIES = [["Moon", "月", "#f4efd8"], ["Mercury", "水星", "#cdbca8"], ["Venus", "金星", "#fff2c2"], ["Mars", "火星", "#ff8a5c"],
    ["Jupiter", "木星", "#f3d9a8"], ["Saturn", "土星", "#ead79c"], ["Uranus", "天王星", "#9fe0e6"], ["Neptune", "海王星", "#8aa4ff"]];
  const BV = [[-0.4, [155, 176, 255]], [0, [202, 215, 255]], [0.4, [248, 247, 255]], [0.8, [255, 244, 234]], [1.2, [255, 210, 161]], [1.6, [255, 173, 81]], [2.0, [255, 142, 58]]];
  const LAYERS = [["lines", "星座線"], ["cname", "星座名"], ["sname", "星名"], ["mw", "天の川"], ["grid", "方位網"]];
  const SPEED = 15; // 早送り：実時間1秒あたりのシミュレーション分数（=4秒で1時間）

  let cv, g, base, bctx, H, OBS, visible = false, sky, st, offMin = 0, ff = false, sel = null, satrec = null;
  let facing = Store.get("skFace", 180), layers = Store.get("skLayers", { lines: true, cname: true, sname: true, mw: true, grid: true });
  let ambRot = false, W = 0, Hh = 0, R = 0, cx = 0, cy = 0, dpr = 1, baseKey = "", objs = [], twk = [], lastFrame = 0, lastSide = 0, sunInfo = { alt: -90 };

  const simDate = () => new Date(Date.now() + offMin * 60000);
  const bvColor = bv => {
    bv = Math.max(-0.4, Math.min(2, bv));
    for (let i = 1; i < BV.length; i++) if (bv <= BV[i][0]) {
      const [a, ca] = BV[i - 1], [b, cb] = BV[i], t = (bv - a) / (b - a);
      return ca.map((v, j) => Math.round(v + (cb[j] - v) * t));
    }
    return BV[BV.length - 1][1];
  };

  /* ---------- 初期化 ---------- */
  async function init() {
    H = App.home;
    OBS = new Astronomy.Observer(H.lat, H.lon, 30);
    sp = Math.sin(H.lat * D2R); cp = Math.cos(H.lat * D2R);
    cv = $("#sky"); g = cv.getContext("2d");
    base = document.createElement("canvas"); bctx = base.getContext("2d");
    $("#sk-layers").innerHTML = LAYERS.map(([k, l]) => `<button class="chip" data-l="${k}">${l}</button>`).join("");
    $("#sk-layers").onclick = e => { const b = e.target.closest("[data-l]"); if (!b) return; layers[b.dataset.l] = !layers[b.dataset.l]; Store.set("skLayers", layers); syncChips(); baseKey = ""; };
    syncChips();
    $$("#sk-dirs [data-f]").forEach(b => b.onclick = () => turnTo(+b.dataset.f));
    syncDirs();
    const sl = $("#sk-slider");
    sl.oninput = () => { ff = false; offMin = +sl.value; syncTime(); };
    $("#sk-now").onclick = () => { ff = false; offMin = 0; syncTime(); };
    $("#sk-ff").onclick = () => { ff = !ff; syncTime(); };
    bindPointer();
    addEventListener("resize", () => { baseKey = ""; });

    try {
      sky = await (await fetch("data/sky.json")).json();
    } catch { toast("星のデータを読み込めませんでした"); return; }
    const n = sky.stars.length;
    st = { ra: new Float32Array(n), sd: new Float32Array(n), cd: new Float32Array(n), mag: new Float32Array(n), col: [], ni: sky.stars.map(s => s[4]) };
    sky.stars.forEach((s, i) => {
      st.ra[i] = s[0] * D2R; st.sd[i] = Math.sin(s[1] * D2R); st.cd[i] = Math.cos(s[1] * D2R); st.mag[i] = s[2];
      st.col.push(bvColor(s[3]));
    });
    api("/api/tle").then(t => { satrec = satellite.twoline2satrec(t.l1, t.l2); }).catch(() => {});
    syncTime();
    requestAnimationFrame(frame);
  }

  function syncChips() { $$("#sk-layers .chip").forEach(b => b.classList.toggle("on", !!layers[b.dataset.l])); }
  function syncTime() {
    $("#sk-slider").value = Math.max(-720, Math.min(720, offMin));
    $("#sk-ff").innerHTML = ff ? ic("i-pause") + "<span>止める</span>" : ic("i-ff") + "<span>早送り</span>";
    $("#sk-ff").classList.toggle("on", ff);
    $("#sk-now").classList.toggle("on", offMin === 0 && !ff);
    lastSide = 0;
  }

  function syncDirs() { $$("#sk-dirs [data-f]").forEach(b => b.classList.toggle("on", Math.abs(((facing - +b.dataset.f + 540) % 360) - 180) < 23)); }
  let turnAnim;
  function turnTo(f) {
    cancelAnimationFrame(turnAnim);
    const from = facing, d = ((f - from + 540) % 360) - 180, t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / 500), e = k * k * (3 - 2 * k); facing = (from + d * e + 360) % 360; if (k < 1) turnAnim = requestAnimationFrame(step); else { turnAnim = null; Store.set("skFace", facing); syncDirs(); } };
    turnAnim = requestAnimationFrame(step);
  }

  /* ---------- 座標変換 ---------- */
  function lst(date) { return (Astronomy.SiderealTime(date) * 15 + H.lon) * D2R; }
  let sp = 0, cp = 1;
  function altaz(raR, sd, cd, L) {
    const ha = L - raR, ch = Math.cos(ha);
    const sa = sp * sd + cp * cd * ch;
    const az = Math.atan2(-cd * Math.sin(ha), sd * cp - cd * ch * sp);
    return [Math.asin(Math.max(-1, Math.min(1, sa))) * R2D, (az * R2D + 360) % 360];
  }
  function proj(alt, az) {
    const z = (90 - Math.max(alt, -85)) * D2R / 2, r = R * Math.tan(z), rel = (az - facing) * D2R;
    return [cx + r * Math.sin(rel), cy + r * Math.cos(rel), r];
  }
  function bodyAltAz(body, date) {
    const e = Astronomy.Equator(body, date, OBS, true, true), h = Astronomy.Horizon(date, OBS, e.ra, e.dec, "normal");
    return { alt: h.altitude, az: h.azimuth, dist: e.dist };
  }

  /* ---------- 描画 ---------- */
  function layout() {
    dpr = devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return false;
    if (w !== W || h !== Hh) {
      W = w; Hh = h;
      cv.width = base.width = Math.round(W * dpr); cv.height = base.height = Math.round(Hh * dpr);
      baseKey = "";
    }
    const bar = 50; R = Math.min(W, Hh - bar) / 2 - 22; cx = W / 2; cy = (Hh - bar) / 2 + 2;
    return true;
  }

  function drawBase(date) {
    const c = bctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, Hh);
    const sun = bodyAltAz("Sun", date); sunInfo = sun;
    const dk = Math.max(0.12, Math.min(1, (-sun.alt - 2) / 14)); // 空の暗さ（1=真っ暗）
    const L = lst(date), sc = R / 380;

    // 空の色
    const day = Math.max(0, Math.min(1, (sun.alt + 10) / 16));
    const top = mix([3, 5, 14], [44, 104, 170], day), edge = mix([10, 18, 42], [120, 170, 215], day);
    const bg = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, `rgb(${top})`); bg.addColorStop(1, `rgb(${edge})`);
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fillStyle = bg; c.fill(); c.clip();

    // 太陽方向の地平線の残照
    if (sun.alt > -18) {
      const [sx, sy] = proj(sun.alt, sun.az), a = Math.max(0, 1 - Math.abs(sun.alt + 3) / 15);
      const gl = c.createRadialGradient(sx, sy, 0, sx, sy, R * 1.1);
      gl.addColorStop(0, `rgba(255,150,80,${.55 * a})`); gl.addColorStop(.5, `rgba(255,120,90,${.18 * a})`); gl.addColorStop(1, "rgba(255,120,90,0)");
      c.fillStyle = gl; c.fillRect(0, 0, W, Hh);
    }

    // 天の川
    if (layers.mw) {
      c.globalCompositeOperation = "lighter";
      sky.mw.forEach((polys, li) => {
        c.fillStyle = `rgba(190,205,255,${[.03, .035, .045, .06][li] * dk})`;
        polys.forEach(poly => {
          c.beginPath();
          poly.forEach(([ra, de], i) => {
            const d = de * D2R, [al, az] = altaz(ra * D2R, Math.sin(d), Math.cos(d), L), [x, y] = proj(al, az);
            i ? c.lineTo(x, y) : c.moveTo(x, y);
          });
          c.fill();
        });
      });
      c.globalCompositeOperation = "source-over";
    }

    // 方位網
    if (layers.grid) {
      c.strokeStyle = "rgba(140,170,220,.14)"; c.lineWidth = 1;
      [30, 60].forEach(a => { const [, , r] = proj(a, 0); c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke(); });
      for (let az = 0; az < 360; az += 45) { const [x, y] = proj(0, az); c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); }
    }

    // 星座線
    if (layers.lines) {
      c.strokeStyle = `rgba(110,160,255,${.38 * dk + .05})`; c.lineWidth = 1;
      for (const k in sky.con) (sky.con[k].lines || []).forEach(seg => {
        c.beginPath();
        seg.forEach(([ra, de], i) => {
          const d = de * D2R, [al, az] = altaz(ra * D2R, Math.sin(d), Math.cos(d), L), [x, y] = proj(al, az);
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        });
        c.stroke();
      });
    }

    // 恒星
    objs = []; twk = [];
    const lim = 6.2 - (1 - dk) * 4.5; // 明るい空では暗い星を省く
    for (let i = 0; i < st.mag.length; i++) {
      const m = st.mag[i]; if (m > lim) continue;
      const [al, az] = altaz(st.ra[i], st.sd[i], st.cd[i], L);
      if (al < -1) continue;
      const [x, y] = proj(al, az), col = st.col[i];
      const rad = Math.max(.55, (2.9 - m * .46)) * sc;
      const a = Math.min(1, (lim - m) / 2.2 + .25) * (al < 4 ? .55 + al / 9 : 1);
      if (m < 1.8) {
        const gl = c.createRadialGradient(x, y, 0, x, y, rad * 4);
        gl.addColorStop(0, `rgba(${col},${.45 * a})`); gl.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = gl; c.beginPath(); c.arc(x, y, rad * 4, 0, 7); c.fill();
        twk.push([x, y, rad, col]);
      }
      c.fillStyle = `rgba(${col},${a})`; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill();
      const ni = st.ni[i];
      if (ni >= 0 && m < 3.6) objs.push({ kind: "star", x, y, i, ni, alt: al, az, mag: m });
    }

    // 星座名
    if (layers.cname) {
      c.font = `${Math.max(10, 12 * sc)}px system-ui,sans-serif`; c.textAlign = "center"; c.fillStyle = `rgba(150,185,255,${.5 * dk + .15})`;
      for (const k in sky.con) {
        const cn = sky.con[k], d = cn.pos[1] * D2R, [al, az] = altaz(cn.pos[0] * D2R, Math.sin(d), Math.cos(d), L);
        if (al > 6 && (cn.rank <= 2 || sc > 1.1)) { const [x, y] = proj(al, az); c.fillText(cn.ja, x, y); }
      }
    }
    // 星名
    if (layers.sname) {
      c.font = `600 ${Math.max(10, 11.5 * sc)}px system-ui,sans-serif`; c.textAlign = "left"; c.fillStyle = "rgba(255,236,200,.85)";
      const boxes = [];
      objs.filter(o => o.mag < 1.6 && o.alt > 3).sort((a, b) => a.mag - b.mag).forEach(o => {
        const t = sky.names[o.ni][0], w = c.measureText(t).width, x = o.x + 6, y = o.y - 5, bx = [x, y - 12, w, 14];
        if (boxes.some(b => bx[0] < b[0] + b[2] && bx[0] + bx[2] > b[0] && bx[1] < b[1] + b[3] && bx[1] + bx[3] > b[1])) return;
        boxes.push(bx); c.fillText(t, x, y);
      });
    }
    c.restore();

    // 地平線と方角
    c.strokeStyle = "rgba(149,154,163,.45)"; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    c.textAlign = "center"; c.textBaseline = "middle";
    ["北", "北東", "東", "南東", "南", "南西", "西", "北西"].forEach((n, i) => {
      const rel = (i * 45 - facing) * D2R, big = i % 2 === 0;
      c.font = `${big ? 700 : 400} ${big ? 15 : 11}px system-ui,sans-serif`;
      c.fillStyle = n === "北" ? "#e6b04a" : big ? "#ebe8e1" : "#646a74";
      c.fillText(n, cx + (R + 12) * Math.sin(rel), cy + (R + 12) * Math.cos(rel));
    });
    c.textBaseline = "alphabetic";
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  function drawMoon(c, x, y, r, phaseDeg, toSun) {
    const p = phaseDeg / 360, k = Math.cos(2 * Math.PI * p);
    c.save(); c.translate(x, y); c.rotate(toSun);
    const gl = c.createRadialGradient(0, 0, r, 0, 0, r * 3.2);
    gl.addColorStop(0, `rgba(255,248,220,${.35 * (1 - k) / 2})`); gl.addColorStop(1, "rgba(255,248,220,0)");
    c.fillStyle = gl; c.beginPath(); c.arc(0, 0, r * 3.2, 0, 7); c.fill();
    c.fillStyle = "#2a2e38"; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
    c.fillStyle = "#f6f0da"; c.beginPath();
    c.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    if (k > 0) c.ellipse(0, 0, r * k, r, 0, Math.PI / 2, -Math.PI / 2, true);
    else c.ellipse(0, 0, -r * k, r, 0, Math.PI / 2, Math.PI * 1.5, false);
    c.fill(); c.restore();
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (!visible || !st) return;
    const interval = ff || dragging || turnAnim ? 50 : 120;
    if (t - lastFrame < interval) return;
    const dt = lastFrame ? Math.min(.2, (t - lastFrame) / 1000) : 0; lastFrame = t;
    if (ambRot && !dragging) facing = (facing + dt * 1.2) % 360;
    if (ff) { offMin += dt * SPEED; $("#sk-slider").value = Math.max(-720, Math.min(720, offMin)); }
    if (!layout()) return;
    const date = simDate();
    const key = [Math.round(date / (ff ? 1 : 20000)), facing.toFixed(2), W, Hh, JSON.stringify(layers)].join("|");
    if (key !== baseKey) { drawBase(date); baseKey = key; }

    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();

    // またたき
    g.globalCompositeOperation = "lighter";
    twk.forEach(([x, y, r, col]) => {
      const a = Math.random() * .35;
      g.fillStyle = `rgba(${col},${a})`; g.beginPath(); g.arc(x, y, r * (1.2 + Math.random() * .6), 0, 7); g.fill();
    });
    g.globalCompositeOperation = "source-over";

    // 太陽・月・惑星
    const sun = bodyAltAz("Sun", date), [sx, sy] = proj(sun.alt, sun.az), sc = R / 380;
    if (sun.alt > -1) {
      const gl = g.createRadialGradient(sx, sy, 0, sx, sy, 34 * sc);
      gl.addColorStop(0, "rgba(255,250,220,1)"); gl.addColorStop(.3, "rgba(255,220,120,.8)"); gl.addColorStop(1, "rgba(255,200,80,0)");
      g.fillStyle = gl; g.beginPath(); g.arc(sx, sy, 34 * sc, 0, 7); g.fill();
    }
    const bodies = [];
    BODIES.forEach(([b, ja, col]) => {
      const p = bodyAltAz(b, date); if (p.alt < -1) return;
      const [x, y] = proj(p.alt, p.az);
      if (b === "Moon") drawMoon(g, x, y, 9 * sc + 3, Astronomy.MoonPhase(date), Math.atan2(sy - y, sx - x));
      else {
        const mag = Astronomy.Illumination(b, date).mag, r = Math.max(1.6, (3.4 - mag * .45)) * sc + .6;
        const gl = g.createRadialGradient(x, y, 0, x, y, r * 4);
        gl.addColorStop(0, col); gl.addColorStop(.3, col + "88"); gl.addColorStop(1, col + "00");
        g.fillStyle = gl; g.beginPath(); g.arc(x, y, r * 4, 0, 7); g.fill();
        g.fillStyle = "#fff"; g.beginPath(); g.arc(x, y, r * .7, 0, 7); g.fill();
      }
      g.font = `700 ${Math.max(11, 13 * sc)}px system-ui,sans-serif`; g.fillStyle = col; g.textAlign = "left";
      g.fillText(ja, x + 9 * sc + 6, y + 4);
      bodies.push({ kind: "body", b, ja, x, y, alt: p.alt, az: p.az, dist: p.dist });
    });

    // ISS
    if (satrec) {
      const pv = satellite.propagate(satrec, date);
      if (pv && pv.position) {
        const gm = satellite.gstime(date), la = satellite.ecfToLookAngles({ longitude: H.lon * D2R, latitude: H.lat * D2R, height: .03 }, satellite.eciToEcf(pv.position, gm));
        const al = la.elevation * R2D, az = la.azimuth * R2D;
        if (al > 0) {
          const [x, y] = proj(al, az);
          g.fillStyle = "#fff"; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
          g.strokeStyle = "#e6b04a"; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
          g.fillStyle = "#e6b04a"; g.font = "700 12px system-ui,sans-serif"; g.fillText("ISS", x + 12, y + 4);
          bodies.push({ kind: "iss", ja: "国際宇宙ステーション", x, y, alt: al, az });
        }
      }
    }
    // 選択
    const all = bodies.concat(objs);
    if (sel) {
      const o = all.find(o => o.kind === sel.kind && (o.b ? o.b === sel.b : o.i === sel.i));
      if (o) { g.strokeStyle = "#e6b04a"; g.lineWidth = 1.5; g.beginPath(); g.arc(o.x, o.y, 14, 0, 7); g.stroke(); sel.cur = o; }
    }
    g.restore();
    curObjs = all;

    $("#sk-when").innerHTML = `<b class="mono">${Fmt.md(date)} ${Fmt.hm(date)}</b>${offMin ? `<small class="muted">（${offMin > 0 ? "+" : "−"}${Fmt.dur(Math.abs(offMin) * 60)}）</small>` : ""}<br>` +
      `<small class="muted">${esc(H.name)}の空 ・ ${sun.alt > 0 ? "昼間（実際には星は見えません）" : sun.alt > -12 ? "薄明" : "夜"}</small>`;
    if (Date.now() - lastSide > (ff ? 1500 : 30000)) { lastSide = Date.now(); side(date); }
    if (sel && sel.cur) info(sel.cur, date);
  }

  /* ---------- 操作 ---------- */
  let dragging = false, curObjs = [];
  function bindPointer() {
    let sx = 0, sf = 0, moved = 0, id = null;
    cv.addEventListener("pointerdown", e => { id = e.pointerId; cv.setPointerCapture(id); dragging = true; sx = e.clientX; sf = facing; moved = 0; cancelAnimationFrame(turnAnim); turnAnim = null; });
    cv.addEventListener("pointermove", e => {
      if (!dragging || e.pointerId !== id) return;
      const dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx));
      facing = (sf + dx / R * 70 + 360) % 360;
    });
    const up = e => {
      if (!dragging) return; dragging = false; Store.set("skFace", facing); syncDirs();
      if (moved < 6) {
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        let best = null, bd = 26;
        curObjs.forEach(o => { const d = Math.hypot(o.x - x, o.y - y); if (d < bd) { bd = d; best = o; } });
        sel = best ? { kind: best.kind, b: best.b, i: best.i, cur: best } : null;
        if (!sel) $("#sk-sel").hidden = true;
      }
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  }

  function riseSet(body, date) {
    const r = Astronomy.SearchRiseSet(body, OBS, +1, date, 1.2), s = Astronomy.SearchRiseSet(body, OBS, -1, date, 1.2);
    return { rise: r && r.date, set: s && s.date };
  }

  function info(o, date) {
    const box = $("#sk-sel"); box.hidden = false;
    let h = "";
    if (o.kind === "star") {
      const n = sky.names[o.ni], cn = sky.con[n[2]];
      h = `<div class="sk-name">${esc(n[0])}</div><div class="muted small">${esc(n[1] && n[1] !== n[0] ? n[1] + " ・ " : "")}${esc(cn ? cn.ja : "")} ${esc(n[3] || "")}</div>
        <div class="fd-grid"><div><small>明るさ</small><b class="mono">${o.mag.toFixed(2)}等</b></div>
        <div><small>高度</small><b class="mono">${o.alt.toFixed(1)}°</b></div><div><small>方角</small><b>${Geo.dir16(o.az)}</b></div></div>`;
    } else if (o.kind === "iss") {
      h = `<div class="sk-name">${o.ja}</div><div class="fd-grid"><div><small>高度</small><b class="mono">${o.alt.toFixed(1)}°</b></div><div><small>方角</small><b>${Geo.dir16(o.az)}</b></div></div>`;
    } else {
      const rs = riseSet(o.b, date), mag = Astronomy.Illumination(o.b, date);
      const extra = o.b === "Moon" ? `<div><small>輝面比</small><b class="mono">${Math.round(mag.phase_fraction * 100)}%</b></div><div><small>距離</small><b class="mono">${Fmt.n(o.dist * 149597870.7)}km</b></div>`
        : `<div><small>明るさ</small><b class="mono">${mag.mag.toFixed(1)}等</b></div><div><small>距離</small><b class="mono">${o.dist.toFixed(2)}AU</b></div>`;
      h = `<div class="sk-name">${o.ja}</div><div class="fd-grid">${extra}
        <div><small>高度</small><b class="mono">${o.alt.toFixed(1)}°</b></div><div><small>方角</small><b>${Geo.dir16(o.az)}</b></div>
        <div><small>次の出</small><b class="mono">${rs.rise ? Fmt.hm(rs.rise) : "-"}</b></div><div><small>次の入り</small><b class="mono">${rs.set ? Fmt.hm(rs.set) : "-"}</b></div></div>`;
    }
    box.innerHTML = h + `<button class="btn sm" id="sk-x" style="margin-top:10px">${ic("i-x", "sm")}閉じる</button>`;
    $("#sk-x").onclick = () => { sel = null; box.hidden = true; };
  }

  /* ---------- 今夜の情報 ---------- */
  function side(date) {
    const sunNow = bodyAltAz("Sun", date);
    let ns = sunNow.alt < -12 ? date : (Astronomy.SearchAltitude("Sun", OBS, -1, date, 1, -12) || {}).date;
    let ne = ns && (Astronomy.SearchAltitude("Sun", OBS, +1, ns, 1, -12) || {}).date;
    const sset = (Astronomy.SearchRiseSet("Sun", OBS, -1, date, 1) || {}).date, srise = (Astronomy.SearchRiseSet("Sun", OBS, +1, date, 1) || {}).date;
    const ph = Astronomy.MoonPhase(date), ill = Astronomy.Illumination("Moon", date).phase_fraction, mrs = riseSet("Moon", date);
    const moonNow = bodyAltAz("Moon", date);
    const phName = ph < 10 || ph > 350 ? "新月" : ph < 80 ? "三日月〜" : ph < 100 ? "上弦" : ph < 170 ? "満ちていく月" : ph < 190 ? "満月" : ph < 260 ? "欠けていく月" : ph < 280 ? "下弦" : "有明月";
    $("#sk-tonight").innerHTML = `
      <div class="sk-kv"><span>日の入り</span><b class="mono">${sset ? Fmt.hm(sset) : "-"}</b></div>
      <div class="sk-kv"><span>星が見え始める（薄明終了）</span><b class="mono">${ns ? (ns === date ? "すでに暗い" : Fmt.hm(ns)) : "-"}</b></div>
      <div class="sk-kv"><span>空が明るくなり始める</span><b class="mono">${ne ? Fmt.hm(ne) : "-"}</b></div>
      <div class="sk-kv"><span>日の出</span><b class="mono">${srise ? Fmt.hm(srise) : "-"}</b></div>
      <div class="sk-kv"><span>月</span><b>${phName}（${Math.round(ill * 100)}%）</b></div>
      <div class="sk-kv"><span>月の出／入り</span><b class="mono">${mrs.rise ? Fmt.hm(mrs.rise) : "-"} ／ ${mrs.set ? Fmt.hm(mrs.set) : "-"}</b></div>
      <div class="note small">${ill > .7 && moonNow.alt > 0 ? "月明かりが強く、暗い星や天の川は見えにくい夜です。" : ill < .3 || moonNow.alt < 0 ? "月明かりが弱く、星空観察に向いています。" : "月明かりはそこそこ。明るい星や惑星は十分楽しめます。"}</div>`;

    // 惑星：今夜の見頃（暗い時間帯で最も高く昇る時刻）
    const rows = BODIES.slice(1).map(([b, ja, col]) => {
      const now = bodyAltAz(b, date), mag = Astronomy.Illumination(b, date).mag;
      let best = null;
      if (ns && ne) for (let t = +ns; t <= +ne; t += 20 * 60000) {
        const p = bodyAltAz(b, new Date(t)); if (!best || p.alt > best.alt) best = { alt: p.alt, az: p.az, t: new Date(t) };
      }
      const good = best && best.alt > 10, nowVis = now.alt > 5 && sunNow.alt < -6;
      return { b, ja, col, mag, now, best, good, nowVis };
    }).sort((a, b) => (b.nowVis - a.nowVis) || (b.good - a.good) || a.mag - b.mag);
    $("#sk-planets").innerHTML = rows.map(r => `
      <div class="sk-pl"><span class="sw" style="background:${r.col}"></span>
        <div><b>${r.ja}</b> <small class="muted mono">${r.mag.toFixed(1)}等</small>
          <div class="small muted">${r.nowVis ? `<span style="color:var(--ok)">いま見えます</span> ${Geo.dir16(r.now.az)} 高度${Math.round(r.now.alt)}°` :
            r.good ? `見頃 ${Fmt.hm(r.best.t)}頃 ${Geo.dir16(r.best.az)}の空 高度${Math.round(r.best.alt)}°` : "今夜は見えにくい"}</div></div></div>`).join("");
  }

  App.reg("sky", {
    init,
    show() { visible = true; baseKey = ""; lastSide = 0; },
    hide() { visible = false; ff = false; syncTime && st && syncTime(); },
    amb(v) { ambRot = v; }
  });
})();
