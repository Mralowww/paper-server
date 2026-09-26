/* 後台：操作紀錄（登入、所有修改、前後差異、請求中繼資料） */
(() => {
  const { $, $$, esc, t, api, fmt, ago, sfx } = App;
  const CATS = ["all", "auth", "admin", "punish", "ticket", "account", "game", "other"];
  const CAT_ICON = { auth: "login", admin: "settings", punish: "ban", ticket: "message", account: "user", game: "pickaxe", other: "dots" };
  const ROUTES = {
    "POST /api/tickets": "act.r.ticketNew", "POST /api/tickets/{ticket_id}/messages": "act.r.ticketReply",
    "POST /api/upload": "act.r.upload", "POST /api/match/queue": "act.r.queueJoin", "DELETE /api/match/queue": "act.r.queueLeave",
    "POST /api/my/links": "act.r.linkSubmit", "DELETE /api/my/links/{link_id}": "act.r.linkDelete", "POST /api/my/links/{link_id}/refresh": "act.r.linkRefresh",
    "POST /api/account/link-code": "act.r.linkCode", "POST /api/me/keys": "act.r.keyCreate", "DELETE /api/me/keys/{key_id}": "act.r.keyDelete",
    "POST /api/staff/players/lookup": "act.r.lookup", "POST /api/admin/refresh-all": "act.r.refreshAll", "POST /api/admin/links/{link_id}/refresh": "act.r.linkRefresh",
    "POST /api/staff/punishments": "act.r.punish", "POST /api/plugin/login": "act.r.pluginLogin", "POST /auth/logout": "act.r.logout",
  };
  const label = (r) => {
    if (r.action === "request") { const k = ROUTES[`${r.method} ${r.route}`]; return k ? t(k) : `${r.method} ${r.route || r.path}`; }
    const k = "act." + r.action; const v = t(k);
    if (v !== k) return v;
    const m = r.action.match(/^(punish|revoke)\.(\w+)$/);
    return m ? t("act." + m[1], { type: t("pt." + m[2]) }) : r.action;
  };
  const time = (iso) => new Date(iso).toLocaleTimeString(App.lang === "zh" ? "zh-TW" : "en-US", { hour12: false });
  const day = (iso) => new Date(iso).toLocaleDateString(App.lang === "zh" ? "zh-TW" : "en-US", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const full = (iso) => new Date(iso).toLocaleString(App.lang === "zh" ? "zh-TW" : "en-US", { hour12: false });
  function ua(s) {
    if (!s) return { browser: "—", os: "—", device: "—" };
    const b = /Discord/i.test(s) ? "Discord" : /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox"
      : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : /curl|python|Java|okhttp|httpx/i.test(s) ? s.split(/[\s/]/)[0] : "—";
    const v = (s.match(/(?:Edg|OPR|Firefox|Chrome|Version)\/([\d]+)/) || [])[1];
    const os = /Windows NT 10/.test(s) ? "Windows 10/11" : /Windows/.test(s) ? "Windows" : /iPhone|iPad/.test(s) ? "iOS" : /Mac OS X/.test(s) ? "macOS"
      : /Android/.test(s) ? "Android" : /Linux/.test(s) ? "Linux" : "—";
    return { browser: v && b !== "—" ? `${b} ${v}` : b, os, device: /Mobi|iPhone|Android/.test(s) ? t("act.mobile") : /iPad|Tablet/.test(s) ? t("act.tablet") : t("act.desktop") };
  }
  const statusTag = (s) => s == null ? "" : `<span class="al-st ${s >= 500 ? "bad" : s >= 400 ? "warn" : "ok"}">${s}</span>`;
  const catDot = (c) => `<span class="al-cat" data-c="${c || "other"}">${ART.icon(CAT_ICON[c] || "dots", 14)}</span>`;
  const initial = (n) => esc((n || "?").trim().slice(0, 1).toUpperCase());

  function render(el, headHTML) {
    const f = { q: "", category: "", status: "", since: "", until: "", actor: "", ip: "", action: "", actorName: "" };
    let rows = []; let more = false; let loading = false; let auto = App.store.get("act.auto", true); let timer; let lastDay = "";
    el.innerHTML = headHTML(`<label class="al-auto" title="${t("act.auto")}"><span class="switch sm"><input type="checkbox" id="al-auto" ${auto ? "checked" : ""}><span></span></span><span>${t("act.live")}</span><i class="al-live ${auto ? "on" : ""}"></i></label>
      <a class="btn" id="al-csv" href="#">${ART.icon("download", 16)}<span>CSV</span></a>`) + `
      <div class="grid grid-4 al-stats" id="al-stats"></div>
      <div class="card al-filters">
        <div class="al-frow">
          <div class="input-icon">${ART.icon("search", 16)}<input class="input" id="al-q" placeholder="${t("act.search")}"></div>
          <select class="enhance" id="al-status"><option value="">${t("act.st.all")}</option><option value="ok">${t("act.st.ok")}</option><option value="error">${t("act.st.error")}</option></select>
          <input class="input" type="date" id="al-since" title="${t("act.since")}"><input class="input" type="date" id="al-until" title="${t("act.until")}">
        </div>
        <div class="al-cats" id="al-cats"></div>
        <div class="al-chips" id="al-chips"></div>
      </div>
      <div class="al-list" id="al-list"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>
      <div class="al-more" id="al-more"></div>`;
    App.enhanceSelects && App.enhanceSelects(el);

    const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...f, actorName: "", ...extra, since: f.since && f.since + "T00:00:00", until: f.until && f.until + "T23:59:59" }).filter(([k, v]) => v && k !== "actorName")).toString();
    function drawCats(counts) {
      if (!counts) return;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      $("#al-cats", el).innerHTML = CATS.map((c) => { const n = c === "all" ? total : counts[c] || 0; const on = (f.category || "all") === c;
        return `<button class="${on ? "on" : ""}" data-cat="${c}" data-c="${c}">${c === "all" ? "" : ART.icon(CAT_ICON[c], 14)}<span>${t("act.c." + c)}</span><b>${fmt(n)}</b></button>`; }).join("");
    }
    function drawChips() {
      const chips = [["actor", f.actorName || f.actor, "user"], ["ip", f.ip, "globe"], ["action", f.action && label({ action: f.action }), "list"]].filter(([, v]) => v);
      $("#al-chips", el).innerHTML = chips.map(([k, v, ic]) => `<button class="al-chip" data-clear="${k}">${ART.icon(ic, 13)}<span>${esc(v)}</span>${ART.icon("x", 13)}</button>`).join("");
    }
    function rowHTML(r, i) {
      let sep = "";
      const d = r.created_at.slice(0, 10);
      if (d !== lastDay) { lastDay = d; sep = `<div class="al-day">${esc(day(r.created_at))}</div>`; }
      return sep + `<button class="al-row" data-id="${r.id}" style="animation-delay:${Math.min(i, 25) * 18}ms">
        <span class="al-time mono">${time(r.created_at)}</span>${catDot(r.category)}
        <span class="al-main"><span class="al-top"><b>${esc(label(r))}</b>${r.detail && r.action !== "request" ? `<span class="al-detail">${esc(r.detail)}</span>` : ""}</span>
          <span class="al-sub"><span class="al-actor" data-actor="${esc(r.actor_id || "")}" data-name="${esc(r.actor_name || "")}"><i>${initial(r.actor_name)}</i>${esc(r.actor_name || "—")}</span>
          ${r.ip ? `<span class="al-ip mono" data-ip="${esc(r.ip)}">${esc(r.ip)}${r.country ? ` · ${esc(r.country)}` : ""}</span>` : ""}
          ${r.user_agent ? `<span class="dim">${esc(ua(r.user_agent).browser)} · ${esc(ua(r.user_agent).os)}</span>` : ""}</span></span>
        <span class="al-right">${statusTag(r.status)}${r.duration_ms != null ? `<small class="mono dim">${r.duration_ms}ms</small>` : ""}${ART.icon("chevron", 16)}</span>
      </button>`;
    }
    async function load(reset = true) {
      if (loading) return; loading = true;
      try {
        const d = await api(`/api/admin/activity?${qs({ limit: 60, before_id: reset ? "" : (rows.at(-1) || {}).id || "" })}`, { quiet: true });
        if (reset) {
          rows = d.rows; lastDay = ""; drawCats(d.counts);
          $("#al-stats", el).innerHTML = [["act.k.events", d.day.n, "activity", "var(--accent)"], ["act.k.logins", d.logins, "login", "var(--blue)"],
            ["act.k.failed", d.failed, "alert", "var(--red)"], ["act.k.ips", d.day.i, "globe", "var(--green)"]]
            .map(([k, v, ic, c]) => `<div class="card stat"><span class="label"><span style="color:${c}">${ART.icon(ic, 18)}</span>${t(k)}</span><span class="value">${fmt(v)}</span></div>`).join("");
          $("#al-list", el).innerHTML = rows.length ? rows.map(rowHTML).join("") : `<div class="card empty">${ART.icon("list", 40)}<div>${t("act.empty")}</div></div>`;
        } else {
          const start = rows.length; rows = rows.concat(d.rows);
          $("#al-list", el).insertAdjacentHTML("beforeend", d.rows.map((r, i) => rowHTML(r, i + start - start)).join(""));
        }
        more = d.more;
        $("#al-more", el).innerHTML = more ? `<button class="btn" id="al-load">${t("act.more")}</button>` : rows.length ? `<small class="dim">${t("act.end", { n: fmt(rows.length) })}</small>` : "";
        drawChips();
      } finally { loading = false; }
    }
    // 自動更新：只在第一頁、沒有開啟詳細視窗時插入新紀錄
    async function poll() {
      if (!auto || document.hidden || $(".overlay") || $("#al-q", el) === null) return;
      const top = rows[0]; if (!top) return load();
      const d = await api(`/api/admin/activity?${qs({ limit: 30 })}`, { quiet: true });
      const fresh = d.rows.filter((r) => r.id > top.id);
      if (!fresh.length) return;
      rows = fresh.concat(rows); lastDay = "";
      $("#al-list", el).innerHTML = rows.map(rowHTML).join("");
      fresh.forEach((r) => $(`.al-row[data-id="${r.id}"]`, el)?.classList.add("fresh"));
      drawCats(d.counts); sfx("tick");
    }

    function kvRows(pairs) { return pairs.filter(([, v]) => v != null && v !== "").map(([k, v, cls]) => `<div class="kv"><span>${t(k)}</span><b class="${cls || ""}">${v}</b></div>`).join(""); }
    const pretty = (v) => `<pre class="al-json">${esc(JSON.stringify(v, null, 2))}</pre>`;
    function diffTable(b, a) {
      const keys = [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])];
      if (!keys.length) return "";
      const show = (v) => v == null || v === "" ? `<i class="dim">${t("act.empty.v")}</i>` : esc(typeof v === "object" ? JSON.stringify(v) : String(v));
      return `<div class="al-diff">${keys.map((k) => `<div class="al-drow"><span class="k mono">${esc(k)}</span><span class="b">${show((b || {})[k])}</span><span class="arr">${ART.icon("chevron", 14)}</span><span class="a">${show((a || {})[k])}</span></div>`).join("")}</div>`;
    }
    async function detail(id) {
      const d = await api(`/api/admin/activity/${id}`);
      const r = d.row; const u = ua(r.user_agent);
      const list = (xs) => xs.map((x) => `<button class="al-mini" data-id="${x.id}">${catDot(x.category)}<span>${esc(label(x))}</span><small class="dim">${ago(x.created_at)}</small></button>`).join("");
      const o = App.modal({ wide: true, title: `<span class="row" style="gap:10px;flex-wrap:nowrap">${catDot(r.category)}<span>${esc(label(r))}</span></span>`, body: `
        <div class="al-detail-body">
          <div class="al-summary">
            <div class="al-who">${d.actor && d.actor.avatar ? `<img src="${esc(d.actor.avatar)}" alt="">` : `<i>${initial(r.actor_name)}</i>`}
              <div><b>${esc(r.actor_name || "—")}</b><small class="dim">${r.actor_id ? `ID ${esc(r.actor_id)}` : t("act.noActor")}${d.actor && d.actor.mc_name ? ` · MC ${esc(d.actor.mc_name)}` : ""}</small></div></div>
            <div class="al-when"><b>${esc(full(r.created_at))}</b><small class="dim">${ago(r.created_at)}</small></div>
          </div>
          ${r.detail ? `<p class="al-desc">${esc(r.detail)}</p>` : ""}
          ${r.before || r.after ? `<h4>${ART.icon("edit", 16)} ${t("act.changes")}</h4>${diffTable(r.before, r.after)}` : ""}
          <div class="grid grid-2 al-meta">
            <div><h4>${ART.icon("server", 16)} ${t("act.request")}</h4><div class="kv-grid">${kvRows([
              ["act.f.category", esc(t("act.c." + (r.category || "other")))], ["act.f.action", `<span class="mono">${esc(r.action)}</span>`],
              ["act.f.target", r.target && `<span class="mono">${esc(r.target)}</span>`], ["act.f.method", r.method && `<span class="mono">${esc(r.method)}</span>`],
              ["act.f.route", r.route && `<span class="mono">${esc(r.route)}</span>`], ["act.f.path", r.path && r.path !== r.route ? `<span class="mono">${esc(r.path)}</span>` : null],
              ["act.f.query", r.query && `<span class="mono">${esc(r.query)}</span>`], ["act.f.status", statusTag(r.status) || null],
              ["act.f.duration", r.duration_ms != null ? r.duration_ms + " ms" : null], ["act.f.reqid", r.request_id && `<span class="mono">${esc(r.request_id)}</span>`],
              ["act.f.id", `<span class="mono">#${r.id}</span>`]])}</div></div>
            <div><h4>${ART.icon("monitorx", 16)} ${t("act.client")}</h4><div class="kv-grid">${kvRows([
              ["act.f.ip", r.ip && `<span class="mono">${esc(r.ip)}</span>`], ["act.f.country", r.country && esc(r.country)],
              ["act.f.browser", esc(u.browser)], ["act.f.os", esc(u.os)], ["act.f.device", esc(u.device)],
              ["act.f.referer", r.referer && `<span class="mono al-wrap">${esc(r.referer)}</span>`]])}</div>
              ${r.user_agent ? `<small class="al-ua mono">${esc(r.user_agent)}</small>` : ""}</div>
          </div>
          ${r.payload ? `<h4>${ART.icon("code", 16)} ${t("act.payload")}</h4>${pretty(r.payload)}` : ""}
          ${r.meta ? `<h4>${ART.icon("database", 16)} ${t("act.metaTitle")}</h4>${pretty(r.meta)}` : ""}
          ${d.related.length ? `<h4>${ART.icon("link", 16)} ${t("act.related")}</h4><div class="al-minis">${list(d.related)}</div>` : ""}
          <div class="grid grid-2">
            ${d.actor_recent.length ? `<div><h4>${ART.icon("history", 16)} ${t("act.recent")}</h4><div class="al-minis">${list(d.actor_recent)}</div></div>` : ""}
            ${d.ip_actors.length ? `<div><h4>${ART.icon("users", 16)} ${t("act.ipAccounts")}</h4><div class="al-minis">${d.ip_actors.map((x) => `<div class="al-mini"><i class="al-ini">${initial(x.actor_name)}</i><span>${esc(x.actor_name || x.actor_id)}</span><small class="dim">${fmt(x.n)} · ${ago(x.last)}</small></div>`).join("")}</div></div>` : ""}
          </div>
          <div class="row al-actions">
            ${r.actor_id ? `<button class="btn sm" data-f-actor="${esc(r.actor_id)}" data-f-name="${esc(r.actor_name || "")}">${ART.icon("user", 14)} ${t("act.byActor")}</button>` : ""}
            ${r.ip ? `<button class="btn sm" data-f-ip="${esc(r.ip)}">${ART.icon("globe", 14)} ${t("act.byIp")}</button>` : ""}
            <button class="btn sm" data-f-action="${esc(r.action)}">${ART.icon("list", 14)} ${t("act.byAction")}</button>
            <button class="btn sm ghost" data-copy-json>${ART.icon("copy", 14)} ${t("act.copyJson")}</button>
          </div>
        </div>` });
      o.el.addEventListener("click", (e) => {
        const m = e.target.closest(".al-mini[data-id]"); if (m) { o.close(true); return detail(+m.dataset.id); }
        const b = e.target.closest("[data-f-actor],[data-f-ip],[data-f-action]");
        if (b) { if (b.dataset.fActor) { f.actor = b.dataset.fActor; f.actorName = b.dataset.fName; } if (b.dataset.fIp) f.ip = b.dataset.fIp; if (b.dataset.fAction) f.action = b.dataset.fAction; o.close(); load(); }
        if (e.target.closest("[data-copy-json]")) App.copy(JSON.stringify(r, null, 2));
      });
    }

    el.addEventListener("click", (e) => {
      const actor = e.target.closest(".al-actor[data-actor]"); const ip = e.target.closest(".al-ip");
      if (actor && actor.dataset.actor) { e.stopPropagation(); f.actor = actor.dataset.actor; f.actorName = actor.dataset.name; sfx("switch"); return load(); }
      if (ip) { e.stopPropagation(); f.ip = ip.dataset.ip; sfx("switch"); return load(); }
      const row = e.target.closest(".al-row"); if (row) return detail(+row.dataset.id);
      const c = e.target.closest("[data-cat]"); if (c) { f.category = c.dataset.cat === "all" ? "" : c.dataset.cat; sfx("switch"); return load(); }
      const x = e.target.closest("[data-clear]"); if (x) { f[x.dataset.clear] = ""; if (x.dataset.clear === "actor") f.actorName = ""; return load(); }
      if (e.target.closest("#al-load")) return load(false);
      if (e.target.closest("#al-csv")) { e.preventDefault(); location.href = `/api/admin/activity/export.csv?${qs()}`; }
    });
    let qt;
    $("#al-q", el).addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 280); });
    $("#al-status", el).addEventListener("change", (e) => { f.status = e.target.value; load(); });
    $("#al-since", el).addEventListener("change", (e) => { f.since = e.target.value; load(); });
    $("#al-until", el).addEventListener("change", (e) => { f.until = e.target.value; load(); });
    $("#al-auto", el).addEventListener("change", (e) => { auto = e.target.checked; App.store.set("act.auto", auto); $(".al-live", el).classList.toggle("on", auto); });
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && more && !loading) load(false); }, { rootMargin: "300px" });
    io.observe($("#al-more", el));
    timer = setInterval(() => poll().catch(() => {}), 8000);
    load();
    return () => { clearInterval(timer); io.disconnect(); };
  }
  window.ActivityLog = { render };
})();
