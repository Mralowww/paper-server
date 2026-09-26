(() => {
  const { $, $$, esc, t, api, ago, sfx, mcHead, observe } = App;
  const CAT_ICON = { report: "flag", bug: "bug", connection: "wifi", sponsor: "gem", appeal: "scale", other: "message" };
  const qs = new URLSearchParams(location.search);
  let cat = ["report", "bug", "connection", "sponsor", "appeal", "other"].includes(qs.get("cat")) ? qs.get("cat") : "report";
  let attachments = []; let account = null; let violations = []; let violation = null; let mcOk = false; let mcTimer;

  function renderCats() {
    $("#cats").innerHTML = Object.keys(CAT_ICON).map((c) => `<button type="button" data-cat="${c}" class="${c === cat ? "on" : ""}"><span class="icon-box">${ART.icon(CAT_ICON[c], 22)}</span><b>${t("cat." + c)}</b><small>${t("catd." + c)}</small></button>`).join("");
    $("#hint").dataset.cat = cat;
    const tips = t("hint." + cat).split("|");
    $("#hint").innerHTML = `<span class="icon-box lg">${ART.icon(CAT_ICON[cat], 26)}</span><h3 style="font-size:19px;margin-top:16px">${t("hint.title." + cat)}</h3>
      <ul>${tips.map((x) => `<li>${ART.icon("check", 16)}<span>${esc(x)}</span></li>`).join("")}</ul><p class="dim" style="font-size:13px;margin:0">${t("hint.footer")}</p>`;
  }

  function renderExtra() {
    const box = $("#extra"); let h = "";
    if (cat === "report") {
      h += `<div class="field"><label>${t("sup.targetId")}<span class="req">*</span></label>
        <div class="mc-input"><img id="mc-head" src="${mcHead("MHF_Steve", 42)}" alt=""><input name="target" maxlength="16" placeholder="${t("sup.egSteve")}" required><span id="mc-state"></span></div>
        <small class="dim">${t("sup.autoCheck")}</small></div>
        <div class="field"><label>${t("sup.violation")}</label><div class="chips" id="vchips">${violations.map((v, i) => `<button type="button" class="chip ${violation === v || (!violation && i === 0) ? "on" : ""}" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>
        <div class="grid grid-2"><div class="field"><label>${t("sup.world")}</label><input class="input" name="world" maxlength="60" placeholder="${t("sup.egWorld")}"></div>
        <div class="field"><label>${t("sup.when")}</label><input class="input" type="datetime-local" name="when"></div></div>`;
      if (!violation) violation = violations[0];
    } else if (cat === "appeal") {
      if (!account || !account.mc) h = `<div class="tag warn" style="white-space:normal;padding:10px 14px;border-radius:12px">${t("sup.needLink")} <a href="/account">→</a></div>`;
      else {
        const list = account.punishments.filter((p) => !p.appealed);
        h = list.length ? `<div class="field"><label>${t("sup.appealPick")}<span class="req">*</span></label><select class="enhance" name="punishment_id">${list.map((p) => `<option value="${p.id}">#${p.id} ${t("pt." + p.type)} — ${esc(p.reason)}</option>`).join("")}</select></div>` : `<div class="dim">${t("sup.noPun")}</div>`;
      }
    } else if (cat === "connection") {
      h = `<div class="grid grid-2"><div class="field"><label>${t("sup.version")}</label><input class="input" name="version" placeholder="1.21.x"></div><div class="field"><label>${t("sup.when")}</label><input class="input" type="datetime-local" name="when"></div></div>`;
    } else if (cat === "sponsor") {
      h = `<div class="field"><label>${t("sup.amount")}</label><input class="input" name="amount" placeholder="${t("sup.egAmount")}"></div>`;
    }
    box.innerHTML = h; box.hidden = !h; observe(box);
    const inp = $('input[name="target"]', box);
    if (inp) inp.addEventListener("input", () => { mcOk = false; clearTimeout(mcTimer); $("#mc-state").innerHTML = ""; const v = inp.value.trim(); if (v.length < 2) return; mcTimer = setTimeout(() => checkMc(v), 400); });
    const vc = $("#vchips", box);
    if (vc) vc.addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (!b) return; violation = b.dataset.v; $$(".chip", vc).forEach((x) => x.classList.toggle("on", x === b)); sfx("tick"); });
  }

  async function checkMc(name) {
    try {
      const r = await api(`/api/mc/${encodeURIComponent(name)}`, { quiet: true });
      if ($('input[name="target"]').value.trim() !== name) return;
      mcOk = r.exists;
      $("#mc-head").src = mcHead(r.exists ? r.uuid : "MHF_Steve", 42);
      $("#mc-state").innerHTML = r.exists ? `<span class="ok">${ART.icon("check", 16, 2.4)}</span>` : `<span class="no">${t("sup.noSuch")}</span>`;
      if (r.exists) sfx("tick");
    } catch { /* 略過 */ }
  }

  async function loadMine() {
    const d = await api("/api/tickets", { quiet: true });
    violations = d.violations || [];
    $("#mine").innerHTML = d.banned ? `<div class="empty" style="color:var(--red)">${t("sup.banned")}</div>` : d.tickets.length ? d.tickets.map((tk, i) => `
      <a class="t-row" data-cat="${tk.category}" href="/ticket?id=${tk.id}" style="animation-delay:${i * 40}ms">
        <span class="bar"></span>
        <div class="row" style="gap:12px;min-width:0;flex-wrap:nowrap"><span class="icon-box" style="width:38px;height:38px">${ART.icon(CAT_ICON[tk.category], 18)}</span>
          <div class="t-main"><b>#${tk.id} ${esc(tk.subject)}</b><small>${esc(tk.last_body || "")}</small></div></div>
        <div class="t-side"><div class="row" style="gap:6px">${tk.unread ? `<span class="unread-dot">${tk.unread}</span>` : ""}<span class="tag ${tk.status === "answered" ? "ok" : tk.status === "closed" ? "gray" : "blue"}">${t("st." + tk.status)}</span></div><small class="dim">${ago(tk.updated_at)}</small></div>
      </a>`).join("") : `<div class="empty">${t("sup.empty")}</div>`;
    return d;
  }

  async function upload(files) {
    for (const f of [...files].slice(0, 6 - attachments.length)) {
      const fd = new FormData(); fd.append("file", f); App.progress.start();
      try { const r = await fetch("/api/upload", { method: "POST", body: fd, credentials: "same-origin" }); const d = await r.json(); if (!r.ok) throw new Error(d.detail || r.status); attachments.push(d.url); sfx("copy"); }
      catch (e) { App.fail(e.message); } finally { App.progress.done(); }
    }
    $("#preview").innerHTML = attachments.map((u, i) => `<span><img src="${esc(u)}" alt="" data-zoom><button type="button" data-rm="${i}">✕</button></span>`).join("");
  }

  async function submit(e) {
    e.preventDefault(); const f = e.target;
    if (cat === "report" && !mcOk) { const box = $(".mc-input"); box.style.animation = "shake .4s"; setTimeout(() => (box.style.animation = ""), 400); App.fail(t("sup.noSuch")); return; }
    const fields = { violation: cat === "report" ? violation : null, world: f.world?.value, when: f.when?.value, version: f.version?.value, amount: f.amount?.value };
    const btn = $("#submit"); btn.classList.add("loading");
    try {
      const r = await api("/api/tickets", { method: "POST", body: { category: cat, subject: f.subject.value, body: f.body.value, attachments, fields,
        target: f.target ? f.target.value.trim() : null, punishment_id: f.punishment_id ? +f.punishment_id.value : null } });
      sfx("send"); App.ok(t("sup.created"), t("sup.createdD", { id: r.id }), 1800);
      setTimeout(() => App.go(`/ticket?id=${r.id}`), 1400);
    } catch (err) { App.fail(err.message); btn.classList.remove("loading"); }
  }

  document.addEventListener("app:ready", async () => {
    const isNew = qs.get("new") === "1" || qs.get("cat");
    if (!App.me) {
      $("#list-view").hidden = false;
      $("#mine").innerHTML = `<div class="empty"><p>${t("sup.loginFirst")}</p><a class="btn btn-discord" href="/auth/login?next=/support">${t("nav.login")}</a></div>`;
      $(".section-head .btn").hidden = true; observe(); return;
    }
    $(isNew ? "#new-view" : "#list-view").hidden = false;
    const d = await loadMine().catch(() => ({}));
    if (!isNew) { observe(); setInterval(() => document.visibilityState === "visible" && loadMine().catch(() => {}), 20000); return; }
    if (d.banned) { $("#new-form").innerHTML = `<div class="empty" style="color:var(--red)">${t("sup.banned")}</div>`; return; }
    try { account = await api("/api/account", { quiet: true }); } catch { /* 略過 */ }
    renderCats(); renderExtra(); observe();
    if (qs.get("pid") && cat === "appeal") { const s = $('select[name="punishment_id"]'); if (s) { s.value = qs.get("pid"); s._sync && s._sync(); } }
    $("#cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (!b) return; cat = b.dataset.cat; mcOk = false; sfx("switch"); renderCats(); renderExtra(); });
    $("#files").addEventListener("change", (e) => { upload(e.target.files); e.target.value = ""; });
    $("#preview").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { attachments.splice(+b.dataset.rm, 1); sfx("delete"); upload([]); } });
    $("#new-form").addEventListener("submit", submit);
    $("#new-form").addEventListener("paste", (e) => { const imgs = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith("image/")); if (imgs.length) upload(imgs); });
    $("#new-form").addEventListener("dragover", (e) => e.preventDefault());
    $("#new-form").addEventListener("drop", (e) => { e.preventDefault(); upload([...e.dataTransfer.files].filter((x) => x.type.startsWith("image/"))); });
  });
  document.addEventListener("langchange", () => { if ($("#cats") && !$("#new-view").hidden) { renderCats(); renderExtra(); } else if (App.me) loadMine(); });
})();
