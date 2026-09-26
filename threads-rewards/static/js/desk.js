/* 客服工作台：獨立分頁、全螢幕處理客服單（清單 + 對話） */
(() => {
  const { $, $$, esc, t, api, ago, sfx, date } = App;
  const FILTERS = ["active", "open", "answered", "mine", "closed"];
  let filter = App.store.get("dk.filter", "active"); let q = ""; let list = []; let selected = 0; let view = null; let known = null; let timer;

  function empty() {
    $("#dk-view").innerHTML = `<div class="desk-empty">${ART.icon("message", 44)}<b>${t("dk.pick")}</b><small>${t("dk.pickHint")}</small></div>`;
  }
  /* ---------- 個人排序（拖曳上下移動，存在這台裝置） ---------- */
  const getOrder = () => App.store.get("dk.order", []);
  const setOrder = (ids) => App.store.set("dk.order", ids.slice(0, 300));
  function applyOrder(rows) {
    const order = getOrder(); const pos = new Map(order.map((id, i) => [id, i]));
    return rows.map((x, i) => ({ x, i })).sort((a, b) => (pos.has(a.x.id) ? pos.get(a.x.id) : 1e6 + a.i) - (pos.has(b.x.id) ? pos.get(b.x.id) : 1e6 + b.i)).map((o) => o.x);
  }
  function moveTo(id, index) {
    const ids = list.map((x) => x.id).filter((x) => x !== id); ids.splice(Math.max(0, Math.min(ids.length, index)), 0, id);
    setOrder(ids); list = applyOrder(list); $("#dk-items").innerHTML = list.map(itemHTML).join(""); sfx("tick");
  }
  function itemHTML(x) {
    const pinned = getOrder().includes(x.id);
    return `<button class="dk-item ${pinned ? "ordered" : ""} ${x.id === selected ? "on" : ""} ${x.unread ? "unread" : ""}" data-id="${x.id}" data-cat="${x.category}">
      <span class="dk-grip" title="${t("dk.drag")}">${ART.icon("dots", 14)}</span><img src="${esc(x.user.avatar)}" alt="">
      <span class="dk-mid"><span class="dk-top"><b>${esc(x.subject)}</b><small>${ago(x.updated_at)}</small></span>
        <span class="dk-last"><b>${esc(x.user.name)}</b>：${esc(x.last_body || "")}</span>
        <span class="dk-bot"><span class="dk-cat">${ART.icon(App.TicketView.CAT_ICON[x.category], 13)}${t("cat." + x.category)}</span><span class="mono">#${x.id}</span>
          ${x.priority && x.priority !== "normal" ? `<span class="tag ${x.priority === "urgent" ? "red" : x.priority === "high" ? "warn" : "gray"}">${t("pr." + x.priority)}</span>` : ""}
          <span class="dk-st ${x.status}">${t("st." + x.status)}</span></span></span>
      ${x.unread ? `<i class="dk-badge">${x.unread}</i>` : ""}</button>`;
  }
  async function load() {
    const status = filter === "mine" ? "active" : filter;
    const d = await api(`/api/staff/tickets?status=${status}&q=${encodeURIComponent(q)}${filter === "mine" ? "&mine=1" : ""}`, { quiet: true });
    list = applyOrder(d.tickets); const c = d.counts;
    // 新進客服單：音效 + 標題計數
    const ids = new Set(list.map((x) => x.id));
    if (known && [...ids].some((id) => !known.has(id))) sfx("receive");
    known = ids;
    const unread = list.reduce((a, x) => a + (x.unread ? 1 : 0), 0);
    document.title = (unread ? `(${unread}) ` : "") + t("dk.title") + " · 鋸齒 SMP";
    $("#dk-stats").innerHTML = [["st.open", c.open || 0, "open"], ["st.answered", c.answered || 0, "answered"], ["dk.unread", unread, "unread"]]
      .map(([k, n, cls]) => `<span class="dk-stat ${cls}"><b>${n}</b>${t(k)}</span>`).join("");
    $("#dk-f").innerHTML = FILTERS.map((f) => `<button data-f="${f}" class="${f === filter ? "on" : ""}">${t("dk.f." + f)}</button>`).join("");
    if (!dragging) $("#dk-items").innerHTML = list.map(itemHTML).join("") || `<div class="desk-none">${t("sup.empty")}</div>`;
  }

  // 拖曳：按住握把（或長按清單項目）上下移動
  let dragging = null;
  function startDrag(e, item) {
    const box = $("#dk-items"); const rect = item.getBoundingClientRect(); const startY = e.clientY;
    const items = [...box.querySelectorAll(".dk-item")]; const h = rect.height + 4; const from = items.indexOf(item);
    dragging = { item, from, to: from };
    item.classList.add("dragging"); box.classList.add("sorting"); item.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const dy = ev.clientY - startY; item.style.transform = `translateY(${dy}px) scale(1.02)`;
      const to = Math.max(0, Math.min(items.length - 1, from + Math.round(dy / h)));
      if (to !== dragging.to) { dragging.to = to; sfx("tick"); }
      items.forEach((el, i) => { if (el === item) return; let shift = 0;
        if (from < to && i > from && i <= to) shift = -h; if (from > to && i < from && i >= to) shift = h;
        el.style.transform = shift ? `translateY(${shift}px)` : ""; });
      // 靠近邊緣自動捲動
      const br = box.getBoundingClientRect(); if (ev.clientY < br.top + 40) box.scrollTop -= 8; else if (ev.clientY > br.bottom - 40) box.scrollTop += 8;
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      items.forEach((el) => (el.style.transform = "")); item.classList.remove("dragging"); box.classList.remove("sorting");
      const { from: f, to } = dragging; dragging = null; item._justDragged = f !== to;
      if (f !== to) moveTo(+item.dataset.id, to);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }

  /* ---------- 版面：收起側欄 / 上方資訊 / 下方快捷列 ---------- */
  const LAYOUT = ["side", "top", "bottom"];
  const collapsed = (k) => App.store.get("dk.c." + k, false);
  function applyLayout() {
    const d = $(".desk"); LAYOUT.forEach((k) => d.classList.toggle("c-" + k, collapsed(k)));
    $$(".dk-lay").forEach((b) => b.classList.toggle("on", !collapsed(b.dataset.lay)));
  }
  function toggleLayout(k) { App.store.set("dk.c." + k, !collapsed(k)); applyLayout(); sfx(collapsed(k) ? "toggleOff" : "toggleOn"); }
  window.DeskLayout = { ctxItems: () => LAYOUT.map((k, i) => ({ icon: { side: "list", top: "up", bottom: "chevron" }[k], label: t((collapsed(k) ? "dk.show." : "dk.hide.") + k), key: `Alt ${i + 1}`, act: () => toggleLayout(k) })) };
  function open(id, { push = true } = {}) {
    if (!id) { selected = 0; view && view.destroy(); view = null; empty(); return; }
    selected = id; if (push) history.replaceState(null, "", `#${id}`);
    $$("#dk-items .dk-item").forEach((x) => x.classList.toggle("on", +x.dataset.id === id));
    view && view.destroy();
    view = App.TicketView.mount($("#dk-view"), id, { desk: true, height: "100%", onChange: () => load().catch(() => {}), onDelete: () => { open(0); load(); } });
    $(`#dk-items .dk-item[data-id="${id}"]`)?.classList.remove("unread");
  }
  function step(dir) {
    const i = list.findIndex((x) => x.id === selected);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + dir))];
    if (next && next.id !== selected) { sfx("tick"); open(next.id); $(`#dk-items .dk-item[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" }); }
  }

  async function notifyButton() {
    const b = $("#dk-notify"); const P = window.PushNotify; const st = await P.state();
    b.className = "btn sm dk-nt " + st;
    b.innerHTML = `${ART.icon("bell", 15)}<span>${t("nt.st." + st)}</span>`;
    b.title = t("nt.desc");
  }
  async function allLogs() {
    const d = await api("/api/staff/ticket-logs");
    const o = App.modal({ wide: true, title: `${ART.icon("history", 18)} ${t("dk.logs")}`, body: `
      <input class="input" id="lq" placeholder="${t("staff.searchT")}" style="margin-bottom:10px">
      <div class="dk-logs" id="ll">${d.logs.map((l) => `<button class="dk-log" data-t="${l.id}" data-ticket="${l.ticket_id}">
        <span class="mono">#${l.ticket_id}</span><b>${esc(l.subject)}</b><small>${esc(l.owner_name || "")}</small>
        <span class="dim">${esc(l.reason || "—")}</span><small class="dim">${esc(l.closed_by_name || "")} · ${date(l.created_at)}</small></button>`).join("") || `<div class="empty">${t("dk.noLogs")}</div>`}</div>` });
    o.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      o.close(true); open(+b.dataset.ticket);
      const tryOpen = (n = 0) => { const v = $("#dk-view")._tv; if (v && v.staff !== undefined && v.staff) v.showLogs(+b.dataset.t); else if (n < 30) setTimeout(() => tryOpen(n + 1), 150); };
      tryOpen();
    });
    $("#lq", o.el).addEventListener("input", (e) => { const s = e.target.value.trim().toLowerCase(); $$(".dk-log", o.el).forEach((x) => { x.hidden = s && !x.textContent.toLowerCase().includes(s); }); });
  }

  // 清單右鍵：開啟、新分頁、認領、優先度、狀態、排序、已讀 / 未讀、關閉…
  const withView = (id, fn) => { open(id); const go = (n = 0) => { const v = $("#dk-view")._tv; if (v && v.data && v.id === id) fn(v); else if (n < 40) setTimeout(() => go(n + 1), 120); }; go(); };
  const setStatus = async (id, body) => { try { await api(`/api/tickets/${id}/status`, { method: "POST", body }); sfx("switch"); await load(); const v = $("#dk-view")._tv; if (v && v.id === id) v.reload(); } catch (e) { App.fail(e.message); } };
  if (!App._dkCtx) App._dkCtx = true, App.ctxProviders.push((target) => {
    const it = target.closest(".dk-item[data-id]"); if (!it || !document.querySelector(".desk")) return null;
    const id = +it.dataset.id; const x = list.find((r) => r.id === id) || {}; const idx = list.findIndex((r) => r.id === id);
    const read = async (unread) => { await api(`/api/tickets/${id}/read`, { method: "POST", body: { unread } }); sfx("tick"); load(); };
    const mine = x.claimed_by && App.me && x.claimed_by === App.me.id;
    const items = [{ head: `#${id} · ${x.subject || ""}` }, { icon: "message", label: t("dk.open"), key: "Enter", act: () => open(id) },
      { icon: "external", label: t("ctx.openLink"), act: () => window.open(`/desk#${id}`, "_blank") },
      { sep: true }, { icon: "user", label: t(mine ? "tk.unclaim" : "tk.claim"), act: () => setStatus(id, { claim: !mine }) },
      ...["urgent", "high", "normal", "low"].filter((p) => p !== (x.priority || "normal")).map((p) => ({ icon: "flag", label: `${t("tk.priority")}：${t("pr." + p)}`, act: () => setStatus(id, { priority: p }) })),
      ...(x.status === "open" ? [{ icon: "check", label: t("dk.markAnswered"), act: () => setStatus(id, { status: "answered" }) }] : x.status === "answered" ? [{ icon: "back", label: t("dk.markOpen"), act: () => setStatus(id, { status: "open" }) }] : []),
      { sep: true }, { icon: "up", label: t("dk.toTop"), act: () => moveTo(id, 0) },
      ...(idx > 0 ? [{ icon: "up", label: t("dk.moveUp"), act: () => moveTo(id, idx - 1) }] : []),
      ...(idx < list.length - 1 ? [{ icon: "chevron", label: t("dk.moveDown"), act: () => moveTo(id, idx + 1) }] : []),
      ...(getOrder().length ? [{ icon: "refresh", label: t("dk.resetOrder"), act: () => { setOrder([]); load(); } }] : []),
      { sep: true }, { icon: "check", label: t("tk.markRead"), act: () => read(false) }, { icon: "eye", label: t("tk.markUnread"), act: () => read(true) },
      { icon: "link", label: t("ctx.copyLink"), act: () => App.copy(`${location.origin}/ticket?id=${id}`) }, { icon: "copy", label: t("dk.copyId"), act: () => App.copy(`#${id}`) }];
    if (x.status !== "closed") items.push({ sep: true }, { icon: "x", label: t("tk.closeBtn"), danger: true, act: () => withView(id, (v) => v.closeDialog()) });
    else items.push({ sep: true }, { icon: "refresh", label: t("tk.reopen"), act: () => setStatus(id, { status: "open" }) });
    return items;
  });

  document.addEventListener("app:ready", async () => {
    if (!App.me) return App.go("/login?next=/desk");
    if ((App.me.level || 0) < 1) { $("#dk-view").innerHTML = `<div class="desk-empty">${t("adm.noAccess")}</div>`; return; }
    $("#dk-logs").innerHTML = `${ART.icon("history", 15)}<span>${t("dk.logs")}</span>`;
    notifyButton(); window.PushNotify.refresh();
    empty(); await load();
    const h = +location.hash.slice(1); if (h) open(h, { push: false });
    $("#dk-f").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; filter = b.dataset.f; App.store.set("dk.filter", filter); sfx("switch"); load(); });
    $("#dk-items").addEventListener("click", (e) => { const it = e.target.closest(".dk-item"); if (!it) return; if (it._justDragged) { it._justDragged = false; return; } sfx("click"); open(+it.dataset.id); });
    $("#dk-items").addEventListener("pointerdown", (e) => {
      const it = e.target.closest(".dk-item"); if (!it || e.button !== 0) return;
      if (e.target.closest(".dk-grip")) { e.preventDefault(); return startDrag(e, it); }
      // 滑鼠：按住並上下拖動超過 6px 也可排序；觸控請用握把，避免和捲動衝突
      if (e.pointerType !== "mouse") return;
      const y0 = e.clientY; const early = (ev) => { if (Math.abs(ev.clientY - y0) > 6) { cancel(); startDrag({ clientY: y0, pointerId: ev.pointerId }, it); } };
      const cancel = () => { removeEventListener("pointermove", early); removeEventListener("pointerup", cancel); };
      addEventListener("pointermove", early); addEventListener("pointerup", cancel);
    });
    $$(".dk-lay").forEach((b) => b.addEventListener("click", () => toggleLayout(b.dataset.lay)));
    // 上方收起時，點一下標題列就展開
    $("#dk-view").addEventListener("click", (e) => { if (collapsed("top") && e.target.closest(".tk-head")) toggleLayout("top"); });
    applyLayout();
    $("#dk-q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value.trim(); load(); }, 250); });
    $("#dk-logs").addEventListener("click", allLogs);
    $("#dk-notify").addEventListener("click", async () => {
      const P = window.PushNotify; const st = await P.state();
      try {
        if (st === "on") { await P.disable(); sfx("toggleOff"); }
        else if (st === "off") { await P.enable(P.kinds()); sfx("toggleOn"); App.ok(t("nt.onOk"), "", 1400); }
        else App.fail(t(st === "denied" ? "nt.deniedHelp" : "nt.unsupportedHelp"));
      } catch (err) { App.fail(err.message); }
      notifyButton();
    });
    window.addEventListener("hashchange", () => { const id = +location.hash.slice(1); if (id && id !== selected) open(id, { push: false }); });
    document.addEventListener("keydown", (e) => {
      if (e.altKey && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); toggleLayout(LAYOUT[+e.key - 1]); return; }
      if (e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.altKey && e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); step(1); }
      if (e.altKey && e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); step(-1); }
    });
    setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 6000);
  });
  document.addEventListener("langchange", () => { load(); notifyButton(); });
})();
