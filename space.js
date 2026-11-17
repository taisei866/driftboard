/* 宇宙ダッシュボード */
(() => {
  const SUN_IMGS = [
    ["https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg", "SDO AIA 193Å ・ コロナ"],
    ["https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0171.jpg", "SDO AIA 171Å ・ 磁力線ループ"],
    ["https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg", "SDO AIA 304Å ・ 彩層とプロミネンス"],
    ["https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIC.jpg", "SDO HMI ・ 可視光（黒点）"],
    ["https://soho.nascom.nasa.gov/data/realtime/c3/512/latest.jpg", "SOHO LASCO C3 ・ コロナグラフ"]
  ];
  let H, visible = false, map, issM, foot, trackL = [], satrec = null, passes = [], data = null, lastFetch = 0, sunI = 0, loopT, tickT;

  function init() {
    H = App.home;
    map = darkMap("issmap", { minZoom: 1, maxZoom: 6 }).setView([20, H.lon], 1);
    L.marker([H.lat, H.lon], { icon: L.divIcon({ className: "", html: '<div class="home-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false }).addTo(map);
    issM = L.marker([0, 0], { icon: L.divIcon({ className: "", html: '<div class="iss-ic"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map);
    foot = L.circle([0, 0], { radius: 1, color: "#4f9cf0", weight: 1, opacity: .5, fillOpacity: .06, interactive: false }).addTo(map);
    $("#sun-dots").innerHTML = SUN_IMGS.map((_, k) => `<button data-k="${k}" aria-label="${k + 1}枚目"><i></i></button>`).join("");
    $("#sun-dots").onclick = e => { const b = e.target.closest("[data-k]"); if (b) { sunHold = Date.now() + 30000; showSun(+b.dataset.k); } };
    swipe($(".sun-box"), d => { sunHold = Date.now() + 30000; showSun(sunI + d); });
    swipe($(".earth-box"), d => { eHold = Date.now() + 30000; showEarth(eI + d); });
    showSun(0);
    setInterval(rotateSun, 9000);
    loadTle();
    setInterval(loadTle, 6 * 3600 * 1000);
    setInterval(computePasses, 15 * 60 * 1000);
    moon();
    setInterval(moon, 10 * 60 * 1000);
    tickT = setInterval(tick, 1000);
  }

  /* ---------- ISS ---------- */
  async function loadTle() {
    try {
      const t = await api("/api/tle");
      satrec = satellite.twoline2satrec(t.l1, t.l2);
      computePasses(); drawTrack(); tick();
    } catch { $("#iss-next").textContent = "ISSの軌道データを取得できませんでした（再試行します）"; setTimeout(loadTle, 60000); }
  }

  function issAt(date) {
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position) return null;
    const gmst = satellite.gstime(date), gd = satellite.eciToGeodetic(pv.position, gmst);
    const v = pv.velocity;
    return { eci: pv.position, gmst, lat: satellite.degreesLat(gd.latitude), lon: satellite.degreesLong(gd.longitude), h: gd.height,
      spd: Math.hypot(v.x, v.y, v.z) * 3600 };
  }
  function sunlit(eci, date) {
    const s = Sun.pos(date).eci, d = eci.x * s[0] + eci.y * s[1] + eci.z * s[2];
    if (d > 0) return true;
    return Math.hypot(eci.x - d * s[0], eci.y - d * s[1], eci.z - d * s[2]) > 6371;
  }
  const obs = () => ({ longitude: H.lon * D2R, latitude: H.lat * D2R, height: 0.03 });
  function look(p) { const la = satellite.ecfToLookAngles(obs(), satellite.eciToEcf(p.eci, p.gmst)); return { el: la.elevation * R2D, az: la.azimuth * R2D }; }

  function computePasses() {
    if (!satrec) return;
    const t0 = Date.now(); passes = []; let ps = null;
    for (let i = 0; i <= 72 * 180 && passes.length < 8; i++) {
      const t = new Date(t0 + i * 20000), p = issAt(t); if (!p) continue;
      const { el, az } = look(p);
      if (el > 0) {
        if (!ps) ps = { start: t, sAz: az, max: el, maxT: t, mAz: az, vis: false };
        if (el > ps.max) { ps.max = el; ps.maxT = t; ps.mAz = az; }
        if (el > 10 && !ps.vis && Sun.elev(H.lat, H.lon, Sun.pos(t)) < -6 && sunlit(p.eci, t)) ps.vis = true;
        ps.end = t; ps.eAz = az;
      } else if (ps) { if (ps.max >= 10) passes.push(ps); ps = null; }
    }
    renderPasses();
  }

  function renderPasses() {
    $("#iss-passes").innerHTML = passes.map(p => `
      <div class="ps"><span class="mono">${Fmt.md(p.start)} ${Fmt.hm(p.start)}</span>
        <span>${Geo.dir16(p.sAz)} → ${Geo.dir16(p.eAz)} ・ 最大仰角 <b class="mono">${Math.round(p.max)}°</b> ・ ${Math.round((p.end - p.start) / 60000)}分</span>
        <span class="badge ${p.vis ? "ok" : ""}">${p.vis ? "肉眼で見える" : "見えない"}</span></div>`).join("")
      || `<div class="muted small">3日以内に高く昇る通過はありません</div>`;
  }

  function drawTrack() {
    if (!satrec) return;
    trackL.forEach(l => map.removeLayer(l)); trackL = [];
    const now = Date.now();
    const split = (from, to) => {
      const out = []; let s = [], prev = null;
      for (let m = from; m <= to; m++) {
        const p = issAt(new Date(now + m * 60000)); if (!p) continue;
        if (prev && Math.abs(p.lon - prev.lon) > 180) { if (s.length > 1) out.push(s); s = []; }
        s.push([p.lat, p.lon]); prev = p;
      }
      if (s.length > 1) out.push(s);
      return out;
    };
    const segs = [split(-50, 0), split(0, 95)];
    segs[0].forEach(s => trackL.push(L.polyline(s, { color: "#959aa3", weight: 1.2, opacity: .45, dashArray: "3 5", interactive: false }).addTo(map)));
    segs[1].forEach(s => trackL.push(L.polyline(s, { color: "#4f9cf0", weight: 1.8, opacity: .85, interactive: false }).addTo(map)));
  }

  let tickN = 0;
  function tick() {
    if (!visible) return;
    tickN++;
    if (satrec) {
      const now = new Date(), p = issAt(now);
      if (p) {
        issM.setLatLng([p.lat, p.lon]);
        foot.setLatLng([p.lat, p.lon]).setRadius(6371000 * Math.acos(6371 / (6371 + p.h)));
        $("#iss-lat").textContent = `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"}`;
        $("#iss-lon").textContent = `${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? "E" : "W"}`;
        $("#iss-alt").textContent = `${Fmt.n(p.h)}km`;
        $("#iss-spd").textContent = `${Fmt.n(p.spd)}km/h`;
        const lit = sunlit(p.eci, now);
        $("#iss-light").textContent = lit ? "日照中" : "地球の影の中";
        if (tickN % 60 === 1) { drawTrack(); map.panTo([20, p.lon], { animate: true }); }
        const { el, az } = look(p);
        if (el > 0) {
          $("#iss-next").innerHTML = `<b>いま${esc(H.name)}の空にISSがいます</b><br>${Geo.dir16(az)}の方角、仰角 <b class="mono">${Math.round(el)}°</b>${lit && Sun.elev(H.lat, H.lon) < -6 ? " ・ 肉眼で見えるはずです" : ""}`;
        } else {
          if (passes.length && passes[0].end < now) computePasses();
          const v = passes.find(x => x.vis && x.end > now);
          $("#iss-next").innerHTML = v
            ? `次に肉眼で見える通過：<b>${Fmt.md(v.start)} ${Fmt.hm(v.start)}</b><br>${Geo.dir16(v.sAz)}から${Geo.dir16(v.eAz)}へ ・ 最大仰角 ${Math.round(v.max)}°（${Fmt.hm(v.maxT)}頃 ${Geo.dir16(v.mAz)}）<br>あと <b class="mono">${Fmt.dur((v.start - now) / 1000)}</b>`
            : `3日以内に${esc(H.name)}から肉眼で見えるISSの通過はありません（昼間か、ISSが地球の影に入るため）`;
        }
      }
    }
  }

  /* ---------- 宇宙天気など ---------- */
  async function fetchData() {
    try { data = await api("/api/space"); lastFetch = Date.now(); render(); }
    catch { toast("宇宙データの取得に失敗しました"); }
  }

  const kpColor = k => k >= 7 ? "#e28673" : k >= 5 ? "#e39a5c" : k >= 4 ? "#e6b04a" : "#86c79a";
  function render() {
    const kp = data.kp;
    if (kp && kp.observed.length) {
      const obsv = kp.observed.slice(-8), fc = kp.forecast.slice(0, 8), now = obsv[obsv.length - 1].kp;
      $("#kp-now").textContent = now.toFixed(1); $("#kp-now").style.color = kpColor(now);
      const g = now >= 5 ? `G${Math.min(5, Math.floor(now) - 4)} 磁気嵐` : now >= 4 ? "やや活発" : "静穏";
      $("#kp-label").innerHTML = `<b>Kp指数</b><br><span class="muted">${g}</span>`;
      const bar = (r, cls) => `<div class="${cls}" title="${r.t} Kp${r.kp}" style="height:${Math.max(2, r.kp / 9 * 100)}%;background:${kpColor(r.kp)}"></div>`;
      $("#kp-chart").innerHTML = obsv.map((r, i) => bar(r, i === obsv.length - 1 ? "nowbar" : "")).join("") + fc.map(r => bar(r, "fc")).join("");
      const mx = Math.max(now, ...fc.map(r => r.kp || 0));
      const msg = mx >= 8 ? "非常に強い磁気嵐の予報。普段オーロラが見えない中緯度でも、極側の低い空に赤いオーロラが現れる可能性があります。"
        : mx >= 7 ? "強い磁気嵐の予報。中緯度でも、カメラの長時間露光なら極側の低空に写る可能性があります。"
        : mx >= 5 ? "磁気嵐レベル。高緯度の地域ではオーロラが活発になります。"
        : "静かな状態です。";
      const au = data.aurora;
      $("#aurora").style.borderLeftColor = kpColor(mx);
      $("#aurora").innerHTML = msg + (au ? `<br><small class="muted">NOAA OVATION予報 ・ ${esc(H.name)}上空 ${au.here}% ・ 周辺の最大 ${au.region}%</small>` : "");
    }
    const w = data.wind;
    if (w) {
      $("#sw-speed").textContent = w.speed != null ? `${Fmt.n(w.speed)}km/s` : "-";
      $("#sw-dens").textContent = w.density != null ? `${Fmt.n(w.density, 1)}/cm³` : "-";
      const bz = $("#sw-bz"); bz.textContent = w.bz != null ? `${w.bz > 0 ? "+" : ""}${Fmt.n(w.bz, 1)}nT` : "-";
      bz.style.color = w.bz != null && w.bz <= -5 ? "var(--warn)" : "";
      bz.title = "南向き（マイナス）が大きいほどオーロラが発生しやすい";
    }

    earth(data.earth || []);
    tick();
  }

  /* 太陽画像：自動で切り替え。スワイプ・タップ・ドットで手動操作（操作後30秒は自動を止める） */
  let sunHold = 0;
  function showSun(i) {
    const N = SUN_IMGS.length; sunI = ((i % N) + N) % N;
    const imgs = [$("#sun-a"), $("#sun-b")], [u, l] = SUN_IMGS[sunI], my = sunI;
    const nxt = imgs.find(x => !x.classList.contains("on")) || imgs[0], cur = imgs.find(x => x !== nxt);
    nxt.onload = () => { if (my !== sunI) return; nxt.classList.add("on"); cur.classList.remove("on"); };
    nxt.src = `${u}?t=${Math.floor(Date.now() / 1800000)}`;
    $("#sun-label").textContent = l;
    $$("#sun-dots i").forEach((d, k) => d.classList.toggle("on", k === sunI));
  }
  const rotateSun = () => { if (Date.now() > sunHold) showSun(sunI + 1); };

  /* ---------- 今日の地球（DSCOVR / EPIC） ---------- */
  let eList = [], eI = 0, eT, eKey = "", eHold = 0;
  function earth(list) {
    const key = list.map(e => e.url).join();
    if (!list.length) { $("#earth-cap").textContent = "今日の地球の画像を取得できませんでした"; return; }
    if (key === eKey) return;
    eKey = key; eList = list;
    const d = new Date(list[0].date.replace(" ", "T") + "Z");
    $("#earth-date").textContent = `${Fmt.md(d)}撮影 ・ ${list.length}枚`;
    list.forEach(e => { const im = new Image(); im.src = e.url; }); // 先読み
    showEarth(0);
    clearInterval(eT); eT = setInterval(() => { if (visible && Date.now() > eHold) showEarth(eI + 1); }, 3500);
  }
  function showEarth(i) {
    if (!eList.length) return;
    const N = eList.length; eI = ((i % N) + N) % N;
    const e = eList[eI], my = eI, imgs = [$("#earth-a"), $("#earth-b")];
    const nxt = imgs.find(x => !x.classList.contains("on")) || imgs[0], cur = imgs.find(x => x !== nxt);
    nxt.onload = () => { if (my !== eI) return; nxt.classList.add("on"); cur.classList.remove("on"); };
    nxt.src = e.url;
    const d = new Date(e.date.replace(" ", "T") + "Z"), la = e.lat, lo = e.lon;
    $("#earth-cap").innerHTML = `<span class="mono">${eI + 1} / ${N}</span> ・ ${Fmt.md(d)} ${Fmt.hm(d)}撮影 ・ 中心 ${la == null ? "" : `${la >= 0 ? "北緯" : "南緯"}${Math.abs(la).toFixed(0)}° ${lo >= 0 ? "東経" : "西経"}${Math.abs(lo).toFixed(0)}°`}
      <br>NASAの衛星DSCOVRが、約150万km先から撮影した地球です。左右にスワイプで1枚ずつ見られます。`;
  }

  /* ---------- 月 ---------- */
  function moon() {
    const SYN = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
    const age = (((Date.now() - ref) / 86400000) % SYN + SYN) % SYN, p = age / SYN;
    const ill = (1 - Math.cos(2 * Math.PI * p)) / 2;
    const names = [[1.0, "新月"], [3.7, "三日月"], [6.4, "上弦前"], [8.4, "上弦の月"], [12.4, "十三夜"], [14.0, "小望月"], [16.4, "満月"],
      [18.4, "寝待月"], [21.4, "更待月"], [23.4, "下弦の月"], [27.6, "有明月"], [29.6, "新月"]];
    $("#moon-name").textContent = names.find(([d]) => age < d)[1];
    $("#moon-age").textContent = age.toFixed(1);
    $("#moon-ill").textContent = Math.round(ill * 100) + "%";
    const day = 86400000, full = new Date(Date.now() + ((p < .5 ? .5 - p : 1.5 - p) * SYN) * day), nw = new Date(Date.now() + (1 - p) * SYN * day);
    $("#moon-full").textContent = `${Fmt.md(full)}頃`;
    $("#moon-new").textContent = `${Fmt.md(nw)}頃`;

    const c = $("#moon"), g = c.getContext("2d"), r = 92, k = Math.cos(2 * Math.PI * p);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2);
    const glow = g.createRadialGradient(0, 0, r * .9, 0, 0, r * 1.2);
    glow.addColorStop(0, `rgba(255,245,215,${.25 * ill})`); glow.addColorStop(1, "rgba(255,245,215,0)");
    g.fillStyle = glow; g.beginPath(); g.arc(0, 0, r * 1.2, 0, 7); g.fill();
    g.fillStyle = "#1a1f2b"; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
    if (p >= .5) g.scale(-1, 1); // 欠けていく月は左側が光る
    const lit = g.createRadialGradient(-r * .3, -r * .3, r * .1, 0, 0, r);
    lit.addColorStop(0, "#fffaf0"); lit.addColorStop(1, "#d9d0b4");
    g.fillStyle = lit; g.beginPath();
    g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    if (k > 0) g.ellipse(0, 0, r * k, r, 0, Math.PI / 2, -Math.PI / 2, true);
    else g.ellipse(0, 0, r * -k, r, 0, Math.PI / 2, Math.PI * 1.5, false);
    g.fill();
    g.globalAlpha = .12; g.fillStyle = "#6b6450";
    [[-30, -20, 18], [25, 15, 22], [-10, 40, 12], [35, -35, 10], [-45, 25, 9]].forEach(([x, y, s]) => { g.beginPath(); g.arc(x, y, s, 0, 7); g.fill(); });
    g.globalAlpha = 1;
  }

  App.reg("space", {
    init,
    show() {
      visible = true;
      setTimeout(() => map.invalidateSize(), 60);
      if (Date.now() - lastFetch > 10 * 60 * 1000) fetchData();
      clearInterval(loopT); loopT = setInterval(fetchData, 10 * 60 * 1000);
      tickN = 0; tick();
    },
    hide() { visible = false; clearInterval(loopT); }
  });
})();
