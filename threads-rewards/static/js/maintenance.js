/* 維修中頁面：顯示維修範圍、預計恢復時間，恢復後自動重新整理 */
(() => {
  const { $, esc, t, api } = App;
  const path = location.pathname;
  let timer;
  function render(m) {
    $("#mt-msg").textContent = m.message || t(m.global ? "mt.msgAll" : "mt.msgPart");
    const pages = m.global ? [t("mt.all")] : m.pages.map((p) => t("mt.p." + p));
    const feats = m.global ? [] : m.features.map((f) => t("mt.f." + f));
    $("#mt-scope").innerHTML = [...pages, ...feats].map((x) => `<span>${esc(x)}</span>`).join("");
    $("#mt-home").hidden = m.global || path === "/";
    $("#mt-login").href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
    $("#mt-login").hidden = !!App.me;
    const eta = m.eta && new Date(m.eta);
    const box = $("#mt-eta"); clearInterval(timer);
    if (eta && !isNaN(eta)) {
      box.hidden = false;
      const tick = () => { const s = Math.max(0, Math.round((eta - Date.now()) / 1000));
        box.innerHTML = s ? `<small>${t("mt.eta")}</small><b class="mono">${[Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":")}</b><small>${eta.toLocaleString(App.lang === "zh" ? "zh-TW" : "en-US", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>` : `<b>${t("mt.soon")}</b>`; };
      tick(); timer = setInterval(tick, 1000);
    } else box.hidden = true;
    $("#mt-foot").textContent = App.me ? t("mt.noBypass", { name: App.me.name }) : t("mt.foot");
  }
  async function check() {
    try {
      const m = await api("/api/maintenance", { quiet: true });
      const key = { "/": "home", "/rankings": "rankings", "/player": "rankings", "/match": "match", "/support": "support", "/ticket": "support", "/rewards": "rewards", "/links": "rewards", "/account": "account", "/bans": "bans", "/news": "news", "/rules": "rules", "/docs": "docs", "/settings": "settings" }[path];
      const still = m.global || (key && m.pages.includes(key));
      if (!still && path !== "/maintenance-preview") { location.reload(); return; }
      render(m);
    } catch { /* 略過 */ }
  }
  document.addEventListener("app:ready", () => { check(); setInterval(check, 20000); });
  document.addEventListener("langchange", check);
})();
