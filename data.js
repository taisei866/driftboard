/* Driftboard data layer — ブラウザから各公開APIへ直接アクセス（サーバー不要） */
const Data = (() => {
  const mem = new Map();
  const FLIGHT_NM = 160;

  /* 中継サーバー（Cloudflare Worker）：ブラウザから直接アクセスできない提供元に使う */
  const PROXY = ((window.DRIFT && DRIFT.proxy) || "").replace(/\/+$/, "");
  const PROXY_ONLY = /(^|\.)(adsb\.lol|airplanes\.live|adsb\.fi)$/;   // CORS非対応のため常に中継
  const viaProxy = url => `${PROXY}/?url=${encodeURIComponent(url)}`;
  async function req(url, opt = {}, ms = 15000) {
    const host = new URL(url).hostname;
    const go = async u => {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
      try {
        const r = await fetch(u, Object.assign({ signal: ac.signal }, opt));
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r;
      } finally { clearTimeout(t); }
    };
    if (PROXY && PROXY_ONLY.test(host)) return go(viaProxy(url));
    try { return await go(url); }
    catch (e) {
      // CORSやネットワークで弾かれた場合（TypeError）だけ中継で再挑戦
      if (PROXY && e instanceof TypeError) return go(viaProxy(url));
      throw e;
    }
  }
  const j = async (url, opt, ms) => (await req(url, opt, ms)).json();
  async function cached(key, ttl, fn) {
    const hit = mem.get(key);
    if (hit && Date.now() - hit.t < ttl * 1000) return hit.v;
    try { const v = await fn(); mem.set(key, { t: Date.now(), v }); return v; }
    catch (e) { if (hit) return hit.v; throw e; }
  }
  async function first(fns) {
    let last;
    for (const f of fns) { try { return await f(); } catch (e) { last = e; } }
    throw last;
  }
  const H = () => App.home;
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const rows = d => d && Array.isArray(d[0]) ? d.slice(1).map(r => Object.fromEntries(d[0].map((k, i) => [k, r[i]]))) : (d || []);

  /* ---------- フライト ---------- */
  const AC_KEYS = ["hex", "flight", "r", "t", "desc", "ownOp", "lat", "lon", "alt_baro", "alt_geom", "gs", "track", "baro_rate", "geom_rate", "squawk", "category", "seen", "seen_pos", "emergency"];
  function flights(qs) {
    const lat = +(qs.get("lat") || H().lat), lon = +(qs.get("lon") || H().lon);
    const nm = Math.max(10, Math.min(250, +(qs.get("nm") || FLIGHT_NM)));
    const FLIGHT_NM_ = nm;
    return cached(`flights:${lat.toFixed(2)},${lon.toFixed(2)},${nm}`, 4, () => first([
      ["api.adsb.lol", `https://api.adsb.lol/v2/point/${lat}/${lon}/${FLIGHT_NM_}`],
      ["airplanes.live", `https://api.airplanes.live/v2/point/${lat}/${lon}/${FLIGHT_NM_}`],
      ["adsb.fi", `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${FLIGHT_NM_}`]
    ].map(([src, u]) => async () => {
      const d = await j(u, {}, 12000);
      const list = d.ac || d.aircraft || [];
      return { src, now: Date.now() / 1000, ac: list.filter(a => a.lat != null).map(a => Object.fromEntries(AC_KEYS.filter(k => k in a).map(k => [k, a[k]]))) };
    })));
  }

  const ap = a => ({ iata: a.iata_code || a.iata, icao: a.icao_code || a.icao, name: a.name, city: a.municipality || a.location, cc: a.country_iso_name || a.countryiso2 });
  async function routeAdsbdb(cs) {
    let d;
    try { d = await j(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, {}, 10000); }
    catch (e) { if (/404/.test(e.message)) return null; throw e; }
    const fr = d && d.response && d.response.flightroute;
    if (!fr || !fr.origin || !fr.destination) return null;
    const aps = [ap(fr.origin), ...(fr.midpoint ? [ap(fr.midpoint)] : []), ap(fr.destination)];
    return { codes: aps.map(x => x.iata || x.icao || "?").join("-"), airports: aps };
  }
  async function routes(opt) {
    const planes = (JSON.parse(opt.body || "{}").planes || []).slice(0, 40), out = {}, failed = [];
    const todo = [];
    for (const p of planes) {
      const cs = (p.callsign || "").trim().toUpperCase(); if (!cs) continue;
      const hit = mem.get("route:" + cs);
      if (hit && Date.now() - hit.t < 3600e3) out[cs] = hit.v; else todo.push(p);
    }
    for (let i = 0; i < todo.length; i += 6) {   // 6件ずつ並列
      await Promise.all(todo.slice(i, i + 6).map(async p => {
        const cs = p.callsign.toUpperCase();
        try { const v = await routeAdsbdb(cs); if (v) out[cs] = v; else failed.push(p); } catch { failed.push(p); }
      }));
    }
    if (failed.length) {
      try {
        const res = await j("https://api.adsb.lol/api/0/routeset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planes: failed }) });
        (Array.isArray(res) ? res : []).forEach(r => {
          const codes = r._airport_codes_iata || r.airport_codes || "";
          if (codes && codes.toLowerCase() !== "unknown") out[(r.callsign || "").toUpperCase()] = { codes, airports: (r._airports || []).map(ap) };
        });
      } catch {}
    }
    todo.forEach(p => { const cs = p.callsign.toUpperCase(); mem.set("route:" + cs, { t: Date.now(), v: out[cs] || null }); if (!(cs in out)) out[cs] = null; });
    return out;
  }

  function photo(hex) {
    hex = (hex || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6);
    return cached("photo:" + hex, 86400, () => first([
      async () => {
        const d = await j(`https://api.planespotters.net/pub/photos/hex/${hex}`, {}, 10000), p = (d.photos || [])[0];
        if (!p) throw new Error("none");
        const th = p.thumbnail_large || p.thumbnail || {};
        return { src: th.src, link: p.link, by: p.photographer };
      },
      async () => {
        const d = await j(`https://api.adsbdb.com/v0/aircraft/${hex}`, {}, 10000), a = d.response && d.response.aircraft;
        return a && a.url_photo_thumbnail ? { src: a.url_photo_thumbnail, link: a.url_photo, by: "airport-data.com" } : {};
      }
    ]).catch(() => ({})));
  }

  /* ---------- ラジオ（Radio Browser） ---------- */
  const RB = ["de1", "de2", "fi1", "nl1", "at1"];
  let rbHost = 0;
  async function rb(path) {
    let last;
    for (let k = 0; k < RB.length; k++) {
      const h = RB[(rbHost + k) % RB.length];
      try { const d = await j(`https://${h}.api.radio-browser.info/json/${path}`, {}, 12000); rbHost = (rbHost + k) % RB.length; return d; }
      catch (e) { last = e; }
    }
    throw last;
  }
  const ST_KEYS = ["stationuuid", "name", "url_resolved", "url", "homepage", "favicon", "tags", "country", "countrycode", "state", "language", "codec", "bitrate", "hls", "geo_lat", "geo_long"];
  async function radioSearch(qs) {
    const p = new URLSearchParams(qs);
    p.set("hidebroken", "true"); p.set("is_https", "true");   // https のページでは https の配信しか再生できない
    if (!p.has("limit")) p.set("limit", "120");
    const go = () => rb("stations/search?" + p.toString());
    const res = p.get("order") === "random" ? await go() : await cached("rb:" + p, 600, go);
    return res.filter(s => (s.url_resolved || s.url || "").startsWith("https://") && s.lastcheckok !== 0)
      .map(s => Object.fromEntries(ST_KEYS.map(k => [k, s[k]])));
  }

  /* ---------- 宇宙 ---------- */
  async function space() {
    const kp = async () => {
      const [o, f] = await Promise.all([
        cached("kp", 600, () => j("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json")),
        cached("kpf", 1800, () => j("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"))]);
      return {
        observed: rows(o).map(r => ({ t: r.time_tag, kp: num(r.Kp ?? r.kp) })).slice(-16),
        forecast: rows(f).filter(r => ["predicted", "estimated"].includes(r.observed)).map(r => ({ t: r.time_tag, kp: num(r.kp ?? r.Kp) })).slice(0, 16)
      };
    };
    const wind = async () => {
      const [pl, mg] = await Promise.all([
        cached("plasma", 300, () => j("https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json")),
        cached("mag", 300, () => j("https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json"))]);
      const p = rows(pl).reverse().find(r => num(r.speed) != null) || {}, m = rows(mg).reverse().find(r => num(r.bz_gsm) != null) || {};
      return { speed: num(p.speed), density: num(p.density), bz: num(m.bz_gsm), bt: num(m.bt) };
    };
    const aurora = () => cached("ovation", 900, async () => {
      const d = await j("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", {}, 30000);
      const lo0 = ((Math.round(H().lon) % 360) + 360) % 360, la0 = Math.round(H().lat);
      let here = 0, region = 0;
      for (const [lo, la, v] of d.coordinates || []) {
        if (lo === lo0 && la === la0) here = v;
        const dl = Math.min(Math.abs(lo - lo0), 360 - Math.abs(lo - lo0));
        if (dl <= 4 && Math.abs(la - la0) <= 4) region = Math.max(region, v);
      }
      return { here, region };
    });
    const earth = () => cached("epic", 3600, () => first([
      async () => (await j("https://epic.gsfc.nasa.gov/api/natural")).map(e => epicItem(e, "https://epic.gsfc.nasa.gov/archive/natural", "")),
      async () => (await j("https://api.nasa.gov/EPIC/api/natural?api_key=DEMO_KEY")).map(e => epicItem(e, "https://api.nasa.gov/EPIC/archive/natural", "?api_key=DEMO_KEY"))
    ]));
    const safe = (p, d = null) => p().catch(() => d);
    const [a, b, c, e] = await Promise.all([safe(kp), safe(wind), safe(aurora), safe(earth, [])]);
    return { kp: a, wind: b, aurora: c, earth: e };
  }
  function epicItem(e, base, q) {
    const dt = e.date || "", c = e.centroid_coordinates || {};
    return { url: `${base}/${dt.slice(0, 4)}/${dt.slice(5, 7)}/${dt.slice(8, 10)}/jpg/${e.image}.jpg${q}`, date: dt, lat: c.lat, lon: c.lon };
  }

  async function tle() {
    const saved = Store.get("tle", null);
    if (saved && Date.now() - saved.t < 6 * 3600e3) return saved.v;
    const v = await first([
      async () => {
        const t = (await (await req("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE")).text()).trim().split(/\r?\n/);
        return { l1: t.find(x => x.startsWith("1 ")).trim(), l2: t.find(x => x.startsWith("2 ")).trim() };
      },
      async () => { const d = await j("https://tle.ivanstanojevic.me/api/tle/25544"); return { l1: d.line1, l2: d.line2 }; }
    ]).catch(e => { if (saved) return saved.v; throw e; });
    Store.set("tle", { t: Date.now(), v });
    return v;
  }

  function weather(qs) {
    const p = new URLSearchParams(qs);
    const u = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
      latitude: p.get("lat"), longitude: p.get("lon"),
      current: "temperature_2m,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
      daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min", timezone: "auto", forecast_days: "1"
    });
    return cached(u, 900, async () => { const d = await j(u); return Array.isArray(d) ? d : [d]; });
  }

  /* ---------- 読み上げ（ブラウザ標準） ---------- */
  function say(text) {
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = "ja-JP"; u.rate = 1;
      const v = speechSynthesis.getVoices().find(v => /ja/i.test(v.lang)); if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u); return true;
    } catch { return false; }
  }

  /* ---------- ルーター：既存の api("/api/...") 呼び出しをそのまま処理 ---------- */
  async function handle(path, opt = {}) {
    const [p, q = ""] = path.split("?"), qs = new URLSearchParams(q);
    switch (p) {
      case "/api/config": return { home: H(), radius_nm: FLIGHT_NM };
      case "/api/flights": return flights(qs);
      case "/api/routes": return routes(opt);
      case "/api/photo": return photo(qs.get("hex"));
      case "/api/radio/countries": return cached("rbc", 86400, () => rb("countries?order=stationcount&reverse=true"));
      case "/api/radio/search": return radioSearch(q);
      case "/api/radio/click": return rb("url/" + encodeURIComponent(qs.get("id") || "")).catch(() => ({}));
      case "/api/space": return space();
      case "/api/tle": return tle();
      case "/api/weather": return weather(q);
      case "/api/say": return { ok: say(qs.get("text") || "") };
    }
    throw new Error("unknown " + p);
  }
  return { handle, say, hasProxy: !!PROXY };
})();
