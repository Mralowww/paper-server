/* 客服單對話元件（玩家端 /ticket 與後台客服單共用） */
(() => {
  const { $, $$, esc, t, api, date, sfx, mcHead, ptTag } = App;
  const CAT_ICON = { report: "flag", bug: "bug", connection: "wifi", sponsor: "gem", appeal: "scale", other: "message" };
  const STEP = { open: 1, answered: 2, closed: 3 };
  const FIELD_LABEL = { violation: "sup.violation", world: "sup.world", when: "sup.when", version: "sup.version", amount: "sup.amount" };

  function mount(root, id, opts = {}) {
    let data = null; let lastId = 0; let seen = new Set(); let attachments = []; let timer = null; let lastDay = ""; let replyTo = null;
    root.innerHTML = `<div class="card chat" style="height:auto;padding:0;position:relative">
      <div data-r="head"><div class="skeleton sk-line" style="margin:24px;width:40%"></div></div>
      <div data-r="actions"></div>
      <div class="chat-log" data-r="log" style="height:${opts.height || "52vh"};border-top:1px solid var(--border)"></div>
      <button class="btn sm gold jump-new" data-r="jump" hidden>↓ ${t("tk.new")}</button>
      <form data-r="form" style="padding:14px 20px 16px;border-top:1px solid var(--border)">
        <div class="canned" data-r="canned" hidden></div>
        <div class="reply-bar" data-r="replybar" hidden></div>
        <div class="att-preview" data-r="preview" style="margin-bottom:8px"></div>
        <div class="composer"><label class="clip">${ART.icon("clip", 20)}<input type="file" accept="image/*" multiple hidden data-r="files"></label>
          <textarea name="body" rows="1" placeholder="${t("tk.inputPh")}"></textarea>
          <button class="send" type="submit" title="${t("tk.send")}">${ART.icon("send", 18)}</button></div>
        <div class="row" style="justify-content:space-between;margin-top:6px"><span class="composer-note">${t("tk.note")}</span>
          <label class="check" data-r="internal" hidden style="font-size:13px"><input type="checkbox" name="internal">${t("tk.internal")}</label></div>
      </form></div>`;
    const R = (k) => $(`[data-r="${k}"]`, root);
    root.setAttribute("data-tv-root", "");
    const log = R("log");
    const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const toBottom = () => { log.scrollTop = log.scrollHeight; R("jump").hidden = true; };

    function msgHTML(m) {
      const day = new Date(m.created_at).toLocaleDateString(App.lang === "zh" ? "zh-TW" : "en-US", { month: "long", day: "numeric", weekday: "long" });
      let sep = ""; if (day !== lastDay) { sep = `<div class="date-sep">${day}</div>`; lastDay = day; }
      if (m.system) return sep + `<div class="sys-msg">${esc(m.author ? m.author.name : "")} · ${esc(m.body)}</div>`;
      const mine = App.me && m.author_id === App.me.id;
      const a = m.author || { name: "?", avatar: "https://cdn.discordapp.com/embed/avatars/0.png" };
      const time = new Date(m.created_at).toLocaleTimeString(App.lang === "zh" ? "zh-TW" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      const quote = m.reply ? `<button type="button" class="quote" data-jump="${m.reply.id}">${ART.icon("back", 13)}<b>${esc(m.reply.name)}</b><span>${m.reply.deleted && !m.reply.body ? `<i>${t("tk.deletedMsg")}</i>` : esc(m.reply.body)}</span></button>` : "";
      const fwd = m.forwarded ? `<div class="fwd">${ART.icon("send", 13)}${t("tk.fwdFrom", { id: m.forwarded.ticket, name: esc(m.forwarded.author) })}</div>` : "";
      const del = m.deleted_at ? `<div class="deleted-note">${ART.icon("trash", 13)}${t("tk.deletedBy", { name: esc(m.deleted_by || "?") })}</div>` : "";
      const bodyHTML = m.deleted_at && !m.body ? `<i class="dim">${t("tk.deletedMsg")}</i>` : esc(m.body);
      return sep + `<div class="msg ${mine ? "mine" : ""} ${m.staff ? "staff" : ""} ${m.internal ? "internal" : ""} ${m.deleted_at ? "deleted" : ""}" data-id="${m.id}" data-author="${esc(m.author_id || "")}" data-name="${esc(a.name)}">
        <img class="av" src="${esc(a.avatar)}" alt="" data-user='${esc(JSON.stringify({ id: a.id, name: a.name }))}'>
        <div><div class="meta"><b style="color:var(--text)">${esc(a.name)}</b>${m.staff ? `<span class="tag gold" style="padding:0 6px;font-size:10.5px">STAFF</span>` : ""}${m.internal ? `<span class="tag yellow" style="padding:0 6px;font-size:10.5px">${t("tk.internal")}</span>` : ""}<span class="mono">${time}</span></div>
          ${quote}<div class="bubble">${fwd}${bodyHTML}${del}${m.attachments.length ? `<div class="atts">${m.attachments.map((u) => `<img src="${esc(u)}" alt="" data-zoom>`).join("")}</div>` : ""}</div></div></div>`;
    }

    function renderHead() {
      const tk = data.ticket; const step = STEP[tk.status];
      const tgt = data.target_player;
      const fields = Object.entries(tk.fields || {}).filter(([, v]) => v);
      const hist = data.target_history || [];
      root.querySelector(".chat").dataset.cat = tk.category;
      R("head").innerHTML = `<div class="tk-head" data-cat="${tk.category}">
        <span class="icon-box lg">${ART.icon(CAT_ICON[tk.category], 26)}</span>
        <div style="min-width:0;flex:1">
          <div class="meta"><span class="mono">#${tk.id}</span><span>${t("cat." + tk.category)}</span>${data.staff ? `<span>${esc(data.owner.name)} ${App.badges(data.owner.badges)}</span>` : ""}<span>${date(tk.created_at)}</span>
            ${tk.priority && tk.priority !== "normal" ? `<span class="tag ${tk.priority === "urgent" ? "red pulse" : tk.priority === "high" ? "warn" : "gray"}">${t("pr." + tk.priority)}</span>` : ""}</div>
          <h2>${esc(tk.subject)}</h2>
          <div class="stepper">${[1, 2, 3].map((n) => `${n > 1 ? `<span class="ln"></span>` : ""}<span class="st ${n <= step ? "done" : ""}"><i>${n}</i>${t(["", "st.open", "st.answered", "st.closed"][n])}</span>`).join("")}
            ${tk.target ? `<span class="target-chip" data-act="target"><img src="${mcHead(tgt ? tgt.uuid : tk.target, 26)}" alt="">${t("tk.reported")}：<b>${esc(tgt ? tgt.name : tk.target)}</b></span>` : ""}</div>
          ${fields.length || hist.length || data.punishment ? `<details class="fold" open><summary>${ART.icon("chevron", 16)}${t("tk.fields")}</summary>
            <div class="fields-box">
              ${fields.map(([k, v]) => `<div><small>${t(FIELD_LABEL[k] || k)}</small><b>${esc(k === "when" ? date(v) : v)}</b></div>`).join("")}
              ${data.punishment ? `<div style="grid-column:1/-1"><small>${t("tk.appealOf")}</small><div class="row" style="gap:8px">${ptTag(data.punishment.type, !!data.punishment.active)}<span class="mono dim">#${data.punishment.id}</span><b>${esc(data.punishment.reason)}</b><span class="dim">${esc(data.punishment.staff_name)} · ${date(data.punishment.created_at, false)}</span></div></div>` : ""}
              ${hist.length ? `<div style="grid-column:1/-1"><small>${t("tk.historyOf", { name: esc(tgt.name) })}</small><div class="row" style="gap:6px">${hist.map((h) => `<span class="tag pt ${h.active ? "" : "inactive"}" data-pt="${h.type}">${t("pt." + h.type)} ${date(h.created_at, false)}</span>`).join("")}</div></div>` : ""}
            </div></details>` : ""}
        </div></div>`;
      // 操作
      const lvl = App.me ? App.me.level : 0; let a = "";
      if (data.staff) {
        const mine = data.claimed && data.claimed.id === App.me.id;
        a += `<button class="btn" data-act="claim">${t(mine ? "tk.unclaim" : "tk.claim")}${data.claimed && !mine ? ` · ${esc(data.claimed.name)}` : ""}</button>
          <select class="enhance" data-r="prio">${["low", "normal", "high", "urgent"].map((p) => `<option value="${p}" ${tk.priority === p ? "selected" : ""}>${t("tk.priority")}：${t("pr." + p)}</option>`).join("")}</select>
          ${tk.target && lvl >= 2 ? `<button class="btn red-outline" data-act="punish">${t("tk.punish")}</button>` : ""}
          ${data.punishment && data.punishment.active && lvl >= 2 ? `<button class="btn red-outline" data-act="revoke">${t("tk.revoke")}</button>` : ""}
          <select class="enhance" data-r="status">${["open", "answered"].concat(tk.status === "closed" ? ["closed"] : []).map((s) => `<option value="${s}" ${tk.status === s ? "selected" : ""}>${t("st." + s)}</option>`).join("")}</select>
          <button class="btn" data-act="tban">${t(data.owner_banned ? "tk.unban" : "tk.ban")}</button>
          ${tk.status !== "closed" ? `<button class="btn red-outline" data-act="close">${ART.icon("x", 15)}${t("tk.closeBtn")}</button>` : `<button class="btn" data-act="reopen">${t("tk.reopen")}</button>`}
          ${data.logs && data.logs.length ? `<button class="btn" data-act="logs">${ART.icon("history", 15)}${t("tk.logs")} <span class="mono dim">${data.logs.length}</span></button>` : ""}
          ${!opts.desk ? `<button class="btn" data-act="popout" title="${t("tk.popout")}">${ART.icon("external", 15)}${t("tk.popout")}</button>` : ""}
          ${lvl >= 2 ? `<button class="btn red-outline" data-act="delete">${t("tk.delete")}</button>` : ""}`;
      } else {
        a += tk.status === "closed" ? `<button class="btn" data-act="reopen">${t("tk.reopen")}</button>` : `<button class="btn red-outline" data-act="close">${t("tk.close")}</button>`;
      }
      R("actions").innerHTML = `<div class="tk-actions">${a}</div>`;
      App.observe(R("actions"));
      const pr = R("prio"); if (pr) pr.addEventListener("change", () => act("priority", pr.value));
      const st = R("status"); if (st) st.addEventListener("change", () => act("status", st.value));
      R("internal").hidden = !data.staff;
      const cn = R("canned"); cn.hidden = !(data.canned && data.canned.length);
      if (data.canned) cn.innerHTML = data.canned.map((c) => `<button type="button" data-c="${esc(c)}">${esc(c)}</button>`).join("");
      R("form").hidden = tk.status === "closed" && !data.staff;
    }

    async function load(poll = false) {
      let d;
      try { d = await api(`/api/tickets/${id}?after=${poll ? lastId : 0}`, { quiet: poll }); }
      catch (e) { if (!poll) root.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
      const stick = !poll || nearBottom();
      const headSig = JSON.stringify([d.ticket, d.claimed, d.owner_banned, d.punishment]);
      data = { ...d };
      const fresh = d.messages.filter((m) => !seen.has(m.id)); fresh.forEach((m) => seen.add(m.id));
      if (fresh.length) {
        lastId = Math.max(lastId, ...fresh.map((m) => m.id));
        log.insertAdjacentHTML("beforeend", fresh.map(msgHTML).join(""));
        if (poll && fresh.some((m) => !App.me || m.author_id !== App.me.id)) sfx("receive");
        if (stick) requestAnimationFrame(toBottom); else R("jump").hidden = false;
        opts.onChange && opts.onChange();
      }
      if (!poll || headSig !== root._headSig) { root._headSig = headSig; renderHead(); }
    }

    async function act(a, val) {
      const tk = data.ticket; let body = null;
      if (a === "close") return closeDialog();
      if (a === "popout") { window.open(`/desk#${id}`, "sawsmp-desk"); return; }
      if (a === "logs") return showLogs();
      if (a === "reopen") body = { status: "open" };
      if (a === "status") body = { status: val };
      if (a === "priority") body = { priority: val };
      if (a === "claim") body = { claim: !(data.claimed && data.claimed.id === App.me.id) };
      if (a === "target") return data.staff && App.me.level >= 2 ? App.openPlayerByName(tk.target) : App.go(`/player?name=${encodeURIComponent(tk.target)}`);
      if (a === "punish") return App.punishModal(tk.target, () => load(true));
      if (a === "revoke") return App.revokeModal(data.punishment.id, () => { root._headSig = ""; load(true); });
      if (a === "tban") {
        try { await api(`/api/staff/ticket-ban/${data.owner.id}`, { method: "POST", body: { banned: !data.owner_banned } }); sfx("toggleOff"); root._headSig = ""; await load(true); } catch (e) { App.fail(e.message); }
        return;
      }
      if (a === "delete") {
        if (!(await App.confirm(t("tk.confirmDelete"), { danger: true }))) return;
        try { await api(`/api/staff/tickets/${id}`, { method: "DELETE" }); sfx("delete"); opts.onDelete ? opts.onDelete() : App.go("/admin#tickets"); } catch (e) { App.fail(e.message); }
        return;
      }
      try { await api(`/api/tickets/${id}/status`, { method: "POST", body }); sfx(a === "close" ? "close" : "switch"); root._headSig = ""; await load(true); toBottom(); opts.onChange && opts.onChange(); }
      catch (e) { App.fail(e.message); }
    }

    function closeDialog() {
      const presets = data.staff ? [t("tk.cr.solved"), t("tk.cr.noReply"), t("tk.cr.dup"), t("tk.cr.invalid")] : [];
      const o = App.modal({ title: `${ART.icon("x", 18)} ${t("tk.closeTitle", { id })}`, body: `
        <p class="muted" style="margin-top:0">${t(data.staff && data.owner.id !== App.me.id ? "tk.closeHintStaff" : "tk.closeHint")}</p>
        ${presets.length ? `<div class="canned" style="margin-bottom:10px">${presets.map((p) => `<button type="button" data-p="${esc(p)}">${esc(p)}</button>`).join("")}</div>` : ""}
        <textarea class="input" rows="3" id="cr" placeholder="${t("tk.closeReason")}"></textarea>`,
        foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn danger" id="cr-ok">${t("tk.closeBtn")}</button>` });
      const ta = $("#cr", o.el); setTimeout(() => ta.focus(), 50);
      o.el.addEventListener("click", async (e) => {
        const p = e.target.closest("[data-p]"); if (p) { ta.value = p.dataset.p; sfx("tick"); return; }
        if (!e.target.closest("#cr-ok")) return;
        try { await api(`/api/tickets/${id}/close`, { method: "POST", body: { reason: ta.value.trim() } }); o.close(true); sfx("close"); App.ok(t("tk.closed"), data.staff && data.owner.id !== App.me.id ? t("tk.closedDm") : "", 1800);
          root._headSig = ""; await load(true); opts.onChange && opts.onChange(); }
        catch (err) { App.fail(err.message); }
      });
    }
    async function showLogs(logId) {
      const logs = data.logs || [];
      const pick = logId || (logs[0] && logs[0].id); if (!pick) return;
      const d = await api(`/api/staff/tickets/${id}/logs/${pick}`);
      const msgs = d.transcript.messages;
      const o = App.modal({ wide: true, title: `${ART.icon("history", 18)} ${t("tk.logTitle", { id })}`, body: `
        <div class="log-head">${logs.length > 1 ? `<select class="enhance" id="lg">${logs.map((l) => `<option value="${l.id}" ${l.id === pick ? "selected" : ""}>${date(l.created_at)} · ${esc(l.closed_by_name || "")}</option>`).join("")}</select>` : ""}
          <div class="kv-grid" style="margin:0"><div class="kv"><span>${t("tk.closedBy")}</span><b>${esc(d.closed_by_name || "—")}</b></div><div class="kv"><span>${t("tk.closeReason")}</span><b>${esc(d.reason || "—")}</b></div>
          <div class="kv"><span>${t("tk.closedAt")}</span><b>${date(d.created_at)}</b></div><div class="kv"><span>${t("tk.msgCount")}</span><b>${d.message_count}</b></div></div>
          <a class="btn sm" href="/api/staff/tickets/${id}/logs/${pick}/download" download>${ART.icon("download", 14)} TXT</a></div>
        <div class="log-body">${msgs.map((m) => m.system ? `<div class="sys-msg">${esc(m.author)} · ${esc(m.body)}</div>` : `<div class="log-msg ${m.internal ? "internal" : ""} ${m.deleted_at ? "deleted" : ""}">
          <div class="meta"><b>${esc(m.author)}</b>${m.staff ? `<span class="tag gold" style="padding:0 6px;font-size:10.5px">STAFF</span>` : ""}${m.internal ? `<span class="tag yellow" style="padding:0 6px;font-size:10.5px">${t("tk.internalTag")}</span>` : ""}<small class="dim">${date(m.created_at)}</small></div>
          <div>${esc(m.body)}</div>${m.attachments.length ? `<div class="atts">${m.attachments.map((u) => `<img src="${esc(u)}" alt="" data-zoom>`).join("")}</div>` : ""}
          ${m.deleted_at ? `<div class="deleted-note">${ART.icon("trash", 13)}${t("tk.deletedBy", { name: esc(m.deleted_by || "?") })}</div>` : ""}</div>`).join("")}</div>` });
      const lg = $("#lg", o.el); if (lg) lg.addEventListener("change", () => { o.close(true); showLogs(+lg.value); });
    }

    /* ---------- 右鍵選單：回覆、轉發、刪除、標示已讀 ---------- */
    function setReply(m) {
      replyTo = m; const bar = R("replybar");
      bar.hidden = !m;
      if (m) { bar.innerHTML = `${ART.icon("back", 14)}<span>${t("tk.replying", { name: esc(m.name) })}</span><em>${esc(m.body)}</em><button type="button" data-cancel-reply>${ART.icon("x", 14)}</button>`; ta.focus(); }
    }
    function msgInfo(el) {
      const mid = +el.dataset.id; const text = el.querySelector(".bubble")?.childNodes;
      const body = [...(text || [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      const full = [...(text || [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      const time = el.querySelector(".meta small, .meta span:last-child")?.textContent || "";
      return { id: mid, name: el.dataset.name, body: body.slice(0, 120), full, time, author: el.dataset.author, mine: App.me && el.dataset.author === App.me.id, deleted: el.classList.contains("deleted"), internal: el.classList.contains("internal") };
    }
    async function markRead(mid, unread = false) {
      try { await api(`/api/tickets/${id}/read`, { method: "POST", body: { last_id: mid, unread } }); sfx("tick"); App.ok(t(unread ? "tk.markedUnread" : "tk.markedRead"), "", 900); opts.onChange && opts.onChange(); }
      catch (e) { App.fail(e.message); }
    }
    async function deleteMsg(m) {
      if (!(await App.confirm(t("tk.confirmDelMsg"), { danger: true }))) return;
      try { await api(`/api/tickets/${id}/messages/${m.id}`, { method: "DELETE" }); sfx("delete");
        const el = log.querySelector(`.msg[data-id="${m.id}"]`); if (el) { el.classList.add("deleted"); el.querySelector(".bubble").insertAdjacentHTML("beforeend", `<div class="deleted-note">${ART.icon("trash", 13)}${t("tk.deletedBy", { name: esc(App.me.name) })}</div>`); if (!data.staff) el.querySelector(".bubble").innerHTML = `<i class="dim">${t("tk.deletedMsg")}</i>`; } }
      catch (e) { App.fail(e.message); }
    }
    async function forwardMsg(m) {
      const d = await api(`/api/staff/tickets?status=active`, { quiet: true });
      const list = d.tickets.filter((x) => x.id !== id);
      const o = App.modal({ title: `${ART.icon("send", 18)} ${t("tk.forward")}`, body: `
        <div class="fwd-src"><b>${esc(m.name)}</b><span>${esc(m.body)}</span></div>
        <input class="input" id="fq" placeholder="${t("tk.fwdSearch")}" style="margin:12px 0 8px">
        <div class="fwd-list" id="fl">${list.map((x) => `<button type="button" class="fwd-item" data-to="${x.id}"><span class="mono">#${x.id}</span><b>${esc(x.subject)}</b><small>${esc(x.user.name)}</small></button>`).join("") || `<div class="empty">${t("sup.empty")}</div>`}</div>
        <input class="input" id="fn" placeholder="${t("tk.fwdNote")}" style="margin-top:10px">
        <label class="check" style="margin-top:10px"><input type="checkbox" id="fv">${t("tk.fwdVisible")}</label>`,
        foot: `<button class="btn" data-close>${t("cancel")}</button><button class="btn gold" id="fok" disabled>${t("tk.forward")}</button>` });
      let to = 0;
      o.el.addEventListener("click", async (e) => {
        const it = e.target.closest("[data-to]");
        if (it) { to = +it.dataset.to; $$(".fwd-item", o.el).forEach((x) => x.classList.toggle("on", x === it)); $("#fok", o.el).disabled = false; sfx("tick"); return; }
        if (!e.target.closest("#fok") || !to) return;
        try { await api(`/api/staff/tickets/${id}/messages/${m.id}/forward`, { method: "POST", body: { to, visible: $("#fv", o.el).checked, note: $("#fn", o.el).value } });
          o.close(true); sfx("send"); App.ok(t("tk.forwarded", { id: to }), "", 1400); }
        catch (err) { App.fail(err.message); }
      });
      $("#fq", o.el).addEventListener("input", (e) => { const q = e.target.value.trim().toLowerCase().replace(/^#/, "");
        $$(".fwd-item", o.el).forEach((x) => { x.hidden = q && !x.textContent.toLowerCase().includes(q); }); });
    }
    const insertText = (txt) => { ta.value = (ta.value ? ta.value.replace(/\s*$/, "\n") : "") + txt; ta.dispatchEvent(new Event("input")); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); };
    const toggleInternal = () => { if (form.internal) { form.internal.checked = !form.internal.checked; sfx(form.internal.checked ? "toggleOn" : "toggleOff"); App.ok(t(form.internal.checked ? "tk.internalOn" : "tk.internalOff"), "", 900); } };
    root._tv = { msgInfo, setReply, markRead, deleteMsg, forwardMsg, showLogs, closeDialog, act, insertText, toggleInternal, toBottom, reload: () => { root._headSig = ""; return load(true); },
      get data() { return data; }, get id() { return id; }, get staff() { return data && data.staff; } };

    async function upload(files) {
      for (const f of [...files].slice(0, 3 - attachments.length)) {
        const fd = new FormData(); fd.append("file", f); App.progress.start();
        try { const r = await fetch("/api/upload", { method: "POST", body: fd, credentials: "same-origin" }); const d = await r.json(); if (!r.ok) throw new Error(d.detail); attachments.push(d.url); }
        catch (e) { App.fail(e.message); } finally { App.progress.done(); }
      }
      R("preview").innerHTML = attachments.map((u, i) => `<span><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}">✕</button></span>`).join("");
    }

    const form = R("form"); const ta = form.body;
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const text = ta.value.trim();
      if (!text && !attachments.length) { root.querySelector(".composer").style.animation = "shake .4s"; setTimeout(() => (root.querySelector(".composer").style.animation = ""), 400); sfx("error"); return; }
      const btn = $(".send", form); btn.classList.add("send-fly");
      try {
        await api(`/api/tickets/${id}/messages`, { method: "POST", body: { body: text, attachments, internal: !!(form.internal && form.internal.checked), reply_to: replyTo && replyTo.id } });
        sfx("send"); setReply(null); ta.value = ""; ta.style.height = ""; attachments = []; R("preview").innerHTML = "";
        root._headSig = ""; await load(true); toBottom(); opts.onChange && opts.onChange();
      } catch (err) { App.fail(err.message); } finally { setTimeout(() => btn.classList.remove("send-fly"), 500); }
    });
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(180, ta.scrollHeight) + "px"; });
    ta.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); form.requestSubmit(); } });
    form.addEventListener("paste", (e) => { const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/")); if (imgs.length) upload(imgs); });
    form.addEventListener("dragover", (e) => e.preventDefault());
    form.addEventListener("drop", (e) => { e.preventDefault(); upload([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"))); });
    R("files").addEventListener("change", (e) => { upload(e.target.files); e.target.value = ""; });
    R("preview").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { attachments.splice(+b.dataset.rm, 1); upload([]); } });
    R("canned").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) { ta.value = b.dataset.c; ta.focus(); ta.dispatchEvent(new Event("input")); sfx("tick"); } });
    R("jump").addEventListener("click", toBottom);
    R("replybar").addEventListener("click", (e) => { if (e.target.closest("[data-cancel-reply]")) { setReply(null); sfx("close"); } });
    log.addEventListener("click", (e) => { const q = e.target.closest("[data-jump]"); if (!q) return; const el = log.querySelector(`.msg[data-id="${q.dataset.jump}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } });
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape" && replyTo) { e.stopPropagation(); setReply(null); } });
    log.addEventListener("scroll", () => { if (nearBottom()) R("jump").hidden = true; });
    root.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b && root.contains(b)) act(b.dataset.act); });

    load();
    timer = setInterval(() => document.visibilityState === "visible" && root.isConnected && load(true), 4000);
    return { destroy() { clearInterval(timer); }, reload: () => { root._headSig = ""; return load(true); } };
  }

  // 全站右鍵選單：在客服單訊息上按右鍵
  if (!App._tvCtx) App._tvCtx = true, App.ctxProviders.push((target) => {
    const el = target.closest(".chat .msg[data-id]"); if (!el) return null;
    const root = el.closest("[data-tv-root]"); const v = root && root._tv; if (!v) return null;
    const m = v.msgInfo(el); const items = [{ head: `${m.name} · #${m.id}` }];
    if (!m.deleted) items.push({ icon: "back", label: t("tk.reply"), key: "R", act: () => v.setReply(m) },
      { icon: "message", label: t("tk.quote"), act: () => v.insertText(m.full.split("\n").map((l) => "> " + l).join("\n") + "\n") },
      { icon: "copy", label: t("ctx.copy"), act: () => App.copy(m.full) },
      { icon: "clip", label: t("tk.copyWithMeta"), act: () => App.copy(`[#${v.id} · ${m.name} · ${m.time}]\n${m.full}`) });
    if (v.staff && !m.deleted) items.push({ icon: "send", label: t("tk.forward"), act: () => v.forwardMsg(m) });
    items.push({ sep: true }, { icon: "check", label: t("tk.markRead"), act: () => v.markRead(m.id) }, { icon: "eye", label: t("tk.markUnread"), act: () => v.markRead(m.id, true) });
    if (v.staff && m.author && App.me && m.author !== App.me.id && v.data && v.data.owner_mc && m.author === v.data.owner.id) items.push({ icon: "user", label: t("tk.viewPlayer", { name: v.data.owner_mc.name }), act: () => App.openPlayerByName ? App.openPlayerByName(v.data.owner_mc.name) : App.go(`/player?name=${encodeURIComponent(v.data.owner_mc.name)}`) });
    if (!m.deleted && (v.staff || m.mine)) items.push({ sep: true }, { icon: "trash", label: t("tk.deleteMsg"), danger: true, act: () => v.deleteMsg(m) });
    return items;
  });

  if (!App._tvCtx2) App._tvCtx2 = true, App.ctxProviders.push((target) => {
    if (target.closest(".msg[data-id]") || target.closest("input, textarea")) return null;
    const root = target.closest("[data-tv-root]"); const v = root && root._tv; if (!v || !v.data) return null;
    const tk = v.data.ticket; const items = [{ head: `#${tk.id} · ${tk.subject}` }, { icon: "refresh", label: t("tk.refresh"), act: () => v.reload() }, { icon: "up", label: t("tk.toLatest"), act: () => v.toBottom() }];
    if (v.staff) {
      const mine = v.data.claimed && v.data.claimed.id === App.me.id;
      items.push({ sep: true }, { icon: "user", label: t(mine ? "tk.unclaim" : "tk.claim"), act: () => v.act("claim") },
        ...["urgent", "high", "normal", "low"].filter((p) => p !== tk.priority).map((p) => ({ icon: "flag", label: `${t("tk.priority")}：${t("pr." + p)}`, act: () => v.act("priority", p) })),
        { icon: "edit", label: t("tk.toggleInternal"), act: () => v.toggleInternal() });
      if (v.data.logs && v.data.logs.length) items.push({ icon: "history", label: t("tk.logs"), act: () => v.showLogs() });
    }
    items.push({ icon: "link", label: t("ctx.copyLink"), act: () => App.copy(`${location.origin}/ticket?id=${tk.id}`) });
    if (tk.status !== "closed") items.push({ sep: true }, { icon: "x", label: t("tk.closeBtn"), danger: true, act: () => v.closeDialog() });
    else items.push({ sep: true }, { icon: "refresh", label: t("tk.reopen"), act: () => v.act("reopen") });
    if (document.querySelector(".desk")) items.push({ sep: true }, ...window.DeskLayout.ctxItems());
    return items;
  });

  App.TicketView = { mount, CAT_ICON };
})();
