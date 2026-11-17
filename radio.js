/* 📻 ワールドラジオ */
(() => {
  const TAGS = [["", "すべて"], ["pop", "ポップ"], ["rock", "ロック"], ["jazz", "ジャズ"], ["classical", "クラシック"],
    ["news", "ニュース"], ["lofi", "Lo-Fi"], ["chillout", "チル"], ["electronic", "エレクトロ"], ["anime", "アニメ"],
    ["ambient", "アンビエント"], ["80s", "80年代"], ["hip hop", "ヒップホップ"], ["country", "カントリー"], ["reggae", "レゲエ"]];
  const KEEP = ["stationuuid", "name", "url_resolved", "url", "favicon", "tags", "country", "countrycode", "state", "language", "codec", "bitrate", "hls", "geo_lat", "geo_long"];
  let regionJa; try { regionJa = new Intl.DisplayNames(["ja"], { type: "region" }); } catch {}
  const cName = (cc, fb) => { try { return (cc && regionJa?.of(cc.toUpperCase())) || fb || ""; } catch { return fb || ""; } };

  let map, pins, list = [], cur = Store.get("rdLast", null), mode = Store.get("rdMode", "world"),
    cc = Store.get("rdCC", "JP"), tag = Store.get("rdTag", ""), favs = Store.get("rdFavs", []),
    vol = Store.get("rdVol", 0.8), auto = Store.get("rdAuto", 0), q = "";
  let fails = 0, ctx, analyser, freq, active = null, viz = false, token = 0, watchdog, startedAt = 0, playing = false, visible = false;

  const aV = new Audio(); aV.crossOrigin = "anonymous"; aV.preload = "none";
  const aD = new Audio(); aD.preload = "none";

  function init() {
    map = darkMap("rmap", { minZoom: 1 }).setView([30, 140], 2);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    pins = L.layerGroup().addTo(map);

    $("#rd-tagchips").innerHTML = TAGS.map(([v, l]) => `<button class="chip" data-tag="${v}">${l}</button>`).join("");
    $("#rd-tagchips").onclick = e => { const b = e.target.closest("[data-tag]"); if (!b) return; tag = b.dataset.tag; Store.set("rdTag", tag); syncUI(); load(); };
    $("#rd-modes").onclick = e => { const b = e.target.closest("[data-mode]"); if (!b) return; mode = b.dataset.mode; Store.set("rdMode", mode); syncUI(); if (mode !== "search" || q) load(); else { list = []; render(); } };
    $("#rd-country").onchange = e => { cc = e.target.value; Store.set("rdCC", cc); load(); };
    let qt; $("#rd-q").oninput = e => { q = e.target.value.trim(); clearTimeout(qt); qt = setTimeout(() => q.length >= 2 && load(), 600); };
    $("#rd-q").onkeydown = e => { if (e.key === "Enter") { q = e.target.value.trim(); load(); } };
    $("#rd-list").onclick = e => {
      const r = e.target.closest("[data-i]"); if (!r) return;
      const st = list[+r.dataset.i];
      if (e.target.closest(".star")) { toggleFav(st); return; }
      play(st);
    };
    $("#rd-play").onclick = () => playing ? stop() : cur ? play(cur) : next();
    $("#rd-next").onclick = () => next();
    $("#rd-star").onclick = () => cur && toggleFav(cur);
    const v = $("#rd-vol"); v.value = vol;
    v.oninput = () => { vol = +v.value; aV.volume = aD.volume = vol; Store.set("rdVol", vol); };
    const a = $("#rd-auto"); a.value = auto;
    a.onchange = () => { auto = +a.value; Store.set("rdAuto", auto); startedAt = Date.now(); toast(auto ? `${auto}分ごとに別の局へ切り替えます` : "自動切替をオフにしました"); };

    [aV, aD].forEach(el => {
      el.addEventListener("playing", () => { if (el !== active) return; clearTimeout(watchdog); playing = true; fails = 0; state(); });
      el.addEventListener("waiting", () => { if (el === active) setState("バッファ中…"); });
      el.addEventListener("error", () => { if (el === active && el.getAttribute("src")) fail(); });
      el.addEventListener("ended", () => { if (el === active) fail(); });
    });
    setInterval(() => { if (auto && playing && Date.now() - startedAt > auto * 60000) next(); }, 5000);

    countries();
    syncUI(); renderNow(); load();
    requestAnimationFrame(draw);
  }

  async function countries() {
    try {
      const cs = (await api("/api/radio/countries")).filter(c => c.stationcount >= 5 && c.iso_3166_1);
      cs.sort((a, b) => (b.iso_3166_1 === "JP") - (a.iso_3166_1 === "JP") || b.stationcount - a.stationcount);
      $("#rd-country").innerHTML = cs.map(c =>
        `<option value="${c.iso_3166_1}">${Geo.flag(c.iso_3166_1)} ${esc(cName(c.iso_3166_1, c.name))}（${c.stationcount}局）</option>`).join("");
      $("#rd-country").value = cc;
    } catch { $("#rd-country").innerHTML = `<option value="JP">🇯🇵 日本</option>`; }
  }

  function syncUI() {
    $$("#rd-modes .chip").forEach(b => b.classList.toggle("on", b.dataset.mode === mode));
    $$("#rd-tagchips .chip").forEach(b => b.classList.toggle("on", b.dataset.tag === tag));
    $("#rd-country-row").hidden = mode !== "country";
    $("#rd-search-row").hidden = mode !== "search";
    $("#rd-tagchips").hidden = mode === "fav";
    $("#rd-list-h").textContent = { world: "世界のランダムな局", country: "人気の局", fav: "お気に入り", search: "検索結果" }[mode];
  }

  async function load() {
    const t = tag ? "&tag=" + encodeURIComponent(tag) : "";
    $("#rd-list").innerHTML = `<div class="muted small" style="padding:10px">読み込み中…</div>`;
    try {
      let res;
      if (mode === "fav") res = favs;
      else if (mode === "world") res = await api(`/api/radio/search?order=random&limit=90&has_geo_info=true${t}`);
      else if (mode === "country") res = await api(`/api/radio/search?countrycode=${cc}&order=clickcount&reverse=true&limit=150${t}`);
      else res = await api(`/api/radio/search?name=${encodeURIComponent(q)}&order=clickcount&reverse=true&limit=100${t}`);
      const seen = new Set();
      list = res.filter(s => {
        const k = (s.name || "").trim().toLowerCase() + "|" + s.countrycode;
        if (!s.name || seen.has(k) || /WMA/i.test(s.codec || "")) return false;
        seen.add(k); return true;
      });
    } catch { list = []; toast("局リストを取得できませんでした"); }
    render();
  }

  const slim = st => Object.fromEntries(KEEP.map(k => [k, st[k]]));
  const isFav = st => st && favs.some(f => f.stationuuid === st.stationuuid);
  function toggleFav(st) {
    if (isFav(st)) favs = favs.filter(f => f.stationuuid !== st.stationuuid);
    else favs.unshift(slim(st));
    Store.set("rdFavs", favs);
    toast(isFav(st) ? `⭐ ${st.name} をお気に入りに追加` : `お気に入りから外しました`);
    if (mode === "fav") { list = favs.slice(); }
    render(); renderNow();
  }

  function render() {
    $("#rd-count").textContent = list.length ? `${list.length}局` : "";
    $("#rd-list").innerHTML = list.map((s, i) => `
      <div class="st-row ${cur && s.stationuuid === cur.stationuuid ? "on" : ""}" data-i="${i}">
        ${s.favicon ? `<img src="${esc(s.favicon)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=ph>📻</div>'">` : `<div class="ph">📻</div>`}
        <div style="min-width:0"><div class="nm">${esc(s.name)}</div>
          <div class="sub">${Geo.flag(s.countrycode)} ${esc(cName(s.countrycode, s.country))}${s.state ? " ・ " + esc(s.state) : ""} ・ ${esc((s.tags || "").split(",").slice(0, 3).join(", "))}</div></div>
        <button class="star" aria-label="お気に入り">${isFav(s) ? "★" : "☆"}</button>
      </div>`).join("") || `<div class="muted small" style="padding:10px">${mode === "fav" ? "☆でお気に入りに追加できます" : mode === "search" ? "2文字以上入力してください" : "局が見つかりませんでした"}</div>`;
    pins.clearLayers();
    list.forEach(s => {
      if (s.geo_lat == null || s.geo_long == null) return;
      const on = cur && s.stationuuid === cur.stationuuid;
      L.marker([s.geo_lat, s.geo_long], {
        icon: L.divIcon({ className: "", html: `<div class="st-pin ${on ? "on" : ""}"></div>`, iconSize: on ? [18, 18] : [10, 10], iconAnchor: on ? [9, 9] : [5, 5] }),
        zIndexOffset: on ? 1000 : 0
      }).bindTooltip(esc(s.name), { direction: "top", offset: [0, -6] }).on("click", () => play(s)).addTo(pins);
    });
  }

  function renderNow() {
    const img = $("#rd-fav"), ph = $("#rd-fav-ph");
    if (cur && cur.favicon) { img.hidden = false; ph.hidden = true; img.src = cur.favicon; img.onerror = () => { img.hidden = true; ph.hidden = false; }; }
    else { img.hidden = true; ph.hidden = false; }
    $("#rd-name").textContent = cur ? cur.name : "局を選んでください";
    $("#rd-place").textContent = cur ? `${Geo.flag(cur.countrycode)} ${cName(cur.countrycode, cur.country)}${cur.state ? " ・ " + cur.state : ""}${cur.language ? " ・ " + cur.language : ""}` : "地図のピンや一覧から選べます";
    $("#rd-tags").innerHTML = cur ? (cur.tags || "").split(",").filter(Boolean).slice(0, 6).map(t => `<span>${esc(t)}</span>`).join("") : "";
    $("#rd-star").textContent = isFav(cur) ? "★" : "☆";
    $("#rd-play").textContent = playing ? "■" : "▶";
    if (!playing) setState(cur ? "▶ で再生" : "");
  }

  function setState(t) { $("#rd-state").textContent = t; }
  function state() {
    $("#rd-play").textContent = "■";
    const q = [cur.codec, cur.bitrate ? cur.bitrate + "kbps" : ""].filter(Boolean).join(" ");
    setState(`● 再生中 ${q}${viz ? "" : "（直接再生のため波形表示なし）"}`);
  }

  function ensureCtx() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .78;
      freq = new Uint8Array(analyser.frequencyBinCount);
      ctx.createMediaElementSource(aV).connect(analyser); analyser.connect(ctx.destination);
    } catch { ctx = null; }
  }

  function silence() { [aV, aD].forEach(a => { a.pause(); a.removeAttribute("src"); a.load(); }); }

  function play(st, direct = false) {
    if (!st) return;
    const my = ++token;
    clearTimeout(watchdog); silence(); playing = false;
    cur = slim(st); Store.set("rdLast", cur); renderNow(); render();
    if (st.geo_lat != null && visible) map.flyTo([st.geo_lat, st.geo_long], Math.max(map.getZoom(), 4), { duration: 1.2 });
    const u = st.url_resolved || st.url;
    const hls = st.hls === 1 || /\.m3u8(\?|$)/i.test(u);
    if (!direct && !hls) { ensureCtx(); }
    viz = !direct && !hls && !!ctx;
    active = viz ? aV : aD;
    active.volume = vol;
    active.src = u;   // 波形は配信元がCORSを許可している局のみ（だめなら直接再生に切替）
    setState("接続中…");
    watchdog = setTimeout(() => { if (my === token && !playing) fail(); }, 15000);
    active.play().catch(() => { if (my === token) fail(); });
    startedAt = Date.now();
    if (!direct) api("/api/radio/click?id=" + encodeURIComponent(st.stationuuid)).catch(() => {});
  }

  let failedTok = -1;
  function fail() {
    if (failedTok === token) return;   // 同じ再生試行での二重処理を防ぐ
    failedTok = token;
    const my = token;
    clearTimeout(watchdog);
    if (active === aV) { play(cur, true); return; }      // 中継で失敗 → 直接再生で再挑戦
    playing = false; silence(); renderNow();
    setState("この局は再生できませんでした");
    fails++;
    if ((mode === "world" || auto) && fails < 5) { toast("再生できない局だったので次へ進みます"); setTimeout(() => { if (my === token) next(); }, 1500); }
    else if (fails >= 5) { fails = 0; token++; toast("再生できない局が続いたため停止しました。通信状態を確認してください", 5000); }
    else toast("この局は再生できませんでした");
  }

  function stop() { token++; clearTimeout(watchdog); silence(); playing = false; renderNow(); }

  async function next() {
    let pool = list.filter(s => !cur || s.stationuuid !== cur.stationuuid);
    if (!pool.length && mode === "world") { await load(); pool = list; }
    if (!pool.length) { toast("一覧に局がありません"); return; }
    play(pool[Math.floor(Math.random() * pool.length)]);
  }

  /* ビジュアライザー */
  const cv = $("#rd-viz"), g = cv.getContext("2d"), bars = new Float32Array(48);
  function draw() {
    requestAnimationFrame(draw);
    if (!visible) return;
    const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const live = playing && viz && analyser && active === aV;
    if (live) analyser.getByteFrequencyData(freq);
    const n = bars.length, bw = w / n;
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#39d0ff"); grad.addColorStop(.6, "#7c5cff"); grad.addColorStop(1, "#ffb547");
    g.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const bin = Math.min(freq ? freq.length - 1 : 0, Math.floor(Math.pow(i / n, 1.6) * 100) + 1);
      const target = live ? freq[bin] / 255 : 0;
      bars[i] += (target - bars[i]) * (target > bars[i] ? .5 : .12);
      const bh = Math.max(2, bars[i] * (h - 4));
      const x = i * bw + 1.5;
      g.globalAlpha = .9; g.beginPath(); g.roundRect ? g.roundRect(x, h - bh, bw - 3, bh, 2) : g.rect(x, h - bh, bw - 3, bh); g.fill();
    }
    g.globalAlpha = 1;
    if (playing && !viz) { g.fillStyle = "rgba(138,150,171,.8)"; g.font = "12px sans-serif"; g.textAlign = "center"; g.fillText("この局は波形を表示できません（直接再生中）", w / 2, h / 2); }
  }

  App.reg("radio", {
    init,
    show() { visible = true; setTimeout(() => map.invalidateSize(), 60); },
    hide() { visible = false; }
  });
})();
