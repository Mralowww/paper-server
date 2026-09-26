/* Mc.Tierlist.Asia — custom right-click menu (replaces the browser's context menu) */
(() => {
  const { t } = window.I18N;
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const SERVER = 'Mc.Tierlist.Asia';
  const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  const ICON = {
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    fwd: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    reload: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    all: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 12h8M8 9h8M8 15h5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    cmd: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    top: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    page: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  };
  const svg = (k) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, type) {
    if (window.MCTL?.toast) window.MCTL.toast(msg, type);
  }
  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label || t('ctx.copied'));
    } catch {
      toast(t('common.copyFailed'), 'err');
    }
  }
  async function copyImage(src) {
    try {
      const blob = await (await fetch(src)).blob();
      const png = blob.type === 'image/png' ? blob : await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          c.toBlob(resolve, 'image/png');
        };
        img.src = URL.createObjectURL(blob);
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast(t('ctx.imageCopied'));
    } catch {
      copy(new URL(src, location.href).href, t('ctx.linkCopied'));
    }
  }

  /** Minecraft player behind the clicked element, if any. */
  function playerAt(el) {
    const row = el.closest('[data-player]');
    if (row && NAME_RE.test(row.dataset.player)) return row.dataset.player;
    const a = el.closest('a[href]');
    const m = a && new URL(a.href, location.href).pathname.match(/^\/player\/([A-Za-z0-9_]{3,16})$/);
    if (m) return decodeURIComponent(m[1]);
    const img = el.closest('img');
    const h = img && img.getAttribute('src')?.match(/^\/heads\/(?:avatar|body)\/([A-Za-z0-9_]{3,16})\//);
    return h ? h[1] : null;
  }

  // ---------------------------------------------------------------- build the item list for a target
  function itemsFor(target) {
    const groups = [];
    const sel = String(getSelection() || '').trim();
    const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable=true]';
    const focused = document.activeElement?.matches?.(EDITABLE) ? document.activeElement : null;
    // Clicking an icon or padding next to the focused field still counts as the field.
    const edit = target.closest(EDITABLE) || (focused && focused.parentElement?.contains(target) ? focused : null);
    const link = target.closest('a[href]');
    const img = target.closest('img');
    const player = playerAt(target);

    if (player) {
      groups.push({ head: player, headImg: `/heads/avatar/${encodeURIComponent(player)}/32.png`, items: [
        { icon: 'user', label: t('ctx.openPlayer'), run: () => { location.href = `/player/${encodeURIComponent(player)}`; } },
        { icon: 'copy', label: t('ctx.copyName'), run: () => copy(player) },
        { icon: 'open', label: t('ctx.namemc'), run: () => open(`https://namemc.com/profile/${encodeURIComponent(player)}`, '_blank', 'noopener') },
      ] });
    }

    if (edit && !edit.readOnly && !edit.disabled) {
      const start = edit.selectionStart;
      const end = edit.selectionEnd;
      const hasSel = typeof start === 'number' && end > start;
      const text = hasSel ? edit.value.slice(start, end) : '';
      const put = (value) => {
        edit.focus();
        edit.setRangeText(value, edit.selectionStart ?? start, edit.selectionEnd ?? end, 'end');
        edit.dispatchEvent(new Event('input', { bubbles: true }));
      };
      groups.push({ items: [
        { icon: 'cut', label: t('ctx.cut'), key: `${mod}X`, disabled: !hasSel, run: async () => {
          try { await navigator.clipboard.writeText(text); edit.setSelectionRange(start, end); put(''); } catch { toast(t('common.copyFailed'), 'err'); }
        } },
        { icon: 'copy', label: t('ctx.copy'), key: `${mod}C`, disabled: !hasSel, run: () => copy(text) },
        { icon: 'paste', label: t('ctx.paste'), key: `${mod}V`, run: async () => {
          try { edit.setSelectionRange(start, end); put(await navigator.clipboard.readText()); } catch { toast(t('ctx.pasteHint', { key: `${mod}V` }), 'err'); }
        } },
        { icon: 'all', label: t('ctx.selectAll'), key: `${mod}A`, run: () => { edit.focus(); edit.select(); } },
      ] });
    } else {
      const items = [];
      if (sel) {
        items.push({ icon: 'copy', label: t('ctx.copy'), key: `${mod}C`, run: () => copy(sel) });
        if (NAME_RE.test(sel) && sel !== player) {
          items.push({ icon: 'search', label: t('ctx.searchPlayer', { name: sel }), run: () => window.MCTL_UI?.openPalette(sel) });
        }
      }
      items.push({ icon: 'all', label: t('ctx.selectAll'), key: `${mod}A`, run: () => {
        const root = document.querySelector('.pfx-body, .au-drawer.open .au-drawer-panel, .modal, main') || document.body;
        getSelection().selectAllChildren(root);
      } });
      groups.push({ items });
    }

    if (link && !player) {
      const url = new URL(link.href, location.href).href;
      groups.push({ items: [
        { icon: 'open', label: t('ctx.openTab'), run: () => open(url, '_blank', 'noopener') },
        { icon: 'link', label: t('ctx.copyLink'), run: () => copy(url, t('ctx.linkCopied')) },
      ] });
    }
    if (img && img.src && !img.src.startsWith('data:')) {
      groups.push({ items: [
        { icon: 'image', label: t('ctx.openImage'), run: () => open(img.src, '_blank', 'noopener') },
        { icon: 'copy', label: t('ctx.copyImage'), run: () => copyImage(img.src) },
        { icon: 'link', label: t('ctx.copyImageLink'), run: () => copy(img.src, t('ctx.linkCopied')) },
      ] });
    }

    const site = [
      { icon: 'page', label: t('ctx.copyPage'), run: () => copy(location.href, t('ctx.linkCopied')) },
    ];
    if (window.MCTL_UI?.openPalette) site.push({ icon: 'cmd', label: t('ctx.palette'), key: `${mod}K`, run: () => window.MCTL_UI.openPalette() });
    site.push({ icon: 'server', label: t('ctx.copyIp'), hint: SERVER, run: () => copy(SERVER, t('server.copied', { ip: SERVER })) });
    if (scrollY > 200) site.push({ icon: 'top', label: t('ctx.top'), run: () => scrollTo({ top: 0, behavior: 'smooth' }) });
    groups.push({ items: site });
    return groups;
  }

  // ---------------------------------------------------------------- menu element
  let menu = null;
  let items = [];
  let active = -1;

  function close(instant) {
    if (!menu) return;
    const m = menu;
    menu = null;
    items = [];
    if (instant) { m.remove(); return; }
    m.classList.add('out');
    setTimeout(() => m.remove(), 160);
  }

  function setActive(i) {
    active = i;
    const buttons = $$('.ctx-item', menu);
    buttons.forEach((b, j) => b.classList.toggle('act', j === i));
    const hl = menu.querySelector('.ctx-hl');
    const b = buttons[i];
    if (b) {
      hl.style.opacity = '1';
      hl.style.transform = `translateY(${b.offsetTop}px)`;
      hl.style.height = `${b.offsetHeight}px`;
    } else hl.style.opacity = '0';
  }

  function openAt(x, y, target) {
    close(true);
    const groups = itemsFor(target);
    menu = document.createElement('div');
    menu.className = 'ctx';
    menu.setAttribute('role', 'menu');
    let n = 0;
    const nav = `<div class="ctx-nav">
      <button data-nav="back" title="${t('ctx.back')}" ${history.length > 1 ? '' : 'disabled'}>${svg('back')}</button>
      <button data-nav="fwd" title="${t('ctx.forward')}">${svg('fwd')}</button>
      <button data-nav="reload" title="${t('ctx.reload')}">${svg('reload')}</button>
    </div>`;
    menu.innerHTML = `${nav}<div class="ctx-list"><i class="ctx-hl"></i>${groups.map((g) => `
      ${g.head ? `<div class="ctx-head"><img src="${g.headImg}" alt="" onerror="this.style.visibility='hidden'">${esc(g.head)}</div>` : ''}
      ${g.items.map((it) => {
        const i = n++;
        items.push(it);
        return `<button class="ctx-item" role="menuitem" data-i="${i}" style="--d:${i * 18}ms" ${it.disabled ? 'disabled' : ''}>
          ${svg(it.icon)}<span>${esc(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : it.hint ? `<small>${esc(it.hint)}</small>` : ''}</button>`;
      }).join('')}`).join('<hr>')}</div>`;
    document.body.append(menu);

    // Keep it on screen and grow out of the corner nearest the cursor.
    const r = menu.getBoundingClientRect();
    const left = x + r.width > innerWidth - 8 ? Math.max(8, x - r.width) : x;
    const top = y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.transformOrigin = `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}`;
    requestAnimationFrame(() => menu?.classList.add('in'));

    menu.addEventListener('mousemove', (e) => {
      const b = e.target.closest('.ctx-item:not(:disabled)');
      if (b && Number(b.dataset.i) !== active) setActive(Number(b.dataset.i));
    });
    menu.addEventListener('mouseleave', () => setActive(-1));
    menu.addEventListener('mousedown', (e) => e.preventDefault()); // keep the page selection
    menu.addEventListener('click', (e) => {
      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) {
        close();
        if (navBtn.dataset.nav === 'back') history.back();
        else if (navBtn.dataset.nav === 'fwd') history.forward();
        else location.reload();
        return;
      }
      const b = e.target.closest('.ctx-item');
      if (b && !b.disabled) run(Number(b.dataset.i));
    });
    active = -1;
  }

  function run(i) {
    const it = items[i];
    close();
    if (it) setTimeout(() => it.run(), 0);
  }

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const x = e.clientX || (e.target.getBoundingClientRect?.().left ?? 20);
    const y = e.clientY || (e.target.getBoundingClientRect?.().bottom ?? 20);
    openAt(x, y, e.target instanceof Element ? e.target : document.body);
  });
  document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) close(); }, true);
  addEventListener('scroll', () => close(), { passive: true, capture: true });
  addEventListener('resize', () => close());
  addEventListener('blur', () => close());
  addEventListener('keydown', (e) => {
    if (!menu) return;
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
    if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const pos = enabled.indexOf(active);
      const next = e.key === 'ArrowDown' ? enabled[(pos + 1) % enabled.length] : enabled[(pos - 1 + enabled.length) % enabled.length];
      setActive(next ?? enabled[0]);
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); run(active); }
  }, true);
})();
