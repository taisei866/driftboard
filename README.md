# Driftboard

フライト・世界のラジオ・宇宙・星空・昼夜ワールドクロックを、**ぼーっと眺めるため**のダッシュボードです。
古いタブレットを机に立てて、情報パネルやスクリーンセーバーとして使うことを想定しています。

**▶ https://taisei866.github.io/driftboard/**

インストール不要・登録不要・広告なし。ブラウザで開くだけで動きます（「ホーム画面に追加」でアプリのようにも使えます）。

## タブ

| タブ | 内容 |
|---|---|
| フライト | 設定した場所の周り（地図を動かせば世界中）の飛行機をリアルタイム表示。便名・行き先・高度・機体写真、種類・高度・動きでの絞り込み |
| 天気 | 現在の天気、48時間の気温と降水確率のグラフ、7日間の予報 |
| ラジオ | 世界中のネットラジオを国・ジャンル・地図から選んで再生。お気に入り・自動切替 |
| 宇宙 | ISS の現在位置と「肉眼で見える次の通過」、オーロラ指標、最新の太陽画像、月齢、今日の地球（DSCOVR/EPIC の実写） |
| 星空 | 今の自分の空をプラネタリウム表示。星座・惑星・月・ISS、時間の早送り、今夜の惑星の見頃 |
| 世界時計 | 昼と夜の境目をリアルタイムで描く世界地図と、各都市の時刻・天気 |
| 風の絵 | 今の風向き・風速・気温・天気で動く、光の粒子のアート |
| 灯台 | 世界中の灯台・航路標識の、本当の光り方（色・周期・点滅回数）を地図上で再現 |

下のバーには好きな画面を4つまで固定でき、「すべて」からほかの画面を開けます。

**アンビエントモード**：しばらく触らないと、各タブをフェードしながら自動で巡回します（夜は自動で減光）。

## 中継サーバー（飛行機データ用）

飛行機の位置情報の提供元は、ブラウザからの直接アクセス（CORS）を許可していません。
そのため、`proxy/worker.js` を Cloudflare Workers（無料枠）にデプロイし、URL を `config.js` の `proxy` に設定しています。
中継するのは `proxy/worker.js` に列挙した提供元だけで、このサイト以外からの利用は拒否します。結果は数秒〜数分キャッシュし、提供元への負荷を抑えています。

## プライバシー

- 位置情報は**端末内（ブラウザ）にだけ保存**され、このサイトの作者には送られません。
- 天気・フライト等の取得のため、各データ提供元には設定した場所の緯度経度が送られます。
- アクセス解析・Cookie は使っていません。

## データ提供元（ありがとうございます）

- 航空機：[adsb.lol](https://adsb.lol) / [airplanes.live](https://airplanes.live) / [adsb.fi](https://adsb.fi)、路線：[adsbdb](https://www.adsbdb.com)、機体写真：[planespotters.net](https://www.planespotters.net)
- ラジオ：[Radio Browser](https://www.radio-browser.info)
- 宇宙天気・オーロラ：[NOAA SWPC](https://www.swpc.noaa.gov)、ISS 軌道：[CelesTrak](https://celestrak.org)
- 太陽画像：NASA SDO / ESA・NASA SOHO、地球の実写：NASA DSCOVR EPIC
- 天気・地名検索：[Open-Meteo](https://open-meteo.com)、逆ジオコーディング：[BigDataCloud](https://www.bigdatacloud.com)
- 灯台：OpenStreetMap の航路標識データ（[Overpass API](https://overpass-api.de)）。`tools/build_lights.py` を GitHub Actions で毎月実行し、`data/lights/` に区画ごとにまとめて配信
- 地図：© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors

## 同梱ライブラリ・データ

- [Leaflet](https://leafletjs.com) (BSD-2-Clause)
- [satellite.js](https://github.com/shashwatak/satellite-js) (MIT)
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) (MIT)
- 星表・星座線・天の川：[d3-celestial](https://github.com/ofrohn/d3-celestial) のデータ (BSD-3-Clause, © Olaf Frohn)
- 地球の昼・夜テクスチャ：NASA Blue Marble / Black Marble（[three-globe](https://github.com/vasturiano/three-globe) 同梱版）

## ライセンス

ソースコードは MIT License（[LICENSE](LICENSE)）。同梱ライブラリ・データはそれぞれのライセンスに従います。
