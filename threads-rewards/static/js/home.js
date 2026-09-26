(() => {
  const { $, $$, esc, t, api, px, metricsHTML, countUp, observe, fmt, date, sfx, confetti } = App;
  let data = null; let endAt = 0; let lastSig = "";
  const MEDAL = ["gold", "silver", "bronze"];

  const userAttr = (u) => `data-user='${esc(JSON.stringify({ id: u.id, name: u.name }))}'`;

  function renderPodium() {
    const top = data.leaderboard.slice(0, 3); const order = [1, 0, 2];
    $("#podium").innerHTML = order.map((i) => {
      const u = top[i]; const reward = data.rewards[i];
      if (!u) return `<div class="card spot p${i + 1} empty reveal-s"><div class="av"><img src="https://cdn.discordapp.com/embed/avatars/${i}.png" alt=""></div><span class="rank-badge">#${i + 1}</span><div class="name dim">${t("home.vacant")}</div>${reward ? `<div class="reward">🎁 ${esc(reward)}</div>` : ""}</div>`;
      return `<div class="card hover spot p${i + 1} reveal-s" ${userAttr(u)}>
        ${i === 0 ? `<span class="crown">${px("crown", 28)}</span>` : ""}
        <div class="av"><img src="${esc(u.avatar)}" alt="" data-zoom></div>
        <span class="rank-badge">#${i + 1}</span>
        <div class="name">${esc(u.name)}</div>
        <div class="score"><span data-count="${u.score}">0</span> <small class="dim">${t("m.score")}</small></div>
        <div class="row" style="justify-content:center;margin-top:6px">${metricsHTML(u, ["likes", "replies", "reposts"])}</div>
        ${reward ? `<div class="reward">🎁 ${esc(reward)}</div>` : ""}
      </div>`;
    }).join("");
  }

  function renderBoard() {
    const list = data.leaderboard; const max = Math.max(1, ...list.map((r) => r.score || 0));
    const me = App.me && App.me.id;
    $("#board-count").textContent = `${list.length}`;
    $("#board-list").innerHTML = list.length ? list.map((r, i) => `
      <div class="board-row ${r.id === me ? "me" : ""}" style="animation-delay:${i * 40}ms" ${userAttr(r)}>
        <span class="rk ${i < 3 ? "r" + (i + 1) : ""}">${i + 1}</span>
        <img src="${esc(r.avatar)}" alt="">
        <div class="who"><b>${esc(r.name)}</b><div class="metrics">${metricsHTML(r)}</div>
          <div class="progress"><i style="width:${((r.score || 0) / max) * 100}%;animation-delay:${i * 50}ms"></i></div></div>
        <div class="pts"><span data-count="${r.score || 0}">0</span><small>${r.link_count} ${t("m.links")}</small></div>
      </div>`).join("") : `<div class="empty">${px("trophy", 48)}<div>${t("links.empty")}</div></div>`;
  }

  function renderSide() {
    $("#step2d").textContent = t("home.step2d", { n: data.max_links });
    const w = data.weights;
    const rows = [["likes", "heart"], ["replies", "reply"], ["reposts", "repost"], ["views", "eye"]];
    $("#weights").innerHTML = rows.map(([k, ic]) => `<div class="row" style="justify-content:space-between"><span class="metric ${k}">${px(ic, 16)} ${t("m." + k)}</span><span class="mono gold-text">× ${fmt(w[k], 2)}</span></div>`).join("");
    const lw = data.last_winners;
    $("#last-winners").innerHTML = lw.winners.length ? lw.winners.map((r) => `
      <div class="board-row" ${userAttr(r)}><span class="rk r${r.rank}">${r.rank}</span><img src="${esc(r.avatar)}" alt=""><div class="who"><b>${esc(r.name)}</b><small class="dim mono">${date(lw.period.period_start, false)} – ${date(lw.period.period_end, false)}</small></div><div class="pts">${fmt(r.score)}</div></div>`).join("")
      : `<div class="empty">${px("crown", 40)}<div>—</div></div>`;
  }

  function renderStats() {
    $$("#stats [data-k]").forEach((el) => countUp(el, data.totals[el.dataset.k] || 0, { compactFmt: true }));
  }

  async function loadHistory() {
    const { weeks } = await api("/api/history", { quiet: true });
    $("#history").innerHTML = weeks.length ? weeks.slice(0, 9).map((w) => `
      <div class="card hover reveal">
        <div class="card-title"><span class="icon-spin">${px("trophy", 18)}</span><b class="mono">${date(w.start, false)} – ${date(w.end, false)}</b></div>
        <div class="board">${w.winners.map((r) => `<div class="board-row" ${userAttr(r)}><span class="rk r${r.rank}">${r.rank}</span><img src="${esc(r.avatar)}" alt=""><div class="who"><b>${esc(r.name)}</b></div><div class="pts">${fmt(r.score)}</div></div>`).join("")}</div>
      </div>`).join("") : `<div class="card empty" style="grid-column:1/-1">${px("star", 40)}<div>—</div></div>`;
    observe($("#history"));
  }

  /* 倒數：每秒跳動，歸零時播放上線動畫 */
  const pad = (n) => String(n).padStart(2, "0");
  let prev = {};
  function tickCountdown() {
    if (!endAt) return;
    let s = Math.max(0, Math.floor((endAt - Date.now()) / 1000));
    const v = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
    for (const k in v) {
      const el = $(`#countdown [data-u="${k}"]`); const txt = pad(v[k]);
      if (prev[k] !== txt) { el.textContent = txt; el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); prev[k] = txt; }
    }
    if (s === 0) {
      endAt = 0; sfx("launch"); confetti(140);
      $("#countdown").style.animation = "launch .8s var(--ease-spring)";
      setTimeout(load, 4000);
    }
  }

  async function load() {
    try { data = await api("/api/overview", { quiet: !!data }); } catch (e) { App.fail(e.message); return; }
    endAt = new Date(data.period.end).getTime();
    $("#period-label").textContent = `${date(data.period.start, false)} – ${date(data.period.end, false)}`;
    const sig = JSON.stringify(data.leaderboard.map((r) => [r.id, r.score]));
    if (lastSig && sig !== lastSig) sfx("receive");
    if (sig !== lastSig) { renderPodium(); renderBoard(); }
    lastSig = sig;
    renderSide(); renderStats(); observe();
    App.renderBanner(data.announcement);
  }

  document.addEventListener("app:ready", () => {
    $$("[data-px]").forEach((el) => (el.innerHTML = px(el.dataset.px, 20)));
    if (App.me) $("#cta-join").setAttribute("href", "/links");
    load(); loadHistory();
    setInterval(tickCountdown, 1000);
    setInterval(() => document.visibilityState === "visible" && load(), 60000);
  });
  document.addEventListener("langchange", () => { if (data) { lastSig = ""; load(); loadHistory(); } });
})();
