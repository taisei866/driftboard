/* 計器：天気の窓・太陽系儀・地球儀・望遠鏡の視界
   各タブのデータはそれぞれのモジュールが用意し、ここでは「見せ方」と「触り方」だけを受け持つ */
const Inst = (() => {
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k;
  const rand = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function fit(cv) {   // キャンバスを表示サイズに合わせる
    const dp = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dp) || cv.height !== Math.round(h * dp)) { cv.width = Math.round(w * dp); cv.height = Math.round(h * dp); }
    const g = cv.getContext("2d"); g.setTransform(dp, 0, 0, dp, 0, 0); return [g, w, h];
  }
  const live = tab => App.cur === tab && !document.hidden;
  function drag(el, on) {   // 横ドラッグの共通処理（慣性つき）
    let x0 = null, last = 0, v = 0, raf;
    el.addEventListener("pointerdown", e => { x0 = e.clientX; last = performance.now(); v = 0; cancelAnimationFrame(raf); el.setPointerCapture(e.pointerId); on.start?.(); });
    el.addEventListener("pointermove", e => { if (x0 == null) return; const dx = e.clientX - x0, n = performance.now(); x0 = e.clientX; v = dx / Math.max(1, n - last) * 16; last = n; on.move(dx, e); });
    const up = () => { if (x0 == null) return; x0 = null; const go = () => { v *= .92; if (Math.abs(v) < .3) return on.end?.(); on.move(v); raf = requestAnimationFrame(go); }; on.inertia === false ? on.end?.() : go(); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }

  /* =====================================================================
     天気：窓の外の空。時刻・雲・雨雪・風で空の色と動きが変わる。左右ドラッグで48時間先まで
     ===================================================================== */
  const Win = (() => {
    let cv, data, off = 0, clouds = [], drops = [], stars = [], t0 = performance.now(), dragging = false, back;
    const CLOUD = { 0: 4, 1: 18, 2: 50, 3: 92, 45: 100, 48: 100 };
    function init() {
      cv = $("#wx-sky"); if (!cv) return;
      const r = rand(7);
      stars = Array.from({ length: 140 }, () => ({ x: r(), y: r() * .8, s: r() ** 3 * 1.4 + .3, p: r() * TAU }));
      clouds = Array.from({ length: 16 }, (_, i) => ({ x: r() * 1.4 - .2, y: .08 + r() * .55, w: .18 + r() * .32, h: .05 + r() * .09, d: .4 + r() * .6, k: i / 16 }));
      drops = Array.from({ length: 90 }, () => ({ x: r(), y: r(), v: .6 + r() * .8, l: .5 + r() }));
      drag(cv, {
        start: () => { dragging = true; clearTimeout(back); cv.parentNode.classList.add("used"); },
        move: dx => { off = clamp(off - dx / cv.clientWidth * 30, 0, 47); },
        end: () => { dragging = false; back = setTimeout(() => { const s = off, t = performance.now(); const go = n => { const k = Math.min(1, (n - t) / 1400); off = s * (1 - (1 - (1 - k) ** 3)); if (k < 1 && !dragging) requestAnimationFrame(go); }; requestAnimationFrame(go); }, 9000); }
      });
      requestAnimationFrame(frame);
    }
    function set(d) { data = d; }
    function at(h) {   // h 時間後の空模様（1時間ごとの予報を補間）
      const H = data.hourly, base = Date.now() + data.utc_offset_seconds * 1000, loc = new Date(base).toISOString().slice(0, 13);
      const s = Math.max(0, H.time.findIndex(t => t.slice(0, 13) >= loc)), i = Math.min(H.time.length - 2, s + Math.floor(h)), k = h - Math.floor(h);
      const code = H.weather_code[k < .5 ? i : i + 1];
      const cc = H.cloud_cover ? lerp(H.cloud_cover[i], H.cloud_cover[i + 1], k) : (code >= 51 ? 88 : CLOUD[code] ?? 60);
      const when = new Date(Date.now() + h * 3600e3);
      return { when, temp: lerp(H.temperature_2m[i], H.temperature_2m[i + 1], k), code, cc, pop: H.precipitation_probability?.[i] ?? 0,
        wind: (H.wind_speed_10m ? H.wind_speed_10m[i] : data.current.wind_speed_10m) || 0, el: Sun.elev(App.home.lat, App.home.lon, Sun.pos(when)) };
    }
    // 太陽高度から空の上・下の色を決める
    function skyCols(el, cc) {
      const P = [[-18, "#02040a", "#050912"], [-8, "#0a1430", "#1b2448"], [-3, "#1d2a5c", "#c86a4a"], [2, "#3e6db8", "#f0a868"], [8, "#4f8fd8", "#bcd6ef"], [30, "#3d7fd6", "#a7cdf2"]];
      let a = P[0], b = P[P.length - 1];
      for (let i = 0; i < P.length - 1; i++) if (el >= P[i][0] && el <= P[i + 1][0]) { a = P[i]; b = P[i + 1]; }
      const k = clamp((el - a[0]) / ((b[0] - a[0]) || 1), 0, 1), mix = (c1, c2) => { const p = x => [1, 3, 5].map(j => parseInt(x.slice(j, j + 2), 16)); const u = p(c1), v = p(c2); return u.map((q, j) => Math.round(lerp(q, v[j], k))); };
      const gray = c => c.map(v => Math.round(lerp(v, (el > 0 ? 150 : 40) * .9, cc / 100 * .75)));
      const mono = c => { const l = c[0] * .3 + c[1] * .55 + c[2] * .15; return [Math.round(l * .97 + 3), Math.round(l * .97 + 3), Math.round(l + 6)].map(v => Math.min(229, v)); };
      return [mono(gray(mix(a[1], b[1]))), mono(gray(mix(a[2], b[2])))];
    }
    function frame(n) {
      requestAnimationFrame(frame);
      if (!cv || !data || !live("weather")) return;
      const [g, W, H] = fit(cv), t = (n - t0) / 1000, s = at(off), night = s.el < -6;
      const [top, bot] = skyCols(s.el, s.cc), gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, `rgb(${top})`); gr.addColorStop(1, `rgb(${bot})`); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      // 星（夜で、雲が少ないほど多く）
      if (s.el < -4) { const vis = clamp((-4 - s.el) / 10, 0, 1) * (1 - s.cc / 100);
        for (const st of stars) { g.globalAlpha = vis * (.5 + .5 * Math.sin(t * 1.3 + st.p)); g.fillStyle = "#dfe8ff"; g.fillRect(st.x * W, st.y * H, st.s, st.s); } g.globalAlpha = 1; }
      // 太陽・月：その時刻の高さに合わせて上下する
      const y = H * (.92 - clamp(Math.abs(s.el) / 50, 0, 1) * .75), x = W * .72;
      if (s.el > -3) { const r = 22; const sg = g.createRadialGradient(x, y, 0, x, y, r * 6); sg.addColorStop(0, `rgba(240,240,244,${.9 * (1 - s.cc / 130)})`); sg.addColorStop(.12, "rgba(224,224,229,.22)"); sg.addColorStop(1, "rgba(224,224,229,0)"); g.fillStyle = sg; g.fillRect(0, 0, W, H); }
      else { const r = 13, mg = g.createRadialGradient(x, y, 0, x, y, r * 5); mg.addColorStop(0, `rgba(230,236,255,${.9 * (1 - s.cc / 120)})`); mg.addColorStop(.2, "rgba(200,215,255,.15)"); mg.addColorStop(1, "rgba(200,215,255,0)"); g.fillStyle = mg; g.fillRect(0, 0, W, H); }
      // 雲：雲量に応じて濃さと数、風で流れる
      const nC = Math.round(clouds.length * clamp(s.cc / 90, .08, 1)), spd = .004 + s.wind / 3600 * .6;
      for (let i = 0; i < nC; i++) {
        const c = clouds[i], cx = ((c.x + t * spd * c.d) % 1.4 + 1.4) % 1.4 - .2;
        const shade = night ? 40 + s.cc * .2 : 225 - s.cc * .9, a = .25 + s.cc / 100 * .55;
        for (let j = 0; j < 4; j++) {
          const bx = (cx + (j - 1.5) * c.w * .28) * W, by = (c.y + Math.sin(j * 1.7) * c.h * .3) * H, br = c.w * W * (.32 + (j % 2) * .12);
          const cg = g.createRadialGradient(bx, by, 0, bx, by, br); cg.addColorStop(0, `rgba(${shade},${shade},${shade + 8},${a})`); cg.addColorStop(1, `rgba(${shade},${shade},${shade + 8},0)`);
          g.fillStyle = cg; g.beginPath(); g.ellipse(bx, by, br, br * .45, 0, 0, TAU); g.fill();
        }
      }
      // 雨・雪
      const rain = (s.code >= 51 && s.code <= 67) || (s.code >= 80 && s.code <= 82) || s.code >= 95, snow = (s.code >= 71 && s.code <= 77) || s.code === 85 || s.code === 86;
      if (rain || snow) { g.strokeStyle = "rgba(190,210,240,.45)"; g.fillStyle = "rgba(240,245,255,.8)"; g.lineWidth = 1;
        for (const d of drops) { const yy = ((d.y + t * d.v * (snow ? .08 : .9)) % 1) * H, xx = ((d.x + (snow ? Math.sin(t + d.l * 9) * .01 : -t * .05 * d.v)) % 1 + 1) % 1 * W;
          if (snow) { g.beginPath(); g.arc(xx, yy, d.l * 1.4, 0, TAU); g.fill(); } else { g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx - 2, yy + 9 * d.l); g.stroke(); } } }
      if (s.code === 45 || s.code === 48) { g.fillStyle = "rgba(200,205,215,.35)"; g.fillRect(0, H * .45, W, H * .55); }
      // 窓辺の稜線（町のシルエット）
      g.fillStyle = night ? "#020307" : "rgba(10,16,30,.85)"; g.beginPath(); g.moveTo(0, H);
      const sk = rand(11); let xx = 0; while (xx < W) { const bw = 18 + sk() * 46, bh = H * (.06 + sk() * .12); g.lineTo(xx, H - bh); g.lineTo(xx + bw, H - bh); xx += bw; }
      g.lineTo(W, H); g.fill();
      if (night) { const lk = rand(5); g.fillStyle = "rgba(224,224,229,.45)"; for (let i = 0; i < 60; i++) g.fillRect(lk() * W, H - lk() * H * .15, 1.5, 1.5); }
      // 読み取り
      const when = s.when.toLocaleString("ja-JP", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: App.home.tz });
      $("#ww-time").textContent = off < .5 ? "いま" : `${Math.round(off)}時間後 ・ ${when}`;
      $("#ww-temp").innerHTML = `${Math.round(s.temp)}<small>°</small>`;
      $("#ww-lb").textContent = `${wxInfo(s.code, s.el > 0 ? 1 : 0)[1]} ・ 雲${Math.round(s.cc)}% ・ 降水${s.pop}%`;
      $("#ww-bar i").style.width = (off / 47 * 100) + "%";
    }
    return { init, set };
  })();

  /* =====================================================================
     宇宙：太陽系儀。惑星を今の本当の位置に置き、ドラッグで日付を進める・戻す
     ===================================================================== */
  const Orr = (() => {
    const PL = [["Mercury", "水星", "#b7aea3", .387], ["Venus", "金星", "#f1d9a4", .723], ["Earth", "地球", "#c9c9d1", 1], ["Mars", "火星", "#ef8a5e", 1.524],
      ["Jupiter", "木星", "#e3c296", 5.2], ["Saturn", "土星", "#ecd8a8", 9.58], ["Uranus", "天王星", "#9fe3e6", 19.2], ["Neptune", "海王星", "#6e8cff", 30.1]];
    let cv, days = 0, sel = 2, back, dragging = false;
    const rOf = a => .12 + .88 * Math.log(1 + a * 6) / Math.log(1 + 30.1 * 6);   // 外側の惑星まで1画面に収めるため対数で縮める
    function init() {
      cv = $("#orrery"); if (!cv) return;
      drag(cv, {
        start: () => { dragging = true; clearTimeout(back); cv.parentNode.classList.add("used"); },
        move: dx => { days += dx * 1.6; },
        end: () => { dragging = false; clearTimeout(back); back = setTimeout(() => { const s = days, t = performance.now(); const go = n => { if (dragging) return; const k = Math.min(1, (n - t) / 1800); days = s * (1 - k) ** 3; if (k < 1) requestAnimationFrame(go); }; requestAnimationFrame(go); }, 12000); }
      });
      cv.addEventListener("click", e => {
        const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; let best = -1, bd = 26;
        (cv._pts || []).forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i; } });
        if (best >= 0) sel = best;
      });
      $("#or-now").onclick = () => { const s = days, t = performance.now(); const go = n => { const k = Math.min(1, (n - t) / 900); days = s * (1 - k) ** 3; if (k < 1) requestAnimationFrame(go); }; requestAnimationFrame(go); };
      requestAnimationFrame(frame);
    }
    function frame(n) {
      requestAnimationFrame(frame);
      if (!cv || !live("space") || typeof Astronomy === "undefined") return;
      // 少し斜め上から見下ろした太陽系（横長の楕円）
      const [g, W, H] = fit(cv), cx = W / 2, cy = H / 2, Rx = Math.min(W / 2 - 20, H * 1.05), Ry = Math.min(Rx * .46, H / 2 - 18), R = Rx, when = new Date(Date.now() + days * 864e5), t = n / 1000;
      g.clearRect(0, 0, W, H);
      // 太陽
      g.fillStyle = "#e0e0e5"; g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill();
      g.strokeStyle = "rgba(224,224,229,.25)"; g.beginPath(); g.arc(cx, cy, 11, 0, TAU); g.stroke();
      const pts = [];
      PL.forEach(([id, ja, col, a], i) => {
        const k = rOf(a), rx = k * Rx, ry = k * Ry;
        g.strokeStyle = i === sel ? "rgba(201,201,209,.5)" : "rgba(140,170,220,.24)"; g.lineWidth = 1; g.setLineDash(i > 3 ? [3, 4] : []);
        g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke(); g.setLineDash([]);
        let v; try { v = Astronomy.HelioVector(Astronomy.Body[id], when); } catch { return; }
        const ang = Math.atan2(v.y, v.x), x = cx + Math.cos(ang) * rx, y = cy - Math.sin(ang) * ry; pts.push([x, y]);
        const sz = [2.4, 3.4, 3.6, 3, 6.5, 5.8, 4.4, 4.2][i];
        if (i === 5) { g.strokeStyle = "rgba(224,224,229,.45)"; g.beginPath(); g.ellipse(x, y, sz * 2, sz * .7, -.4, 0, TAU); g.stroke(); }
        g.fillStyle = i === sel ? "#e0e0e5" : "rgba(224,224,229,.62)"; g.beginPath(); g.arc(x, y, sz * .7, 0, TAU); g.fill();
        if (i === sel) { g.strokeStyle = "rgba(220,235,255,.9)"; g.beginPath(); g.arc(x, y, sz + 6 + Math.sin(t * 3) * 1.5, 0, TAU); g.stroke(); }
        g.fillStyle = i === sel ? "#e0e0e5" : "rgba(224,224,229,.55)"; g.font = `300 11px 'Noto Sans JP',sans-serif`; g.fillText(ja, x + sz + 5, y - 4);
      });
      cv._pts = pts;
      // 地球から見た選んだ惑星の距離
      const [id, ja] = PL[sel];
      let info = "";
      try {
        if (id === "Earth") info = `太陽から ${Astronomy.HelioDistance(Astronomy.Body.Earth, when).toFixed(3)} au`;
        else { const e = Astronomy.GeoVector(Astronomy.Body[id], when, true), d = Math.hypot(e.x, e.y, e.z); info = `地球から ${d.toFixed(2)} au（${(d * 1.496e8 / 1e8).toFixed(2)}億km）・ 光で ${Math.round(d * 499 / 60)}分`; }
      } catch {}
      $("#or-date").textContent = `${when.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" })}${Math.abs(days) >= 1 ? `（${days > 0 ? "+" : ""}${Math.round(days)}日）` : "・いま"}`;
      $("#or-info").innerHTML = `<b>${ja}</b> ${info}`;
    }
    return { init };
  })();

  /* =====================================================================
     世界時計：指で回せる地球儀。昼と夜の境目、夜の街明かり、都市の時刻
     ===================================================================== */
  const Globe = (() => {
    let cv, day, night, TW = 1024, TH = 512, rot = { lon: 0, lat: 22 }, spin = true, idleT, buf, bufW = 0, cities = [];
    function init() {
      cv = $("#ck-globe"); if (!cv) return;
      rot.lon = App.home.lon;
      const load = src => new Promise(r => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = TW; c.height = TH; const x = c.getContext("2d"); x.drawImage(im, 0, 0, TW, TH); r(x.getImageData(0, 0, TW, TH).data); }; im.src = src; });
      Promise.all([load("img/day.jpg"), load("img/night.jpg")]).then(([a, b]) => { day = a; night = b; });
      let y0 = null;
      cv.addEventListener("pointerdown", e => { y0 = e.clientY; spin = false; clearTimeout(idleT); cv.parentNode.classList.add("used"); });
      cv.addEventListener("pointermove", e => { if (y0 == null) return; rot.lat = clamp(rot.lat + (e.clientY - y0) * .35, -70, 70); y0 = e.clientY; });
      cv.addEventListener("pointerup", () => { y0 = null; idleT = setTimeout(() => spin = true, 15000); });
      drag(cv, { move: dx => { rot.lon -= dx * .35; }, end: () => { idleT = setTimeout(() => spin = true, 15000); } });
      requestAnimationFrame(frame);
    }
    function frame(n) {
      requestAnimationFrame(frame);
      if (!cv || !day || !live("clock")) return;
      if (n - (frame.l || 0) < 40) return; frame.l = n;
      if (spin) rot.lon += .08;
      const S = Math.min(cv.clientWidth, cv.clientHeight), dp = Math.min(devicePixelRatio || 1, 1.5), N = Math.min(460, Math.round(S * dp));
      if (cv.width !== N) { cv.width = cv.height = N; }
      const g = cv.getContext("2d");
      if (bufW !== N) { buf = g.createImageData(N, N); bufW = N; }
      const px = buf.data, sp = Sun.pos(), D = Math.PI / 180;
      const sx = Math.cos(sp.lat * D) * Math.cos(sp.lon * D), sy = Math.cos(sp.lat * D) * Math.sin(sp.lon * D), sz = Math.sin(sp.lat * D);
      const l0 = rot.lon * D, p0 = rot.lat * D, cp = Math.cos(p0), spp = Math.sin(p0), r = N / 2 - 2;
      for (let j = 0; j < N; j++) {
        const y = (N / 2 - j) / r;
        for (let i = 0; i < N; i++) {
          const x = (i - N / 2) / r, rr = x * x + y * y, o = (j * N + i) * 4;
          if (rr > 1) { px[o + 3] = 0; continue; }
          const z = Math.sqrt(1 - rr);
          // 正射図法の逆変換：画面上の点 → 緯度・経度
          const lat = Math.asin(z * spp + y * cp), lon = l0 + Math.atan2(x, z * cp - y * spp);
          const cl = Math.cos(lat), vx = cl * Math.cos(lon), vy = cl * Math.sin(lon), vz = Math.sin(lat);
          const sun = vx * sx + vy * sy + vz * sz, k = clamp((sun + .08) / .16, 0, 1);   // 境目をなめらかに
          let u = ((lon / D + 180) % 360 + 360) % 360 / 360 * TW | 0, v = (90 - lat / D) / 180 * TH | 0; if (v >= TH) v = TH - 1;
          const q = (v * TW + u) * 4, shade = .55 + .45 * z;
          px[o] = (day[q] * k * shade + night[q] * (1 - k) * 1.1); px[o + 1] = (day[q + 1] * k * shade + night[q + 1] * (1 - k) * 1.05); px[o + 2] = (day[q + 2] * k * shade + night[q + 2] * (1 - k));
          px[o + 3] = 255;
        }
      }
      g.putImageData(buf, 0, 0);
      // 大気のふち
      const ag = g.createRadialGradient(N / 2, N / 2, r * .92, N / 2, N / 2, r * 1.02); ag.addColorStop(0, "rgba(90,168,255,0)"); ag.addColorStop(1, "rgba(120,190,255,.45)");
      g.fillStyle = ag; g.beginPath(); g.arc(N / 2, N / 2, r, 0, TAU); g.fill();
      // 都市
      cities = (window.CK_CITIES || []).concat([{ n: App.home.name, tz: App.home.tz, lat: App.home.lat, lon: App.home.lon, home: true }]);
      g.font = `${11 * dp}px 'Inter',monospace`; g.textBaseline = "middle";
      for (const c of cities) {
        const la = c.lat * D, lo = c.lon * D - l0, cx = Math.cos(la) * Math.sin(lo), cz = Math.cos(la) * Math.cos(lo);
        const X = cx, Y = Math.sin(la) * cp - cz * spp, Z = Math.sin(la) * spp + cz * cp; if (Z < .05) continue;
        const qx = N / 2 + X * r, qy = N / 2 - Y * r;
        g.fillStyle = c.home ? "#c9c9d1" : "rgba(255,255,255,.85)"; g.beginPath(); g.arc(qx, qy, (c.home ? 3.5 : 2.2) * dp, 0, TAU); g.fill();
        const tm = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: c.tz });
        g.fillStyle = `rgba(230,240,255,${.35 + Z * .6})`; g.fillText(`${c.n} ${tm}`, qx + 6 * dp, qy);
      }
    }
    return { init };
  })();

  /* =====================================================================
     天文台：望遠鏡をのぞいたような円い視界で、世界の天文台を順に巡る
     ===================================================================== */
  const Scope = (() => {
    let cv, i = 0, t0 = 0, hold = 9000, field = [];
    function init() {
      cv = $("#obs-scope"); if (!cv) return;
      const r = rand(3); field = Array.from({ length: 420 }, () => ({ x: r() * 2 - 1, y: r() * 2 - 1, m: r() ** 4, p: r() * TAU, c: r() }));
      cv.addEventListener("click", () => { i++; t0 = performance.now(); });
      requestAnimationFrame(frame);
    }
    function frame(n) {
      requestAnimationFrame(frame);
      const rows = window.ObsRows; if (!cv || !rows || !rows.length || !live("obs")) return;
      if (!t0) t0 = n;
      if (n - t0 > hold) { i++; t0 = n; }
      const row = rows[i % rows.length], k = (n - t0) / 1000, [g, W, H] = fit(cv), R = Math.min(W, H) / 2 - 6, cx = W / 2, cy = H / 2;
      g.clearRect(0, 0, W, H);
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
      const sa = row.sa0, cc = row.cc0 ?? 50, dayk = clamp((sa + 12) / 18, 0, 1);
      // 空の地色：昼は青、薄明は群青、夜は黒
      g.fillStyle = `rgb(${lerp(7, 92, dayk)},${lerp(7, 94, dayk)},${lerp(9, 102, dayk)})`; g.fillRect(0, 0, W, H);
      // 星：ピントが合うまで最初の1秒はぼかす。暗く晴れているほど多く、揺らぎ（シーイング）も表現
      const focus = clamp(k / 1.2, 0, 1), vis = (1 - dayk) * (1 - cc / 100) * (1 - (row.ma0 > 0 ? row.ill * .4 : 0));
      const rot = n / 1000 * .01 + (i * 1.3);
      for (const s of field) {
        const x = s.x * Math.cos(rot) - s.y * Math.sin(rot), y = s.x * Math.sin(rot) + s.y * Math.cos(rot);
        if (s.m < .35 - vis * .3) continue;
        const a = vis * (.25 + s.m * .9) * (.75 + .25 * Math.sin(n / 260 + s.p)), sz = (.5 + s.m * 2.2) * (1 + (1 - focus) * 3);
        g.globalAlpha = clamp(a * (.4 + focus * .6), 0, 1);
        g.fillStyle = "#e0e0e5";
        g.beginPath(); g.arc(cx + x * R, cy + y * R, sz, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      // 天の川のもや
      if (vis > .3) { const mg = g.createLinearGradient(cx - R, cy + R, cx + R, cy - R); mg.addColorStop(.3, "rgba(160,180,255,0)"); mg.addColorStop(.5, `rgba(170,190,255,${vis * .12})`); mg.addColorStop(.7, "rgba(160,180,255,0)"); g.fillStyle = mg; g.fillRect(0, 0, W, H); }
      // 雲が流れる
      if (cc > 5) { for (let j = 0; j < 6; j++) { const x = ((j * .37 + n / 1000 * .02) % 1.6 - .3) * W, y = (.2 + (j * .53) % .7) * H, r = R * (.4 + (j % 3) * .2);
        const c2 = g.createRadialGradient(x, y, 0, x, y, r); const sh = dayk > .5 ? 230 : 70; c2.addColorStop(0, `rgba(${sh},${sh},${sh + 10},${cc / 100 * .75})`); c2.addColorStop(1, `rgba(${sh},${sh},${sh + 10},0)`); g.fillStyle = c2; g.fillRect(0, 0, W, H); } }
      g.restore();
      // 接眼部の縁と照準
      const vg = g.createRadialGradient(cx, cy, R * .6, cx, cy, R); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.85)");
      g.fillStyle = vg; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
      g.strokeStyle = "rgba(224,224,229,.35)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - R * .12, cy); g.lineTo(cx - R * .03, cy); g.moveTo(cx + R * .03, cy); g.lineTo(cx + R * .12, cy); g.moveTo(cx, cy - R * .12); g.lineTo(cx, cy - R * .03); g.moveTo(cx, cy + R * .03); g.lineTo(cx, cy + R * .12); g.stroke();
      g.strokeStyle = "rgba(140,180,240,.35)"; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
      for (let a = 0; a < 72; a++) { const an = a / 72 * TAU, l = a % 6 ? 4 : 9; g.beginPath(); g.moveTo(cx + Math.cos(an) * R, cy + Math.sin(an) * R); g.lineTo(cx + Math.cos(an) * (R - l), cy + Math.sin(an) * (R - l)); g.stroke(); }
      // 読み取り
      const tm = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: row.tz || undefined });
      $("#sc-name").textContent = row.s.n; $("#sc-place").textContent = row.s.p;
      $("#sc-meta").textContent = `現地 ${tm} ・ 雲 ${row.cc0 ?? "-"}% ・ ${row.state}`;
      $("#sc-idx").textContent = `${String(i % rows.length + 1).padStart(2, "0")} / ${String(rows.length).padStart(2, "0")}`;
      $("#sc-bar").style.width = clamp((n - t0) / hold, 0, 1) * 100 + "%";
    }
    return { init };
  })();

  function init() { Win.init(); Orr.init(); Globe.init(); Scope.init(); }
  return { init, wx: Win };
})();
