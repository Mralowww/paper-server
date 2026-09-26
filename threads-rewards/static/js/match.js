(() => {
  const { $, esc, t, api, ago, mcHead, sfx } = App;
  let st = null; let lastKey = ""; let tick = null;
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const since = (iso) => (Date.now() - new Date(iso)) / 1000;

  function panel() {
    const me = App.me; let h = ""; let key = "";
    if (!me) { key = "login"; h = `<div class="mm-center"><div class="mm-orb idle">${ART.icon("sword", 44)}</div><h3>${t("mm.loginTitle")}</h3><p class="muted">${t("mm.loginD")}</p><a class="btn btn-discord lg" href="/auth/login?next=/match">${t("nav.login")}</a></div>`; }
    else if (!st.enabled) { key = "off"; h = `<div class="mm-center"><div class="mm-orb idle">${ART.icon("lock", 40)}</div><h3>${t("mm.disabled")}</h3></div>`; }
    else if (!st.linked) { key = "link"; h = `<div class="mm-center"><div class="mm-orb idle">${ART.icon("link", 40)}</div><h3>${t("mm.needLink")}</h3><p class="muted">${t("mm.needLinkD")}</p><a class="btn gold lg" href="/account">${t("acc.linkTitle")}</a></div>`; }
    else if (st.match) {
      const m = st.match; key = "match" + m.id + m.status;
      const vs = (p) => `<div class="mm-fighter"><img src="https://mc-heads.net/body/${p.uuid}/160" alt=""><b>${esc(p.name)}</b></div>`;
      h = `<div class="mm-center"><span class="tag ${m.status === "active" ? "red pulse" : "warn live"}">${t(m.status === "active" ? "mm.fighting" : "mm.teleporting")}</span>
        <div class="mm-vs">${vs(m.a)}<div class="mm-vs-mid"><span class="vs">VS</span><span class="mono mm-clock" data-since="${m.started_at || m.created_at}">0:00</span></div>${vs(m.b)}</div>
        <p class="muted">${t(m.status === "active" ? "mm.fightingD" : "mm.teleportingD", { m: st.time_limit })}</p>${m.world ? `<span class="tag">${esc(m.world)}</span>` : ""}</div>`;
    } else if (st.queued) {
      key = "queued";
      h = `<div class="mm-center"><div class="mm-radar"><i></i><i></i><i></i><img src="${mcHead(App.me.mc ? App.me.mc.uuid : "MHF_Steve", 72)}" alt=""></div>
        <h3>${t("mm.searching")}</h3><p class="mono mm-clock big" data-since="${st.queued}">0:00</p><p class="muted">${t("mm.inQueue", { n: st.queue_size })}</p>
        <button class="btn danger lg" id="leave">${t("mm.cancel")}</button></div>`;
    } else if (!st.online) {
      key = "offline";
      h = `<div class="mm-center"><div class="mm-orb idle">${ART.icon("server", 40)}</div><h3>${t("mm.needOnline")}</h3><p class="muted">${t("mm.needOnlineD")}</p>
        <button class="ip-chip" style="font-size:16px;padding:12px 20px" data-copy="sawsmp.me">${ART.icon("server", 18)}<span>sawsmp.me</span></button><p class="dim" style="font-size:12.5px;margin-top:14px">${t("mm.autoRefresh")}</p></div>`;
    } else {
      key = "idle";
      const last = st.last ? `<div class="mm-last ${st.last.draw ? "" : st.last.won ? "won" : "lost"}">${t("mm.lastResult")}：<b>${t(st.last.draw ? "pp.draw" : st.last.won ? "pp.win" : "pp.loss")}</b> · ${esc(st.last.a.name)} vs ${esc(st.last.b.name)} · ${ago(st.last.ended_at || st.last.created_at)}</div>` : "";
      h = `<div class="mm-center"><button class="mm-orb go" id="join"><span class="ring"></span><span class="ring r2"></span>${ART.icon("sword", 50)}<b>${t("mm.start")}</b></button>
        <h3>${t("mm.ready")}</h3><p class="muted">${t("mm.readyD", { m: st.time_limit })}</p>${last}</div>`;
    }
    if (key !== lastKey) { $("#panel").innerHTML = h; lastKey = key; App.observe($("#panel")); }
  }

  async function loadState() {
    if (App.me) { try { st = await api("/api/match/state", { quiet: true }); } catch { return; } } else st = { enabled: true };
    const prev = lastKey; panel();
    if (prev === "queued" && lastKey.startsWith("match")) { sfx("launch"); App.ok(t("mm.found"), t("mm.foundD")); }
    if (prev.startsWith("match") && lastKey === "idle" && st.last) { st.last.won ? (sfx("success"), App.confetti(120)) : sfx("close"); }
  }

  async function loadLive() {
    const d = await api("/api/match/live", { quiet: true });
    $("#mm-kpi").innerHTML = `<div><b>${d.online}</b><small>${t("home.online")}</small></div><div><b>${d.queue_size}</b><small>${t("mm.queue")}</small></div><div><b>${d.active.length}</b><small>${t("mm.liveN")}</small></div>`;
    $("#live-n").textContent = d.active.length;
    const row = (m, live) => `<div class="mm-row"><img src="${mcHead(m.a.uuid, 28)}" alt=""><b>${esc(m.a.name)}</b><span class="dim">vs</span><b>${esc(m.b.name)}</b><img src="${mcHead(m.b.uuid, 28)}" alt="">
      <span class="dim mono" style="margin-left:auto">${live ? `<span class="mm-clock" data-since="${m.started_at || m.created_at}">0:00</span>` : m.draw ? t("pp.draw") : ago(m.ended_at || m.created_at)}</span></div>`;
    $("#live").innerHTML = d.active.map((m) => row(m, true)).join("") || `<div class="dim" style="font-size:13.5px">${t("mm.noLive")}</div>`;
    $("#recent").innerHTML = d.recent.map((m) => row(m, false)).join("") || `<div class="dim" style="font-size:13.5px">—</div>`;
  }

  function clocks() { document.querySelectorAll("[data-since]").forEach((el) => (el.textContent = mmss(since(el.dataset.since)))); }

  document.addEventListener("app:ready", async () => {
    $("#rules").innerHTML = t("mm.ruleList").split("|").map((x) => `<li>${ART.icon("check", 15)}<span>${esc(x)}</span></li>`).join("");
    await Promise.all([loadState(), loadLive()]);
    tick = setInterval(clocks, 1000);
    setInterval(() => { if (document.visibilityState === "visible") { loadState(); loadLive().catch(() => {}); } }, 3000);
    $("#panel").addEventListener("click", async (e) => {
      if (e.target.closest("#join")) {
        const b = e.target.closest("#join"); b.classList.add("pressed");
        try { const r = await api("/api/match/queue", { method: "POST" }); sfx("send"); await loadState(); if (r.matched) { sfx("launch"); App.ok(t("mm.found"), t("mm.foundD")); } }
        catch (err) { b.classList.remove("pressed"); App.fail(err.message); }
      }
      if (e.target.closest("#leave")) { await api("/api/match/queue", { method: "DELETE" }); sfx("close"); loadState(); }
      const c = e.target.closest("[data-copy]"); if (c) App.copy(c.dataset.copy);
    });
  });
  document.addEventListener("langchange", () => { lastKey = ""; panel(); loadLive(); });
})();
