/* 天気（Open-Meteo） */
(() => {
  let visible = false, data = null, last = 0, span = Store.get("wxSpan", 24), loopT;
  const WD = ["日", "月", "火", "水", "木", "金", "土"];

  function init() {
    $("#wx-span").onclick = e => {
      const b = e.target.closest("[data-h]"); if (!b) return;
      span = +b.dataset.h; Store.set("wxSpan", span); seg(); chart();
    };
    seg();
    addEventListener("resize", () => visible && chart());
  }
  function seg() { $$("#wx-span button").forEach(b => b.classList.toggle("on", +b.dataset.h === span)); }

  async function load() {
    try { data = await api("/api/forecast"); last = Date.now(); render(); }
    catch (e) {
      console.error(e);
      $("#wx-now").innerHTML = `<div class="empty">天気を取得できませんでした。<br><small class="mono">${esc(e.message || e)}</small><br><button class="btn sm" id="wx-retry" style="margin-top:8px">もう一度</button></div>`;
      $("#wx-retry").onclick = load;
    }
  }

  const hh = s => s.slice(11, 16);
  const dirTxt = d => d == null ? "" : Geo.dir16(d);

  function render() {
    if (typeof Inst !== "undefined") Inst.wx.set(data);
    const c = data.current, d = data.daily;
    const [icn, lb] = wxInfo(c.weather_code, c.is_day);
    $("#wx-place").textContent = `${App.home.name} ・ ${hh(c.time)} 時点`;
    $("#wx-now").innerHTML = `
      <div class="wx-hero">
        <svg class="ic wx-big"><use href="#${icn}"/></svg>
        <div><div class="wx-temp mono">${Math.round(c.temperature_2m)}<small>°C</small></div>
          <div class="wx-lb">${lb}</div>
          <div class="muted small">最高 <b class="mono">${Math.round(d.temperature_2m_max[0])}°</b> ・ 最低 <b class="mono">${Math.round(d.temperature_2m_min[0])}°</b></div></div>
      </div>
      <div class="wx-stats">
        <div><small>体感</small><b class="mono">${c.apparent_temperature != null ? Math.round(c.apparent_temperature) + "°" : "-"}</b></div>
        <div><small>湿度</small><b class="mono">${c.relative_humidity_2m}%</b></div>
        <div><small>風</small><b class="mono">${(c.wind_speed_10m / 3.6).toFixed(1)}m/s</b><span class="muted small"> ${dirTxt(c.wind_direction_10m)}</span></div>
        <div><small>降水量（1時間）</small><b class="mono">${c.precipitation != null ? c.precipitation + "mm" : "-"}</b></div>
        <div><small>気圧</small><b class="mono">${c.pressure_msl != null ? Math.round(c.pressure_msl) + "hPa" : "-"}</b></div>
        <div><small>UV指数（最大）</small><b class="mono">${d.uv_index_max && d.uv_index_max[0] != null ? d.uv_index_max[0].toFixed(0) : "-"}</b></div>
        <div><small>日の出</small><b class="mono">${hh(d.sunrise[0])}</b></div>
        <div><small>日の入り</small><b class="mono">${hh(d.sunset[0])}</b></div>
      </div>`;

    // 7日間
    const tmin = Math.min(...d.temperature_2m_min), tmax = Math.max(...d.temperature_2m_max), rng = Math.max(1, tmax - tmin);
    $("#wx-days").innerHTML = d.time.map((t, i) => {
      const dt = new Date(t + "T00:00"), [di] = wxInfo(d.weather_code[i], 1);
      const lo = d.temperature_2m_min[i], hi = d.temperature_2m_max[i];
      return `<div class="wx-day">
        <span class="wx-d">${i === 0 ? "今日" : i === 1 ? "明日" : `${dt.getMonth() + 1}/${dt.getDate()}`}<small>（${WD[dt.getDay()]}）</small></span>
        <svg class="ic"><use href="#${di}"/></svg>
        <span class="wx-pop mono">${d.precipitation_probability_max[i] ?? "-"}%</span>
        <span class="mono wx-lo">${Math.round(lo)}°</span>
        <span class="wx-bar"><i style="left:${(lo - tmin) / rng * 100}%;right:${(tmax - hi) / rng * 100}%"></i></span>
        <span class="mono wx-hi">${Math.round(hi)}°</span>
      </div>`;
    }).join("");
    chart();
  }

  /* 気温の折れ線＋降水確率の棒グラフ（Canvas） */
  function chart() {
    if (!data) return;
    const h = data.hourly, now = Date.now();
    // 時刻はその場所の現地時刻。端末の時差に関係なく「現地の今」から表示する
    const loc = new Date(now + data.utc_offset_seconds * 1000).toISOString().slice(0, 13);
    const s = Math.max(0, h.time.findIndex(t => t.slice(0, 13) >= loc));
    const idx = Array.from({ length: span }, (_, k) => s + k).filter(i => i < h.time.length);
    const cv = $("#wx-chart"), dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const top = 22, bot = 40, ph = H - top - bot, n = idx.length, pad = 16, bw = (W - pad * 2) / n;
    const temps = idx.map(i => h.temperature_2m[i]), lo = Math.min(...temps) - 1, hi = Math.max(...temps) + 1;
    const y = t => top + (1 - (t - lo) / (hi - lo)) * ph * .78;
    const css = getComputedStyle(document.documentElement), acc = css.getPropertyValue("--acc").trim(), mut = css.getPropertyValue("--mut").trim(), line = css.getPropertyValue("--line2").trim();

    // 夜の時間帯を薄く
    idx.forEach((i, k) => { if (!h.is_day[i]) { g.fillStyle = "rgba(255,255,255,.025)"; g.fillRect(pad + k * bw, 0, bw + .5, H - bot + 6); } });
    // 降水確率
    idx.forEach((i, k) => {
      const p = h.precipitation_probability[i] || 0; if (!p) return;
      const bh = p / 100 * ph * .45;
      g.fillStyle = "rgba(79,156,240,.28)"; g.fillRect(pad + k * bw + bw * .18, top + ph - bh, bw * .64, bh);
    });
    // 気温
    g.strokeStyle = acc; g.lineWidth = 2; g.lineJoin = "round"; g.beginPath();
    idx.forEach((i, k) => { const x = pad + k * bw + bw / 2, yy = y(h.temperature_2m[i]); k ? g.lineTo(x, yy) : g.moveTo(x, yy); });
    g.stroke();
    // ラベル
    const step = n > 30 ? 6 : W < 520 ? 3 : 2;
    g.font = `500 11px "IBM Plex Mono",monospace`; g.textAlign = "center";
    idx.forEach((i, k) => {
      const x = pad + k * bw + bw / 2;
      if (k % step === 0) {
        g.fillStyle = "#e8eaed"; g.fillText(`${Math.round(h.temperature_2m[i])}°`, x, y(h.temperature_2m[i]) - 8);
        g.fillStyle = acc; g.beginPath(); g.arc(x, y(h.temperature_2m[i]), 2.5, 0, 7); g.fill();
        g.fillStyle = mut; g.fillText(h.time[i].slice(11, 13) === "00" ? `${+h.time[i].slice(8, 10)}日` : `${+h.time[i].slice(11, 13)}時`, x, H - bot + 18);
        const p = h.precipitation_probability[i];
        if (p) { g.fillStyle = "rgba(140,190,245,.9)"; g.fillText(`${p}%`, x, H - bot + 33); }
      }
    });
    g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, H - bot + 4); g.lineTo(W, H - bot + 4); g.stroke();

    // 3時間ごとのアイコン
    $("#wx-icons").innerHTML = idx.map((i, k) => {
      if (k % step) return "";
      const [icn] = wxInfo(h.weather_code[i], h.is_day[i]);
      return `<svg class="ic" style="left:${pad + k * bw + bw / 2 - 10}px"><use href="#${icn}"/></svg>`;
    }).join("");
  }

  App.reg("weather", {
    init,
    show() {
      visible = true;
      if (Date.now() - last > 10 * 60000) load(); else setTimeout(chart, 50);
      clearInterval(loopT); loopT = setInterval(load, 15 * 60000);
    },
    hide() { visible = false; clearInterval(loopT); }
  });
})();
