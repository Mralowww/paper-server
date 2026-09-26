(() => {
  const { $, $$, esc, t, api, px, metricsHTML, countUp, observe, fmt, date, ago, sfx } = App;
  let data = null; let snapshot = {};

  function statusTag(l) {
    if (l.status === "rejected") return `<span class="tag err">${t("links.rejected")}</span>`;
    if (l.last_error) return `<span class="tag warn" title="${esc(l.last_error)}">${t("links.error")}</span>`;
    return l.this_period ? `<span class="tag ok live">${t("links.thisWeek")}</span>` : `<span class="tag purple">${t("links.past")}</span>`;
  }

  function row(l, i, changed) {
    return `<div class="board-row ${changed ? "fly-in" : ""}" data-link="${l.id}" style="grid-template-columns:minmax(0,1fr) auto;animation-delay:${i * 40}ms">
      <div class="who">
        <div class="row" style="gap:8px">${statusTag(l)}<a href="${esc(l.url)}" target="_blank" rel="noopener" class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">@${esc(l.author)}/${esc(l.code)}</a>${changed ? `<span class="tag gold pulse">NEW</span>` : ""}</div>
        ${l.content ? `<div class="muted" style="font-size:13px;margin:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.content)}</div>` : ""}
        <div class="metrics row" style="gap:12px">${metricsHTML(l)}<span class="dim" style="font-size:12px">${t("links.updated")} ${ago(l.last_scraped)}</span></div>
      </div>
      <div class="pts"><span data-count="${l.score}">0</span><small>${t("m.score")}</small>
        <div class="row" style="justify-content:flex-end;margin-top:6px;gap:6px">
          <button class="btn sm icon" data-act="refresh" title="${t("links.refresh")}">⟳</button>
          ${l.this_period ? `<button class="btn sm icon danger" data-act="delete" title="${t("links.delete")}">✕</button>` : ""}
        </div></div>
    </div>`;
  }

  function render(changedIds = new Set()) {
    const s = data.summary || {};
    $("#period-label").textContent = `${date(data.period.start, false)} – ${date(data.period.end, false)}`;
    const used = data.links.filter((l) => l.this_period).length;
    $("#quota").textContent = `${used} / ${data.limit}`;
    const rank = $('#summary [data-k="rank"]'); rank.textContent = data.rank ? "#" + data.rank : "—";
    ["score", "link_count", "likes"].forEach((k) => countUp($(`#summary [data-k="${k}"]`), s[k] || 0));
    $("#list").innerHTML = data.links.length ? data.links.map((l, i) => row(l, i, changedIds.has(l.id))).join("")
      : `<div class="empty">${px("repost", 48)}<div>${t("links.empty")}</div></div>`;
    observe($("#list"));
  }

  const sig = (l) => [l.likes, l.replies, l.reposts, l.views, l.status].join();
  async function load(poll = false) {
    try { data = await api("/api/my/links", { quiet: poll }); }
    catch (e) { if (e.status === 401) return App.go("/login"); App.fail(e.message); return; }
    const changed = new Set();
    if (poll) data.links.forEach((l) => { if (snapshot[l.id] !== undefined && snapshot[l.id] !== sig(l)) changed.add(l.id); });
    snapshot = Object.fromEntries(data.links.map((l) => [l.id, sig(l)]));
    if (poll && !changed.size) return;
    render(changed);
    if (changed.size) {
      sfx("receive"); $("#new-badge").hidden = false;
      if ($("#list").getBoundingClientRect().top < 0) $("#jump").hidden = false;
    }
  }

  async function submit(e) {
    e.preventDefault();
    const input = $("#url"); const btn = $("#submit-btn");
    if (!input.value.trim()) { input.classList.remove("error"); void input.offsetWidth; input.classList.add("error"); sfx("error"); return; }
    btn.classList.add("loading");
    try {
      const res = await api("/api/my/links", { method: "POST", body: { url: input.value.trim() } });
      sfx("send"); $("#add-form").classList.add("fly-out");
      setTimeout(() => { $("#add-form").classList.remove("fly-out"); $("#add-form").style.animation = "slideSide .5s var(--ease-out)"; }, 550);
      input.value = "";
      if (res.scrape.ok) App.ok(t("added"), t("addedd", { likes: fmt(res.scrape.likes) }));
      else App.ok(t("added"), t("scrapeFail", { e: res.scrape.error }), 4200);
      await load(); snapshot = {}; const first = $("#list .board-row"); first && first.classList.add("fly-in");
      App.confetti(40);
    } catch (err) {
      input.classList.remove("error"); void input.offsetWidth; input.classList.add("error"); App.fail(err.message);
    } finally { btn.classList.remove("loading"); }
  }

  async function act(action, id) {
    const rowEl = $(`[data-link="${id}"]`);
    if (action === "refresh") {
      const b = $('[data-act="refresh"]', rowEl); b.classList.add("loading");
      try { const r = await api(`/api/my/links/${id}/refresh`, { method: "POST" }); r.ok ? App.ok(t("ok"), t("addedd", { likes: fmt(r.likes) }), 1600) : App.fail(r.error); await load(); }
      catch (e) { App.fail(e.message); } finally { b.classList.remove("loading"); }
    } else if (action === "delete") {
      if (!(await App.confirm(t("links.confirmDelete"), { danger: true }))) return;
      try { await api(`/api/my/links/${id}`, { method: "DELETE" }); sfx("delete"); rowEl.classList.add("removing"); setTimeout(load, 400); }
      catch (e) { App.fail(e.message); }
    }
  }

  document.addEventListener("app:ready", () => {
    if (!App.me) return App.go("/login");
    $$("[data-px]").forEach((el) => (el.innerHTML = px(el.dataset.px, 20)));
    $("#add-form").addEventListener("submit", submit);
    $("#list").addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) act(b.dataset.act, b.closest("[data-link]").dataset.link); });
    $("#jump").addEventListener("click", () => { $("#list").scrollIntoView({ behavior: "smooth", block: "start" }); $("#jump").hidden = true; $("#new-badge").hidden = true; });
    App.ctxProviders.push((target) => {
      const r = target.closest("[data-link]"); if (!r) return null;
      const l = data.links.find((x) => String(x.id) === r.dataset.link); if (!l) return null;
      return [{ head: "@" + l.author }, { icon: "↗", label: t("links.open"), act: () => window.open(l.url, "_blank", "noopener") },
        { icon: "🔗", label: t("links.copy"), act: () => App.copy(l.url) }, { icon: "⟳", label: t("links.refresh"), act: () => act("refresh", l.id) },
        ...(l.this_period ? [{ icon: "✕", label: t("links.delete"), danger: true, act: () => act("delete", l.id) }] : [])];
    });
    load(); setInterval(() => document.visibilityState === "visible" && load(true), 30000);
  });
  document.addEventListener("langchange", () => data && render());
})();
