/* 場所の設定（初回・ヘッダーの場所ボタン） */
const Setup = (() => {
  let timer;
  function init() {
    $("#su-close").onclick = close;
    $("#su-geo").onclick = geo;
    $("#su-q").oninput = e => { clearTimeout(timer); const q = e.target.value.trim(); timer = setTimeout(() => q.length >= 2 && search(q), 600); };
    $("#su-q").onkeydown = e => { if (e.key === "Enter") { clearTimeout(timer); const q = e.target.value.trim(); if (q) search(q); } };
    $("#su-res").onclick = e => { const r = e.target.closest("[data-i]"); if (r) save(results[+r.dataset.i]); };
  }
  function open(first) {
    $("#su-title").textContent = first ? "まず、あなたの場所を設定してください" : "場所の設定";
    $("#su-cur").textContent = App.home.unset ? "未設定（いまは仮に東京を表示しています）" : `現在の設定：${App.home.name}`;
    $("#setup").hidden = false;
  }
  function close() { $("#setup").hidden = true; }

  function geo() {
    const b = $("#su-geo");
    if (!navigator.geolocation) { toast("この端末では現在地を取得できません"); return; }
    const lb = b.querySelector("span"); lb.textContent = "現在地を取得中…"; b.disabled = true;
    navigator.geolocation.getCurrentPosition(async p => {
      const lat = +p.coords.latitude.toFixed(3), lon = +p.coords.longitude.toFixed(3);
      let name = "現在地", cc = "";
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`);
        const d = await r.json(); name = d.city || d.locality || d.principalSubdivision || name; cc = d.countryCode || "";
      } catch {}
      save({ name, lat, lon, cc, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    }, () => { lb.textContent = "現在地を使う"; b.disabled = false; toast("現在地を取得できませんでした。地名で検索してください"); },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }

  /* 地名検索：国土地理院（日本の住所・地名）＋ Open-Meteo（世界の都市）＋ OpenStreetMap を並行して検索 */
  let results = [], seq = 0;
  const JP = /[぀-ヿ㐀-鿿]/;
  async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function search(q) {
    const my = ++seq;
    $("#su-res").innerHTML = `<div class="empty">検索中…</div>`;
    const tasks = [
      getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=ja&format=json`)
        .then(d => (d.results || []).map(r => ({ name: r.name, lat: r.latitude, lon: r.longitude, cc: r.country_code, tz: r.timezone, sub: [r.admin1, r.country].filter(Boolean).join("・") }))),
      getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&accept-language=ja&addressdetails=1`)
        .then(d => d.map(r => {
          const a = r.address || {}, name = r.name || a.city || a.town || a.village || r.display_name.split(",")[0];
          return { name, lat: +r.lat, lon: +r.lon, cc: (a.country_code || "").toUpperCase(), sub: r.display_name.split(",").slice(1, 4).map(x => x.trim()).join("・") };
        }))
    ];
    if (JP.test(q)) tasks.unshift(
      getJSON(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`)
        .then(d => d.slice(0, 8).map(r => {
          const t = r.properties.title, m = t.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)?(.+?[市区町村])/);
          return { name: m ? m[2] : t, lat: r.geometry.coordinates[1], lon: r.geometry.coordinates[0], cc: "JP", tz: "Asia/Tokyo", sub: t };
        })));
    const all = (await Promise.allSettled(tasks)).flatMap(r => r.status === "fulfilled" ? r.value : []);
    if (my !== seq) return;
    const seen = new Set();
    results = all.filter(r => { if (isNaN(r.lat)) return false; const k = `${(+r.lat).toFixed(2)},${(+r.lon).toFixed(2)}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 10).map(r => ({ ...r, lat: +(+r.lat).toFixed(3), lon: +(+r.lon).toFixed(3) }));
    $("#su-res").innerHTML = results.map((r, i) => `<div class="su-row" data-i="${i}">${Geo.flag(r.cc)}<b>${esc(r.name)}</b><small>${esc(r.sub || "")}</small></div>`).join("")
      || `<div class="empty">見つかりませんでした。市区町村名（例：登別市、札幌市中央区）や英語表記でもお試しください。</div>`;
  }

  async function save(h) {
    if (!h) return;
    if (!h.tz) {   // タイムゾーンが分からない検索結果は、座標から調べる
      try { h.tz = (await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${h.lat}&longitude=${h.lon}&timezone=auto&forecast_days=1`)).timezone; } catch {}
    }
    const home = { name: h.name, lat: h.lat, lon: h.lon, cc: h.cc || "", tz: h.tz || Intl.DateTimeFormat().resolvedOptions().timeZone };
    Store.set("home", home);
    toast(`場所を「${home.name}」に設定しました`);
    setTimeout(() => location.reload(), 600);
  }
  return { init, open };
})();
