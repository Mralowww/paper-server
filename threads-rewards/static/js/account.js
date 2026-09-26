(() => {
  const { $, esc, t, api, date, ago, sfx, mcHead, ptTag, remaining } = App;
  let d = null; let poll = null;

  function render() {
    const me = App.me;
    const node = (ok, ico, title, sub) => `<div class="node ${ok ? "ok" : ""}"><span class="icon-box" style="margin:0 auto;${ok ? "--c:var(--green);--cb:var(--green-bg)" : ""}">${ico}</span><b>${title}</b><small>${sub}</small></div>`;
    $("#flow").innerHTML = node(true, ART.icon("globe", 22), t("acc.web"), t("acc.linked"))
      + node(true, `<img src="${esc(me.avatar)}" style="width:26px;height:26px;border-radius:50%" alt="">`, "Discord", esc(me.name))
      + node(!!d.mc, d.mc ? `<img src="${mcHead(d.mc.uuid, 26)}" style="width:26px;height:26px;border-radius:5px;image-rendering:pixelated" alt="">` : ART.icon("server", 22), "Minecraft", d.mc ? esc(d.mc.name) : t("acc.notLinked"));
    const lc = $("#link-card");
    if (d.mc) {
      lc.innerHTML = `<div class="row" style="justify-content:space-between"><div class="row" style="gap:14px"><img class="mc-av" src="https://mc-heads.net/avatar/${d.mc.uuid}/56" width="56" height="56" alt=""><div><b style="font-size:18px">${esc(d.mc.name)}</b><div class="dim" style="font-size:13px">${t("acc.linked")} · ${date(d.mc.linked_at)}</div></div></div>
        <div class="row"><a class="btn" href="/player?name=${encodeURIComponent(d.mc.name)}">${t("nav.myProfile")}</a><button class="btn danger" id="unlink">${t("acc.unlink")}</button></div></div>`;
    } else {
      lc.innerHTML = `<div class="card-title"><h3>${t("acc.linkTitle")}</h3></div><p class="muted" style="margin-top:-4px">${t("acc.linkSteps")}</p>
        ${d.code ? `<div class="code-box" data-copy="/link ${d.code.code}">/link ${d.code.code}</div><p class="dim" style="font-size:13px">${t("acc.expires", { m: Math.max(1, Math.round((new Date(d.code.expires_at) - Date.now()) / 60000)) })}</p>`
          : `<button class="btn gold" id="gen">${t("acc.gen")}</button>`}
        <p class="dim" style="font-size:12.5px;margin-bottom:0">${t("acc.pluginNote")}</p>`;
    }
    $("#puns").innerHTML = !d.mc ? `<div class="empty">${t("sup.needLink")}</div>` : d.punishments.length ? d.punishments.map((p) => `
      <div class="pun-item ${p.active ? "" : "off"}" data-pt="${p.type}"><span class="bar"></span><div class="desc"><div class="row" style="gap:6px">${ptTag(p.type, !!p.active)}<span class="mono dim" style="font-size:12px">#${p.id}</span></div><p>${esc(p.reason)}</p><small>${esc(p.staff_name)} · ${date(p.created_at)} · ${p.active ? t("pl.remaining") + " " + remaining(p.expires_at) : t("pl.expired")}</small></div>
      <div style="align-self:center">${p.appealed ? `<span class="tag">${t("acc.appealed")}</span>` : `<a class="btn sm" href="/support?cat=appeal&pid=${p.id}">${t("acc.appeal")}</a>`}</div></div>`).join("") : `<div class="empty">${t("pp.clean")}</div>`;
    clearInterval(poll);
    if (d.code && !d.mc) poll = setInterval(async () => { const n = await api("/api/account", { quiet: true }); if (n.mc) { d = n; sfx("success"); App.ok(t("acc.linkedOk"), n.mc.name); App.confetti(60); render(); } }, 4000);
  }

  async function loadKeys() {
    const { keys } = await api("/api/me/keys", { quiet: true });
    $("#keys").innerHTML = keys.map((k) => `<div class="row" style="justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><div><b>${esc(k.name)}</b> <span class="mono dim">${esc(k.prefix)}…</span><div class="dim" style="font-size:12.5px">${date(k.created_at)} · ${k.last_used ? ago(k.last_used) + " · " + k.uses + "×" : "—"}</div></div><button class="btn sm danger" data-del="${k.id}">${ART.icon("trash", 14)}</button></div>`).join("") || `<div class="dim">${t("acc.noKeys")}</div>`;
  }

  document.addEventListener("app:ready", async () => {
    if (!App.me) return App.go("/login");
    d = await api("/api/account"); render(); loadKeys(); App.observe();
    if (location.hash === "#dev") setTimeout(() => $("#dev").scrollIntoView({ behavior: "smooth" }), 300);
    document.addEventListener("click", async (e) => {
      if (e.target.closest("#gen")) { await api("/api/account/link-code", { method: "POST" }); d = await api("/api/account", { quiet: true }); sfx("popup"); render(); }
      const c = e.target.closest("[data-copy]"); if (c) App.copy(c.dataset.copy);
      if (e.target.closest("#unlink") && (await App.confirm(t("acc.confirmUnlink"), { danger: true }))) { await api("/api/account/link", { method: "DELETE" }); d = await api("/api/account"); sfx("delete"); render(); }
      const del = e.target.closest("[data-del]"); if (del && (await App.confirm(t("acc.keyDelete"), { danger: true }))) { await api(`/api/me/keys/${del.dataset.del}`, { method: "DELETE" }); sfx("delete"); loadKeys(); }
    });
    $("#kf").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/me/keys", { method: "POST", body: { name: e.target.name.value } }); e.target.reset(); loadKeys();
        const o = App.modal({ title: t("acc.keyCreated"), body: `<p class="muted">${t("acc.keyOnce")}</p><div class="input-group"><input class="input mono" value="${esc(r.key)}" readonly><button class="btn gold" id="ck">${ART.icon("copy", 16)}</button></div>` });
        App.$("#ck", o.el).addEventListener("click", () => App.copy(r.key));
      } catch (err) { App.fail(err.message); }
    });
  });
  document.addEventListener("langchange", () => d && (render(), loadKeys()));
})();
