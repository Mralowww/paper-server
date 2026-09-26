(() => {
  const { $, sound, sfx, store } = App;
  document.addEventListener("app:ready", () => {
    const snd = $("#sound"); const vol = $("#volume"); const lang = $("#lang"); const motion = $("#motion");
    snd.checked = sound.enabled; vol.value = Math.round(sound.volume * 100); lang.value = App.lang;
    motion.checked = document.documentElement.dataset.motion === "reduce";
    const label = () => ($("#vol-label").textContent = vol.value + "%");
    label(); App.observe();
    snd.addEventListener("change", () => { sound.enabled = snd.checked; if (snd.checked) sfx("toggleOn"); });
    vol.addEventListener("input", label);
    vol.addEventListener("change", () => { sound.volume = vol.value / 100; sfx("click"); });
    $("#test").addEventListener("click", () => { ["click", "switch", "success", "receive", "copy"].forEach((n, i) => setTimeout(() => sfx(n), i * 380)); });
    const th = $("#theme"); th.value = App.theme; th._sync && th._sync();
    th.addEventListener("change", () => App.setTheme(th.value));
    document.addEventListener("themechange", () => { th.value = App.theme; th._sync && th._sync(); });
    lang.addEventListener("change", () => { App.setLang(lang.value); App.ok(App.t("saved"), "", 1200); });
    motion.addEventListener("change", () => {
      store.set("motion", motion.checked); sfx(motion.checked ? "toggleOff" : "toggleOn");
      if (motion.checked) document.documentElement.dataset.motion = "reduce"; else delete document.documentElement.dataset.motion;
    });
  });
})();
