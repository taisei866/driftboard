/* Driftboard core: タブ管理・共通ユーティリティ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
/* 左右スワイプ（またはボタン）で前後に送る。d = +1 次 / -1 前 */
function swipe(el, cb) {
  let x0 = null, y0 = 0;
  el.style.touchAction = "pan-y";
  el.addEventListener("pointerdown", e => { if (e.target.closest(".cnav")) return; x0 = e.clientX; y0 = e.clientY; });
  el.addEventListener("pointerup", e => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) cb(dx < 0 ? 1 : -1);
  });
  el.querySelectorAll(".cnav").forEach(b => b.onclick = () => cb(b.classList.contains("prev") ? -1 : 1));
}
const ic = (id, cls = "") => `<svg class="ic ${cls}"><use href="#${id}"/></svg>`;

const Store = {
  get(k, d) { try { const v = localStorage.getItem("db." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("db." + k, JSON.stringify(v)); } catch {} }
};

const Net = {
  ok(v) { const d = $("#net"); d.classList.toggle("ok", v); d.classList.toggle("ng", !v); }
};

async function api(path, opt) {
  try {
    const j = await Data.handle(path, opt);
    Net.ok(true);
    return j;
  } catch (e) { Net.ok(false); throw e; }
}

let toastT;
function toast(msg, ms = 3000) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), ms);
}

/* ---- 書式 ---- */
const Fmt = {
  hm(d, tz) { return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: tz }); },
  hms(d, tz) { return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz }); },
  md(d, tz) { return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", timeZone: tz }); },
  full(d) { return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }); },
  dt(d) { return `${Fmt.md(d)} ${Fmt.hm(d)}`; },
  dur(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (d) return `${d}日${h}時間`;
    if (h) return `${h}時間${m}分`;
    if (m) return `${m}分${String(s).padStart(2, "0")}秒`;
    return `${s}秒`;
  },
  n(v, d = 0) { return v == null || isNaN(v) ? "-" : Number(v).toLocaleString("ja-JP", { maximumFractionDigits: d, minimumFractionDigits: d }); }
};

const Geo = {
  dist(a1, o1, a2, o2) { // km
    const p1 = a1 * D2R, p2 = a2 * D2R, dp = (a2 - a1) * D2R, dl = (o2 - o1) * D2R;
    const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  },
  bearing(a1, o1, a2, o2) {
    const p1 = a1 * D2R, p2 = a2 * D2R, dl = (o2 - o1) * D2R;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  },
  dest(lat, lon, brg, km) {
    const d = km / 6371, b = brg * D2R, p1 = lat * D2R, l1 = lon * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 * R2D, ((l2 * R2D + 540) % 360) - 180];
  },
  dir16(deg) {
    const n = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
    return n[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  },
  flag(cc) { return cc && cc.length === 2 ? `<span class="cc">${cc.toUpperCase()}</span>` : ""; }
};

/* ---- 太陽の位置（地心直下点） ---- */
const Sun = {
  pos(date = new Date()) {
    const d = date / 86400000 + 2440587.5 - 2451545.0;
    const g = (357.529 + 0.98560028 * d) * D2R;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    const e = (23.439 - 0.00000036 * d) * D2R;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = ((280.46061837 + 360.98564736629 * d) % 360) * D2R;
    let lon = (ra - gmst) * R2D;
    lon = ((lon + 540) % 360) - 180;
    return { lat: dec * R2D, lon, dec, L, e, eci: [Math.cos(L), Math.cos(e) * Math.sin(L), Math.sin(e) * Math.sin(L)] };
  },
  elev(lat, lon, sp = Sun.pos()) { // 度
    const p = lat * D2R, H = (lon - sp.lon) * D2R;
    return Math.asin(Math.sin(p) * Math.sin(sp.dec) + Math.cos(p) * Math.cos(sp.dec) * Math.cos(H)) * R2D;
  }
};

/* ---- 天気コード ---- */
function wxInfo(code, isDay = 1) {
  const c = Number(code);
  if (c === 0) return [isDay ? "w-sun" : "w-moon", "快晴"];
  if (c === 1) return [isDay ? "w-sun" : "w-moon", "晴れ"];
  if (c === 2) return ["w-partly", "薄曇り"];
  if (c === 3) return ["w-cloud", "曇り"];
  if (c === 45 || c === 48) return ["w-fog", "霧"];
  if (c >= 51 && c <= 67) return ["w-rain", c <= 57 ? "霧雨" : "雨"];
  if (c >= 71 && c <= 77) return ["w-snow", "雪"];
  if (c >= 80 && c <= 82) return ["w-rain", "にわか雨"];
  if (c === 85 || c === 86) return ["w-snow", "にわか雪"];
  if (c >= 95) return ["w-storm", "雷雨"];
  return ["w-cloud", "-"];
}

/* ---- 地図 ---- */
function darkMap(el, opt = {}) {
  const m = L.map(el, Object.assign({ zoomControl: false, attributionControl: true, worldCopyJump: true, preferCanvas: true }, opt));
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, className: "dark-tiles",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(m);
  return m;
}

/* ---- アプリ本体 ---- */
const App = {
  mods: {}, cur: null,
  home: Store.get("home", null) || { name: "東京", lat: 35.681, lon: 139.767, tz: "Asia/Tokyo", unset: true },
  titles: { flight: "フライトレーダー", weather: "天気", radio: "ワールドラジオ", space: "宇宙ダッシュボード", sky: "今夜の星空", clock: "昼夜ワールドクロック" },
  reg(name, mod) { this.mods[name] = mod; },
  async start() {
    if (!this.home.tz) this.home.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
    Setup.init();
    $("#loc-name").textContent = this.home.unset ? "場所を設定" : this.home.name;
    $("#loc-btn").onclick = () => Setup.open(false);
    if (this.home.unset) Setup.open(true);
    $$("#tabs button").forEach(b => b.onclick = () => this.show(b.dataset.tab));
    this.show(Store.get("tab", "flight"));
    const tick = () => { $("#hdr-clock").textContent = Fmt.hm(new Date()); };
    tick(); setInterval(tick, 1000);
    $("#fs").onclick = () => this.fullscreen(true);
    document.addEventListener("pointerdown", () => this.wake(), { once: false, passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.wake(true); });
  },
  show(name) {
    if (!this.mods[name]) name = "flight";
    if (this.cur === name) return;
    const prev = this.mods[this.cur];
    if (prev && prev.hide) prev.hide();
    $$(".tab").forEach(t => t.classList.toggle("on", t.id === "tab-" + name));
    $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
    this.cur = name; Store.set("tab", name);
    const m = this.mods[name];
    if (!m._init) { m._init = true; m.init(); }
    if (m.show) m.show();
  },
  fullscreen(toggle) {
    const d = document;
    if (d.fullscreenElement) { if (toggle) d.exitFullscreen?.(); return; }
    d.documentElement.requestFullscreen?.().catch(() => {});
  },
  async wake(force) {
    if (this._wl && !force) return;
    try { this._wl = await navigator.wakeLock?.request("screen"); this._wl?.addEventListener("release", () => this._wl = null); } catch {}
  }
};
