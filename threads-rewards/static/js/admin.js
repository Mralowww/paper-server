/* 後台：左側欄 + 各功能區（依權限等級顯示） */
(() => {
  const { $, $$, esc, t, api, fmt, date, ago, sfx, mcHead, ptTag, catTag, observe } = App;
  const SECTIONS = [
    { grp: "adm.grp.main" },
    { id: "overview", icon: "grid", min: 1 },
    { id: "players", icon: "users", min: 2 },
    { id: "punishments", icon: "ban", min: 2 },
    { id: "permissions", icon: "lock", min: 3 },
    { id: "tickets", icon: "message", min: 1 },
    { id: "links", icon: "link", min: 2 },
    { grp: "adm.grp.site" },
    { id: "news", icon: "news", min: 3 },
    { id: "rewards", icon: "trophy", min: 3 },
    { id: "site", icon: "home", min: 3 },
    { id: "apikeys", icon: "key", min: 3 },
    { id: "team", icon: "shield", min: 1 },
    { id: "activity", icon: "list", min: 3 },
    { id: "settings", icon: "settings", min: 3 },
    { id: "status", icon: "activity", min: 3 },
  ];
  let level = 0; let current = null; let cleanup = null; let openTickets = 0;
  const main = () => $("#main");
  const head = (id, extra = "") => `<div class="admin-title"><div><h2>${t("adm." + id)}</h2><p>${t("adm." + id + ".d")}</p></div><div class="row">${extra}</div></div>`;
  const lvlTags = (l) => (l >= 3 ? `<span class="lvl-tag lvl-3">${t("lv.3")}</span>` : "") + (l === 2 ? `<span class="lvl-tag lvl-2">${t("lv.2")}</span>` : "") + (l === 1 ? `<span class="lvl-tag lvl-1">${t("lv.1")}</span>` : "");

  function renderSide() {
    const me = App.me;
    $("#me-card").innerHTML = `<img src="${esc(me.avatar)}" alt=""><div style="min-width:0"><b>${esc(me.name)}</b>${lvlTags(level)}</div>`;
    $("#side").innerHTML = SECTIONS.filter((s) => s.grp || level >= s.min).map((s) => s.grp ? `<div class="grp">${t(s.grp)}</div>`
      : `<a href="#${s.id}" class="${current === s.id ? "active" : ""}">${ART.icon(s.icon, 19)}<span>${t("adm." + s.id)}</span>${s.id === "tickets" && openTickets ? `<span class="badge">${openTickets}</span>` : ""}</a>`).join("");
  }

  async function route() {
    const id = (location.hash.slice(1).split("/")[0]) || "overview";
    const sec = SECTIONS.find((s) => s.id === id && level >= s.min) || SECTIONS.find((s) => s.id && level >= s.min);
    if (cleanup) { cleanup(); cleanup = null; }
    current = sec.id; renderSide();
    main().innerHTML = `<section></section>`;
    try { const r = await VIEWS[sec.id]($("section", main())); if (typeof r === "function") cleanup = r; } catch (e) { main().innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
    observe(main());
  }

  /* ---------- 總覽 ---------- */
  async function overview(el) {
    const d = await api("/api/staff/overview");
    const tk = d.tickets; const pn = d.punishments;
    el.innerHTML = head("overview") + `
      <div class="grid grid-4">
        ${[["adm.k.open", (tk.open || 0), "message", "var(--blue)"], ["adm.k.urgent", d.urgent, "alert", "var(--red)"], ["adm.k.online", d.players.online, "users", "var(--green)"], ["adm.k.activeBans", (pn.ban || 0) + (pn.ipban || 0), "ban", "var(--red)"]]
          .map(([k, v, ic, c]) => `<div class="card hover stat reveal"><span class="label"><span style="color:${c}">${ART.icon(ic, 18)}</span>${t(k)}</span><span class="value" data-count="${v}">0</span></div>`).join("")}
      </div>
      <div class="grid grid-2 section tight">
        <div class="card reveal"><div class="card-title"><h3>${t("adm.recentTickets")}</h3><a class="right btn sm" href="#tickets">→</a></div>
          ${d.recent_tickets.map((x) => `<a class="t-row" data-cat="${x.category}" href="#tickets/${x.id}"><span class="bar"></span><div class="t-main"><b>#${x.id} ${esc(x.subject)}</b><small>${esc(x.global_name || x.username)} · ${ago(x.updated_at)}</small></div><div class="t-side">${catTag(x.category)}</div></a>`).join("") || `<div class="empty">—</div>`}</div>
        <div class="card reveal"><div class="card-title"><h3>${t("adm.recentPuns")}</h3>${level >= 2 ? `<a class="right btn sm" href="#punishments">→</a>` : ""}</div>
          ${d.recent_punishments.map((p) => `<div class="p-row" data-uuid="${p.uuid}"><img class="mc-av" src="${mcHead(p.uuid, 32)}" width="32" height="32" alt=""><div><b>${esc(p.name)}</b><small>${esc(p.reason)}</small></div><div class="row" style="gap:6px">${ptTag(p.type, !!p.active)}<small>${ago(p.created_at)}</small></div></div>`).join("") || `<div class="empty">—</div>`}</div>
      </div>
      <div class="card reveal section tight"><div class="kpi-mini">
        <div><b>${fmt(d.players.total)}</b><small>${t("staff.players")}</small></div><div><b>${fmt(d.users)}</b><small>${t("adm.k.users")}</small></div>
        <div><b>${fmt(d.linked)}</b><small>${t("adm.k.linked")}</small></div><div><b>${fmt(pn.mute || 0)}</b><small>${t("adm.k.mutes")}</small></div>
        <div><b style="color:${d.plugin_online ? "var(--green)" : "var(--red)"}">${d.plugin_online ? "ONLINE" : "OFFLINE"}</b><small>${t("adm.k.plugin")}</small></div></div></div>`;
    if (level >= 2) el.addEventListener("click", (e) => { const r = e.target.closest("[data-uuid]"); if (r) App.playerModal(r.dataset.uuid); });
  }

  /* ---------- 玩家管理 ---------- */
  async function players(el) {
    el.innerHTML = head("players", `<button class="btn gold" id="np">${ART.icon("plus", 16)}${t("pl.new")}</button>`) + `
      <div class="row" style="margin-bottom:12px"><input class="input" id="pq" placeholder="${t(level >= 3 ? "staff.searchPA" : "staff.searchP")}" style="max-width:340px"><button class="btn" id="plk">${t("staff.lookup")}</button><label class="check"><input type="checkbox" id="pon">${t("staff.onlineOnly")}</label></div>
      <div class="card" style="padding:6px 14px"><div id="pl"></div></div>`;
    let timer;
    const load = async () => {
      const d = await api(`/api/staff/players?q=${encodeURIComponent($("#pq").value.trim())}&online=${$("#pon").checked ? 1 : 0}`, { quiet: true });
      $("#pl").innerHTML = d.players.map((p, i) => `<div class="p-row" data-uuid="${p.uuid}" style="animation-delay:${Math.min(i, 20) * 20}ms"><img class="mc-av" src="${mcHead(p.uuid, 36)}" width="36" height="36" alt="">
        <div><b><i class="status-dot ${p.online ? "on" : ""}"></i>${esc(p.name)}</b><small>${p.uuid}${p.last_ip ? " · " + esc(p.last_ip) : ""}</small></div>
        <div class="row" style="gap:6px">${p.active_types.map((x) => ptTag(x)).join("")}<small class="dim">${p.last_seen ? ago(p.last_seen) : ""}</small></div></div>`).join("") || `<div class="empty">${t("noResult")}</div>`;
    };
    $("#pq").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    $("#pon").addEventListener("change", load);
    $("#plk").addEventListener("click", () => $("#pq").value.trim() && App.openPlayerByName($("#pq").value.trim()));
    $("#np").addEventListener("click", () => App.punishModal("", load));
    $("#pl").addEventListener("click", (e) => { const r = e.target.closest("[data-uuid]"); if (r) App.playerModal(r.dataset.uuid); });
    await load();
  }

  /* ---------- 處罰管理 ---------- */
  async function punishments(el) {
    el.innerHTML = head("punishments", `<button class="btn gold" id="np">${ART.icon("plus", 16)}${t("pl.new")}</button>`) + `
      <div class="grid grid-4" id="pc" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:16px"></div>
      <div class="row" style="margin-bottom:12px"><select class="enhance" id="ut"><option value="">${t("st.all")}</option>${App.PTYPES.map((p) => `<option value="${p}">${t("pt." + p)}</option>`).join("")}</select>
        <select class="enhance" id="ua"><option value="-1">${t("st.all")}</option><option value="1">${t("pl.active")}</option><option value="0">${t("pl.expired")}</option></select>
        <input class="input" id="uq" placeholder="${t("staff.searchT")}" style="max-width:260px"></div>
      <div class="card" style="padding:6px 16px"><div id="ul"></div></div>`;
    let list = []; let timer;
    const load = async () => {
      const d = await api(`/api/staff/punishments?type=${$("#ut").value}&active=${$("#ua").value}&q=${encodeURIComponent($("#uq").value.trim())}`, { quiet: true });
      list = d.punishments;
      $("#pc").innerHTML = App.PTYPES.map((p) => `<div class="card stat" data-pt="${p}" style="padding:16px"><span class="label" style="color:var(--c)">${t("pt." + p)}</span><span class="value">${d.active_counts[p] || 0}</span></div>`).join("");
      $("#ul").innerHTML = list.map((p) => `<div class="row" style="gap:10px;flex-wrap:nowrap"><img class="mc-av" src="${mcHead(p.uuid, 32)}" width="32" height="32" alt="" data-uuid="${p.uuid}" style="cursor:pointer"><div style="flex:1;min-width:0"><b data-uuid="${p.uuid}" style="cursor:pointer">${esc(p.name)}</b>${p.silent ? ` <span class="tag gray">${t("pl.silentTag")}</span>` : ""}${App.punItem(p, true)}</div></div>`).join("") || `<div class="empty">${t("bans.empty")}</div>`;
    };
    App.bindPunActions($("#ul"), () => list, load);
    $("#ul").addEventListener("click", (e) => { const r = e.target.closest("[data-uuid]"); if (r && !e.target.closest("[data-pact]")) App.playerModal(r.dataset.uuid); });
    ["#ut", "#ua"].forEach((s) => $(s).addEventListener("change", load));
    $("#uq").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    $("#np").addEventListener("click", () => App.punishModal("", load));
    await load();
  }

  /* ---------- 遊戲權限 ---------- */
  async function permissions(el) {
    let d = await api("/api/admin/permissions"); let sel = "linked"; let working = {};
    const nodesOf = (k) => working[k] || (working[k] = (d.nodes[k] || []).map((n) => ({ ...n })));
    const render = () => {
      const g = d.groups.find((x) => x.key === sel) || d.groups[0]; sel = g.key;
      const used = new Set(d.groups.map((x) => x.key));
      el.innerHTML = head("permissions", `<button class="btn gold" id="save">${t("save")}</button>`) + `<div class="perm-shell">
        <div class="card perm-groups" style="padding:14px 10px">
          <div class="eyebrow-text" style="padding:4px 14px 8px">${t("perm.web")}</div>
          ${d.groups.filter((x) => x.kind === "web").map((x) => `<a data-g="${x.key}" class="${x.key === sel ? "on" : ""}">${esc(t("perm.g." + x.key))}<span class="n">${nodesOf(x.key).length}</span></a>`).join("")}
          <div class="eyebrow-text" style="padding:14px 14px 8px">DISCORD</div>
          ${d.groups.filter((x) => x.kind === "discord").map((x) => `<a data-g="${x.key}" class="${x.key === sel ? "on" : ""}"><span class="role-dot" style="background:${x.color || "var(--text-3)"}"></span>${esc(x.name)}<span class="n">${nodesOf(x.key).length}</span></a>`).join("")}
          <select class="enhance" id="addrole" style="margin-top:10px"><option value="">＋ ${t("perm.addRole")}</option>${d.discord_roles.filter((r) => !used.has("role:" + r.id)).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}</select>
        </div>
        <div class="card" style="padding:26px">
          <div class="row" style="justify-content:space-between"><h3 style="font-size:24px;margin:0">${esc(g.kind === "web" ? t("perm.g." + g.key) : g.name)}</h3>${g.kind === "discord" ? `<button class="btn red-outline" id="rmg">${t("perm.remove")}</button>` : ""}</div>
          <p class="muted">${t("perm.hint")}</p>
          <form class="input-group" id="addn"><input class="input mono" name="n" placeholder="${t("perm.ph")}"><button class="btn gold">${t("perm.create")}</button></form>
          <div class="nodes">${nodesOf(sel).map((n, i) => `<span class="node ${n.allow ? "" : "deny"}"><button type="button" class="tg" data-i="${i}">${ART.icon(n.allow ? "check" : "x", 16, 2.4)}</button>${esc(n.node)}<button type="button" class="rm" data-rm="${i}">${ART.icon("x", 14)}</button></span>`).join("") || `<div class="dim">${t("perm.none")}</div>`}</div>
          <div style="margin-top:18px"><span class="dim" style="font-size:13px">${t("perm.quick")}：</span><div class="chips" style="margin-top:8px">${["essentials.home", "essentials.tpa", "essentials.fly", "essentials.nick", "sawsmp.chat.color"].map((q) => `<button type="button" class="chip" data-q="${q}">${q}</button>`).join("")}</div></div>
        </div></div>`;
      observe(el);
      $("#addrole").addEventListener("change", async (e) => { if (!e.target.value) return; try { const r = await api("/api/admin/permissions/groups", { method: "POST", body: { role_id: e.target.value } }); d = await api("/api/admin/permissions"); sel = r.key; render(); } catch (err) { App.fail(err.message); } });
    };
    el.addEventListener("click", async (e) => {
      const g = e.target.closest("[data-g]"); if (g) { sel = g.dataset.g; sfx("switch"); render(); return; }
      const tg = e.target.closest("[data-i]"); if (tg) { const n = nodesOf(sel)[+tg.dataset.i]; n.allow = !n.allow; sfx("tick"); render(); return; }
      const rm = e.target.closest("[data-rm]"); if (rm) { nodesOf(sel).splice(+rm.dataset.rm, 1); sfx("delete"); render(); return; }
      const q = e.target.closest("[data-q]"); if (q) { if (!nodesOf(sel).some((n) => n.node === q.dataset.q)) nodesOf(sel).push({ node: q.dataset.q, allow: true }); render(); return; }
      if (e.target.closest("#save")) { try { for (const k of Object.keys(working)) await api(`/api/admin/permissions/${k}`, { method: "PUT", body: { nodes: working[k] } }); App.ok(t("saved"), t("perm.synced")); d = await api("/api/admin/permissions"); working = {}; render(); } catch (err) { App.fail(err.message); } }
      if (e.target.closest("#rmg")) { if (!(await App.confirm(t("perm.remove") + "?", { danger: true }))) return; await api(`/api/admin/permissions/groups/${sel}`, { method: "DELETE" }); d = await api("/api/admin/permissions"); sel = "linked"; render(); }
    });
    el.addEventListener("submit", (e) => { e.preventDefault(); const v = e.target.n.value.trim(); if (!v) return; const allow = !v.startsWith("-"); const node = v.replace(/^-/, "").toLowerCase(); const list = nodesOf(sel); const ex = list.find((n) => n.node === node); if (ex) ex.allow = allow; else list.push({ node, allow }); sfx("copy"); render(); });
    render();
  }

  /* ---------- 客服單（左列表、右對話） ---------- */
  async function tickets(el) {
    let filter = "all"; let q = ""; let selected = +(location.hash.split("/")[1] || 0); let view = null; let timer;
    el.innerHTML = head("tickets", `<a class="btn gold" href="/desk" target="sawsmp-desk" id="desk-open">${ART.icon("external", 16)}${t("adm.desk")}</a><button class="btn" id="bans">${t("adm.ticketBans")}</button>`) + `<div class="tk-split">
      <div><input class="input" id="tq" placeholder="${t("staff.searchT")}"><div class="tk-filter" id="tf"></div><div id="tl"></div></div>
      <div id="tv"><div class="card empty">${t("adm.pickTicket")}</div></div></div>`;
    const load = async () => {
      const status = filter === "all" ? "all" : filter;
      const d = await api(`/api/staff/tickets?status=${status}&q=${encodeURIComponent(q)}`, { quiet: true });
      const c = d.counts; openTickets = (c.open || 0); renderSide();
      $("#tf").innerHTML = [["all", (c.open || 0) + (c.answered || 0) + (c.closed || 0)], ["open", c.open || 0], ["answered", c.answered || 0], ["closed", c.closed || 0]]
        .map(([k, n]) => `<button data-f="${k}" class="${k === filter ? "on" : ""}">${t("st." + k)} ${n}</button>`).join("");
      $("#tl").innerHTML = d.tickets.map((x) => `<div class="tk-item ${x.id === selected ? "on" : ""}" data-id="${x.id}" data-cat="${x.category}">
        <img src="${esc(x.user.avatar)}" alt=""><div style="min-width:0"><div class="top"><b>${esc(x.subject)}</b><small>${ago(x.updated_at)}</small></div>
        <div class="mid"><b style="color:var(--text)">${esc(x.user.name)}</b>：${esc(x.last_body || "")}</div>
        <div class="bot"><span style="color:var(--c)">${ART.icon(App.TicketView.CAT_ICON[x.category], 15)}</span><span class="mono">#${x.id}</span><span>${esc(x.user.name)}${x.target ? " → " + esc(x.target) : ""}</span>${x.priority === "urgent" ? `<span class="tag red pulse">${t("pr.urgent")}</span>` : x.priority === "high" ? `<span class="tag warn">${t("pr.high")}</span>` : ""}</div></div>
        ${x.unread ? `<span class="dot"></span>` : ""}</div>`).join("") || `<div class="card empty">${t("sup.empty")}</div>`;
    };
    const open = (id) => {
      selected = id; history.replaceState(null, "", `#tickets/${id}`);
      $$("#tl .tk-item").forEach((x) => x.classList.toggle("on", +x.dataset.id === id));
      view && view.destroy();
      view = App.TicketView.mount($("#tv"), id, { height: "46vh", onChange: load, onDelete: () => { selected = 0; $("#tv").innerHTML = `<div class="card empty">${t("adm.pickTicket")}</div>`; load(); } });
    };
    el.addEventListener("click", async (e) => {
      const f = e.target.closest("[data-f]"); if (f) { filter = f.dataset.f; sfx("switch"); load(); return; }
      const it = e.target.closest(".tk-item"); if (it) { sfx("click"); open(+it.dataset.id); return; }
      if (e.target.closest("#bans")) {
        const d = await api("/api/staff/ticket-bans");
        const o = App.modal({ title: t("adm.ticketBans"), body: d.users.map((u) => `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span class="row"><img src="${esc(u.avatar)}" style="width:28px;height:28px;border-radius:50%" alt="">${esc(u.name)}</span><button class="btn sm" data-unban="${u.id}">${t("tk.unban")}</button></div>`).join("") || `<div class="empty">—</div>` });
        o.el.addEventListener("click", async (ev) => { const b = ev.target.closest("[data-unban]"); if (b) { await api(`/api/staff/ticket-ban/${b.dataset.unban}`, { method: "POST", body: { banned: false } }); b.closest(".row").remove(); sfx("toggleOn"); } });
      }
    });
    $("#tq").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { q = $("#tq").value.trim(); load(); }, 250); });
    await load();
    if (selected) open(selected);
    const iv = setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 8000);
    cleanup = () => { clearInterval(iv); view && view.destroy(); };
  }

  /* ---------- 帳號綁定 ---------- */
  async function links(el) {
    el.innerHTML = head("links") + `<div class="row" style="margin-bottom:12px"><input class="input" id="lq" placeholder="${t("adm.links.search")}" style="max-width:320px"></div>
      <div class="table-wrap responsive"><table><thead><tr><th>Discord</th><th>Minecraft</th><th>${t("adm.linkedAt")}</th><th>${t("admin.role")}</th><th></th></tr></thead><tbody id="lb"></tbody></table></div>`;
    let timer;
    const load = async () => {
      const d = await api(`/api/admin/links?q=${encodeURIComponent($("#lq").value.trim())}`, { quiet: true });
      $("#lb").innerHTML = d.users.map((u) => `<tr data-uid="${u.id}" style="cursor:pointer"><td data-label="Discord"><span class="cell-user"><img src="${esc(u.avatar)}" alt="">${esc(u.name)} <span class="dim mono" style="font-size:11px">${u.id}</span></span></td>
        <td data-label="Minecraft">${u.mc_uuid ? `<span class="cell-user"><img src="${mcHead(u.mc_uuid, 24)}" alt="" style="border-radius:4px">${esc(u.mc_name)}</span>` : `<span class="dim">${t("acc.notLinked")}</span>`}</td>
        <td data-label="${t("adm.linkedAt")}" class="dim">${u.linked_at ? date(u.linked_at) : "—"}</td><td data-label="${t("admin.role")}">${lvlTags(u.level) || `<span class="dim">—</span>`}</td>
        <td data-label="">${u.mc_uuid ? `<button class="btn sm danger" data-unlink>${t("acc.unlink")}</button>` : `<button class="btn sm" data-link>${t("adm.manualLink")}</button>`}</td></tr>`).join("");
    };
    el.addEventListener("click", async (e) => {
      const tr = e.target.closest("[data-uid]"); if (!tr) return; const uid = tr.dataset.uid;
      if (e.target.closest("[data-unlink]")) { if (!(await App.confirm(t("acc.confirmUnlink"), { danger: true }))) return; await api(`/api/admin/links/${uid}`, { method: "DELETE" }); sfx("delete"); load(); return; }
      if (e.target.closest("[data-link]")) return manualLink(uid, load);
      sfx("popup"); linkModal(uid, load);
    });
    $("#lq").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    await load();
  }

  /* 帳號綁定詳細視窗（Discord / Minecraft / 相關紀錄） */
  async function linkModal(uid, reload) {
    let d; try { d = await api(`/api/admin/links/${uid}`); } catch (e) { return App.fail(e.message); }
    const u = d.user, dc = d.discord, mc = d.mc;
    const since = (iso) => iso ? `${new Date(iso).toLocaleString(App.lang === "zh" ? "zh-TW" : "en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} <span class="dim">(${ago(iso)})</span>` : "—";
    const copyBtn = (v) => `<button class="btn icon ghost sm" data-copy="${esc(v)}" title="copy">${ART.icon("copy", 15)}</button>`;
    const lvName = (l) => l >= 1 ? t("lv." + l) : t("admin.member");
    const tabDiscord = `<div class="lk-card"><img class="lk-av" src="${esc(u.avatar)}" alt="" data-zoom><div style="min-width:0">
        <h3>${esc(u.name)}</h3><div class="lk-sub mono">${esc(u.username)} · ${u.id} ${copyBtn(u.id)}</div>
        <div class="row" style="gap:8px;margin-top:10px"><span class="tag gray">${lvName(u.level)}</span>${dc.in_guild ? `<span class="tag ok live">${t("lk.inGuild")}</span>` : dc.in_guild === false ? `<span class="tag err">${t("lk.notInGuild")}</span>` : ""}${u.ticket_banned ? `<span class="tag err">${t("tk.ban")}</span>` : ""}</div></div></div>
      <div class="info-table"><div><span>${t("lk.dcCreated")}</span><b>${since(dc.created_at)}</b></div><div><span>${t("lk.joined")}</span><b>${since(dc.joined_at)}</b></div>
        <div><span>${t("lk.webLevel")}</span><b>${lvName(u.level)}</b></div><div><span>${t("lk.lastLogin")}</span><b>${since(u.last_login)}</b></div></div>
      <div class="lk-label">DISCORD ${t("lk.roles")} (${dc.roles.length}) <span class="dim">${t("lk.live")}</span></div>
      <div class="chips">${dc.roles.map((r) => `<span class="role-chip"><i style="background:${r.color || "var(--text-3)"}"></i>${esc(r.name)}</span>`).join("") || `<span class="dim">—</span>`}</div>`;
    const tabMc = !mc ? `<div class="empty">${t("acc.notLinked")}<div style="margin-top:12px"><button class="btn" data-manual>${t("adm.manualLink")}</button></div></div>` : `
      <div class="lk-card"><img class="lk-av sq" src="${mcHead(mc.uuid, 96)}" alt=""><div style="min-width:0;flex:1">
        <h3>${esc(mc.name)}</h3><div class="lk-sub mono">${mc.uuid} ${copyBtn(mc.uuid)}</div>
        <div class="row" style="gap:14px;margin-top:10px"><b>${mc.rank ? "#" + mc.rank : t("lk.unranked")}</b><span><i class="status-dot ${mc.online ? "on" : ""}"></i>${t(mc.online ? "home.online" : "home.offline")}</span></div></div>
        <a class="btn" href="/player?name=${encodeURIComponent(mc.name)}" target="_blank">${t("tk.openPlayer")} ${ART.icon("external", 15)}</a></div>
      <div class="info-table"><div><span>${t("adm.linkedAt")}</span><b>${since(mc.linked_at)}</b></div><div><span>${t("pl.firstSeen")}</span><b>${since(mc.first_seen)}</b></div>
        <div><span>${t("lk.activity")}</span><b>${mc.online ? `<span style="color:var(--green)">${t("home.online")}</span>` : since(mc.last_seen)}</b></div>
        <div><span>${t("lk.stats")}</span><b>${mc.stats ? `${mc.stats.kills} ${t("pp.kills")} · ${mc.stats.deaths} ${t("pp.deaths")} · ${mc.stats.matches} ${t("pp.duels")}` : `0 ${t("pp.kills")} · 0 ${t("pp.deaths")} · 0 ${t("pp.duels")}`}</b></div></div>
      <div class="lk-label">${t("lk.names")}</div>
      <div class="chips">${mc.names.map((n) => `<span class="role-chip">${esc(n.name)} <span class="dim">${date(n.first_seen, false)}</span></span>`).join("") || `<span class="role-chip">${esc(mc.name)}</span>`}</div>`;
    const tabRel = `<div class="lk-label" style="margin-top:0">${t("sup.mine")} (${d.tickets.length})</div>
      ${d.tickets.map((x) => `<a class="t-row" data-cat="${x.category}" href="/admin#tickets/${x.id}"><span class="bar"></span><div class="t-main"><b>#${x.id} ${esc(x.subject)}</b><small>${date(x.created_at)}</small></div><div class="t-side">${catTag(x.category)}<span class="tag">${t("st." + x.status)}</span></div></a>`).join("") || `<div class="dim">—</div>`}
      <div class="lk-label">${t("pp.history")} (${d.punishments.length})</div>
      ${d.punishments.map((p) => App.punItem(p, false)).join("") || `<div class="dim">—</div>`}
      <div class="lk-label">${t("staff.tab.audit")}</div>
      ${d.audit.map((a) => `<div class="row" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13.5px"><span><b>${esc(a.action)}</b> <span class="muted">${esc(a.detail)}</span></span><span class="dim">${ago(a.created_at)}</span></div>`).join("") || `<div class="dim">—</div>`}`;
    const o = App.modal({ wide: true, title: `<span class="row" style="gap:14px;flex-wrap:nowrap"><img src="${esc(u.avatar)}" class="lk-av sm" alt=""><span style="min-width:0"><span class="eyebrow-text" style="color:var(--accent);display:block">${t("adm.links")}</span><span class="lk-title">${esc(u.name)} <span class="dim">↔</span> ${mc ? esc(mc.name) : `<span class="dim">${t("acc.notLinked")}</span>`}</span></span></span>`,
      body: `<div class="lk-tabs"><button data-lt="dc" class="on">Discord</button><button data-lt="mc">Minecraft</button><button data-lt="rel">${t("lk.related")}</button><i class="lk-ind"></i></div>
        <div data-lp="dc" class="tab-panel">${tabDiscord}</div><div data-lp="mc" hidden>${tabMc}</div><div data-lp="rel" hidden>${tabRel}</div>` });
    const modal = $(".modal", o.el); modal.classList.add("lk-modal");
    if (mc) $(".modal-head .btn", o.el).insertAdjacentHTML("beforebegin", `<button class="btn red-outline" data-unlink style="margin-left:auto">${t("acc.unlink")}</button>`);
    const ind = $(".lk-ind", o.el);
    const show = (b) => { $$(".lk-tabs button", o.el).forEach((x) => x.classList.toggle("on", x === b)); ind.style.left = b.offsetLeft + "px"; ind.style.width = b.offsetWidth + "px";
      $$("[data-lp]", o.el).forEach((p) => { const on = p.dataset.lp === b.dataset.lt; p.hidden = !on; if (on) { p.classList.remove("tab-panel"); void p.offsetWidth; p.classList.add("tab-panel"); } }); };
    requestAnimationFrame(() => show($(".lk-tabs button", o.el)));
    o.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-lt]"); if (b) { sfx("switch"); show(b); return; }
      const c = e.target.closest("[data-copy]"); if (c) { App.copy(c.dataset.copy); return; }
      if (e.target.closest("[data-unlink]")) { if (!(await App.confirm(t("acc.confirmUnlink"), { danger: true }))) return; await api(`/api/admin/links/${uid}`, { method: "DELETE" }); sfx("delete"); o.close(true); reload && reload(); }
      if (e.target.closest("[data-manual]")) { o.close(true); manualLink(uid, reload); }
    });
  }
  function manualLink(uid, reload) {
    const o = App.modal({ title: t("adm.manualLink"), body: `<form id="mlf"><div class="field"><label>${t("pl.mcName")}</label><input class="input mono" name="p" required></div></form>`, foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn gold" form="mlf">${t("save")}</button>` });
    $("#mlf", o.el).addEventListener("submit", async (ev) => { ev.preventDefault(); try { await api("/api/admin/links", { method: "POST", body: { user_id: uid, player: ev.target.p.value.trim() } }); o.close(true); App.ok(t("acc.linkedOk")); reload && reload(); } catch (err) { App.fail(err.message); } });
  }

  /* ---------- 公告 ---------- */
  async function news(el) {
    const TAGS = ["news", "update", "event", "maintenance"];
    el.innerHTML = head("news", `<button class="btn gold" id="nn">${ART.icon("plus", 16)}${t("admin.newNews")}</button>`) + `<div class="card"><div id="nl"></div></div>`;
    let list = [];
    const load = async () => { list = (await api("/api/news?limit=100", { quiet: true })).news; $("#nl").innerHTML = list.map((n) => `<div class="t-row" style="grid-template-columns:minmax(0,1fr) auto;padding-left:6px" data-n="${n.id}"><div class="t-main"><b>${n.pinned ? ART.icon("pin", 13) + " " : ""}${esc(n.title)}</b><small>${t("tag." + n.tag)} · ${date(n.created_at)}</small></div><div class="row" style="gap:6px"><button class="btn sm" data-e>${t("edit")}</button><button class="btn sm icon danger" data-d>✕</button></div></div>`).join("") || `<div class="empty">${t("home.noNews")}</div>`; };
    const editor = (n) => {
      const o = App.modal({ title: esc(t(n ? "admin.editNews" : "admin.newNews")), body: `<form id="nf" class="stack" style="gap:12px"><div class="field"><label>${t("admin.newsTitle")}</label><input class="input" name="title" required value="${esc(n ? n.title : "")}"></div>
        <div class="field"><label>${t("admin.newsTag")}</label><select class="enhance" name="tag">${TAGS.map((g) => `<option value="${g}" ${n && n.tag === g ? "selected" : ""}>${t("tag." + g)}</option>`).join("")}</select></div>
        <div class="field"><label>${t("admin.newsBody")}</label><textarea class="input" name="body" rows="8" required>${esc(n ? n.body : "")}</textarea></div><label class="check"><input type="checkbox" name="pinned" ${n && n.pinned ? "checked" : ""}>${t("admin.pin")}</label></form>`,
        foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn gold" form="nf">${t("save")}</button>` });
      $("#nf", o.el).addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { await api(n ? `/api/admin/news/${n.id}` : "/api/admin/news", { method: n ? "PUT" : "POST", body: { title: f.title.value, body: f.body.value, tag: f.tag.value, pinned: f.pinned.checked } }); o.close(true); App.ok(t("saved")); load(); } catch (err) { App.fail(err.message); } });
    };
    el.addEventListener("click", async (e) => {
      if (e.target.closest("#nn")) return editor(null);
      const r = e.target.closest("[data-n]"); if (!r) return; const n = list.find((x) => String(x.id) === r.dataset.n);
      if (e.target.closest("[data-e]")) editor(n);
      if (e.target.closest("[data-d]") && (await App.confirm(t("admin.confirmDeleteNews"), { danger: true }))) { await api(`/api/admin/news/${n.id}`, { method: "DELETE" }); sfx("delete"); load(); }
    });
    await load();
  }

  /* ---------- 設定型表單共用 ---------- */
  async function settingsForm(el, id, fields) {
    const d = await api("/api/admin/overview");
    const s = d.settings;
    el.innerHTML = head(id) + `<form class="grid grid-2" id="sf">${fields.map((grp) => `<div class="card"><div class="card-title"><h3>${t(grp.title)}</h3></div>${grp.hint ? `<p class="dim" style="font-size:13px;margin-top:-6px">${t(grp.hint)}</p>` : ""}<div class="stack" style="gap:14px">
      ${grp.items.map(([k, label, type]) => type === "textarea" ? `<div class="field"><label>${t(label)}</label><textarea class="input ${k.includes("tiers") ? "mono" : ""}" name="${k}" rows="6">${esc(s[k] || "")}</textarea></div>`
        : type === "role" || type === "channel" ? `<div class="field"><label>${t(label)}</label><input class="input mono" name="${k}" value="${esc(s[k] || "")}" placeholder="${type === "role" ? t("set.roleId") : t("set.channelId")}"></div>`
        : type === "weekday" ? `<div class="field"><label>${t(label)}</label><select class="enhance" name="${k}">${Array.from({ length: 7 }, (_, i) => `<option value="${i}" ${String(s[k]) === String(i) ? "selected" : ""}>${t("wd." + i)}</option>`).join("")}</select></div>`
        : type === "hour" ? `<div class="field"><label>${t(label)}</label><select class="enhance" name="${k}">${Array.from({ length: 24 }, (_, i) => `<option value="${i}" ${String(s[k]) === String(i) ? "selected" : ""}>${String(i).padStart(2, "0")}:00</option>`).join("")}</select></div>`
        : `<div class="field"><label>${t(label)}</label><input class="input ${type === "num" ? "mono" : ""}" ${type === "num" ? 'type="number" step="0.01" min="0"' : ""} name="${k}" value="${esc(s[k] || "")}"></div>`).join("")}
      </div></div>`).join("")}<div style="grid-column:1/-1;display:flex;justify-content:flex-end"><button class="btn gold lg">${t("save")}</button></div></form>`;
    $("#sf").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("/api/admin/settings", { method: "PUT", body: Object.fromEntries(new FormData(e.target).entries()) }); App.ok(t("saved")); } catch (err) { App.fail(err.message); } });
    return d;
  }

  const site = (el) => settingsForm(el, "site", [
    { title: "admin.server", items: [["server_address", "admin.address"], ["discord_invite", "admin.invite"], ["announcement", "admin.announce", "textarea"]] },
    { title: "admin.rulesEdit", hint: "admin.rulesHint", items: [["rules", "admin.rulesEdit", "textarea"]] },
  ]);
  const settings = (el) => settingsForm(el, "settings", [
    { title: "set.discord", hint: "set.discord.d", items: [["ticket_channel_id", "set.ticketCh", "channel"], ["punish_log_channel_id", "set.punCh", "channel"], ["announce_channel_id", "set.annCh", "channel"], ["discord_ban_role", "set.banRole", "role"], ["discord_mute_role", "set.muteRole", "role"], ["discord_linked_role", "set.linkedRole", "role"]] },
    { title: "set.punish", items: [["reason_presets", "set.reasons", "textarea"], ["warn_threshold", "set.warnN", "num"], ["warn_ban_hours", "set.warnH", "num"]] },
    { title: "set.support", items: [["canned_replies", "set.canned", "textarea"], ["violation_types", "set.violations", "textarea"]] },
    { title: "set.ranks", hint: "set.ranks.d", items: [["rank_tiers", "set.tiers", "textarea"]] },
    { title: "set.match", items: [["match_enabled", "set.matchOn"], ["match_time_limit", "set.matchLimit", "num"]] },
  ]);

  /* ---------- Threads 獎勵 ---------- */
  async function rewards(el) {
    let offset = 0;
    const load = async () => {
      const d = await api(`/api/admin/overview?week_offset=${offset}`, { quiet: true });
      el.innerHTML = head("rewards", `<select class="enhance" id="wk">${Array.from({ length: 8 }, (_, i) => `<option value="${-i}" ${-i === offset ? "selected" : ""}>${i === 0 ? t("admin.thisWeek") : i === 1 ? t("admin.lastWeek") : t("admin.weeksAgo", { n: i })}</option>`).join("")}</select>
        <button class="btn" id="rf">${ART.icon("refresh", 16)}${t("admin.refreshAll")}</button><button class="btn gold" id="st">${t("admin.settle")}</button>`) + `
        ${d.settled_at ? `<div class="tag ok" style="margin-bottom:12px">✓ ${t("admin.settled")} ${date(d.settled_at)}</div>` : ""}
        <div class="card" style="margin-bottom:16px"><div class="card-title"><h3>${t("admin.tab.board")}</h3></div><div class="board">${d.leaderboard.map((r, i) => `<div class="board-row"><span class="rk ${i < 3 ? "r" + (i + 1) : ""}">${i + 1}</span><img src="${esc(r.avatar)}" alt=""><div class="who"><b>${esc(r.name)}</b><div class="metrics">${App.metricsHTML(r)}</div></div><div class="pts">${fmt(r.score)}<small>${r.link_count} ${t("m.links")}</small></div></div>`).join("") || `<div class="empty">—</div>`}</div></div>
        <div class="table-wrap responsive"><table><thead><tr><th>${t("admin.user")}</th><th>${t("admin.link")}</th><th>${t("m.likes")}</th><th>${t("m.views")}</th><th>${t("m.score")}</th><th></th></tr></thead><tbody>
        ${d.links.map((l) => `<tr data-l="${l.id}"><td data-label="${t("admin.user")}"><span class="cell-user"><img src="${esc(l.user.avatar)}" alt="">${esc(l.user.name)}</span></td><td data-label="${t("admin.link")}" class="wrap"><a href="${esc(l.url)}" target="_blank" rel="noopener" class="mono">@${esc(l.author)}/${esc(l.code)}</a>${l.last_error ? `<div class="tag warn" style="white-space:normal">${esc(l.last_error.slice(0, 60))}</div>` : ""}</td>
          <td data-label="${t("m.likes")}" class="mono">${fmt(l.likes)}</td><td data-label="${t("m.views")}"><input class="input inline-num" type="number" min="0" value="${l.views}" data-views></td><td data-label="${t("m.score")}" class="mono">${fmt(l.score)}</td>
          <td data-label=""><div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-a="${l.status === "rejected" ? "approve" : "reject"}">${t(l.status === "rejected" ? "admin.approve" : "admin.reject")}</button><button class="btn sm icon danger" data-a="del">✕</button></div></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">—</div></td></tr>`}
        </tbody></table></div>
        <div id="rw" class="section tight"></div>`;
      observe(el);
      $("#wk").addEventListener("change", (e) => { offset = +e.target.value; load(); });
      await settingsForm($("#rw"), "rewardsSettings", [
        { title: "admin.weights", hint: "admin.weightsSub", items: [["w_likes", "m.likes", "num"], ["w_replies", "m.replies", "num"], ["w_reposts", "m.reposts", "num"], ["w_views", "m.views", "num"], ["settle_weekday", "admin.weekday", "weekday"], ["settle_hour", "admin.hour", "hour"]] },
        { title: "admin.rewards", items: [["reward_1", "admin.reward1"], ["reward_2", "admin.reward2"], ["reward_3", "admin.reward3"]] },
      ]);
      $("#rw .admin-title").remove();
    };
    el.addEventListener("click", async (e) => {
      if (e.target.closest("#rf")) { await api("/api/admin/refresh-all", { method: "POST" }); App.ok(t("ok"), t("loading"), 1400); setTimeout(load, 6000); return; }
      if (e.target.closest("#st")) { if (!(await App.confirm(t("admin.confirmSettle")))) return; const r = await api("/api/admin/settle", { method: "POST", body: { week_offset: offset } }); App.ok(t("admin.settled"), r.winners.map((w) => `#${w.rank ?? ""} ${w.name}`).join(" · ") || "—"); App.confetti(100); load(); return; }
      const b = e.target.closest("[data-a]"); if (!b) return; const id = b.closest("[data-l]").dataset.l;
      try {
        if (b.dataset.a === "del") { if (!(await App.confirm(t("links.confirmDelete"), { danger: true }))) return; await api(`/api/admin/links/${id}`, { method: "DELETE" }); }
        else await api(`/api/admin/links/${id}`, { method: "PATCH", body: { status: b.dataset.a === "reject" ? "rejected" : "active" } });
        sfx("switch"); load();
      } catch (err) { App.fail(err.message); }
    });
    el.addEventListener("change", async (e) => { if (e.target.matches("[data-views]")) { await api(`/api/admin/links/${e.target.closest("[data-l]").dataset.l}`, { method: "PATCH", body: { views: +e.target.value } }); sfx("copy"); } });
    await load();
  }

  /* ---------- API Keys（插件金鑰） ---------- */
  async function apikeys(el) {
    const d = await api("/api/admin/overview");
    const key = d.settings.plugin_api_key || "";
    el.innerHTML = head("apikeys") + `<div class="grid grid-2">
      <div class="card"><div class="card-title"><h3>${t("key.plugin")}</h3></div><p class="dim" style="font-size:13.5px;margin-top:-6px">${t("key.plugin.d")}</p>
        <div class="input-group"><input class="input mono" id="pk" value="${esc(key)}" readonly type="password" placeholder="${t("key.none")}"><button class="btn icon" id="pkv" title="show">${ART.icon("eye", 16)}</button><button class="btn icon" id="pkc">${ART.icon("copy", 16)}</button></div>
        <button class="btn danger" id="pkr" style="margin-top:12px">${t("key.regen")}</button></div>
      <div class="card"><div class="card-title"><h3>${t("key.dev")}</h3></div><p class="dim" style="font-size:13.5px;margin-top:-6px">${t("key.dev.d")}</p>
        <div class="row"><a class="btn" href="/account#dev">${t("acc.devKeys")}</a><a class="btn" href="/docs">${ART.icon("code", 16)}${t("nav.docs")}</a></div></div></div>`;
    el.addEventListener("click", async (e) => {
      if (e.target.closest("#pkv")) { const i = $("#pk"); i.type = i.type === "password" ? "text" : "password"; }
      if (e.target.closest("#pkc") && $("#pk").value) App.copy($("#pk").value);
      if (e.target.closest("#pkr")) { if (key && !(await App.confirm(t("key.regenConfirm"), { danger: true }))) return; const r = await api("/api/admin/plugin-key", { method: "POST" }); $("#pk").value = r.key; $("#pk").type = "text"; App.ok(t("saved"), t("key.regenDone")); }
    });
  }

  /* ---------- 團隊 ---------- */
  async function team(el) {
    const d = await api("/api/admin/team");
    el.innerHTML = head("team") + `<div class="grid grid-3">${d.team.map((u) => `<div class="card hover reveal"><div class="row" style="gap:12px;flex-wrap:nowrap"><img src="${esc(u.avatar)}" style="width:48px;height:48px;border-radius:50%" alt=""><div style="min-width:0"><b>${esc(u.name)}</b><div>${lvlTags(u.level)}</div></div></div>
      <div class="kpi-mini" style="margin-top:16px"><div><b>${u.replies}</b><small>${t("team.replies")}</small></div><div><b>${u.punishments}</b><small>${t("team.puns")}</small></div></div>
      <small class="dim">${u.mc_name ? ART.icon("pickaxe", 12) + " " + esc(u.mc_name) + " · " : ""}${u.last_login ? ago(u.last_login) : ""}</small></div>`).join("") || `<div class="card empty" style="grid-column:1/-1">${t("team.empty")}</div>`}</div>
      <p class="dim" style="margin-top:18px;font-size:13px">${t("team.hint")}</p>`;
  }

  /* ---------- 網站狀態 / 儲存空間 ---------- */
  async function status(el) {
    const d = await api("/api/admin/status");
    const mb = (b) => (b / 1048576).toFixed(2) + " MB";
    const up = `${Math.floor(d.uptime / 86400)}d ${Math.floor((d.uptime % 86400) / 3600)}h ${Math.floor((d.uptime % 3600) / 60)}m`;
    const lamp = (on, txt) => `<span class="lamp ${on ? "on" : "off"}"></span><b>${txt}</b>`;
    el.innerHTML = head("status", `<button class="btn" id="rl">${ART.icon("refresh", 16)}</button>`) + `<div class="status-grid">
      <div class="card status-card">${lamp(true, t("st.web"))}<small class="dim">${up}</small></div>
      <div class="card status-card">${lamp(d.bot.ready, "Discord Bot")}<small class="dim">${d.bot.ready ? esc(d.bot.name) + " · " + d.bot.latency_ms + "ms" : d.bot.configured ? t("st.connecting") : t("st.notSet")}</small></div>
      <div class="card status-card">${lamp(d.oauth, "Discord OAuth")}<small class="dim">${d.oauth ? "OK" : t("st.notSet")}</small></div>
      <div class="card status-card">${lamp(d.plugin.online, t("adm.k.plugin"))}<small class="dim">${d.plugin.configured ? (d.plugin.last_seen != null ? ago(new Date(Date.now() - d.plugin.last_seen * 1000).toISOString()) : t("st.never")) : t("st.notSet")} · ${t("staff.pending")} ${d.plugin.pending}</small></div>
    </div>
    <div class="grid grid-2 section tight">
      <div class="card"><div class="card-title"><h3>${ART.icon("database", 18)} ${t("st.storage")}</h3></div>
        <div class="kv-grid" style="margin-top:0"><div class="kv"><span>${t("st.db")}</span><b>${mb(d.db_bytes)}</b></div><div class="kv"><span>${t("st.uploads")}</span><b>${mb(d.uploads_bytes)} · ${d.uploads_count}</b></div></div>
        <button class="btn" id="cu" style="margin-top:14px">${t("st.cleanup")}</button></div>
      <div class="card"><div class="card-title"><h3>${t("st.counts")}</h3></div><div class="kv-grid" style="margin-top:0">${Object.entries(d.counts).map(([k, v]) => `<div class="kv"><span>${k}</span><b>${fmt(v)}</b></div>`).join("")}</div></div>
    </div>`;
    el.addEventListener("click", async (e) => {
      if (e.target.closest("#rl")) route();
      if (e.target.closest("#cu")) { const r = await api("/api/admin/uploads/cleanup", { method: "POST" }); App.ok(t("ok"), t("st.cleaned", { n: r.removed })); }
    });
  }

  const activity = (el) => window.ActivityLog.render(el, (extra) => head("activity", extra));
  const VIEWS = { activity, overview, players, punishments, permissions, tickets, links, news, rewards, site, apikeys, team, settings, status };

  document.addEventListener("app:ready", async () => {
    if (!App.me) return App.go("/login");
    level = App.me.level || 0;
    if (level < 1) { main().innerHTML = `<div class="card empty">${t("adm.noAccess")}</div>`; $("#me-card").innerHTML = ""; return; }
    window.addEventListener("hashchange", () => { if (!(current === "tickets" && location.hash.startsWith("#tickets/"))) { sfx("switch"); route(); } });
    await route();
    try { const d = await api("/api/staff/tickets?status=open", { quiet: true }); openTickets = d.counts.open || 0; renderSide(); } catch { /* 略過 */ }
  });
  document.addEventListener("langchange", () => level && route());
})();
