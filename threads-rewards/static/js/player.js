(() => {
  const { $, $$, esc, t, api, fmt, date, ago, mcHead, ptTag, remaining, observe, store, sfx } = App;
  const name = new URLSearchParams(location.search).get("name") || "";
  let d = null; let tab = store.get("pp.tab", "stats");

  function overview() {
    const p = d.player, s = d.stats;
    return `<div class="card reveal"><div class="card-title"><h3>${t("pp.overview")}</h3>${p.online ? `<span class="right tag ok live">${t("home.online")}</span>` : ""}</div>
      <div class="kv-grid" style="margin-top:0">
        <div class="kv"><span>${t("pp.rank")}</span><b>${d.rank ? "#" + d.rank : "—"}</b></div>
        <div class="kv"><span>${t("pp.tier")}</span><b>${esc(s.tier.name)}</b></div>
        <div class="kv"><span>${t("pl.firstSeen")}</span><b>${p.first_seen ? date(p.first_seen, false) : "—"}</b></div>
        <div class="kv"><span>${t("pl.lastSeen")}</span><b>${p.online ? t("home.online") : p.last_seen ? ago(p.last_seen) : "—"}</b></div>
        <div class="kv"><span>${t("pp.playtime")}</span><b>${App.playtime(s.playtime)}</b></div>
        <div class="kv"><span>${t("pp.linked")}</span><b class="${p.linked ? "good" : ""}">${p.linked ? "✓" : "—"}</b></div>
      </div>
      ${s.tier.next ? `<div style="margin-top:18px"><div class="row" style="justify-content:space-between;font-size:13px"><span class="muted">${t("pp.nextTier")}：${esc(s.tier.next.name)}</span><span class="mono">${s.kills} / ${s.tier.next.kills}</span></div><div class="progress" style="height:6px"><i style="width:${Math.min(100, (s.kills / s.tier.next.kills) * 100)}%"></i></div></div>` : ""}
    </div>
    <div class="card reveal section tight"><div class="card-title"><h3>${t("pp.history")}</h3></div>
      ${d.punishments.length ? d.punishments.map((x) => `<div class="pun-item ${x.active ? "" : "off"}" data-pt="${x.type}"><span class="bar"></span><div class="desc"><div class="row" style="gap:6px">${ptTag(x.type, !!x.active)}<span class="dim mono" style="font-size:12px">#${x.id}</span></div><p>${esc(x.reason)}</p><small>${date(x.created_at)} · ${x.active ? t("pl.remaining") + " " + remaining(x.expires_at) : t("pl.expired")}</small></div></div>`).join("") : `<div class="empty">${t("pp.clean")}</div>`}
    </div>`;
  }

  function stats() {
    const s = d.stats; const max = Math.max(1, ...d.methods.map((m) => m.count));
    const methods = d.methods.length ? d.methods : [{ method: "crystal", count: 0 }, { method: "anchor", count: 0 }, { method: "melee", count: 0 }, { method: "other", count: 0 }];
    return `<div class="card reveal"><h3 style="text-align:center;letter-spacing:.06em;text-transform:uppercase">${t("pp.statsOf", { name: esc(d.player.name) })}</h3>
      <div class="stat-tiles" style="margin-top:18px">
        ${[["pp.kills", fmt(s.kills)], ["pp.deaths", fmt(s.deaths)], ["KDR", s.kdr.toFixed(2), "var(--green)"], ["pp.streak", fmt(s.streak)], ["pp.duels", fmt(s.matches)]]
          .map(([k, v, c]) => `<div class="stat-tile"><small>${k.includes(".") ? t(k) : k}</small><b style="${c ? "color:" + c : ""}">${v}</b></div>`).join("")}
      </div>
      <div class="kv-grid">
        <div class="kv"><span>${t("pp.winrate")}</span><b class="good">${s.winrate}%</b></div>
        <div class="kv"><span>${t("pp.wl")}</span><b>${s.wl.toFixed(2)}</b></div>
        <div class="kv"><span>${t("pp.lossrate")}</span><b class="bad">${s.matches ? (100 - s.winrate).toFixed(1) : 0}%</b></div>
        <div class="kv"><span>${t("pp.best")}</span><b>${fmt(s.best_streak)}</b></div>
        <div class="kv"><span>${t("pp.wins")}</span><b>${fmt(s.wins)}</b></div>
        <div class="kv"><span>${t("pp.losses")}</span><b>${fmt(s.losses)}</b></div>
        <div class="kv"><span>${t("pp.crystals")}</span><b>${fmt((d.methods.find((m) => m.method === "crystal") || {}).count || 0)}</b></div>
        <div class="kv"><span>${t("pp.playtime")}</span><b>${App.playtime(s.playtime)}</b></div>
      </div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);margin-top:20px">
      <div class="card reveal"><div class="card-title"><h3>${t("pp.methods")}</h3></div>
        ${methods.map((m, i) => `<div class="bar-row">${ART.killIcon(m.method, 22)}<span>${t(ART.KILL_NAMES[m.method] || "kill.other")}</span><div class="track"><i style="width:${(m.count / max) * 100}%;animation-delay:${i * 80}ms"></i></div><b>${m.count}</b></div>`).join("")}</div>
      <div class="card reveal"><div class="card-title"><h3>${t("pp.rivals")}</h3></div>
        ${d.rivals.length ? d.rivals.map((r) => `<a class="rival" href="/player?name=${encodeURIComponent(r.name)}"><img src="${mcHead(r.uuid, 40)}" alt=""><b style="overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</b><small class="dim">${ago(r.last)}</small><span class="score"><span class="w">${r.wins}</span><span class="d">–</span><span class="l">${r.losses}</span></span></a>`).join("")
          + `<button class="btn" style="width:100%;border-style:dashed;color:var(--accent)" data-goto="matches">${t("pp.fullMatches", { n: d.matches.length })} →</button>` : `<div class="empty">—</div>`}
      </div>
    </div>`;
  }

  function matches() {
    if (!d.matches.length) return `<div class="card empty">${t("pp.noMatches")}</div>`;
    let last = ""; let out = "";
    d.matches.forEach((m, i) => {
      const day = new Date(m.created_at).toLocaleDateString(App.lang === "zh" ? "zh-TW" : "en-US", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
      if (day !== last) { out += `<div class="day-sep">${day}</div>`; last = day; }
      out += `<div class="match ${m.draw ? "draw" : m.won ? "" : "lost"}" style="animation-delay:${Math.min(i, 12) * 40}ms">${ART.worldArt(m.world || "")}<span class="res">${t(m.draw ? "pp.draw" : m.won ? "pp.win" : "pp.loss")}</span>
        <div class="who"><b>${esc(d.player.name)} <span>vs</span> <a href="/player?name=${encodeURIComponent(m.opponent)}">${esc(m.opponent)}</a></b><small>${esc(m.world || "—")}</small><small class="mono">${new Date(m.created_at).toLocaleTimeString(App.lang === "zh" ? "zh-TW" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</small></div>
        <img class="opp" src="${mcHead(m.opponent_uuid, 52)}" alt=""><span class="score"><span class="w">${m.my_score}</span><span class="d">—</span><span class="l">${m.their_score}</span></span></div>`;
    });
    return out;
  }

  function render() {
    // 切換分頁時保留目前高度（取看過的最大值），頁面不會因內容變短而被拉回上面
    const pb = $("#pbody"); pb.style.minHeight = Math.max(pb.offsetHeight, parseFloat(pb.style.minHeight) || 0) + "px";
    $$("#ptabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("#pbody").innerHTML = `<div class="tab-panel">${{ overview, stats, matches }[tab]()}</div>`;
    observe($("#pbody"));
  }

  document.addEventListener("app:ready", async () => {
    try { d = await api(`/api/profile/${encodeURIComponent(name)}`); }
    catch (e) { $("#pname").textContent = name || "?"; $("#pbody").innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
    const p = d.player;
    document.title = `${p.name} · 鋸齒 SMP`;
    $("#pname").textContent = p.name;
    $("#skin").src = `https://mc-heads.net/body/${p.uuid}/360`; $("#skin").dataset.zoom = `https://mc-heads.net/body/${p.uuid}/600`;
    $("#tier span:last-child").textContent = d.stats.tier.name;
    $("#namemc").href = `https://namemc.com/profile/${p.uuid}`;
    render();
    $("#ptabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; tab = b.dataset.tab; store.set("pp.tab", tab); sfx("switch"); render(); });
    $("#pbody").addEventListener("click", (e) => { const b = e.target.closest("[data-goto]"); if (b) { tab = b.dataset.goto; sfx("switch"); render(); } });
  });
  document.addEventListener("langchange", () => d && render());
})();
