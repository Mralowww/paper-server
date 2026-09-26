(() => {
  const { $, $$, px, t, esc } = App;
  const showError = () => {
    const err = new URLSearchParams(location.search).get("error");
    $("#login-error").innerHTML = err ? `<div class="tag err" style="margin:6px 0 4px;white-space:normal">${esc(t("login.err." + err))}</div>` : "";
    if (err) { App.sfx("error"); $(".login-card").style.animation = "shake .5s"; }
  };
  document.addEventListener("app:ready", () => {
    if (App.me) return App.go("/links");
    $$("[data-px]").forEach((el) => (el.innerHTML = px(el.dataset.px, 18)));
    showError();
    $("#login-btn").addEventListener("click", () => { $("#login-btn").classList.add("loading"); App.sfx("send"); });
  });
  document.addEventListener("langchange", showError);
})();
