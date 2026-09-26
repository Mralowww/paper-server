(() => {
  const { $, $$, esc, t, api, px, metricsHTML, countUp, observe, fmt, date, ago, sfx } = App;
  let data = null; let offset = 0;
  const userAttr = (u) => `data-user='${esc(JSON.stringify({ id: u.id, name: u.name }))}'`;

  function fillWeekSelect() {
    const sel = $("#week");
    sel.innerHTML = Array.from({ length: 8 }, (_, i) => `<option value="${-i}">${i === 0 ? t("admin.thisWeek") : i === 1 ? t("admin.lastWeek") : t("admin.weeksAgo", { n: i })}</option>`).join("");
    sel.value = String(offset); sel._sync && sel._sync();
    $("#wd").innerHTML = Array.from({ length: 7 }, (_, i) => `<option value="${i}">${t("wd." + i)}</option>`).join("");
    $("#hr").innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${i}">${String(i).padStart(2, "0")}:00</option>`).join("");
    [1, 2, 3].forEach((n) => ($("#r" + n + "l").textContent = t("admin.reward", { n })));
  }

  function renderBoard() {
    const list = data.leaderboard; const max = Math.max(1, ...list.map((r) => r.score || 0));
    $("#board").innerHTML = list.length ? list.map((r, i) => `
      <div class="board-row" style="animation-delay:${i * 30}ms" ${userAttr(r)}>
        <span class="rk ${i < 3 ? "r" + (i + 1) : ""}">${i + 1}</span><img src="${esc(r.avatar)}" alt="">
        <div class="who"><b>${esc(r.name)}</b><div class="metrics">${metricsHTML(r)}</div><div class="progress"><i style="width:${(r.score / max) * 100}%"></i></div></div>
        <div class="pts">${fmt(r.score)}<small>${r.link_count} ${t("m.links")}</small></div></div>`).join("")
      : `<div class="empty">${px("trophy", 48)}<div>—</div></div>`;
  }

  function renderLinks() {
    const q = $("#link-filter").value.trim().toLowerCase();
    const rows = data.links.filter((l) => !q || [l.url, l.author, l.user.name, l.content].join(" ").toLowerCase().includes(q));
    $("#links").innerHTML = rows.length ? rows.map((l, i) => `
      <tr data-link="${l.id}" style="animation-delay:${Math.min(i, 20) * 25}ms">
        <td data-label="${t("admin.user")}"><span class="cell-user" ${userAttr(l.user)}><img src="${esc(l.user.avatar)}" alt="">${esc(l.user.name)}</span></td>
        <td data-label="${t("admin.link")}" class="wrap"><a href="${esc(l.url)}" target="_blank" rel="noopener" class="mono">@${esc(l.author)}/${esc(l.code)}</a>${l.last_error ? `<div class="tag warn" style="margin-top:4px;white-space:normal" title="${esc(l.last_error)}">${esc(l.last_error.slice(0, 60))}</div>` : `<div class="dim" style="font-size:12px">${ago(l.last_scraped)}</div>`}</td>
        <td data-label="${t("m.likes")}" class="mono metric likes">${fmt(l.likes)}</td>
        <td data-label="${t("m.replies")}" class="mono metric replies">${fmt(l.replies)}</td>
        <td data-label="${t("m.reposts")}" class="mono metric reposts">${fmt(l.reposts)}</td>
        <td data-label="${t("m.views")}"><input class="input inline-num" type="number" min="0" value="${l.views}" data-views></td>
        <td data-label="${t("m.score")}" class="mono gold-text">${fmt(l.score)}</td>
        <td data-label="${t("admin.status")}">${l.status === "rejected" ? `<span class="tag err">${t("links.rejected")}</span>` : `<span class="tag ok">OK</span>`}</td>
        <td data-label="${t("admin.actions")}"><div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">
          <button class="btn sm icon" data-act="refresh" title="${t("links.refresh")}">⟳</button>
          <button class="btn sm" data-act="${l.status === "rejected" ? "approve" : "reject"}">${t(l.status === "rejected" ? "admin.approve" : "admin.reject")}</button>
          <button class="btn sm icon danger" data-act="delete" title="${t("links.delete")}">✕</button></div></td>
      </tr>`).join("") : `<tr><td colspan="9"><div class="empty">${px("repost", 40)}<div>${t("noResult")}</div></div></td></tr>`;
  }

  function renderUsers() {
    $("#users").innerHTML = data.users.map((u, i) => `
      <tr data-uid="${u.id}" style="animation-delay:${Math.min(i, 20) * 25}ms">
        <td data-label="${t("admin.user")}"><span class="cell-user" ${userAttr(u)}><img src="${esc(u.avatar)}" alt="" data-zoom>${esc(u.name)} <span class="dim">@${esc(u.username)}</span></span></td>
        <td data-label="ID" class="mono dim">${u.id}</td>
        <td data-label="${t("admin.role")}">${u.banned ? `<span class="tag err">${t("admin.banned")}</span>` : u.admin ? `<span class="tag gold">${t("admin.admin")}</span>` : `<span class="tag ok">${t("admin.member")}</span>`}</td>
        <td data-label="${t("links.count")}" class="mono">${u.links}</td>
        <td data-label="${t("admin.joined")}" class="dim">${u.last_login ? ago(u.last_login) : "—"}</td>
        <td data-label="${t("admin.actions")}"><button class="btn sm ${u.banned ? "" : "danger"}" data-ban="${u.banned ? 0 : 1}">${t(u.banned ? "admin.unban" : "admin.ban")}</button></td>
      </tr>`).join("");
  }

  function renderSettings() {
    $$("form[data-settings]").forEach((f) => {
      for (const [k, v] of Object.entries(data.settings)) { const el = f.elements[k]; if (el && document.activeElement !== el) el.value = v; }
      $$("select.enhance", f).forEach((s) => s._sync && s._sync());
    });
  }

  /* ---------- 公告管理 ---------- */
  let news = [];
  const TAGS = ["news", "update", "event", "maintenance"];
  async function loadNews() {
    news = (await api("/api/news?limit=100", { quiet: true })).news;
    $("#news-list").innerHTML = news.length ? news.map((n) => `
      <div class="board-row" style="grid-template-columns:minmax(0,1fr) auto" data-news="${n.id}">
        <div class="who"><div class="row" style="gap:8px"><span class="tag">${t("tag." + n.tag)}</span>${n.pinned ? `<span class="tag">📌</span>` : ""}<span class="dim mono" style="font-size:12px">${date(n.created_at)}</span></div><b style="margin-top:4px">${esc(n.title)}</b></div>
        <div class="row" style="gap:6px"><button class="btn sm" data-nact="edit">${t("edit")}</button><button class="btn sm icon danger" data-nact="delete">✕</button></div>
      </div>`).join("") : `<div class="empty">${t("home.noNews")}</div>`;
  }
  function newsEditor(n) {
    const o = App.modal({
      title: esc(t(n ? "admin.editNews" : "admin.newNews")),
      body: `<form id="news-form" class="stack" style="gap:12px">
        <div class="field"><label>${t("admin.newsTitle")}</label><input class="input" name="title" required value="${esc(n ? n.title : "")}"></div>
        <div class="field"><label>${t("admin.newsTag")}</label><select class="enhance" name="tag">${TAGS.map((g) => `<option value="${g}" ${n && n.tag === g ? "selected" : ""}>${t("tag." + g)}</option>`).join("")}</select></div>
        <div class="field"><label>${t("admin.newsBody")}</label><textarea class="input" name="body" rows="8" required>${esc(n ? n.body : "")}</textarea></div>
        <label class="check"><input type="checkbox" name="pinned" ${n && n.pinned ? "checked" : ""}>${t("admin.pin")}</label>
      </form>`,
      foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn gold" form="news-form" type="submit">${t("save")}</button>`,
    });
    $("#news-form", o.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target; const body = { title: f.title.value, body: f.body.value, tag: f.tag.value, pinned: f.pinned.checked };
      try {
        await api(n ? `/api/admin/news/${n.id}` : "/api/admin/news", { method: n ? "PUT" : "POST", body });
        o.close(true); App.ok(t("saved")); loadNews();
      } catch (err) { App.fail(err.message); }
    });
  }

  function render() {
    const k = { links: data.links.length, users: new Set(data.links.map((l) => l.user_id)).size, likes: data.links.reduce((a, l) => a + l.likes, 0), errors: data.errors };
    $$("#kpis [data-k]").forEach((el) => countUp(el, k[el.dataset.k]));
    const st = $("#settled-tag"); st.hidden = !data.settled_at; if (data.settled_at) st.textContent = `✓ ${t("admin.settled")} ${date(data.settled_at)}`;
    renderBoard(); renderLinks(); renderUsers(); renderSettings(); observe();
  }

  async function load() {
    try { data = await api(`/api/admin/overview?week_offset=${offset}`); render(); }
    catch (e) { if (e.status === 401) return App.go("/login"); if (e.status === 403) { App.fail(e.message); setTimeout(() => App.go("/"), 1800); return; } App.fail(e.message); }
  }

  async function linkAction(act, id, extra) {
    try {
      if (act === "refresh") { const r = await api(`/api/admin/links/${id}/refresh`, { method: "POST" }); r.ok ? sfx("success") : App.fail(r.error); }
      else if (act === "reject" || act === "approve") { await api(`/api/admin/links/${id}`, { method: "PATCH", body: { status: act === "reject" ? "rejected" : "active" } }); sfx("toggleOff"); }
      else if (act === "delete") { if (!(await App.confirm(t("links.confirmDelete"), { danger: true }))) return; await api(`/api/admin/links/${id}`, { method: "DELETE" }); sfx("delete"); }
      else if (act === "views") { await api(`/api/admin/links/${id}`, { method: "PATCH", body: { views: extra } }); sfx("copy"); }
      await load();
    } catch (e) { App.fail(e.message); }
  }

  document.addEventListener("app:ready", () => {
    if (!App.me) return App.go("/login");
    $$("[data-px]").forEach((el) => (el.innerHTML = px(el.dataset.px, 20)));
    fillWeekSelect(); App.tabs($("#tabs")); App.observe();
    $("#week").addEventListener("change", () => { offset = +$("#week").value; load(); });
    $("#link-filter").addEventListener("input", renderLinks);
    $("#links").addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) linkAction(b.dataset.act, b.closest("[data-link]").dataset.link); });
    $("#links").addEventListener("change", (e) => { if (e.target.matches("[data-views]")) linkAction("views", e.target.closest("[data-link]").dataset.link, +e.target.value); });
    $("#users").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ban]"); if (!b) return;
      try { await api(`/api/admin/users/${b.closest("[data-uid]").dataset.uid}`, { method: "PATCH", body: { banned: b.dataset.ban === "1" } }); sfx("toggleOff"); load(); }
      catch (err) { App.fail(err.message); }
    });
    $("#add-news").addEventListener("click", () => newsEditor(null));
    $("#news-list").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-nact]"); if (!b) return;
      const n = news.find((x) => String(x.id) === b.closest("[data-news]").dataset.news);
      if (b.dataset.nact === "edit") return newsEditor(n);
      if (!(await App.confirm(t("admin.confirmDeleteNews"), { danger: true }))) return;
      try { await api(`/api/admin/news/${n.id}`, { method: "DELETE" }); sfx("delete"); loadNews(); } catch (err) { App.fail(err.message); }
    });
    loadNews().catch(() => {});
    $$("form[data-settings]").forEach((form) => form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try { await api("/api/admin/settings", { method: "PUT", body }); App.ok(t("saved")); load(); } catch (err) { App.fail(err.message); }
    }));
    $("#settle").addEventListener("click", async () => {
      if (!(await App.confirm(t("admin.confirmSettle")))) return;
      const b = $("#settle"); b.classList.add("loading");
      try { const r = await api("/api/admin/settle", { method: "POST", body: { week_offset: offset } }); App.ok(t("admin.settled"), r.winners.map((w) => `#${w.rank} ${w.name}`).join("  ·  ") || "—", 4000); App.confetti(120); load(); }
      catch (err) { App.fail(err.message); } finally { b.classList.remove("loading"); }
    });
    $("#refresh-all").addEventListener("click", async () => { try { await api("/api/admin/refresh-all", { method: "POST" }); App.ok(t("ok"), t("loading"), 1600); setTimeout(load, 8000); } catch (e) { App.fail(e.message); } });
    load();
    setInterval(() => document.visibilityState === "visible" && !document.activeElement.matches("input, textarea") && api(`/api/admin/overview?week_offset=${offset}`, { quiet: true }).then((d) => { const changed = JSON.stringify(d.links.map((l) => [l.id, l.likes, l.views])) !== JSON.stringify(data.links.map((l) => [l.id, l.likes, l.views])); data = d; if (changed) { sfx("receive"); render(); } }).catch(() => {}), 30000);
  });
  document.addEventListener("langchange", () => { fillWeekSelect(); data && render(); loadNews().catch(() => {}); });
})();
