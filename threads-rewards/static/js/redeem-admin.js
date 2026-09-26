/* 後台：兌換碼管理（獎品、代碼、兌換紀錄） */
window.RedeemAdmin = async function (el, { head }) {
  const { $, $$, esc, t, api, fmt, date, ago, sfx, modal, observe } = App;
  const KINDS = ["public", "single", "player", "role"];
  const KIND_IC = { public: "globe", single: "key", player: "user", role: "shield" };
  const STATE = { live: "ok", scheduled: "warn", ended: "", soldout: "", off: "bad" };
  let data = null; let tiers = [];
  const toLocal = (iso) => { if (!iso) return ""; const x = new Date(iso); if (isNaN(x)) return ""; x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const fromLocal = (v) => v ? new Date(v).toISOString() : null;
  const RS = { delivered: "ok", pending: "warn", failed: "bad" };

  function card(r) {
    const cap = r.kind === "single" ? `${fmt(r.used)} / ${fmt(r.codes)}` : r.max_uses ? `${fmt(r.used)} / ${fmt(r.max_uses)}` : `${fmt(r.used)} / ∞`;
    const pct = r.kind === "single" ? (r.codes ? r.used / r.codes : 0) : r.max_uses ? r.used / r.max_uses : 0;
    const when = r.starts_at || r.ends_at ? `${r.starts_at ? date(r.starts_at) : "—"} → ${r.ends_at ? date(r.ends_at) : "∞"}` : t("rda.noLimit");
    const req = r.kind === "player" ? esc(r.players.split(/[\s,，、]+/).filter(Boolean).slice(0, 4).join("、")) + (r.players.split(/[\s,，、]+/).filter(Boolean).length > 4 ? "…" : "")
      : r.kind === "role" ? [...r.roles.map((x) => t("rda.role." + x)), r.min_tier >= 0 && tiers[r.min_tier] ? t("rda.tierUp", { name: esc(tiers[r.min_tier].name) }) : ""].filter(Boolean).join(" / ") : "";
    return `<div class="rda-card ${r.active ? "" : "off"}" data-id="${r.id}">
      <div class="rda-top"><span class="rda-ic">${ART.icon(KIND_IC[r.kind], 18)}</span><div class="rda-name"><b>${esc(r.name)}</b><small>${t("rda.k." + r.kind)}${req ? " · " + req : ""}</small></div><span class="tag ${STATE[r.state]}">${t("rda.s." + r.state)}</span></div>
      ${r.description ? `<p class="rda-desc">${esc(r.description)}</p>` : ""}
      ${r.kind === "single" ? `<button class="rda-code multi" data-a="codes">${ART.icon("list", 14)}${t("rda.nCodes", { n: fmt(r.codes) })}</button>` : `<button class="rda-code" data-a="copy" data-code="${esc(r.code || "")}" title="${t("copy")}"><span class="mono">${esc(r.code || "—")}</span>${ART.icon("copy", 14)}</button>`}
      <div class="rda-bar"><i style="width:${Math.min(100, pct * 100)}%"></i></div>
      <div class="rda-meta"><span>${t("rda.used")} <b class="mono">${cap}</b></span><span>${t("rda.perUser")} <b class="mono">${r.per_user}</b></span>${r.failed ? `<span class="bad-t">${t("rda.failedN", { n: r.failed })}</span>` : ""}</div>
      <div class="rda-when">${ART.icon("clock", 13)}${when}</div>
      <div class="rda-cmds mono">${esc(r.commands.split("\n").slice(0, 3).join("\n"))}${r.commands.split("\n").length > 3 ? "\n…" : ""}</div>
      <div class="rda-actions">
        <button class="btn sm" data-a="edit">${ART.icon("edit", 14)}${t("edit")}</button>
        <button class="btn sm" data-a="logs">${ART.icon("history", 14)}${t("rda.logs")}</button>
        <button class="btn sm" data-a="toggle">${t(r.active ? "rda.disable" : "rda.enable")}</button>
        <button class="btn sm icon danger" data-a="del" title="${t("delete")}">${ART.icon("trash", 14)}</button>
      </div></div>`;
  }

  async function logsTable(rid) {
    const d = await api(`/api/admin/redeem-logs${rid ? "?reward_id=" + rid : ""}`, { quiet: true });
    return d.logs.length ? `<div class="table-wrap responsive"><table><thead><tr><th>${t("rda.time")}</th><th>${t("rda.player")}</th><th>${t("rda.reward")}</th><th>${t("rda.code")}</th><th>${t("rda.status")}</th></tr></thead><tbody>
      ${d.logs.map((l) => `<tr><td data-label="${t("rda.time")}" title="${date(l.created_at)}">${ago(l.created_at)}</td>
        <td data-label="${t("rda.player")}"><span class="cell-user"><img src="${App.mcHead(l.mc_uuid, 22)}" alt="">${esc(l.mc_name || "—")}</span><small class="dim"> ${esc(l.global_name || l.username || "")}</small></td>
        <td data-label="${t("rda.reward")}">${esc(l.reward || "#" + l.reward_id)}</td><td data-label="${t("rda.code")}" class="mono">${esc(l.code)}</td>
        <td data-label="${t("rda.status")}"><span class="tag ${RS[l.status] || ""}">${t("rd.st." + l.status)}</span>${l.reason ? `<small class="dim"> ${esc(t("rd.r." + l.reason) !== "rd.r." + l.reason ? t("rd.r." + l.reason) : l.reason)}</small>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">${t("rda.noLogs")}</div>`;
  }

  async function draw() {
    data = await api("/api/admin/redeem");
    el.innerHTML = head("redeem", `<button class="btn gold" data-a="new">${ART.icon("plus", 16)}${t("rda.new")}</button>`)
      + (data.plugin_online ? "" : `<div class="rd-warn" style="margin-bottom:14px">${ART.icon("alert", 14)}${t("rd.c.plugin")}</div>`)
      + (data.rewards.length ? `<div class="rda-grid">${data.rewards.map(card).join("")}</div>` : `<div class="card empty">${ART.icon("gift", 36)}<div>${t("rda.empty")}</div></div>`)
      + `<div class="card section tight"><div class="card-title"><h3>${t("rda.recent")}</h3></div><div id="rda-logs"></div></div>`;
    $("#rda-logs").innerHTML = await logsTable();
    observe(el);
  }

  function editor(r) {
    const e = r || { kind: "public", per_user: 1, max_uses: 0, active: 1, roles: [], min_tier: -1, commands: "", players: "" };
    const edit = !!r;
    const o = modal({ wide: true, title: esc(t(edit ? "rda.editT" : "rda.newT")), body: `<form class="rda-form" id="rda-f">
      <div class="field"><label>${t("rda.kind")}</label><div class="rda-kinds">${KINDS.map((k) => `<label class="rda-kind ${e.kind === k ? "on" : ""} ${edit && e.kind !== k ? "locked" : ""}"><input type="radio" name="kind" value="${k}" ${e.kind === k ? "checked" : ""} ${edit ? "disabled" : ""}>${ART.icon(KIND_IC[k], 18)}<b>${t("rda.k." + k)}</b><small>${t("rda.kd." + k)}</small></label>`).join("")}</div></div>
      <div class="grid grid-2" style="gap:12px">
        <div class="field"><label>${t("rda.name")}</label><input class="input" name="name" maxlength="60" required value="${esc(e.name || "")}" placeholder="${t("rda.namePh")}"></div>
        <div class="field" data-for="public player role"><label>${t("rda.codeL")}</label><div class="input-group"><input class="input mono" name="code" maxlength="40" value="${esc(e.code || "")}" placeholder="${t("rda.codeAuto")}"><button class="btn" type="button" data-gen>${ART.icon("refresh", 14)}${t("rda.gen")}</button></div></div>
        ${edit ? "" : `<div class="field" data-for="single"><label>${t("rda.count")}</label><div class="input-group"><input class="input mono" name="count" type="number" min="1" max="5000" value="10"><input class="input mono" name="prefix" maxlength="10" placeholder="${t("rda.prefix")}"></div></div>`}
      </div>
      <div class="field"><label>${t("rda.descL")}</label><input class="input" name="description" maxlength="300" value="${esc(e.description || "")}" placeholder="${t("rda.descPh")}"></div>
      <div class="field"><label>${t("rda.cmds")}</label><textarea class="input mono" name="commands" rows="4" required placeholder="give {player} diamond 5&#10;lp user {player} parent addtemp vip 7d">${esc(e.commands || "")}</textarea><small class="dim">${t("rda.cmdsHint", { p: "<code>{player}</code>", u: "<code>{uuid}</code>" })}</small></div>
      <div class="field"><label>${t("rda.msg")}</label><input class="input" name="message" maxlength="200" value="${esc(e.message || "")}" placeholder="${t("rda.msgPh")}"></div>
      <div class="field" data-for="player"><label>${t("rda.players")}</label><textarea class="input mono" name="players" rows="2" placeholder="Steve, Alex">${esc(e.players || "")}</textarea></div>
      <div class="grid grid-2" style="gap:12px" data-for="role">
        <div class="field"><label>${t("rda.roles")}</label><div class="row" style="gap:8px">${["sponsor", "booster"].map((x) => `<label class="chk"><input type="checkbox" name="roles" value="${x}" ${(e.roles || []).includes(x) ? "checked" : ""}>${t("rda.role." + x)}</label>`).join("")}</div><small class="dim">${t("rda.rolesHint")}</small></div>
        <div class="field"><label>${t("rda.minTier")}</label><select class="enhance" name="min_tier"><option value="-1">${t("rda.anyTier")}</option>${tiers.map((x, i) => `<option value="${i}" ${e.min_tier === i ? "selected" : ""}>${esc(x.name)}（${fmt(x.kills)}+）</option>`).join("")}</select></div>
      </div>
      <div class="grid grid-2" style="gap:12px">
        <div class="field" data-for="public player role"><label>${t("rda.max")}</label><input class="input mono" name="max_uses" type="number" min="0" value="${e.max_uses || 0}"><small class="dim">${t("rda.maxHint")}</small></div>
        <div class="field"><label>${t("rda.per")}</label><input class="input mono" name="per_user" type="number" min="1" max="1000" value="${e.per_user || 1}"></div>
        <div class="field"><label>${t("rda.start")}</label><input class="input" name="starts_at" type="datetime-local" value="${toLocal(e.starts_at)}"></div>
        <div class="field"><label>${t("rda.end")}</label><input class="input" name="ends_at" type="datetime-local" value="${toLocal(e.ends_at)}"></div>
      </div>
      <label class="chk"><input type="checkbox" name="active" ${e.active ? "checked" : ""}>${t("rda.activeL")}</label>
    </form>`, foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn gold" data-save>${t("save")}</button>` });
    const f = $("#rda-f", o.el);
    const sync = () => { const k = f.querySelector("[name=kind]:checked").value; $$(".rda-kind", f).forEach((x) => x.classList.toggle("on", x.querySelector("input").checked)); $$("[data-for]", f).forEach((x) => { x.hidden = !x.dataset.for.split(" ").includes(k); }); };
    f.addEventListener("change", sync); sync();
    f.querySelector("[data-gen]").addEventListener("click", () => { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; const g = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(""); f.code.value = `${g()}-${g()}-${g()}`; sfx("copy"); });
    f.code.addEventListener("input", () => { f.code.value = f.code.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""); });
    $("[data-save]", o.el).addEventListener("click", async () => {
      if (!f.reportValidity()) return;
      const fd = new FormData(f); const k = f.querySelector("[name=kind]:checked").value;
      const body = { name: fd.get("name"), description: fd.get("description"), kind: k, code: fd.get("code") || null, commands: fd.get("commands"), message: fd.get("message"),
        max_uses: +fd.get("max_uses") || 0, per_user: +fd.get("per_user") || 1, starts_at: fromLocal(fd.get("starts_at")), ends_at: fromLocal(fd.get("ends_at")),
        active: f.active.checked, players: fd.get("players") || "", roles: fd.getAll("roles"), min_tier: +fd.get("min_tier"), count: +(fd.get("count") || 1), prefix: fd.get("prefix") || "" };
      try {
        const res = await api(edit ? `/api/admin/redeem/${r.id}` : "/api/admin/redeem", { method: edit ? "PUT" : "POST", body });
        o.close(); App.ok(t("saved"), res.code ? res.code : res.count ? t("rda.nCodes", { n: res.count }) : "");
        await draw();
        if (!edit && res.count) codesModal(res.id);
      } catch (err) { App.fail(err.message); }
    });
  }

  async function codesModal(rid) {
    const r = data.rewards.find((x) => x.id === rid) || { name: "" };
    const d = await api(`/api/admin/redeem/${rid}/codes`);
    const unused = d.codes.filter((c) => !c.used_by).map((c) => c.code);
    const o = modal({ wide: true, title: esc(r.name) + " · " + t("rda.nCodes", { n: fmt(d.codes.length) }), body: `
      <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap"><button class="btn sm" data-copy>${ART.icon("copy", 14)}${t("rda.copyUnused", { n: unused.length })}</button>
        <a class="btn sm" href="/api/admin/redeem/${rid}/codes.csv">${ART.icon("download", 14)}CSV</a>
        <span style="flex:1"></span><input class="input mono" style="width:90px" type="number" min="1" max="5000" value="10" id="more-n"><button class="btn sm gold" data-more>${ART.icon("plus", 14)}${t("rda.more")}</button></div>
      <div class="rda-codes">${d.codes.map((c) => `<div class="rda-cd ${c.used_by ? "used" : ""}"><span class="mono">${esc(c.code)}</span>${c.used_by ? `<small>${esc(c.used_by)} · ${c.used_at ? ago(c.used_at) : t("rd.st.pending")}</small>` : `<small class="dim">${t("rda.unused")}</small>`}</div>`).join("")}</div>` });
    $("[data-copy]", o.el).addEventListener("click", () => App.copy(unused.join("\n")));
    $("[data-more]", o.el).addEventListener("click", async () => { try { await api(`/api/admin/redeem/${rid}/codes`, { method: "POST", body: { count: +$("#more-n", o.el).value || 1 } }); o.close(); await draw(); codesModal(rid); } catch (err) { App.fail(err.message); } });
  }

  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a; const id = +(b.closest("[data-id]") || {}).dataset?.id; const r = data.rewards.find((x) => x.id === id);
    try {
      if (a === "new") editor(null);
      else if (a === "edit") editor(r);
      else if (a === "copy") b.dataset.code && App.copy(b.dataset.code);
      else if (a === "codes") codesModal(id);
      else if (a === "logs") { const html = await logsTable(id); modal({ wide: true, title: esc(r.name) + " · " + t("rda.logs"), body: html }); }
      else if (a === "toggle") { await api(`/api/admin/redeem/${id}`, { method: "PATCH", body: { active: !r.active } }); sfx("switch"); await draw(); }
      else if (a === "del") { if (!(await App.confirm(t("rda.delConfirm", { name: r.name }), { danger: true }))) return; await api(`/api/admin/redeem/${id}`, { method: "DELETE" }); await draw(); }
    } catch (err) { App.fail(err.message); }
  });
  tiers = (await api("/api/tiers", { quiet: true }).catch(() => ({ tiers: [] }))).tiers;
  await draw();
};
