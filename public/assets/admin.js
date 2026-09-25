/* Mc.Tierlist.Asia — staff panel */
document.addEventListener('DOMContentLoaded', async () => {
  const { $, $$, esc, t, tierBadge, avatarUrl, discordAvatar, toast, countUp, session, levelChips, loginUrl,
    testsTable, resultCell, scoreCell, icon, statusPill, catLabel, catIcon, threadHtml, composerHtml, bindComposer, ticketHeadHtml } = window.MCTL;
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
    ['tests', 'tab.tests', true, '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'],
    ['keys', 'tab.keys', perms.manageKeys, '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>'],
    ['team', 'tab.team', true, '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'],
    ['settings', 'tab.settings', perms.manageSettings, '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'],
    ['storage', 'tab.storage', true, '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'],
    ['audit', 'tab.audit', true, '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>'],
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
          <div class="panel-head"><div><h2 style="font-size:19px">${t('admin.recent')}</h2></div><button class="btn btn-sm" data-go="audit">${t('admin.viewAll')}</button></div>
          <div class="card audit">${auditHtml(d.recent)}</div>
        </div>`;
      $$('[data-n]', panel).forEach((el) => countUp(el, Number(el.dataset.n)));
      $('[data-go]', panel).addEventListener('click', () => go('audit'));
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
      if (arg && /^\d+$/.test(arg)) return supportTicket(panel, arg);
      const filter = ['open', 'in_progress', 'closed'].includes(arg) ? arg : '';
      const [{ tickets, counts }, { blocks }] = await Promise.all([api(`/support${filter ? `?status=${filter}` : ''}`), api('/support/blocks')]);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const seg = [['', t('support.filterAll'), total], ...['open', 'in_progress', 'closed'].map((st) => [st, t(`support.status.${st}`), counts[st] || 0])];
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.support')}</h2><p>${t('support.subtitle')}</p></div></div>
          <div class="seg" style="margin-bottom:14px">${seg.map(([st, label, n]) => `<button class="${st === filter ? 'active' : ''}" data-go="support${st ? `/${st}` : ''}">${label} (${n})</button>`).join('')}</div>
          <div class="card" style="margin-bottom:26px">${tickets.length ? tickets.map((x) => `
            <a class="ticket-row" href="#support/${x.id}" data-open="${x.id}">
              ${catIcon(x.category)}<span class="mono muted">#${x.id}</span>
              <span class="ticket-title"><b>${esc(x.title)}</b><span class="muted">${catLabel(x.category)} · ${esc(x.username || x.user_id)} · ${esc(fmtRelative(x.updated_at))} · ${t('support.messages', { n: x.message_count })}</span></span>
              ${x.status !== 'closed' && !x.last_is_staff ? `<span class="pill high">${t('support.awaiting')}</span>` : ''}
              ${statusPill(x.status)}
            </a>`).join('') : `<div class="card-pad muted">${t('support.none')}</div>`}</div>
          <div class="panel-head"><h2 style="font-size:19px">${t('support.blocks')}</h2></div>
          <div class="card">${blocks.length ? blocks.map((b) => `
            <div class="ticket-row"><span class="mono muted">${esc(b.discord_id)}</span><span class="ticket-title"><b>${esc(b.username || '—')}</b><span class="muted">${esc(b.reason || '')} · ${esc(fmtDate(b.created_at))}</span></span>
            ${perms.managePlayers ? `<button class="btn btn-sm" data-unblock="${esc(b.discord_id)}">${t('support.unblock')}</button>` : ''}</div>`).join('') : `<div class="card-pad muted">${t('support.noBlocks')}</div>`}</div>
        </div>`;
      panel.addEventListener('click', async (e) => {
        const g = e.target.closest('[data-go]');
        if (g) return go(g.dataset.go);
        const o = e.target.closest('[data-open]');
        if (o) { e.preventDefault(); return go(`support/${o.dataset.open}`); }
        const u = e.target.closest('[data-unblock]');
        if (u) {
          try { await api(`/support/blocks/${u.dataset.unblock}`, { method: 'DELETE' }); go(`support${filter ? `/${filter}` : ''}`); }
          catch (err) { toast(err.message, 'err'); }
        }
      });
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
                  <td><b>${esc(k.name)}</b><div class="muted" style="font-size:12px">${esc(fmtDate(k.created_at))}</div></td>
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
          <div class="modal-actions"><button type="button" class="btn" data-close>${t('common.cancel')}</button><button class="btn btn-gold">${t('common.create')}</button></div>
        </form>`, (bg, close) => {
        $('#keyForm', bg).addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            const { key } = await api('/keys', { method: 'POST', body: { name: e.target.name.value } });
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
              <img class="dc-thumb" src="https://mc-heads.net/body/Steve/128" alt="">
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

    async audit(panel) {
      const { entries } = await api('/audit?limit=200');
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.audit')}</h2><p>${t('audit.subtitle')}</p></div></div>
          <div class="card audit">${auditHtml(entries)}</div>
        </div>`;
    },
  };

  async function supportTicket(panel, id) {
    const res = await fetch(`/api/support/tickets/${id}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return go('support');
    const d = await res.json();
    const tk = d.ticket;
    panel.innerHTML = `
      <div class="panel">
        <a href="#support" class="link-more back-link" data-go="support">${t('support.back')}</a>
        ${ticketHeadHtml(tk, `<div class="ticket-hero-side">
          <div class="muted" style="font-size:13px">${esc(tk.username || tk.user_id)} · <span class="mono">${esc(tk.user_id)}</span></div>
          <div class="actions">
            <div class="select-wrap"><select id="stSel" aria-label="${t('support.setStatus')}">${['open', 'in_progress', 'closed'].map((st) => `<option value="${st}" ${st === tk.status ? 'selected' : ''}>${t(`support.status.${st}`)}</option>`).join('')}</select></div>
            ${perms.managePlayers ? `<button class="btn btn-sm" id="blockUser">${t('support.block')}</button><button class="btn btn-sm btn-danger" id="delTicket">${t('common.delete')}</button>` : ''}
          </div></div>`)}
        <div class="thread">${threadHtml(d, (m) => !!m.is_staff)}</div>
        ${composerHtml()}
      </div>`;
    $('[data-go]', panel).addEventListener('click', (e) => { e.preventDefault(); go('support'); });
    bindComposer(panel, tk.id, () => go(`support/${tk.id}`));
    $('#stSel', panel).addEventListener('change', async (e) => {
      try { await api(`/support/${tk.id}`, { method: 'PATCH', body: { status: e.target.value } }); go(`support/${tk.id}`); }
      catch (err) { toast(err.message, 'err'); }
    });
    $('#blockUser', panel)?.addEventListener('click', async () => {
      if (!(await confirmDialog(t('support.blockT'), t('support.blockD', { name: esc(tk.username || tk.user_id) })))) return;
      try { await api('/support/blocks', { method: 'POST', body: { discordId: tk.user_id, reason: `#${tk.id}` } }); toast(t('support.toastBlocked', { name: tk.username || tk.user_id })); }
      catch (err) { toast(err.message, 'err'); }
    });
    $('#delTicket', panel)?.addEventListener('click', async () => {
      if (!(await confirmDialog(t('support.deleteT'), t('support.deleteD', { id: tk.id })))) return;
      try { await api(`/support/${tk.id}`, { method: 'DELETE' }); toast(t('support.toastDeleted')); go('support'); }
      catch (err) { toast(err.message, 'err'); }
    });
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
