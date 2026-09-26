(() => {
  const id = +new URLSearchParams(location.search).get("id");
  document.addEventListener("app:ready", () => {
    if (!App.me) return App.go(`/login`);
    if (App.me.level >= 1) App.$("#back").href = "/admin#tickets";
    App.TicketView.mount(App.$("#tv"), id, { height: "56vh" });
    App.observe();
  });
})();
