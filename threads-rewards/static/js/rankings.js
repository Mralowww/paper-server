(() => {
  const { $, esc, t, api, fmt, mcHead, observe, store } = App;
  const SORTS = ["kills", "kdr", "wins", "winrate", "streak", "playtime"];
  let sort = store.get("rk.sort", "kills"); let q = ""; let timer;
  const hours = (s) => (s / 3600).toFixed(1) + "h";
  const main = (p) => ({ kills: fmt(p.kills), kdr: p.kdr.toFixed(2), wins: fmt(p.wins), winrate: p.winrate + "%", streak: fmt(p.best_streak), playtime: hours(p.playtime) })[sort];

  function renderSorts() {
    $("#sorts").innerHTML = SORTS.map((s) => `<button data-sort="${s}" class="${s === sort ? "active" : ""}">${t("rk." + s)}</button>`).join("");
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
        <b>${esc(top[i].name)}</b><div class="big">${main(top[i])}</div><small class="dim">${t("rk." + sort)} · ${esc(top[i].tier.name)}</small></a>` : "<div></div>").join("") : "";
    $("#list").innerHTML = ps.length ? ps.map((p, i) => `
      <a class="rank-row" href="/player?name=${encodeURIComponent(p.name)}" style="animation-delay:${Math.min(i, 20) * 25}ms">
        <span class="no ${i < 3 && !q ? "r" + (i + 1) : ""}">${i + 1}</span>
        <img class="mc-av" src="${mcHead(p.uuid, 44)}" width="44" height="44" alt="">
        <span class="nm"><b><i class="status-dot ${p.online ? "on" : ""}"></i>${esc(p.name)}</b><small>${esc(p.tier.name)}</small></span>
        <span class="v hl">${main(p)}</span><span class="v">${fmt(p.kills)}<small>${t("rk.kills")}</small></span>
        <span class="v">${p.kdr.toFixed(2)}<small>KDR</small></span><span class="v">${fmt(p.wins)}<small>${t("rk.wins")}</small></span>
      </a>`).join("") : `<div class="empty">${App.px("trophy", 48)}<div>${t("rk.empty")}</div></div>`;
    observe();
  }

  document.addEventListener("app:ready", () => {
    renderSorts(); load().catch((e) => App.fail(e.message));
    $("#sorts").addEventListener("click", (e) => { const b = e.target.closest("[data-sort]"); if (!b) return; sort = b.dataset.sort; store.set("rk.sort", sort); App.sfx("switch"); renderSorts(); load(); });
    $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { q = $("#q").value.trim(); load(); }, 250); });
    setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 60000);
  });
  document.addEventListener("langchange", () => { renderSorts(); load(); });
})();
