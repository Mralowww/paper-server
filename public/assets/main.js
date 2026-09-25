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
    server: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
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
  const avatarUrl = (name, size = 64) => `/heads/avatar/${encodeURIComponent(name)}/${size}.png`;
  const discordAvatar = (id, hash) => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png');
  const fallbackImg = "this.onerror=null;this.src='/heads/avatar/MHF_Steve/64.png'";
  const loginUrl = () => `/auth/discord?next=${encodeURIComponent(location.pathname + location.hash)}`;
  const discordLink = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

  async function request(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { status: res.status, code: data.error });
    return data;
  }
  const api = (path) => request(`/api/site${path}`);

  /** JSON write helper for cookie-authenticated endpoints; throws a translated message. */
  async function send(url, method, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const key = `error.${data.error}`;
      throw new Error(window.I18N.has(key) ? t(key) : (data.message || t('common.error')));
    }
    return data;
  }

  const TIER_ORDER = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];

  // Current user (null when signed out); resolved once per page.
  const session = request('/api/me').catch(() => ({ user: null, permissions: {} }));

  function toast(msg, type = 'ok') {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const ico = type === 'err'
      ? '<path d="M12 8v5M12 16.5h.01"/><circle cx="12" cy="12" r="9"/>'
      : '<path d="m7 12 3.5 3.5L17 9"/><circle cx="12" cy="12" r="9"/>';
    el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ico}</svg><span></span><i class="toast-bar"></i>`;
    $('span', el).textContent = msg;
    box.append(el);
    const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
    const timer = setTimeout(remove, 3200);
    el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  }

  function levelChips(user) {
    const chips = [`<span class="role ${user.levelName}">${t(`level.${user.levelName}`)}</span>`];
    if (user.seniorTester) chips.push(`<span class="role tester">${t('level.senior')}</span>`);
    else if (user.tester) chips.push(`<span class="role tester">${t('level.tester')}</span>`);
    return chips.join(' ') + badgesHtml(user.badges);
  }

  // ---------- Announcements + staff preview bar (top of every page) ----------
  const ANN_KEY = 'mctl-ann-dismissed';
  const dismissed = () => { try { return JSON.parse(localStorage.getItem(ANN_KEY)) || []; } catch { return []; } };
  const annIcon = {
    gold: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
    warn: '<path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  };
  async function renderBanners(page) {
    let st;
    try { st = await request(`/api/status?page=${encodeURIComponent(page || '')}`); } catch { return; }
    const box = document.createElement('div');
    box.className = 'ann-stack';
    const gone = dismissed();
    const bars = st.announcements.filter((a) => !(a.dismissible && gone.includes(`${a.id}:${a.rev}`)));
    if (st.preview) {
      const when = st.gate.until ? fmtDate(st.gate.until) : '—';
      bars.unshift({ style: 'preview', text: t(st.gate.kind === 'launch' ? 'preview.launch' : 'preview.maint', { time: when }) });
    }
    if (!bars.length) return;
    box.innerHTML = bars.map((a) => `
      <div class="ann ann-${a.style}" data-ann="${a.id ? esc(`${a.id}:${a.rev}`) : ''}">
        <div class="container ann-inner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${annIcon[a.style] || annIcon.info}</svg>
          <span class="ann-text">${esc(a.text)}${a.link ? ` <a href="${esc(a.link)}"${a.link.startsWith('/') ? '' : ' target="_blank" rel="noopener"'}>${esc(a.linkText || a.link)} →</a>` : ''}</span>
          ${a.dismissible ? `<button class="ann-x" aria-label="${t('ann.close')}" title="${t('ann.close')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : ''}
        </div>
      </div>`).join('');
    document.body.prepend(box);
    box.addEventListener('click', (e) => {
      const x = e.target.closest('.ann-x');
      if (!x) return;
      const bar = x.closest('.ann');
      const keep = dismissed().filter((k) => st.announcements.some((a) => `${a.id}:${a.rev}` === k)); // prune old entries
      try { localStorage.setItem(ANN_KEY, JSON.stringify([...keep, bar.dataset.ann])); } catch { /* ignore */ }
      bar.style.height = `${bar.offsetHeight}px`;
      requestAnimationFrame(() => bar.classList.add('closing'));
      setTimeout(() => bar.remove(), 320);
    });
  }

  // ---------- Chrome (nav + footer) ----------
  const SERVER = 'Mc.Tierlist.Asia';
  const brandHtml = '<img class="brand-cube" src="/assets/cube.svg" alt=""><span class="brand-text"><span class="brand-title">TIERLIST</span><span class="brand-sub">MC · ASIA</span></span>';

  function renderChrome(page) {
    const loader = document.createElement('div');
    loader.className = 'page-loader';
    document.body.prepend(loader);

    const links = [['home', '/', 'nav.home'], ['rankings', '/rankings', 'nav.rankings'], ['support', '/support', 'nav.support'], ['docs', '/docs', 'nav.docs']];
    const { LANGS, lang } = window.I18N;
    const current = LANGS.find((l) => l.id === lang);
    const nav = document.createElement('header');
    nav.className = 'nav';
    nav.innerHTML = `
      <div class="container nav-inner">
        <a class="brand" href="/" aria-label="Mc.Tierlist.Asia">${brandHtml}</a>
        <nav class="nav-links">${links.map(([id, href, key]) => `<a href="${href}" class="${id === page ? 'active' : ''}">${t(key)}</a>`).join('')}<span class="nav-extra"></span></nav>
        <div class="nav-right">
          <button class="server-chip" data-copy-ip title="${t('server.copyHint')}">${icon.server}<span>${SERVER}</span></button>
          <form class="nav-search" role="search">${icon.search}<input name="q" placeholder="${t('nav.search')}" autocomplete="off" aria-label="${t('nav.search')}" readonly><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd></form>
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
    const palette = () => window.MCTL_UI?.openPalette();
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('mousedown', (e) => { e.preventDefault(); palette(); });
    form.q.addEventListener('focus', () => { form.q.blur(); palette(); });
    addEventListener('keydown', (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && !document.querySelector('.cmdk-bg')) { e.preventDefault(); palette(); }
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
          <div class="pname">${esc(p.name)}${badgesHtml(p.badges)}${p.banned ? `<span class="ban-tag">${t('ban.tag')}</span>` : ''}</div>
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
      ${p.banned ? `<div class="pcard-ban">⛔ ${t('ban.cardNote')}</div>` : ''}
      <div class="pcard-avatar${p.banned ? ' banned' : ''}"><img src="${avatarUrl(p.name, 160)}" alt="" onerror="${fallbackImg}"></div>
      <h2 class="pcard-name">${esc(p.name)}${badgesHtml(p.badges)}</h2>
      <div class="title-pill ${TITLE_STYLE[p.title] || 'rookie'}" title="${esc(p.title)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 22 10 12 22 2 10Z"/></svg>${esc(t(`title.${TITLE_STYLE[p.title] || 'rookie'}`))}</div>
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

  /** Count-up for record numbers and a subtle 3D tilt on the avatar. */
  function animateCard(root) {
    $$('.pcard-record b', root).forEach((b) => {
      const m = b.textContent.match(/^(\d+)(%?)$/);
      if (!m) return;
      const to = Number(m[1]);
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / 900);
        b.textContent = `${Math.round(to * (1 - (1 - p) ** 3))}${m[2]}`;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const av = $('.pcard-avatar', root);
    if (!av || reduceMotion) return;
    const card = av.closest('.pcard');
    card.addEventListener('pointermove', (e) => {
      const r = av.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) / r.width;
      const y = (e.clientY - (r.top + r.height / 2)) / r.height;
      av.style.transform = `perspective(500px) rotateY(${Math.max(-1, Math.min(1, x)) * 14}deg) rotateX(${Math.max(-1, Math.min(1, -y)) * 14}deg)`;
    });
    card.addEventListener('pointerleave', () => { av.style.transform = ''; });
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
      animateCard(bg);
    } catch (err) {
      $('.pcard-body', bg).innerHTML = emptyHtml(t(err.status === 404 ? 'empty.notFoundT' : 'empty.errT'), t('empty.errD')).replace('reveal', '');
    }
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest?.('[data-copy-ip]')) return;
    try { await navigator.clipboard.writeText(SERVER); toast(t('server.copied', { ip: SERVER })); }
    catch { toast(SERVER); }
  });

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

  // ---------- Support tickets (shared with the staff panel) ----------
  const CAT_ICONS = {
    bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6 13H2M22 13h-4M6.5 8.5 3 7M17.5 8.5 21 7M6.5 17.5 3 19M17.5 17.5 21 19"/>',
    appeal: '<path d="M12 3v18M5 21h14M3 7h18M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
    report: '<path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5"/>',
    other: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  };
  const catIcon = (c, size = 20) => `<span class="cat-ico ${c}"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${CAT_ICONS[c] || CAT_ICONS.other}</svg></span>`;
  const statusPill = (st) => `<span class="st-pill ${st}"><i></i>${t(`support.status.${st}`)}</span>`;
  const catLabel = (c) => t(`support.cat.${c}`);
  const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
  const STEPS = ['open', 'in_progress', 'closed'];
  const stepper = (st) => `<div class="stepper">${STEPS.map((x, i) => `<div class="step ${STEPS.indexOf(st) >= i ? 'done' : ''} ${x === st ? 'current' : ''}"><span>${i + 1}</span>${t(`support.status.${x}`)}</div>`).join('<div class="step-line"></div>')}</div>`;

  /** Chat thread. `mine(msg)` decides which side a message sits on. */
  function threadHtml(payload, mine) {
    return payload.messages.map((m, i) => `
      <div class="msg-row ${mine(m) ? 'mine' : ''}" style="animation-delay:${Math.min(i, 10) * 0.04}s">
        <img class="msg-avatar" src="${discordAvatar(m.author_id, m.author_avatar)}" alt="">
        <div class="msg ${m.is_staff ? 'staff' : ''}">
          <div class="msg-meta"><b>${esc(m.author_name || m.author_id)}</b>${m.is_staff ? `<span class="role admin">${t('support.staff')}</span>` : ''}<time>${esc(fmtDate(m.created_at))}</time></div>
          <div class="msg-body">${nl2br(m.body)}</div>
          ${m.attachments.length ? `<div class="msg-images">${m.attachments.map((a) => `<a href="/api/support/attachments/${a.id}" target="_blank" rel="noopener"><img src="/api/support/attachments/${a.id}" alt="${esc(a.orig_name || '')}" loading="lazy"></a>`).join('')}</div>` : ''}
        </div>
      </div>`).join('');
  }

  const dropZoneHtml = (max) => `
    <div class="drop-zone">
      <input type="file" name="files" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden data-max="${max}">
      <div class="drop-previews"></div>
      <button type="button" class="drop-add">${icon.image}<span>${t('support.addImages')}</span><small>${t('support.images', { n: max })}</small></button>
    </div>`;

  /** Image picker with previews, removal and drag & drop. Keeps input.files in sync. */
  function bindDropZone(root) {
    const zone = $('.drop-zone', root);
    if (!zone) return;
    const input = $('input[type=file]', zone);
    const max = Number(input.dataset.max) || 3;
    let files = [];
    const sync = () => {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      input.files = dt.files;
      $('.drop-previews', zone).innerHTML = files.map((f, i) => `
        <div class="drop-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" data-rm="${i}" aria-label="${t('common.delete')}">×</button></div>`).join('');
      $('.drop-add', zone).hidden = files.length >= max;
    };
    const add = (list) => {
      for (const f of list) {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast(t('error.invalid_file'), 'err'); continue; }
        if (f.size > 5 * 1024 * 1024) { toast(t('error.file_too_large'), 'err'); continue; }
        if (files.length >= max) { toast(t('error.too_many_files'), 'err'); break; }
        files.push(f);
      }
      sync();
    };
    $('.drop-add', zone).addEventListener('click', () => input.click());
    input.addEventListener('change', () => { const picked = [...input.files]; input.value = ''; add(picked); });
    zone.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { files.splice(Number(rm.dataset.rm), 1); sync(); }
    });
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', (e) => add([...e.dataTransfer.files]));
    zone.closest('form')?.addEventListener('paste', (e) => {
      const pasted = [...(e.clipboardData?.files || [])];
      if (pasted.length) add(pasted);
    });
  }

  async function postForm(url, form) {
    const res = await fetch(url, { method: 'POST', body: new FormData(form) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const key = `error.${data.error}`;
      throw new Error(window.I18N.has(key) ? t(key) : (data.message || t('common.error')));
    }
    return data;
  }

  function composerHtml() {
    return `<form class="composer">
      <textarea name="body" rows="3" maxlength="4000" placeholder="${t('support.replyPh')}" required></textarea>
      ${dropZoneHtml(3)}
      <div class="composer-bar"><span class="muted composer-hint">Ctrl + Enter</span><button class="btn btn-gold btn-sm">${t('support.send')}</button></div>
    </form>`;
  }

  function bindComposer(root, ticketId, onSent) {
    const form = $('.composer', root);
    if (!form) return;
    bindDropZone(form);
    $('textarea', form).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button.btn-gold', form);
      btn.disabled = true;
      try { await postForm(`/api/support/tickets/${ticketId}/messages`, form); onSent(); }
      catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    });
  }

  const ticketHeadHtml = (tk, extra = '') => `
    <div class="ticket-hero reveal in">
      ${catIcon(tk.category, 26)}
      <div class="ticket-hero-main">
        <div class="ticket-hero-meta"><span class="mono">#${tk.id}</span><span>${catLabel(tk.category)}</span><span>${esc(fmtDate(tk.created_at))}</span></div>
        <h2>${esc(tk.title)}</h2>
        ${stepper(tk.status)}
      </div>
      ${extra}
    </div>`;

  async function renderKeys(root) {
    let box = $('#keysBox', root);
    if (!box) {
      box = document.createElement('section');
      box.id = 'keysBox';
      box.className = 'keys-box reveal in';
      root.append(box);
    }
    const { keys } = await request('/api/me/keys');
    box.innerHTML = `
      <div class="panel-head"><div><h2 style="font-size:20px">${t('akey.title')}</h2><p>${t('akey.desc')} ${t('akey.docs')}</p></div></div>
      <form class="key-create" id="keyCreate"><input class="input" name="name" maxlength="48" placeholder="${t('akey.namePh')}" required><button class="btn btn-gold">${t('akey.create')}</button></form>
      <div id="newKey"></div>
      <div class="card">${keys.length ? keys.map((k) => `
        <div class="ticket-row"><span class="mono muted">${esc(k.prefix)}…</span>
          <span class="ticket-title"><b>${esc(k.name)}</b><span class="muted">${esc(fmtDate(k.created_at))} · ${t('col.lastUsed')} ${esc(fmtDate(k.last_used_at))} · ${t('col.calls')} ${k.usage_count}</span></span>
          <button class="btn btn-sm btn-danger" data-delkey="${k.id}">${t('common.delete')}</button></div>`).join('') : `<div class="card-pad muted">${t('akey.empty')}</div>`}</div>`;
    $('#keyCreate', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { key } = await send('/api/me/keys', 'POST', { name: e.target.name.value.trim() });
        await renderKeys(root);
        $('#newKey', box).innerHTML = `<div class="callout" style="margin:12px 0">${t('keys.createdD')}<div class="key-reveal" style="margin-top:10px"><span style="flex:1">${esc(key)}</span><button class="btn btn-sm" id="copyNewKey">${t('common.copy')}</button></div></div>`;
        $('#copyNewKey', box).addEventListener('click', async (ev) => {
          try { await navigator.clipboard.writeText(key); ev.target.textContent = t('common.copied'); } catch { toast(t('common.copyFailed'), 'err'); }
        });
      } catch (err) { toast(err.message, 'err'); }
    });
    box.onclick = async (e) => {
      const b = e.target.closest('[data-delkey]');
      if (!b || !window.confirm(`${t('akey.deleteT')}\n${t('akey.deleteD')}`)) return;
      try { await send(`/api/me/keys/${b.dataset.delkey}`, 'DELETE'); renderKeys(root); }
      catch (err) { toast(err.message, 'err'); }
    };
  }

  /** "Give a result" form for testers and admins. */
  function giveFormHtml(maxTier) {
    const allowed = TIER_ORDER.slice(TIER_ORDER.indexOf(maxTier));
    return `
      <form class="give-card reveal" id="giveForm">
        <div class="panel-head" style="margin-bottom:14px"><div><h2 style="font-size:20px">${t('give.title')}</h2><p>${t('give.desc')}</p></div></div>
        <div class="row2">
          <div class="field"><label>${t('players.mcName')}</label><input class="input" name="name" maxlength="16" placeholder="Steve" required></div>
          <div class="field"><label>${t('give.discordOpt')}</label><input class="input mono" name="discordId" inputmode="numeric"></div>
        </div>
        <div class="field"><label>${t('players.tier')}</label><div class="tier-picker">${allowed.map((x, i) => `<button type="button" data-t="${x}" class="${i === allowed.length - 1 ? 'active' : ''}">${x}</button>`).join('')}</div></div>
        <div class="row2">
          <div class="field"><label>${t('card.wins')}</label><input class="input mono" name="wins" type="number" min="0" max="99" value="0" required></div>
          <div class="field"><label>${t('card.losses')}</label><input class="input mono" name="losses" type="number" min="0" max="99" value="0" required></div>
        </div>
        <div class="modal-actions"><button class="btn btn-gold">${t('give.submit')}</button></div>
      </form>`;
  }

  function bindGiveForm(root, onDone) {
    const form = $('#giveForm', root);
    if (!form) return;
    let tier = $('.tier-picker .active', form)?.dataset.t;
    $('.tier-picker', form).addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      tier = b.dataset.t;
      $$('.tier-picker button', form).forEach((x) => x.classList.toggle('active', x === b));
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button.btn-gold', form);
      btn.disabled = true;
      try {
        const r = await send('/api/results', 'POST', { name: form.name.value.trim(), discordId: form.discordId.value.trim(),
          tier, wins: Number(form.wins.value), losses: Number(form.losses.value) });
        toast(t('give.done', { name: r.name, tier: r.tier }));
        if (r.botError) toast(t('give.botOff'), 'err');
        r.notes.forEach((n) => toast(n, 'err'));
        onDone?.();
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    });
  }

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
        animateCard(root);
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
        const { permissions: perms } = await session;
        if (perms.accountKeys) renderKeys(root);
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
          ${perms.giveResults ? giveFormHtml(d.maxTier) : ''}
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
        bindGiveForm(root, () => pages.tester());
        if (location.hash === '#give') setTimeout(() => $('#giveForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      } catch {
        root.innerHTML = emptyHtml(t('empty.errT'), t('empty.errD'));
      }
      initReveal();
    },

    async support() {
      const root = $('#supportRoot');
      const { user } = await session;
      if (!user) {
        root.innerHTML = emptyHtml(t('support.title'), t('support.loginD'),
          `<p style="margin-top:20px"><a class="btn btn-discord" href="${loginUrl()}">${icon.discord}${t('nav.loginDiscord')}</a></p>`);
        return initReveal();
      }

      async function showList() {
        history.replaceState(null, '', '/support');
        const d = await request('/api/support/tickets');
        const count = (st) => d.tickets.filter((x) => x.status === st).length;
        root.innerHTML = `
          <div class="support-hero reveal">
            <div>
              <div class="kicker">Support</div>
              <h2>${t('support.title')}</h2>
              <p>${t('support.subtitle')}</p>
            </div>
            ${d.blocked ? '' : `<button class="btn btn-gold" id="newTicket">${t('support.new')}</button>`}
          </div>
          ${d.blocked ? `<div class="callout reveal" style="margin-bottom:18px">${t('support.blocked')}${d.blockReason ? ` — ${esc(d.blockReason)}` : ''}</div>` : ''}
          <div class="support-stats reveal">
            ${STEPS.map((st) => `<div class="sstat ${st}"><b>${count(st)}</b><span>${t(`support.status.${st}`)}</span></div>`).join('')}
          </div>
          <div class="ticket-list">${d.tickets.length ? d.tickets.map((x, i) => `
            <a class="ticket-card reveal" style="--d:${Math.min(i, 10) * 0.04}s" href="#${x.id}" data-open="${x.id}">
              ${catIcon(x.category)}
              <span class="ticket-title"><b>${esc(x.title)}</b><span class="muted">#${x.id} · ${catLabel(x.category)} · ${esc(fmtRelative(x.updated_at))}</span></span>
              ${statusPill(x.status)}
              <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>
            </a>`).join('') : `<div class="support-empty reveal">
              <div class="support-empty-ico">${catIcon('other', 30)}</div>
              <h3>${t('support.empty')}</h3>
              ${d.blocked ? '' : `<button class="btn btn-gold" data-new>${t('support.new')}</button>`}
            </div>`}</div>`;
        root.onclick = (e) => {
          if (e.target.closest('#newTicket, [data-new]')) return showNew(d);
          const a = e.target.closest('[data-open]');
          if (a) { e.preventDefault(); showTicket(a.dataset.open); }
        };
        initReveal();
      }

      function showNew(d) {
        root.onclick = null;
        root.innerHTML = `
          <a href="/support" class="link-more back-link" id="backList">${t('support.back')}</a>
          <form class="new-ticket reveal in" id="ticketForm">
            <h2>${t('support.newTitle')}</h2>
            <div class="field"><label>${t('support.category')}</label>
              <div class="cat-picker">${d.categories.map((c, i) => `
                <label class="cat-option"><input type="radio" name="category" value="${c}" ${i === 0 ? 'checked' : ''}>
                  <span>${catIcon(c, 22)}<b>${catLabel(c)}</b></span></label>`).join('')}</div></div>
            <div class="field"><label>${t('support.subject')}</label><input class="input" name="title" maxlength="100" required></div>
            <div class="field"><label>${t('support.body')}</label><textarea class="input" name="body" rows="7" maxlength="4000" placeholder="${t('support.bodyPh')}" required></textarea></div>
            <div class="field">${dropZoneHtml(d.maxFiles)}</div>
            <div class="modal-actions"><button type="button" class="btn" id="cancelNew">${t('common.cancel')}</button><button class="btn btn-gold">${t('support.submit')}</button></div>
          </form>`;
        const form = $('#ticketForm');
        bindDropZone(form);
        const back = (e) => { e?.preventDefault(); showList(); };
        $('#backList').addEventListener('click', back);
        $('#cancelNew').addEventListener('click', back);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = $('button.btn-gold', form);
          btn.disabled = true;
          try {
            const { id } = await postForm('/api/support/tickets', form);
            toast(t('support.created'));
            showTicket(id);
          } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
        });
      }

      let lastCount = {};
      async function showTicket(id) {
        root.onclick = null;
        history.replaceState(null, '', `/support#${id}`);
        let d;
        try { d = await request(`/api/support/tickets/${id}`); } catch { return showList(); }
        const grew = lastCount[id] !== undefined && d.messages.length > lastCount[id];
        lastCount[id] = d.messages.length;
        const tk = d.ticket;
        root.innerHTML = `
          <a href="/support" class="link-more back-link" id="backList">${t('support.back')}</a>
          ${ticketHeadHtml(tk)}
          <div class="thread">${threadHtml(d, (m) => m.author_id === user.id)}</div>
          ${tk.status === 'closed' ? `<div class="callout">${t('support.closedNote')}</div>` : composerHtml()}`;
        $('#backList').addEventListener('click', (e) => { e.preventDefault(); showList(); });
        bindComposer(root, tk.id, () => showTicket(tk.id));
        const last = $('.thread .msg-row:last-child');
        if (grew && last) last.classList.add('msg-new');
        if (last && (grew || d.messages.length > 3)) last.scrollIntoView({ block: 'center', behavior: grew ? 'smooth' : 'auto' });
      }

      const route = async () => {
        const hashId = location.hash.slice(1);
        if (/^\d+$/.test(hashId)) return showTicket(hashId);
        await showList();
        if (hashId === 'new') $('#newTicket')?.click();
      };
      addEventListener('hashchange', route);
      route();
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
    send, giveFormHtml, bindGiveForm, statusPill, catLabel, catIcon, threadHtml, composerHtml, bindComposer, ticketHeadHtml, request,
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.I18N.apply();
    const page = document.body.dataset.page;
    renderChrome(page);
    renderBanners(page);
    initSpotlight();
    if (pages[page]) pages[page]();
    else initReveal();
  });
})();
