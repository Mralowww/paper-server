(() => {
  const { $, esc, t, api, fmt, mcHead, observe, store } = App;
  const SORTS = ["kills", "kdr", "wins", "winrate", "streak", "playtime"];
  let sort = store.get("rk.sort", "kills"); let q = ""; let timer;
  const main = (p) => ({ kills: fmt(p.kills), kdr: p.kdr.toFixed(2), wins: fmt(p.wins), winrate: p.winrate + "%", streak: fmt(p.best_streak), playtime: App.playtime(p.playtime) })[sort];

  const ICON = { kills: "sword", kdr: "chart", wins: "trophy", winrate: "activity", streak: "gem", playtime: "history" };
  function moveInd() {
    const bar = $("#sorts"); const b = bar.querySelector("button.active"); const ind = bar.querySelector(".sb-ind");
    if (b && ind) { ind.style.left = b.offsetLeft + "px"; ind.style.width = b.offsetWidth + "px"; }
  }
  function renderSorts() {
    $("#sorts").innerHTML = `<i class="sb-ind"></i>` + SORTS.map((s) => `<button data-sort="${s}" class="${s === sort ? "active" : ""}">${ART.icon(ICON[s], 16)}<span>${t("rk." + s)}</span></button>`).join("");
    requestAnimationFrame(moveInd);
    $("#rank-head").innerHTML = `<span>#</span><span></span><span>${t("rk.player")}</span><span>${t("rk." + sort)}</span><span>${t("rk.kills")}</span><span>KDR</span><span>${t("rk.wins")}</span>`;
  }

  async function load() {
    const d = await api(`/api/leaderboard?sort=${sort}&limit=100&q=${encodeURIComponent(q)}`, { quiet: true });
    const ps = d.players;
    $("#totals").innerHTML = [["rk.players", d.totals.players], ["rk.kills", d.totals.kills], ["rk.matches", d.totals.matches], ["home.online", d.totals.online]]
      .map(([k, v]) => `<div><b data-count="${v}">0</b><small>${t(k)}</small></div>`).join("");
    const top = q ? [] : ps.slice(0, 3);
    $("#podium").innerHTML = top.length ? [1, 0, 2].map((i) => top[i] ? `
      <a class="pc p${i + 1} reveal-s" href="/player?name=${encodeURIComponent(top[i].name)}">
        <span class="medal">#${i + 1}</span><img src="https://mc-heads.net/body/${top[i].uuid}/${i === 0 ? 180 : 150}" alt="">
        <b>${esc(top[i].name)}</b><div class="big">${main(top[i])}</div><small class="dim">${t("rk." + sort)}</small><div class="pc-tier">${App.tierTag(top[i].tier)}</div></a>` : "<div></div>").join("") : "";
    $("#list").innerHTML = ps.length ? ps.map((p, i) => `
      <a class="rank-row" href="/player?name=${encodeURIComponent(p.name)}" style="animation-delay:${Math.min(i, 20) * 25}ms">
        <span class="no ${i < 3 && !q ? "r" + (i + 1) : ""}">${i + 1}</span>
        <img class="mc-av" src="${mcHead(p.uuid, 44)}" width="44" height="44" alt="">
        <span class="nm"><b><i class="status-dot ${p.online ? "on" : ""}"></i>${esc(p.name)}</b>${App.tierTag(p.tier)}</span>
        <span class="v hl">${main(p)}</span><span class="v">${fmt(p.kills)}<small>${t("rk.kills")}</small></span>
        <span class="v">${p.kdr.toFixed(2)}<small>KDR</small></span><span class="v">${fmt(p.wins)}<small>${t("rk.wins")}</small></span>
      </a>`).join("") : `<div class="empty">${App.px("trophy", 48)}<div>${t("rk.empty")}</div></div>`;
    observe();
  }

  document.addEventListener("app:ready", () => {
    $("#tier-help").innerHTML = ART.icon("gem", 15);
    renderSorts(); load().catch((e) => App.fail(e.message));
    $("#sorts").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sort]"); if (!b || b.dataset.sort === sort) return;
      sort = b.dataset.sort; store.set("rk.sort", sort); App.sfx("switch");
      $("#sorts").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); moveInd();
      $("#rank-head").children[3].textContent = t("rk." + sort); load();
    });
    addEventListener("resize", moveInd);
    $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { q = $("#q").value.trim(); load(); }, 250); });
    setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 60000);
  });
  document.addEventListener("langchange", () => { renderSorts(); load(); });
})();
