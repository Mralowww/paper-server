(() => {
  const { $, esc, t, sound, sfx, store } = App;
  const CATS = [
    ["ui", "cursor", ["hover", "click", "switch", "toggleOn", "popup", "copy"]],
    ["notify", "bell", ["success", "receive", "send", "error"]],
    ["ambient", "music", null],
  ];
  function renderCats() {
    $("#snd-cats").innerHTML = CATS.map(([c, ic]) => `
      <div class="snd-cat ${sound.on(c) ? "" : "off"}" data-cat="${c}">
        <div class="txt"><b>${App.icon(ic, 16)}${esc(t("snd." + c))}</b><small>${esc(t("snd." + c + ".d"))}</small></div>
        <label class="switch"><input type="checkbox" data-snd-cat="${c}" ${sound.on(c) ? "checked" : ""}><span></span></label>
        <div class="ctl"><input type="range" min="0" max="100" step="1" value="${Math.round(sound.vol(c) * 100)}" data-snd-vol="${c}">
          <span class="mono">${Math.round(sound.vol(c) * 100)}%</span>
          <button class="btn sm" data-snd-test="${c}">${c === "ambient" ? (sound.playing ? t("snd.playing") : t("set.test")) : t("set.test")}</button></div>
      </div>`).join("");
  }
  document.addEventListener("app:ready", () => {
    const snd = $("#sound"); const vol = $("#volume"); const lang = $("#lang"); const motion = $("#motion");
    snd.checked = sound.enabled; vol.value = Math.round(sound.volume * 100); lang.value = App.lang;
    motion.checked = document.documentElement.dataset.motion === "reduce";
    const label = () => ($("#vol-label").textContent = vol.value + "%");
    const masterState = () => $("#snd-master").classList.toggle("off", !sound.enabled);
    label(); masterState(); renderCats(); App.observe();
    snd.addEventListener("change", () => { sound.enabled = snd.checked; masterState(); if (snd.checked) sfx("toggleOn"); });
    vol.addEventListener("input", () => { label(); sound.volume = vol.value / 100; });
    vol.addEventListener("change", () => sfx("click"));

    const cats = $("#snd-cats");
    cats.addEventListener("change", (e) => {
      const c = e.target.dataset.sndCat; if (!c) return;
      sound.set(c, { on: e.target.checked });
      e.target.closest(".snd-cat").classList.toggle("off", !e.target.checked);
      sfx(e.target.checked ? "toggleOn" : "toggleOff");
    });
    cats.addEventListener("input", (e) => {
      const c = e.target.dataset.sndVol; if (!c) return;
      sound.set(c, { vol: e.target.value / 100 });
      e.target.nextElementSibling.textContent = e.target.value + "%";
    });
    cats.addEventListener("click", (e) => {
      const b = e.target.closest("[data-snd-test]"); if (!b) return;
      const c = b.dataset.sndTest; const def = CATS.find(([k]) => k === c);
      if (!sound.enabled) { sound.enabled = true; snd.checked = true; masterState(); }
      if (!sound.on(c)) { sound.set(c, { on: true }); renderCats(); }
      if (c === "ambient") return;
      def[2].forEach((n, i) => setTimeout(() => sfx(n), 60 + i * 420));
    });
    document.addEventListener("soundchange", () => {
      const b = $('[data-snd-test="ambient"]'); if (b) b.textContent = sound.playing ? t("snd.playing") : t("set.test");
    });

    const th = $("#theme"); th.value = App.theme; th._sync && th._sync();
    th.addEventListener("change", () => App.setTheme(th.value));
    document.addEventListener("themechange", () => { th.value = App.theme; th._sync && th._sync(); });
    lang.addEventListener("change", () => { App.setLang(lang.value); App.ok(App.t("saved"), "", 1200); });
    motion.addEventListener("change", () => {
      store.set("motion", motion.checked); sfx(motion.checked ? "toggleOff" : "toggleOn");
      if (motion.checked) document.documentElement.dataset.motion = "reduce"; else delete document.documentElement.dataset.motion;
    });
  });
  document.addEventListener("langchange", renderCats);
})();
