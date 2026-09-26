/* 玩家資料彈窗與懲處操作（客服中心、支援單頁共用） */
(() => {
  const { $, $$, esc, t, api, date, ago, sfx, mcHead, ptTag, dur, parseDur, remaining } = App;

  function punItem(p, canEdit) {
    const active = !!p.active;
    return `<div class="pun-item ${active ? "" : "off"}" data-pt="${p.type}" data-pid="${p.id}">
      <span class="bar"></span>
      <div class="desc">
        <div class="row" style="gap:6px">${ptTag(p.type, active)}<span class="mono dim" style="font-size:12px">#${p.id}</span>
          ${active ? `<span class="tag ok">${t("pl.active")}</span>` : `<span class="tag gray">${p.revoked_by ? t("pl.revoked") : t("pl.expired")}</span>`}</div>
        <p>${esc(p.reason)}</p>
        <small>${t("pl.by")} ${esc(p.staff_name)} · ${date(p.created_at)} · ${p.type === "kick" ? "" : active && p.expires_at ? `${t("pl.remaining")} ${remaining(p.expires_at)}` : `${t("pl.expires")} ${p.expires_at ? date(p.expires_at) : t("pt.permanent")}`}
        ${p.revoked_by ? ` · ${t("pl.revoked")}：${esc(p.revoked_by)}${p.revoke_reason ? `（${esc(p.revoke_reason)}）` : ""}` : ""}${p.ip ? ` · <span class="mono">${esc(p.ip)}</span>` : ""}</small>
      </div>
      ${canEdit && active ? `<div class="row" style="gap:6px;align-self:center"><button class="btn sm" data-pact="edit">${t("pl.edit")}</button><button class="btn sm danger" data-pact="revoke">${t("pl.revoke")}</button></div>` : ""}
    </div>`;
  }

  /* 新增處罰（Minecraft 名稱驗證、期限、原因快選、靜默、同步 Discord） */
  let presetCache = null;
  const TYPE_ICON = { warn: "alert", kick: "kick", mute: "mute", ban: "ban", ipban: "monitorx" };
  const DURS = [[null, "pt.permanent"], [1800, "30m"], [3600, "1h"], [86400, "1d"], [604800, "7d"], [2592000, "30d"]];
  async function punishModal(player, onDone, preset = {}) {
    const lvl = App.me ? App.me.level : 0;
    let type = preset.type || "mute"; let seconds = null; let valid = null;
    if (!presetCache) { try { presetCache = await api("/api/staff/presets", { quiet: true }); } catch { presetCache = { reasons: [] }; } }
    const o = App.modal({
      title: `<span style="font-size:22px;font-weight:800">${esc(t("pl.new"))}</span>`,
      body: `<form id="pun-form" class="stack" style="gap:20px">
        <div class="pun-type5">${["warn", "kick", "mute", "ban", "ipban"].map((p) => `<button type="button" data-pt="${p}" data-type="${p}" ${p === "ipban" && lvl < 3 ? "disabled" : ""}>${ART.icon(TYPE_ICON[p], 24)}${t("pt." + p)}</button>`).join("")}</div>
        <div class="field"><label>${t("pl.mcName")}</label>
          <div class="mc-input"><img id="pm-head" src="${mcHead(player || "MHF_Steve", 42)}" alt=""><input name="player" value="${esc(player || "")}" maxlength="36" placeholder="Steve" required><span id="pm-state"></span></div>
          <small class="dim" id="pm-info"></small></div>
        <div class="field" id="dur-field"><label>${t("pl.duration")}</label>
          <div class="chips" id="pm-durs">${DURS.map(([v, k]) => `<button type="button" class="chip" data-sec="${v ?? "perm"}">${k.startsWith("pt.") ? t(k) : k}</button>`).join("")}</div>
          <input class="input mono" name="custom" placeholder="${t("pl.custom2")}" style="margin-top:10px"></div>
        <div class="field"><label>${t("pl.reason")}</label><input class="input" name="reason" placeholder="${t("pl.reasonPh")}" required>
          <div class="chips" id="pm-reasons" style="margin-top:10px">${(presetCache.reasons || []).map((r) => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div></div>
        <label class="check"><input type="checkbox" name="silent">${t("pl.silent")}</label>
        <label class="check"><input type="checkbox" name="sync">${t("pl.sync")}</label>
      </form>`,
      foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn red-outline" form="pun-form" type="submit">${t("pl.execute")}</button>`,
    });
    const f = $("#pun-form", o.el);
    const sync = () => {
      $$(".pun-type5 button", f).forEach((b) => b.classList.toggle("on", b.dataset.type === type));
      $$("#pm-durs .chip", f).forEach((b) => b.classList.toggle("on", String(seconds ?? "perm") === b.dataset.sec && !f.custom.value));
      $("#dur-field", f).hidden = type === "kick";
    };
    let timer;
    const check = async () => {
      const name = f.player.value.trim(); valid = null; $("#pm-state", f).innerHTML = ""; $("#pm-info", f).textContent = "";
      if (name.length < 2) return;
      try {
        const r = await api("/api/staff/players/lookup", { method: "POST", body: { player: name }, quiet: true });
        if (f.player.value.trim() !== name) return;
        valid = r; $("#pm-head", f).src = mcHead(r.uuid, 42);
        $("#pm-state", f).innerHTML = `<span class="ok">${ART.icon("check", 16, 2.4)}</span>`;
        $("#pm-info", f).textContent = `${r.discord_id ? "Discord " + r.discord_id + " · " : ""}${t("pl.past", { n: r.past })}`;
      } catch (e) { $("#pm-state", f).innerHTML = `<span class="no">${esc(e.message)}</span>`; }
    };
    f.player.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(check, 450); });
    $(".pun-type5", f).addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b && !b.disabled) { type = b.dataset.type; sfx("switch"); sync(); } });
    $("#pm-durs", f).addEventListener("click", (e) => { const b = e.target.closest("[data-sec]"); if (b) { seconds = b.dataset.sec === "perm" ? null : +b.dataset.sec; f.custom.value = ""; sfx("tick"); sync(); } });
    $("#pm-reasons", f).addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) { f.reason.value = b.dataset.r; sfx("tick"); } });
    f.custom.addEventListener("input", () => { const v = parseDur(f.custom.value); if (v) seconds = v; sync(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!valid) { $(".mc-input", f).style.animation = "shake .4s"; setTimeout(() => ($(".mc-input", f).style.animation = ""), 400); sfx("error"); return; }
      try {
        const r = await api("/api/staff/punishments", { method: "POST", body: { player: valid.uuid, type, reason: f.reason.value, duration: type === "kick" ? null : seconds, silent: f.silent.checked, discord_sync: f.sync.checked } });
        o.close(true); App.ok(t("pl.done"), `#${r.punishment.id} ${r.punishment.name} · ${t("pt." + type)}${type === "kick" ? "" : " · " + dur(seconds)}`);
        onDone && onDone(r.punishment);
      } catch (err) { f.reason.classList.remove("error"); void f.reason.offsetWidth; f.reason.classList.add("error"); App.fail(err.message); }
    });
    sync(); if (player) check(); else setTimeout(() => f.player.focus(), 50);
  }

  async function revokeModal(pid, onDone) {
    const o = App.modal({
      title: `${esc(t("pl.revoke"))} #${pid}`,
      body: `<form id="rv-form"><div class="field"><label>${t("pl.revokeReason")}</label><input class="input" name="reason"></div></form>`,
      foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn danger" form="rv-form" type="submit">${t("confirm")}</button>`,
    });
    $("#rv-form", o.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api(`/api/staff/punishments/${pid}/revoke`, { method: "POST", body: { reason: e.target.reason.value } }); o.close(true); App.ok(t("pl.revoked")); onDone && onDone(); }
      catch (err) { App.fail(err.message); }
    });
  }

  function editModal(p, onDone) {
    const o = App.modal({
      title: `${esc(t("pl.edit"))} #${p.id}`,
      body: `<form id="ed-form" class="stack" style="gap:14px">
        <div class="field"><label>${t("pl.editReason")}</label><textarea class="input" name="reason" rows="3">${esc(p.reason)}</textarea></div>
        <div class="field"><label>${t("pl.newDuration")}</label><input class="input mono" name="dur" placeholder="${t("pl.custom")}"></div>
        <label class="check"><input type="checkbox" name="perm">${t("pl.makePerm")}</label></form>`,
      foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn gold" form="ed-form" type="submit">${t("save")}</button>`,
    });
    $("#ed-form", o.el).addEventListener("submit", async (e) => {
      e.preventDefault(); const f = e.target;
      try { await api(`/api/staff/punishments/${p.id}`, { method: "PATCH", body: { reason: f.reason.value, duration: parseDur(f.dur.value), permanent: f.perm.checked } }); o.close(true); App.ok(t("saved")); onDone && onDone(); }
      catch (err) { App.fail(err.message); }
    });
  }

  function bindPunActions(root, list, reload) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pact]"); if (!b) return;
      const p = list().find((x) => String(x.id) === b.closest("[data-pid]").dataset.pid);
      if (b.dataset.pact === "revoke") revokeModal(p.id, reload); else editModal(p, reload);
    });
  }

  /* 玩家資料彈窗（分頁切換） */
  async function playerModal(uuid) {
    let d;
    try { d = await api(`/api/staff/players/${uuid}`); } catch (e) { return App.fail(e.message); }
    const p = d.player;
    const o = App.modal({
      wide: true,
      title: `<span class="row" style="gap:10px"><img class="mc-av" src="${mcHead(p.uuid, 32)}" width="28" height="28" alt="">${esc(p.name)}</span>`,
      body: `<div class="profile-head" style="margin-bottom:18px">
          <img class="mc-av" src="${mcHead(p.uuid, 128)}" alt="" data-zoom="${mcHead(p.uuid, 256)}">
          <div style="min-width:0;flex:1"><div class="row" style="gap:8px"><b style="font-size:18px">${esc(p.name)}</b><span><i class="status-dot ${p.online ? "on" : ""}"></i>${p.online ? t("home.online") : t("home.offline")}</span></div>
            <div class="mono dim" style="font-size:12px;word-break:break-all">${p.uuid}</div>
            <div class="dim" style="font-size:13px">${t("pl.firstSeen")} ${p.first_seen ? date(p.first_seen) : "—"} · ${t("pl.lastSeen")} ${p.last_seen ? ago(p.last_seen) : "—"}</div>
            <div class="row" style="gap:6px;margin-top:4px;font-size:13px">${t("pl.linked")}：${d.linked ? `<img src="${esc(d.linked.avatar)}" style="width:18px;height:18px;border-radius:50%" alt="">${esc(d.linked.name)}` : `<span class="dim">${t("pl.notLinked")}</span>`}</div></div>
          <button class="btn gold" data-punish>${t("pl.punish")}</button>
        </div>
        <div class="tabs" id="pl-tabs"><button data-tab="history">${t("pl.history")} (${d.punishments.length})</button><button data-tab="alts">${t("pl.alts")} (${d.alts.length})</button><button data-tab="ips">${t("pl.ips")}</button><button data-tab="notes">${t("pl.notes")}</button><button data-tab="ptickets">${t("pl.tickets")}</button></div>
        <div style="margin-top:14px">
          <div data-panel="history" hidden id="pl-history">${d.punishments.map((x) => punItem(x, true)).join("") || `<div class="empty">${t("pl.noHistory")}</div>`}</div>
          <div data-panel="alts" hidden>${d.alts.map((a) => `<div class="p-row" data-uuid="${a.uuid}"><img class="mc-av" src="${mcHead(a.uuid, 32)}" width="32" height="32" alt=""><div><b><i class="status-dot ${a.online ? "on" : ""}"></i>${esc(a.name)}</b><small>${a.uuid}</small></div><div class="row" style="gap:4px">${a.active_types.map((x) => ptTag(x)).join("")}</div></div>`).join("") || `<div class="empty">—</div>`}</div>
          <div data-panel="ips" hidden>${d.can_see_ip ? "" : `<p class="dim" style="font-size:12.5px;margin-top:0">${t("pl.ipHidden")}</p>`}${d.ips.map((i) => `<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span class="mono">${esc(i.ip)}</span><span class="dim" style="font-size:12.5px">${date(i.first_seen, false)} – ${ago(i.last_seen)}</span></div>`).join("") || `<div class="empty">—</div>`}</div>
          <div data-panel="notes" hidden><textarea class="input" id="pl-notes" rows="7">${esc(p.notes || "")}</textarea><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn gold" id="pl-save">${t("pl.saveNotes")}</button></div></div>
          <div data-panel="ptickets" hidden>${d.tickets.map((x) => `<a class="t-row" data-cat="${x.category}" href="/ticket?id=${x.id}"><span class="bar"></span><div class="t-main"><b>#${x.id} ${esc(x.subject)}</b><small>${date(x.created_at)}</small></div><div class="t-side">${App.catTag(x.category)}<span class="tag">${t("st." + x.status)}</span></div></a>`).join("") || `<div class="empty">—</div>`}</div>
        </div>`,
    });
    // 彈窗內自己的分頁（不覆蓋頁面的分頁記憶）
    const tabsEl = $("#pl-tabs", o.el); const btns = $$("button", tabsEl);
    const ind = document.createElement("span"); ind.className = "indicator"; tabsEl.prepend(ind);
    const show = (b, silent) => {
      btns.forEach((x) => x.classList.toggle("active", x === b)); ind.style.left = b.offsetLeft + "px"; ind.style.width = b.offsetWidth + "px";
      $$("[data-panel]", o.el).forEach((pn) => { const on = pn.dataset.panel === b.dataset.tab; pn.hidden = !on; if (on) { pn.classList.remove("tab-panel"); void pn.offsetWidth; pn.classList.add("tab-panel"); } });
      if (!silent) sfx("switch");
    };
    btns.forEach((b) => b.addEventListener("click", () => show(b)));
    requestAnimationFrame(() => show(btns[0], true));
    const reload = () => { o.close(true); playerModal(uuid); };
    $("[data-punish]", o.el).addEventListener("click", () => punishModal(p.name, reload));
    bindPunActions($("#pl-history", o.el), () => d.punishments, reload);
    $("#pl-save", o.el).addEventListener("click", async () => { try { await api(`/api/staff/players/${uuid}`, { method: "PATCH", body: { notes: $("#pl-notes", o.el).value } }); App.ok(t("saved"), "", 1200); } catch (e) { App.fail(e.message); } });
    $$("[data-uuid]", o.el).forEach((r) => r.addEventListener("click", () => { o.close(true); playerModal(r.dataset.uuid); }));
  }

  async function openByName(name) {
    try { const r = await api("/api/staff/players/lookup", { method: "POST", body: { player: name } }); playerModal(r.uuid); }
    catch (e) { App.fail(e.message); }
  }

  Object.assign(App, { playerModal, punishModal, revokeModal, editModal, punItem, bindPunActions, openPlayerByName: openByName });
})();
