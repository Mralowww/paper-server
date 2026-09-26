/* Mc.Tierlist.Asia — staff panel */
document.addEventListener('DOMContentLoaded', async () => {
  const { $, $$, esc, t, tierBadge, avatarUrl, discordAvatar, toast, countUp, session, levelChips, loginUrl,
    testsTable, resultCell, scoreCell, icon, statusPill, catLabel, catIcon } = window.MCTL;
  const { fmtDate, fmtRelative } = window.I18N;
  const root = $('#adminRoot');
  const TIERS = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];

  const { user: me, permissions: perms } = await session;

  if (!me || !perms.viewStaff) {
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card reveal in">
          <img src="/assets/cube.svg" alt="">
          <h1>${t('admin.loginT')}</h1>
          <p>${me ? t('admin.denied') : t('admin.loginD')}</p>
          ${me ? `<a class="btn" href="/">${t('page404.back')}</a>` : `<a class="btn btn-discord" href="${loginUrl()}">${icon.discord}${t('nav.loginDiscord')}</a>`}
        </div>
      </div>`;
    return;
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api/admin${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.reload(); throw new Error('unauthorized'); }
    if (!res.ok) {
      const key = `error.${data.error}`;
      throw new Error(window.I18N.has(key) ? t(key) : (data.message || t('common.error')));
    }
    return data;
  }

  // ---------- Modal ----------
  function modal(html, onMount) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { bg.classList.add('closing'); setTimeout(() => bg.remove(), 200); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', onKey);
    document.body.append(bg);
    $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
    onMount?.(bg, close);
    $('input, select', bg)?.focus();
    return close;
  }

  function confirmDialog(title, text) {
    return new Promise((resolve) => {
      let answered = false;
      modal(`
        <h3>${title}</h3><p class="muted" style="margin:0">${text}</p>
        <div class="modal-actions"><button class="btn" data-close>${t('common.cancel')}</button><button class="btn btn-danger" id="ok">${t('common.confirm')}</button></div>`,
      (bg, close) => {
        $('#ok', bg).addEventListener('click', () => { answered = true; resolve(true); close(); });
        new MutationObserver((_, obs) => { if (!bg.isConnected) { obs.disconnect(); if (!answered) resolve(false); } })
          .observe(document.body, { childList: true });
      });
    });
  }

  // ---------- Shell ----------
  const TABS = [
    ['overview', 'tab.overview', true, '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>'],
    ['players', 'tab.players', true, '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'],
    ['bans', 'tab.bans', true, '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'],
    ['support', 'tab.support', true, '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'],
    ['tickets', 'tab.tickets', true, '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 5v2M13 11v2M13 17v2"/>'],
    ['links', 'tab.links', true, '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'],
    ['tests', 'tab.tests', true, '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'],
    ['keys', 'tab.keys', perms.manageKeys, '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>'],
    ['team', 'tab.team', true, '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'],
    ['settings', 'tab.settings', perms.manageSettings, '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'],
    ['site', 'tab.site', perms.manageSettings, '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8"/>'],
    ['storage', 'tab.storage', true, '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'],
    ['audit', 'tab.audit', perms.viewAudit, '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>'],
  ].filter(([, , allowed]) => allowed);

  root.innerHTML = `
    <div class="admin">
      <aside class="side">
        <div class="me">
          <img src="${discordAvatar(me.id, me.avatar)}" alt="">
          <div class="who"><b>${esc(me.username)}</b><div class="chips-row">${levelChips(me)}</div></div>
        </div>
        <nav class="side-nav">
          ${TABS.map(([id, key, , path]) => `<button data-tab="${id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>${t(key)}</button>`).join('')}
        </nav>
      </aside>
      <section id="panel"></section>
    </div>`;
  $('.side-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });

  function go(route) {
    let [tab, arg] = String(route).split('/');
    if (!views[tab] || !TABS.some(([id]) => id === tab)) { tab = 'overview'; arg = undefined; }
    history.replaceState(null, '', `#${tab}${arg ? `/${arg}` : ''}`);
    $$('.side-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    // Fresh element per view so event listeners from the previous view don't pile up.
    const old = $('#panel');
    const panel = old.cloneNode(false);
    old.replaceWith(panel);
    panel.innerHTML = '<div class="skeleton" style="height:320px"></div>';
    views[tab](panel, arg).catch((err) => {
      if (err.message !== 'unauthorized') panel.innerHTML = `<div class="empty"><div><h3>${t('common.loadFailed')}</h3><p>${esc(err.message)}</p></div></div>`;
    });
  }

  const actionLabel = (a) => (window.I18N.has(`action.${a}`) ? t(`action.${a}`) : a);
  const auditHtml = (entries) => (entries.length
    ? entries.map((e, i) => `<div class="audit-item" style="animation-delay:${i * 0.03}s"><span class="dot"></span>
        <div><b>${esc(e.actor_name || 'system')}</b> <span class="muted">${esc(actionLabel(e.action))}</span>${e.detail ? ` · <span class="mono">${esc(e.detail)}</span>` : ''}</div>
        <time>${esc(fmtDate(e.created_at))}</time></div>`).join('')
    : `<div class="card-pad muted">${t('audit.empty')}</div>`);
  const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
  const readOnly = perms.managePlayers ? '' : ` <span class="pill off">${t('admin.readOnly')}</span>`;

  // ---------- Views ----------
  const views = {
    async overview(panel) {
      const d = await api('/overview');
      const stat = (n, label, delay) => `<div class="stat spot" style="animation:panel-in .5s var(--ease) ${delay}s both"><div class="num" data-n="${n}">0</div><div class="lbl">${label}</div></div>`;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div><h2>${t('admin.welcome', { name: esc(me.username) })}</h2><p>${t('admin.subtitle')}</p></div>
            <span class="pill ${d.botOnline ? 'on' : 'off'}">● ${t(d.botOnline ? 'admin.botOnline' : 'admin.botOffline')}</span>
          </div>
          <div class="stats" style="margin:0 0 20px">
            ${stat(d.players, t('stat.players'), 0)}${stat(d.tests, t('stat.tests'), 0.05)}${stat(d.openTickets, t('admin.openTickets'), 0.1)}${stat(d.apiCalls, t('admin.apiCalls'), 0.15)}
          </div>
          ${perms.viewAudit ? `<div class="panel-head"><div><h2 style="font-size:19px">${t('admin.recent')}</h2></div><a class="btn btn-sm" href="/audit">${t('admin.viewAll')}</a></div>
          <div class="card audit">${auditHtml(d.recent)}</div>` : ''}
        </div>`;
      $$('[data-n]', panel).forEach((el) => countUp(el, Number(el.dataset.n)));
    },

    async players(panel) {
      const { players } = await api('/players');
      const canEdit = perms.managePlayers;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div><h2>${t('tab.players')}${readOnly}</h2><p>${t('players.count', { n: players.length })}</p></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input class="input" id="pFilter" placeholder="${t('players.search')}" style="width:200px;height:42px">
              ${canEdit ? `<button class="btn btn-gold" id="addPlayer">${t('players.add')}</button>` : ''}
            </div>
          </div>
          <div class="card">${players.length ? `
            <div class="table-wrap"><table class="data">
              <thead><tr><th>#</th><th>${t('col.player')}</th><th>${t('col.tier')}</th><th>${t('col.record')}</th><th>Discord</th><th>${t('col.updated')}</th><th></th></tr></thead>
              <tbody>${players.map((p, i) => `
                <tr data-name="${esc(p.name.toLowerCase())}" style="animation-delay:${Math.min(i, 20) * 0.02}s">
                  <td class="mono muted">${p.rank}</td>
                  <td><div class="cell-player"><img src="${avatarUrl(p.name, 32)}" alt="" loading="lazy">${esc(p.name)}</div></td>
                  <td>${tierBadge(p.tier, { retired: !!p.retired })}</td>
                  <td>${scoreCell(p)}</td>
                  <td class="mono muted" style="font-size:12px">${esc(p.discord_id || '—')}${p.cooldown_until ? `<div><span class="pill off" title="${esc(fmtDate(p.cooldown_until))}">${t('players.inCooldown')} · ${esc(fmtRelative(p.cooldown_until))}</span></div>` : ''}</td>
                  <td class="muted" style="font-size:13px">${esc(fmtDate(p.updated_at))}</td>
                  <td>${canEdit ? `<div class="actions">
                    ${p.cooldown_until ? `<button class="btn btn-sm" data-cd="${p.id}">${t('players.resetCd')}</button>` : ''}
                    <button class="btn btn-sm" data-edit="${p.id}">${t('common.edit')}</button>
                    <button class="btn btn-sm btn-danger" data-del="${p.id}">${t('common.delete')}</button></div>` : ''}</td>
                </tr>`).join('')}</tbody>
            </table></div>` : `<div class="empty" style="border:0"><div><h3>${t('players.emptyT')}</h3><p>${t('players.emptyD')}</p></div></div>`}
          </div>
        </div>`;
      $('#pFilter').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        $$('tr[data-name]', panel).forEach((tr) => { tr.hidden = !tr.dataset.name.includes(q); });
      });
      if (!canEdit) return;
      $('#addPlayer').addEventListener('click', () => playerForm());
      panel.addEventListener('click', async (e) => {
        const find = (attr) => players.find((x) => String(x.id) === e.target.closest(`[${attr}]`)?.getAttribute(attr));
        try {
          if (e.target.closest('[data-edit]')) playerForm(find('data-edit'));
          if (e.target.closest('[data-cd]')) {
            const p = find('data-cd');
            await api(`/players/${p.id}/cooldown`, { method: 'DELETE' });
            toast(t('players.cdReset', { name: p.name }));
            go('players');
          }
          if (e.target.closest('[data-del]')) {
            const p = find('data-del');
            if (await confirmDialog(t('players.deleteT'), t('players.deleteD', { name: esc(p.name) }))) {
              await api(`/players/${p.id}`, { method: 'DELETE' });
              toast(t('players.deleted', { name: p.name }));
              go('players');
            }
          }
        } catch (err) { toast(err.message, 'err'); }
      });
    },

    async bans(panel, arg) {
      const { bans } = await api('/bans');
      const showAll = arg === 'all';
      const list = showAll ? bans : bans.filter((b) => b.status === 'active');
      const canEdit = perms.managePlayers;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div><h2>${t('tab.bans')}${readOnly}</h2><p>${t('bans.subtitle')}</p></div>
            ${canEdit ? `<button class="btn btn-gold" id="addBan">${t('bans.add')}</button>` : ''}
          </div>
          <div class="seg" style="margin-bottom:14px">
            <button class="${showAll ? '' : 'active'}" data-go="bans">${t('bans.filterActive')} (${bans.filter((b) => b.status === 'active').length})</button>
            <button class="${showAll ? 'active' : ''}" data-go="bans/all">${t('bans.filterAll')} (${bans.length})</button>
          </div>
          <div class="card">${list.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>${t('col.player')}</th><th>${t('bans.reason')}</th><th>${t('col.expires')}</th><th>${t('col.bannedBy')}</th><th>${t('col.status')}</th><th></th></tr></thead>
            <tbody>${list.map((b, i) => `<tr style="animation-delay:${Math.min(i, 20) * 0.02}s">
              <td><div class="cell-player"><img src="${avatarUrl(b.mc_name, 32)}" alt="">${esc(b.mc_name)}</div>${b.discord_id ? `<div class="mono muted" style="font-size:11px">${esc(b.discord_id)}</div>` : ''}</td>
              <td style="max-width:280px">${esc(b.reason)}</td>
              <td class="muted" style="font-size:13px">${b.expires_at ? esc(fmtDate(b.expires_at)) : t('bans.perm')}</td>
              <td class="muted" style="font-size:13px">${esc(b.created_by_name || '—')}<div>${esc(fmtDate(b.created_at))}</div></td>
              <td><span class="pill ${b.status === 'active' ? 'off' : ''}">${t(`bans.status.${b.status}`)}</span></td>
              <td>${canEdit && b.status === 'active' ? `<div class="actions"><button class="btn btn-sm" data-revoke="${b.id}" data-name="${esc(b.mc_name)}">${t('bans.revoke')}</button></div>` : ''}</td>
            </tr>`).join('')}</tbody></table></div>` : `<div class="card-pad muted">${t('bans.empty')}</div>`}</div>
        </div>`;
      $$('[data-go]', panel).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
      if (!canEdit) return;
      $('#addBan').addEventListener('click', () => modal(`
        <h3>${t('bans.addTitle')}</h3>
        <form id="banForm">
          <div class="field"><label>${t('players.mcName')}</label><input class="input" name="name" maxlength="16" placeholder="Steve" required></div>
          <div class="field"><label>${t('bans.discordOpt')}</label><input class="input mono" name="discordId" inputmode="numeric"></div>
          <div class="field"><label>${t('bans.reason')}</label><input class="input" name="reason" maxlength="300" placeholder="${t('bans.reasonPh')}" required></div>
          <div class="row2">
            <div class="field"><label>${t('bans.duration')}</label><select class="input" name="duration">
              ${['perm', '1d', '7d', '30d', 'custom'].map((d) => `<option value="${d}">${t(`bans.${d}`)}</option>`).join('')}</select></div>
            <div class="field" id="daysField" hidden><label>${t('bans.days')}</label><input class="input mono" name="days" type="number" min="1" max="3650" value="14"></div>
          </div>
          <div class="modal-actions"><button type="button" class="btn" data-close>${t('common.cancel')}</button><button class="btn btn-danger">${t('bans.addTitle')}</button></div>
        </form>`, (bg, close) => {
        const form = $('#banForm', bg);
        form.duration.addEventListener('change', () => { $('#daysField', bg).hidden = form.duration.value !== 'custom'; });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/bans', { method: 'POST', body: {
              name: form.name.value.trim(), discordId: form.discordId.value.trim(), reason: form.reason.value.trim(),
              duration: form.duration.value, days: Number(form.days.value) } });
            close();
            toast(t('bans.created', { name: form.name.value.trim() }));
            go('bans');
          } catch (err) { toast(err.message, 'err'); }
        });
      }));
      panel.addEventListener('click', async (e) => {
        const r = e.target.closest('[data-revoke]');
        if (!r || !(await confirmDialog(t('bans.revokeT'), t('bans.revokeD', { name: esc(r.dataset.name) })))) return;
        try {
          await api(`/bans/${r.dataset.revoke}/revoke`, { method: 'POST' });
          toast(t('bans.revoked', { name: r.dataset.name }));
          go(showAll ? 'bans/all' : 'bans');
        } catch (err) { toast(err.message, 'err'); }
      });
    },

    async support(panel, arg) {
      const SP = window.MCTL_SUPPORT;
      let filter = ['open', 'in_progress', 'closed'].includes(arg) ? arg : '';
      let selected = arg && /^\d+$/.test(arg) ? Number(arg) : null;
      let q = '';
      let tickets = [];
      let counts = {};
      let view = null;
      let templates = (await api('/support/templates')).templates;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.support')}</h2><p>${t('sp.inboxSub')}</p></div>
            <button class="btn btn-sm" id="showBlocks">${t('support.blocks')}</button></div>
          <div class="inbox ${selected ? 'has-sel' : ''}">
            <aside class="inbox-side">
              <label class="sp-search">${SP.svg(SP.IC.search, 15)}<input placeholder="${t('sp.searchStaff')}"></label>
              <div class="seg inbox-seg"></div>
              <div class="inbox-list"></div>
            </aside>
            <section class="inbox-main"><div class="inbox-empty">${catIcon('other', 30)}<p>${t('sp.pickTicket')}</p></div></section>
          </div>
        </div>`;
      const listEl = $('.inbox-list', panel);
      const segEl = $('.inbox-seg', panel);
      const main = $('.inbox-main', panel);
      const inbox = $('.inbox', panel);

      function drawList() {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        segEl.innerHTML = [['', t('support.filterAll'), total], ...['open', 'in_progress', 'closed'].map((st) => [st, t(`support.status.${st}`), counts[st] || 0])]
          .map(([st, label, n]) => `<button data-f="${st}" class="${st === filter ? 'active' : ''}">${label} <span class="muted">${n}</span></button>`).join('');
        listEl.innerHTML = tickets.length ? tickets.map((x) => `
          <button class="inbox-item ${x.status} ${x.unread ? 'unread' : ''} ${x.id === selected ? 'sel' : ''}" data-id="${x.id}">
            <img src="${discordAvatar(x.user_id, x.user_avatar)}" alt="">
            <span class="inbox-item-main">
              <span class="inbox-item-top"><b>${esc(x.title)}</b><time>${esc(fmtRelative(x.updated_at))}</time></span>
              <span class="inbox-item-prev">${SP.previewText(x, true)}</span>
              <span class="inbox-item-meta">${catIcon(x.category, 12)}<span class="mono">#${x.id}</span><span>${esc(x.username || x.user_id)}</span>${x.target_name ? `<span>→ ${esc(x.target_name)}</span>` : ''}</span>
            </span>
            <i class="inbox-dot" title="${t(`support.status.${x.status}`)}"></i>
          </button>`).join('') : `<div class="muted" style="padding:20px;text-align:center">${t('support.none')}</div>`;
      }
      async function loadList() {
        const p = new URLSearchParams();
        if (filter) p.set('status', filter);
        if (q) p.set('q', q);
        const d = await api(`/support?${p}`);
        tickets = d.tickets; counts = d.counts;
        drawList();
      }
      async function open(id) {
        view?.destroy();
        selected = id;
        inbox.classList.add('has-sel');
        history.replaceState(null, '', `#support/${id}`);
        $$('.inbox-item', listEl).forEach((b) => b.classList.toggle('sel', Number(b.dataset.id) === id));
        main.innerHTML = '<div class="skeleton" style="height:100%;min-height:420px;border-radius:18px"></div>';
        try {
          view = await SP.mountThread(main, {
            id, staff: true, templates,
            manageTemplates: perms.managePlayers ? editTemplates : null,
            headExtra: (tk) => `<button class="btn btn-sm btn-ghost inbox-back" data-back>←</button>
              <div class="select-wrap"><select data-status aria-label="${t('support.setStatus')}">${['open', 'in_progress', 'closed'].map((st) => `<option value="${st}" ${st === tk.status ? 'selected' : ''}>${t(`support.status.${st}`)}</option>`).join('')}</select></div>
              ${perms.managePlayers ? `<button class="btn btn-sm" data-block>${t('support.block')}</button><button class="btn btn-sm btn-danger" data-del>${t('common.delete')}</button>` : ''}`,
            bindHead: (root, tk, reload) => {
              $('[data-back]', root)?.addEventListener('click', () => { view?.destroy(); view = null; selected = null; inbox.classList.remove('has-sel'); history.replaceState(null, '', '#support'); drawList(); });
              $('[data-status]', root)?.addEventListener('change', async (e) => {
                try { await api(`/support/${tk.id}`, { method: 'PATCH', body: { status: e.target.value } }); await reload(); loadList(); } catch (err) { toast(err.message, 'err'); }
              });
              $('[data-block]', root)?.addEventListener('click', async () => {
                if (!(await confirmDialog(t('support.blockT'), t('support.blockD', { name: esc(tk.username || tk.user_id) })))) return;
                try { await api('/support/blocks', { method: 'POST', body: { discordId: tk.user_id, reason: `#${tk.id}` } }); toast(t('support.toastBlocked', { name: tk.username || tk.user_id })); } catch (err) { toast(err.message, 'err'); }
              });
              $('[data-del]', root)?.addEventListener('click', async () => {
                if (!(await confirmDialog(t('support.deleteT'), t('support.deleteD', { id: tk.id })))) return;
                try { await api(`/support/${tk.id}`, { method: 'DELETE' }); toast(t('support.toastDeleted')); view?.destroy(); view = null; selected = null; main.innerHTML = ''; inbox.classList.remove('has-sel'); loadList(); } catch (err) { toast(err.message, 'err'); }
              });
            },
            onUpdate: () => loadList(),
          });
          const it = tickets.find((x) => x.id === id);
          if (it?.unread) { it.unread = false; drawList(); }
        } catch (err) { main.innerHTML = `<div class="inbox-empty"><p>${esc(err.message)}</p></div>`; }
      }
      function editTemplates() {
        modal(`<h3>${t('sp.editTemplates')}</h3><p class="muted" style="margin-top:0">${t('sp.templatesHint')}</p>
          <form id="tplForm"><textarea class="input" name="tpl" rows="10">${esc(templates.join('\n---\n'))}</textarea>
          <div class="modal-actions"><button type="button" class="btn" data-close>${t('common.cancel')}</button><button class="btn btn-gold">${t('common.save')}</button></div></form>`, (bg, close) => {
          $('#tplForm', bg).addEventListener('submit', async (e) => {
            e.preventDefault();
            const items = e.target.tpl.value.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean);
            try {
              templates = (await api('/support/templates', { method: 'PUT', body: { templates: items } })).templates;
              close(); toast(t('site.saved'));
              if (selected) open(selected);
            } catch (err) { toast(err.message, 'err'); }
          });
        });
      }
      segEl.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; loadList(); } });
      let qTimer;
      $('.sp-search input', panel).addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { q = e.target.value.trim(); loadList(); }, 300); });
      listEl.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) open(Number(b.dataset.id)); });
      $('#showBlocks', panel).addEventListener('click', async () => {
        const { blocks } = await api('/support/blocks');
        modal(`<h3>${t('support.blocks')}</h3><div class="card">${blocks.length ? blocks.map((b) => `
            <div class="ticket-row"><span class="mono muted">${esc(b.discord_id)}</span><span class="ticket-title"><b>${esc(b.username || '—')}</b><span class="muted">${esc(b.reason || '')} · ${esc(fmtDate(b.created_at))}</span></span>
            ${perms.managePlayers ? `<button class="btn btn-sm" data-unblock="${esc(b.discord_id)}">${t('support.unblock')}</button>` : ''}</div>`).join('') : `<div class="card-pad muted">${t('support.noBlocks')}</div>`}</div>
          <div class="modal-actions"><button class="btn" data-close>${t('card.close')}</button></div>`, (bg, close) => {
          bg.addEventListener('click', async (e) => {
            const u = e.target.closest('[data-unblock]');
            if (!u) return;
            try { await api(`/support/blocks/${u.dataset.unblock}`, { method: 'DELETE' }); close(); toast(t('support.unblock')); } catch (err) { toast(err.message, 'err'); }
          });
        });
      });

      await loadList();
      if (selected) open(selected);
      // Keep the list fresh while this view is on screen.
      const tick = setInterval(() => {
        if (!document.body.contains(panel)) { clearInterval(tick); view?.destroy(); return; }
        if (!document.hidden) loadList().catch(() => {});
      }, 15000);
    },

    async storage(panel) {
      const d = await api('/storage');
      const pct = Math.min(100, Math.round((d.used / d.limit) * 100));
      const canEdit = perms.managePlayers;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.storage')}</h2><p>${t('storage.subtitle')}</p></div></div>
          <div class="card card-pad" style="margin-bottom:20px">
            <div class="usage-top"><b>${t('storage.used', { used: fmtBytes(d.used), limit: fmtBytes(d.limit) })}</b><span class="mono">${pct}%</span></div>
            <div class="usage-bar"><span style="width:${pct}%" class="${pct > 85 ? 'hot' : ''}"></span></div>
            <div class="usage-stats">
              <div><span class="muted">${t('storage.images')}</span><b>${d.images.n} · ${fmtBytes(d.images.bytes)}</b></div>
              <div><span class="muted">${t('storage.closedImages')}</span><b>${d.closedImages.n} · ${fmtBytes(d.closedImages.bytes)}</b></div>
              ${canEdit && d.closedImages.n ? `<button class="btn btn-danger btn-sm" id="cleanup">${t('storage.cleanup')}</button>` : ''}
            </div>
          </div>
          <div class="card">${d.attachments.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>${t('col.image')}</th><th>${t('col.ticket')}</th><th>${t('col.size')}</th><th>${t('col.date')}</th><th></th></tr></thead>
            <tbody>${d.attachments.map((a, i) => `<tr style="animation-delay:${Math.min(i, 20) * 0.02}s">
              <td><a href="/api/support/attachments/${a.id}" target="_blank" rel="noopener"><img class="thumb" src="/api/support/attachments/${a.id}" alt="" loading="lazy"></a></td>
              <td><a class="link-more" href="#support/${a.ticket_id}" data-open="${a.ticket_id}">#${a.ticket_id}</a> <span class="muted">${esc(a.title)}</span> ${statusPill(a.status)}</td>
              <td class="mono">${fmtBytes(a.size)}</td>
              <td class="muted" style="font-size:13px">${esc(fmtDate(a.created_at))}</td>
              <td>${canEdit ? `<div class="actions"><button class="btn btn-sm btn-danger" data-delimg="${a.id}">${t('common.delete')}</button></div>` : ''}</td>
            </tr>`).join('')}</tbody></table></div>` : `<div class="card-pad muted">${t('storage.empty')}</div>`}</div>
        </div>`;
      panel.addEventListener('click', async (e) => {
        const o = e.target.closest('[data-open]');
        if (o) { e.preventDefault(); return go(`support/${o.dataset.open}`); }
        try {
          const del = e.target.closest('[data-delimg]');
          if (del && await confirmDialog(t('storage.deleteImgT'), t('storage.deleteImgD'))) {
            await api(`/storage/attachments/${del.dataset.delimg}`, { method: 'DELETE' });
            go('storage');
          }
          if (e.target.closest('#cleanup') && await confirmDialog(t('storage.cleanup'), t('storage.cleanupD', { n: d.closedImages.n, size: fmtBytes(d.closedImages.bytes) }))) {
            const r = await api('/storage/cleanup', { method: 'POST' });
            toast(t('storage.cleaned', { n: r.deleted }));
            go('storage');
          }
        } catch (err) { toast(err.message, 'err'); }
      });
    },

    async tests(panel) {
      const { tests } = await api('/tests');
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.tests')}</h2><p>${t('tests.subtitle')}</p></div></div>
          <div class="card">${tests.length ? testsTable(tests, [
            ['col.date', (x) => `<span class="muted">${esc(fmtDate(x.created_at))}</span>`],
            ['col.player', (x) => `<div class="cell-player"><img src="${avatarUrl(x.mc_name, 32)}" alt="">${esc(x.mc_name)}</div>`],
            ['col.result', resultCell],
            ['col.score', scoreCell],
            ['col.tester', (x) => esc(x.tester_name || x.tester_id)],
          ]) : `<div class="card-pad muted">${t('tests.empty')}</div>`}</div>
        </div>`;
    },

    async keys(panel) {
      const [{ keys }, { keys: accountKeys }] = await Promise.all([api('/keys'), api('/account-keys')]);
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div><h2>API Keys</h2><p>${t('keys.subtitle')}</p></div>
            <button class="btn btn-gold" id="addKey">${t('keys.create')}</button>
          </div>
          <div class="card">${keys.length ? `
            <div class="table-wrap"><table class="data">
              <thead><tr><th>${t('col.name')}</th><th>Key</th><th>${t('col.status')}</th><th>${t('col.calls')}</th><th>${t('col.lastUsed')}</th><th>${t('col.createdBy')}</th><th></th></tr></thead>
              <tbody>${keys.map((k, i) => `
                <tr style="animation-delay:${i * 0.03}s">
                  <td><b>${esc(k.name)}</b>${k.scope === 'server' ? ` <span class="pill gold">${t('keys.server')}</span>` : ''}<div class="muted" style="font-size:12px">${esc(fmtDate(k.created_at))}</div></td>
                  <td class="mono muted">${esc(k.prefix)}…</td>
                  <td>${k.revoked ? `<span class="pill off">${t('keys.revoked')}</span>` : `<span class="pill on">${t('keys.active')}</span>`}</td>
                  <td class="mono">${k.usage_count.toLocaleString()}</td>
                  <td class="muted" style="font-size:13px">${esc(fmtDate(k.last_used_at))}</td>
                  <td class="muted">${esc(k.created_by_name || k.created_by || '—')}</td>
                  <td><div class="actions">
                    <button class="btn btn-sm" data-toggle="${k.id}" data-revoked="${k.revoked}">${t(k.revoked ? 'keys.enable' : 'keys.disable')}</button>
                    <button class="btn btn-sm btn-danger" data-del="${k.id}">${t('common.delete')}</button></div></td>
                </tr>`).join('')}</tbody>
            </table></div>` : `<div class="empty" style="border:0"><div><h3>${t('keys.emptyT')}</h3><p>${t('keys.emptyD')}</p></div></div>`}
          </div>
          <div class="panel-head" style="margin-top:26px"><h2 style="font-size:19px">${t('akey.all')}</h2></div>
          <div class="card">${accountKeys.length ? accountKeys.map((k) => `
            <div class="ticket-row"><span class="mono muted">${esc(k.prefix)}…</span>
              <span class="ticket-title"><b>${esc(k.name)}</b><span class="muted">${esc(k.username || k.user_id)} · ${t('col.lastUsed')} ${esc(fmtDate(k.last_used_at))} · ${t('col.calls')} ${k.usage_count}</span></span>
              <button class="btn btn-sm btn-danger" data-revokeacct="${k.id}">${t('akey.revoke')}</button></div>`).join('') : `<div class="card-pad muted">${t('akey.empty')}</div>`}</div>
        </div>`;
      $('#addKey').addEventListener('click', () => modal(`
        <h3>${t('keys.createTitle')}</h3>
        <form id="keyForm">
          <div class="field"><label>${t('keys.nameLabel')}</label><input class="input" name="name" maxlength="48" placeholder="${t('keys.namePh')}" required></div>
          <div class="field"><label>${t('keys.scope')}</label><select class="input" name="scope">
            <option value="read">${t('keys.scopeRead')}</option><option value="server">${t('keys.scopeServer')}</option></select></div>
          <div class="modal-actions"><button type="button" class="btn" data-close>${t('common.cancel')}</button><button class="btn btn-gold">${t('common.create')}</button></div>
        </form>`, (bg, close) => {
        $('#keyForm', bg).addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const { key } = await api('/keys', { method: 'POST', body: { name: e.target.name.value, scope: e.target.scope.value } });
            close();
            showKey(key);
          } catch (err) { toast(err.message, 'err'); }
        });
      }));
      panel.addEventListener('click', async (e) => {
        const tg = e.target.closest('[data-toggle]');
        const del = e.target.closest('[data-del]');
        const acct = e.target.closest('[data-revokeacct]');
        try {
          if (acct && await confirmDialog(t('akey.deleteT'), t('akey.deleteD'))) {
            await api(`/account-keys/${acct.dataset.revokeacct}`, { method: 'DELETE' });
            return go('keys');
          }
          if (tg) {
            const revoke = tg.dataset.revoked === '0';
            await api(`/keys/${tg.dataset.toggle}`, { method: 'PATCH', body: { revoked: revoke } });
            toast(t(revoke ? 'keys.toastRevoked' : 'keys.toastRestored'));
            go('keys');
          }
          if (del && await confirmDialog(t('keys.deleteT'), t('keys.deleteD'))) {
            await api(`/keys/${del.dataset.del}`, { method: 'DELETE' });
            toast(t('keys.toastDeleted'));
            go('keys');
          }
        } catch (err) { toast(err.message, 'err'); }
      });
    },

    async team(panel) {
      const { members } = await api('/team');
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.team')}</h2><p>${t('team.subtitle')}</p></div></div>
          <div class="card">${members.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>${t('col.member')}</th><th>Discord ID</th><th>${t('col.roles')}</th></tr></thead>
            <tbody>${members.map((m, i) => `<tr style="animation-delay:${i * 0.03}s">
              <td><div class="cell-player"><img src="${discordAvatar(m.id, m.avatar)}" alt="" style="border-radius:50%;image-rendering:auto">${esc(m.username || m.id)}${m.id === me.id ? ` <span class="muted">${t('common.you')}</span>` : ''}</div></td>
              <td class="mono muted">${esc(m.id)}</td>
              <td><div class="chips-row">${levelChips(m)}</div></td></tr>`).join('')}</tbody>
          </table></div>` : `<div class="card-pad muted">${t('team.empty')}</div>`}</div>
        </div>`;
    },

    async tickets(panel, arg) {
      const filter = ['open', 'tested', 'closed'].includes(arg) ? arg : (arg === 'all' ? 'all' : 'open');
      const d = await api(`/tickets?status=${filter}`);
      const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
      const seg = [...['open', 'tested', 'closed'].map((st) => [st, t(`tickets.status.${st}`), d.counts[st] || 0]), ['all', t('support.filterAll'), total]];
      const canEdit = perms.manageTickets;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.tickets')}</h2><p>${t('tickets.subtitle')}</p></div></div>
          <div class="seg" style="margin-bottom:14px">${seg.map(([st, label, n]) => `<button class="${st === filter ? 'active' : ''}" data-go="tickets/${st}">${label} (${n})</button>`).join('')}</div>
          <div class="card">${d.tickets.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>${t('col.player')}</th><th>${t('col.type')}</th><th>${t('col.status')}</th><th>${t('col.result')}</th><th>${t('col.date')}</th><th></th></tr></thead>
            <tbody>${d.tickets.map((x, i) => `<tr style="animation-delay:${Math.min(i, 20) * 0.02}s">
              <td><div class="cell-player"><img src="${avatarUrl(x.mc_name, 32)}" alt="">${esc(x.mc_name)}</div><div class="muted" style="font-size:12px">${esc(x.applicant_name || x.applicant_id)}</div></td>
              <td><span class="pill ${x.kind === 'high' ? 'high' : 'on'}">${t(`kind.${x.kind}`)}</span></td>
              <td><span class="st-pill ${x.status === 'open' ? 'open' : x.status === 'tested' ? 'in_progress' : 'closed'}"><i></i>${t(`tickets.status.${x.status}`)}</span></td>
              <td>${x.new_tier ? `${resultCell({ prev_tier: x.prev_tier, new_tier: x.new_tier })} <span class="muted" style="font-size:12px">${esc(x.tester_name || '')}</span>` : '<span class="muted">—</span>'}</td>
              <td class="muted" style="font-size:13px">${esc(fmtDate(x.created_at))}</td>
              <td><div class="actions">
                ${d.guildId && x.status !== 'closed' ? `<a class="btn btn-sm" href="https://discord.com/channels/${d.guildId}/${x.channel_id}" target="_blank" rel="noopener">↗</a>` : ''}
                ${canEdit && x.status === 'open' ? `<button class="btn btn-sm" data-kind="${x.channel_id}" data-to="${x.kind === 'high' ? 'normal' : 'high'}">${t(x.kind === 'high' ? 'tickets.toNormal' : 'tickets.toHigh')}</button>` : ''}
                ${canEdit && x.status === 'tested' ? `<button class="btn btn-sm" data-reopen="${x.channel_id}">${t('tickets.reopen')}</button>` : ''}
                ${canEdit && x.status !== 'closed' ? `<button class="btn btn-sm btn-danger" data-close="${x.channel_id}" data-name="${esc(x.mc_name)}">${t('tickets.close')}</button>` : ''}
              </div></td></tr>`).join('')}</tbody></table></div>` : `<div class="card-pad muted">${t('tickets.empty')}</div>`}</div>
        </div>`;
      panel.addEventListener('click', async (e) => {
        const g = e.target.closest('[data-go]');
        if (g) return go(g.dataset.go);
        try {
          const k = e.target.closest('[data-kind]');
          if (k) { await api(`/tickets/${k.dataset.kind}/kind`, { method: 'POST', body: { kind: k.dataset.to } }); toast(t('tickets.done')); return go(`tickets/${filter}`); }
          const r = e.target.closest('[data-reopen]');
          if (r) { await api(`/tickets/${r.dataset.reopen}/reopen`, { method: 'POST' }); toast(t('tickets.done')); return go(`tickets/${filter}`); }
          const c = e.target.closest('[data-close]');
          if (c && await confirmDialog(t('tickets.close'), t('tickets.closeD', { name: esc(c.dataset.name) }))) {
            await api(`/tickets/${c.dataset.close}/close`, { method: 'POST' }); toast(t('tickets.done')); go(`tickets/${filter}`);
          }
        } catch (err) { toast(err.message, 'err'); }
      });
    },

    async settings(panel) {
      const [s, a, rt] = await Promise.all([api('/settings'), api('/applications'), api('/result-template')]);
      const ch = (id) => (id ? `<span class="mono">#${esc(id)}</span>${s.guildId ? ` <a class="btn btn-sm" href="https://discord.com/channels/${s.guildId}/${id}" target="_blank" rel="noopener">↗</a>` : ''}` : `<span class="muted">${t('settings.notSet')}</span>`);
      const row = (label, value) => `<div class="set-row"><span>${label}</span><div>${value}</div></div>`;
      const field = (key, multi) => `<div class="field"><label>${t(`panel.f.${key}`)}</label>${multi
        ? `<textarea class="input" name="${key}" rows="4">${esc(a.panel[key])}</textarea>`
        : `<input class="input" name="${key}" value="${esc(a.panel[key])}">`}</div>`;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.settings')}</h2><p>${t('settings.subtitle')}</p></div></div>
          <div class="card card-pad" style="margin-bottom:20px">
            ${row(t('settings.bot'), s.botConfigured ? `<span class="pill ${s.botOnline ? 'on' : 'off'}">● ${t(s.botOnline ? 'admin.botOnline' : 'admin.botOffline')}</span>` : `<span class="pill off">${t('settings.notConfigured')}</span>`)}
            ${row(t('settings.resultChannel'), ch(s.resultChannel))}
            ${row(t('settings.applyChannel'), ch(s.applyChannel))}
            ${row(t('settings.category'), s.ticketCategory ? `<span class="mono">${esc(s.ticketCategory)}</span>` : `<span class="muted">${t('settings.notSet')}</span>`)}
            ${row(t('settings.cooldown'), t('settings.days', { n: s.cooldownDays }))}
            ${row('Cloudflare DDNS', !s.ddns.enabled ? `<span class="pill off">${t('ddns.off')}</span>`
              : `<div style="text-align:right"><span class="pill ${s.ddns.error ? 'off' : 'on'}">● ${s.ddns.error ? esc(s.ddns.error) : t('ddns.ok')}</span>
                 <div class="muted" style="font-size:12px;margin-top:4px">IP <span class="mono">${esc(s.ddns.ip || '—')}</span> · ${t('ddns.checked')} ${esc(fmtDate(s.ddns.checkedAt))}${s.ddns.updatedAt ? ` · ${t('ddns.updated')} ${esc(fmtDate(s.ddns.updatedAt))}` : ''}</div></div>`)}
          </div>

          <form class="card card-pad invite-form" id="inviteForm" style="margin-bottom:20px">
            <div><h3>${t('invite.title')}</h3><p class="muted" style="margin:4px 0 0;font-size:13px">${t('invite.desc')} <a class="mono" href="/discord" target="_blank" rel="noopener" style="color:var(--gold-2)">${location.host}/discord</a></p></div>
            <div class="invite-row"><input class="input mono" name="url" value="${esc(s.discordInvite)}" placeholder="https://discord.gg/xxxx" required><button class="btn btn-gold">${t('common.save')}</button></div>
          </form>

          <div class="apps-toggle card card-pad ${a.open ? 'is-open' : 'is-paused'}" style="margin-bottom:20px">
            <div><h3>${t('apps.title')}</h3><span class="st-pill ${a.open ? 'open' : 'closed'}"><i></i>${t(a.open ? 'apps.open' : 'apps.paused')}</span>
              <p class="muted" style="margin:8px 0 0;font-size:13px">${t('apps.pausedHint')}</p></div>
            <button class="btn ${a.open ? 'btn-danger' : 'btn-gold'}" id="toggleApps">${t(a.open ? 'apps.pause' : 'apps.resume')}</button>
          </div>

          <div class="panel-head"><div><h2 style="font-size:20px">${t('panel.title')}</h2><p>${t('panel.desc')}</p></div></div>
          <div class="panel-editor">
            <form class="card card-pad" id="panelForm">
              ${field('title')}${field('description', true)}
              <div class="row2">${field('rules_title')}${field('types_title')}</div>
              ${field('rules', true)}${field('types', true)}
              <div class="row2">${field('button')}${field('paused_button')}</div>
              <div class="field"><label>${t('panel.f.color')}</label><div class="color-row"><input type="color" name="colorPick" value="${esc(a.panel.color)}"><input class="input mono" name="color" value="${esc(a.panel.color)}" maxlength="7"></div></div>
              <div class="modal-actions"><button type="button" class="btn" id="resetPanel">${t('panel.reset')}</button><button class="btn btn-gold">${t('common.save')}</button></div>
            </form>
            <div class="dc-preview-wrap"><div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.12em;margin-bottom:8px">${t('panel.preview').toUpperCase()}</div><div id="dcPreview"></div></div>
          </div>

          <div class="panel-head" style="margin-top:34px"><div><h2 style="font-size:20px">${t('rt.title')}</h2><p>${t('rt.desc')}</p></div></div>
          <div class="panel-editor">
            <form class="card card-pad" id="rtForm">
              <div class="field"><label>${t('rt.f.title')}</label><input class="input" name="title" value="${esc(rt.template.title)}"></div>
              <div class="row2">
                ${['tester', 'region', 'username', 'previous', 'earned', 'wins', 'losses'].map((k) => `<div class="field"><label>${t(`rt.f.${k}`)}</label><input class="input" name="${k}" value="${esc(rt.template[k])}"></div>`).join('')}
                <div class="field"><label>${t('rt.f.region_value')}</label><input class="input" name="region_value" value="${esc(rt.template.region_value)}"></div>
              </div>
              <div class="field"><label>${t('rt.f.tier_format')}</label><input class="input mono" name="tier_format" value="${esc(rt.template.tier_format)}"><small class="muted">${t('rt.tierHint')}</small></div>
              <div class="row2">
                <div class="field"><label>${t('rt.f.high')}</label><input class="input" name="high" value="${esc(rt.template.high)}"></div>
                <div class="field"><label>${t('rt.f.low')}</label><input class="input" name="low" value="${esc(rt.template.low)}"></div>
                <div class="field"><label>${t('rt.f.unranked')}</label><input class="input" name="unranked" value="${esc(rt.template.unranked)}"></div>
                <div class="field"><label>${t('rt.f.footer')}</label><input class="input" name="footer" value="${esc(rt.template.footer)}"></div>
              </div>
              <div class="modal-actions"><button type="button" class="btn" id="resetRt">${t('panel.reset')}</button><button class="btn btn-gold">${t('common.save')}</button></div>
            </form>
            <div class="dc-preview-wrap"><div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.12em;margin-bottom:8px">${t('panel.preview').toUpperCase()}</div><div id="rtPreview" class="dc-preview"></div></div>
          </div>
          <p class="muted" style="font-size:14px;margin-top:14px">${t('settings.howto')}</p>
        </div>`;
      $('#inviteForm', panel).addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/discord-invite', { method: 'PUT', body: { url: e.target.url.value.trim() } }); toast(t('invite.saved')); }
        catch (err) { toast(err.message, 'err'); }
      });
      const rtForm = $('#rtForm', panel);
      const rtKeys = Object.keys(rt.defaults);
      const rtValues = () => Object.fromEntries(rtKeys.map((k) => [k, rtForm[k].value]));
      const tierLabel = (v, tier) => (tier ? v.tier_format.replaceAll('{code}', tier).replaceAll('{n}', tier[2]).replaceAll('{level}', tier[0] === 'H' ? v.high : v.low) : v.unranked);
      const rtPreview = () => {
        const v = rtValues();
        const f = (name, value, inline) => `<div class="dc-field ${inline ? 'inline' : ''}"><b>${esc(name)}:</b><div class="dc-text">${value}</div></div>`;
        $('#rtPreview', panel).innerHTML = `
          <div class="dc-msg"><img class="dc-avatar" src="/assets/cube.svg" alt=""><div class="dc-body">
            <div class="dc-name">TierTest <span class="dc-bot">BOT</span></div>
            <div class="dc-text" style="margin-bottom:4px"><span class="dc-mention">@Steve</span></div>
            <div class="dc-embed with-thumb" style="border-left-color:#8a93a6">
              <img class="dc-thumb" src="/heads/body/Steve/128.png" alt="">
              <div class="dc-title">${esc(v.title.replaceAll('{player}', 'Steve'))}</div>
              ${f(v.tester, `<span class="dc-mention">@${esc(me.username)}</span>`)}
              ${f(v.region, esc(v.region_value))}
              ${f(v.username, 'Steve')}
              ${f(v.previous, esc(tierLabel(v, 'LT3')))}
              ${f(v.earned, esc(tierLabel(v, 'HT2')))}
              <div class="dc-inline">${f(v.wins, '3', true)}${f(v.losses, '1', true)}</div>
              <div class="dc-footer">${esc(v.footer)}</div>
            </div>
          </div></div>`;
      };
      rtForm.addEventListener('input', rtPreview);
      rtPreview();
      $('#resetRt', panel).addEventListener('click', () => { rtKeys.forEach((k) => { rtForm[k].value = rt.defaults[k]; }); rtPreview(); });
      rtForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/result-template', { method: 'PUT', body: rtValues() }); toast(t('rt.saved')); }
        catch (err) { toast(err.message, 'err'); }
      });
      const form = $('#panelForm', panel);
      const md = (x) => esc(x.replaceAll('{cooldown}', s.cooldownDays)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^- /gm, '• ').replace(/\n/g, '<br>');
      const values = () => Object.fromEntries(['title', 'description', 'rules_title', 'rules', 'types_title', 'types', 'button', 'paused_button', 'color'].map((k) => [k, form[k].value]));
      const preview = () => {
        const v = values();
        $('#dcPreview', panel).innerHTML = `
          <div class="dc-msg"><img class="dc-avatar" src="/assets/cube.svg" alt=""><div class="dc-body">
            <div class="dc-name">TierTest <span class="dc-bot">BOT</span></div>
            <div class="dc-embed" style="border-left-color:${esc(v.color)}">
              <div class="dc-title">${esc(v.title)}</div>
              ${v.description ? `<div class="dc-text">${md(v.description)}</div>` : ''}
              ${v.rules ? `<div class="dc-field"><b>${esc(v.rules_title)}</b><div class="dc-text">${md(v.rules)}</div></div>` : ''}
              ${v.types ? `<div class="dc-field"><b>${esc(v.types_title)}</b><div class="dc-text">${md(v.types)}</div></div>` : ''}
              <div class="dc-footer">Mc.Tierlist.Asia</div>
            </div>
            <button type="button" class="dc-button ${a.open ? '' : 'off'}">${esc(a.open ? v.button : v.paused_button)}</button>
          </div></div>`;
      };
      form.addEventListener('input', (e) => {
        if (e.target.name === 'colorPick') form.color.value = e.target.value.toUpperCase();
        if (e.target.name === 'color' && /^#[0-9a-f]{6}$/i.test(e.target.value)) form.colorPick.value = e.target.value;
        preview();
      });
      preview();
      const saved = (r) => toast(r.botError ? t('panel.savedBotOff') : r.panelUpdated ? t('panel.saved') : t('panel.savedNoPanel'), r.botError ? 'err' : 'ok');
      $('#resetPanel', panel).addEventListener('click', () => {
        Object.entries(a.defaults).forEach(([k, v]) => { if (form[k]) form[k].value = v; });
        form.colorPick.value = a.defaults.color;
        preview();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { saved(await api('/applications', { method: 'PUT', body: { panel: values() } })); go('settings'); }
        catch (err) { toast(err.message, 'err'); }
      });
      $('#toggleApps', panel).addEventListener('click', async () => {
        try { saved(await api('/applications', { method: 'PUT', body: { open: !a.open } })); go('settings'); }
        catch (err) { toast(err.message, 'err'); }
      });
    },

    async links(panel, arg) {
      const q = arg ? decodeURIComponent(arg) : '';
      const [{ links, total }, settings] = await Promise.all([
        api(`/links${q ? `?q=${encodeURIComponent(q)}` : ''}`), perms.manageSettings ? api('/settings') : null]);
      const req = settings?.linkRequired;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.links')}${readOnly}</h2><p>${t('links.subtitle', { n: total })}</p></div></div>
          ${settings ? `<div class="apps-toggle card card-pad ${req ? 'is-open' : 'is-paused'}" style="margin-bottom:20px">
            <div><h3>${t('links.reqT')}</h3><span class="st-pill ${req ? 'open' : 'closed'}"><i></i>${t(req ? 'links.reqOn' : 'links.reqOff')}</span>
              <p class="muted" style="margin:8px 0 0;font-size:13px">${t('links.reqD')}</p></div>
            <button class="btn ${req ? 'btn-danger' : 'btn-gold'}" id="toggleReq">${t(req ? 'links.disable' : 'links.enable')}</button>
          </div>` : ''}
          <form class="toolbar" id="linkSearch" style="margin-bottom:14px"><input class="input" name="q" value="${esc(q)}" placeholder="${t('links.search')}" style="max-width:420px"></form>
          <div class="card">${links.length ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>Minecraft</th><th>Discord</th><th>${t('col.date')}</th><th></th></tr></thead>
            <tbody>${links.map((l, i) => `<tr class="row-link" data-detail="${esc(l.discord_id)}" style="animation-delay:${Math.min(i, 20) * 0.02}s">
              <td><div class="cell-player"><img src="${avatarUrl(l.uuid, 32)}" alt="">${esc(l.mc_name)}</div><div class="mono muted" style="font-size:11px">${esc(l.uuid)}</div></td>
              <td><div class="cell-player"><img src="${discordAvatar(l.discord_id, l.avatar)}" alt="" style="border-radius:50%">${esc(l.username || '—')}</div><div class="mono muted" style="font-size:11px">${esc(l.discord_id)}</div></td>
              <td class="muted" style="font-size:13px">${esc(fmtDate(l.linked_at))}</td>
              <td>${perms.managePlayers ? `<div class="actions"><button class="btn btn-sm btn-danger" data-unlink="${esc(l.discord_id)}" data-name="${esc(l.mc_name)}">${t('links.unlink')}</button></div>` : ''}</td>
            </tr>`).join('')}</tbody></table></div>` : `<div class="card-pad muted">${t('links.empty')}</div>`}</div>
        </div>`;
      $('#linkSearch', panel).addEventListener('submit', (e) => { e.preventDefault(); go(`links/${encodeURIComponent(e.target.q.value.trim())}`); });
      $('#toggleReq', panel)?.addEventListener('click', async () => {
        try { await api('/link-required', { method: 'PUT', body: { on: !req } }); go(`links/${encodeURIComponent(q)}`); } catch (err) { toast(err.message, 'err'); }
      });
      panel.addEventListener('click', async (e) => {
        const row = e.target.closest('[data-detail]');
        if (row && !e.target.closest('button, a')) return linkDetail(row.dataset.detail, () => go(`links/${encodeURIComponent(q)}`));
        const b = e.target.closest('[data-unlink]');
        if (!b || !(await confirmDialog(t('links.unlinkT'), t('links.unlinkD', { name: esc(b.dataset.name) })))) return;
        try { await api(`/links/${b.dataset.unlink}`, { method: 'DELETE' }); toast(t('links.unlinked')); go(`links/${encodeURIComponent(q)}`); } catch (err) { toast(err.message, 'err'); }
      });
    },

    async site(panel) {
      const { state, pages } = await api('/site');
      const st = structuredClone(state);
      const toLocal = (ms) => { if (!ms) return ''; const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
      const fromLocal = (v) => (v ? new Date(v).getTime() : null);
      const annState = (a) => {
        const now = Date.now();
        if (a.endAt && now >= a.endAt) return ['expired', ''];
        if (a.startAt && now < a.startAt) return ['scheduled', ''];
        return ['showing', 'on'];
      };
      const maintRow = (key, m, label, cls = '') => `
        <div class="maint-row ${cls} ${m.on ? 'on' : ''}" data-m="${key}">
          <label class="check"><input type="checkbox" data-f="on" ${m.on ? 'checked' : ''}><b style="color:var(--text)">${label}</b></label>
          <input class="input" data-f="reason" maxlength="200" value="${esc(m.reason)}" placeholder="${t('site.reason')}">
          <input class="input mono" data-f="until" type="datetime-local" value="${toLocal(m.until)}" title="${t('site.until')}">
        </div>`;
      const annHtml = (a, i) => {
        const [k, cls] = annState(a);
        return `<div class="ann-admin-row">
          <div class="ann ann-${a.style}"><div class="ann-inner" style="padding:8px 12px">
            <span class="ann-text">${esc(a.text)}${a.link ? ` <a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.linkText || a.link)} →</a>` : ''}</span>
            ${a.dismissible ? '<span class="ann-x" style="cursor:default">✕</span>' : ''}</div></div>
          <div class="meta"><span class="pill ${cls}">${t(`site.${k}`)}</span>${a.dismissible ? '' : `<span class="muted">${t('site.noX')}</span>`}
            ${a.startAt || a.endAt ? `<span class="muted">${a.startAt ? esc(fmtDate(a.startAt)) : '…'} → ${a.endAt ? esc(fmtDate(a.endAt)) : '…'}</span>` : ''}</div>
          <div class="actions"><button class="btn btn-sm" data-edit="${i}">${t('common.edit')}</button><button class="btn btn-sm btn-danger" data-del="${i}">${t('common.delete')}</button></div>
        </div>`;
      };

      async function save(msg = t('site.saved')) {
        try {
          const r = await api('/site', { method: 'PUT', body: st });
          Object.assign(st, r.state);
          toast(msg);
          draw();
        } catch (err) { toast(err.message, 'err'); }
      }

      function draw() {
        const pending = st.launchAt && st.launchAt > Date.now();
        panel.innerHTML = `
          <div class="panel">
            <div class="panel-head"><div><h2>${t('tab.site')}</h2><p>${t('site.subtitle')}</p></div></div>
            <div class="site-grid">
              <div class="card card-pad site-card">
                <h3>${t('site.launchT')} <span class="pill ${pending ? 'off' : 'on'}" style="margin-left:6px">● ${t(pending ? 'site.pending' : 'site.live')}</span></h3>
                <p class="desc">${t('site.launchD')}</p>
                <div class="launch-row">
                  <input class="input mono" id="launchAt" type="datetime-local" value="${toLocal(st.launchAt)}">
                  <button class="btn" id="launchClear">${t('site.clear')}</button>
                  <button class="btn btn-gold" data-save>${t('common.save')}</button>
                  ${pending ? `<span class="muted" style="font-size:13px">${esc(fmtRelative(st.launchAt))}</span>` : ''}
                </div>
              </div>

              <div class="card card-pad site-card">
                <h3>${t('site.maintT')}</h3>
                <p class="desc">${t('site.maintD')}</p>
                <div class="maint-list">
                  ${maintRow('all', st.maintenance.all, t('site.all'), 'all')}
                  ${pages.map((p) => maintRow(p, st.maintenance.pages[p], t(`site.page.${p}`))).join('')}
                </div>
                <div class="site-save"><button class="btn btn-gold" data-save>${t('common.save')}</button></div>
              </div>

              <div class="card card-pad site-card">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
                  <div><h3>${t('site.annT')}</h3><p class="desc">${t('site.annD')}</p></div>
                  <button class="btn btn-gold" id="annAdd" ${st.announcements.length >= 10 ? 'disabled' : ''}>${t('site.annAdd')}</button>
                </div>
                <div class="ann-admin">${st.announcements.length ? st.announcements.map(annHtml).join('') : `<div class="muted">${t('site.annEmpty')}</div>`}</div>
              </div>
            </div>
          </div>`;

        $('#launchAt', panel).addEventListener('change', (e) => { st.launchAt = fromLocal(e.target.value); });
        $('#launchClear', panel).addEventListener('click', () => { $('#launchAt', panel).value = ''; st.launchAt = null; });
        $$('[data-m]', panel).forEach((row) => {
          const m = row.dataset.m === 'all' ? st.maintenance.all : st.maintenance.pages[row.dataset.m];
          row.addEventListener('input', (e) => {
            const f = e.target.dataset.f;
            if (f === 'on') { m.on = e.target.checked; row.classList.toggle('on', m.on); }
            if (f === 'reason') m.reason = e.target.value;
            if (f === 'until') m.until = fromLocal(e.target.value);
          });
        });
        $$('[data-save]', panel).forEach((b) => b.addEventListener('click', () => save()));
        $('#annAdd', panel).addEventListener('click', () => editAnn());
        panel.querySelector('.ann-admin').addEventListener('click', async (e) => {
          const ed = e.target.closest('[data-edit]');
          if (ed) return editAnn(Number(ed.dataset.edit));
          const del = e.target.closest('[data-del]');
          if (del && await confirmDialog(t('common.delete'), esc(st.announcements[del.dataset.del].text))) {
            st.announcements.splice(Number(del.dataset.del), 1);
            save();
          }
        });
      }

      function editAnn(i) {
        const a = i === undefined ? { text: '', style: 'gold', dismissible: true, link: '', linkText: '', startAt: null, endAt: null } : st.announcements[i];
        modal(`
          <h3>${t(i === undefined ? 'site.annAdd' : 'site.annEdit')}</h3>
          <form id="annForm">
            <div class="field"><label>${t('site.annText')}</label><textarea class="input" name="text" maxlength="300" rows="3" required>${esc(a.text)}</textarea></div>
            <div class="row2">
              <div class="field"><label>${t('site.annStyle')}</label><select class="input" name="style">
                ${['gold', 'info', 'warn'].map((s) => `<option value="${s}" ${a.style === s ? 'selected' : ''}>${t(`site.style.${s}`)}</option>`).join('')}</select></div>
              <div class="field" style="display:flex;align-items:flex-end"><label class="check"><input type="checkbox" name="dismissible" ${a.dismissible ? 'checked' : ''}>${t('site.dismissible')}</label></div>
            </div>
            <div class="row2">
              <div class="field"><label>${t('site.link')}</label><input class="input mono" name="link" maxlength="300" value="${esc(a.link)}" placeholder="https://… /discord"></div>
              <div class="field"><label>${t('site.linkText')}</label><input class="input" name="linkText" maxlength="40" value="${esc(a.linkText)}"></div>
            </div>
            <div class="row2">
              <div class="field"><label>${t('site.start')}</label><input class="input mono" name="startAt" type="datetime-local" value="${toLocal(a.startAt)}"></div>
              <div class="field"><label>${t('site.end')}</label><input class="input mono" name="endAt" type="datetime-local" value="${toLocal(a.endAt)}"></div>
            </div>
            <div class="field"><label>${t('site.preview')}</label><div class="ann-admin" id="annPrev"></div></div>
            <div class="modal-actions"><button type="button" class="btn" data-close>${t('common.cancel')}</button><button class="btn btn-gold">${t('common.save')}</button></div>
          </form>`, (bg, close) => {
          const form = $('#annForm', bg);
          const read = () => ({ ...a, text: form.text.value.trim(), style: form.style.value, dismissible: form.dismissible.checked,
            link: form.link.value.trim(), linkText: form.linkText.value.trim(), startAt: fromLocal(form.startAt.value), endAt: fromLocal(form.endAt.value) });
          const preview = () => {
            const d = read();
            $('#annPrev', bg).innerHTML = `<div class="ann ann-${d.style}"><div class="ann-inner" style="padding:8px 12px"><span class="ann-text">${esc(d.text || '…')}${d.link ? ` <a>${esc(d.linkText || d.link)} →</a>` : ''}</span>${d.dismissible ? '<span class="ann-x">✕</span>' : ''}</div></div>`;
          };
          form.addEventListener('input', preview);
          form.addEventListener('change', preview);
          preview();
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const d = read();
            const prev = [...st.announcements];
            if (i === undefined) st.announcements.push(d); else st.announcements[i] = d;
            try {
              const r = await api('/site', { method: 'PUT', body: st });
              Object.assign(st, r.state);
              close(); toast(t('site.saved')); draw();
            } catch (err) { st.announcements = prev; toast(err.message, 'err'); }
          });
        });
      }

      draw();
    },

    async audit() {
      location.href = '/audit';
    },
  };



  // ---------- account link detail dialog ----------
  async function linkDetail(did, onChange) {
    const bg = document.createElement('div');
    bg.className = 'pfx-bg';
    bg.innerHTML = `<div class="pfx ld" role="dialog" aria-modal="true"><div class="skeleton" style="height:100%;border-radius:0"></div></div>`;
    document.body.append(bg);
    document.body.classList.add('pfx-open');
    const close = () => {
      bg.classList.add('closing'); document.body.classList.remove('pfx-open');
      removeEventListener('keydown', onKey); setTimeout(() => bg.remove(), 320);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });

    let d;
    try { d = await api(`/links/${did}/detail`); } catch (err) { close(); toast(err.message, 'err'); return; }
    const dc = d.discord;
    const mc = d.minecraft;
    const live = dc.live;
    const roles = live ? live.roles : dc.storedRoles;
    const kv = (rows) => `<div class="ld-kv">${rows.filter(Boolean).map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>`;
    const when = (ms) => (ms ? `${esc(fmtDate(ms))} <span class="muted">(${esc(fmtRelative(ms))})</span>` : '<span class="muted">—</span>');
    const copyBtn = (v) => `<button class="ld-copy" data-copy="${esc(v)}" title="${t('common.copy')}">⧉</button>`;
    const tabs = [['discord', 'Discord'], ['minecraft', 'Minecraft'], ['tests', t('me.history')]];
    if (d.audit) tabs.push(['records', t('ld.records')]);

    const views = {
      discord: () => `
        <div class="ld-hero">
          <img class="ld-avatar" src="${discordAvatar(dc.id, dc.avatar)}" alt="">
          <div><h3>${esc(live?.displayName || dc.username || dc.id)}</h3>
            <div class="muted mono" style="font-size:12.5px">${esc(live?.username || dc.username || '')} · ${esc(dc.id)} ${copyBtn(dc.id)}</div>
            <div class="chips-row" style="margin-top:8px">${levelChips({ ...dc, badges: dc.badges || [] })}
              <span class="pill ${dc.inGuild ? 'on' : 'off'}">● ${t(dc.inGuild ? 'ld.inGuild' : 'ld.notInGuild')}</span></div></div>
        </div>
        ${kv([
          [t('ld.created'), when(dc.createdAt)],
          live?.joinedAt ? [t('ld.joined'), when(live.joinedAt)] : null,
          live?.nick ? [t('ld.nick'), esc(live.nick)] : null,
          live?.boostingSince ? [t('ld.boosting'), when(live.boostingSince)] : null,
          [t('ld.level'), `${esc(t(`level.${dc.levelName}`))}${dc.seniorTester ? ` · ${t('level.senior')}` : dc.tester ? ` · ${t('level.tester')}` : ''}`],
        ])}
        <h4 class="ld-h">${t('ld.roles')} <span class="muted">(${roles.length})</span>
          <small class="muted">${live ? t('ld.rolesLive') : dc.botOnline && dc.liveError ? t('ld.rolesFailed') : t('ld.rolesCached', { time: esc(fmtRelative(dc.cachedAt || Date.now())) })}</small></h4>
        <div class="ld-roles">${roles.length ? roles.map((r, i) => `<span class="ld-role" style="--rc:${esc(r.color || '#99aab5')};--i:${i}"><i></i>${esc(r.name)}</span>`).join('') : `<span class="muted">${t('pf.none')}</span>`}</div>`,
      minecraft: () => (!mc ? `<p class="muted pfx-empty">${t('ld.noMc')}</p>` : `
        <div class="ld-hero">
          <img class="ld-avatar px" src="${avatarUrl(mc.uuid || mc.name, 96)}" alt="">
          <div><h3>${esc(mc.name)}</h3>
            <div class="muted mono" style="font-size:12px">${esc(mc.uuid || '—')} ${mc.uuid ? copyBtn(mc.uuid) : ''}</div>
            <div class="chips-row" style="margin-top:8px">
              ${mc.player ? tierBadge(mc.player.tiers.vanilla.tier, { retired: mc.player.tiers.vanilla.retired }) : `<span class="pill">${t('ld.unranked')}</span>`}
              ${mc.player?.banned ? `<span class="pill off">⛔ ${t('ld.banned')}</span>` : ''}
              ${mc.presence ? `<span class="pill ${mc.presence.online ? 'on' : ''}">● ${mc.presence.online ? t('ld.online') : t('pf.offline')}</span>` : ''}
            </div></div>
          <a class="btn btn-sm" href="/player/${encodeURIComponent(mc.name)}" target="_blank" rel="noopener" style="margin-left:auto">${t('ctx.openPlayer')} ↗</a>
        </div>
        ${kv([
          mc.linkedAt ? [t('ld.linkedAt'), when(mc.linkedAt)] : [t('ld.linkedAt'), `<span class="muted">${t('ld.notLinked')}</span>`],
          mc.player ? [t('card.position'), `#${mc.player.rank} · ${mc.player.points} ${t('common.pts')}`] : null,
          mc.player ? [t('pf.testRecord'), `<span class="win">${mc.player.stats.wins}</span> – <span class="loss">${mc.player.stats.losses}</span>`] : null,
          [t('me.cooldown'), d.cooldownUntil ? when(d.cooldownUntil) : `<span class="win">${t('me.ready')}</span>`],
          d.openTicket ? [t('me.openTicket'), `${esc(d.openTicket.mc_name)} ${d.guildId ? `<a href="https://discord.com/channels/${d.guildId}/${d.openTicket.channel_id}" target="_blank" rel="noopener">↗</a>` : ''}`] : null,
          mc.presence ? [t('pf.activity'), mc.presence.online ? `<span class="win">${t('ld.online')}</span> · ${esc(mc.presence.world || '')}` : when(mc.presence.last_seen)] : null,
          mc.server ? [t('pf.fullKicker'), `${mc.server.kills} ${t('pf.kills')} · ${mc.server.deaths} ${t('pf.deaths')} · ${mc.server.matches} ${t('pf.matches')}`] : null,
        ])}
        ${mc.names.length ? `<h4 class="ld-h">${t('pf.names')}</h4><div class="ld-names">${mc.names.map((n) => `<span>${esc(n.name)} <small class="muted">${esc(new Date(n.first_seen).toLocaleDateString())}</small></span>`).join('')}</div>` : ''}`),
      tests: () => (d.tests.length ? testsTable(d.tests, [
        ['col.date', (x) => `<span class="muted">${esc(fmtDate(x.created_at))}</span>`],
        ['col.result', resultCell], ['col.score', scoreCell], ['col.tester', (x) => esc(x.tester_name || '—')],
      ]) : `<p class="muted pfx-empty">${t('me.noTests')}</p>`),
      records: () => `
        <h4 class="ld-h">${t('tab.bans')} <span class="muted">(${d.bans.length})</span></h4>
        ${d.bans.length ? `<div class="ld-list">${d.bans.map((b) => `<div><span class="pill ${b.status === 'active' ? 'off' : ''}">${t(`bans.status.${b.status}`)}</span><b>${esc(b.mc_name)}</b><span class="muted">${esc(b.reason)}</span><time>${esc(fmtDate(b.created_at))}</time></div>`).join('')}</div>` : `<p class="muted">${t('pf.none')}</p>`}
        <h4 class="ld-h">${t('tab.support')} <span class="muted">(${d.support.length})</span></h4>
        ${d.support.length ? `<div class="ld-list">${d.support.map((x) => `<a href="#support/${x.id}" data-close>${statusPill(x.status)}<b>#${x.id} ${esc(x.title)}</b><span class="muted">${catLabel(x.category)}</span><time>${esc(fmtRelative(x.updated_at))}</time></a>`).join('')}</div>` : `<p class="muted">${t('pf.none')}</p>`}
        ${d.reportedIn.length ? `<h4 class="ld-h">${t('ld.reportedIn')} <span class="muted">(${d.reportedIn.length})</span></h4><div class="ld-list">${d.reportedIn.map((x) => `<a href="#support/${x.id}" data-close>${statusPill(x.status)}<b>#${x.id} ${esc(x.title)}</b><span class="muted">${esc(x.username || '')}</span><time>${esc(fmtRelative(x.updated_at))}</time></a>`).join('')}</div>` : ''}
        <h4 class="ld-h">${t('akey.title')} <span class="muted">(${d.keys.length})</span></h4>
        ${d.keys.length ? `<div class="ld-list">${d.keys.map((k) => `<div><span class="mono muted">${esc(k.prefix)}…</span><b>${esc(k.name)}</b><span class="muted">${t('col.calls')} ${k.usage_count}</span><time>${esc(fmtRelative(k.last_used_at || k.created_at))}</time></div>`).join('')}</div>` : `<p class="muted">${t('pf.none')}</p>`}
        <h4 class="ld-h">${t('nav.audit')} <a class="ld-more" href="/audit#user/${encodeURIComponent(dc.id)}">${t('au.d.profile')} →</a></h4>
        ${d.audit.length ? `<div class="ld-list">${d.audit.map((a) => `<div><span class="au-src-badge ${esc(a.source || 'legacy')}">${esc(t(`au.src.${a.source || 'legacy'}`))}</span><b>${esc(window.I18N.has(`action.${a.action}`) ? t(`action.${a.action}`) : a.action)}</b><span class="muted">${esc(a.actor_id === dc.id ? '' : a.actor_name || '')} ${esc(a.detail || '')}</span><time>${esc(fmtRelative(a.created_at))}</time></div>`).join('')}</div>` : `<p class="muted">${t('pf.none')}</p>`}`,
    };

    const box = $('.pfx', bg);
    box.innerHTML = `
      <header class="pfx-head">
        <img src="${discordAvatar(dc.id, dc.avatar)}" alt="" style="border-radius:50%">
        <div><div class="kicker">${t('tab.links')}</div><h2>${esc(live?.displayName || dc.username || dc.id)}${mc ? ` <span class="muted">↔</span> ${esc(mc.name)}` : ''}</h2></div>
        ${perms.managePlayers && mc?.linkedAt ? `<button class="btn btn-sm btn-danger" data-unlink-now>${t('links.unlink')}</button>` : ''}
        <button class="pfx-x" aria-label="${t('card.close')}">✕</button>
      </header>
      <nav class="pfx-tabs"><i class="pfx-ink"></i>${tabs.map(([id, label]) => `<button data-t="${id}">${label}</button>`).join('')}</nav>
      <div class="pfx-body"></div>`;
    const body = $('.pfx-body', box);
    const ink = $('.pfx-ink', box);
    const select = (id) => {
      $$('.pfx-tabs button', box).forEach((b) => {
        b.classList.toggle('active', b.dataset.t === id);
        if (b.dataset.t === id) { ink.style.width = `${b.offsetWidth}px`; ink.style.transform = `translateX(${b.offsetLeft}px)`; }
      });
      body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
      body.innerHTML = views[id]();
      body.scrollTop = 0;
    };
    $$('.pfx-tabs button', box).forEach((b) => b.addEventListener('click', () => select(b.dataset.t)));
    $('.pfx-x', box).addEventListener('click', close);
    box.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); toast(t('common.copied')); } catch { /* ignore */ } }
      if (e.target.closest('[data-close]')) close();
      if (e.target.closest('[data-unlink-now]')) {
        if (!(await confirmDialog(t('links.unlinkT'), t('links.unlinkD', { name: esc(mc.name) })))) return;
        try { await api(`/links/${did}`, { method: 'DELETE' }); toast(t('links.unlinked')); close(); onChange?.(); } catch (err) { toast(err.message, 'err'); }
      }
    });
    requestAnimationFrame(() => select('discord'));
  }

  function showKey(key) {
    modal(`
      <h3>${t('keys.createdT')}</h3>
      <p class="muted" style="margin:0 0 14px">${t('keys.createdD')}</p>
      <div class="key-reveal"><span style="flex:1">${esc(key)}</span></div>
      <div class="modal-actions"><button class="btn" id="copyKey">${t('common.copy')}</button><button class="btn btn-gold" data-close>${t('keys.saved')}</button></div>`,
    (bg) => {
      $('#copyKey', bg).addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(key); e.target.textContent = t('common.copied'); } catch { toast(t('common.copyFailed'), 'err'); }
      });
    });
    go('keys');
  }

  function playerForm(p) {
    const editing = !!p;
    let tier = p?.tier || 'LT5';
    modal(`
      <h3>${editing ? t('players.editTitle', { name: esc(p.name) }) : t('players.addTitle')}</h3>
      <form id="playerForm">
        <div class="field"><label>${t('players.mcName')}</label><input class="input" name="name" maxlength="16" value="${esc(p?.name || '')}" placeholder="Steve" required></div>
        <div class="field"><label>${t('players.uuid')}</label><input class="input mono" name="uuid" value="${esc(p?.uuid || '')}" placeholder="8667ba71-b85a-4004-af54-457a9734eed7"></div>
        <div class="field"><label>${t('players.discord')}</label><input class="input mono" name="discordId" inputmode="numeric" value="${esc(p?.discord_id || '')}" placeholder="995145509897523221"></div>
        <div class="field"><label>${t('players.tier')}</label><div class="tier-picker">${TIERS.map((x) => `<button type="button" data-t="${x}" class="${x === tier ? 'active' : ''}">${x}</button>`).join('')}</div></div>
        <div class="row2">
          <div class="field"><label>${t('card.wins')}</label><input class="input mono" name="wins" type="number" min="0" value="${p?.wins ?? 0}"></div>
          <div class="field"><label>${t('card.losses')}</label><input class="input mono" name="losses" type="number" min="0" value="${p?.losses ?? 0}"></div>
        </div>
        <label class="check"><input type="checkbox" name="retired" ${p?.retired ? 'checked' : ''}> ${t('players.retired')}</label>
        <div class="modal-actions"><button type="button" class="btn" data-close>${t('common.cancel')}</button><button class="btn btn-gold">${t(editing ? 'common.save' : 'common.add')}</button></div>
      </form>`, (bg, close) => {
      const form = $('#playerForm', bg);
      $('.tier-picker', bg).addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]');
        if (!b) return;
        tier = b.dataset.t;
        $$('.tier-picker button', bg).forEach((x) => x.classList.toggle('active', x === b));
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          name: form.name.value.trim(), uuid: form.uuid.value.trim(), discordId: form.discordId.value.trim(),
          tier, wins: Number(form.wins.value) || 0, losses: Number(form.losses.value) || 0, retired: form.retired.checked,
        };
        try {
          await api(editing ? `/players/${p.id}` : '/players', { method: editing ? 'PUT' : 'POST', body });
          close();
          toast(t(editing ? 'players.updated' : 'players.created', { name: body.name }));
          go('players');
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  addEventListener('hashchange', () => go(location.hash.slice(1) || 'overview'));
  go(location.hash.slice(1) || 'overview');
});
