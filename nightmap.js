/* 昼夜の地球（共有部品）：太陽の位置から昼の地球と夜の地球を合成した画像を作る */
const NightMap = (() => {
  const W = 1024, H = 512;
  let ready = null, dayPx, nightPx, trig;
  function init() {
    if (ready) return ready;
    const load = src => new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ng; im.src = src; });
    ready = Promise.all([load("img/day.jpg"), load("img/night.jpg")]).then(([d, n]) => {
      const px = im => { const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
      dayPx = px(d); nightPx = px(n);
      trig = { sLat: new Float32Array(H), cLat: new Float32Array(H), sLon: new Float32Array(W), cLon: new Float32Array(W) };
      for (let y = 0; y < H; y++) { const a = (90 - (y + .5) * 180 / H) * D2R; trig.sLat[y] = Math.sin(a); trig.cLat[y] = Math.cos(a); }
      for (let x = 0; x < W; x++) { const o = (-180 + (x + .5) * 360 / W) * D2R; trig.sLon[x] = Math.sin(o); trig.cLon[x] = Math.cos(o); }
    });
    return ready;
  }
  /* dayDim：昼側の明るさ（1=そのまま、小さいほど夜側が引き立つ） */
  function compose(canvas, dayDim = 1, date = new Date()) {
    if (!dayPx) return false;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"), out = ctx.createImageData(W, H), o = out.data;
    const sp = Sun.pos(date), sd = Math.sin(sp.dec), cd = Math.cos(sp.dec), cs = Math.cos(sp.lon * D2R), ss = Math.sin(sp.lon * D2R);
    const LO = -0.2079, SPAN = 0.2602;
    for (let y = 0; y < H; y++) {
      const a = trig.sLat[y] * sd, b = trig.cLat[y] * cd;
      for (let x = 0; x < W; x++) {
        const s = a + b * (trig.cLon[x] * cs + trig.sLon[x] * ss);
        let t = (s - LO) / SPAN; t = t < 0 ? 0 : t > 1 ? 1 : t; const w = t * t * (3 - 2 * t), wd = w * dayDim;
        let tw = 1 - Math.abs(s) / 0.06; tw = tw > 0 ? tw * w : 0;
        const i = (y * W + x) * 4;
        o[i] = nightPx[i] * 1.1 * (1 - w) + dayPx[i] * wd + 50 * tw;
        o[i + 1] = nightPx[i + 1] * 1.05 * (1 - w) + dayPx[i + 1] * wd + 15 * tw;
        o[i + 2] = nightPx[i + 2] * (1 - w) + dayPx[i + 2] * wd - 8 * tw;
        o[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    return true;
  }
  return { init, compose, W, H };
})();
