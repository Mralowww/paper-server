/* Mc.Tierlist.Asia — launch countdown / maintenance page */
document.addEventListener('DOMContentLoaded', () => {
  const { t, apply, setLang, LANGS, lang } = window.I18N;
  const G = window.GATE || { kind: 'maintenance' };
  const $ = (id) => document.getElementById(id);
  const skew = (G.now || Date.now()) - Date.now(); // trust the server clock
  const now = () => Date.now() + skew;
  const launch = G.kind === 'launch';

  apply();
  $('gEyebrow').textContent = t(launch ? 'gate.soon' : 'gate.maintenance');
  $('gTitle').innerHTML = launch ? 'Mc.Tierlist<span class="gold">.Asia</span>' : t('gate.maintTitle');
  $('gLead').textContent = launch ? t('gate.launchLead') : (G.reason || t('gate.maintLead'));
  $('gStaff').href = `/auth/discord?next=${encodeURIComponent(location.pathname + location.search)}`;
  $('gLangs').innerHTML = LANGS.map((l) => `<button data-lang="${l.id}" class="${l.id === lang ? 'active' : ''}">${l.label}</button>`).join('');
  $('gLangs').addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); });
  document.title = `${t(launch ? 'gate.soon' : 'gate.maintenance')} · Mc.Tierlist.Asia`;

  if (G.until) {
    const when = new Date(G.until).toLocaleString(lang, {
      timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    $('gWhen').textContent = t(launch ? 'gate.opensAt' : 'gate.backAt', { time: when });
    $('gClock').hidden = false;
  } else {
    $('gWhen').textContent = t('gate.autoReload');
  }

  const units = Object.fromEntries([...document.querySelectorAll('[data-u]')].map((el) => [el.dataset.u, el]));
  const set = (u, v) => {
    const s = String(v).padStart(2, '0');
    if (units[u].textContent === s) return;
    units[u].textContent = s;
    units[u].classList.remove('tick'); void units[u].offsetWidth; units[u].classList.add('tick');
  };
  let done = false;
  const reload = () => setTimeout(() => location.reload(), 600 + Math.random() * 2400); // spread the load at launch
  function tick() {
    if (!G.until || done) return;
    const left = Math.max(0, G.until - now());
    const sec = Math.floor(left / 1000);
    set('d', Math.floor(sec / 86400)); set('h', Math.floor(sec / 3600) % 24); set('m', Math.floor(sec / 60) % 60); set('s', sec % 60);
    if (left <= 0) {
      done = true;
      $('gEyebrow').textContent = t(launch ? 'gate.opened' : 'gate.maintDone');
      document.body.classList.add('gate-open');
      reload();
    }
  }
  tick();
  setInterval(tick, 250);

  // Staff may open/close things early: re-check every 30 s and reload once the page is available.
  const page = G.page || 'home';
  setInterval(async () => {
    try {
      const r = await fetch(`/api/status?page=${encodeURIComponent(page)}`, { headers: { Accept: 'application/json' } }).then((x) => x.json());
      if (!r.gate) { done = true; reload(); } else if (r.gate.until !== G.until) location.reload();
    } catch { /* offline — keep counting */ }
  }, 30000);
});
