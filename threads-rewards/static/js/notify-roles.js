/* Discord 通知身分組領取（獨立頁面，不在主選單） */
(() => {
  const { $, $$, esc, t, api, fmt, sfx } = App;
  let data = null; let busy = new Set(); const cd = {}; let tick = null;
  const left = (id) => Math.max(0, Math.ceil(((cd[id] || 0) - Date.now()) / 1000));
  function cool(id, sec) { cd[id] = Date.now() + sec * 1000; if (!tick) tick = setInterval(() => { render(); if (!Object.keys(cd).some(left)) { clearInterval(tick); tick = null; } }, 1000); }
  function render() {
    const d = data; if (!d) return;
    $("#nr-stats").innerHTML = d.roles.map((r) => `<div class="nr-stat"><b>${esc(r.name)}</b><span> - ${t("nr.subs", { n: `<i data-rc="${r.id}">${fmt(r.count)}</i>` })}</span></div>`).join("");
    $("#nr-grid").innerHTML = d.roles.map((r, i) => `<button class="nr-btn ${r.on ? "on" : ""} ${busy.has(r.id) ? "busy" : ""} ${left(r.id) ? "cool" : ""}" data-id="${r.id}" style="--i:${i}" ${!d.logged_in || d.member === false ? "disabled" : ""}>
        <span class="nr-ic">${ART.icon(r.icon || "bell", 22)}</span>
        <span class="nr-txt"><b>${esc(r.name)}</b><small>${esc(r.desc || "")}</small></span>
        <span class="nr-state"><i class="nr-sw"><em></em></i><small>${left(r.id) ? t("nr.wait", { n: left(r.id) }) : t(r.on ? "nr.on" : "nr.off")}</small></span></button>`).join("");
    $("#nr-foot").innerHTML = !d.logged_in ? `<span>${t("nr.needLogin")}</span><a class="btn gold" href="/login?next=/notify-roles">${ART.icon("login", 16)}${t("nav.login")}</a>`
      : d.member === false ? `<span>${t("nr.notMember")}</span>` : `<span class="dim">${t("nr.hint", { n: fmt(d.members) })}</span>`;
  }
  async function load() {
    data = await api(App.me ? "/api/notify-roles/me" : "/api/notify-roles", { quiet: true });
    for (const [id, sec] of Object.entries(data.cooldowns || {})) if (!left(id)) cool(id, sec);
    render();
  }
  document.addEventListener("app:ready", () => {
    load().catch((e) => App.fail(e.message));
    $("#nr-grid").addEventListener("click", async (e) => {
      const b = e.target.closest(".nr-btn"); if (!b || b.disabled || busy.has(b.dataset.id)) return;
      if (left(b.dataset.id)) { sfx("error"); b.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], 250); return; }
      const r = data.roles.find((x) => x.id === b.dataset.id); const on = !r.on;
      busy.add(r.id); r.on = on; r.count = Math.max(0, r.count + (on ? 1 : -1)); render(); sfx(on ? "toggleOn" : "toggleOff");
      try { const res = await api(`/api/notify-roles/${r.id}`, { method: "POST", body: { on } }); r.count = res.count || r.count; cool(r.id, res.cooldown || data.cooldown || 10); App.ok(t(on ? "nr.added" : "nr.removed", { name: r.name }), "", 1200); }
      catch (err) { if (err.status === 429) cool(r.id, 10); r.on = !on; r.count = Math.max(0, r.count + (on ? -1 : 1)); App.fail(err.message); }
      finally { busy.delete(r.id); render(); }
    });
    setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 60000);
  });
  document.addEventListener("langchange", render);
})();
