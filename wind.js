/* 風の絵：今の風向き・風速・気温・天気で動く粒子のアート */
(() => {
  let cv, g, W = 0, H = 0, dpr = 1, visible = false, raf, wx = null, last = 0, parts = [], drops = [], t0 = 0, lastT = 0;

  /* なめらかなノイズ（値ノイズ） */
  const P = new Uint8Array(512); { const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
  const fade = t => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
  function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const h = (i, j) => P[P[X + i] + Y + j] / 255;
    return lerp(lerp(h(0, 0), h(1, 0), fade(xf)), lerp(h(0, 1), h(1, 1), fade(xf)), fade(yf));
  }

  function init() {
    cv = $("#wind"); g = cv.getContext("2d");
    addEventListener("resize", () => visible && size());
  }
  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = bg(); g.fillRect(0, 0, W, H);
    seed();
  }
  const isRain = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
  const isSnow = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
  const bg = () => wx && wx.is_day ? "#0b1424" : "#04060a";

  function seed() {
    const area = W * H, cloud = wx ? wx.cloud_cover ?? 50 : 50;
    const n = Math.round(Math.min(2600, area / 380) * (0.55 + cloud / 220));
    parts = Array.from({ length: n }, () => newP());
    const c = wx ? wx.weather_code : 0;
    drops = isRain(c) || isSnow(c) ? Array.from({ length: Math.round(area / (isSnow(c) ? 2600 : 1500)) }, () => newD(true)) : [];
  }
  const newP = () => ({ x: Math.random() * W, y: Math.random() * H, life: Math.random() * 400 + 120, age: 0 });
  const newD = init => ({ x: Math.random() * W, y: init ? Math.random() * H : -10, v: Math.random() * .5 + .75, s: Math.random() * .6 + .7 });

  /* 気温→色（寒い=白っぽい青、暖かい=青緑〜淡い金） */
  function color(temp, a) {
    const k = Math.max(0, Math.min(1, (temp + 10) / 45));
    const h = lerp(212, 175, k) - (k > .7 ? (k - .7) * 400 : 0);
    const s = lerp(55, 65, k), l = lerp(78, 62, k);
    return `hsla(${h},${s}%,${l}%,${a})`;
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!visible || !W) return;
    const dt = Math.min(.05, lastT ? (t - lastT) / 1000 : .016); lastT = t;
    const time = (t - t0) / 1000;
    const spd = wx ? wx.wind_speed_10m / 3.6 : 2;              // m/s
    const dir = ((wx ? wx.wind_direction_10m : 270) + 180) * D2R;  // 風が「吹いていく」向き
    const temp = wx ? wx.temperature_2m : 10, code = wx ? wx.weather_code : 0;
    const vx0 = Math.sin(dir), vy0 = -Math.cos(dir);
    const px = 18 + spd * 9;                                    // 画面上の速さ（px/秒）
    const turb = .55 + Math.min(1.4, spd / 8);                  // 風が強いほど乱れる
    const sc = 1 / 260;

    // 残像を少しずつ消す
    g.fillStyle = wx && wx.is_day ? "rgba(11,20,36,.075)" : "rgba(4,6,10,.07)";
    g.fillRect(0, 0, W, H);

    g.lineWidth = 1.1; g.lineCap = "round";
    const alpha = .22 + Math.min(.35, (wx ? wx.cloud_cover ?? 50 : 50) / 300);
    g.strokeStyle = color(temp, alpha);
    g.beginPath();
    for (const p of parts) {
      const a = (noise(p.x * sc + time * .05, p.y * sc - time * .03) - .5) * Math.PI * turb;
      const ca = Math.cos(a), sa = Math.sin(a);
      const vx = (vx0 * ca - vy0 * sa) * px, vy = (vx0 * sa + vy0 * ca) * px;
      const nx = p.x + vx * dt, ny = p.y + vy * dt;
      g.moveTo(p.x, p.y); g.lineTo(nx, ny);
      p.x = nx; p.y = ny; p.age++;
      if (p.age > p.life || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) Object.assign(p, newP());
    }
    g.stroke();

    // 雨・雪
    if (drops.length) {
      const snow = isSnow(code);
      g.strokeStyle = snow ? "rgba(235,242,255,.7)" : "rgba(160,200,245,.45)"; g.fillStyle = "rgba(235,242,255,.75)";
      g.lineWidth = 1; g.beginPath();
      for (const d of drops) {
        const fall = snow ? 38 * d.v : 520 * d.v, drift = vx0 * px * (snow ? .6 : .25);
        const sway = snow ? Math.sin(time * 1.5 + d.x * .05) * 12 : 0;
        const nx = d.x + (drift + sway) * dt, ny = d.y + fall * dt;
        if (snow) { g.moveTo(nx + d.s * 1.2, ny); g.arc(nx, ny, d.s * 1.2, 0, 7); }
        else { g.moveTo(d.x, d.y); g.lineTo(nx, ny + 6); }
        d.x = nx; d.y = ny;
        if (d.y > H + 10 || d.x < -20 || d.x > W + 20) Object.assign(d, newD(false), { x: Math.random() * W });
      }
      snow ? g.fill() : g.stroke();
    }
  }

  async function load() {
    try {
      const d = await api("/api/forecast"); last = Date.now();
      const changed = !wx || wx.weather_code !== d.current.weather_code;
      wx = d.current;
      if (changed) seed();
      const [, lb] = wxInfo(wx.weather_code, wx.is_day);
      $("#wind-info").innerHTML = `<b>${esc(App.home.name)}の今</b><br>風 ${Geo.dir16(wx.wind_direction_10m)} <span class="mono">${(wx.wind_speed_10m / 3.6).toFixed(1)}m/s</span> ・ <span class="mono">${Math.round(wx.temperature_2m)}°C</span> ・ ${lb} ・ 雲 <span class="mono">${wx.cloud_cover ?? "-"}%</span>`;
    } catch { $("#wind-info").textContent = "天気を取得できないため、仮の風で描いています"; }
  }

  let loopT;
  App.reg("wind", {
    init,
    show() {
      visible = true; t0 = t0 || performance.now(); lastT = 0;
      setTimeout(size, 30);
      if (Date.now() - last > 10 * 60000) load();
      clearInterval(loopT); loopT = setInterval(load, 15 * 60000);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    },
    hide() { visible = false; cancelAnimationFrame(raf); clearInterval(loopT); }
  });
})();
