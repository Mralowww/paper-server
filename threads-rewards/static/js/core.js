/* =========================================================
   Threads 獎勵計畫 — 共用核心：i18n、音效、導覽、彈窗、右鍵選單、
   搜尋面板、下拉選單、動畫工具
   ========================================================= */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tr." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("tr." + k, JSON.stringify(v)); } catch { /* 私密模式 */ } },
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- i18n ---------- */
  const guessLang = () => ((navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en");
  let lang = store.get("lang", guessLang());
  if (!window.I18N[lang]) lang = "zh";
  const t = (key, vars = {}) => {
    const s = (window.I18N[lang] && window.I18N[lang][key]) ?? window.I18N.zh[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  };
  const applyI18n = (root = document) => {
    $$("[data-i18n]", root).forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-ph]", root).forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $$("[data-i18n-title]", root).forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.documentElement.lang = { zh: "zh-Hant", en: "en" }[lang];
  };
  const setLang = (l) => { lang = l; store.set("lang", l); applyI18n(); document.dispatchEvent(new CustomEvent("langchange")); };

  /* ---------- 合成音效（Web Audio，不使用音效檔） ---------- */
  let actx = null;
  const sound = {
    get enabled() { return store.get("sound", true); },
    set enabled(v) { store.set("sound", v); },
    get volume() { return store.get("volume", 0.4); },
    set volume(v) { store.set("volume", v); },
  };
  function tone({ f = 440, f2 = null, d = 0.1, type = "sine", v = 1, at = 0, attack = 0.005 }) {
    const ctx = actx; const now = ctx.currentTime + at;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + d);
    const peak = 0.25 * v * sound.volume;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    o.connect(g).connect(ctx.destination); o.start(now); o.stop(now + d + 0.02);
  }
  function noise({ d = 0.15, v = 1, at = 0, from = 3000, to = 300 }) {
    const ctx = actx; const now = ctx.currentTime + at;
    const buf = ctx.createBuffer(1, ctx.sampleRate * d, ctx.sampleRate);
    const data = buf.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const flt = ctx.createBiquadFilter(); flt.type = "bandpass"; flt.frequency.setValueAtTime(from, now); flt.frequency.exponentialRampToValueAtTime(to, now + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18 * v * sound.volume, now); g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    src.connect(flt).connect(g).connect(ctx.destination); src.start(now);
  }
  const SFX = {
    click: () => tone({ f: 880, f2: 660, d: 0.05, type: "triangle", v: 0.6 }),
    hover: () => tone({ f: 1400, d: 0.025, type: "sine", v: 0.15 }),
    switch: () => { tone({ f: 520, f2: 780, d: 0.08, type: "triangle", v: 0.5 }); },
    toggleOn: () => { tone({ f: 600, d: 0.05, type: "square", v: 0.25 }); tone({ f: 900, d: 0.07, type: "square", v: 0.25, at: 0.05 }); },
    toggleOff: () => { tone({ f: 900, d: 0.05, type: "square", v: 0.25 }); tone({ f: 600, d: 0.07, type: "square", v: 0.25, at: 0.05 }); },
    popup: () => tone({ f: 300, f2: 900, d: 0.14, type: "sine", v: 0.6 }),
    close: () => tone({ f: 700, f2: 250, d: 0.12, type: "sine", v: 0.4 }),
    success: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: 0.16, type: "triangle", v: 0.55, at: i * 0.075 })),
    error: () => { tone({ f: 220, f2: 140, d: 0.25, type: "sawtooth", v: 0.35 }); tone({ f: 180, f2: 110, d: 0.28, type: "square", v: 0.2, at: 0.08 }); },
    copy: () => { tone({ f: 1200, d: 0.04, type: "sine", v: 0.4 }); tone({ f: 1600, d: 0.06, type: "sine", v: 0.4, at: 0.05 }); },
    send: () => { noise({ d: 0.22, v: 0.8, from: 800, to: 5000 }); tone({ f: 400, f2: 1200, d: 0.18, type: "sine", v: 0.4 }); },
    receive: () => { tone({ f: 988, d: 0.1, type: "sine", v: 0.5 }); tone({ f: 1319, d: 0.16, type: "sine", v: 0.5, at: 0.09 }); },
    menu: () => tone({ f: 660, f2: 990, d: 0.06, type: "triangle", v: 0.35 }),
    delete: () => noise({ d: 0.2, v: 0.8, from: 2500, to: 200 }),
    tick: () => tone({ f: 2000, d: 0.015, type: "square", v: 0.08 }),
    launch: () => { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, d: 0.22, type: "triangle", v: 0.5, at: i * 0.06 })); noise({ d: 0.6, v: 0.5, from: 400, to: 6000, at: 0.2 }); },
  };
  const sfx = (name) => {
    if (!sound.enabled || document.documentElement.dataset.motion === "reduce" && name === "hover") return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      SFX[name] && SFX[name]();
    } catch { /* 瀏覽器不支援 */ }
  };

  /* ---------- 頂部進度條 ---------- */
  let pending = 0; let barTimer;
  const bar = () => $("#topbar") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "topbar" }));
  const progress = {
    start() { pending++; const b = bar(); clearTimeout(barTimer); b.style.opacity = 1; b.style.width = "15%"; setTimeout(() => pending && (b.style.width = "65%"), 120); },
    done() { pending = Math.max(0, pending - 1); if (pending) return; const b = bar(); b.style.width = "100%"; barTimer = setTimeout(() => { b.style.opacity = 0; setTimeout(() => (b.style.width = "0"), 400); }, 250); },
  };

  /* ---------- API ---------- */
  async function api(path, { method = "GET", body, quiet = false } = {}) {
    if (!quiet) progress.start();
    try {
      const res = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`); e.status = res.status; throw e; }
      return data;
    } finally { if (!quiet) progress.done(); }
  }

  /* ---------- 格式化 ---------- */
  const nf = () => new Intl.NumberFormat({ zh: "zh-TW", en: "en-US" }[lang]);
  const fmt = (n, d = 0) => nf().format(Number((+n || 0).toFixed(d)));
  const compact = (n) => new Intl.NumberFormat({ zh: "zh-TW", en: "en-US" }[lang], { notation: "compact", maximumFractionDigits: 1 }).format(+n || 0);
  const ago = (iso) => {
    if (!iso) return t("links.never");
    const s = (Date.now() - new Date(iso)) / 1000;
    const rtf = new Intl.RelativeTimeFormat({ zh: "zh-TW", en: "en" }[lang], { numeric: "auto" });
    if (s < 60) return rtf.format(-Math.round(s), "second");
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
    return rtf.format(-Math.round(s / 86400), "day");
  };
  const date = (iso, withTime = true) => new Date(iso).toLocaleString({ zh: "zh-TW", en: "en-US" }[lang], withTime ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } : { month: "2-digit", day: "2-digit" });

  /* ---------- 手繪 16×16 像素圖示 ---------- */
  const PX = {
    heart: ["................", "..####....####..", ".#++###..######.", "#++#############", "#+##############", "################", "################", ".##############.", "..############..", "...##########...", "....########....", ".....######.....", "......####......", ".......##.......", "................", "................"],
    reply: ["................", "..############..", ".##############.", "################", "################", "###++##++##++###", "###++##++##++###", "################", "################", ".##############.", "..############..", "...###..........", "..###...........", ".###............", "................", "................"],
    repost: ["................", "...........#....", "...........##...", "..############..", "..##.......##...", "..##.......#....", "..##............", "..##............", "............##..", "............##..", "....#.......##..", "...##.......##..", "..############..", "...##...........", "....#...........", "................"],
    eye: ["................", "................", "................", ".....######.....", "...##......##...", "..#....##....#..", ".#....####....#.", "#....##++##....#", "#....##++##....#", ".#....####....#.", "..#....##....#..", "...##......##...", ".....######.....", "................", "................", "................"],
    trophy: ["................", "...##########...", "##.##########.##", "#..#+########..#", "#..#+########..#", "#..##########..#", ".#.##########.#.", "..############..", "....########....", "......####......", ".......##.......", ".......##.......", ".....######.....", "....########....", "....########....", "................"],
    crown: ["................", "................", ".......##.......", ".#.....##.....#.", ".##...####...##.", ".###.######.###.", ".##############.", ".##############.", ".###++####++###.", ".##############.", ".##############.", "................", ".##############.", ".##############.", "................", "................"],
    star: [".......##.......", ".......##.......", "......####......", "......####......", "################", ".##############.", "..############..", "...##########...", "....########....", "....########....", "...####..####...", "...###....###...", "..###......###..", "..##........##..", ".#............#.", "................"],
    user: ["................", "......####......", ".....######.....", "....########....", "....########....", "....########....", ".....######.....", "......####......", "................", "...##########...", "..############..", ".##############.", ".##############.", ".##############.", "................", "................"],
    chart: ["................", "................", "................", "............##..", "............##..", "............##..", "........##..##..", "........##..##..", "........##..##..", "....##..##..##..", "....##..##..##..", "....##..##..##..", "....##..##..##..", "..############..", "................", "................"],
  };
  const PX_COLOR = { heart: "var(--c-likes)", reply: "var(--c-replies)", repost: "var(--c-reposts)", eye: "var(--c-views)", trophy: "gold", crown: "gold", star: "gold", user: "var(--text-2)", chart: "gold" };
  let pxId = 0;
  function px(name, size = 16, color) {
    const grid = PX[name]; if (!grid) return "";
    color = color || PX_COLOR[name] || "currentColor";
    let defs = ""; let fill = color;
    if (color === "gold") { const id = "pxg" + ++pxId; defs = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#f5c542"/><stop offset="1" stop-color="#e08a1e"/></linearGradient></defs>`; fill = `url(#${id})`; }
    let rects = "";
    grid.forEach((row, y) => {
      let x = 0;
      while (x < 16) {
        const c = row[x]; if (c === ".") { x++; continue; }
        let w = 1; while (row[x + w] === c) w++;
        rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c === "+" ? "rgba(255,255,255,.85)" : fill}"/>`;
        x += w;
      }
    });
    return `<svg class="px-icon" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${defs}${rects}</svg>`;
  }
  const metricsHTML = (r, keys = ["likes", "replies", "reposts", "views"]) => {
    const icon = { likes: "heart", replies: "reply", reposts: "repost", views: "eye" };
    return keys.map((k) => `<span class="metric ${k}" title="${t("m." + k)}">${px(icon[k], 13)}${compact(r[k])}</span>`).join("");
  };

  /* ---------- 數字跳動 ---------- */
  function countUp(el, target, { dur = 1400, decimals = 0, compactFmt = false } = {}) {
    target = +target || 0;
    const reduce = document.documentElement.dataset.motion === "reduce";
    const show = (v) => { el.textContent = compactFmt && v >= 10000 ? compact(v) : fmt(v, decimals); };
    if (reduce) return show(target);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur); const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      show(target * e);
      if (p < 1) requestAnimationFrame(step);
      else { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
    };
    requestAnimationFrame(step);
  }
  const countAll = (root = document) => $$("[data-count]", root).forEach((el) => {
    if (el.dataset.counted) return; el.dataset.counted = 1;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); countUp(el, el.dataset.count, { decimals: +(el.dataset.decimals || 0), compactFmt: el.dataset.compact === "1" }); } });
    io.observe(el);
  });

  /* ---------- 捲動浮現 ---------- */
  const revealIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealIO.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  const observe = (root = document) => {
    $$(".reveal, .reveal-l, .reveal-s", root).forEach((el, i) => { if (!el.classList.contains("in")) { el.style.transitionDelay = (el.dataset.delay || (i % 6) * 60) + "ms"; revealIO.observe(el); } });
    countAll(root); enhanceSelects(root); applyI18n(root);
  };

  /* ---------- 按鈕波紋 ---------- */
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".btn, .tabs button"); if (!btn || btn.disabled) return;
    const r = btn.getBoundingClientRect(); const d = Math.max(r.width, r.height);
    const s = document.createElement("span"); s.className = "ripple";
    Object.assign(s.style, { width: d + "px", height: d + "px", left: e.clientX - r.left - d / 2 + "px", top: e.clientY - r.top - d / 2 + "px" });
    if (btn.classList.contains("btn")) { btn.appendChild(s); setTimeout(() => s.remove(), 650); }
    sfx("click");
  });

  /* ---------- 覆蓋層 / 彈窗 ---------- */
  const overlays = [];
  function openOverlay(inner, { onClose, cls = "" } = {}) {
    const ov = document.createElement("div"); ov.className = "overlay " + cls; ov.innerHTML = inner;
    const close = (silent) => {
      if (ov.classList.contains("closing")) return; ov.classList.add("closing");
      overlays.splice(overlays.indexOf(close), 1); if (!silent) sfx("close");
      setTimeout(() => { ov.remove(); onClose && onClose(); }, 200);
    };
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov); overlays.push(close); applyI18n(ov);
    return { el: ov, close };
  }
  const CHECK = `<svg class="check-svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" fill="none" stroke="var(--green)" stroke-width="4" stroke-linecap="round"/><path d="M23 37 l9 9 l17 -19" fill="none" stroke="var(--green)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const CROSS = `<svg class="check-svg" viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" fill="none" stroke="var(--red)" stroke-width="4" stroke-linecap="round"/><path d="M26 26 L46 46 M46 26 L26 46" fill="none" stroke="var(--red)" stroke-width="5" stroke-linecap="round"/></svg>`;
  function toast(type, title, msg = "", duration = 2600) {
    const err = type === "error";
    const o = openOverlay(`<div class="toast-box ${err ? "error" : ""}" role="alertdialog">${err ? CROSS : CHECK}<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="toast-timer" style="animation: countdownBar ${duration}ms linear forwards"></div></div>`);
    sfx(err ? "error" : "success");
    const timer = setTimeout(() => o.close(true), duration);
    o.el.addEventListener("click", () => { clearTimeout(timer); o.close(true); });
    return o;
  }
  const ok = (title, msg, d) => toast("success", title || t("ok"), msg, d);
  const fail = (msg, title) => toast("error", title || t("err"), msg, 3400);

  function modal({ title = "", body = "", foot = "", wide = false }) {
    sfx("popup");
    const o = openOverlay(`<div class="modal" style="${wide ? "width:min(760px,100%)" : ""}"><div class="modal-head"><h3>${title}</h3><button class="btn icon ghost" data-close aria-label="close">✕</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div>`);
    $$("[data-close]", o.el).forEach((b) => b.addEventListener("click", () => o.close()));
    observe(o.el);
    return o;
  }
  const confirmBox = (msg, { danger = false } = {}) => new Promise((resolve) => {
    let answered = false;
    const o = modal({ title: esc(t("confirm")), body: `<p style="margin:0">${esc(msg)}</p>`, foot: `<button class="btn" data-close data-i18n="cancel"></button><button class="btn ${danger ? "danger" : "gold"}" data-yes data-i18n="confirm"></button>` });
    applyI18n(o.el);
    $("[data-yes]", o.el).addEventListener("click", () => { answered = true; resolve(true); o.close(true); });
    const origClose = o.close; overlays[overlays.length - 1] = (s) => { if (!answered) resolve(false); origClose(s); };
    $$("[data-close]", o.el).forEach((b) => b.addEventListener("click", () => !answered && resolve(false)));
    o.el.addEventListener("mousedown", (e) => { if (e.target === o.el && !answered) resolve(false); });
  });

  /* ---------- 圖片放大 ---------- */
  const zoom = (src) => { sfx("popup"); const o = openOverlay(`<div class="lightbox"><img src="${esc(src)}" alt=""></div>`); $("img", o.el).addEventListener("click", () => o.close()); };
  document.addEventListener("click", (e) => { const img = e.target.closest("img[data-zoom]"); if (img) zoom(img.dataset.zoom || img.src); });

  /* ---------- 複製 ---------- */
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); } catch { const ta = Object.assign(document.createElement("textarea"), { value: text }); document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } sfx("copy"); ok(t("copied"), text.length > 60 ? text.slice(0, 60) + "…" : text, 1400); };

  /* ---------- 自訂下拉選單（強化原生 select.enhance） ---------- */
  function enhanceSelects(root = document) {
    $$("select.enhance", root).forEach((sel) => {
      if (sel._enhanced) return sel._sync && sel._sync(); sel._enhanced = true; sel.style.display = "none";
      const wrap = document.createElement("div"); wrap.className = "select"; sel.after(wrap);
      const render = () => {
        const cur = sel.options[sel.selectedIndex];
        wrap.innerHTML = `<button type="button" class="select-btn"><span>${esc(cur ? cur.textContent : "")}</span><span class="chev">▾</span></button><div class="select-list">${[...sel.options].map((o, i) => `<div data-i="${i}" class="${i === sel.selectedIndex ? "selected" : ""}" style="animation:itemIn .25s ${i * 25}ms both">${esc(o.textContent)}</div>`).join("")}</div>`;
      };
      sel._sync = render; render();
      wrap.addEventListener("click", (e) => {
        const item = e.target.closest("[data-i]");
        if (item) { sel.selectedIndex = +item.dataset.i; sel.dispatchEvent(new Event("change", { bubbles: true })); wrap.classList.remove("open"); render(); sfx("switch"); return; }
        if (e.target.closest(".select-btn")) { $$(".select.open").forEach((s) => s !== wrap && s.classList.remove("open")); wrap.classList.toggle("open"); sfx("menu"); }
      });
    });
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".select")) $$(".select.open").forEach((s) => s.classList.remove("open")); });

  /* ---------- 分頁標籤 ---------- */
  function tabs(container, onChange) {
    const btns = $$("button[data-tab]", container);
    let ind = $(".indicator", container); if (!ind) { ind = document.createElement("span"); ind.className = "indicator"; container.prepend(ind); }
    const activate = (btn, silent) => {
      btns.forEach((b) => b.classList.toggle("active", b === btn));
      ind.style.left = btn.offsetLeft + "px"; ind.style.width = btn.offsetWidth + "px";
      $$("[data-panel]").forEach((p) => { const on = p.dataset.panel === btn.dataset.tab; if (on && p.hidden) { p.hidden = false; p.classList.remove("tab-panel"); void p.offsetWidth; p.classList.add("tab-panel"); } else if (!on) p.hidden = true; });
      if (!silent) sfx("switch");
      store.set("tab." + location.pathname, btn.dataset.tab); onChange && onChange(btn.dataset.tab);
    };
    btns.forEach((b) => b.addEventListener("click", () => activate(b)));
    const saved = btns.find((b) => b.dataset.tab === store.get("tab." + location.pathname)) || btns[0];
    requestAnimationFrame(() => activate(saved, true));
    window.addEventListener("resize", () => { const a = btns.find((b) => b.classList.contains("active")); if (a) { ind.style.left = a.offsetLeft + "px"; ind.style.width = a.offsetWidth + "px"; } });
  }

  /* ---------- 彩帶 ---------- */
  function confetti(n = 80) {
    if (document.documentElement.dataset.motion === "reduce") return;
    const colors = ["#fff1b8", "#f5c542", "#e08a1e", "#ffffff", "#ff5c7a", "#35d07f"];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("i"); c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw"; c.style.background = colors[i % colors.length];
      c.style.setProperty("--dx", (Math.random() - 0.5) * 200 + "px"); c.style.setProperty("--rot", Math.random() * 900 + "deg");
      c.style.animationDuration = 1.8 + Math.random() * 1.8 + "s"; c.style.animationDelay = Math.random() * 0.4 + "s";
      document.body.appendChild(c); setTimeout(() => c.remove(), 4200);
    }
  }

  /* ---------- 導覽列 / 頁尾 ---------- */
  let me = null;
  const mePromise = api("/api/me", { quiet: true }).then((d) => (me = d.user)).catch(() => null);
  function renderNav() {
    const nav = $("#nav"); if (!nav) return;
    const path = location.pathname;
    const link = (href, key) => `<a href="${href}" class="${path === href ? "active" : ""}" data-i18n="${key}"></a>`;
    nav.className = "nav";
    nav.innerHTML = `<div class="container">
      <a href="/" class="brand"><span class="brand-logo">TR</span><span class="brand-name">Threads <span class="gold-text">Rewards</span></span></a>
      <nav class="nav-links">${link("/", "nav.home")}${link("/links", "nav.links")}${me && me.admin ? link("/admin", "nav.admin") : ""}${link("/settings", "nav.settings")}</nav>
      <div class="nav-right">
        <button class="search-trigger" data-search>🔍 <span class="txt" data-i18n="nav.search"></span><span class="kbd">Ctrl K</span></button>
        ${me ? `<button class="user-chip" data-user-menu data-user='${esc(JSON.stringify({ id: me.id, name: me.name }))}'><span class="avatar-wrap"><img src="${esc(me.avatar)}" alt=""><span class="online-dot"></span></span><span class="nm">${esc(me.name)}</span></button>`
            : `<a class="btn sm btn-discord" href="/login" data-i18n="nav.login"></a>`}
        <button class="btn icon ghost menu-btn" aria-label="menu">☰</button>
      </div></div>`;
    $(".menu-btn", nav).addEventListener("click", () => { nav.classList.toggle("open"); sfx("menu"); });
    $("[data-search]", nav).addEventListener("click", openPalette);
    const um = $("[data-user-menu]", nav);
    if (um) um.addEventListener("click", (e) => {
      const r = um.getBoundingClientRect();
      showCtx(r.right - 210, r.bottom + 8, [
        { head: me.name },
        { icon: "👤", label: t("nav.links"), act: () => go("/links") },
        ...(me.admin ? [{ icon: "🛡️", label: t("nav.admin"), act: () => go("/admin") }] : []),
        { icon: "⚙️", label: t("nav.settings"), act: () => go("/settings") },
        { sep: true },
        { icon: "⎋", label: t("nav.logout"), danger: true, act: async () => { await api("/auth/logout", { method: "POST" }); go("/"); } },
      ]);
      e.stopPropagation();
    });
    applyI18n(nav);
  }
  function renderBanner(text) {
    if (!text || store.get("banner.hidden") === text || $(".banner")) return;
    const b = document.createElement("div"); b.className = "banner";
    b.innerHTML = `<div class="container"><span class="tag gold live">NEWS</span><span>${esc(text)}</span><button class="btn icon ghost sm x" aria-label="close">✕</button></div>`;
    $("#nav").after(b);
    $(".x", b).addEventListener("click", () => { store.set("banner.hidden", text); b.style.animation = "bannerIn .3s reverse forwards"; setTimeout(() => b.remove(), 300); sfx("close"); });
  }
  function renderFooter() {
    const f = $("#footer"); if (!f) return;
    f.innerHTML = `<div class="container"><span data-i18n="footer"></span><span class="mono">© ${new Date().getFullYear()}</span></div>`;
    applyI18n(f);
  }

  /* ---------- 頁面切換 ---------- */
  function go(href) {
    if (document.documentElement.dataset.motion === "reduce") { location.href = href; return; }
    sfx("switch"); document.body.classList.add("leaving"); progress.start();
    setTimeout(() => (location.href = href), 220);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/auth") || (url.pathname === location.pathname && url.hash)) return;
    e.preventDefault(); go(url.pathname + url.search + url.hash);
  });
  window.addEventListener("pageshow", () => document.body.classList.remove("leaving"));

  /* ---------- 自訂右鍵選單 ---------- */
  let ctxEl = null;
  const hideCtx = () => { if (ctxEl) { ctxEl.remove(); ctxEl = null; } };
  function showCtx(x, y, items) {
    hideCtx(); sfx("menu");
    ctxEl = document.createElement("div"); ctxEl.className = "ctx";
    let n = 0;
    ctxEl.innerHTML = items.map((it, i) => it.sep ? `<div class="sep"></div>` : it.head ? `<div class="head">${esc(it.head)}</div>` :
      `<div class="item ${it.danger ? "danger" : ""}" data-i="${i}" style="animation-delay:${n++ * 30}ms"><span>${it.icon || ""}</span><span>${esc(it.label)}</span>${it.key ? `<span class="k">${it.key}</span>` : ""}</div>`).join("");
    document.body.appendChild(ctxEl);
    const r = ctxEl.getBoundingClientRect();
    ctxEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    ctxEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
    ctxEl.addEventListener("click", (e) => { const it = e.target.closest("[data-i]"); if (it) { hideCtx(); items[+it.dataset.i].act(); } });
  }
  const ctxProviders = [];
  document.addEventListener("contextmenu", (e) => {
    if (e.shiftKey) return; // Shift + 右鍵保留瀏覽器原生選單
    const target = e.target; const items = [];
    const input = target.closest("input:not([type=range]):not([type=checkbox]), textarea");
    const a = target.closest("a[href]"); const img = target.closest("img"); const user = target.closest("[data-user]");
    for (const p of ctxProviders) { const extra = p(target); if (extra && extra.length) items.push(...extra, { sep: true }); }
    if (input) {
      const sel = input.value.substring(input.selectionStart, input.selectionEnd);
      items.push(
        { icon: "📋", label: t("ctx.copy"), key: "Ctrl C", act: () => copy(sel || input.value) },
        { icon: "✂️", label: t("ctx.cut"), key: "Ctrl X", act: () => { copy(sel || input.value); input.setRangeText("", input.selectionStart, input.selectionEnd); if (!sel) input.value = ""; input.dispatchEvent(new Event("input")); } },
        { icon: "📥", label: t("ctx.paste"), key: "Ctrl V", act: async () => { try { const txt = await navigator.clipboard.readText(); input.focus(); input.setRangeText(txt, input.selectionStart, input.selectionEnd, "end"); input.dispatchEvent(new Event("input")); } catch { fail("Clipboard"); } } },
        { icon: "🔠", label: t("ctx.selectAll"), key: "Ctrl A", act: () => { input.focus(); input.select(); } },
        { sep: true }, { icon: "🧹", label: t("ctx.clear"), danger: true, act: () => { input.value = ""; input.dispatchEvent(new Event("input")); input.focus(); } },
      );
    } else if (user) {
      const u = JSON.parse(user.dataset.user);
      items.push({ head: u.name }, { icon: "📋", label: t("ctx.copyName"), act: () => copy(u.name) }, { icon: "🆔", label: t("ctx.copyId"), act: () => copy(u.id) });
      if (img) items.push({ icon: "🔍", label: t("ctx.viewImage"), act: () => zoom(img.src) });
    } else if (img) {
      items.push({ icon: "🔍", label: t("ctx.viewImage"), act: () => zoom(img.dataset.zoom || img.src) }, { icon: "🔗", label: t("ctx.copyImage"), act: () => copy(img.src) });
    } else if (a) {
      items.push({ icon: "↗", label: t("ctx.openLink"), act: () => window.open(a.href, "_blank", "noopener") }, { icon: "🔗", label: t("ctx.copyLink"), act: () => copy(a.href) });
    }
    if (!input && !user && !img && !a) {
      const sel = String(getSelection());
      if (sel) items.push({ icon: "📋", label: t("ctx.copy"), act: () => copy(sel) }, { sep: true });
      items.push(
        { icon: "←", label: t("ctx.back"), act: () => history.back() },
        { icon: "⟳", label: t("ctx.reload"), key: "F5", act: () => location.reload() },
        { icon: "🔍", label: t("ctx.search"), key: "Ctrl K", act: openPalette },
        { icon: "⇡", label: t("ctx.top"), act: () => scrollTo({ top: 0, behavior: "smooth" }) },
      );
    }
    while (items.length && items[items.length - 1].sep) items.pop();
    e.preventDefault(); showCtx(e.clientX, e.clientY, items);
  });
  ["click", "scroll", "resize", "blur"].forEach((ev) => window.addEventListener(ev, hideCtx, true));

  /* ---------- Ctrl+K 搜尋面板 ---------- */
  let paletteOpen = false;
  function openPalette() {
    if (paletteOpen) return; paletteOpen = true; sfx("popup");
    const pages = [["/", "nav.home", "🏠"], ["/links", "nav.links", "🔗"], ["/settings", "nav.settings", "⚙️"], ["/login", "nav.login", "🔑"]];
    if (me && me.admin) pages.splice(2, 0, ["/admin", "nav.admin", "🛡️"]);
    const o = openOverlay(`<div class="modal palette"><input class="input" data-i18n-ph="nav.search" autocomplete="off"><div class="palette-results"></div></div>`, { onClose: () => (paletteOpen = false) });
    const input = $("input", o.el); const res = $(".palette-results", o.el);
    let results = []; let sel = 0; let timer;
    const draw = (users = [], links = [], q = "") => {
      const ql = q.toLowerCase();
      const pg = pages.filter(([, k]) => !ql || t(k).toLowerCase().includes(ql));
      results = [...pg.map(([h, k, ic]) => ({ go: h, html: `<span>${ic}</span><span>${esc(t(k))}</span><small>${h}</small>`, grp: "pages" })),
        ...users.map((u) => ({ copy: u.name, html: `<img src="${esc(u.avatar)}" alt=""><span>${esc(u.name)}</span><small>@${esc(u.username)}</small>`, grp: "users" })),
        ...links.map((l) => ({ open: l.url, html: `${px("heart", 14)}<span>@${esc(l.author)}</span><small>${esc(l.content || l.url)}</small>`, grp: "links" }))];
      sel = Math.min(sel, Math.max(0, results.length - 1));
      let last = ""; let html = "";
      results.forEach((r, i) => { if (r.grp !== last) { html += `<div class="grp">${t("search." + r.grp)}</div>`; last = r.grp; } html += `<div class="res ${i === sel ? "sel" : ""}" data-i="${i}" style="animation-delay:${i * 20}ms">${r.html}</div>`; });
      res.innerHTML = html || `<div class="empty">${t("noResult")}</div>`;
    };
    const pick = (r) => { if (!r) return; o.close(true); if (r.go) go(r.go); else if (r.open) window.open(r.open, "_blank", "noopener"); else if (r.copy) copy(r.copy); };
    input.addEventListener("input", () => { clearTimeout(timer); const q = input.value.trim(); draw([], [], q); if (q) timer = setTimeout(async () => { try { const d = await api("/api/search?q=" + encodeURIComponent(q), { quiet: true }); if (input.value.trim() === q) draw(d.users, d.links, q); } catch { /* 忽略 */ } }, 220); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length); $$(".res", res).forEach((el, i) => el.classList.toggle("sel", i === sel)); $(".res.sel", res)?.scrollIntoView({ block: "nearest" }); sfx("tick"); }
      if (e.key === "Enter") { e.preventDefault(); pick(results[sel]); }
    });
    res.addEventListener("click", (e) => { const el = e.target.closest("[data-i]"); if (el) pick(results[+el.dataset.i]); });
    draw(); setTimeout(() => input.focus(), 30);
  }

  /* ---------- 快捷鍵 ---------- */
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const form = document.activeElement && document.activeElement.closest("form");
      if (form) { e.preventDefault(); form.requestSubmit(); }
    } else if (e.key === "Escape") { hideCtx(); if (overlays.length) overlays[overlays.length - 1](); }
  });

  /* ---------- 減少動畫 ---------- */
  if (store.get("motion", false)) document.documentElement.dataset.motion = "reduce";

  /* ---------- 初始化 ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
    renderNav(); renderFooter(); observe();
    await mePromise; renderNav();
    document.dispatchEvent(new CustomEvent("app:ready", { detail: { me } }));
  });
  document.addEventListener("langchange", () => { renderNav(); renderFooter(); });

  window.App = {
    $, $$, esc, t, applyI18n, setLang, get lang() { return lang; }, store, sound, sfx, api, progress,
    fmt, compact, ago, date, px, metricsHTML, countUp, observe, toast, ok, fail, modal, confirm: confirmBox,
    zoom, copy, tabs, confetti, go, showCtx, ctxProviders, openPalette, renderBanner, get me() { return me; }, mePromise,
  };
})();
