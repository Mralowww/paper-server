/* Mc.Tierlist.Asia — UI polish: custom selects, command palette (Ctrl+K), lightbox, ripples */
(() => {
  const { t } = window.I18N;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  // ================================================================ custom select
  const TIER_DOT = { 1: 't1', 2: 't2', 3: 't3', 4: 't4', 5: 't5' };

  /** Replaces a native <select> with an animated, keyboard-friendly dropdown. The select stays the source of truth. */
  function enhanceSelect(select) {
    if (select.dataset.nice) return;
    select.dataset.nice = '1';
    const wrap = document.createElement('div');
    wrap.className = 'nsel';
    select.parentNode.insertBefore(wrap, select);
    wrap.append(select);
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nsel-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-label', select.getAttribute('aria-label') || '');
    const menu = document.createElement('div');
    menu.className = 'nsel-menu';
    menu.setAttribute('role', 'listbox');
    wrap.append(btn, menu);
    if (select.closest('.select-wrap')) select.closest('.select-wrap').classList.add('has-nsel');

    const optLabel = (o) => {
      const dot = o.value && /^[1-5]$/.test(o.value) ? `<span class="nsel-dot ${TIER_DOT[o.value]}"></span>` : '';
      return `${dot}<span>${esc(o.textContent)}</span>`;
    };
    let active = -1;
    const render = () => {
      const opts = [...select.options];
      const cur = select.selectedOptions[0];
      btn.innerHTML = `${cur ? optLabel(cur) : ''}<svg class="nsel-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
      menu.innerHTML = opts.map((o, i) => `<div class="nsel-opt ${o.selected ? 'sel' : ''} ${i === active ? 'act' : ''}" role="option" data-i="${i}" style="--i:${i}">${optLabel(o)}<svg class="nsel-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div>`).join('');
    };
    const open = () => {
      $$('.nsel.open').forEach((w) => w !== wrap && w.classList.remove('open'));
      active = select.selectedIndex;
      render();
      wrap.classList.add('open');
      place();
      addEventListener('scroll', onViewportChange, true);
      addEventListener('resize', onViewportChange);
    };
    // The menu is positioned against the viewport so modals and scroll containers can't clip it.
    const place = () => {
      const r = btn.getBoundingClientRect();
      const menuH = Math.min(300, menu.scrollHeight + 12);
      const up = window.innerHeight - r.bottom < menuH + 12 && r.top > menuH + 12;
      menu.style.left = `${r.left}px`;
      menu.style.width = `${Math.max(r.width, 170)}px`;
      menu.style.top = up ? `${r.top - menuH - 6}px` : `${r.bottom + 6}px`;
      wrap.classList.toggle('up', up);
    };
    const onViewportChange = (e) => { if (!menu.contains(e.target)) close(); };
    const close = () => {
      wrap.classList.remove('open');
      removeEventListener('scroll', onViewportChange, true);
      removeEventListener('resize', onViewportChange);
    };
    const choose = (i) => {
      if (i < 0 || i >= select.options.length) return;
      const changed = select.selectedIndex !== i;
      select.selectedIndex = i;
      render();
      close();
      btn.focus();
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // Inside a <label>, clicks would be forwarded to the hidden select and steal focus.
    wrap.addEventListener('click', (e) => e.preventDefault());
    btn.addEventListener('click', () => (wrap.classList.contains('open') ? close() : open()));
    menu.addEventListener('mousedown', (e) => e.preventDefault());
    menu.addEventListener('click', (e) => {
      const o = e.target.closest('.nsel-opt');
      if (o) choose(Number(o.dataset.i));
    });
    btn.addEventListener('keydown', (e) => {
      const isOpen = wrap.classList.contains('open');
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        if (!isOpen) return open();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + select.options.length) % select.options.length;
        render();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isOpen) choose(active); else open();
      } else if (e.key === 'Escape') close();
    });
    btn.addEventListener('blur', () => setTimeout(close, 120));
    select.addEventListener('change', render);
    render();
  }

  const enhanceAll = (root = document) => $$('select:not([data-nice])', root).forEach(enhanceSelect);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === 'SELECT') enhanceSelect(n); else enhanceAll(n); } });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ================================================================ lightbox
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.msg-images a, a:has(> img.thumb)');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const bg = document.createElement('div');
    bg.className = 'lightbox';
    bg.innerHTML = `<img src="${esc(a.href)}" alt=""><a class="lightbox-open" href="${esc(a.href)}" target="_blank" rel="noopener">↗</a>`;
    const close = () => { bg.classList.add('out'); setTimeout(() => bg.remove(), 220); removeEventListener('keydown', onKey); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    bg.addEventListener('click', (ev) => { if (!ev.target.closest('.lightbox-open')) close(); });
    addEventListener('keydown', onKey);
    document.body.append(bg);
  });

  // ================================================================ ripple
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn, .chip, .seg button, .side-nav button, .tier-picker button, .cat-option > span');
    if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = 'hidden';
    b.append(dot);
    setTimeout(() => dot.remove(), 650);
  });

  // ================================================================ command palette
  const ICONS = {
    go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    out: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  };
  const svg = (k) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  async function buildActions() {
    const { user, permissions: p } = await window.MCTL.session;
    const nav = (key, href, group = 'cmd.pages', icon = 'go') => ({ group, label: t(key), icon, run: () => { location.href = href; } });
    const list = [
      nav('nav.home', '/'), nav('nav.rankings', '/rankings'), nav('nav.support', '/support'), nav('nav.docs', '/docs'),
    ];
    if (user) {
      list.push(nav('nav.me', '/me', 'cmd.pages', 'user'));
      if (p.testerPanel) list.push(nav('nav.tester', '/tester'));
      list.push({ group: 'cmd.actions', label: t('support.new').replace(/^[＋+]\s*/, ''), icon: 'plus', run: () => { location.href = '/support#new'; } });
      if (p.giveResults) list.push({ group: 'cmd.actions', label: t('give.title'), icon: 'plus', run: () => { location.href = '/tester#give'; } });
    }
    if (p.viewStaff) {
      const tabs = [['overview', 'tab.overview'], ['players', 'tab.players'], ['bans', 'tab.bans'], ['support', 'tab.support'],
        ['tickets', 'tab.tickets'], ['tests', 'tab.tests'], ['team', 'tab.team'], ['storage', 'tab.storage']];
      if (p.manageKeys) tabs.push(['keys', 'tab.keys']);
      if (p.manageSettings) tabs.push(['settings', 'tab.settings'], ['site', 'tab.site'], ['perms', 'tab.perms']);
      tabs.forEach(([id, key]) => list.push({ group: 'cmd.staff', label: `${t('nav.admin')} · ${t(key)}`, icon: 'shield', run: () => { location.href = `/admin#${id}`; } }));
      if (p.viewAudit) list.push({ group: 'cmd.staff', label: t('nav.audit'), icon: 'search', run: () => { location.href = '/audit'; } });
    }
    list.push({ group: 'cmd.actions', label: t('cmd.copyIp'), hint: 'Mc.Tierlist.Asia', icon: 'copy', run: () => document.querySelector('[data-copy-ip]')?.click() });
    window.I18N.LANGS.forEach((l) => l.id !== window.I18N.lang && list.push({ group: 'cmd.actions', label: `${t('nav.language')}: ${l.label}`, icon: 'globe', run: () => window.I18N.setLang(l.id) }));
    if (user) list.push({ group: 'cmd.actions', label: t('nav.logout'), icon: 'out', run: async () => { await fetch('/auth/logout', { method: 'POST' }); location.href = '/'; } });
    else list.push({ group: 'cmd.actions', label: t('nav.loginDiscord'), icon: 'user', run: () => { location.href = window.MCTL.loginUrl(); } });
    return list;
  }

  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  function score(label, q) {
    const l = norm(label);
    if (!q) return 1;
    if (l.includes(q)) return 3 - l.indexOf(q) / 100;
    let i = 0;
    for (const ch of l) if (ch === q[i]) i++;
    return i === q.length ? 1 : 0;
  }

  let paletteOpen = false;
  async function openPalette(initial = '') {
    if (paletteOpen) return;
    paletteOpen = true;
    const actions = await buildActions();
    const bg = document.createElement('div');
    bg.className = 'cmdk-bg';
    bg.innerHTML = `
      <div class="cmdk" role="dialog" aria-modal="true">
        <div class="cmdk-input">${svg('search')}<input placeholder="${t('cmd.placeholder')}" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
        <div class="cmdk-list"></div>
        <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('cmd.navigate')}</span><span><kbd>Enter</kbd> ${t('cmd.select')}</span><span><kbd>${isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span></div>
      </div>`;
    document.body.append(bg);
    const input = $('input', bg);
    const listEl = $('.cmdk-list', bg);
    let items = [];
    let idx = 0;
    let players = [];
    let reqId = 0;

    const draw = () => {
      const q = norm(input.value);
      const matched = actions.map((a) => ({ ...a, s: score(a.label, q) })).filter((a) => a.s > 0).sort((a, b) => b.s - a.s);
      items = [];
      if (input.value.trim()) {
        players.forEach((pl) => items.push({ group: 'cmd.players', label: pl.name, hint: pl.tiers.vanilla.tier, avatar: pl.name, run: () => { location.href = `/player/${encodeURIComponent(pl.name)}`; } }));
        items.push({ group: 'cmd.players', label: t('cmd.searchPlayer', { q: input.value.trim() }), icon: 'search', run: () => { location.href = `/player/${encodeURIComponent(input.value.trim())}`; } });
      }
      const groups = ['cmd.pages', 'cmd.actions', 'cmd.staff'];
      groups.forEach((g) => matched.filter((a) => a.group === g).forEach((a) => items.push(a)));
      idx = Math.min(idx, Math.max(items.length - 1, 0));
      let lastGroup = '';
      listEl.innerHTML = items.length ? items.map((it, i) => {
        const head = it.group !== lastGroup ? `<div class="cmdk-group">${t(it.group)}</div>` : '';
        lastGroup = it.group;
        const ico = it.avatar ? `<img src="/heads/avatar/${encodeURIComponent(it.avatar)}/32.png" alt="">` : svg(it.icon || 'go');
        return `${head}<div class="cmdk-item ${i === idx ? 'act' : ''}" data-i="${i}" style="--i:${Math.min(i, 12)}">${ico}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</div>`;
      }).join('') : `<div class="cmdk-empty">${t('cmd.empty')}</div>`;
      $('.cmdk-item.act', listEl)?.scrollIntoView({ block: 'nearest' });
    };

    let timer;
    const searchPlayers = () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { players = []; return draw(); }
      timer = setTimeout(async () => {
        const my = ++reqId;
        try {
          const r = await fetch(`/api/site/rankings/vanilla?limit=5&search=${encodeURIComponent(q)}`).then((x) => x.json());
          if (my === reqId && paletteOpen) { players = r.players || []; draw(); }
        } catch { /* ignore */ }
      }, 180);
    };

    const close = () => {
      paletteOpen = false;
      bg.classList.add('out');
      setTimeout(() => bg.remove(), 180);
    };
    const run = (i) => { const it = items[i]; if (!it) return; close(); it.run(); };
    input.addEventListener('input', () => { idx = 0; draw(); searchPlayers(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        draw();
      } else if (e.key === 'Enter') { e.preventDefault(); run(idx); } else if (e.key === 'Escape') close();
    });
    listEl.addEventListener('mousemove', (e) => {
      const it = e.target.closest('.cmdk-item');
      if (it && Number(it.dataset.i) !== idx) { idx = Number(it.dataset.i); $$('.cmdk-item', listEl).forEach((x) => x.classList.toggle('act', x === it)); }
    });
    listEl.addEventListener('click', (e) => { const it = e.target.closest('.cmdk-item'); if (it) run(Number(it.dataset.i)); });
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    input.value = initial;
    draw();
    if (initial) searchPlayers();
    input.focus();
  }

  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });

  window.MCTL_UI = { openPalette, enhanceSelect, enhanceAll, isMac };
  document.addEventListener('DOMContentLoaded', () => enhanceAll());
})();
