/* 兌換碼：登入 + 綁定 Minecraft + 在遊戲內線上 → 輸入代碼 → 插件在遊戲內發獎 */
(() => {
  const { $, esc, t, api, sfx, date, ago } = App;
  let st = null; let busy = false;
  const ok = (b) => `<span class="rd-dot ${b ? "on" : ""}">${ART.icon(b ? "check" : "x", 13)}</span>`;
  function checks() {
    const s = st || {};
    const rows = [
      [s.logged_in, t("rd.c.login"), s.logged_in ? "" : `<a class="btn sm gold" href="/login?next=/redeem">${t("nav.login")}</a>`],
      [s.linked, s.linked ? t("rd.c.linkedAs", { name: esc(s.mc_name) }) : t("rd.c.link"), s.logged_in && !s.linked ? `<a class="btn sm" href="/account">${t("rd.c.linkBtn")}</a>` : ""],
      [s.online, s.online ? t("rd.c.online") : t("rd.c.offline"), s.linked && !s.online ? `<span class="dim mono">sawsmp.me</span>` : ""],
    ];
    $("#rd-checks").innerHTML = rows.map(([b, txt, act], i) => `<div class="rd-check ${b ? "on" : ""}" style="--i:${i}">${ok(b)}<span>${txt}</span>${act || ""}</div>`).join("")
      + (s.plugin_online === false ? `<div class="rd-warn">${ART.icon("alert", 14)}${t("rd.c.plugin")}</div>` : "");
    $("#rd-go").disabled = busy || !(s.logged_in && s.linked && s.online);
  }
  const ST = { delivered: ["ok", "rd.st.delivered"], pending: ["warn", "rd.st.pending"], failed: ["bad", "rd.st.failed"] };
  const reason = (r) => r ? t("rd.r." + r) !== "rd.r." + r ? t("rd.r." + r) : r : "";
  function history() {
    const h = (st && st.history) || [];
    $("#rd-hist").innerHTML = !st || !st.logged_in ? `<div class="empty">${t("rd.c.login")}</div>` : h.length ? `<div class="rd-hlist">${h.map((x) => {
      const [c, k] = ST[x.status] || ST.failed;
      return `<div class="rd-hrow"><span class="rd-hic ${c}">${ART.icon(x.status === "delivered" ? "gift" : x.status === "pending" ? "clock" : "x", 16)}</span>
        <div><b>${esc(x.name || "—")}</b><small class="mono">${esc(x.code)}</small></div>
        <div class="rd-hmeta"><span class="tag ${c}">${t(k)}</span><small title="${date(x.created_at)}">${ago(x.created_at)}${x.status === "failed" && x.reason ? " · " + esc(reason(x.reason)) : ""}</small></div></div>`;
    }).join("")}</div>` : `<div class="empty">${t("rd.none")}</div>`;
  }
  async function load() { st = await api("/api/redeem/status", { quiet: true }); checks(); history(); }
  function result(kind, title, msg) {
    const r = $("#rd-result"); r.hidden = false; r.className = "rd-result " + kind;
    r.innerHTML = `<span class="rd-ric">${kind === "wait" ? `<i class="spinner"></i>` : ART.icon(kind === "ok" ? "gift" : "alert", 22)}</span><div><b>${title}</b>${msg ? `<small>${msg}</small>` : ""}</div>`;
  }
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    const code = $("#rd-code").value.replace(/\s+/g, "").toUpperCase(); if (!code) return $("#rd-code").focus();
    busy = true; checks(); result("wait", t("rd.sending"));
    try {
      const r = await api("/api/redeem", { method: "POST", body: { code }, quiet: true });
      result("wait", t("rd.delivering", { name: esc(r.reward.name) }), t("rd.stayOnline"));
      const t0 = Date.now(); let s = null;
      while (Date.now() - t0 < 75000) {
        await new Promise((res) => setTimeout(res, 1500));
        s = await api(`/api/redeem/${r.log_id}`, { quiet: true }).catch(() => null);
        if (s && s.status !== "pending") break;
      }
      if (s && s.status === "delivered") { result("ok", t("rd.done", { name: esc(r.reward.name) }), esc(r.reward.description || t("rd.checkGame"))); sfx("success"); App.confetti(120); $("#rd-code").value = ""; }
      else result("bad", t("rd.failed"), esc(reason(s && s.reason) || t("rd.r.timeout")));
      if (!(s && s.status === "delivered")) sfx("error");
    } catch (err) { result("bad", t("rd.failed"), esc(err.message)); sfx("error"); }
    finally { busy = false; load().catch(() => {}); }
  }
  document.addEventListener("app:ready", () => {
    load().catch((e) => App.fail(e.message));
    $("#rd-form").addEventListener("submit", submit);
    $("#rd-code").addEventListener("input", (e) => { const i = e.target; const p = i.selectionStart; i.value = i.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""); i.setSelectionRange(p, p); });
    const q = new URLSearchParams(location.search).get("code"); if (q) $("#rd-code").value = q.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
    setInterval(() => document.visibilityState === "visible" && !busy && load().catch(() => {}), 10000);
  });
  document.addEventListener("langchange", () => { checks(); history(); });
})();
