/* Driftboard design layer — 動きと演出（機能には手を入れず、App の画面切り替えに重ねる） */
const Design = (() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE = matchMedia("(pointer: fine)").matches;
  const EN = { flight: "Flight", weather: "Weather", radio: "Radio", sky: "Night Sky", space: "Space", clock: "World Clock", wind: "Wind", lights: "Lighthouses", obs: "Observatories" };
  const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); Object.assign(e, attrs); e.innerHTML = html; return e; };

  /* ---------- オープニング（セッションごとに1回。タップで飛ばせる） ---------- */
  function intro() {
    let seen = false; try { seen = sessionStorage.getItem("db.intro"); sessionStorage.setItem("db.intro", 1); } catch {}
    if (seen || RM) return;
    const H = App.home, co = `${Math.abs(H.lat).toFixed(3)}°${H.lat >= 0 ? "N" : "S"}  ${Math.abs(H.lon).toFixed(3)}°${H.lon >= 0 ? "E" : "W"}`;
    const ticks = Array.from({ length: 72 }, (_, i) => {
      const a = i / 72 * Math.PI * 2, r1 = i % 6 ? 96 : 92, x1 = 100 + Math.cos(a) * r1, y1 = 100 + Math.sin(a) * r1, x2 = 100 + Math.cos(a) * 100, y2 = 100 + Math.sin(a) * 100;
      return `<line class="tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" style="animation-delay:${(.3 + i * .012).toFixed(3)}s"/>`;
    }).join("");
    const name = "Driftboard".split("").map((c, i) => `<span style="animation-delay:${.7 + i * .06}s">${c}</span>`).join("");
    const box = el("div", { id: "intro" }, `
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle class="ring" cx="100" cy="100" r="100" transform="rotate(-90 100 100)"/>
        <circle class="ring2" cx="100" cy="100" r="78"/>
        ${ticks}
        <line class="cross" x1="100" y1="20" x2="100" y2="180"/><line class="cross" x1="20" y1="100" x2="180" y2="100"/>
        <circle class="core" cx="100" cy="100" r="2.4"/>
      </svg>
      <div class="intro-tx"><div class="intro-name">${name}</div><div class="intro-co">${co}</div></div>
      <div class="intro-skip">TAP TO SKIP</div>`);
    document.body.appendChild(box);
    const end = () => { box.classList.add("out"); setTimeout(() => box.remove(), 1100); };
    box.onclick = end; setTimeout(end, 2600);
  }

  /* ---------- 背景：ゆっくり回る星図（スクロールする画面と「すべて」で表示） ---------- */
  let bg, bx, stars = [], W = 0, H = 0, px = 0, py = 0, tx = 0, ty = 0, bgOn = false, last = 0;
  function bgInit() {
    bg = el("canvas", { id: "bg" }); document.body.prepend(bg); bx = bg.getContext("2d");
    const resize = () => {
      const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
      bg.width = W * d; bg.height = H * d; bx.setTransform(d, 0, 0, d, 0, 0);
      const n = Math.round(Math.min(220, W * H / 7000));
      stars = Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, r: Math.sqrt(Math.random()) * Math.hypot(W, H) * .75,
        s: Math.random() ** 3 * 1.6 + .3, z: Math.random() * .8 + .2, tw: Math.random() * 6 }));
    };
    addEventListener("resize", resize); resize();
    addEventListener("pointermove", e => { tx = (e.clientX / W - .5); ty = (e.clientY / H - .5); }, { passive: true });
    addEventListener("deviceorientation", e => { if (e.gamma == null) return; tx = Math.max(-.5, Math.min(.5, e.gamma / 60)); ty = Math.max(-.5, Math.min(.5, (e.beta - 40) / 60)); }, { passive: true });
    requestAnimationFrame(bgFrame);
  }
  function bgFrame(t) {
    requestAnimationFrame(bgFrame);
    if (!bgOn || document.hidden || t - last < 33) return; last = t;   // 30fps で十分
    px += (tx - px) * .04; py += (ty - py) * .04;
    const cx = W * .78 - px * 30, cy = -H * .15 - py * 30, rot = t / 1000 * .004;
    bx.clearRect(0, 0, W, H);
    // 星図の目盛り（赤緯の円と時角の線）
    bx.strokeStyle = "rgba(120,160,230,.05)"; bx.lineWidth = 1;
    for (let r = 160; r < Math.hypot(W, H) * 1.4; r += 160) { bx.beginPath(); bx.arc(cx, cy, r, 0, Math.PI * 2); bx.stroke(); }
    for (let i = 0; i < 24; i++) {
      const a = rot + i / 24 * Math.PI * 2; bx.beginPath(); bx.moveTo(cx, cy); bx.lineTo(cx + Math.cos(a) * 3000, cy + Math.sin(a) * 3000); bx.stroke();
    }
    for (const s of stars) {
      const a = s.a + rot, x = cx + Math.cos(a) * s.r - px * 40 * s.z, y = cy + Math.sin(a) * s.r - py * 40 * s.z;
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      const al = (.35 + .65 * (.5 + .5 * Math.sin(t / 1000 * (.6 + s.z) + s.tw))) * s.z;
      bx.fillStyle = `rgba(${s.s > 1.2 ? "200,225,255" : "170,190,230"},${al.toFixed(2)})`;
      bx.beginPath(); bx.arc(x, y, s.s, 0, Math.PI * 2); bx.fill();
    }
  }
  function bgState() {
    const tab = $("#tab-" + App.cur);
    bgOn = !$("#launcher").hidden || !!(tab && tab.classList.contains("scroll"));
    bg.classList.toggle("on", bgOn);
  }

  /* ---------- 画面切り替えの演出 ---------- */
  let io;
  function reveal(tab) {
    if (RM || !tab) return;
    io?.disconnect();
    io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .05 });
    const items = [...tab.querySelectorAll(".panel, .city, .obs-card, .obs-mapbox, .ck-mapbox, .ck-head")].filter(x => !x.closest(".leaflet-container"));
    items.slice(0, 40).forEach((x, i) => { x.classList.remove("in"); x.classList.add("rv"); x.style.setProperty("--i", Math.min(i, 10)); io.observe(x); });
    setTimeout(() => items.forEach(x => x.classList.add("in")), 2500);   // 念のため
  }
  function transition(name) {
    const tab = $("#tab-" + name); if (!tab) return;
    document.body.dataset.tab = name;
    if (!RM) {
      tab.classList.remove("enter"); void tab.offsetWidth; tab.classList.add("enter");
      setTimeout(() => tab.classList.remove("enter"), 800);
      const v = $("#veil"); v.classList.remove("go"); void v.offsetWidth; v.classList.add("go");
      const i = App.views.findIndex(x => x.id === name), t = $("#tab-title");
      t.textContent = `${String(i + 1).padStart(2, "0")} — ${EN[name] || name}`;
      t.classList.remove("go"); void t.offsetWidth; t.classList.add("go");
    }
    replayMast(tab);
    setTimeout(() => reveal(tab), 30);
    bgState(); indicator();
  }

  /* ---------- 下部バーのインジケーター ---------- */
  function indicator() {
    const nav = $("#tabs"); let ind = $("#tab-ind");
    if (!ind) { ind = el("i", { id: "tab-ind" }); nav.appendChild(ind); }
    const b = nav.querySelector("button.on"); if (!b) { ind.style.width = 0; return; }
    const w = b.offsetWidth * .5;
    ind.style.width = w + "px"; ind.style.transform = `translateX(${b.offsetLeft + (b.offsetWidth - w) / 2}px)`;
  }

  /* ---------- 指先・カーソルを追う光 ---------- */
  const SPOT = ".panel, .city, .obs-card";
  let hot = null;
  function spotlight(e) {
    const t = e.target.closest?.(SPOT);
    if (t !== hot) { hot?.classList.remove("hot"); hot = t; if (t) { if (getComputedStyle(t).position === "static") t.style.position = "relative"; t.classList.add("spot", "hot"); } }
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty("--mx", (e.clientX - r.left) + "px"); t.style.setProperty("--my", (e.clientY - r.top) + "px");
  }
  function cursor() {
    if (!FINE || RM) return;
    const c = el("div", { id: "cur" }); document.body.appendChild(c);
    let x = -100, y = -100, cx = x, cy = y;
    addEventListener("pointermove", e => { if (e.pointerType !== "mouse") return; x = e.clientX; y = e.clientY; c.classList.add("on");
      c.classList.toggle("hov", !!e.target.closest("button, a, select, input, label, [role=button], .city, .obs-card, .fl-row, .st-row, .lf-row, .su-row")); }, { passive: true });
    addEventListener("pointerdown", () => c.classList.add("down")); addEventListener("pointerup", () => c.classList.remove("down"));
    document.addEventListener("mouseleave", () => c.classList.remove("on"));
    (function loop() { cx += (x - cx) * .22; cy += (y - cy) * .22; c.style.transform = `translate(${cx}px,${cy}px)`; requestAnimationFrame(loop); })();
  }
  function ripple(e) {
    const t = e.target.closest(".btn, .chip, #tabs button, .ln-card, .seg button"); if (!t || RM) return;
    const r = t.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2;
    if (getComputedStyle(t).position === "static") t.style.position = "relative";
    t.style.overflow = "hidden";
    const s = el("span", { className: "rip" });
    Object.assign(s.style, { width: d + "px", height: d + "px", left: (e.clientX - r.left - d / 2) + "px", top: (e.clientY - r.top - d / 2) + "px" });
    t.appendChild(s); setTimeout(() => s.remove(), 750);
  }

  /* ---------- ヘッダーの時計（秒を小さく添える） ---------- */
  function clock() {
    const c = $("#hdr-clock");
    const tick = () => { const d = new Date(); c.innerHTML = `<b>${Fmt.hm(d)}</b>:${String(d.getSeconds()).padStart(2, "0")}`; };
    tick(); setInterval(tick, 1000);
  }

  /* ---------- スクロールする画面の見出し ---------- */
  function masts() {
    const H = App.home, co = `${Math.abs(H.lat).toFixed(2)}°${H.lat >= 0 ? "N" : "S"} ${Math.abs(H.lon).toFixed(2)}°${H.lon >= 0 ? "E" : "W"}`;
    App.views.forEach((v, i) => {
      const tab = $("#tab-" + v.id);
      if (!tab || !tab.classList.contains("scroll") || tab.querySelector(".mast")) return;
      const title = (EN[v.id] || v.name).split("").map((c, k) => `<span style="animation-delay:${k * 35}ms">${c === " " ? "&nbsp;" : c}</span>`).join("");
      const m = el("header", { className: "mast" }, `<span class="mast-no">${String(i + 1).padStart(2, "0")}</span>
        <h1 aria-label="${v.name}" data-no="${String(i + 1).padStart(2, "0")}">${title}</h1><p>${v.name} — ${v.desc}</p>
        <div class="mast-meta"><b>${esc(H.name)}</b><br>${co}</div>`);
      tab.prepend(m);
    });
  }
  function replayMast(tab) {
    const h = tab?.querySelector(".mast h1"); if (!h || RM) return;
    h.querySelectorAll("span").forEach(s => { s.style.animation = "none"; void s.offsetWidth; s.style.animation = ""; });
  }

  /* 四隅のフレーム：右上のモード切替を文字に、右下に緯度・経度 */
  function frame() {
    const H = App.home;
    $("#amb-btn").innerHTML = "<span>Night</span>"; $("#fs").innerHTML = "<span>Full</span>";
    const co = el("div", { id: "corner-co" }, `${Math.abs(H.lat).toFixed(4)}°${H.lat >= 0 ? "N" : "S"}<br>${Math.abs(H.lon).toFixed(4)}°${H.lon >= 0 ? "E" : "W"}`);
    $("#tabs").after(co);
    $(".brand").innerHTML = `<i class="brand-mark"></i>Driftboard<em>夜の観測窓</em>`;
  }

  function init() {
    frame();
    document.body.append(el("div", { id: "veil" }), el("div", { id: "tab-title" }));
    masts(); bgInit(); cursor(); intro();
    addEventListener("pointermove", spotlight, { passive: true });
    addEventListener("pointerdown", e => { spotlight(e); ripple(e); }, { passive: true });
    addEventListener("resize", indicator);
    // App の画面切り替え・下部バー・「すべて」に演出を重ねる
    const show = App.show.bind(App), nav = App.nav.bind(App), launcher = App.launcher.bind(App);
    App.show = name => { const before = App.cur; show(name); if (App.cur !== before) transition(App.cur); };
    App.nav = () => { nav(); indicator(); };
    App.launcher = open => { launcher(open); bgState(); };
    indicator(); transition(App.cur);
  }
  return { init };
})();
