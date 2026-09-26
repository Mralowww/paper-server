/* 社群短網址未開放時的頁面 */
(() => {
  const { $, t } = App;
  const NAMES = { discord: "Discord", dc: "Discord", ig: "Instagram", instagram: "Instagram", threads: "Threads" };
  const name = NAMES[location.pathname.replace(/\W/g, "").toLowerCase()] || "";
  function render() { $("#go-msg").textContent = t("go.msg", { name: name || "—" }); $("#go-eyebrow").textContent = (name ? name.toUpperCase() + " · " : "") + "SAW SMP"; }
  document.addEventListener("app:ready", render);
  document.addEventListener("langchange", render);
})();
