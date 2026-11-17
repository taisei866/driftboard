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
    const segs = [], push = (d, on, c = 0) => d > 0 && segs.push({ d, on, c });
    const cols = L.col.length;
    if (L.seq) {
      L.seq.split(",").forEach(grp => grp.split("+").forEach(tok => {
        tok = tok.trim(); const off = /\(/.test(tok), v = parseFloat(tok.replace(/[()]/g, ""));
        if (!isNaN(v)) push(v, !off);
      }));
      const sum = segs.reduce((a, s) => a + s.d, 0);
      if (L.per > sum) push(L.per - sum, false);
      if (segs.length) { let k = 0; segs.forEach(s => { if (s.on) s.c = (k++) % cols; }); return segs; }
    }
    const m = (L.ch || "Fl").match(/^(Al\.)?(F|Fl|LFl|Oc|Iso|Q|VQ|UQ|IQ|Mo)(?:\(([^)]+)\))?/) || [, "", "Fl", "1"];
    const kind = m[2], arg = m[3] || "1", n = parseInt(arg) || 1;
    const def = { F: 1, Fl: 5, LFl: 10, Oc: 5, Iso: 4, Q: 1, VQ: .5, UQ: .25, IQ: 15, Mo: 8 }[kind] || 5;
    let P = L.per > 0 ? L.per : def, k = 0;
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
      if ((kind === "Q" || kind === "VQ" || kind === "UQ") && !m[3]) { push(fl, true, nextC()); push(Math.max(.05, P - fl), false); }
      else {
        const nn = arg.split("+").map(x => parseInt(x) || 1);
        nn.forEach((cnt, gi) => { for (let i = 0; i < cnt; i++) { push(fl, true, nextC()); if (i < cnt - 1) push(gap, false); } if (gi < nn.length - 1) push(gap * 2, false); });
        const sum = segs.reduce((a, s) => a + s.d, 0); push(Math.max(.4, P - sum), false);
      }
    }
    return segs;
  }
  function describe(L) {
    const m = (L.ch || "").match(/^(Al\.)?(F|Fl|LFl|Oc|Iso|Q|VQ|UQ|IQ|Mo)(?:\(([^)]+)\))?/);
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
    let tm = (t + L.phase) % L.total;
    for (const s of L.segs) {
      if (tm < s.d) {
        if (!s.on) return [0, 0];
        const e = Math.min(tm, s.d - tm), ramp = Math.min(1, e / .06);
        return [ramp, s.c];
      }
      tm -= s.d;
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
      const p = map.latLngToContainerPoint(Lt.ll);
      if (p.x < -60 || p.y < -60 || p.x > W + 60 || p.y > H + 60) continue;
      const [lv, ci] = level(Lt, t), rgb = COL[Lt.col[ci]] || COL.white;
      const base = Math.max(3, Math.min(16, 2.5 + (Lt.rng || 3) * .55)) * Math.max(.55, Math.min(1.8, (z - 5) / 5)) * (Lt.minor ? .7 : 1);
      if (lv > .01) {
        const r = base * (2.4 + lv * 1.6);
        g.globalAlpha = lv; g.drawImage(sprite(rgb), p.x - r, p.y - r, r * 2, r * 2);
      }
      g.globalAlpha = .28; g.fillStyle = `rgb(${rgb})`; g.fillRect(p.x - .9, p.y - .9, 1.8, 1.8);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    if (sel) {
      const p = map.latLngToContainerPoint(sel.ll);
      g.strokeStyle = "rgba(79,156,240,.9)"; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, 16, 0, 7); g.stroke();
    }
  }

  /* ---------- 読み込み（Overpass API） ---------- */
  async function load() {
    const z = map.getZoom(), b = map.getBounds().pad(.15);
    if (z < 6) { status("拡大すると、その海域の灯台を読み込みます"); return; }
    if (loaded && loaded.contains(map.getBounds())) return;
    if (busy) return; busy = true;
    status("灯台を読み込み中…");
    const bb = `${b.getSouth().toFixed(3)},${b.getWest().toFixed(3)},${b.getNorth().toFixed(3)},${b.getEast().toFixed(3)}`;
    const q = `[out:json][timeout:25];(node["seamark:light:character"](${bb});node["seamark:light:1:character"](${bb});node["man_made"="lighthouse"](${bb}););out body 4000;`;
    try {
      let d;
      for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
        try {
          const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
          if (r.ok) { d = await r.json(); break; }
        } catch {}
      }
      if (!d) throw new Error("overpass");
      let added = 0;
      for (const el of d.elements || []) {
        if (lights.has(el.id)) continue;
        const tg = el.tags || {}, S = sectorTags(tg);
        const cols = S ? S.col.filter(c => COL[c]) : [];
        const Lt = S ? { ch: S.ch, per: S.per, seq: S.seq, col: cols.length ? cols : ["white"], rng: S.rng, h: S.h, known: true }
          : { ch: "", per: 0, col: ["white"], known: false };
        Lt.id = el.id; Lt.ll = [el.lat, el.lon];
        Lt.name = tg["seamark:name"] || tg["name:ja"] || tg.name || "";
        Lt.type = tg["seamark:type"] || (tg.man_made === "lighthouse" ? "light_major" : "");
        Lt.minor = /buoy|beacon|minor/.test(Lt.type);
        Lt.segs = Lt.known ? pattern(Lt) : [{ d: 1, on: false, c: 0 }];
        Lt.total = Lt.segs.reduce((a, x) => a + x.d, 0) || 1;
        Lt.phase = (el.id % 997) / 997 * Lt.total;
        lights.set(el.id, Lt); added++;
      }
      loaded = loaded ? (loaded.extend(b), loaded) : L_bounds(b);
      status(`${lights.size} 灯を表示中`);
      if (!lights.size) toast("この範囲には灯台が見つかりませんでした。海沿いへ移動してみてください");
    } catch {
      status("灯台データを取得できませんでした。少し待ってから地図を動かしてください");
    } finally { busy = false; }
  }
  const L_bounds = b => L.latLngBounds(b.getSouthWest(), b.getNorthEast());
  function status(t) { $("#lt-status").textContent = t; }

  function info(Lt) {
    const box = $("#lt-info");
    if (!Lt) { box.hidden = true; return; }
    const rng = Lt.rng ? `${Lt.rng}海里（約${Math.round(Lt.rng * 1.852)}km）先まで届く` : "";
    box.innerHTML = `
      <div class="modal-h" style="font-size:16px"><span>${esc(Lt.name || "名前のない" + TYPE_JA(Lt.type))}</span><button class="btn icon sm" id="lt-x" aria-label="閉じる">${ic("i-x", "sm")}</button></div>
      <div class="muted small">${TYPE_JA(Lt.type)}</div>
      <p class="lt-desc">${Lt.known ? esc(describe(Lt)) : "光り方の情報が登録されていません"}</p>
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
    map.on("click", e => {
      const p = e.containerPoint; let best = null, bd = 24;
      for (const Lt of lights.values()) { const q = map.latLngToContainerPoint(Lt.ll), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = Lt; } }
      sel = best; info(best);
    });
    $("#lt-spots").innerHTML = `<option value="" disabled selected>灯台の多い海域へ移動…</option>` + SPOTS.map(([n], i) => `<option value="${i}">${i ? n : "現在地の近く"}</option>`).join("");
    $("#lt-spots").onchange = e => {
      const s = SPOTS[+e.target.value][1]; e.target.value = "";
      s ? map.flyTo([s[0], s[1]], s[2], { duration: 1.6 }) : map.flyTo([H.lat, H.lon], 9, { duration: 1.2 });
    };
    load();
  }

  App.reg("lights", {
    init,
    show() { visible = true; setTimeout(() => { map.invalidateSize(); resize(); }, 60); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); },
    hide() { visible = false; cancelAnimationFrame(raf); }
  });
})();
