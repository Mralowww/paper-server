(() => {
  const { $, esc, t, api, date, mcHead, ptTag, remaining, observe } = App;
  let type = ""; let page = 1; let q = ""; let timer;
  async function load(append = false) {
    const d = await api(`/api/punishments?type=${type}&q=${encodeURIComponent(q)}&page=${page}`, { quiet: append });
    $("#counts").innerHTML = ["ban", "mute", "warn", "ipban"].map((p) => `<div class="card stat" data-pt="${p}" style="padding:16px"><span class="label" style="color:var(--c)">${t("pt." + p)} · ${t("bans.activeNow")}</span><span class="value">${d.active_counts[p] || 0}</span></div>`).join("");
    $("#types").innerHTML = ["", ...App.PTYPES].map((p) => `<button data-t="${p}" class="${p === type ? "active" : ""}">${p ? t("pt." + p) : t("st.all")}</button>`).join("");
    const html = d.punishments.map((p) => `<div class="row" style="gap:12px;flex-wrap:nowrap"><a href="/player?name=${encodeURIComponent(p.name)}"><img class="mc-av" src="${mcHead(p.uuid, 36)}" width="36" height="36" alt=""></a>
      <div style="flex:1;min-width:0"><a href="/player?name=${encodeURIComponent(p.name)}"><b>${esc(p.name)}</b></a>
      <div class="pun-item ${p.active ? "" : "off"}" data-pt="${p.type}" style="border:0;padding-top:4px"><span class="bar"></span><div class="desc"><div class="row" style="gap:6px">${ptTag(p.type, !!p.active)}<span class="mono dim" style="font-size:12px">#${p.id}</span></div><p>${esc(p.reason)}</p><small>${esc(p.staff_name)} · ${date(p.created_at)}${p.type !== "kick" ? " · " + (p.active ? t("pl.remaining") + " " + remaining(p.expires_at) : t("pl.expired")) : ""}</small></div></div></div></div>`).join("");
    $("#list").innerHTML = (append ? $("#list").innerHTML : "") + (html || (append ? "" : `<div class="empty">${t("bans.empty")}</div>`));
    $("#more").hidden = d.punishments.length < 30; observe();
  }
  document.addEventListener("app:ready", () => {
    load();
    $("#types").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (!b) return; type = b.dataset.t; page = 1; App.sfx("switch"); load(); });
    $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { q = $("#q").value.trim(); page = 1; load(); }, 250); });
    $("#more").addEventListener("click", () => { page++; load(true); });
  });
  document.addEventListener("langchange", () => { page = 1; load(); });
})();
