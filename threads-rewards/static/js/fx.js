/* 動態效果：標題逐字浮現、區塊錯開進場、捲動視差、卡片 3D 傾斜與反光、按鈕磁吸、
   導覽列滑動底塊、頁面切換布幕、捲動進度條。減少動畫時全部停用。 */
(() => {
  const reduce = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- 標題逐字浮現 ---------- */
  const SPLIT_SEL = "h1, .section-head h2, .admin-title h2, [data-split]";
  function split(el) {
    if (el.dataset.splitDone || el.closest(".modal")) return;
    el.dataset.splitDone = 1;
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          for (const ch of n.textContent) {
            if (ch === " " || ch === "\n") { frag.appendChild(document.createTextNode(ch)); continue; }
            const s = document.createElement("span"); s.className = "ch"; s.textContent = ch; s.style.setProperty("--i", i++); frag.appendChild(s);
          }
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !n.classList.contains("ch")) walk(n);
      });
    };
    walk(el);
    el.classList.add("fx-split");
    splitIO.observe(el);
  }
  const splitIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("fx-split-in"); splitIO.unobserve(e.target); } }), { threshold: 0.2 });

  /* ---------- 區塊錯開進場 ---------- */
  const STAGGER_SEL = ".grid > .card, .grid > .stat, .kpi-mini > div, .stat-tiles > *, .kv-grid > *, .cat5 > button, .pun-type5 > button, .seg > button, .podium3 > *, .status-grid > *, .link-flow > *, .fields-box > *, .admin-nav > a, .chips > .chip, .steps > .step, .foot-links > div";
  const itemIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target; const sib = [...el.parentElement.children].filter((x) => x.classList.contains("fx-item"));
    el.style.transitionDelay = Math.min(sib.indexOf(el), 12) * 55 + "ms";
    el.classList.add("fx-in"); itemIO.unobserve(el);
    setTimeout(() => (el.style.transitionDelay = ""), 1400);
  }), { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
  function stagger(root) {
    $$(STAGGER_SEL, root).forEach((el) => {
      if (el.classList.contains("fx-item") || el.classList.contains("reveal") || el.classList.contains("reveal-s") || el.classList.contains("reveal-l")) return;
      el.classList.add("fx-item"); itemIO.observe(el);
    });
  }

  /* ---------- 3D 傾斜 + 反光 ---------- */
  const TILT_SEL = ".card.hover, .podium3 .pc, .cat5 > button, .pun-type5 > button, .stat-tile, .rival, .tk-item, .rank-row, .hero-art, .ip-box";
  function tilt(e) {
    const el = e.target.closest(TILT_SEL); if (!el || reduce()) return;
    const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    const strength = el.matches(".rank-row, .tk-item, .rival") ? 2 : el.matches(".hero-art") ? 6 : 7;
    el.style.setProperty("--rx", ((0.5 - y) * strength).toFixed(2) + "deg");
    el.style.setProperty("--ry", ((x - 0.5) * strength).toFixed(2) + "deg");
    el.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
    el.style.setProperty("--my", (y * 100).toFixed(1) + "%");
    el.classList.add("tilting");
  }
  function untilt(e) {
    const el = e.target.closest && e.target.closest(TILT_SEL); if (!el || el.contains(e.relatedTarget)) return;
    el.classList.remove("tilting"); el.style.removeProperty("--rx"); el.style.removeProperty("--ry");
  }

  /* ---------- 按鈕磁吸 ---------- */
  const MAG_SEL = ".btn.gold, .btn.lg, .ip-chip, .composer .send, .btn-discord, .theme-btn";
  function magnet(e) {
    const el = e.target.closest(MAG_SEL); if (!el || reduce()) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width; const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    el.style.setProperty("--tx", (dx * 8).toFixed(1) + "px"); el.style.setProperty("--ty", (dy * 6).toFixed(1) + "px");
    el.style.setProperty("--sx", ((dx + 0.5) * 100).toFixed(0) + "%"); el.classList.add("magnet");
  }
  function unmagnet(e) {
    const el = e.target.closest && e.target.closest(MAG_SEL); if (!el || el.contains(e.relatedTarget)) return;
    el.classList.remove("magnet"); el.style.removeProperty("--tx"); el.style.removeProperty("--ty");
  }

  /* ---------- 導覽列滑動底塊 ---------- */
  function navPill() {
    const nav = document.querySelector(".nav-links"); if (!nav || nav.querySelector(".nav-pill")) return;
    const pill = document.createElement("span"); pill.className = "nav-pill"; nav.prepend(pill);
    const move = (a) => { if (!a) { pill.style.opacity = 0; return; } pill.style.opacity = 1; pill.style.left = a.offsetLeft + "px"; pill.style.width = a.offsetWidth + "px"; };
    nav.addEventListener("pointerover", (e) => { const a = e.target.closest("a"); if (a) move(a); });
    nav.addEventListener("pointerleave", () => move(nav.querySelector("a.active")));
    requestAnimationFrame(() => move(nav.querySelector("a.active")));
  }

  /* ---------- 捲動視差與進度 ---------- */
  let ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = scrollY; const h = document.documentElement.scrollHeight - innerHeight;
      document.documentElement.style.setProperty("--scroll", h > 0 ? (y / h).toFixed(4) : 0);
      document.querySelector(".nav")?.classList.toggle("scrolled", y > 8);
      if (reduce()) return;
      $$("[data-parallax]").forEach((el) => { const r = el.getBoundingClientRect(); const c = r.top + r.height / 2 - innerHeight / 2; el.style.transform = `translate3d(0, ${(-c * +el.dataset.parallax).toFixed(1)}px, 0)`; });
    });
  }

  /* ---------- 頁面切換布幕 ---------- */
  function curtain() {
    if (document.getElementById("curtain")) return;
    const c = document.createElement("div"); c.id = "curtain"; c.innerHTML = "<i></i><i></i><i></i>"; document.body.appendChild(c);
    const obs = new MutationObserver(() => { if (document.body.classList.contains("leaving") && !reduce()) c.classList.add("on"); });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("pageshow", () => c.classList.remove("on"));
  }

  function scan(root = document) {
    if (reduce()) return;
    $$(SPLIT_SEL, root).forEach(split);
    stagger(root);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div"); bar.id = "scrollbar"; document.body.appendChild(bar);
    curtain(); scan(); onScroll();
    // 動態載入的內容也套用
    new MutationObserver((ms) => { if (reduce()) return; for (const m of ms) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches(SPLIT_SEL)) split(n); scan(n); } }); })
      .observe(document.body, { childList: true, subtree: true });
    if (fine) {
      document.addEventListener("pointermove", (e) => { tilt(e); magnet(e); }, { passive: true });
      document.addEventListener("pointerout", (e) => { untilt(e); unmagnet(e); });
    }
    addEventListener("scroll", onScroll, { passive: true }); addEventListener("resize", onScroll);
  });
  document.addEventListener("app:ready", () => { navPill(); scan(); });
  document.addEventListener("langchange", () => setTimeout(navPill, 0));
  const origRender = () => setTimeout(navPill, 0);
  document.addEventListener("themechange", origRender);
  window.FX = { scan };
})();
