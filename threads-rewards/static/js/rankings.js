(() => {
  const { $, esc, t, api, fmt, mcHead, observe, store } = App;
  const SORTS = ["kills", "kdr", "wins", "winrate", "streak", "playtime"];
  let sort = store.get("rk.sort", "kills"); let q = ""; let timer; let week = ""; let weeks = [];
  const WEEK_OFF = ["streak"];
  const wkLabel = (w) => { // 以週一日期（台灣時間）顯示，不受瀏覽器時區影響
    const [y, m, dd] = w.week.split("-").map(Number); const a = new Date(Date.UTC(y, m - 1, dd)); const e = new Date(Date.UTC(y, m - 1, dd + 6));
    return `${a.getUTCMonth() + 1}/${a.getUTCDate()} – ${e.getUTCMonth() + 1}/${e.getUTCDate()}`;
  };
  const topTitles = (p) => (p.titles || []).slice(-2).reverse().map((x) => App.titleTag(x)).join("") + ((p.titles || []).length > 2 ? `<span class="title-more">+${p.titles.length - 2}</span>` : "");
  const main = (p) => ({ kills: fmt(p.kills), kdr: p.kdr.toFixed(2), wins: fmt(p.wins), winrate: p.winrate + "%", streak: fmt(p.best_streak), playtime: App.playtime(p.playtime) })[sort];

  const ICON = { kills: "sword", kdr: "chart", wins: "trophy", winrate: "activity", streak: "gem", playtime: "history" };
  function moveInd() {
    const bar = $("#sorts"); const b = bar.querySelector("button.active"); const ind = bar.querySelector(".sb-ind");
    if (b && ind) { ind.style.left = b.offsetLeft + "px"; ind.style.width = b.offsetWidth + "px"; }
  }
  function renderSorts() {
    $("#sorts").innerHTML = `<i class="sb-ind"></i>` + SORTS.filter((s) => !(week && WEEK_OFF.includes(s))).map((s) => `<button data-sort="${s}" class="${s === sort ? "active" : ""}">${ART.icon(ICON[s], 16)}<span>${t("rk." + s)}</span></button>`).join("");
    requestAnimationFrame(moveInd);
    $("#rank-head").innerHTML = `<span>#</span><span></span><span>${t("rk.player")}</span><span>${t("rk." + sort)}</span><span>${t("rk.kills")}</span><span>KDR</span><span>${t("rk.wins")}</span>`;
  }

  async function load() {
    const s = week && WEEK_OFF.includes(sort) ? "kills" : sort;
    const d = await api(`/api/leaderboard?sort=${s}&limit=100&q=${encodeURIComponent(q)}${week ? "&week=" + encodeURIComponent(week) : ""}`, { quiet: true });
    renderBanner(d.week);
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
        <span class="nm"><b><i class="status-dot ${p.online ? "on" : ""}"></i>${esc(p.name)}</b><span class="nm-tags">${App.tierTag(p.tier)}${week ? "" : topTitles(p)}</span></span>
        <span class="v hl">${main(p)}</span><span class="v">${fmt(p.kills)}<small>${t("rk.kills")}</small></span>
        <span class="v">${p.kdr.toFixed(2)}<small>KDR</small></span><span class="v">${fmt(p.wins)}<small>${t("rk.wins")}</small></span>
      </a>`).join("") : `<div class="empty">${App.px("trophy", 48)}<div>${t(week ? "wk.empty" : "rk.empty")}</div></div>`;
    observe();
  }

  function renderBanner(w) {
    const b = $("#week-banner"); b.hidden = !w; if (!w) return;
    const meta = weeks.find((x) => x.week === w.week) || {};
    const left = Math.max(0, Math.round((new Date(w.end) - Date.now()) / 1000));
    b.innerHTML = `<span class="wb-ic">${ART.icon(w.current ? "clock" : "trophy", 18)}</span>
      <div><b>${w.current ? t("wk.this") : t("wk.past")} · ${wkLabel(w)}</b><small>${w.current ? t("wk.left", { t: App.playtime(left) }) : meta.champion ? t("wk.champ", { name: esc(meta.champion) }) : t("wk.noChamp")}</small></div>
      <button class="btn sm ghost" id="wk-exit">${t("wk.back")}</button>`;
  }
  function renderPeriod() {
    const sel = $("#period");
    sel.innerHTML = `<option value="">${t("wk.all")}</option>` + weeks.map((w) => `<option value="${w.current ? "current" : w.week}">${w.current ? t("wk.thisShort") : t("wk.week")} · ${wkLabel(w)}${!w.current && w.champion ? " · " + t("wk.champShort") + " " + esc(w.champion) : ""}</option>`).join("");
    sel.value = week; sel._sync && sel._sync(); observe($(".rk-tools"));
  }
  function setWeek(v) { week = v; App.sfx("switch"); renderSorts(); renderPeriod(); $("#rank-head").children[3].textContent = t("rk." + (week && WEEK_OFF.includes(sort) ? "kills" : sort)); load().catch((e) => App.fail(e.message)); }
  document.addEventListener("app:ready", () => {
    api("/api/weeks", { quiet: true }).then((d) => { weeks = d.weeks; renderPeriod(); }).catch(() => renderPeriod());
    $("#period").addEventListener("change", (e) => { if (e.target.value !== week) setWeek(e.target.value); });
    $("#week-banner").addEventListener("click", (e) => { if (e.target.closest("#wk-exit")) setWeek(""); });
    $("#title-help").innerHTML = ART.icon("sparkle", 15);
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
  document.addEventListener("langchange", () => { renderSorts(); renderPeriod(); load(); });
})();
