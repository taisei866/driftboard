/* フライトレーダー */
(() => {
  const PLANE = '<svg viewBox="0 0 24 24"><path d="M12 1.6c.9 0 1.4.9 1.4 2V9l7.9 4.7v2.1l-7.9-2.4v5l2.3 1.8v1.7L12 21.1l-3.7.8v-1.7l2.3-1.8v-5l-7.9 2.4v-2.1L10.6 9V3.6c0-1.1.5-2 1.4-2z"/></svg>';
  const AIRLINES = {
    JAL: "日本航空", ANA: "全日空", ADO: "AIRDO", SKY: "スカイマーク", APJ: "ピーチ", JJP: "ジェットスター・ジャパン",
    SJO: "スプリング・ジャパン", SNJ: "ソラシドエア", FDA: "フジドリームエアラインズ", HAC: "北海道エアシステム",
    JTA: "日本トランスオーシャン航空", IBX: "IBEXエアラインズ", AKX: "ANAウイングス", JLJ: "J-AIR", NCA: "日本貨物航空",
    ORC: "オリエンタルエアブリッジ", TZP: "ZIPAIR", KAL: "大韓航空", AAR: "アシアナ航空", JNA: "ジンエアー", JJA: "チェジュ航空",
    TWB: "ティーウェイ航空", ABL: "エアプサン", ASV: "エアソウル", CPA: "キャセイパシフィック", HKE: "香港エクスプレス",
    EVA: "エバー航空", CAL: "チャイナエアライン", TTW: "タイガーエア台湾", SJX: "スターラックス航空", CCA: "中国国際航空",
    CES: "中国東方航空", CSN: "中国南方航空", CHH: "海南航空", CXA: "厦門航空", THA: "タイ国際航空", SIA: "シンガポール航空",
    VJC: "ベトジェット", HVN: "ベトナム航空", PAL: "フィリピン航空", CEB: "セブパシフィック", MAS: "マレーシア航空",
    UAL: "ユナイテッド航空", DAL: "デルタ航空", AAL: "アメリカン航空", HAL: "ハワイアン航空", ACA: "エア・カナダ",
    FDX: "フェデックス", UPS: "UPS", GTI: "アトラス航空", CKS: "カリッタ航空", QTR: "カタール航空", UAE: "エミレーツ航空",
    FIN: "フィンエアー", AFR: "エールフランス", DLH: "ルフトハンザ", BAW: "ブリティッシュ・エアウェイズ", KLM: "KLMオランダ航空",
    AFL: "アエロフロート", QFA: "カンタス航空", ANZ: "ニュージーランド航空", THY: "ターキッシュ エアラインズ",
    ETD: "エティハド航空", SWR: "スイス航空", AIC: "エア・インディア", CLX: "カーゴルクス", ABW: "エアブリッジカーゴ"
  };
  const RINGS = [25, 50, 100, 200];
  const OVERHEAD_KM = 6;

  let map, H, visible = false, pollT, sel = null, follow = false, QC = null, areaChanged = false, moveT;
  const planes = new Map(), routesC = new Map(), photoC = new Map(), alerted = new Map();

  const ground = d => d.alt_baro === "ground";
  const altFt = d => ground(d) ? 0 : (typeof d.alt_baro === "number" ? d.alt_baro : (d.alt_geom ?? null));
  const color = d => {
    if (ground(d)) return "#8a96ab";
    const a = Math.min(Math.max(altFt(d) ?? 0, 0), 45000);
    return `hsl(${28 + a / 45000 * 187} ${45 + a / 45000 * 10}% ${60 + a / 45000 * 9}%)`;
  };
  const csOf = d => (d.flight || "").trim() || d.r || d.hex.toUpperCase();
  const isFlightNo = c => /^[A-Z]{3}\d{1,4}[A-Z]?$/.test(c);
  const airline = d => {
    const c = (d.flight || "").trim().toUpperCase();
    return (isFlightNo(c) && AIRLINES[c.slice(0, 3)]) || d.ownOp || "";
  };
  const emerg = d => ["7500", "7600", "7700"].includes(d.squawk) || (d.emergency && d.emergency !== "none");
  const altTxt = d => ground(d) ? "地上" : altFt(d) == null ? "-" : `${Fmt.n(altFt(d) * 0.3048)}m`;
  const pos = p => p.cur || [p.d.lat, p.d.lon];
  const away = () => QC && Geo.dist(QC.lat, QC.lon, H.lat, H.lon) > 30;
  const ref = () => away() ? QC : H;   // 距離の基準：現在地付近なら現在地、よそを見ているなら地図の中心
  const distOf = p => { const [a, o] = pos(p); const r = ref(); return Geo.dist(r.lat, r.lon, a, o); };
  const homeDist = p => { const [a, o] = pos(p); return Geo.dist(H.lat, H.lon, a, o); };
  const route = p => { const r = routesC.get(csOf(p.d).toUpperCase()); return r || null; };
  const routeTxt = r => r ? r.codes.replace(/-/g, " → ") : "";

  function init() {
    H = App.home;
    map = darkMap("fmap").setView([H.lat, H.lon], 8);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.marker([H.lat, H.lon], { icon: L.divIcon({ className: "", html: '<div class="home-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false }).addTo(map);
    RINGS.forEach(km => {
      L.circle([H.lat, H.lon], { radius: km * 1000, color: "#4f9cf0", weight: 1, opacity: .3, dashArray: "4 6", fill: false, interactive: false }).addTo(map);
      L.marker(Geo.dest(H.lat, H.lon, 0, km), { icon: L.divIcon({ className: "ring-lbl", html: km + "km", iconSize: [40, 12], iconAnchor: [20, 14] }), interactive: false }).addTo(map);
    });
    map.on("click", () => select(null));
    map.on("dragstart", () => { follow = false; if (sel) renderDetail(); });
    map.on("zoomend", () => planes.forEach(style));
    $("#fl-filter-btn").onclick = e => { e.stopPropagation(); const b = $("#fl-filter"); b.hidden = !b.hidden; if (!b.hidden) filterUI(); };
    document.addEventListener("click", e => { const b = $("#fl-filter"); if (!b.hidden && !b.contains(e.target)) b.hidden = true; });
    countUI();
    map.on("moveend", () => { clearTimeout(moveT); moveT = setTimeout(area, 700); });
    QC = { lat: H.lat, lon: H.lon, nm: 160 };
    $("#fl-home").onclick = () => { follow = false; map.flyTo([H.lat, H.lon], 8); };
    $("#fl-list").onclick = e => { const r = e.target.closest("[data-k]"); if (r) { select(r.dataset.k); const p = planes.get(r.dataset.k); if (p) map.panTo(pos(p)); } };
    $("#fl-alert").onclick = e => { const k = e.currentTarget.dataset.k; if (k) { select(k); const p = planes.get(k); if (p) map.panTo(pos(p)); } };
    setInterval(tick, 1000);
    rInit();
    poll();
  }

  /* 地図を動かしたら、表示範囲の飛行機を取り直す */
  function area() {
    const c = map.getCenter(), b = map.getBounds();
    const nm = Math.max(30, Math.min(250, Math.round(Geo.dist(c.lat, c.lng, b.getNorth(), b.getEast()) / 1.852)));
    const moved = Geo.dist(c.lat, c.lng, QC.lat, QC.lon);
    if (moved < QC.nm * 1.852 * .15 && Math.abs(nm - QC.nm) / QC.nm < .3) return;
    QC = { lat: +c.lat.toFixed(3), lon: +c.lng.toFixed(3), nm };
    areaChanged = true; poll();
  }

  async function poll() {
    clearTimeout(pollT);
    const q = QC;
    try {
      const data = await api(`/api/flights?lat=${q.lat}&lon=${q.lon}&nm=${q.nm}`);
      if (q !== QC) return;   // 途中で範囲が変わった
      update(data);
      $("#fl-src").textContent = `${Fmt.hms(new Date())} 更新 ・ ${data.src}`;
    } catch (e) {
      $("#fl-stats").innerHTML = `<span style="color:var(--bad)">飛行機データを取得できません</span><br><small class="muted">${Data.hasProxy ? "提供元が混み合っています。自動で再試行します" : "中継サーバーが未設定です（README参照）"}</small>`;
    } finally {
      if (q === QC) pollT = setTimeout(poll, visible ? 5000 : 15000);
    }
  }

  function update(data) {
    const now = data.now;
    for (const d of data.ac) {
      if (d.lat == null || d.lon == null) continue;
      let p = planes.get(d.hex);
      if (!p) {
        p = { hex: d.hex, trail: [] };
        p.marker = L.marker([d.lat, d.lon], {
          icon: L.divIcon({ className: "ac-wrap", html: `<div class="ac"><div class="ac-i">${PLANE}</div><span></span></div>`, iconSize: [28, 28], iconAnchor: [14, 14] })
        }).addTo(map);
        p.marker.on("click", e => { L.DomEvent.stopPropagation(e); select(p.hex); });
        p.line = L.polyline([], { weight: 1.6, opacity: .35, interactive: false }).addTo(map);
        planes.set(d.hex, p);
      }
      p.d = d; p.tpos = now - (d.seen_pos ?? d.seen ?? 0); p.last = now; p.cur = null;
      const t = p.trail, lp = t[t.length - 1];
      if (!lp || lp[0] !== d.lat || lp[1] !== d.lon) { t.push([d.lat, d.lon]); if (t.length > 80) t.shift(); }
      p.marker.setLatLng([d.lat, d.lon]);
      p.line.setLatLngs(t);
      style(p);
    }
    const stale = areaChanged; areaChanged = false;
    for (const [k, p] of planes) if (now - p.last > 60 || (stale && p.last !== now)) {
      map.removeLayer(p.marker); map.removeLayer(p.line); planes.delete(k);
      if (sel === k) select(null);
    }
    fetchRoutes();
    renderStats(); renderList(); checkAlerts(); countUI();
    if (sel) renderDetail();
  }

  /* ---------- 絞り込み ---------- */
  const F = Object.assign({ kind: "all", alt: "all", vs: "all", flightOnly: false, q: "" }, Store.get("flFilter", {}));
  const FILTERS = {
    kind: [["all", "すべて"], ["large", "旅客機・貨物機"], ["small", "小型機"], ["heli", "ヘリコプター"]],
    alt: [["all", "すべて"], ["low", "〜3,000m"], ["mid", "3,000〜9,000m"], ["high", "9,000m〜"], ["ground", "地上"]],
    vs: [["all", "すべて"], ["up", "上昇中"], ["down", "降下中"], ["level", "巡航中"]]
  };
  function passes(p) {
    const d = p.d, cat = d.category || "", m = (altFt(d) || 0) * 0.3048, vr = d.baro_rate ?? d.geom_rate ?? 0;
    if (F.kind === "large" && !/^A[345]$/.test(cat)) return false;
    if (F.kind === "small" && !/^A[12]$/.test(cat)) return false;
    if (F.kind === "heli" && cat !== "A7") return false;
    if (F.alt === "ground" && !ground(d)) return false;
    if (F.alt !== "all" && F.alt !== "ground" && ground(d)) return false;
    if (F.alt === "low" && m > 3000) return false;
    if (F.alt === "mid" && (m < 3000 || m > 9000)) return false;
    if (F.alt === "high" && m < 9000) return false;
    if (F.vs === "up" && !(vr > 300)) return false;
    if (F.vs === "down" && !(vr < -300)) return false;
    if (F.vs === "level" && (ground(d) || Math.abs(vr) > 300)) return false;
    if (F.flightOnly && !isFlightNo((d.flight || "").trim().toUpperCase())) return false;
    if (F.q) { const q = F.q.toUpperCase(); if (![csOf(d), d.r || "", d.hex, d.t || ""].some(x => x.toUpperCase().includes(q))) return false; }
    return true;
  }
  const nFilters = () => ["kind", "alt", "vs"].filter(k => F[k] !== "all").length + (F.flightOnly ? 1 : 0) + (F.q ? 1 : 0);
  function filterUI() {
    const box = $("#fl-filter");
    box.innerHTML = `
      <div class="modal-h" style="font-size:15px"><span>絞り込み</span><button class="btn icon sm" id="ff-x" aria-label="閉じる">${ic("i-x", "sm")}</button></div>
      <div class="search-box"><svg class="ic"><use href="#i-search"/></svg><input id="ff-q" type="search" placeholder="便名・機体記号・機種（例：JAL、B738）" value="${esc(F.q)}"></div>
      ${Object.entries({ kind: "種類", alt: "高度", vs: "動き" }).map(([k, l]) => `
        <div class="ff-h">${l}</div><div class="chips">${FILTERS[k].map(([v, t]) => `<button class="chip ${F[k] === v ? "on" : ""}" data-k="${k}" data-v="${v}">${t}</button>`).join("")}</div>`).join("")}
      <div class="ff-h">その他</div><div class="chips"><button class="chip ${F.flightOnly ? "on" : ""}" data-k="flightOnly">便名のある機体だけ</button></div>
      <div class="ff-foot"><button class="btn sm" id="ff-reset">条件をクリア</button><span class="muted small" id="ff-count"></span></div>`;
    box.onclick = e => {
      e.stopPropagation();
      const b = e.target.closest("[data-k]");
      if (b) { if (b.dataset.k === "flightOnly") F.flightOnly = !F.flightOnly; else F[b.dataset.k] = b.dataset.v; applyFilter(); filterUI(); }
    };
    $("#ff-x").onclick = () => box.hidden = true;
    $("#ff-reset").onclick = () => { Object.assign(F, { kind: "all", alt: "all", vs: "all", flightOnly: false, q: "" }); applyFilter(); filterUI(); };
    let qt; $("#ff-q").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { F.q = e.target.value.trim(); applyFilter(); }, 250); };
    countUI();
  }
  function countUI() {
    const n = nFilters(), shown = [...planes.values()].filter(passes).length;
    $("#fl-filter-btn span").textContent = n ? `絞り込み（${n}）` : "絞り込み";
    $("#fl-filter-btn").classList.toggle("on", !!n);
    const c = $("#ff-count"); if (c) c.textContent = `${shown} / ${planes.size} 機を表示中`;
  }
  function applyFilter() {
    Store.set("flFilter", F);
    planes.forEach(style); renderList(); renderStats(); countUI();
    if (F.q) {   // 検索で1機に絞れたら、その機体へ移動
      const hit = [...planes.values()].filter(passes);
      if (hit.length === 1 && sel !== hit[0].hex) { select(hit[0].hex); map.panTo(pos(hit[0])); }
    }
  }

  function style(p) {
    const el = p.marker.getElement(); if (!el) return;
    const ok = passes(p) || sel === p.hex;
    el.style.display = ok ? "" : "none";
    p.line.setStyle({ opacity: ok ? .3 : 0 });
    if (!ok) return;
    const d = p.d, ac = el.firstChild, c = color(d), on = sel === p.hex;
    ac.style.setProperty("--c", c);
    ac.querySelector(".ac-i").style.transform = `rotate(${d.track ?? 0}deg)`;
    const sp = ac.querySelector("span");
    sp.textContent = csOf(d);
    sp.style.display = on || map.getZoom() >= 8 ? "" : "none";
    ac.classList.toggle("sel", on); ac.classList.toggle("emg", !!emerg(d)); ac.classList.toggle("gnd", ground(d));
    p.marker.setZIndexOffset(on ? 1000 : emerg(d) ? 900 : Math.round((altFt(d) || 0) / 100));
    p.line.setStyle({ color: on ? "#ffffff" : c, opacity: on ? .9 : .3, weight: on ? 2.5 : 1.5 });
  }

  function tick() {
    const ns = Date.now() / 1000;
    for (const p of planes.values()) {
      const d = p.d;
      if (ground(d) || !d.gs || d.track == null) continue;
      const dt = Math.min(Math.max(ns - p.tpos, 0), 45);
      p.cur = Geo.dest(d.lat, d.lon, d.track, d.gs * 1.852 * dt / 3600);
      p.marker.setLatLng(p.cur);
      if (follow && sel === p.hex && visible) map.panTo(p.cur, { animate: true, duration: .8 });
    }
  }

  async function fetchRoutes() {
    const need = [];
    for (const p of planes.values()) {
      const c = (p.d.flight || "").trim().toUpperCase();
      if (isFlightNo(c) && !routesC.has(c) && need.length < 40) { routesC.set(c, null); need.push({ callsign: c, lat: p.d.lat, lng: p.d.lon }); }
    }
    if (!need.length) return;
    try {
      const res = await api("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planes: need }) });
      for (const n of need) routesC.set(n.callsign, res[n.callsign] || false);
      renderList(); if (sel) renderDetail();
    } catch { for (const n of need) routesC.delete(n.callsign); }
  }

  function renderStats() {
    const air = [...planes.values()].filter(p => !ground(p.d) && passes(p));
    let near = null, hi = null;
    for (const p of air) {
      const dd = distOf(p);
      if (!near || dd < near.dd) near = { p, dd };
      if (!hi || (altFt(p.d) || 0) > (altFt(hi.d) || 0)) hi = p;
    }
    $("#fl-stats").innerHTML =
      `<span class="muted">${away() ? "地図の中心付近" : esc(H.name) + "付近"}</span><br><b>${air.length}</b> 機が飛行中` +
      (near ? `<br><span class="muted">最寄り</span> ${esc(csOf(near.p.d))} ・ ${Fmt.n(near.dd, 1)}km` : "") +
      (hi ? `<br><span class="muted">最高</span> ${esc(csOf(hi.d))} ・ ${altTxt(hi.d)}` : "");
  }

  function renderList() {
    const arr = [...planes.values()].filter(passes).map(p => ({ p, dd: distOf(p) })).sort((a, b) => a.dd - b.dd).slice(0, 30);
    $("#fl-list").innerHTML = arr.map(({ p, dd }) => {
      const r = route(p);
      return `<div class="fl-row ${sel === p.hex ? "sel" : ""}" data-k="${p.hex}">
        <div><span class="sw" style="background:${color(p.d)}"></span><b>${esc(csOf(p.d))}</b>
          <div class="rt">${esc(routeTxt(r) || airline(p.d) || p.d.t || "")}</div></div>
        <div class="mono">${altTxt(p.d)}</div><div class="mono muted">${Fmt.n(dd, 0)}km</div></div>`;
    }).join("") || (planes.size ? `<div class="empty">絞り込みの条件に合う機体がありません。</div>` : "") || `<div class="empty">この範囲には、位置を送信している機体がありません。地図を動かすと、その周辺の飛行機を表示します。</div>`;
  }

  function select(k) {
    const prev = sel; sel = k; follow = false;
    [prev, k].forEach(x => { const p = planes.get(x); if (p) style(p); });
    $$("#fl-list .fl-row").forEach(r => r.classList.toggle("sel", r.dataset.k === k));
    if (!k) { $("#fl-detail").hidden = true; return; }
    const p = planes.get(k);
    if (p && !photoC.has(k)) {
      photoC.set(k, null);
      api("/api/photo?hex=" + k).then(ph => { photoC.set(k, ph); if (sel === k) renderDetail(); }).catch(() => photoC.set(k, {}));
    }
    renderDetail();
  }

  function renderDetail() {
    const p = planes.get(sel), box = $("#fl-detail");
    if (!p) { box.hidden = true; return; }
    const d = p.d, r = route(p), ph = photoC.get(sel) || {}, [la, lo] = pos(p);
    const R0 = ref(), dd = Geo.dist(R0.lat, R0.lon, la, lo), brg = Geo.bearing(R0.lat, R0.lon, la, lo);
    const vr = d.baro_rate ?? d.geom_rate;
    const aps = r && r.airports && r.airports.length >= 2 ? r.airports : null;
    const rt = aps
      ? `<div class="fd-route"><div><b>${esc(aps[0].iata || aps[0].icao)}</b>${esc(aps[0].city || aps[0].name || "")}</div><div class="arrow"></div>
         <div style="text-align:right"><b>${esc(aps[aps.length - 1].iata || aps[aps.length - 1].icao)}</b>${esc(aps[aps.length - 1].city || aps[aps.length - 1].name || "")}</div></div>`
      : r ? `<div class="fd-route"><b>${esc(routeTxt(r))}</b></div>` : `<div class="muted small" style="margin:6px 0">経路情報なし</div>`;
    const wasHidden = box.hidden; box.hidden = false;
    if (wasHidden) reveal(box);
    box.innerHTML = `
      <div class="fd">
        ${ph.src ? `<img class="fd-photo" src="${esc(ph.src)}" alt="">` : `<div class="fd-photo">${ic("i-plane", "lg")}</div>`}
        <div style="min-width:0">
          <div class="fd-top"><div><div class="fd-cs">${esc(csOf(d))}</div>
            <div class="fd-al">${esc(airline(d))}${d.t ? " ・ " + esc(d.t) : ""}${d.desc ? `<br>${esc(d.desc)}` : ""}</div></div>
            <div class="fd-btns"><button class="btn sm ${follow ? "on" : ""}" id="fd-follow">${ic("i-follow", "sm")}${follow ? "追跡中" : "追跡"}</button><button class="btn sm icon" id="fd-close" aria-label="閉じる">${ic("i-x", "sm")}</button></div></div>
        </div>
      </div>
      ${rt}
      <div class="fd-grid">
        <div><small>高度</small><b class="mono">${altTxt(d)}</b></div>
        <div><small>対地速度</small><b class="mono">${d.gs != null ? Fmt.n(d.gs * 1.852) + "km/h" : "-"}</b></div>
        <div><small>針路</small><b class="mono">${d.track != null ? Math.round(d.track) + "° " + Geo.dir16(d.track) : "-"}</b></div>
        <div><small>昇降</small><b class="mono">${vr == null ? "-" : (vr > 64 ? "↑" : vr < -64 ? "↓" : "→") + Fmt.n(Math.abs(vr * 0.3048)) + "m/分"}</b></div>
        <div><small>${away() ? "中心から" : "ここから"}</small><b class="mono">${Fmt.n(dd, 1)}km</b></div>
        <div><small>方角</small><b>${Geo.dir16(brg)}</b></div>
        <div><small>機体記号</small><b>${esc(d.r || "-")}</b></div>
        <div><small>スコーク</small><b class="mono" style="${emerg(d) ? "color:var(--bad)" : ""}">${esc(d.squawk || "-")}</b></div>
      </div>
      ${ph.src ? `<div class="fd-credit">写真: <a href="${esc(ph.link)}" target="_blank" rel="noopener">© ${esc(ph.by || "")} / planespotters.net</a></div>` : ""}`;
    $("#fd-close").onclick = () => select(null);
    $("#fd-follow").onclick = () => { follow = !follow; if (follow) map.flyTo(pos(p), Math.max(map.getZoom(), 9)); renderDetail(); };
  }

  function checkAlerts() {
    const now = Date.now();
    for (const p of planes.values()) {
      const d = p.d;
      if (emerg(d) && !alerted.has("e" + p.hex)) {
        alerted.set("e" + p.hex, now);
        showAlert(p, `緊急コード ${d.squawk}：${csOf(d)}`, `${altTxt(d)}・ここから${Fmt.n(distOf(p), 0)}km`, true);
      }
      if (ground(d)) continue;
      const dd = homeDist(p);
      if (dd <= OVERHEAD_KM && now - (alerted.get(p.hex) || 0) > 20 * 60000) {
        alerted.set(p.hex, now);
        const r = route(p), aps = r && r.airports && r.airports.length >= 2 ? r.airports : null;
        const sub = [aps ? `${aps[0].city || aps[0].iata}発 ${aps[aps.length - 1].city || aps[aps.length - 1].iata}行き` : airline(d), altTxt(d)].filter(Boolean).join("・");
        showAlert(p, `真上を通過中：${csOf(d)}`, sub);
      }
    }
  }

  // 縦長の画面では詳細が地図の下に出るので、見える位置までスクロールする
  function reveal(el) { if (innerHeight > innerWidth) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80); }
  let alertT;
  function showAlert(p, title, sub, bad) {
    const a = $("#fl-alert"); a.classList.toggle("bad", !!bad);
    a.dataset.k = p.hex;
    a.innerHTML = `${esc(title)}<small>${esc(sub)}</small><button class="alert-x" aria-label="閉じる">${ic("i-x", "sm")}</button>`;
    a.hidden = false;
    a.querySelector(".alert-x").onclick = e => { e.stopPropagation(); a.hidden = true; };
    clearTimeout(alertT); alertT = setTimeout(() => a.hidden = true, 10000);
  }


  /* ---------- レーダー表示 ----------
     基準地点を中心に光の線が回り、線が通った機体だけが光って、ゆっくり残光を残して消えていく。
     機体の位置は地図表示と同じデータ（planes）を使う */
  const RANGES = [25, 50, 100, 200, 400];
  let radar = Store.get("flRadar", true), rng = Store.get("flRange", 100), rcv, rg, rRaf, trails = new Map(), lastTrail = 0;
  const SWEEP = 4.2;   // 1周の秒数
  function rInit() {
    rcv = $("#fradar"); rg = rcv.getContext("2d");
    const resize = () => { const b = rcv.parentNode.getBoundingClientRect(), dp = Math.min(devicePixelRatio || 1, 2); rcv.width = b.width * dp; rcv.height = b.height * dp; rcv.style.width = b.width + "px"; rcv.style.height = b.height + "px"; rg.setTransform(dp, 0, 0, dp, 0, 0); };
    new ResizeObserver(resize).observe(rcv.parentNode); resize();
    $("#fl-mode").onclick = () => setRadar(!radar);
    $("#fl-range").onclick = () => { rng = RANGES[(RANGES.indexOf(rng) + 1) % RANGES.length]; Store.set("flRange", rng); rangeUI(); };
    rcv.addEventListener("wheel", e => { e.preventDefault(); const i = RANGES.indexOf(rng) + (e.deltaY > 0 ? 1 : -1); rng = RANGES[Math.max(0, Math.min(RANGES.length - 1, i))]; Store.set("flRange", rng); rangeUI(); }, { passive: false });
    let pinch = null;
    rcv.addEventListener("touchstart", e => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
    rcv.addEventListener("touchmove", e => {
      if (!pinch || e.touches.length !== 2) return;
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), i = RANGES.indexOf(rng);
      if (d / pinch > 1.35 && i > 0) { rng = RANGES[i - 1]; pinch = d; rangeUI(); } else if (pinch / d > 1.35 && i < RANGES.length - 1) { rng = RANGES[i + 1]; pinch = d; rangeUI(); }
    }, { passive: true });
    rcv.addEventListener("touchend", () => { pinch = null; Store.set("flRange", rng); });
    rcv.addEventListener("click", e => {
      const r = rcv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 28;
      for (const p of planes.values()) { if (!passes(p)) continue; const q = rXY(p); if (!q) continue; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = p.hex; } }
      select(best);
    });
    setRadar(radar, true);
  }
  function setRadar(v, quiet) {
    radar = v; Store.set("flRadar", v);
    $(".fl-mapbox").classList.toggle("radar", v);
    $("#fl-mode").innerHTML = v ? `${ic("i-globe")}<span>地図</span>` : `${ic("i-orbit")}<span>レーダー</span>`;
    rangeUI();
    cancelAnimationFrame(rRaf); if (v) rRaf = requestAnimationFrame(rFrame);
    if (!v && !quiet) setTimeout(() => map.invalidateSize(), 50);
  }
  function rangeUI() { const b = $("#fl-range"); b.hidden = !radar; b.innerHTML = `<span class="mono">${rng}km</span>`; }
  let geo = null;
  function rXY(p) {
    if (!geo) return null;
    const [a, o] = pos(p), c = geo.c;
    const dx = (o - c.lon) * Math.cos(c.lat * Math.PI / 180) * 111.32, dy = (a - c.lat) * 110.57;
    const k = Math.hypot(dx, dy); if (k > rng * 1.04) return null;
    return [geo.cx + dx * geo.s, geo.cy - dy * geo.s, k, (Math.atan2(dx, dy) + Math.PI * 2) % (Math.PI * 2)];
  }
  function rFrame(t) {
    rRaf = requestAnimationFrame(rFrame);
    if (!visible || !radar) return;
    const W = rcv.clientWidth, Hh = rcv.clientHeight, R = Math.min(W, Hh) / 2 - 18, cx = W / 2, cy = Hh / 2, now = t / 1000;
    geo = { c: ref(), cx, cy, s: R / rng };
    const sw = (now / SWEEP % 1) * Math.PI * 2;   // 北から時計回り
    const g = rg;
    g.clearRect(0, 0, W, Hh);
    // 画面の地：中心ほどわずかに明るい
    const bgr = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
    bgr.addColorStop(0, "#071526"); bgr.addColorStop(1, "#02050a"); g.fillStyle = bgr; g.fillRect(0, 0, W, Hh);
    // 目盛り
    g.save(); g.translate(cx, cy);
    g.strokeStyle = "rgba(110,170,255,.16)"; g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { g.beginPath(); g.arc(0, 0, R * i / 4, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(Math.sin(a) * R * .06, -Math.cos(a) * R * .06); g.lineTo(Math.sin(a) * R, -Math.cos(a) * R); g.stroke(); }
    for (let i = 0; i < 72; i++) { const a = i * Math.PI / 36, l = i % 6 ? 5 : 11; g.beginPath(); g.moveTo(Math.sin(a) * R, -Math.cos(a) * R); g.lineTo(Math.sin(a) * (R + l), -Math.cos(a) * (R + l)); g.strokeStyle = "rgba(140,190,255,.35)"; g.stroke(); }
    g.fillStyle = "rgba(160,200,255,.55)"; g.font = "10px 'IBM Plex Mono',monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([n, d]) => { const a = d * Math.PI / 180; g.fillText(n, Math.sin(a) * (R + 22) * .93, -Math.cos(a) * (R + 22) * .93); });
    g.textAlign = "left"; g.fillStyle = "rgba(140,190,255,.4)";
    for (let i = 1; i <= 4; i++) g.fillText(`${Math.round(rng * i / 4)}`, 4, -R * i / 4 + 9);
    // 回る光の線（扇形の残光）
    const fan = g.createConicGradient ? g.createConicGradient(sw - Math.PI / 2 - .9, 0, 0) : null;
    if (fan) { fan.addColorStop(0, "rgba(90,168,255,0)"); fan.addColorStop(.1432, "rgba(90,168,255,.22)"); fan.addColorStop(.1433, "rgba(90,168,255,0)"); g.fillStyle = fan; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = "rgba(170,215,255,.9)"; g.lineWidth = 1.5; g.shadowColor = "#5aa8ff"; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(sw) * R, -Math.cos(sw) * R); g.stroke(); g.shadowBlur = 0;
    g.restore();
    // 中心（基準地点）
    g.fillStyle = "#5aa8ff"; g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
    // 機体：線が通った瞬間に光り、残光で消えていく
    const prevSw = rFrame.ps ?? sw; rFrame.ps = sw;
    const crossed = a => prevSw <= sw ? (a > prevSw && a <= sw) : (a > prevSw || a <= sw);
    if (now - lastTrail > 3) { lastTrail = now; for (const p of planes.values()) { const tr = trails.get(p.hex) || []; tr.push(pos(p)); if (tr.length > 14) tr.shift(); trails.set(p.hex, tr); } }
    g.font = "10.5px 'IBM Plex Mono',monospace"; g.textBaseline = "alphabetic";
    for (const p of planes.values()) {
      if (!passes(p)) continue;
      const q = rXY(p); if (!q) continue;
      if (crossed(q[3]) || p.hit == null) p.hit = now - (p.hit == null ? ((sw - q[3] + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * SWEEP : 0);
      const age = now - p.hit, lv = Math.max(0, Math.exp(-age / 2.2)), on = sel === p.hex, em = emerg(p.d);
      const col = em ? "255,110,95" : ground(p.d) ? "150,165,190" : "150,205,255";
      // 航跡（点々）
      const tr = trails.get(p.hex) || [];
      tr.forEach((ll, i) => { const z = rXY({ cur: ll, d: p.d }); if (!z) return; g.fillStyle = `rgba(${col},${(.05 + i / tr.length * .18) * (on ? 2 : 1)})`; g.fillRect(z[0] - 1, z[1] - 1, 2, 2); });
      const a = Math.max(lv, on ? .9 : .12);
      g.fillStyle = `rgba(${col},${a})`; g.shadowColor = `rgba(${col},1)`; g.shadowBlur = 14 * lv;
      g.beginPath(); g.arc(q[0], q[1], 2.6 + lv * 1.6, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      // 進行方向の短い線
      if (!ground(p.d) && p.d.track != null) { const tk = p.d.track * Math.PI / 180; g.strokeStyle = `rgba(${col},${a * .8})`; g.lineWidth = 1; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0] + Math.sin(tk) * 12, q[1] - Math.cos(tk) * 12); g.stroke(); }
      if (a > .22) { g.fillStyle = `rgba(${col},${Math.min(1, a + .1)})`; g.fillText(csOf(p.d), q[0] + 8, q[1] - 6); g.fillStyle = `rgba(${col},${a * .6})`; g.fillText(ground(p.d) ? "GND" : "FL" + String(Math.round((altFt(p.d) || 0) / 100)).padStart(3, "0"), q[0] + 8, q[1] + 6); }
      if (on) {   // 選んだ機体：四隅の括弧で囲む
        g.strokeStyle = "rgba(200,230,255,.95)"; g.lineWidth = 1.2; const b = 11;
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { g.beginPath(); g.moveTo(q[0] + sx * b, q[1] + sy * (b - 5)); g.lineTo(q[0] + sx * b, q[1] + sy * b); g.lineTo(q[0] + sx * (b - 5), q[1] + sy * b); g.stroke(); });
      }
    }
  }

  App.reg("flight", {
    init,
    show() { visible = true; setTimeout(() => map.invalidateSize(), 60); poll(); },
    hide() { visible = false; }
  });
})();
