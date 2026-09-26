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
    $$("[data-i18n]", root).forEach((el) => { const v = t(el.dataset.i18n); if (el.dataset.i18nV !== v) { el.textContent = v; el.dataset.i18nV = v; delete el.dataset.splitDone; } });
    $$("[data-i18n-ph]", root).forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $$("[data-i18n-html]", root).forEach((el) => { const v = t(el.dataset.i18nHtml); if (el.dataset.i18nV !== v) { el.innerHTML = v; el.dataset.i18nV = v; delete el.dataset.splitDone; el.classList.remove("fx-split-in"); } });
    $$("[data-i18n-title]", root).forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.documentElement.lang = { zh: "zh-Hant", en: "en" }[lang];
  };
  const setLang = (l) => { lang = l; store.set("lang", l); applyI18n(); document.dispatchEvent(new CustomEvent("langchange")); };

  /* ---------- 音效引擎（Web Audio 即時合成，不使用音效檔） ----------
     聲音 → 分類音軌（介面 / 通知 / 環境）→ 主音量 → 壓縮器 → 喇叭，另有一路共用殘響。 */
  let actx = null; let bus = {}; let master; let reverb; let noiseBuf; let lastSfx = 0;
  const SND_CATS = ["ui", "notify", "ambient"];
  const CAT_DEF = { ui: [true, 0.7], notify: [true, 0.85], ambient: [false, 0.45] };
  const sound = {
    get enabled() { return store.get("sound", true); },
    set enabled(v) { store.set("sound", v); applyGains(); ambient.sync(); },
    get volume() { return store.get("volume", 0.5); },
    set volume(v) { store.set("volume", v); applyGains(); },
    on: (c) => store.get("snd." + c, CAT_DEF[c][0]),
    vol: (c) => store.get("sndv." + c, CAT_DEF[c][1]),
    set(c, { on, vol } = {}) {
      if (on != null) store.set("snd." + c, on);
      if (vol != null) store.set("sndv." + c, vol);
      applyGains(); if (c === "ambient") ambient.sync();
      document.dispatchEvent(new CustomEvent("soundchange"));
    },
    get playing() { return ambient.playing; },
  };
  const catGain = (c) => (sound.enabled && sound.on(c) ? sound.vol(c) : 0);
  function applyGains() {
    if (!actx) return; const now = actx.currentTime;
    master.gain.setTargetAtTime(sound.volume, now, 0.05);
    SND_CATS.forEach((c) => bus[c].gain.setTargetAtTime(catGain(c), now, c === "ambient" ? 0.8 : 0.03));
  }
  function impulse(sec = 2.4, decay = 3.2) {
    const len = Math.floor(actx.sampleRate * sec); const ir = actx.createBuffer(2, len, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return ir;
  }
  function ensureAudio() {
    if (actx) return actx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    actx = new AC();
    const comp = actx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    master = actx.createGain(); master.connect(comp).connect(actx.destination);
    reverb = actx.createConvolver(); reverb.buffer = impulse();
    const wet = actx.createGain(); wet.gain.value = 0.9; reverb.connect(wet).connect(master);
    SND_CATS.forEach((c) => { bus[c] = actx.createGain(); bus[c].gain.value = 0; bus[c].connect(master); });
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    applyGains();
    return actx;
  }
  /** 一個音：可疊兩個微走音的振盪器、低通濾波、平移、殘響。 */
  function voice({ f = 440, f2 = null, d = 0.12, type = "sine", v = 1, at = 0, attack = 0.004, cut = 7000, cut2 = null, q = 0.4, det = 0, rev = 0.12, pan = 0, cat = "ui" }) {
    const now = actx.currentTime + at;
    const env = actx.createGain(); const flt = actx.createBiquadFilter();
    flt.type = "lowpass"; flt.Q.value = q; flt.frequency.setValueAtTime(cut, now);
    if (cut2) flt.frequency.exponentialRampToValueAtTime(cut2, now + d);
    const peak = 0.3 * v;
    env.gain.setValueAtTime(0, now); env.gain.linearRampToValueAtTime(peak, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + d);
    const oscs = det ? [-det, det] : [0];
    oscs.forEach((c) => {
      const o = actx.createOscillator(); o.type = type; o.detune.value = c;
      o.frequency.setValueAtTime(f, now); if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + d * 0.9);
      const g = actx.createGain(); g.gain.value = 1 / oscs.length;
      o.connect(g).connect(flt); o.start(now); o.stop(now + d + 0.05);
    });
    let node = flt.connect(env);
    if (pan && actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = pan; node = env.connect(p); }
    route(node, cat, rev);
  }
  function route(node, cat, rev) {
    node.connect(bus[cat]);
    if (rev > 0) { const r = actx.createGain(); r.gain.value = rev; node.connect(r); r.connect(reverb); }
  }
  /** 鐘聲：基頻 + 非整數泛音，清脆但柔和。 */
  function bell(f, { at = 0, d = 0.5, v = 0.5, rev = 0.3, cat = "ui", pan = 0 } = {}) {
    voice({ f, d, v, at, attack: 0.003, rev, cat, pan });
    voice({ f: f * 2.005, d: d * 0.45, v: v * 0.28, at, attack: 0.002, rev, cat, pan });
    voice({ f: f * 3.01, d: d * 0.2, v: v * 0.1, at, attack: 0.002, rev, cat, pan });
  }
  function noise({ d = 0.15, v = 1, at = 0, from = 3000, to = 300, type = "bandpass", q = 0.8, rev = 0.1, cat = "ui" }) {
    const now = actx.currentTime + at;
    const src = actx.createBufferSource(); src.buffer = noiseBuf;
    const flt = actx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(from, now); flt.frequency.exponentialRampToValueAtTime(to, now + d);
    const g = actx.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.22 * v, now + Math.min(0.03, d / 3)); g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    src.connect(flt).connect(g); route(g, cat, rev);
    src.start(now, Math.random() * 0.5, d + 0.05);
  }
  // A 大調五聲音階（配合水淺蔥的清爽感）
  const NOTE = (n) => 440 * Math.pow(2, n / 12);
  const PENTA = [0, 2, 4, 7, 9];
  const pent = (i) => NOTE(PENTA[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5));
  let hoverStep = 0;
  const SFX = {
    // 介面
    hover: () => { hoverStep = (hoverStep + 1 + (Math.random() * 2 | 0)) % 6; voice({ f: pent(10 + hoverStep), d: 0.05, v: 0.07, cut: 3500, rev: 0.05, pan: (Math.random() - 0.5) * 0.4 }); },
    click: () => { voice({ f: 1150, f2: 720, d: 0.05, type: "sine", v: 0.45, cut: 4000, rev: 0.04 }); noise({ d: 0.018, v: 0.35, from: 5200, to: 3000, rev: 0 }); },
    tick: () => voice({ f: 2600, d: 0.014, v: 0.12, cut: 6000, rev: 0 }),
    focus: () => voice({ f: pent(12), f2: pent(13), d: 0.07, v: 0.12, type: "triangle", cut: 3000, rev: 0.08 }),
    switch: () => { bell(pent(9), { d: 0.18, v: 0.3, rev: 0.12 }); bell(pent(11), { d: 0.25, v: 0.3, at: 0.05, rev: 0.15 }); },
    toggleOn: () => { voice({ f: pent(7), d: 0.08, v: 0.35, type: "triangle", cut: 3200 }); voice({ f: pent(10), d: 0.14, v: 0.35, type: "triangle", cut: 3600, at: 0.06, rev: 0.12 }); },
    toggleOff: () => { voice({ f: pent(10), d: 0.08, v: 0.3, type: "triangle", cut: 3000 }); voice({ f: pent(6), d: 0.14, v: 0.3, type: "triangle", cut: 2400, at: 0.06, rev: 0.1 }); },
    menu: () => { voice({ f: pent(8), f2: pent(10), d: 0.09, v: 0.3, type: "triangle", cut: 3000, rev: 0.12 }); noise({ d: 0.08, v: 0.25, from: 1500, to: 4000, rev: 0.05 }); },
    popup: () => { noise({ d: 0.2, v: 0.4, from: 500, to: 3500, rev: 0.15 }); bell(pent(10), { at: 0.06, d: 0.4, v: 0.28, rev: 0.25 }); },
    close: () => { noise({ d: 0.16, v: 0.35, from: 3000, to: 500, rev: 0.08 }); voice({ f: pent(8), f2: pent(4), d: 0.14, v: 0.22, cut: 2000 }); },
    copy: () => { bell(pent(13), { d: 0.2, v: 0.28 }); bell(pent(15), { d: 0.35, v: 0.28, at: 0.06 }); },
    delete: () => { voice({ f: 190, f2: 60, d: 0.22, v: 0.7, cut: 900 }); noise({ d: 0.22, v: 0.5, from: 2400, to: 180, rev: 0.1 }); },
    slide: (x = 0.5) => voice({ f: pent(5 + Math.round(x * 10)), d: 0.04, v: 0.1, type: "triangle", cut: 3000, rev: 0.03 }),
    count: () => voice({ f: pent(14 + (Math.random() * 3 | 0)), d: 0.02, v: 0.05, cut: 5000, rev: 0 }),
    countDone: () => bell(pent(12), { d: 0.5, v: 0.14, rev: 0.35 }),
    reveal: () => bell(pent(7 + (Math.random() * 8 | 0)), { d: 0.45, v: 0.06, rev: 0.5, pan: (Math.random() - 0.5) * 0.8 }),
    leave: () => noise({ d: 0.25, v: 0.3, from: 2800, to: 400, rev: 0.12 }),
    // 通知
    success: () => [5, 7, 9, 10].forEach((n, i) => bell(pent(n), { at: i * 0.07, d: 0.6, v: 0.32, rev: 0.35, cat: "notify" })),
    error: () => { voice({ f: 233, d: 0.28, v: 0.45, type: "triangle", det: 12, cut: 900, cat: "notify", rev: 0.1 }); voice({ f: 196, d: 0.34, v: 0.45, type: "triangle", det: 12, cut: 800, at: 0.12, cat: "notify", rev: 0.12 }); },
    send: () => { noise({ d: 0.26, v: 0.5, from: 700, to: 5000, rev: 0.15, cat: "notify" }); bell(pent(12), { at: 0.12, d: 0.45, v: 0.25, cat: "notify" }); },
    receive: () => { bell(pent(12), { d: 0.5, v: 0.4, rev: 0.3, cat: "notify" }); bell(pent(15), { at: 0.13, d: 0.8, v: 0.4, rev: 0.35, cat: "notify" }); },
    launch: () => { [0, 2, 4, 5, 7, 9, 10].forEach((n, i) => bell(pent(n + 3), { at: i * 0.055, d: 0.7, v: 0.3, rev: 0.4, cat: "notify" })); noise({ d: 0.8, v: 0.35, from: 400, to: 7000, at: 0.2, rev: 0.3, cat: "notify" }); },
  };
  const THROTTLE = { hover: 55, tick: 25, count: 45, reveal: 110, slide: 30, focus: 80 };
  const lastBy = {};
  const sfx = (name, arg) => {
    if (!sound.enabled || !SFX[name]) return;
    const reduce = document.documentElement.dataset.motion === "reduce";
    if (reduce && (name === "hover" || name === "reveal" || name === "count")) return;
    const cat = /^(success|error|send|receive|launch)$/.test(name) ? "notify" : "ui";
    if (!sound.on(cat)) return;
    const now = performance.now();
    if (THROTTLE[name] && now - (lastBy[name] || 0) < THROTTLE[name]) return;
    lastBy[name] = now;
    try {
      if (!ensureAudio()) return;
      if (actx.state === "suspended") { actx.resume(); if (name === "hover" || name === "reveal" || name === "count") return; }
      if (name !== "hover" && name !== "count" && name !== "reveal") lastSfx = now;
      SFX[name](arg);
    } catch { /* 瀏覽器不支援 */ }
  };

  /* ---------- 背景環境音：緩慢流動的和弦墊音 + 隨機的清脆音點 ---------- */
  const ambient = (() => {
    // Amaj9 → F#m9 → Dmaj9 → E6/9（以半音相對 A4 表示）
    const CHORDS = [[-24, -17, -13, -10, -5], [-27, -20, -15, -10, -8], [-31, -24, -20, -15, -10], [-29, -22, -17, -12, -10]];
    let playing = false; let timers = []; let step = 0; let pad; let lfo;
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    function chord() {
      if (!playing) return;
      const now = actx.currentTime; const len = 9;
      CHORDS[step++ % CHORDS.length].forEach((n, i) => {
        ["sawtooth", "triangle"].forEach((type, k) => {
          const o = actx.createOscillator(); o.type = type; o.frequency.value = NOTE(n); o.detune.value = (k ? 7 : -7) + (Math.random() - 0.5) * 4;
          const g = actx.createGain(); const vol = (type === "sawtooth" ? 0.022 : 0.05) / (1 + i * 0.15);
          g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(vol, now + 3); g.gain.setValueAtTime(vol, now + len - 1); g.gain.linearRampToValueAtTime(0, now + len + 3);
          o.connect(g).connect(pad); o.start(now); o.stop(now + len + 3.2);
        });
      });
      later(chord, (len - 0.5) * 1000);
    }
    function sparkle() {
      if (!playing) return;
      if (!document.hidden) bell(pent(8 + (Math.random() * 9 | 0)), { d: 1.6, v: 0.05 + Math.random() * 0.05, rev: 0.8, cat: "ambient", pan: (Math.random() - 0.5) * 1.2 });
      later(sparkle, 1800 + Math.random() * 4200);
    }
    function start() {
      if (playing || !ensureAudio()) return;
      if (actx.state === "suspended") { actx.resume(); if (actx.state === "suspended") return; }
      playing = true;
      pad = actx.createBiquadFilter(); pad.type = "lowpass"; pad.frequency.value = 900; pad.Q.value = 0.7;
      lfo = actx.createOscillator(); lfo.frequency.value = 0.06; const depth = actx.createGain(); depth.gain.value = 420;
      lfo.connect(depth).connect(pad.frequency); lfo.start();
      route(pad, "ambient", 0.6);
      chord(); later(sparkle, 2500);
      document.dispatchEvent(new CustomEvent("soundchange"));
    }
    function stop() {
      if (!playing) return; playing = false;
      timers.forEach(clearTimeout); timers = [];
      const p = pad, l = lfo; setTimeout(() => { try { l.stop(); p.disconnect(); } catch {} }, 4000);
      document.dispatchEvent(new CustomEvent("soundchange"));
    }
    return {
      get playing() { return playing; },
      sync() { if (sound.enabled && sound.on("ambient") && !document.hidden) start(); else stop(); },
    };
  })();
  // 瀏覽器要求使用者先互動才能出聲：第一次點擊 / 按鍵時解鎖並啟動環境音
  const unlock = () => { if (!sound.enabled) return; try { ensureAudio(); actx.state === "suspended" && actx.resume().then(() => ambient.sync()); ambient.sync(); } catch {} };
  ["pointerdown", "keydown"].forEach((ev) => addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (actx) ambient.sync(); });

  /* ---------- 全站互動音效 ---------- */
  const HOVER_SEL = "a[href], button:not(:disabled), .rank-row, .card.hover, .stat-tile, .tk-item, .rival, .res, [data-sfx-hover]";
  let hovered = null;
  if (matchMedia("(hover: hover)").matches) {
    document.addEventListener("pointerover", (e) => {
      const el = e.target.closest?.(HOVER_SEL); if (el === hovered) return; hovered = el;
      if (el && actx && actx.state === "running") sfx("hover");
    });
  }
  // 沒有自己音效的按鈕 / 連結，點擊時補上 click
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("a[href], button, [role=button], summary, label.switch"); if (!el) return;
    const t0 = performance.now(); setTimeout(() => { if (lastSfx < t0) sfx("click"); }, 0);
  }, true);
  document.addEventListener("focusin", (e) => { if (e.target.matches?.("input:not([type=checkbox]):not([type=range]), textarea")) sfx("focus"); });
  document.addEventListener("input", (e) => { const r = e.target; if (r.type === "range") sfx("slide", (r.value - r.min) / ((r.max - r.min) || 1)); });
  document.addEventListener("change", (e) => { const c = e.target; if (c.type === "checkbox" && c.id !== "sound" && c.id !== "motion" && !c.dataset.sndCat) sfx(c.checked ? "toggleOn" : "toggleOff"); });

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
  const PX_COLOR = { heart: "var(--c-likes)", reply: "var(--c-replies)", repost: "var(--c-reposts)", eye: "var(--c-views)", trophy: "gold", crown: "gold", star: "var(--accent)", user: "var(--text-2)", chart: "var(--text)" };
    function px(name, size = 16, color) {
    const grid = PX[name]; if (!grid) return "";
    color = color || PX_COLOR[name] || "currentColor";
    let defs = ""; let fill = color;
    if (color === "gold") fill = "#b08a2e";
    let rects = "";
    grid.forEach((row, y) => {
      let x = 0;
      while (x < 16) {
        const c = row[x]; if (c === ".") { x++; continue; }
        let w = 1; while (row[x + w] === c) w++;
        rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${c === "+" ? "rgba(255,255,255,.9)" : fill}"/>`;
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
      if (p < 1) { if (p < 0.7) sfx("count"); requestAnimationFrame(step); }
      else { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); sfx("countDone"); }
    };
    requestAnimationFrame(step);
  }
  const countAll = (root = document) => $$("[data-count]", root).forEach((el) => {
    if (el.dataset.counted) return; el.dataset.counted = 1;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); countUp(el, el.dataset.count, { decimals: +(el.dataset.decimals || 0), compactFmt: el.dataset.compact === "1" }); } });
    io.observe(el);
  });

  /* ---------- 捲動浮現 ---------- */
  const revealIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealIO.unobserve(e.target); if (scrollY > 40) sfx("reveal"); } }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  const observe = (root = document) => {
    $$(".reveal, .reveal-l, .reveal-s", root).forEach((el, i) => { if (!el.classList.contains("in")) { el.style.transitionDelay = (el.dataset.delay || (i % 6) * 60) + "ms"; revealIO.observe(el); } });
    countAll(root); enhanceSelects(root); applyI18n(root);
    if (window.ART) $$("[data-ico]", root).forEach((el) => { if (!el.dataset.icoDone) { el.innerHTML = ART.icon(el.dataset.ico, +(el.dataset.size || 16)); el.dataset.icoDone = 1; el.style.display = "inline-flex"; } });
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

  /* ---------- 自訂下拉選單（強化原生 select.enhance；清單浮在最上層，不會被卡片裁切） ---------- */
  let openSelect = null;
  function closeSelect() {
    if (!openSelect) return;
    const { wrap, list } = openSelect; openSelect = null;
    wrap.classList.remove("open"); list.classList.add("closing"); setTimeout(() => list.remove(), 160);
  }
  function openSelectList(sel, wrap) {
    closeSelect();
    const list = document.createElement("div"); list.className = "select-list floating"; list.setAttribute("role", "listbox");
    list.innerHTML = [...sel.options].map((o, i) => `<div data-i="${i}" role="option" class="${i === sel.selectedIndex ? "selected" : ""} ${o.disabled ? "disabled" : ""}" style="animation:itemIn .22s ${Math.min(i, 12) * 18}ms both">${esc(o.textContent)}</div>`).join("");
    document.body.appendChild(list);
    const place = () => {
      const r = wrap.getBoundingClientRect(); const h = Math.min(list.scrollHeight, 280);
      const below = innerHeight - r.bottom - 8; const up = below < h && r.top > below;
      list.style.left = Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 160) - 8)) + "px";
      list.style.minWidth = r.width + "px";
      list.style.top = (up ? r.top - h - 6 : r.bottom + 6) + "px";
      list.style.transformOrigin = up ? "bottom" : "top";
    };
    place();
    let active = sel.selectedIndex;
    const mark = () => $$("[data-i]", list).forEach((el) => el.classList.toggle("active", +el.dataset.i === active));
    const pick = (i) => {
      if (sel.options[i]?.disabled) return;
      sel.selectedIndex = i; sel.dispatchEvent(new Event("change", { bubbles: true })); sel._sync && sel._sync(); closeSelect(); sfx("switch");
    };
    list.addEventListener("mousedown", (e) => e.preventDefault());
    list.addEventListener("click", (e) => { const it = e.target.closest("[data-i]"); if (it) pick(+it.dataset.i); });
    const onKey = (e) => {
      if (!openSelect || openSelect.list !== list) return document.removeEventListener("keydown", onKey, true);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); active = (active + (e.key === "ArrowDown" ? 1 : -1) + sel.options.length) % sel.options.length; mark(); $(".active", list)?.scrollIntoView({ block: "nearest" }); sfx("tick"); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); pick(active); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSelect(); }
    };
    document.addEventListener("keydown", onKey, true);
    wrap.classList.add("open"); openSelect = { wrap, list, place }; sfx("menu");
    $(".selected", list)?.scrollIntoView({ block: "nearest" });
  }
  function enhanceSelects(root = document) {
    $$("select.enhance", root).forEach((sel) => {
      if (sel._enhanced) return sel._sync && sel._sync(); sel._enhanced = true; sel.style.display = "none";
      const wrap = document.createElement("div"); wrap.className = "select"; sel.after(wrap);
      const render = () => {
        const cur = sel.options[sel.selectedIndex];
        wrap.innerHTML = `<button type="button" class="select-btn" aria-haspopup="listbox"><span>${esc(cur ? cur.textContent : "")}</span><span class="chev">▾</span></button>`;
      };
      sel._sync = render; render();
      sel.addEventListener("change", render);
      wrap.addEventListener("click", (e) => {
        if (!e.target.closest(".select-btn")) return;
        e.stopPropagation();
        if (openSelect && openSelect.wrap === wrap) closeSelect(); else openSelectList(sel, wrap);
      });
    });
  }
  document.addEventListener("click", (e) => { if (openSelect && !e.target.closest(".select-list.floating")) closeSelect(); });
  addEventListener("resize", () => openSelect && openSelect.place());
  addEventListener("scroll", (e) => { if (openSelect && !(e.target instanceof Element && e.target.closest(".select-list"))) openSelect.place(); }, true);

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
    const colors = ["#161616", "#b4532a", "#b08a2e", "#d4d0c6", "#2e8656", "#8a9098"];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("i"); c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw"; c.style.background = colors[i % colors.length];
      c.style.setProperty("--dx", (Math.random() - 0.5) * 200 + "px"); c.style.setProperty("--rot", Math.random() * 900 + "deg");
      c.style.animationDuration = 1.8 + Math.random() * 1.8 + "s"; c.style.animationDelay = Math.random() * 0.4 + "s";
      document.body.appendChild(c); setTimeout(() => c.remove(), 4200);
    }
  }

  /* ---------- 導覽列 / 頁尾 ---------- */
  const LOGO = `<img src="/static/img/icon-128.png" alt="鋸齒 SMP" width="30" height="30" decoding="async">`;
  const THEME_ICON = `<svg class="sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"/></svg>`;
  let me = null; let ambStateFn = null;
  document.addEventListener("soundchange", () => ambStateFn && ambStateFn());
  let mePromise = api("/api/me", { quiet: true }).then((d) => (me = d.user)).catch(() => null);
  function renderNav() {
    const nav = $("#nav"); if (!nav) return;
    const path = location.pathname;
    const link = (href, key) => `<a href="${href}" class="${path === href ? "active" : ""}" data-i18n="${key}"></a>`;
    nav.className = "nav";
    nav.innerHTML = `<div class="container">
      <a href="/" class="brand"><span class="brand-logo">${LOGO}</span><span class="brand-text"><b>鋸齒</b><small>SAW · SMP</small></span></a>
      <nav class="nav-links">${link("/", "nav.home")}${link("/rankings", "nav.rankings")}${link("/match", "nav.match")}${link("/support", "nav.support")}${link("/rewards", "nav.rewards")}${me && me.level >= 1 ? link("/admin", "nav.admin") : ""}</nav>
      <div class="nav-right">
        <button class="ip-chip" data-copy-ip title="${t("home.copyIp")}">${window.ART ? ART.icon("server", 15) : ""}<span>sawsmp.me</span></button>
        <button class="btn icon ghost amb-btn" data-ambient aria-label="ambient" title="${t("snd.ambient")}"><span class="eq"><i></i><i></i><i></i><i></i></span></button>
        <button class="btn icon ghost theme-btn" data-theme-toggle aria-label="theme">${THEME_ICON}</button>
        <button class="btn sm ghost lang-btn" data-lang>${window.ART ? ART.icon("globe", 15) : ""}<span>${lang === "zh" ? "中" : "EN"}</span></button>
        <button class="search-trigger" data-search>${window.ART ? ART.icon("search", 15) : ""}<span class="txt" data-i18n="nav.search"></span><span class="kbd">Ctrl K</span></button>
        ${me ? `<button class="user-chip" data-user-menu data-user='${esc(JSON.stringify({ id: me.id, name: me.name }))}'><span class="avatar-wrap"><img src="${esc(me.avatar)}" alt=""><span class="online-dot"></span></span><span class="nm">${esc(me.name)}</span></button>`
            : `<a class="btn sm btn-discord" href="/login" data-i18n="nav.login"></a>`}
        <button class="btn icon ghost menu-btn" aria-label="menu">${window.ART ? ART.icon("menu", 18) : "☰"}</button>
      </div></div>`;
    $(".menu-btn", nav).addEventListener("click", () => { nav.classList.toggle("open"); sfx("menu"); });
    $("[data-search]", nav).addEventListener("click", openPalette);
    $("[data-theme-toggle]", nav).addEventListener("click", () => setTheme(theme === "light" ? "dark" : "light"));
    $("[data-copy-ip]", nav).addEventListener("click", () => copy("sawsmp.me"));
    const amb = $("[data-ambient]", nav);
    const ambState = () => { amb.classList.toggle("on", sound.enabled && sound.on("ambient")); amb.classList.toggle("playing", ambient.playing); };
    amb.addEventListener("click", () => {
      const on = !(sound.enabled && sound.on("ambient"));
      if (on && !sound.enabled) sound.enabled = true;
      sound.set("ambient", { on });
      ok(t(on ? "snd.ambOn" : "snd.ambOff"), "", 1200);
    });
    ambStateFn = ambState; ambState();
    $("[data-lang]", nav).addEventListener("click", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showCtx(r.left, r.bottom + 8, [{ icon: lang === "zh" ? "check" : "", label: "中文", act: () => setLang("zh") }, { icon: lang === "en" ? "check" : "", label: "English", act: () => setLang("en") }]);
      e.stopPropagation();
    });
    const um = $("[data-user-menu]", nav);
    if (um) um.addEventListener("click", (e) => {
      const r = um.getBoundingClientRect();
      showCtx(r.right - 210, r.bottom + 8, [
        { head: me.name },
        { icon: "user", label: t("nav.account"), act: () => go("/account") },
        { icon: "message", label: t("nav.support"), act: () => go("/support") },
        { icon: "link", label: t("nav.links"), act: () => go("/links") },
        ...(me.mc ? [{ icon: "pickaxe", label: t("nav.myProfile"), act: () => go("/player?name=" + encodeURIComponent(me.mc.name)) }] : []),
        ...(me.level >= 1 ? [{ icon: "shield", label: t("nav.admin"), act: () => go("/admin") }] : []),
        { icon: "settings", label: t("nav.settings"), act: () => go("/settings") },
        { sep: true },
        { icon: "logout", label: t("nav.logout"), danger: true, act: async () => { await api("/auth/logout", { method: "POST" }); go("/", { hard: true }); } },
      ]);
      e.stopPropagation();
    });
    applyI18n(nav);
  }
  function renderBanner(text) {
    if (!text || store.get("banner.hidden") === text || $(".banner")) return;
    const b = document.createElement("div"); b.className = "banner";
    b.innerHTML = `<div class="container"><span class="tag live">NEWS</span><span>${esc(text)}</span><button class="btn icon ghost sm x" aria-label="close">✕</button></div>`;
    $("#nav").after(b);
    $(".x", b).addEventListener("click", () => { store.set("banner.hidden", text); b.style.animation = "bannerIn .3s reverse forwards"; setTimeout(() => b.remove(), 300); sfx("close"); });
  }
  function renderFooter() {
    const f = $("#footer"); if (!f) return;
    f.innerHTML = `<div class="container">
      <div class="foot-brand"><a href="/" class="brand"><span class="brand-logo">${LOGO}</span><span class="brand-name">${t("brand")}<small>SMP</small></span></a><span>${t("footer.tag")}</span><span class="mono">sawsmp.me</span></div>
      <div class="foot-links">
        <div><b>${t("footer.server")}</b><a href="/news">${t("nav.news")}</a><a href="/rules">${t("nav.rules")}</a><a href="/bans">${t("nav.bans")}</a><a href="/#join">${t("home.join.title")}</a></div>
        <div><b>${t("footer.community")}</b><a href="/support">${t("nav.support")}</a><a href="/rewards">${t("nav.rewards")}</a><a href="/account">${t("nav.account")}</a><a href="/settings">${t("nav.settings")}</a></div>
      </div>
      <div class="copy"><span>© ${new Date().getFullYear()} ${t("brand")} SMP · ${t("footer")}</span><span class="mono">sawsmp.me</span></div></div>`;
    applyI18n(f);
  }

  /* ---------- 頁面切換（站內換頁不重新載入，背景音樂與音效引擎持續運作） ----------
     站內連結改成：抓新頁面 HTML → 換掉 body 內容 → 載入該頁專屬腳本 → 觸發 app:ready。
     各頁腳本在 document / window 上註冊的監聽、計時器與動畫迴圈會記錄下來，換頁時一併清除。 */
  const COMMON = ["i18n", "art", "core", "fx"];
  const KEEP = new Set(["topbar", "scrollbar", "curtain"]);
  let pageScripts = new Set(); let gen = 0; let scoped = []; let navigating = false;
  const scriptName = (src) => (src.match(/\/static\/js\/([\w-]+)\.js/) || [])[1];
  const collectPageScripts = (root) => new Set([...root.querySelectorAll("script[src]")].map((x) => scriptName(x.getAttribute("src"))).filter((n) => n && !COMMON.includes(n)));
  pageScripts = collectPageScripts(document);
  const fromPage = () => {
    if (document.readyState === "loading") pageScripts = collectPageScripts(document); // 首次載入時頁面腳本還在解析中
    const st = new Error().stack || ""; for (const n of pageScripts) if (st.includes(`/static/js/${n}.js`)) return true; return false; };
  // 攔截「頁面腳本」註冊的全域監聽 / 計時器（核心腳本自己的不受影響）
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target); const rm = target.removeEventListener.bind(target);
    target.addEventListener = function (type, fn, opts) { if (fn && fromPage()) scoped.push(() => rm(type, fn, opts)); return add(type, fn, opts); };
  }
  const _si = window.setInterval.bind(window), _st = window.setTimeout.bind(window), _raf = window.requestAnimationFrame.bind(window);
  window.setInterval = function (fn, ms, ...a) { const id = _si(fn, ms, ...a); if (fromPage()) scoped.push(() => clearInterval(id)); return id; };
  window.setTimeout = function (fn, ms, ...a) { if (typeof fn !== "function" || !fromPage()) return _st(fn, ms, ...a); const g = gen; return _st((...x) => g === gen && fn(...x), ms, ...a); };
  window.requestAnimationFrame = function (fn) { if (!fromPage()) return _raf(fn); const g = gen; return _raf((ts) => g === gen && fn(ts)); };
  function teardown() { gen++; scoped.splice(0).forEach((f) => { try { f(); } catch { /* 略過 */ } }); overlays.slice().forEach((c) => c(true)); hideCtx && hideCtx(); closeSelect && closeSelect(); }
  const loadScript = (name) => new Promise((res) => { const el = document.createElement("script"); el.src = `/static/js/${name}.js`; el.onload = el.onerror = res; document.body.appendChild(el); });
  const PAGE_PATHS = ["/", "/news", "/rules", "/rewards", "/links", "/login", "/admin", "/settings", "/support", "/ticket", "/account", "/bans", "/player", "/rankings", "/docs", "/match"];

  async function navigate(href, { push = true, scroll = null } = {}) {
    const url = new URL(href, location.href);
    if (navigating) return; navigating = true;
    const reduceMotion = document.documentElement.dataset.motion === "reduce";
    if (!reduceMotion) { sfx("leave"); document.body.classList.add("leaving"); }
    progress.start();
    try {
      const [res] = await Promise.all([fetch(url.pathname + url.search, { credentials: "same-origin", headers: { "X-Requested-With": "nav" } }),
        new Promise((r) => _st(r, reduceMotion ? 0 : 230))]);
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("text/html")) throw new Error("not html");
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      mePromise = api("/api/me", { quiet: true }).then((d) => (me = d.user)).catch(() => me);
      if (push) { history.replaceState({ ...(history.state || {}), y: scrollY }, ""); history.pushState({ y: 0 }, "", url.pathname + url.search + url.hash); }
      teardown();
      document.title = doc.title; document.body.className = doc.body.className;
      [...document.body.children].forEach((el) => { if (!KEEP.has(el.id)) el.remove(); });
      const frag = document.createDocumentFragment();
      [...doc.body.children].forEach((el) => { if (el.tagName !== "SCRIPT" && !KEEP.has(el.id)) frag.appendChild(document.adoptNode(el)); });
      document.body.insertBefore(frag, document.getElementById("scrollbar") || null);
      if (document.getElementById("topbar")) document.body.prepend(document.getElementById("topbar"));
      pageScripts = collectPageScripts(doc);
      scrollTo({ top: scroll ?? 0, behavior: "instant" });
      applyI18n(); renderNav(); renderFooter(); observe();
      for (const n of pageScripts) await loadScript(n);
      await mePromise; renderNav();
      document.dispatchEvent(new CustomEvent("app:ready", { detail: { me } }));
      if (url.hash) document.querySelector(url.hash)?.scrollIntoView();
    } catch {
      location.href = url.href; return;
    } finally {
      navigating = false; progress.done();
      document.body.classList.remove("leaving"); document.getElementById("curtain")?.classList.remove("on");
    }
  }
  function go(href, { hard = false } = {}) {
    const url = new URL(href, location.href);
    const soft = !hard && url.origin === location.origin && PAGE_PATHS.includes(url.pathname) && window.DOMParser && history.pushState;
    if (soft) return navigate(url.href);
    if (document.documentElement.dataset.motion === "reduce") { location.href = href; return; }
    sfx("leave"); document.body.classList.add("leaving"); progress.start();
    _st(() => (location.href = href), 220);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || a.target === "_blank" || a.hasAttribute("download") || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/auth") || url.pathname.startsWith("/api") || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
    e.preventDefault(); go(url.pathname + url.search + url.hash);
  });
  history.scrollRestoration = "manual";
  window.addEventListener("popstate", (e) => {
    if (PAGE_PATHS.includes(location.pathname)) navigate(location.href, { push: false, scroll: (e.state && e.state.y) || 0 });
    else location.reload();
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
      `<div class="item ${it.danger ? "danger" : ""}" data-i="${i}" style="animation-delay:${n++ * 30}ms"><span class="ic">${/^[a-z]+$/.test(it.icon || "") && window.ART ? ART.icon(it.icon, 16) : esc(it.icon || "")}</span><span>${esc(it.label)}</span>${it.key ? `<span class="k">${it.key}</span>` : ""}</div>`).join("");
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
        { icon: "copy", label: t("ctx.copy"), key: "Ctrl C", act: () => copy(sel || input.value) },
        { icon: "scissors", label: t("ctx.cut"), key: "Ctrl X", act: () => { copy(sel || input.value); input.setRangeText("", input.selectionStart, input.selectionEnd); if (!sel) input.value = ""; input.dispatchEvent(new Event("input")); } },
        { icon: "paste", label: t("ctx.paste"), key: "Ctrl V", act: async () => { try { const txt = await navigator.clipboard.readText(); input.focus(); input.setRangeText(txt, input.selectionStart, input.selectionEnd, "end"); input.dispatchEvent(new Event("input")); } catch { fail("Clipboard"); } } },
        { icon: "selectall", label: t("ctx.selectAll"), key: "Ctrl A", act: () => { input.focus(); input.select(); } },
        { sep: true }, { icon: "eraser", label: t("ctx.clear"), danger: true, act: () => { input.value = ""; input.dispatchEvent(new Event("input")); input.focus(); } },
      );
    } else if (user) {
      const u = JSON.parse(user.dataset.user);
      items.push({ head: u.name }, { icon: "copy", label: t("ctx.copyName"), act: () => copy(u.name) }, { icon: "idcard", label: t("ctx.copyId"), act: () => copy(u.id) });
      if (img) items.push({ icon: "image", label: t("ctx.viewImage"), act: () => zoom(img.src) });
    } else if (img) {
      items.push({ icon: "image", label: t("ctx.viewImage"), act: () => zoom(img.dataset.zoom || img.src) }, { icon: "link", label: t("ctx.copyImage"), act: () => copy(img.src) });
    } else if (a) {
      items.push({ icon: "external", label: t("ctx.openLink"), act: () => window.open(a.href, "_blank", "noopener") }, { icon: "link", label: t("ctx.copyLink"), act: () => copy(a.href) });
    }
    if (!input && !user && !img && !a) {
      const sel = String(getSelection());
      if (sel) items.push({ icon: "copy", label: t("ctx.copy"), act: () => copy(sel) }, { sep: true });
      items.push(
        { icon: "back", label: t("ctx.back"), act: () => history.back() },
        { icon: "⟳", label: t("ctx.reload"), key: "F5", act: () => location.reload() },
        { icon: "search", label: t("ctx.search"), key: "Ctrl K", act: openPalette },
        { icon: "up", label: t("ctx.top"), act: () => scrollTo({ top: 0, behavior: "smooth" }) },
      );
    }
    while (items.length && items[items.length - 1].sep) items.pop();
    e.preventDefault(); showCtx(e.clientX, e.clientY, items);
  });
  window.addEventListener("click", (e) => { if (!(ctxEl && ctxEl.contains(e.target))) hideCtx(); }, true);
  window.addEventListener("resize", hideCtx);
  window.addEventListener("scroll", (e) => { if (!(ctxEl && e.target instanceof Node && ctxEl.contains(e.target))) hideCtx(); }, true);
  window.addEventListener("blur", (e) => { if (e.target === window) hideCtx(); });

  /* ---------- Ctrl+K 搜尋面板 ---------- */
  let paletteOpen = false;
  function openPalette() {
    if (paletteOpen) return; paletteOpen = true; sfx("popup");
    const pages = [["/", "nav.home", "home"], ["/rankings", "nav.rankings", "trophy"], ["/match", "nav.match", "sword"], ["/news", "nav.news", "news"], ["/rules", "nav.rules", "book"], ["/bans", "nav.bans", "scale"], ["/support", "nav.support", "message"], ["/account", "nav.account", "user"], ["/rewards", "nav.rewards", "gift"], ["/links", "nav.links", "link"], ["/settings", "nav.settings", "settings"], ["/login", "nav.login", "login"]];
    if (me && me.level >= 1) pages.splice(5, 0, ["/admin", "nav.admin", "shield"]);
    const o = openOverlay(`<div class="modal palette"><input class="input" data-i18n-ph="nav.search" autocomplete="off"><div class="palette-results"></div></div>`, { onClose: () => (paletteOpen = false) });
    const input = $("input", o.el); const res = $(".palette-results", o.el);
    let results = []; let sel = 0; let timer;
    const draw = (users = [], links = [], q = "") => {
      const ql = q.toLowerCase();
      const pg = pages.filter(([, k]) => !ql || t(k).toLowerCase().includes(ql));
      results = [...pg.map(([h, k, ic]) => ({ go: h, html: `<span class="ic">${ART.icon(ic, 16)}</span><span>${esc(t(k))}</span><small>${h}</small>`, grp: "pages" })),
        ...users.map((u) => ({ go: "/player?name=" + encodeURIComponent(u.name), html: `<img src="${mcHead(u.uuid, 32)}" alt="" style="border-radius:5px;image-rendering:pixelated"><span>${esc(u.name)}</span><small>${u.online ? "● " + t("home.online") : ""}</small>`, grp: "users" })),
        ...links.map((l) => ({ open: l.url, html: `${px("heart", 14)}<span>@${esc(l.author)}</span><small>${esc(l.content || l.url)}</small>`, grp: "links" }))];
      sel = Math.min(sel, Math.max(0, results.length - 1));
      let last = ""; let html = "";
      results.forEach((r, i) => { if (r.grp !== last) { html += `<div class="grp">${t("search." + r.grp)}</div>`; last = r.grp; } html += `<div class="res ${i === sel ? "sel" : ""}" data-i="${i}" style="animation-delay:${i * 20}ms">${r.html}</div>`; });
      res.innerHTML = html || `<div class="empty">${t("noResult")}</div>`;
    };
    const pick = (r) => { if (!r) return; o.close(true); if (r.go) go(r.go); else if (r.open) window.open(r.open, "_blank", "noopener"); else if (r.copy) copy(r.copy); };
    input.addEventListener("input", () => { clearTimeout(timer); const q = input.value.trim(); draw([], [], q); if (q) timer = setTimeout(async () => { try { const d = await api("/api/players?limit=8&q=" + encodeURIComponent(q), { quiet: true }); if (input.value.trim() === q) draw(d.players, [], q); } catch { /* 忽略 */ } }, 220); });
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

  /* ---------- 主題 ---------- */
  let theme = store.get("theme", "dark");
  document.documentElement.dataset.theme = theme;
  function setTheme(v) {
    theme = v; store.set("theme", v); document.documentElement.dataset.theme = v;
    sfx(v === "light" ? "toggleOn" : "toggleOff"); document.dispatchEvent(new CustomEvent("themechange"));
  }

  /* ---------- Minecraft / 支援單 / 懲處 共用 ---------- */
  const mcHead = (id, size = 64) => `https://mc-heads.net/avatar/${encodeURIComponent(id || "MHF_Steve")}/${size}`;
  const CATS = {
    report: { icon: "⚑" }, bug: { icon: "⚙" }, connection: { icon: "⌁" }, sponsor: { icon: "✦" }, appeal: { icon: "⚖" }, other: { icon: "…" },
  };
  const PTYPES = ["ban", "mute", "warn", "kick", "ipban"];
  const catTag = (c) => `<span class="tag cat" data-cat="${c}">${t("cat." + c)}</span>`;
  const ptTag = (p, active = true) => `<span class="tag pt ${active ? "" : "inactive"}" data-pt="${p}">${t("pt." + p)}</span>`;
  function dur(sec) {
    if (sec == null) return t("pt.permanent");
    const units = [["d", 86400], ["h", 3600], ["m", 60]]; let out = "";
    for (const [u, n] of units) { const v = Math.floor(sec / n); if (v) { out += v + u + " "; sec -= v * n; } }
    return out.trim() || "<1m";
  }
  function parseDur(text) {
    const m = String(text).toLowerCase().match(/(\d+)\s*(mo|y|w|d|h|m|s)/g); if (!m) return null;
    const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 };
    return m.reduce((a, part) => { const [, n, u] = part.match(/(\d+)\s*(mo|y|w|d|h|m|s)/); return a + n * mult[u]; }, 0);
  }
  /** 遊玩時間：與遊戲計分板相同格式，例如 2d 25m（為 0 的單位省略）。 */
  const playtime = (sec) => {
    sec = Math.max(0, Math.floor(+sec || 0));
    const out = [["d", 86400], ["h", 3600], ["m", 60]].map(([u, n]) => { const v = Math.floor(sec / n); sec -= v * n; return v ? v + u : ""; }).filter(Boolean).join(" ");
    return out || "0m";
  };
  const remaining = (iso) => iso ? dur(Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000))) : t("pt.permanent");

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
    $, $$, esc, t, applyI18n, setLang, get lang() { return lang; }, store, sound, sfx, api, progress, playtime, ambient,
    fmt, compact, ago, date, px, metricsHTML, countUp, observe, toast, ok, fail, modal, confirm: confirmBox,
    zoom, copy, tabs, confetti, go, showCtx, ctxProviders, openPalette, renderBanner, get me() { return me; }, get mePromise() { return mePromise; },
    setTheme, get theme() { return theme; }, icon: (...a) => window.ART.icon(...a), mcHead, CATS, PTYPES, catTag, ptTag, dur, parseDur, remaining,
  };
})();
