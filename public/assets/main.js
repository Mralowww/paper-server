/* Mc.Tierlist.Asia — shared site script */
(() => {
  const { t, fmtDate, fmtRelative } = window.I18N;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const icon = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    trophy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    sword: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
    globe: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    discord: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.9 19.9 0 0 0 6 3l1.3-2a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4-2 1 1.3 2a19.8 19.8 0 0 0 6-3c.5-5.1-.8-9.6-3.6-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>',
    booster: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#ff73fa" d="M12 2 20 8.5 12 22 4 8.5Z"/><path fill="#ffb3fc" d="M12 2 20 8.5H4Z"/></svg>',
    media: '<svg width="18" height="18" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" fill="#ff4d4d"/><path d="m10 9 5 3-5 3Z" fill="#fff"/></svg>',
  };

  const tierBadge = (tier, { retired = false, lg = false } = {}) => {
    const group = tier.slice(2);
    return `<span class="tier t${group}${tier.startsWith('LT') ? ' lt' : ''}${retired ? ' retired' : ''}${lg ? ' lg' : ''}" title="${retired ? `${t('common.retired')} · ` : ''}${tier}">${retired ? 'R' : ''}${tier}</span>`;
  };
  const regionName = (r) => (window.I18N.has(`region.${r}`) ? t(`region.${r}`) : r);
  const regionBadge = (r) => `<span class="region ${esc(r)}">${esc(regionName(r))}</span>`;
  const badgesHtml = (badges = []) => badges.map((b) => `<span class="badge-ico" title="${esc(t(`badge.${b}`))}">${icon[b] || ''}</span>`).join('');
  const TITLE_STYLE = {
    'Combat Grandmaster': 'grandmaster', 'Combat Master': 'master', 'Combat Ace': 'ace',
    'Combat Specialist': 'specialist', 'Combat Cadet': 'cadet', 'Combat Novice': 'novice', Rookie: 'rookie',
  };
  const avatarUrl = (name, size = 64) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;
  const discordAvatar = (id, hash) => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png');
  const fallbackImg = "this.onerror=null;this.src='https://mc-heads.net/avatar/MHF_Steve/64'";
  const loginUrl = () => `/auth/discord?next=${encodeURIComponent(location.pathname + location.hash)}`;
  const discordLink = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

  async function request(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { status: res.status, code: data.error });
    return data;
  }
  const api = (path) => request(`/api/site${path}`);

  // Current user (null when signed out); resolved once per page.
  const session = request('/api/me').catch(() => ({ user: null, permissions: {} }));

  function toast(msg, type = 'ok') {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    box.append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2800);
  }

  function levelChips(user) {
    const chips = [`<span class="role ${user.levelName}">${t(`level.${user.levelName}`)}</span>`];
    if (user.seniorTester) chips.push(`<span class="role tester">${t('level.senior')}</span>`);
    else if (user.tester) chips.push(`<span class="role tester">${t('level.tester')}</span>`);
    return chips.join(' ') + badgesHtml(user.badges);
  }

  // ---------- Chrome (nav + footer) ----------
  const brandHtml = '<img class="brand-cube" src="/assets/cube.svg" alt=""><span class="brand-text"><span class="brand-title">TIERLIST</span><span class="brand-sub">MC · ASIA</span></span>';

  function renderChrome(page) {
    const loader = document.createElement('div');
    loader.className = 'page-loader';
    document.body.prepend(loader);

    const links = [['home', '/', 'nav.home'], ['rankings', '/rankings', 'nav.rankings'], ['docs', '/docs', 'nav.docs']];
    const { LANGS, lang } = window.I18N;
    const current = LANGS.find((l) => l.id === lang);
    const nav = document.createElement('header');
    nav.className = 'nav';
    nav.innerHTML = `
      <div class="container nav-inner">
        <a class="brand" href="/" aria-label="Mc.Tierlist.Asia">${brandHtml}</a>
        <nav class="nav-links">${links.map(([id, href, key]) => `<a href="${href}" class="${id === page ? 'active' : ''}">${t(key)}</a>`).join('')}<span class="nav-extra"></span></nav>
        <div class="nav-right">
          <form class="nav-search" role="search">${icon.search}<input name="q" placeholder="${t('nav.search')}" autocomplete="off" aria-label="${t('nav.search')}"><kbd>/</kbd></form>
          <div class="dropdown lang-dd">
            <button class="btn btn-sm btn-ghost dd-toggle" aria-label="${t('nav.language')}">${icon.globe}<span>${current.short}</span>${icon.chevron}</button>
            <div class="dd-menu">${LANGS.map((l) => `<button data-lang="${l.id}" class="${l.id === lang ? 'active' : ''}">${l.label}</button>`).join('')}</div>
          </div>
          <div class="nav-user"><span class="skeleton" style="display:block;width:86px;height:34px;border-radius:10px"></span></div>
          <button class="btn btn-sm btn-ghost menu-btn" aria-label="${t('nav.menu')}">${icon.menu}</button>
        </div>
      </div>`;
    document.body.prepend(nav);

    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    $('.menu-btn', nav).addEventListener('click', () => nav.classList.toggle('open'));

    // Dropdowns: click to toggle, click outside to close.
    nav.addEventListener('click', (e) => {
      const toggle = e.target.closest('.dd-toggle');
      const dd = toggle?.closest('.dropdown');
      $$('.dropdown.open', nav).forEach((d) => { if (d !== dd) d.classList.remove('open'); });
      if (dd) dd.classList.toggle('open');
      const langBtn = e.target.closest('[data-lang]');
      if (langBtn) window.I18N.setLang(langBtn.dataset.lang);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) $$('.dropdown.open', nav).forEach((d) => d.classList.remove('open')); });

    const form = $('.nav-search', nav);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = form.q.value.trim();
      if (q) location.href = `/player/${encodeURIComponent(q)}`;
    });
    addEventListener('keydown', (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); form.q.focus(); }
    });

    session.then(({ user, permissions: perms }) => {
      const slot = $('.nav-user', nav);
      if (!user) {
        slot.innerHTML = `<a class="btn btn-sm btn-discord" href="${loginUrl()}">${icon.discord}<span>${t('nav.login')}</span></a>`;
        return;
      }
      const items = [['me', '/me', 'nav.me']];
      if (perms.testerPanel) items.push(['tester', '/tester', 'nav.tester']);
      if (perms.viewStaff) items.push(['admin', '/admin', 'nav.admin']);
      slot.innerHTML = `
        <div class="dropdown user-dd">
          <button class="dd-toggle user-chip"><img src="${discordAvatar(user.id, user.avatar)}" alt=""><span>${esc(user.username)}</span>${icon.chevron}</button>
          <div class="dd-menu">
            ${items.map(([, href, key]) => `<a href="${href}">${t(key)}</a>`).join('')}
            <button class="dd-logout">${t('nav.logout')}</button>
          </div>
        </div>`;
      $('.nav-extra', nav).innerHTML = items.map(([id, href, key]) => `<a href="${href}" class="${id === page ? 'active' : ''}">${t(key)}</a>`).join('');
      $('.dd-logout', slot).addEventListener('click', async () => {
        await fetch('/auth/logout', { method: 'POST' });
        location.href = '/';
      });
    });

    const footer = document.createElement('footer');
    footer.className = 'site';
    footer.innerHTML = `
      <div class="container inner">
        <a class="brand brand-sm" href="/">${brandHtml}</a>
        <div>© ${new Date().getFullYear()} Mc.Tierlist.Asia · ${t('footer.disclaimer')}</div>
        <div style="display:flex;gap:18px"><a href="/rankings">${t('nav.rankings')}</a><a href="/docs">${t('footer.docs')}</a></div>
      </div>`;
    document.body.append(footer);

    const loginError = new URLSearchParams(location.search).get('login_error');
    if (loginError) {
      toast(t(`login.error.${loginError}`), 'err');
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }

  // ---------- Effects ----------
  function initReveal() {
    const els = $$('.reveal:not(.in)');
    if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((el) => io.observe(el));
  }

  function initSpotlight() {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest?.('.spot');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  function countUp(el, to) {
    if (reduceMotion) { el.textContent = to.toLocaleString(); return; }
    const dur = 1400;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 4))).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Rising gold embers. */
  function particles(canvas) {
    if (!canvas || reduceMotion) return;
    const ctx = canvas.getContext('2d');
    let w, h, dpr, list = [];
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round((w * h) / 9000);
      while (list.length < target) list.push(spawn(true));
      list.length = target;
    };
    const spawn = (anywhere) => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 10,
      r: Math.random() * 1.8 + 0.4,
      vy: Math.random() * 0.45 + 0.15,
      vx: (Math.random() - 0.5) * 0.2,
      a: Math.random() * 0.6 + 0.2,
      t: Math.random() * Math.PI * 2,
      sq: Math.random() < 0.25, // a few pixel-square embers
    });
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    const loop = () => {
      requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of list) {
        p.t += 0.02; p.y -= p.vy; p.x += p.vx + Math.sin(p.t) * 0.15;
        if (p.y < -10) Object.assign(p, spawn(false));
        const fade = Math.min(1, p.y / (h * 0.35));
        ctx.globalAlpha = p.a * fade * (0.75 + Math.sin(p.t * 2) * 0.25);
        ctx.fillStyle = '#ffd46a';
        ctx.shadowColor = '#f2b52c'; ctx.shadowBlur = 8;
        if (p.sq) ctx.fillRect(p.x, p.y, p.r * 2, p.r * 2);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      }
    };
    addEventListener('resize', resize);
    resize(); loop();
  }

  // ---------- Leaderboard rendering ----------
  function rowHtml(p, i) {
    const top = p.rank <= 3 ? ` top r${p.rank}` : '';
    const v = p.tiers.vanilla;
    return `
      <a class="board-row reveal${top}" data-player="${esc(p.name)}" style="--d:${Math.min(i, 12) * 0.04}s" href="/player/${encodeURIComponent(p.name)}">
        <div class="rank-cell"><span class="n">${p.rank}.</span><img src="${avatarUrl(p.name)}" alt="" loading="lazy" onerror="${fallbackImg}"></div>
        <div class="player-cell">
          <div class="pname">${esc(p.name)}${badgesHtml(p.badges)}</div>
          <div class="psub">${icon.trophy.replace('width="20" height="20"', 'width="14" height="14"')} <b>${p.points}</b> ${t('common.pts')}${v.retired ? ` · ${t('common.retired')}` : ''}</div>
        </div>
        <div class="region-cell">${regionBadge(p.region)}</div>
        <div class="tier-cell">${tierBadge(v.tier, { retired: v.retired })}</div>
      </a>`;
  }

  const emptyHtml = (title, text, extra = '') => `
    <div class="empty reveal">
      <div>
        <div class="e-ico" style="margin:0 auto 18px">${icon.sword.replace(/20/g, '30')}</div>
        <h3>${title}</h3><p>${text}</p>${extra}
      </div>
    </div>`;

  /** Player card shown in the leaderboard popup and on /player/:name. */
  function playerCardHtml(p) {
    const v = p.tiers.vanilla;
    const group = v.tier.slice(2);
    const rankCls = p.rank <= 3 ? `r${p.rank}` : 'rn';
    let record;
    if (p.stats) {
      const { wins, losses } = p.stats;
      const rate = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;
      record = `
        <div class="pcard-record">
          <div><b class="win">${wins}</b><span>${t('card.wins')}</span></div>
          <div><b class="loss">${losses}</b><span>${t('card.losses')}</span></div>
          <div><b>${rate}%</b><span>${t('card.winrate')}</span></div>
        </div>`;
    } else {
      record = `<a class="pcard-locked" href="${loginUrl()}">${icon.discord}${t('card.loginToView')}</a>`;
    }
    return `
      <div class="pcard-avatar"><img src="${avatarUrl(p.name, 160)}" alt="" onerror="${fallbackImg}"></div>
      <h2 class="pcard-name">${esc(p.name)}${badgesHtml(p.badges)}</h2>
      <div class="title-pill ${TITLE_STYLE[p.title] || 'rookie'}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 22 10 12 22 2 10Z"/></svg>${esc(p.title)}</div>
      <div class="pcard-region">${esc(regionName(p.region))}</div>
      <a class="btn btn-sm pcard-namemc" href="https://namemc.com/profile/${encodeURIComponent(p.name)}" target="_blank" rel="noopener">NameMC <span aria-hidden="true">↗</span></a>
      <div class="pcard-label">POSITION <span>${t('card.position')}</span></div>
      <div class="pcard-pos">
        <div class="pos-rank ${rankCls}">${p.rank}.</div>
        <div class="pos-info">${icon.trophy.replace('width="20" height="20"', 'width="20" height="20" class="pos-trophy"')}<b>${t('card.overall')}</b><span>(${p.points} ${t('common.pts')})</span></div>
      </div>
      <div class="pcard-label">TIERS <span>${t('card.tiers')}</span></div>
      <div class="pcard-tiers">
        <div class="tier-tile t${group}${v.retired ? ' retired' : ''}" title="Vanilla${v.retired ? ` · ${t('common.retired')}` : ''}">
          <div class="tile-ico"><img src="/assets/vanilla.svg" alt="Vanilla"></div>
          <span>${v.retired ? 'R' : ''}${v.tier}</span>
        </div>
      </div>
      <div class="pcard-label">RECORD <span>${t('card.record')}</span></div>
      ${record}`;
  }

  async function openPlayerCard(name) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal pcard" role="dialog" aria-modal="true" aria-label="${esc(name)}">
      <button class="pcard-close" aria-label="${t('card.close')}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="pcard-body"><div class="skeleton" style="width:120px;height:120px;border-radius:50%;margin:10px auto 20px"></div><div class="skeleton" style="height:200px"></div></div></div>`;
    const close = () => { bg.classList.add('closing'); setTimeout(() => bg.remove(), 200); removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    $('.pcard-close', bg).addEventListener('click', close);
    addEventListener('keydown', onKey);
    document.body.append(bg);
    try {
      $('.pcard-body', bg).innerHTML = playerCardHtml(await api(`/players/${encodeURIComponent(name)}`));
    } catch (err) {
      $('.pcard-body', bg).innerHTML = emptyHtml(t(err.status === 404 ? 'empty.notFoundT' : 'empty.errT'), t('empty.errD')).replace('reveal', '');
    }
  }

  document.addEventListener('click', (e) => {
    const row = e.target.closest?.('[data-player]');
    if (!row || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openPlayerCard(row.dataset.player);
  });

  const skeletonRows = (n) => Array.from({ length: n }, () => '<div class="skeleton" style="height:72px;margin-bottom:8px"></div>').join('');

  const testsTable = (tests, cols) => `
    <div class="table-wrap"><table class="data">
      <thead><tr>${cols.map(([key]) => `<th>${t(key)}</th>`).join('')}</tr></thead>
      <tbody>${tests.map((x, i) => `<tr style="animation-delay:${Math.min(i, 20) * 0.02}s">${cols.map(([, fn]) => `<td>${fn(x)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  const resultCell = (x) => `${x.prev_tier ? tierBadge(x.prev_tier) : '<span class="tier t5">—</span>'} <span class="muted">→</span> ${tierBadge(x.new_tier)}`;
  const scoreCell = (x) => `<span class="mono"><b class="win">${x.wins}</b> – <b class="loss">${x.losses}</b></span>`;

  // ---------- Pages ----------
  const pages = {
    async home() {
      particles($('#particles'));
      const statEls = $$('[data-stat]');
      const list = $('#topList');
      list.innerHTML = skeletonRows(3);
      try {
        const [s, r] = await Promise.all([api('/stats'), api('/rankings/vanilla?limit=5')]);
        statEls.forEach((el) => countUp(el, s[el.dataset.stat] ?? 0));
        list.innerHTML = r.players.length ? r.players.map(rowHtml).join('') : emptyHtml(t('empty.soonT'), t('empty.soonD'));
      } catch {
        statEls.forEach((el) => { el.textContent = '—'; });
        list.innerHTML = emptyHtml(t('empty.errT'), t('empty.errD'));
      }
      initReveal();
    },

    async rankings() {
      const list = $('#board');
      const moreBtn = $('#loadMore');
      const state = { tier: '', search: new URLSearchParams(location.search).get('q') || '', offset: 0, limit: 50 };
      $('#boardSearch').value = state.search;

      async function load(reset) {
        if (reset) { state.offset = 0; list.innerHTML = skeletonRows(6); }
        const q = new URLSearchParams({ limit: state.limit, offset: state.offset });
        if (state.tier) q.set('tier', state.tier);
        if (state.search) q.set('search', state.search);
        try {
          const data = await api(`/rankings/vanilla?${q}`);
          const html = data.players.map((p, i) => rowHtml(p, i)).join('');
          const filtered = state.tier || state.search;
          if (reset) list.innerHTML = html || emptyHtml(t(filtered ? 'empty.noMatchT' : 'empty.soonT'), t(filtered ? 'empty.noMatchD' : 'empty.soonD'));
          else list.insertAdjacentHTML('beforeend', html);
          state.offset += data.players.length;
          moreBtn.hidden = state.offset >= data.total;
          $('#boardCount').textContent = t('rank.count', { n: data.total });
        } catch {
          list.innerHTML = emptyHtml(t('empty.errT'), t('empty.errD'));
        }
        initReveal();
      }

      $('#tierSelect').addEventListener('change', (e) => { state.tier = e.target.value; load(true); });
      let timer;
      $('#boardSearch').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.search = e.target.value.trim(); load(true); }, 250);
      });
      moreBtn.addEventListener('click', () => load(false));
      load(true);
    },

    async player() {
      const name = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
      const root = $('#profile');
      try {
        const p = await api(`/players/${encodeURIComponent(name)}`);
        document.title = `${p.name} · Mc.Tierlist.Asia`;
        root.innerHTML = `<div class="modal pcard pcard-page reveal">${playerCardHtml(p)}</div>`;
      } catch (err) {
        root.innerHTML = err.status === 404
          ? emptyHtml(t('empty.notFoundT'), esc(t('empty.notFoundD', { name })))
          : emptyHtml(t('empty.errT'), t('empty.errD'));
      }
      initReveal();
    },

    async me() {
      const root = $('#meRoot');
      const { user } = await session;
      if (!user) {
        root.innerHTML = emptyHtml(t('me.loginT'), t('me.loginD'),
          `<p style="margin-top:20px"><a class="btn btn-discord" href="${loginUrl()}">${icon.discord}${t('nav.loginDiscord')}</a></p>`);
        return initReveal();
      }
      try {
        const d = await request('/api/me/profile');
        const cd = d.cooldownUntil
          ? `<div class="num sm">${esc(fmtRelative(d.cooldownUntil))}</div><div class="lbl">${t('me.cooldown')}</div><div class="muted" style="font-size:13px;margin-top:4px">${esc(fmtDate(d.cooldownUntil))}</div>`
          : `<div class="num sm ok">✓</div><div class="lbl">${t('me.ready')}</div>`;
        const ticket = d.openTicket
          ? `<div class="num sm">${esc(d.openTicket.mc_name)}</div><div class="lbl">${t('me.openTicket')}</div>${d.guildId ? `<a class="btn btn-sm" style="margin-top:10px" href="${discordLink(d.guildId, d.openTicket.channel_id)}" target="_blank" rel="noopener">${t('me.openInDiscord')} ↗</a>` : ''}`
          : `<div class="num sm muted">—</div><div class="lbl">${t('me.openTicket')}</div>`;
        root.innerHTML = `
          <div class="me-head reveal">
            <img src="${discordAvatar(user.id, user.avatar)}" alt="">
            <div><h1>${esc(user.username)}</h1><div class="chips-row">${levelChips(user)}</div></div>
          </div>
          ${user.inGuild ? '' : `<div class="callout reveal" style="margin-bottom:18px">${t('me.notInGuild')}</div>`}
          <div class="me-grid">
            <div class="reveal">${d.player
              ? `<div class="modal pcard pcard-page">${playerCardHtml(d.player)}</div>`
              : emptyHtml(t('me.notLinkedT'), t('me.notLinkedD')).replace('reveal', '')}</div>
            <div class="me-side">
              <div class="kv2">
                <div class="stat spot reveal" style="--d:.05s">${cd}</div>
                <div class="stat spot reveal" style="--d:.1s">${ticket}</div>
              </div>
              <div class="panel-head reveal" style="margin:22px 0 12px"><h2 style="font-size:20px">${t('me.history')}</h2></div>
              <div class="card reveal">${d.tests.length ? testsTable(d.tests, [
                ['col.date', (x) => `<span class="muted">${esc(fmtDate(x.created_at))}</span>`],
                ['col.result', resultCell],
                ['col.score', scoreCell],
                ['col.tester', (x) => esc(x.tester_name || '—')],
              ]) : `<div class="card-pad muted">${t('me.noTests')}</div>`}</div>
            </div>
          </div>`;
      } catch {
        root.innerHTML = emptyHtml(t('empty.errT'), t('empty.errD'));
      }
      initReveal();
    },

    async tester() {
      const root = $('#testerRoot');
      const { user, permissions: perms } = await session;
      if (!user) {
        root.innerHTML = emptyHtml(t('nav.tester'), t('me.loginD'), `<p style="margin-top:20px"><a class="btn btn-discord" href="${loginUrl()}">${icon.discord}${t('nav.loginDiscord')}</a></p>`);
        return initReveal();
      }
      if (!perms.testerPanel) {
        root.innerHTML = emptyHtml(t('nav.tester'), t('tester.denied'));
        return initReveal();
      }
      try {
        const d = await request('/api/tester/overview');
        const stat = (value, label, delay) => `<div class="stat spot reveal" style="--d:${delay}s"><div class="num">${value}</div><div class="lbl">${label}</div></div>`;
        root.innerHTML = `
          <div class="panel-head reveal"><div><div class="kicker">Tester</div><h2>${t('nav.tester')}</h2><p>${t('tester.howto')}</p></div><div class="chips-row">${levelChips(user)}</div></div>
          <div class="stats" style="margin:0 0 26px">
            ${stat(d.totals.all, t('tester.total'), 0)}${stat(d.totals.week, t('tester.week'), 0.05)}
            ${stat(d.tickets.length, t('tester.open'), 0.1)}${stat(`<span style="font-size:22px">LT5 → ${d.maxTier}</span>`, t('tester.range'), 0.15)}
          </div>
          <div class="panel-head reveal"><h2 style="font-size:20px">${t('tester.queue')}</h2></div>
          <div class="card reveal" style="margin-bottom:26px">${d.tickets.length ? testsTable(d.tickets, [
            ['col.player', (x) => `<div class="cell-player"><img src="${avatarUrl(x.mc_name, 32)}" alt="">${esc(x.mc_name)}</div>`],
            ['col.type', (x) => `<span class="pill ${x.kind === 'high' ? 'high' : 'on'}">${t(`kind.${x.kind}`)}</span>`],
            ['col.current', (x) => (x.prev_tier ? tierBadge(x.prev_tier) : '<span class="muted">Unranked</span>')],
            ['col.waiting', (x) => `<span class="muted">${esc(fmtRelative(x.created_at))}</span>`],
            ['', (x) => (d.guildId ? `<a class="btn btn-sm" href="${discordLink(d.guildId, x.channel_id)}" target="_blank" rel="noopener">${t('me.openInDiscord')} ↗</a>` : '')],
          ]) : `<div class="card-pad muted">${t('tester.none')}</div>`}</div>
          <div class="panel-head reveal"><h2 style="font-size:20px">${t('tester.myTests')}</h2></div>
          <div class="card reveal">${d.tests.length ? testsTable(d.tests, [
            ['col.date', (x) => `<span class="muted">${esc(fmtDate(x.created_at))}</span>`],
            ['col.player', (x) => `<a class="cell-player" data-player="${esc(x.mc_name)}" href="/player/${encodeURIComponent(x.mc_name)}"><img src="${avatarUrl(x.mc_name, 32)}" alt="">${esc(x.mc_name)}</a>`],
            ['col.result', resultCell],
            ['col.score', scoreCell],
          ]) : `<div class="card-pad muted">${t('me.noTests')}</div>`}</div>`;
      } catch {
        root.innerHTML = emptyHtml(t('empty.errT'), t('empty.errD'));
      }
      initReveal();
    },

    docs() {
      $$('.code').forEach((block) => {
        const btn = $('.copy-btn', block);
        if (!btn) return;
        btn.textContent = t('common.copy');
        btn.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText($('pre', block).innerText); btn.textContent = t('common.copied'); }
          catch { btn.textContent = t('common.copyFailed'); }
          setTimeout(() => { btn.textContent = t('common.copy'); }, 1500);
        });
      });
      $$('.base-url').forEach((el) => { el.textContent = location.origin; });
      const links = $$('.docs nav a');
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      $$('.docs h2[id]').forEach((h) => io.observe(h));
      initReveal();
    },
  };

  window.MCTL = {
    $, $$, esc, icon, t, tierBadge, regionBadge, badgesHtml, avatarUrl, discordAvatar, toast, countUp, initReveal,
    session, levelChips, loginUrl, emptyHtml, testsTable, resultCell, scoreCell,
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.I18N.apply();
    const page = document.body.dataset.page;
    renderChrome(page);
    initSpotlight();
    if (pages[page]) pages[page]();
    else initReveal();
  });
})();
