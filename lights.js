/* 灯台の光：OpenStreetMap の航路標識データから、灯台ごとの本当の光り方を再現 */
(() => {
  const SPOTS = [["近く", null], ["東京湾", [35.35, 139.78, 10]], ["瀬戸内海", [34.3, 133.3, 9]], ["関門海峡", [33.95, 130.95, 11]],
    ["ドーバー海峡", [51.0, 1.45, 9]], ["サンフランシスコ湾", [37.8, -122.45, 10]], ["シンガポール海峡", [1.22, 103.85, 10]], ["ボスポラス海峡", [41.1, 29.05, 11]]];
  const COL = { white: "255,244,214", red: "255,90,79", green: "71,240,138", yellow: "255,216,74", blue: "106,168,255", orange: "255,170,68", violet: "200,120,255" };
  const COL_JA = { white: "白", red: "赤", green: "緑", yellow: "黄", blue: "青", orange: "橙", violet: "紫" };
  const TYPE_JA = t => !t ? "灯台" : /light_major/.test(t) ? "灯台" : /light_minor/.test(t) ? "小型の灯台" : /buoy/.test(t) ? "灯浮標（ブイ）" : /beacon/.test(t) ? "立標" : /light_vessel|light_float/.test(t) ? "灯船" : /landmark/.test(t) ? "灯台" : "航路標識の灯り";
  const MORSE = { A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--.." };

  let map, cv, g, visible = false, raf, lights = new Map(), loaded = null, moveT, sel = null, sprites = {}, busy = false;

  /* ---------- 光り方の解析 ---------- */
  function sectorTags(tags) {
    for (const pre of ["seamark:light:", "seamark:light:1:", "seamark:light:2:"]) {
      if (tags[pre + "character"]) return {
        ch: tags[pre + "character"], per: parseFloat(tags[pre + "period"]), seq: tags[pre + "sequence"],
        col: (tags[pre + "colour"] || "white").split(/[;,]/).map(c => c.trim()),
        rng: parseFloat(tags[pre + "range"]), h: parseFloat(tags[pre + "height"])
      };
    }
    return null;
  }
  function pattern(L) {
    let segs0 = pattern0(L);
    if (!segs0.some(x => x.on)) segs0 = pattern0({ ...L, seq: "" });   // 光り方の詳細が読めない書き方のときは、記号（Fl など）から作る
    // ごく短いせん光（0.1秒など）は画面上で見落としやすいので、最低0.3秒は光らせる（その分、直後の消灯を短くする）
    segs0.forEach((x, i) => {
      const nx = segs0[(i + 1) % segs0.length];
      if (x.on && x.d < .3 && nx && !nx.on && nx.d > .3 - x.d + .1) { nx.d -= .3 - x.d; x.d = .3; }
    });
    const cols = L.col.length;
    // 色が交互に変わる灯りで、1周期の点灯が色の数より少ない場合は、色の数だけ周期を繰り返して交互にする
    const ons = segs0.filter(x => x.on).length;
    if (cols > 1 && ons < cols) {
      const out = []; let k = 0;
      for (let r = 0; r < cols; r++) segs0.forEach(x => out.push(x.on ? { ...x, c: (k++) % cols } : { ...x }));
      return out;
    }
    return segs0;
  }
  function pattern0(L) {
    const segs = [], push = (d, on, c = 0) => d > 0 && segs.push({ d, on, c });
    const cols = L.col.length;
    let sq = (L.seq || "").replace(/\[[^\]]*\]/g, "").trim();
    if (/^\(.*\)$/.test(sq) && /^\([\d.]+\+\(/.test(sq)) sq = sq.slice(1, -1);   // 「(00.5+(02.5))」のように全体が括弧で囲まれた書き方
    if (sq) {
      sq.split(",").forEach(grp => grp.split("+").forEach(tok => {
        tok = tok.trim(); const off = /\(/.test(tok), v = parseFloat(tok.replace(/[()]/g, ""));
        if (!isNaN(v)) push(v, !off);
      }));
      const sum = segs.reduce((a, s) => a + s.d, 0);
      if (L.per > sum) push(L.per - sum, false);
      if (segs.length) { let k = 0; segs.forEach(s => { if (s.on) s.c = (k++) % cols; }); return segs; }
    }
    const m = (L.ch || "Fl").match(/^(Al\.)?(LFl|Fl|Oc|Iso|VQ|UQ|IQ|Q|Mo|F)(?:\(([^)]+)\))?/) || [, "", "Fl", "1"];
    const kind = m[2], arg = m[3] || "1", n = parseInt(arg) || 1;
    const def = { F: 1, Fl: 5, LFl: 10, Oc: 5, Iso: 4, Q: 1, VQ: .5, UQ: .25, IQ: 15, Mo: 8 }[kind] || 5;
    const cont = (kind === "Q" || kind === "VQ" || kind === "UQ") && !m[3];   // 回数指定のない急せん光は、周期に関係なく一定の速さで光り続ける
    let P = L.per > 0 && !cont ? L.per : def, k = 0;
    const nextC = () => (k++) % cols;
    if (kind === "F") push(1, true, 0);
    else if (kind === "Iso") { push(P / 2, true, nextC()); push(P / 2, false); }
    else if (kind === "Oc") {
      const ecl = Math.min(1, P / (n * 3));
      for (let i = 0; i < n; i++) { push(ecl, false); if (i < n - 1) push(ecl, true, 0); }
      push(P - ecl * (2 * n - 1), true, 0);
    } else if (kind === "Mo") {
      const code = (MORSE[arg.toUpperCase()] || ".-").split("");
      code.forEach(c => { push(c === "." ? .5 : 1.5, true, 0); push(.5, false); });
      const sum = segs.reduce((a, s) => a + s.d, 0); push(Math.max(1, P - sum), false);
    } else {
      const fl = { Fl: P <= 2.5 ? .3 : .6, LFl: 2, Q: .3, VQ: .15, UQ: .08, IQ: .3 }[kind] || .5;
      const gap = { Fl: 1.1, LFl: 1.6, Q: .7, VQ: .35, UQ: .17, IQ: .7 }[kind] || 1;
      if (cont) { push(fl, true, nextC()); push(Math.max(.05, P - fl), false); }
      else {
        const nn = arg.split("+").map(x => parseInt(x) || 1);
        nn.forEach((cnt, gi) => { for (let i = 0; i < cnt; i++) { push(fl, true, nextC()); if (i < cnt - 1) push(gap, false); } if (gi < nn.length - 1) push(gap * 2, false); });
        if (/\+\s*LFl/.test(L.ch)) { push(gap * 2, false); push(2, true, nextC()); }   // 南方位標識など「Q(6)+LFl」：急せん光のあとに長いせん光
        const sum = segs.reduce((a, s) => a + s.d, 0); push(Math.max(.4, P - sum), false);
      }
    }
    return segs;
  }
  function describe(L) {
    const m = (L.ch || "").match(/^(Al\.)?(LFl|Fl|Oc|Iso|VQ|UQ|IQ|Q|Mo|F)(?:\(([^)]+)\))?/);
    const cols = L.col.map(c => COL_JA[c] || c).join("と");
    if (!m) return `${cols}色の光（${L.ch}）`;
    const al = m[1] ? "交互に" : "", n = m[3] || "", per = L.per > 0 ? `${L.per}秒ごとに` : "";
    const name = { F: "ずっと点灯している不動光", Fl: "せん光", LFl: "長いせん光", Oc: "明暗光（ほとんど点灯し、短く消える）", Iso: "等明暗光（点灯と消灯が同じ長さ）", Q: "急せん光（1秒に1回ほど）", VQ: "超急せん光（1秒に2回ほど）", UQ: "極急せん光", IQ: "断続急せん光", Mo: `モールス符号「${n}」の光` }[m[2]];
    if (m[2] === "F") return `${cols}色の${name}`;
    const cnt = m[2] !== "Mo" && n ? `${n.replace("+", "回と")}回ずつの` : "";
    return `${cols}色${al ? "が" + al : "の"}${per}${cnt}${name}`;
  }

  /* ---------- 描画 ---------- */
  function sprite(rgb) {
    if (sprites[rgb]) return sprites[rgb];
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const x = c.getContext("2d"), gr = x.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, `rgba(255,255,255,1)`); gr.addColorStop(.08, `rgba(${rgb},1)`); gr.addColorStop(.3, `rgba(${rgb},.35)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 96, 96);
    return sprites[rgb] = c;
  }
  function level(L, t) {
    let tm = (t + L.phase) % L.total, prev = L.segs[L.segs.length - 1];
    for (const s of L.segs) {
      if (tm < s.d) {
        if (!s.on) {   // 消えた直後は灯りの余韻として少しだけ残光を出す（短いせん光を見逃しにくくする）
          const a = prev && prev.on && s.d > .2 ? Math.max(0, 1 - tm / .7) : 0;
          return a > 0 ? [a * a * .45, prev.c] : [0, 0];
        }
        const e = Math.min(tm, s.d - tm), ramp = Math.min(1, e / .06);
        return [ramp, s.c];
      }
      tm -= s.d; prev = s;
    }
    return [0, 0];
  }
  function resize() {
    const box = $("#lmap"), dpr = devicePixelRatio || 1;
    cv.width = box.clientWidth * dpr; cv.height = box.clientHeight * dpr;
    cv.style.width = box.clientWidth + "px"; cv.style.height = box.clientHeight + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const t = performance.now() / 1000, W = cv.clientWidth, H = cv.clientHeight, z = map.getZoom();
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    for (const Lt of lights.values()) {
      if (!lpass(Lt)) continue;
      if (Lt.minor && z < 8 && !SMALL.includes(LF.kind)) continue;   // 広い範囲ではブイなど小さな灯りを省いて軽くする
      const p = map.latLngToContainerPoint(Lt.ll);
      if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;
      const [lv, ci] = level(Lt, t), rgb = COL[Lt.col[ci]] || COL.white;
      // 引きの画角では光を小さく・やや控えめにして、密集した海域が白く飽和しないようにする
      const zf = z < 6 ? .22 + (z - 3) * .1 : Math.max(.55, Math.min(1.8, (z - 5) / 5));
      const base = Math.max(3, Math.min(16, 2.5 + (Lt.rng || 3) * .55)) * zf * (Lt.minor ? .7 : 1);
      if (lv > .01) {
        const r = base * (2.4 + lv * 1.6);
        g.globalAlpha = z < 6 ? lv * .85 : lv; g.drawImage(sprite(rgb), p.x - r, p.y - r, r * 2, r * 2);
      }
      g.globalAlpha = .28; g.fillStyle = `rgb(${rgb})`; g.fillRect(p.x - .9, p.y - .9, 1.8, 1.8);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    if (sel) {
      const p = map.latLngToContainerPoint(sel.ll);
      g.strokeStyle = "rgba(79,156,240,.9)"; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, 16, 0, 7); g.stroke();
    }
  }

  /* ---------- 読み込み ----------
     ① 事前にまとめた灯台データ（data/lights/、GitHub Actions で毎月更新）を区画ごとに読む
     ② まだデータが無い場合だけ、公開サーバー（Overpass API）に直接問い合わせる */
  const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  function addLight(id, lat, lon, f) {
    if (lights.has(id)) return;
    const cols = (f.col || "").split(/[;,]/).map(c => c.trim()).filter(c => COL[c]);
    const known = !!f.ch, minor = /buoy|beacon|minor/.test(f.type || "");
    // 光り方が未登録の灯りは、一般的な光り方（白色のせん光。灯台は10秒、小さな灯りは4秒ごと）で光らせる
    if (!known) { f = { ...f, ch: "Fl", per: minor ? 4 : 10 }; }
    const Lt = { id, ll: [lat, lon], ch: f.ch || "", per: +f.per || 0, seq: f.seq || "", col: cols.length ? cols : ["white"], rng: +f.rng || 0, h: +f.h || 0, known };
    Lt.name = f.name || ""; Lt.type = f.type || "";
    Lt.minor = /buoy|beacon|minor/.test(Lt.type);
    Lt.segs = pattern(Lt);
    Lt.total = Lt.segs.reduce((a, x) => a + x.d, 0) || 1;
    Lt.phase = (hash(String(id)) % 997) / 997 * Lt.total;
    lights.set(id, Lt);
  }

  let index, tilesDone = new Set();
  async function getIndex() {
    if (index !== undefined) return index;
    try { const r = await fetch("data/lights/index.json"); index = r.ok ? await r.json() : null; } catch { index = null; }
    return index;
  }
  async function load() {
    const z = map.getZoom(), b = map.getBounds().pad(.1);
    if (busy) return; busy = true;
    try {
      const idx = await getIndex();
      if (idx) await loadOverview();   // 世界中の大きな灯台は最初にまとめて読む（引きの画角用）
      if (z < 6) { if (!idx) status("拡大すると、その海域の灯台を表示します"); else status(statusText()), fCount(); return; }
      if (idx) await loadTiles(idx, b); else await loadOverpass(b);
      status(statusText()); fCount();
      if (!lights.size) toast("この範囲には灯台が見つかりませんでした。海沿いへ移動してみてください");
    } catch {
      status("灯台データを取得できませんでした。少し待ってから地図を動かしてください");
    } finally { busy = false; }
  }
  let overview = false;
  async function loadOverview() {
    if (overview) return; overview = true;
    try {
      status("世界の灯台を読み込み中…");
      const rows = await (await fetch("data/lights/overview.json")).json();
      for (const r of rows) addLight(r[0], r[1], r[2], { name: r[3], type: r[4], ch: r[5], per: r[6], col: r[7], seq: r[8], rng: r[9], h: r[10] });
    } catch { overview = false; }
  }
  async function loadTiles(idx, b) {
    const st = idx.step, keys = [];
    const la0 = Math.floor((b.getSouth() + 90) / st), la1 = Math.floor((b.getNorth() + 90) / st);
    const lo0 = Math.floor((b.getWest() + 180) / st), lo1 = Math.floor((b.getEast() + 180) / st), nLon = 360 / st;
    for (let a = la0; a <= la1; a++) for (let o = lo0; o <= lo1; o++) {
      const k = `${a}_${((o % nLon) + nLon) % nLon}`;
      if (idx.tiles[k] && !tilesDone.has(k)) keys.push(k);
    }
    if (!keys.length) return;
    status("灯台を読み込み中…");
    await Promise.all(keys.slice(0, 30).map(async k => {
      const rows = await (await fetch(`data/lights/${k}.json`)).json();
      rows.forEach((r, i) => addLight(`${k}:${i}`, r[0], r[1], { name: r[2], type: r[3], ch: r[4], per: r[5], col: r[6], seq: r[7], rng: r[8], h: r[9] }));
      tilesDone.add(k);
    }));
  }
  async function loadOverpass(b) {
    if (loaded && loaded.contains(map.getBounds())) return;
    status("灯台を読み込み中…（初回のデータ準備中のため時間がかかります）");
    const bb = `${b.getSouth().toFixed(3)},${b.getWest().toFixed(3)},${b.getNorth().toFixed(3)},${b.getEast().toFixed(3)}`;
    const q = `[out:json][timeout:25];(node["seamark:light:character"](${bb});node["seamark:light:1:character"](${bb});node["man_made"="lighthouse"](${bb}););out body 4000;`;
    let d;
    for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (r.ok) { d = await r.json(); break; }
      } catch {}
    }
    if (!d) throw new Error("overpass");
    for (const el of d.elements || []) {
      const tg = el.tags || {}, S = sectorTags(tg);
      addLight(el.id, el.lat, el.lon, {
        name: tg["seamark:name"] || tg["name:ja"] || tg.name, type: tg["seamark:type"] || (tg.man_made === "lighthouse" ? "light_major" : ""),
        ch: S && S.ch, per: S && S.per, col: S ? S.col.join(";") : "", seq: S && S.seq, rng: S && S.rng, h: S && S.h
      });
    }
    loaded = loaded ? (loaded.extend(b), loaded) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
  }
  function status(t) { $("#lt-status").textContent = t; }

  /* ---------- 種類・色・光り方で絞り込み、名前で検索 ---------- */
  const LF = Object.assign({ kind: "all", color: "all", ch: "all", q: "" }, Store.get("ltFilter", {}));
  const SMALL = ["minor", "buoy", "beacon"];
  const LFS = {
    kind: [["all", "すべて"], ["major", "灯台"], ["minor", "小型の灯台"], ["buoy", "灯浮標（ブイ）"], ["beacon", "立標"], ["vessel", "灯船"]],
    color: [["all", "すべて"], ["white", "白"], ["red", "赤"], ["green", "緑"], ["yellow", "黄"]],
    ch: [["all", "すべて"], ["Fl", "せん光"], ["LFl", "長せん光"], ["Q", "急せん光"], ["Oc", "明暗光"], ["Iso", "等明暗光"], ["F", "不動光"], ["Al", "互光（色が交互）"], ["Mo", "モールス符号"]]
  };
  const kindOf = Lt => /light_minor/.test(Lt.type) ? "minor" : /buoy/.test(Lt.type) ? "buoy" : /beacon/.test(Lt.type) ? "beacon" : /light_vessel|light_float/.test(Lt.type) ? "vessel" : "major";
  const chOf = Lt => { const m = (Lt.ch || "").match(/^(Al\.)?(LFl|Fl|Oc|Iso|VQ|UQ|IQ|Q|Mo|F)/); return !m ? "" : m[1] ? "Al" : /Q$/.test(m[2]) ? "Q" : m[2]; };
  function lpass(Lt) {
    if (LF.kind !== "all" && kindOf(Lt) !== LF.kind) return false;
    if (LF.color !== "all" && !Lt.col.includes(LF.color)) return false;
    if (LF.ch !== "all" && (!Lt.known || chOf(Lt) !== LF.ch)) return false;
    if (LF.q && !(Lt.name || "").toLowerCase().includes(LF.q.toLowerCase())) return false;
    return true;
  }
  const nF = () => ["kind", "color", "ch"].filter(k => LF[k] !== "all").length + (LF.q ? 1 : 0);
  function statusText() {
    const shown = [...lights.values()].filter(lpass).length;
    return nF() ? `${shown} / ${lights.size} 灯を表示中` : `${lights.size} 灯${index ? ` ・ ${index.built} 時点のデータ` : ""}`;
  }
  function fCount() {
    const b = $("#lt-filter-btn"); if (!b) return;
    b.classList.toggle("on", !!nF()); b.querySelector("span").textContent = nF() ? `絞り込み（${nF()}）` : "絞り込み";
  }
  function filterUI() {
    const box = $("#lt-filter");
    box.innerHTML = `
      <div class="modal-h" style="font-size:15px"><span>灯りを探す</span><button class="btn icon sm" id="lf-x" aria-label="閉じる">${ic("i-x", "sm")}</button></div>
      <div class="search-box"><svg class="ic"><use href="#i-search"/></svg><input id="lf-q" type="search" placeholder="名前で検索（例：犬吠埼、Lighthouse）" value="${esc(LF.q)}"></div>
      <div id="lf-res" class="lf-res"></div>
      ${Object.entries({ kind: "種類", color: "色", ch: "光り方" }).map(([k, l]) => `<div class="ff-h">${l}</div>
        <div class="chips">${LFS[k].map(([v, t]) => `<button class="chip ${LF[k] === v ? "on" : ""}" data-k="${k}" data-v="${v}">${t}</button>`).join("")}</div>`).join("")}
      <div class="ff-foot"><button class="btn sm" id="lf-reset">条件をクリア</button><span class="muted small" id="lf-count"></span></div>
      <p class="muted small" style="margin:10px 0 0;line-height:1.6">今地図に読み込んでいる範囲から探します。別の海域は、地図を動かすと読み込まれます。</p>`;
    box.onclick = e => {
      e.stopPropagation();
      const b = e.target.closest("[data-k]"), r = e.target.closest("[data-id]");
      if (b) { LF[b.dataset.k] = b.dataset.v; applyF(); filterUI(); }
      if (r) {
        const Lt = lights.get(isNaN(r.dataset.id) ? r.dataset.id : +r.dataset.id) || lights.get(r.dataset.id);
        if (Lt) { box.hidden = true; map.flyTo(Lt.ll, Math.max(map.getZoom(), 13), { duration: 1.2 }); sel = Lt; info(Lt); }
      }
    };
    $("#lf-x").onclick = () => box.hidden = true;
    $("#lf-reset").onclick = () => { Object.assign(LF, { kind: "all", color: "all", ch: "all", q: "" }); applyF(); filterUI(); };
    let qt; $("#lf-q").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { LF.q = e.target.value.trim(); applyF(); results(); }, 250); };
    results();
  }
  function results() {
    const box = $("#lf-res"); if (!box) return;
    const list = [...lights.values()].filter(Lt => lpass(Lt) && Lt.name).sort((a, b) => (b.rng || 0) - (a.rng || 0)).slice(0, 30);
    const shown = [...lights.values()].filter(lpass).length;
    $("#lf-count").textContent = `${shown} / ${lights.size} 灯`;
    box.innerHTML = (LF.q || nF()) ? (list.map(Lt => `<div class="lf-row" data-id="${Lt.id}"><b>${esc(Lt.name)}</b><small>${LFS.kind.find(k => k[0] === kindOf(Lt))[1]} ・ ${esc(Lt.known ? Lt.ch + (Lt.per ? " " + Lt.per + "s" : "") : "光り方未登録")}</small></div>`).join("")
      || `<div class="empty" style="padding:8px 2px">名前のある灯りが見つかりません</div>`) : "";
  }
  function applyF() { Store.set("ltFilter", LF); status(statusText()); fCount(); if (sel && !lpass(sel)) { sel = null; info(null); } }

  function info(Lt) {
    const box = $("#lt-info");
    if (!Lt) { box.hidden = true; return; }
    const rng = Lt.rng ? `${Lt.rng}海里（約${Math.round(Lt.rng * 1.852)}km）先まで届く` : "";
    box.innerHTML = `
      <div class="modal-h" style="font-size:16px"><span>${esc(Lt.name || "名前のない" + TYPE_JA(Lt.type))}</span><button class="btn icon sm" id="lt-x" aria-label="閉じる">${ic("i-x", "sm")}</button></div>
      <div class="muted small">${TYPE_JA(Lt.type)}</div>
      <p class="lt-desc">${Lt.known ? esc(describe(Lt)) : "光り方の情報が登録されていないため、一般的な光り方（" + esc(describe(Lt)) + "）で表示しています"}</p>
      <div class="fd-grid">
        ${Lt.known ? `<div><small>灯質</small><b class="mono">${esc(Lt.ch)}${Lt.per ? " " + Lt.per + "s" : ""}</b></div>` : ""}
        ${rng ? `<div><small>光達距離</small><b>${rng}</b></div>` : ""}
        ${Lt.h ? `<div><small>灯火の高さ</small><b class="mono">${Lt.h}m</b></div>` : ""}
      </div>`;
    box.hidden = false;
    $("#lt-x").onclick = () => { sel = null; info(null); };
  }

  function init() {
    const H = App.home;
    map = darkMap("lmap", { minZoom: 3, worldCopyJump: true }).setView([H.lat, H.lon], 9);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    $("#lmap").classList.add("night-map");
    cv = $("#lcanvas"); g = cv.getContext("2d");
    map.on("resize", resize);
    map.on("moveend", () => { clearTimeout(moveT); moveT = setTimeout(load, 700); });
    map.on("dragstart", () => { if (touring && !flying) tour(false); });   // 自分で地図を動かしたらツアーを止める
    $("#lt-tour-btn").onclick = () => tour(!touring);
    $("#lt-filter-btn").onclick = e => { e.stopPropagation(); const b = $("#lt-filter"); b.hidden = !b.hidden; if (!b.hidden) filterUI(); };
    document.addEventListener("click", e => { const b = $("#lt-filter"); if (b && !b.hidden && !b.contains(e.target)) b.hidden = true; });
    fCount();
    map.on("click", e => {
      const p = e.containerPoint; let best = null, bd = 24;
      const zz = map.getZoom();
      for (const Lt of lights.values()) { if (!lpass(Lt) || (Lt.minor && zz < 8 && !SMALL.includes(LF.kind))) continue; const q = map.latLngToContainerPoint(Lt.ll), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = Lt; } }
      sel = best; info(best);
    });
    $("#lt-spots").innerHTML = `<option value="" disabled selected>灯台の多い海域へ移動…</option>` + SPOTS.map(([n], i) => `<option value="${i}">${i ? n : "現在地の近く"}</option>`).join("");
    $("#lt-spots").onchange = e => {
      const s = SPOTS[+e.target.value][1]; e.target.value = "";
      s ? map.flyTo([s[0], s[1]], s[2], { duration: 1.6 }) : map.flyTo([H.lat, H.lon], 9, { duration: 1.2 });
    };
    load();
  }

  /* ---------- 灯台めぐりツアー ----------
     世界の有名な灯台を順に訪ね、その場所の灯台データ（data/lights/）から本当の光り方を表示する */
  const TOUR = [
    ["地球岬灯台", "日本・北海道室蘭市", 42.3017, 140.9927],
    ["襟裳岬灯台", "日本・北海道えりも町", 41.9256, 143.2486],
    ["宗谷岬灯台", "日本・北海道稚内市（日本最北端の岬）", 45.5228, 141.9361],
    ["犬吠埼灯台", "日本・千葉県銚子市", 35.7076, 140.8686],
    ["潮岬灯台", "日本・和歌山県串本町（本州最南端の岬）", 33.4361, 135.7539],
    ["室戸岬灯台", "日本・高知県室戸市", 33.2456, 134.1764],
    ["角島灯台", "日本・山口県下関市", 34.3522, 130.8475],
    ["残波岬灯台", "日本・沖縄県読谷村", 26.4413, 127.7136],
    ["ケープ・バイロン灯台", "オーストラリア（大陸の最東端）", -28.6386, 153.6365],
    ["アガラス岬灯台", "南アフリカ（アフリカ大陸の最南端）", -34.8297, 20.0092],
    ["ヘラクレスの塔", "スペイン・ア・コルーニャ（ローマ時代に建てられ、今も使われている灯台）", 43.3858, -8.4065],
    ["クレアック灯台", "フランス・ウェサン島", 48.4592, -5.1272],
    ["ファストネット灯台", "アイルランド南西沖の岩礁", 51.3892, -9.6031],
    ["ベルロック灯台", "スコットランド東岸沖（1810年完成の海上灯台）", 56.4339, -2.3872],
    ["リンデスネス灯台", "ノルウェー最南端", 57.9825, 7.0478],
    ["ポートランド・ヘッド灯台", "アメリカ・メイン州", 43.6231, -70.2078],
    ["ペギーズ・ポイント灯台", "カナダ・ノバスコシア州", 44.4917, -63.9183]
  ];
  const STAY = 28000;   // 1か所に滞在する時間
  let touring = false, tourT, flying = false, hist = [], hi = -1, tileCache = new Map();

  /* 次に訪ねる灯台を選ぶ：
     灯台データ（data/lights/）の区画を、灯りの数の平方根に比例した確率でランダムに選び（灯りの多いヨーロッパばかりにならないように）、
     その区画から「光り方が登録された大きな灯台」をランダムに1つ選ぶ。データがまだ無いときは有名な灯台のリストから選ぶ */
  async function pickStop() {
    const idx = await getIndex();
    if (idx) {
      const keys = Object.keys(idx.tiles), w = keys.map(k => Math.sqrt(idx.tiles[k])), sum = w.reduce((a, b) => a + b, 0);
      for (let tries = 0; tries < 8; tries++) {
        let r = Math.random() * sum, k = keys[0];
        for (let i = 0; i < keys.length; i++) { r -= w[i]; if (r <= 0) { k = keys[i]; break; } }
        let rows = tileCache.get(k);
        if (!rows) { try { rows = await (await fetch(`data/lights/${k}.json`)).json(); tileCache.set(k, rows); } catch { continue; } }
        const big = rows.filter(x => x[4] && (/light_major|landmark|light_vessel/.test(x[3] || "") || (x[8] || 0) >= 12));
        if (!big.length) continue;
        const named = big.filter(x => x[2]);
        const pool = named.length && Math.random() < .75 ? named : big;
        const x = pool[Math.floor(Math.random() * pool.length)];
        if (hist.slice(-20).some(h => Math.abs(h.lat - x[0]) < .01 && Math.abs(h.lon - x[1]) < .01) && tries < 7) continue;   // 最近訪ねた灯台は避ける
        return { name: x[2] || "", lat: x[0], lon: x[1] };
      }
    }
    const f = TOUR[Math.floor(Math.random() * TOUR.length)];
    return { name: f[0], place: f[1], lat: f[2], lon: f[3] };
  }
  async function placeName(st) {   // 国・地域名（逆ジオコーディング）
    if (st.place) return st.place;
    try {
      const d = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${st.lat}&longitude=${st.lon}&localityLanguage=ja`)).json();
      st.place = [d.countryName, d.principalSubdivision, d.locality].filter((v, i, a) => v && a.indexOf(v) === i).join("・") || "海の上";
    } catch { st.place = `${Math.abs(st.lat).toFixed(2)}°${st.lat >= 0 ? "N" : "S"} ${Math.abs(st.lon).toFixed(2)}°${st.lon >= 0 ? "E" : "W"}`; }
    return st.place;
  }
  function nearest(lat, lon) {
    let best = null, bd = 6;   // 指定地点から6km以内で一番近い灯り（光り方が登録されたものを優先）
    for (const Lt of lights.values()) {
      const d = Geo.dist(lat, lon, Lt.ll[0], Lt.ll[1]) + (Lt.known ? 0 : 3);
      if (d < bd) { bd = d; best = Lt; }
    }
    return best;
  }
  function tourCard(st, Lt) {
    const c = $("#lt-tour");
    c.innerHTML = `
      <div class="tour-h"><span class="muted small">灯台めぐり ・ <span class="mono">${hi + 1}</span>か所目</span>
        <div class="tour-btns"><button class="btn sm icon" id="tr-prev" aria-label="前の灯台" ${hi <= 0 ? "disabled" : ""}>${ic("i-chev", "sm rot90")}</button>
        <button class="btn sm icon" id="tr-next" aria-label="次の灯台">${ic("i-chev", "sm rotm90")}</button>
        <button class="btn sm" id="tr-stop">${ic("i-x", "sm")}終了</button></div></div>
      <div class="tour-name">${esc(st.name || (Lt && Lt.name) || "名前のない灯台")}</div>
      <div class="muted small">${esc(st.place || "場所を調べています…")}</div>
      <p class="lt-desc">${Lt ? (Lt.known ? esc(describe(Lt)) : `光り方が未登録のため、一般的な光り方（${esc(describe(Lt))}）で表示しています`) + (Lt.rng ? `。光は約${Math.round(Lt.rng * 1.852)}km先まで届きます` : "") : flying ? "移動中…" : "灯台を探しています…"}</p>`;
    c.hidden = false;
    $("#tr-prev").onclick = () => { if (hi > 0) visit(hi - 1); };
    $("#tr-next").onclick = () => next();
    $("#tr-stop").onclick = () => tour(false);
  }
  async function next() {
    clearTimeout(tourT);
    if (hi < hist.length - 1) return visit(hi + 1);
    const st = await pickStop();
    if (!touring) return;
    hist.push(st); if (hist.length > 50) hist.shift();
    visit(hist.length - 1);
  }
  function visit(i) {
    clearTimeout(tourT);
    hi = i; const st = hist[i];
    flying = true; sel = null; info(null);
    tourCard(st, null);
    placeName(st).then(() => { if (hist[hi] === st && touring) tourCard(st, sel); });
    map.flyTo([st.lat, st.lon], 12, { duration: 4 });
    map.once("moveend", async () => {
      flying = false;
      await load();
      for (let k = 0; busy && k < 60; k++) await new Promise(r => setTimeout(r, 250));   // 読み込み中なら終わるまで待つ
      if (!touring || hist[hi] !== st) return;
      sel = nearest(st.lat, st.lon); tourCard(st, sel);
      tourT = setTimeout(next, STAY);
    });
  }
  function tour(on) {
    touring = on; clearTimeout(tourT);
    $("#lt-tour-btn").classList.toggle("on", on);
    if (on) { hist = []; hi = -1; next(); } else { $("#lt-tour").hidden = true; sel = null; }
  }

  App.reg("lights", {
    init,
    show() { visible = true; setTimeout(() => { map.invalidateSize(); resize(); }, 60); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
    hide() { visible = false; cancelAnimationFrame(raf); if (touring) tour(false); },
    amb(v) { if (v && !touring) tour(true); else if (!v && touring) tour(false); }
  });
})();
