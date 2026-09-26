/* 客服單對話元件（玩家端 /ticket 與後台客服單共用） */
(() => {
  const { $, $$, esc, t, api, date, sfx, mcHead, ptTag } = App;
  const CAT_ICON = { report: "flag", bug: "bug", connection: "wifi", sponsor: "gem", appeal: "scale", other: "message" };
  const STEP = { open: 1, answered: 2, closed: 3 };
  const FIELD_LABEL = { violation: "sup.violation", world: "sup.world", when: "sup.when", version: "sup.version", amount: "sup.amount" };

  function mount(root, id, opts = {}) {
    let data = null; let lastId = 0; let seen = new Set(); let attachments = []; let timer = null; let lastDay = "";
    root.innerHTML = `<div class="card chat" style="height:auto;padding:0;position:relative">
      <div data-r="head"><div class="skeleton sk-line" style="margin:24px;width:40%"></div></div>
      <div data-r="actions"></div>
      <div class="chat-log" data-r="log" style="height:${opts.height || "52vh"};border-top:1px solid var(--border)"></div>
      <button class="btn sm gold jump-new" data-r="jump" hidden>↓ ${t("tk.new")}</button>
      <form data-r="form" style="padding:14px 20px 16px;border-top:1px solid var(--border)">
        <div class="canned" data-r="canned" hidden></div>
        <div class="att-preview" data-r="preview" style="margin-bottom:8px"></div>
        <div class="composer"><label class="clip">${ART.icon("clip", 20)}<input type="file" accept="image/*" multiple hidden data-r="files"></label>
          <textarea name="body" rows="1" placeholder="${t("tk.inputPh")}"></textarea>
          <button class="send" type="submit" title="${t("tk.send")}">${ART.icon("send", 18)}</button></div>
        <div class="row" style="justify-content:space-between;margin-top:6px"><span class="composer-note">${t("tk.note")}</span>
          <label class="check" data-r="internal" hidden style="font-size:13px"><input type="checkbox" name="internal">${t("tk.internal")}</label></div>
      </form></div>`;
    const R = (k) => $(`[data-r="${k}"]`, root);
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
      return sep + `<div class="msg ${mine ? "mine" : ""} ${m.staff ? "staff" : ""} ${m.internal ? "internal" : ""}">
        <img class="av" src="${esc(a.avatar)}" alt="" data-user='${esc(JSON.stringify({ id: a.id, name: a.name }))}'>
        <div><div class="meta"><b style="color:var(--text)">${esc(a.name)}</b>${m.staff ? `<span class="tag gold" style="padding:0 6px;font-size:10.5px">STAFF</span>` : ""}${m.internal ? `<span class="tag yellow" style="padding:0 6px;font-size:10.5px">${t("tk.internal")}</span>` : ""}<span class="mono">${time}</span></div>
          <div class="bubble">${esc(m.body)}${m.attachments.length ? `<div class="atts">${m.attachments.map((u) => `<img src="${esc(u)}" alt="" data-zoom>`).join("")}</div>` : ""}</div></div></div>`;
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
          <div class="meta"><span class="mono">#${tk.id}</span><span>${t("cat." + tk.category)}</span>${data.staff ? `<span>${esc(data.owner.name)}</span>` : ""}<span>${date(tk.created_at)}</span>
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
          <select class="enhance" data-r="status">${["open", "answered", "closed"].map((s) => `<option value="${s}" ${tk.status === s ? "selected" : ""}>${t("st." + s)}</option>`).join("")}</select>
          <button class="btn" data-act="tban">${t(data.owner_banned ? "tk.unban" : "tk.ban")}</button>
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
      if (a === "close") { if (!(await App.confirm(t("tk.close") + "?"))) return; body = { status: "closed" }; }
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
        await api(`/api/tickets/${id}/messages`, { method: "POST", body: { body: text, attachments, internal: !!(form.internal && form.internal.checked) } });
        sfx("send"); ta.value = ""; ta.style.height = ""; attachments = []; R("preview").innerHTML = "";
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
    log.addEventListener("scroll", () => { if (nearBottom()) R("jump").hidden = true; });
    root.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b && root.contains(b)) act(b.dataset.act); });

    load();
    timer = setInterval(() => document.visibilityState === "visible" && root.isConnected && load(true), 4000);
    return { destroy() { clearInterval(timer); }, reload: () => { root._headSig = ""; return load(true); } };
  }

  App.TicketView = { mount, CAT_ICON };
})();
