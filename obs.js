/* 今夜、星が見える天文台：世界の天文台と自分の場所の「雲・月・空の暗さ」を比べる */
(() => {
  const SITES = [
    { n: "マウナケア", p: "アメリカ・ハワイ（すばる望遠鏡など）", lat: 19.8253, lon: -155.472, alt: 4200 },
    { n: "パラナル", p: "チリ・アタカマ砂漠（VLT）", lat: -24.6272, lon: -70.4042, alt: 2635 },
    { n: "ラ・パルマ", p: "スペイン・カナリア諸島", lat: 28.7569, lon: -17.8925, alt: 2396 },
    { n: "キットピーク", p: "アメリカ・アリゾナ州", lat: 31.9583, lon: -111.5967, alt: 2096 },
    { n: "サイディング・スプリング", p: "オーストラリア", lat: -31.2733, lon: 149.0617, alt: 1165 },
    { n: "サザーランド", p: "南アフリカ（SALT）", lat: -32.3794, lon: 20.8117, alt: 1798 },
    { n: "ハンレ", p: "インド・ラダック", lat: 32.7794, lon: 78.9642, alt: 4500 },
    { n: "岡山天文台", p: "日本・岡山県（せいめい望遠鏡）", lat: 34.5764, lon: 133.5939, alt: 355 },
    { n: "木曽観測所", p: "日本・長野県", lat: 35.7972, lon: 137.6253, alt: 1130 },
    { n: "なよろ市立天文台", p: "日本・北海道名寄市", lat: 44.3747, lon: 142.4836, alt: 150 }
  ];
  let visible = false, last = 0, loopT, rows = [];

  function init() {}
  const barCol = cc => { const k = Math.min(1, cc / 100); return `rgb(${Math.round(79 + (58 - 79) * k)},${Math.round(156 + (63 - 156) * k)},${Math.round(240 + (72 - 240) * k)})`; };

  const sunAlt = (o, d) => { const e = Astronomy.Equator("Sun", d, o, true, true); return Astronomy.Horizon(d, o, e.ra, e.dec, "normal").altitude; };
  const moonAlt = (o, d) => { const e = Astronomy.Equator("Moon", d, o, true, true); return Astronomy.Horizon(d, o, e.ra, e.dec, "normal").altitude; };

  async function load() {
    const H = App.home, all = [{ n: H.name, p: "あなたの場所", lat: H.lat, lon: H.lon, alt: 30, home: true }, ...SITES];
    try {
      const res = await api(`/api/clouds?lat=${all.map(s => s.lat).join(",")}&lon=${all.map(s => s.lon).join(",")}`);
      last = Date.now();
      rows = all.map((s, i) => evaluate(s, res[i]));
      render();
    } catch (e) {
      $("#obs-list").innerHTML = `<div class="empty">雲の予報を取得できませんでした。<br><small class="mono">${esc(e.message || e)}</small></div>`;
    }
  }

  /* 1時間ごとに「暗い（太陽高度-18°以下）・雲が少ない・月が沈んでいる」を調べる */
  function evaluate(s, w) {
    const o = new Astronomy.Observer(s.lat, s.lon, s.alt), now = Date.now(), ill = Astronomy.Illumination("Moon", new Date()).phase_fraction;
    const off = (w && w.utc_offset_seconds || 0) * 1000, tz = w && w.timezone;
    const hours = [];
    if (w && w.hourly) w.hourly.time.forEach((t, i) => {
      const at = Date.parse(t + ":00Z") - off;
      if (at < now - 3600e3 || at > now + 24 * 3600e3) return;
      const d = new Date(at), sa = sunAlt(o, d), ma = moonAlt(o, d), cc = w.hourly.cloud_cover[i];
      hours.push({ at, sa, ma, cc, dark: sa < -18, good: sa < -18 && cc <= 25 });
    });
    const d0 = new Date(), sa0 = sunAlt(o, d0), ma0 = moonAlt(o, d0), cc0 = w && w.current ? w.current.cloud_cover : null;
    // 今の状態
    let state, score;
    if (sa0 > -6) { state = sa0 > 0 ? "昼間" : "夕暮れ・明け方"; score = 0; }
    else if (sa0 > -18) { state = "薄明（空がまだ少し明るい）"; score = 1; }
    else if (cc0 == null) { state = "夜"; score = 2; }
    else if (cc0 <= 20) { state = ma0 > 0 && ill > .5 ? "快晴・ただし月明かり" : "快晴・星がよく見える"; score = ma0 > 0 && ill > .5 ? 4 : 5; }
    else if (cc0 <= 50) { state = "ところどころ雲"; score = 3; }
    else { state = "曇り"; score = 1.5; }
    // 今夜の好条件の時間帯（連続した最長区間）
    let best = null, cur = null;
    for (const h of hours) {
      if (h.good) { cur = cur ? { ...cur, end: h.at, moonless: cur.moonless && h.ma < 0 } : { start: h.at, end: h.at, moonless: h.ma < 0 }; if (!best || cur.end - cur.start > best.end - best.start) best = cur; }
      else cur = null;
    }
    return { s, tz, hours, sa0, ma0, cc0, ill, state, score, best };
  }

  const hmTz = (t, tz) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined });
  const lvl = sc => sc >= 5 ? "ok" : sc >= 4 ? "ok2" : sc >= 3 ? "warn" : sc >= 2 ? "" : "off";

  function render() {
    const sorted = rows.slice().sort((a, b) => (b.s.home - a.s.home) || b.score - a.score || (b.best ? 1 : 0) - (a.best ? 1 : 0));
    const top = rows.filter(r => !r.s.home && r.score >= 4).sort((a, b) => b.score - a.score || (a.cc0 ?? 100) - (b.cc0 ?? 100))[0];
    $("#obs-top").innerHTML = top
      ? `いま一番星がよく見えているのは<br><b>${esc(top.s.n)}</b>（${esc(top.s.p)}）<br><span class="muted small">現地 ${hmTz(Date.now(), top.tz)} ・ 雲 ${top.cc0}% ・ ${esc(top.state)}</span>`
      : `いま、晴れた夜を迎えている天文台はありません。<br><span class="muted small">下の一覧で、今夜の好条件の時間帯を確認できます。</span>`;
    $("#obs-list").innerHTML = sorted.map((r, i) => {
      const bars = r.hours.map(h => `<i class="${h.sa > -6 ? "day" : h.dark ? "" : "tw"}" style="background:${barCol(h.cc)}" title="${hmTz(h.at, r.tz)} 雲${h.cc}%"></i>`).join("");
      const win = r.best
        ? `今夜の好条件：<b class="mono">${hmTz(r.best.start, r.tz)}〜${hmTz(r.best.end + 3600e3, r.tz)}</b>（現地）${r.best.moonless ? " ・ 月なし" : ""}`
        : "これから24時間、好条件（暗くて雲が少ない）の時間帯はありません";
      return `<div class="obs-card ${r.s.home ? "home" : ""}" data-i="${i}">
        <div class="obs-top">
          <div style="min-width:0"><div class="obs-name">${esc(r.s.n)}${r.s.home ? `<span class="here">現在地</span>` : ""}</div><div class="muted small obs-place">${esc(r.s.p)}</div></div>
          <div class="obs-now"><span class="mono">${hmTz(Date.now(), r.tz)}</span><span class="badge ${lvl(r.score)}">${esc(r.state)}</span></div>
        </div>
        <div class="obs-stats">
          <span>雲 <b class="mono">${r.cc0 ?? "-"}%</b></span>
          <span>月 <b class="mono">${Math.round(r.ill * 100)}%</b> ${r.ma0 > 0 ? "（出ている）" : "（沈んでいる）"}</span>
          ${r.s.alt ? `<span>標高 <b class="mono">${Fmt.n(r.s.alt)}m</b></span>` : ""}
        </div>
        <div class="obs-bars" aria-label="24時間の雲の量">${bars}</div>
        <div class="obs-axis muted"><span>今</span><span>+12時間</span><span>+24時間</span></div>
        <div class="small obs-win">${win}</div>
      </div>`;
    }).join("");
  }

  App.reg("obs", {
    init,
    show() {
      visible = true;
      if (Date.now() - last > 15 * 60000) load(); else render();
      clearInterval(loopT); loopT = setInterval(() => visible && load(), 20 * 60000);
    },
    hide() { visible = false; clearInterval(loopT); }
  });
})();
