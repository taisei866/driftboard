/* アンビエントモード：無操作で各タブをゆっくり巡回 */
const Amb = (() => {
  const TABS = [["flight", "フライト"], ["radio", "ラジオ"], ["space", "宇宙"], ["sky", "星空"], ["clock", "世界時計"]];
  let cfg = Object.assign({ auto: true, idle: 3, every: 60, tabs: ["flight", "sky", "clock", "space"], dim: true }, Store.get("amb", {}));
  let on = false, swallow = 0, last = Date.now(), idx = 0, swT, scrollRaf, clockT;
  const save = () => Store.set("amb", cfg);

  function init() {
    ["pointerdown", "keydown", "wheel"].forEach(ev => document.addEventListener(ev, e => {
      last = Date.now();
      if (on) { e.preventDefault(); e.stopPropagation(); stop(); swallow = Date.now(); }   // 最初のタッチは解除だけに使う
    }, { capture: true, passive: false }));
    document.addEventListener("click", e => { if (Date.now() - swallow < 600) { e.preventDefault(); e.stopPropagation(); } }, true);
    setInterval(() => { if (cfg.auto && !on && cfg.tabs.length && Date.now() - last > cfg.idle * 60000) start(); }, 5000);

    $("#amb-btn").onclick = e => { e.stopPropagation(); const p = $("#amb-panel"); p.hidden = !p.hidden; if (!p.hidden) render(); };
    $("#amb-panel").addEventListener("click", e => e.stopPropagation());   // パネル内の操作では閉じない
    document.addEventListener("click", e => { const p = $("#amb-panel"); if (!p.hidden && !p.contains(e.target) && e.target !== $("#amb-btn")) p.hidden = true; });
  }

  function render() {
    const p = $("#amb-panel");
    const sel = (id, opts, v) => `<select id="${id}">${opts.map(([val, l]) => `<option value="${val}" ${+val === +v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    p.innerHTML = `
      <div class="modal-h" style="font-size:15px"><span>アンビエントモード</span><button class="btn icon sm" id="amb-x" aria-label="閉じる">${ic("i-x", "sm")}</button></div>
      <p class="muted small lead" style="margin-bottom:10px">しばらく触らないと、上下のバーを隠して各タブをゆっくり巡回します。</p>
      <button class="btn primary wide" id="amb-go">${ic("i-moon")}<span>今すぐ開始</span></button>
      <label class="amb-row"><span>無操作で自動開始</span><button class="chip ${cfg.auto ? "on" : ""}" id="amb-auto">${cfg.auto ? "ON" : "OFF"}</button></label>
      <label class="amb-row"><span>開始までの時間</span>${sel("amb-idle", [[1, "1分"], [3, "3分"], [5, "5分"], [10, "10分"], [30, "30分"]], cfg.idle)}</label>
      <label class="amb-row"><span>タブの切り替え間隔</span>${sel("amb-every", [[30, "30秒"], [60, "1分"], [120, "2分"], [300, "5分"]], cfg.every)}</label>
      <label class="amb-row"><span>夜は画面を暗く</span><button class="chip ${cfg.dim ? "on" : ""}" id="amb-dim">${cfg.dim ? "ON" : "OFF"}</button></label>
      <div class="small muted" style="margin:8px 0 4px">巡回するタブ</div>
      <div class="chips small" id="amb-tabs">${TABS.map(([k, l]) => `<button class="chip ${cfg.tabs.includes(k) ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}</div>
      <div class="small muted" style="margin-top:10px">画面に触れると元に戻ります。ラジオは流れたままです。</div>`;
    $("#amb-go").onclick = () => { p.hidden = true; setTimeout(start, 300); };
    $("#amb-x").onclick = () => { p.hidden = true; };
    $("#amb-auto").onclick = () => { cfg.auto = !cfg.auto; save(); render(); };
    $("#amb-dim").onclick = () => { cfg.dim = !cfg.dim; save(); render(); };
    $("#amb-idle").onchange = e => { cfg.idle = +e.target.value; save(); };
    $("#amb-every").onchange = e => { cfg.every = +e.target.value; save(); };
    $("#amb-tabs").onclick = e => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      const k = b.dataset.k; cfg.tabs = cfg.tabs.includes(k) ? cfg.tabs.filter(x => x !== k) : TABS.map(t => t[0]).filter(x => x === k || cfg.tabs.includes(x));
      save(); render();
    };
  }

  function start() {
    if (on || !cfg.tabs.length) return;
    on = true; $("#amb-panel").hidden = true;
    document.body.classList.add("amb"); relayout();
    idx = Math.max(0, cfg.tabs.indexOf(App.cur));
    if (!cfg.tabs.includes(App.cur)) go(cfg.tabs[0]); else enter();
    swT = setInterval(() => { idx = (idx + 1) % cfg.tabs.length; go(cfg.tabs[idx]); }, cfg.every * 1000);
    clock(); clockT = setInterval(clock, 1000);
    App.wake(true);
  }

  function stop() {
    if (!on) return;
    on = false; clearInterval(swT); clearInterval(clockT); cancelAnimationFrame(scrollRaf);
    hook(false);
    document.body.classList.remove("amb"); $("main").classList.remove("fade"); $("#dim").style.opacity = 0;
    relayout();
  }

  function go(tab) {
    const m = $("main"); m.classList.add("fade");
    setTimeout(() => { hook(false); App.show(tab); relayout(); enter(); m.classList.remove("fade"); }, 1300);
  }
  function enter() { hook(true); autoScroll(); }
  function hook(v) { const m = App.mods[App.cur]; if (m && m.amb) m.amb(v); }
  function relayout() { setTimeout(() => dispatchEvent(new Event("resize")), 60); }

  /* スクロールするタブはゆっくり上下に流す */
  function autoScroll() {
    cancelAnimationFrame(scrollRaf);
    const el = $("#tab-" + App.cur); if (!el) return;
    el.scrollTop = 0;
    let dir = 1, pause = performance.now() + 4000, lt = 0;
    const step = t => {
      scrollRaf = requestAnimationFrame(step);
      const dt = lt ? (t - lt) / 1000 : 0; lt = t;
      if (t < pause) return;
      const max = el.scrollHeight - el.clientHeight; if (max < 10) return;
      el.scrollTop += dir * (dir > 0 ? 18 : 120) * dt;
      if (dir > 0 && el.scrollTop >= max - 1) { dir = -1; pause = t + 5000; }
      else if (dir < 0 && el.scrollTop <= 0) { dir = 1; pause = t + 6000; }
    };
    scrollRaf = requestAnimationFrame(step);
  }

  function clock() {
    const now = new Date(), c = $("#amb-clock");
    c.innerHTML = `<div>${Fmt.hm(now)}</div><small>${Fmt.md(now)} ・ ${esc(App.home.name)}</small>`;
    if (now.getSeconds() === 0 || !c.style.left) {   // 焼き付き防止で毎分少しずつ移動
      c.style.left = (4 + Math.random() * 10) + "%"; c.style.bottom = (3 + Math.random() * 6) + "%";
    }
    const night = Sun.elev(App.home.lat, App.home.lon) < -6;
    $("#dim").style.opacity = cfg.dim && night ? .42 : 0;
  }

  return { init, start, stop, get on() { return on; } };
})();
