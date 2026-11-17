/**
 * Driftboard 中継サーバー（Cloudflare Workers 用）
 * ブラウザから直接アクセスできない（CORS非対応の）公開APIを、許可した提供元に限って中継します。
 * 使い方: GET/POST https://<worker>.workers.dev/?url=<エンコードした取得先URL>
 */
const ALLOWED_ORIGINS = ["https://taisei866.github.io", "http://localhost:8790"];
const ALLOWED_HOSTS = [
  "api.adsb.lol", "api.airplanes.live", "opendata.adsb.fi",           // 航空機の位置
  "api.adsbdb.com", "api.planespotters.net",                            // 路線・機体写真
  "services.swpc.noaa.gov", "celestrak.org", "tle.ivanstanojevic.me",   // 宇宙天気・ISS軌道
  "epic.gsfc.nasa.gov", "api.nasa.gov",                                 // 地球の画像
];
const ALLOWED_SUFFIX = [".api.radio-browser.info"];
// 提供元ごとのキャッシュ秒数（同じ地域の利用者で結果を共有し、提供元への負荷を減らす）
const TTL = host => /adsb|airplanes/.test(host) && !/adsbdb/.test(host) ? 5 : /radio-browser/.test(host) ? 600 : 300;

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return new Response("forbidden origin", { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get("url");
    let u;
    try { u = new URL(target); } catch { return new Response("bad url", { status: 400, headers: cors }); }
    const host = u.hostname;
    if (u.protocol !== "https:" || !(ALLOWED_HOSTS.includes(host) || ALLOWED_SUFFIX.some(s => host.endsWith(s))))
      return new Response("host not allowed", { status: 403, headers: cors });

    const init = {
      method: request.method,
      headers: { "User-Agent": "Driftboard/1.0 (+https://taisei866.github.io/driftboard/)", "Accept": "application/json, text/plain, */*" },
    };
    if (request.method === "POST") {
      init.headers["Content-Type"] = "application/json";
      init.body = await request.text();
    } else {
      init.cf = { cacheTtl: TTL(host), cacheEverything: true };
    }
    let res;
    try { res = await fetch(u.toString(), init); }
    catch (e) { return new Response("upstream error", { status: 502, headers: cors }); }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    out.headers.delete("set-cookie");
    return out;
  },
};
