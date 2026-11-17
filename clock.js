/* 昼夜ワールドクロック */
(() => {
  const CITIES = [
    { n: "東京", tz: "Asia/Tokyo", lat: 35.68, lon: 139.77, cc: "JP" },
    { n: "ホノルル", tz: "Pacific/Honolulu", lat: 21.31, lon: -157.86, cc: "US" },
    { n: "ロサンゼルス", tz: "America/Los_Angeles", lat: 34.05, lon: -118.24, cc: "US" },
    { n: "ニューヨーク", tz: "America/New_York", lat: 40.71, lon: -74.01, cc: "US" },
    { n: "サンパウロ", tz: "America/Sao_Paulo", lat: -23.55, lon: -46.63, cc: "BR" },
    { n: "ロンドン", tz: "Europe/London", lat: 51.51, lon: -0.13, cc: "GB" },
    { n: "パリ", tz: "Europe/Paris", lat: 48.86, lon: 2.35, cc: "FR" },
    { n: "カイロ", tz: "Africa/Cairo", lat: 30.04, lon: 31.24, cc: "EG" },
    { n: "ドバイ", tz: "Asia/Dubai", lat: 25.20, lon: 55.27, cc: "AE" },
    { n: "ニューデリー", tz: "Asia/Kolkata", lat: 28.61, lon: 77.21, cc: "IN" },
    { n: "バンコク", tz: "Asia/Bangkok", lat: 13.76, lon: 100.50, cc: "TH" },
    { n: "シドニー", tz: "Australia/Sydney", lat: -33.87, lon: 151.21, cc: "AU" }
  ];
  const W = 1024, Hh = 512;
  let cities, visible = false, wx = [], sel = -1, comp, dayPx, nightPx, out, trig, lastComp = 0, drawT, wxT;

  function init() {
    const h = App.home;
    cities = [{ n: h.name, tz: h.tz, lat: h.lat, lon: h.lon, cc: h.cc || "", home: true },
      ...CITIES.filter(c => Geo.dist(c.lat, c.lon, h.lat, h.lon) > 60)];
    $("#ck-cities").innerHTML = cities.map((c, i) => `
      <div class="city" data-i="${i}">
        <div class="nm">${Geo.flag(c.cc)}${esc(c.n)}${c.home ? `<span class="here">現在地</span>` : ""}</div>
        <div class="tm num"></div><div class="sub d1"></div><div class="sub d2"></div>
        <div class="wx"></div></div>`).join("");
    $("#ck-cities").onclick = e => { const c = e.target.closest("[data-i]"); if (!c) return; const i = +c.dataset.i; sel = sel === i ? -1 : i; update(); draw(); };
    loadImages();
    loadWx(); wxT = setInterval(loadWx, 15 * 60 * 1000);
  }

  function loadImages() {
    const load = src => new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = src; });
    Promise.all([load("img/day.jpg"), load("img/night.jpg")]).then(([d, n]) => {
      const px = im => { const c = document.createElement("canvas"); c.width = W; c.height = Hh; const g = c.getContext("2d"); g.drawImage(im, 0, 0, W, Hh); return g.getImageData(0, 0, W, Hh).data; };
      dayPx = px(d); nightPx = px(n);
      comp = document.createElement("canvas"); comp.width = W; comp.height = Hh;
      out = comp.getContext("2d").createImageData(W, Hh);
      trig = { sLat: new Float32Array(Hh), cLat: new Float32Array(Hh), sLon: new Float32Array(W), cLon: new Float32Array(W) };
      for (let y = 0; y < Hh; y++) { const a = (90 - (y + .5) * 180 / Hh) * D2R; trig.sLat[y] = Math.sin(a); trig.cLat[y] = Math.cos(a); }
      for (let x = 0; x < W; x++) { const o = (-180 + (x + .5) * 360 / W) * D2R; trig.sLon[x] = Math.sin(o); trig.cLon[x] = Math.cos(o); }
      compose(); draw();
    }).catch(() => toast("地図画像を読み込めませんでした"));
  }

  /* 太陽高度で昼の地球と夜の地球を合成（薄明帯はなめらかに・境界は夕焼け色） */
  function compose() {
    if (!dayPx) return;
    const sp = Sun.pos(), sd = Math.sin(sp.dec), cd = Math.cos(sp.dec), cs = Math.cos(sp.lon * D2R), ss = Math.sin(sp.lon * D2R);
    const o = out.data, LO = -0.2079, SPAN = 0.2602; // sin(-12°) 〜 sin(3°)
    for (let y = 0; y < Hh; y++) {
      const a = trig.sLat[y] * sd, b = trig.cLat[y] * cd;
      for (let x = 0; x < W; x++) {
        const s = a + b * (trig.cLon[x] * cs + trig.sLon[x] * ss);
        let t = (s - LO) / SPAN; t = t < 0 ? 0 : t > 1 ? 1 : t; const w = t * t * (3 - 2 * t);
        let tw = 1 - Math.abs(s) / 0.06; tw = tw > 0 ? tw * w : 0;
        const i = (y * W + x) * 4;
        o[i] = nightPx[i] * 1.1 * (1 - w) + dayPx[i] * w + 60 * tw;
        o[i + 1] = nightPx[i + 1] * 1.05 * (1 - w) + dayPx[i + 1] * w + 18 * tw;
        o[i + 2] = nightPx[i + 2] * (1 - w) + dayPx[i + 2] * w - 10 * tw;
        o[i + 3] = 255;
      }
    }
    comp.getContext("2d").putImageData(out, 0, 0);
    lastComp = Date.now();
  }

  function draw() {
    if (!comp) return;
    const cv = $("#ck-map"), dpr = devicePixelRatio || 1, cw = cv.clientWidth, ch = cw / 2;
    if (!cw) return;
    if (cv.width !== Math.round(cw * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingQuality = "high";
    g.drawImage(comp, 0, 0, cw, ch);
    const X = lon => (lon + 180) / 360 * cw, Y = lat => (90 - lat) / 180 * ch;

    // 赤道・回帰線
    g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 1; g.setLineDash([3, 5]);
    [0, 23.44, -23.44].forEach(l => { g.beginPath(); g.moveTo(0, Y(l)); g.lineTo(cw, Y(l)); g.stroke(); });
    g.setLineDash([]);

    // 太陽直下点
    const sp = Sun.pos(), sx = X(sp.lon), sy = Y(sp.lat), r = Math.max(10, cw / 45);
    const gl = g.createRadialGradient(sx, sy, 0, sx, sy, r * 2.4);
    gl.addColorStop(0, "rgba(255,230,120,.95)"); gl.addColorStop(.35, "rgba(255,200,60,.5)"); gl.addColorStop(1, "rgba(255,200,60,0)");
    g.fillStyle = gl; g.beginPath(); g.arc(sx, sy, r * 2.4, 0, 7); g.fill();
    g.fillStyle = "#fff5c0"; g.beginPath(); g.arc(sx, sy, r * .45, 0, 7); g.fill();

    // 都市
    const now = new Date(), fs = cw < 520 ? 9.5 : Math.max(10, Math.min(13, cw / 70));
    g.font = `500 ${fs}px "Zen Kaku Gothic New",system-ui,sans-serif`; g.textBaseline = "middle";
    const boxes = [];
    cities.forEach((c, i) => {
      const x = X(c.lon), y = Y(c.lat), on = i === sel;
      if (on) {
        const ph = (Date.now() % 1600) / 1600;
        g.strokeStyle = `rgba(79,156,240,${1 - ph})`; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 6 + ph * 16, 0, 7); g.stroke();
      }
      g.fillStyle = c.home ? "#4f9cf0" : on ? "#ffffff" : "#9aa7b8";
      g.beginPath(); g.arc(x, y, c.home || on ? 4.5 : 3.2, 0, 7); g.fill();
      const label = cw < 520 ? (c.home ? `${c.n} ${Fmt.hm(now, c.tz)}` : Fmt.hm(now, c.tz)) : `${c.n} ${Fmt.hm(now, c.tz)}`, tw = g.measureText(label).width, bh = fs * 1.5;
      const lx = x + tw + 14 > cw ? x - tw - 12 : x + 7;
      let ly = y;  // ラベル同士が重ならないよう上下にずらす
      for (const dy of [0, -bh, bh, -2 * bh, 2 * bh]) {
        const t = y + dy;
        if (!boxes.some(b => lx - 3 < b[0] + b[2] && lx + tw + 3 > b[0] && t - bh / 2 < b[1] + b[3] && t + bh / 2 > b[1])) { ly = t; break; }
      }
      boxes.push([lx - 3, ly - bh / 2, tw + 6, bh]);
      if (ly !== y) { g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(lx - 3, ly); g.stroke(); }
      g.fillStyle = "rgba(0,0,0,.6)"; g.beginPath();
      g.roundRect ? g.roundRect(lx - 3, ly - bh / 2, tw + 6, bh, 4) : g.rect(lx - 3, ly - bh / 2, tw + 6, bh); g.fill();
      g.fillStyle = c.home ? "#a9cdf7" : "#e8eaed"; g.fillText(label, lx, ly + .5);
    });
  }

  function tzOffset(tz, d) {
    const o = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(d).forEach(p => o[p.type] = p.value);
    return Math.round((Date.UTC(+o.year, o.month - 1, +o.day, +o.hour % 24, +o.minute) - d.getTime()) / 60000);
  }
  const ymd = (d, tz) => d.toLocaleDateString("en-CA", { timeZone: tz });

  function update() {
    const now = new Date(), sp = Sun.pos(now), jst = tzOffset(App.home.tz, now), today = ymd(now, App.home.tz);
    $("#ck-time").textContent = Fmt.hms(now, App.home.tz);
    $("#ck-date").textContent = `${Fmt.full(now)} ・ ${App.home.name}`;
    const home = wx[0];
    const el = Sun.elev(App.home.lat, App.home.lon, sp);
    let sunTxt = `太陽高度 <b class="mono">${el.toFixed(1)}°</b>`;
    if (home && home.daily) {
      const sr = home.daily.sunrise[0], ss = home.daily.sunset[0];
      const off = home.utc_offset_seconds * 1000, toD = s => new Date(Date.parse(s + "Z") - off);
      const srD = toD(sr), ssD = toD(ss);
      sunTxt = `日の出 <b class="mono">${sr.slice(11, 16)}</b> ・ 日の入り <b class="mono">${ss.slice(11, 16)}</b><br>` +
        (now < srD ? `日の出まで ${Fmt.dur((srD - now) / 1000)}` : now < ssD ? `日の入りまで ${Fmt.dur((ssD - now) / 1000)}` : "今日の日の入りは終わりました") +
        ` ・ ${sunTxt}`;
    }
    $("#ck-sun").innerHTML = sunTxt;

    $$("#ck-cities .city").forEach(card => {
      const i = +card.dataset.i, c = cities[i], w = wx[i];
      const e = Sun.elev(c.lat, c.lon, sp), day = e > -0.83;
      card.classList.toggle("day", day); card.classList.toggle("night", !day); card.classList.toggle("sel", i === sel);
      card.querySelector(".tm").textContent = Fmt.hm(now, c.tz);
      const diffMin = tzOffset(c.tz, now) - jst, dd = ymd(now, c.tz);
      const dl = dd === today ? "今日" : dd > today ? "明日" : "昨日";
      const diff = diffMin === 0 ? "時差なし" : `時差${diffMin > 0 ? "+" : "−"}${Math.floor(Math.abs(diffMin) / 60)}${Math.abs(diffMin) % 60 ? ":" + String(Math.abs(diffMin) % 60).padStart(2, "0") : ""}時間`;
      card.querySelector(".d1").textContent = `${dl} ・ ${c.home ? (day ? "昼" : e > -6 ? "薄明" : "夜") : diff}`;
      card.querySelector(".d2").textContent = w && w.daily ? `日の出 ${w.daily.sunrise[0].slice(11, 16)} ・ 日の入 ${w.daily.sunset[0].slice(11, 16)}` : (e > -6 && !day ? "薄明" : day ? "昼" : "夜");
      const wxe = card.querySelector(".wx");
      if (w && w.current) {
        const [icn, lb] = wxInfo(w.current.weather_code, w.current.is_day);
        wxe.innerHTML = `${ic(icn)}${Math.round(w.current.temperature_2m)}°<small>${lb}</small>`;
      }
    });
  }

  async function loadWx() {
    try {
      wx = await api(`/api/weather?lat=${cities.map(c => c.lat).join(",")}&lon=${cities.map(c => c.lon).join(",")}`);
      update();
    } catch {}
  }

  function loop() {
    if (!visible) return;
    if (Date.now() - lastComp > 60000) compose();
    update(); draw();
  }

  App.reg("clock", {
    init,
    show() {
      visible = true; loop();
      clearInterval(drawT);
      drawT = setInterval(loop, 1000);
      if (!App._ckResize) { App._ckResize = true; addEventListener("resize", () => visible && draw()); }
    },
    hide() { visible = false; clearInterval(drawT); }
  });
})();
