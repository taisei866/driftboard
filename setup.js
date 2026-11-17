/* 場所の設定（初回・ヘッダーの場所ボタン） */
const Setup = (() => {
  let timer;
  function init() {
    $("#su-close").onclick = close;
    $("#su-geo").onclick = geo;
    $("#su-q").oninput = e => { clearTimeout(timer); const q = e.target.value.trim(); timer = setTimeout(() => q.length >= 2 && search(q), 500); };
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

  let results = [];
  async function search(q) {
    $("#su-res").innerHTML = `<div class="empty">検索中…</div>`;
    try {
      const d = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=ja&format=json`)).json();
      results = (d.results || []).map(r => ({ name: r.name, lat: +r.latitude.toFixed(3), lon: +r.longitude.toFixed(3), cc: r.country_code, tz: r.timezone, sub: [r.admin1, r.country].filter(Boolean).join("・") }));
    } catch { results = []; }
    $("#su-res").innerHTML = results.map((r, i) => `<div class="su-row" data-i="${i}">${Geo.flag(r.cc)}<b>${esc(r.name)}</b><small>${esc(r.sub)}</small></div>`).join("")
      || `<div class="empty">見つかりませんでした。別の書き方（ひらがな・英語など）でもお試しください。</div>`;
  }

  function save(h) {
    if (!h) return;
    const home = { name: h.name, lat: h.lat, lon: h.lon, cc: h.cc || "", tz: h.tz || Intl.DateTimeFormat().resolvedOptions().timeZone };
    Store.set("home", home);
    toast(`場所を「${home.name}」に設定しました`);
    setTimeout(() => location.reload(), 600);
  }
  return { init, open };
})();
