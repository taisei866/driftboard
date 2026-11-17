/* Driftboard 設定
   proxy: ブラウザから直接取得できないデータ（飛行機など）を中継するサーバーのURL。
          proxy/worker.js を Cloudflare Workers にデプロイして、そのURLを入れてください。 */
window.DRIFT = {
  proxy: "https://driftboard-proxy.morimori1980111.workers.dev"
};
