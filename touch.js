/* Driftboard — touch layer
   タブバーを置かず、指で夜の空間を左右にスワイプして画面を移動する。
   ・画面の切り替え：今の画面は奥へ縮みながら透けて消え、次の画面が手前に浮かび上がる
   ・下端の極細の目盛りと「01 — 09」の表記、右上の INDEX から、全画面の一覧を開ける
   ・指が触れた場所から、淡い月明かりの輪が広がる
   ・スクロールに少し遅れて、背景の星図と端の座標文字が漂う */
const Drift = (() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); Object.assign(e, attrs); e.innerHTML = html; return e; };
  const EN = { flight: "Flight", weather: "Weather", radio: "Radio", sky: "Night Sky", space: "Space", clock: "World Clock", wind: "Wind", lights: "Lighthouses", obs: "Observatories" };
  const ids = () => App.views.map(v => v.id);
  const idx = () => Math.max(0, ids().indexOf(App.cur));
  const pad = n => String(n).padStart(2, "0");

  /* ---------- 画面の移動 ---------- */
  let dir = 1, busy = false;
  function go(step) {
    const L = ids(), n = L.length; dir = step >= 0 ? 1 : -1;
    App.show(L[(idx() + step + n) % n]);
  }
  function wrapShow() {
    const inner = App.show.bind(App);
    App.show = name => {
      const old = $("#tab-" + App.cur), before = App.cur;
      if (name === before) return inner(name);
      const L = ids(); if (before && L.indexOf(name) >= 0) { const d = L.indexOf(name) - L.indexOf(before); dir = Math.abs(d) > L.length / 2 ? -Math.sign(d) : Math.sign(d) || dir; }
      document.body.style.setProperty("--dir", dir);
      if (old && !RM) {   // 前の画面は奥へ沈みながら消える
        old.classList.add("leaving"); old.style.transform = ""; old.style.opacity = ""; old.style.filter = "";
        setTimeout(() => old.classList.remove("leaving"), 620);
      }
      inner(name);
      const nw = $("#tab-" + App.cur);
      if (nw && !RM) { nw.classList.remove("arriving"); void nw.offsetWidth; nw.classList.add("arriving"); setTimeout(() => nw.classList.remove("arriving"), 900); }
      ruler();
    };
  }

  /* ---------- スワイプ ----------
     地図・星空・ダイヤルなど、指でなぞって操作する部品の上では、その部品の操作を優先する。
     そうした部品の上でも、画面の左右の端（24px）から始めたスワイプなら画面を移動する */
  const OWN = ".leaflet-container, #sky, #fradar, #rd-dial, #wx-sky, #orrery, #ck-globe, input, select, textarea, .ff, #amb-panel, .modal, #index, .lt-tour";
  let sx = 0, sy = 0, st = 0, track = false, decided = false, horiz = false, tab = null;
  function onStart(e) {
    if (e.touches.length !== 1 || document.body.classList.contains("amb") || !$("#index").hidden) { track = false; return; }
    const t = e.touches[0], edge = t.clientX < 24 || t.clientX > innerWidth - 24;
    track = edge || !e.target.closest(OWN);
    sx = t.clientX; sy = t.clientY; st = performance.now(); decided = false; horiz = false; tab = $("#tab-" + App.cur);
  }
  function onMove(e) {
    if (!track) return;
    const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (!decided && Math.hypot(dx, dy) > 10) { decided = true; horiz = Math.abs(dx) > Math.abs(dy) * 1.4; if (!horiz) { track = false; return; } }
    if (!horiz || !tab) return;
    e.preventDefault();
    // 指についてくる：少し横に流れ、奥へ縮み、透けていく
    const k = Math.min(1, Math.abs(dx) / innerWidth);
    tab.style.transition = "none";
    tab.style.transform = `translateX(${dx * .22}px) scale(${1 - k * .06})`;
    tab.style.opacity = String(1 - k * .7); tab.style.filter = `blur(${k * 4}px)`;
  }
  function onEnd(e) {
    if (!track || !horiz || !tab) { track = false; return; }
    track = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, v = Math.abs(dx) / Math.max(1, performance.now() - st);
    if (Math.abs(dx) > innerWidth * .22 || (v > .5 && Math.abs(dx) > 40)) { go(dx < 0 ? 1 : -1); }
    else {   // 戻る
      tab.style.transition = "transform .7s cubic-bezier(.16,1,.3,1), opacity .7s cubic-bezier(.16,1,.3,1), filter .7s cubic-bezier(.16,1,.3,1)";
      tab.style.transform = ""; tab.style.opacity = ""; tab.style.filter = "";
      const tt = tab; setTimeout(() => { tt.style.transition = ""; }, 720);
    }
  }

  /* ---------- 下端の目盛りと現在地表記 ---------- */
  function ruler() {
    const r = $("#ruler"); if (!r) return;
    const L = App.views, i = idx();
    r.querySelector(".rl-ticks").innerHTML = L.map((v, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("");
    r.querySelector(".rl-no").textContent = `${pad(i + 1)} — ${pad(L.length)}`;
    r.querySelector(".rl-name").textContent = `${EN[App.cur] || ""}`;
    r.querySelector(".rl-ja").textContent = L[i] ? L[i].name : "";
    const p = $("#nb-prev"), n = $("#nb-next");
    p.setAttribute("aria-label", "前へ：" + L[(i - 1 + L.length) % L.length].name); n.setAttribute("aria-label", "次へ：" + L[(i + 1) % L.length].name);
  }

  /* ---------- INDEX：全画面のタイポグラフィ一覧 ---------- */
  function openIndex(open) {
    const x = $("#index");
    if (!open) { x.classList.remove("on"); setTimeout(() => { if (!x.classList.contains("on")) x.hidden = true; }, 700); return; }
    const L = App.views, i = idx(), H = App.home;
    x.querySelector(".ix-list").innerHTML = L.map((v, k) => `
      <button class="ix-item ${k === i ? "on" : ""}" data-go="${v.id}" style="--k:${k}">
        <span class="ix-no">${pad(k + 1)}</span><span class="ix-ja">${v.name}</span><span class="ix-en">${EN[v.id] || ""}</span>
      </button>`).join("");
    x.querySelector(".ix-co").innerHTML = `${esc(H.name)}<br>${Math.abs(H.lat).toFixed(4)}°${H.lat >= 0 ? "N" : "S"} ${Math.abs(H.lon).toFixed(4)}°${H.lon >= 0 ? "E" : "W"}`;
    x.hidden = false; void x.offsetWidth; x.classList.add("on");
  }

  /* ---------- 指先の月明かり ---------- */
  function ripple(e) {
    if (RM) return;
    const r = el("i", { className: "moon-ring" });
    r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
    document.body.appendChild(r); setTimeout(() => r.remove(), 1400);
  }

  /* ---------- スクロールに少し遅れて漂うもの ---------- */
  let target = 0, now = 0;
  function parallax() {
    now += (target - now) * .08;
    const bg = $("#bg"), co = $("#drift-co");
    if (bg) bg.style.transform = `translateY(${-now * .04}px)`;
    if (co) co.style.transform = `translateY(${-now * .12}px)`;
    document.body.style.setProperty("--grain-y", `${-now * .06}px`);
    requestAnimationFrame(parallax);
  }

  function init() {
    document.body.classList.add("touchui");
    // 右上：INDEX、下端：目盛りと現在地、前後への極小ボタン、端の座標文字
    const top = $(".top-right");
    const ib = el("button", { id: "index-btn", className: "corner-btn", type: "button" }, "Index");
    top.appendChild(ib);
    const ru = el("button", { id: "ruler", type: "button", ariaLabel: "画面の一覧を開く" },
      `<span class="rl-ticks"></span><span class="rl-meta"><span class="rl-no"></span><span class="rl-name"></span><span class="rl-ja"></span></span>`);
    const pv = el("button", { id: "nb-prev", className: "nb", type: "button" }, "←"), nx = el("button", { id: "nb-next", className: "nb", type: "button" }, "→");
    const H = App.home;
    const co = el("div", { id: "drift-co", ariaHidden: "true" }, `${Math.abs(H.lat).toFixed(4)}°${H.lat >= 0 ? "N" : "S"} — ${Math.abs(H.lon).toFixed(4)}°${H.lon >= 0 ? "E" : "W"} — Driftboard`);
    const ix = el("div", { id: "index", hidden: true, role: "dialog", ariaLabel: "画面の一覧" }, `
      <div class="ix-head"><span>Index</span><button class="ix-x" type="button" aria-label="閉じる">Close</button></div>
      <nav class="ix-list"></nav>
      <div class="ix-foot">
        <div class="ix-co"></div>
        <div class="ix-acts"><button type="button" data-act="loc">場所</button><button type="button" data-act="night">Night</button><button type="button" data-act="full">Full</button></div>
      </div>`);
    document.body.append(ru, pv, nx, co, ix);
    ib.onclick = () => openIndex(true); ru.onclick = () => openIndex(true);
    pv.onclick = () => go(-1); nx.onclick = () => go(1);
    ix.addEventListener("click", e => {
      const g = e.target.closest("[data-go]"), a = e.target.closest("[data-act]");
      if (g) { openIndex(false); setTimeout(() => App.show(g.dataset.go), 120); return; }
      if (a) {
        openIndex(false);
        if (a.dataset.act === "loc") Setup.open(false);
        if (a.dataset.act === "night") setTimeout(() => $("#amb-btn").click(), 50);
        if (a.dataset.act === "full") App.fullscreen(true);
        return;
      }
      if (e.target.closest(".ix-x") || e.target === ix) openIndex(false);
    });
    // 旧「すべて」も INDEX に置き換える
    App.launcher = open => openIndex(open);
    document.addEventListener("keydown", e => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") openIndex(false);
    });
    // 地図などが途中でイベントを止めても受け取れるよう、捕捉段階で聞く
    addEventListener("touchstart", onStart, { passive: true, capture: true });
    addEventListener("touchmove", onMove, { passive: false, capture: true });
    addEventListener("touchend", onEnd, { passive: true, capture: true });
    addEventListener("touchcancel", () => { track = false; if (tab) { tab.style.transform = ""; tab.style.opacity = ""; tab.style.filter = ""; } });
    addEventListener("pointerdown", ripple, { passive: true });
    document.addEventListener("scroll", e => { if (e.target.classList && e.target.classList.contains("tab")) target = e.target.scrollTop; }, { capture: true, passive: true });
    wrapShow(); ruler();
    requestAnimationFrame(parallax);
  }
  return { init, go };
})();
