(() => {
  const { $, esc, t, api, date, observe } = App;
  const cls = { update: "blue", event: "gold", maintenance: "warn" };
  let items = null;

  function render() {
    $("#news").innerHTML = items.length ? items.map((n, i) => `
      <article class="news-item" id="n${n.id}" style="animation-delay:${i * 50}ms">
        <div class="when">${date(n.created_at, false)}</div>
        <div>
          <div class="row" style="gap:8px"><span class="tag ${cls[n.tag] || ""}">${t("tag." + n.tag)}</span>${n.pinned ? `<span class="tag">${ART.icon("pin", 13)} ${t("news.pinned")}</span>` : ""}</div>
          <h3>${esc(n.title)}</h3>
          <div class="body">${esc(n.body)}</div>
          ${n.author ? `<div class="row dim" style="margin-top:14px;font-size:13px;gap:8px" data-user='${esc(JSON.stringify({ id: n.author.id, name: n.author.name }))}'><img src="${esc(n.author.avatar)}" alt="" style="width:20px;height:20px;border-radius:50%">${esc(n.author.name)}</div>` : ""}
        </div>
      </article>`).join("") : `<div class="empty">${t("home.noNews")}</div>`;
    observe();
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: "start" });
  }

  document.addEventListener("app:ready", async () => {
    try { items = (await api("/api/news?limit=100")).news; render(); } catch (e) { App.fail(e.message); }
  });
  document.addEventListener("langchange", () => items && render());
})();
