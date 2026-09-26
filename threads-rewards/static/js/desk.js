/* 客服工作台：獨立分頁、全螢幕處理客服單（清單 + 對話） */
(() => {
  const { $, $$, esc, t, api, ago, sfx, date } = App;
  const FILTERS = ["active", "open", "answered", "mine", "closed"];
  let filter = App.store.get("dk.filter", "active"); let q = ""; let list = []; let selected = 0; let view = null; let known = null; let timer;

  function empty() {
    $("#dk-view").innerHTML = `<div class="desk-empty">${ART.icon("message", 44)}<b>${t("dk.pick")}</b><small>${t("dk.pickHint")}</small></div>`;
  }
  function itemHTML(x) {
    return `<button class="dk-item ${x.id === selected ? "on" : ""} ${x.unread ? "unread" : ""}" data-id="${x.id}" data-cat="${x.category}">
      <img src="${esc(x.user.avatar)}" alt="">
      <span class="dk-mid"><span class="dk-top"><b>${esc(x.subject)}</b><small>${ago(x.updated_at)}</small></span>
        <span class="dk-last"><b>${esc(x.user.name)}</b>：${esc(x.last_body || "")}</span>
        <span class="dk-bot"><span class="dk-cat">${ART.icon(App.TicketView.CAT_ICON[x.category], 13)}${t("cat." + x.category)}</span><span class="mono">#${x.id}</span>
          ${x.priority && x.priority !== "normal" ? `<span class="tag ${x.priority === "urgent" ? "red" : x.priority === "high" ? "warn" : "gray"}">${t("pr." + x.priority)}</span>` : ""}
          <span class="dk-st ${x.status}">${t("st." + x.status)}</span></span></span>
      ${x.unread ? `<i class="dk-badge">${x.unread}</i>` : ""}</button>`;
  }
  async function load() {
    const status = filter === "mine" ? "active" : filter;
    const d = await api(`/api/staff/tickets?status=${status}&q=${encodeURIComponent(q)}${filter === "mine" ? "&mine=1" : ""}`, { quiet: true });
    list = d.tickets; const c = d.counts;
    // 新進客服單：音效 + 標題計數
    const ids = new Set(list.map((x) => x.id));
    if (known && [...ids].some((id) => !known.has(id))) sfx("receive");
    known = ids;
    const unread = list.reduce((a, x) => a + (x.unread ? 1 : 0), 0);
    document.title = (unread ? `(${unread}) ` : "") + t("dk.title") + " · 鋸齒 SMP";
    $("#dk-stats").innerHTML = [["st.open", c.open || 0, "open"], ["st.answered", c.answered || 0, "answered"], ["dk.unread", unread, "unread"]]
      .map(([k, n, cls]) => `<span class="dk-stat ${cls}"><b>${n}</b>${t(k)}</span>`).join("");
    $("#dk-f").innerHTML = FILTERS.map((f) => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${t("dk.f." + f)}</button>`).join("");
    $("#dk-items").innerHTML = list.map(itemHTML).join("") || `<div class="desk-none">${t("sup.empty")}</div>`;
  }
  function open(id, { push = true } = {}) {
    if (!id) { selected = 0; view && view.destroy(); view = null; empty(); return; }
    selected = id; if (push) history.replaceState(null, "", `#${id}`);
    $$("#dk-items .dk-item").forEach((x) => x.classList.toggle("on", +x.dataset.id === id));
    view && view.destroy();
    view = App.TicketView.mount($("#dk-view"), id, { desk: true, height: "100%", onChange: () => load().catch(() => {}), onDelete: () => { open(0); load(); } });
    $(`#dk-items .dk-item[data-id="${id}"]`)?.classList.remove("unread");
  }
  function step(dir) {
    const i = list.findIndex((x) => x.id === selected);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + dir))];
    if (next && next.id !== selected) { sfx("tick"); open(next.id); $(`#dk-items .dk-item[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" }); }
  }

  async function notifyButton() {
    const b = $("#dk-notify"); const P = window.PushNotify; const st = await P.state();
    b.className = "btn sm dk-nt " + st;
    b.innerHTML = `${ART.icon("bell", 15)}<span>${t("nt.st." + st)}</span>`;
    b.title = t("nt.desc");
  }
  async function allLogs() {
    const d = await api("/api/staff/ticket-logs");
    const o = App.modal({ wide: true, title: `${ART.icon("history", 18)} ${t("dk.logs")}`, body: `
      <input class="input" id="lq" placeholder="${t("staff.searchT")}" style="margin-bottom:10px">
      <div class="dk-logs" id="ll">${d.logs.map((l) => `<button class="dk-log" data-t="${l.id}" data-ticket="${l.ticket_id}">
        <span class="mono">#${l.ticket_id}</span><b>${esc(l.subject)}</b><small>${esc(l.owner_name || "")}</small>
        <span class="dim">${esc(l.reason || "—")}</span><small class="dim">${esc(l.closed_by_name || "")} · ${date(l.created_at)}</small></button>`).join("") || `<div class="empty">${t("dk.noLogs")}</div>`}</div>` });
    o.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      o.close(true); open(+b.dataset.ticket);
      const tryOpen = (n = 0) => { const v = $("#dk-view")._tv; if (v && v.staff !== undefined && v.staff) v.showLogs(+b.dataset.t); else if (n < 30) setTimeout(() => tryOpen(n + 1), 150); };
      tryOpen();
    });
    $("#lq", o.el).addEventListener("input", (e) => { const s = e.target.value.trim().toLowerCase(); $$(".dk-log", o.el).forEach((x) => { x.hidden = s && !x.textContent.toLowerCase().includes(s); }); });
  }

  // 清單右鍵：開啟、新分頁、已讀 / 未讀、關閉
  if (!App._dkCtx) App._dkCtx = true, App.ctxProviders.push((target) => {
    const it = target.closest(".dk-item[data-id]"); if (!it || !document.querySelector(".desk")) return null;
    const id = +it.dataset.id;
    const read = async (unread) => { await api(`/api/tickets/${id}/read`, { method: "POST", body: { unread } }); sfx("tick"); load(); };
    return [{ head: `#${id}` }, { icon: "message", label: t("dk.open"), act: () => open(id) },
      { icon: "external", label: t("ctx.openLink"), act: () => window.open(`/desk#${id}`, "_blank") },
      { icon: "check", label: t("tk.markRead"), act: () => read(false) }, { icon: "eye", label: t("tk.markUnread"), act: () => read(true) },
      { icon: "link", label: t("ctx.copyLink"), act: () => App.copy(`${location.origin}/ticket?id=${id}`) },
      { sep: true }, { icon: "x", label: t("tk.closeBtn"), danger: true, act: () => { open(id); const go = (n = 0) => { const v = $("#dk-view")._tv; if (v && v.staff) v.closeDialog(); else if (n < 30) setTimeout(() => go(n + 1), 150); }; go(); } }];
  });

  document.addEventListener("app:ready", async () => {
    if (!App.me) return App.go("/login?next=/desk");
    if ((App.me.level || 0) < 1) { $("#dk-view").innerHTML = `<div class="desk-empty">${t("adm.noAccess")}</div>`; return; }
    $("#dk-logs").innerHTML = `${ART.icon("history", 15)}<span>${t("dk.logs")}</span>`;
    notifyButton(); window.PushNotify.refresh();
    empty(); await load();
    const h = +location.hash.slice(1); if (h) open(h, { push: false });
    $("#dk-f").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; filter = b.dataset.f; App.store.set("dk.filter", filter); sfx("switch"); load(); });
    $("#dk-items").addEventListener("click", (e) => { const it = e.target.closest(".dk-item"); if (it) { sfx("click"); open(+it.dataset.id); } });
    $("#dk-q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value.trim(); load(); }, 250); });
    $("#dk-logs").addEventListener("click", allLogs);
    $("#dk-notify").addEventListener("click", async () => {
      const P = window.PushNotify; const st = await P.state();
      try {
        if (st === "on") { await P.disable(); sfx("toggleOff"); }
        else if (st === "off") { await P.enable(P.kinds()); sfx("toggleOn"); App.ok(t("nt.onOk"), "", 1400); }
        else App.fail(t(st === "denied" ? "nt.deniedHelp" : "nt.unsupportedHelp"));
      } catch (err) { App.fail(err.message); }
      notifyButton();
    });
    window.addEventListener("hashchange", () => { const id = +location.hash.slice(1); if (id && id !== selected) open(id, { push: false }); });
    document.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.altKey && e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
      if (e.altKey && e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); step(-1); }
    });
    setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 6000);
  });
  document.addEventListener("langchange", () => { load(); notifyButton(); });
})();
