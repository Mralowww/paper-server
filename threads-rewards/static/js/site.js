(() => {
  const { $, $$, esc, t, api, px, fmt, date, observe } = App;
  let server = null;

  /* 右側插畫：層層鋸齒山脊，隨滑鼠輕微視差 */
  function drawArt() {
    const ridge = (y, amp, step, off) => {
      let d = `M0 ${y}`;
      for (let x = 0, i = 0; x <= 400 + step; x += step / 2, i++) d += ` L${x + off} ${i % 2 ? y - amp : y}`;
      return d + " L420 330 L0 330 Z";
    };
    $("#hero-art").innerHTML = `<svg viewBox="0 0 400 330" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="330" fill="#faf9f6"/>
      <circle cx="292" cy="96" r="38" fill="#b4532a" opacity=".92" data-depth="4"/>
      <g data-depth="6"><path d="${ridge(190, 58, 80, -20)}" fill="#e6e3dc"/></g>
      <g data-depth="10"><path d="${ridge(228, 46, 56, -10)}" fill="#cfcac0"/></g>
      <g data-depth="16"><path d="${ridge(262, 34, 40, 0)}" fill="#8f8a80"/></g>
      <g data-depth="22"><path d="${ridge(296, 24, 28, -6)}" fill="#161616"/></g>
    </svg><div class="cap"><span>sawsmp.me</span><span id="art-cap">Season 1</span></div>`;
    const art = $("#hero-art");
    art.addEventListener("pointermove", (e) => {
      const r = art.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
      $$("[data-depth]", art).forEach((g) => { const d = +g.dataset.depth; g.style.transform = `translate(${x * d}px, ${y * d * 0.4}px)`; g.style.transition = "transform .6s cubic-bezier(.22,1,.36,1)"; });
    });
    art.addEventListener("pointerleave", () => $$("[data-depth]", art).forEach((g) => (g.style.transform = "")));
  }

  function renderStatus() {
    const st = server.status || {};
    $("#ip").textContent = st.address || "sawsmp.me";
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
    drawArt(); observe();
    $("#copy-ip").addEventListener("click", () => App.copy($("#ip").textContent));
    loadNews().catch(() => {}); loadMini().catch(() => {});
    try { server = await api("/api/server", { quiet: true }); renderStatus(); } catch { /* 狀態服務暫時不可用 */ }
    setInterval(async () => { if (document.visibilityState !== "visible") return; try { server = await api("/api/server", { quiet: true }); renderStatus(); } catch { /* 忽略 */ } }, 60000);
  });
  document.addEventListener("langchange", () => { if (server) renderStatus(); loadNews().catch(() => {}); });

  function tagCls(tag) { return { update: "blue", event: "gold", maintenance: "warn" }[tag] || ""; }
  window.newsTagCls = tagCls;
})();
