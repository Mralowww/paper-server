(() => {
  const { $, $$, esc, t, api, px, fmt, date, observe } = App;
  let server = null;

  /* 首頁主視覺：像素方塊飄落、鋸齒山脊流動、太陽脈衝、滑鼠視差（Canvas） */
  function stage() {
    const cv = $("#stage-canvas"); const ctx = cv.getContext("2d");
    const reduce = document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, mx = 0, my = 0, tmx = 0, tmy = 0, running = true, last = performance.now(), t0 = last;
    let colors = {};
    const readColors = () => { const cs = getComputedStyle(document.documentElement); ["--art-bg", "--art-1", "--art-2", "--art-3", "--art-4", "--accent", "--bg", "--text"].forEach((k) => (colors[k] = cs.getPropertyValue(k).trim())); };
    const resize = () => { const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const blocks = [];
    const TYPES = [["#5fae3e", "#7a5230"], ["#8b8f92", "#6b6f72"], ["#c9b06e", "#b39a5a"], ["#97c8c7", "#5f9e9c"], ["#5b3d22", "#3f2b18"], ["#e3e7ea", "#b9c1c6"]];
    const spawn = (initial) => {
      const s = 7 + Math.random() * 14; const ty = TYPES[(Math.random() * TYPES.length) | 0];
      blocks.push({ x: Math.random() * W, y: initial ? Math.random() * H : -20 - Math.random() * 60, s, vy: 12 + Math.random() * 26 + s, vx: (Math.random() - 0.5) * 10, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 1.6, top: ty[0], side: ty[1], z: 0.4 + Math.random() * 0.8, glow: Math.random() < 0.18 });
    };
    const ridge = (base, amp, step, speed, color, depth, t) => {
      const off = ((t * speed) % step) - step - mx * depth; ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(-step, H); let i = 0;
      for (let x = off; x <= W + step * 2; x += step / 2, i++) ctx.lineTo(x, (i % 2 ? base - amp : base) + my * depth * 0.4);
      ctx.lineTo(W + step, H); ctx.closePath(); ctx.fill();
    };
    const drawBlock = (b) => {
      ctx.save(); ctx.translate(b.x + mx * 10 * b.z, b.y + my * 6 * b.z); ctx.rotate(b.r); const s = b.s;
      if (b.glow) { ctx.shadowColor = colors["--accent"]; ctx.shadowBlur = 16; }
      ctx.fillStyle = b.side; ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.shadowBlur = 0; ctx.fillStyle = b.top; ctx.fillRect(-s / 2, -s / 2, s, s * 0.38);
      ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(-s / 2, -s / 2, s * 0.3, s * 0.18);
      ctx.restore();
    };
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = (now - t0) / 1000;
      mx += (tmx - mx) * 0.06; my += (tmy - my) * 0.06;
      ctx.clearRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, colors["--art-bg"]); g.addColorStop(1, colors["--bg"]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 太陽與脈衝光環
      const sx = W * 0.7 - mx * 8, sy = H * 0.28 - my * 5, sr = Math.min(W, H) * 0.11;
      for (let k = 0; k < 3; k++) { const p = ((t * 0.35 + k / 3) % 1); ctx.strokeStyle = colors["--accent"]; ctx.globalAlpha = (1 - p) * 0.35; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, sr * (1 + p * 1.6), 0, 6.283); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.shadowColor = colors["--accent"]; ctx.shadowBlur = 40; ctx.fillStyle = colors["--accent"];
      const px = Math.max(3, sr / 6); for (let yy = -sr; yy < sr; yy += px) for (let xx = -sr; xx < sr; xx += px) if (xx * xx + yy * yy < sr * sr) ctx.fillRect(sx + xx, sy + yy, px + 0.5, px + 0.5);
      ctx.shadowBlur = 0;
      // 遠景方塊
      blocks.forEach((b) => { if (b.z < 0.7) drawBlock(b); });
      // 鋸齒山脊（由遠到近）
      ridge(H * 0.62, H * 0.16, W * 0.22, 8, colors["--art-1"], 4, t);
      ridge(H * 0.72, H * 0.12, W * 0.16, 16, colors["--art-2"], 9, t);
      ridge(H * 0.82, H * 0.09, W * 0.11, 28, colors["--art-3"], 16, t);
      ridge(H * 0.92, H * 0.06, W * 0.075, 44, colors["--art-4"], 26, t);
      // 近景方塊
      blocks.forEach((b) => { if (b.z >= 0.7) drawBlock(b); });
      // 更新
      for (let i = blocks.length - 1; i >= 0; i--) { const b = blocks[i]; b.y += b.vy * dt * b.z; b.x += (b.vx + Math.sin(t + i) * 6) * dt; b.r += b.vr * dt; if (b.y > H + 30) blocks.splice(i, 1); }
      while (blocks.length < Math.round(W * H / 9000)) spawn(false);
      if (running && !reduce) requestAnimationFrame(frame);
    }
    readColors(); resize(); for (let i = 0; i < Math.round(W * H / 9000); i++) spawn(true);
    addEventListener("resize", resize); document.addEventListener("themechange", readColors);
    $("#stage").addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); tmx = ((e.clientX - r.left) / r.width - 0.5) * 2; tmy = ((e.clientY - r.top) / r.height - 0.5) * 2; });
    $("#stage").addEventListener("pointerleave", () => { tmx = 0; tmy = 0; });
    $("#stage").addEventListener("click", (e) => { const r = cv.getBoundingClientRect(); for (let i = 0; i < 8; i++) { spawn(false); const b = blocks[blocks.length - 1]; b.x = e.clientX - r.left; b.y = e.clientY - r.top; b.vy = -40 - Math.random() * 60; b.vx = (Math.random() - 0.5) * 120; b.glow = true; } App.sfx("tick"); });
    new IntersectionObserver(([en]) => { const was = running; running = en.isIntersecting; if (running && !was && !reduce) { last = performance.now(); requestAnimationFrame(frame); } }).observe(cv);
    requestAnimationFrame(frame);
  }

  /* 打字機效果顯示伺服器位址 */
  function typeIp(text) {
    const el = $("#ip"); if (el.dataset.full === text) return; el.dataset.full = text; el.textContent = ""; let i = 0;
    const step = () => { el.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(step, 70 + Math.random() * 60); else setTimeout(() => el.classList.remove("typed"), 1600); };
    setTimeout(step, 500);
  }

  function marquee() {
    const words = App.lang === "zh" ? ["純淨生存", "公平競技", "每週活動", "Threads 推廣獎勵", "PVP 排行榜", "Discord 社群", "sawsmp.me"] : ["Pure survival", "Fair PvP", "Weekly events", "Threads rewards", "Leaderboards", "Discord community", "sawsmp.me"];
    const row = words.map((w) => `<span>${esc(w)}</span>`).join("");
    $("#marquee").innerHTML = row + row;
  }

  function renderStatus() {
    const st = server.status || {};
    typeIp(st.address || "sawsmp.me");
    $("#stage-dot").className = "pulse-dot " + (st.online ? "on" : "off");
    $("#stage-text").textContent = st.online ? `${st.players}/${st.max} ONLINE` : "OFFLINE";
    const on = !!st.online;
    $("#st-dot").className = "dot " + (on ? "on" : "off");
    $("#st-text").textContent = t(on ? "home.online" : "home.offline");
    const tag = $("#status-tag"); tag.className = "tag live " + (on ? "ok" : "err"); tag.textContent = t(on ? "home.online" : "home.offline");
    const pl = $("#st-players"); pl.hidden = !on; pl.textContent = `${fmt(st.players)} / ${fmt(st.max)} ${t("home.players")}`;
    const ver = $("#st-version"); ver.hidden = !st.version; ver.textContent = st.version || "";
    const dc = $("#discord-btn"); dc.hidden = !server.discord_invite; dc.href = server.discord_invite || "#";
    App.renderBanner(server.announcement);
  }

  async function loadNews() {
    const { news } = await api("/api/news?limit=3", { quiet: true });
    $("#latest").innerHTML = news.length ? news.map((n) => `
      <a class="card hover news-card reveal" href="/news#n${n.id}">
        <div class="row" style="gap:8px"><span class="tag ${tagCls(n.tag)}">${t("tag." + n.tag)}</span><span class="dim mono" style="font-size:12px">${date(n.created_at, false)}</span></div>
        <h3>${esc(n.title)}</h3><p>${esc(n.body)}</p>
      </a>`).join("") : `<div class="card flat empty" style="grid-column:1/-1">${t("home.noNews")}</div>`;
    observe($("#latest"));
  }

  async function loadMini() {
    const d = await api("/api/overview", { quiet: true });
    $("#mini-board").innerHTML = d.leaderboard.slice(0, 3).map((r, i) => `
      <div class="board-row" data-user='${esc(JSON.stringify({ id: r.id, name: r.name }))}'><span class="rk r${i + 1}">${i + 1}</span><img src="${esc(r.avatar)}" alt=""><div class="who"><b>${esc(r.name)}</b></div><div class="pts">${fmt(r.score)}</div></div>`).join("")
      || `<div class="empty" style="padding:18px 0">${px("trophy", 32)}</div>`;
  }

  document.addEventListener("app:ready", async () => {
    $$("[data-px]").forEach((el) => (el.innerHTML = px(el.dataset.px, 22)));
    stage(); marquee(); typeIp("sawsmp.me"); observe();
    $("#copy-ip").addEventListener("click", () => App.copy($("#ip").dataset.full || "sawsmp.me"));
    loadNews().catch(() => {}); loadMini().catch(() => {});
    try { server = await api("/api/server", { quiet: true }); renderStatus(); } catch { /* 狀態服務暫時不可用 */ }
    setInterval(async () => { if (document.visibilityState !== "visible") return; try { server = await api("/api/server", { quiet: true }); renderStatus(); } catch { /* 忽略 */ } }, 60000);
  });
  document.addEventListener("langchange", () => { if (server) renderStatus(); marquee(); loadNews().catch(() => {}); });

  function tagCls(tag) { return { update: "blue", event: "gold", maintenance: "warn" }[tag] || ""; }
  window.newsTagCls = tagCls;
})();
