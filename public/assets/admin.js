/* Mc.Tierlist.Asia — staff panel */
document.addEventListener('DOMContentLoaded', async () => {
  const { $, $$, esc, t, tierBadge, avatarUrl, discordAvatar, toast, countUp, session, levelChips, loginUrl,
    testsTable, resultCell, scoreCell, icon } = window.MCTL;
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
    ['tests', 'tab.tests', true, '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'],
    ['keys', 'tab.keys', perms.manageKeys, '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>'],
    ['team', 'tab.team', true, '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'],
    ['settings', 'tab.settings', perms.manageSettings, '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'],
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

  function go(tab) {
    if (!views[tab] || !TABS.some(([id]) => id === tab)) tab = 'overview';
    history.replaceState(null, '', `#${tab}`);
    $$('.side-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    // Fresh element per view so event listeners from the previous view don't pile up.
    const old = $('#panel');
    const panel = old.cloneNode(false);
    old.replaceWith(panel);
    panel.innerHTML = '<div class="skeleton" style="height:320px"></div>';
    views[tab](panel).catch((err) => {
      if (err.message !== 'unauthorized') panel.innerHTML = `<div class="empty"><div><h3>${t('common.loadFailed')}</h3><p>${esc(err.message)}</p></div></div>`;
    });
  }

  const actionLabel = (a) => (window.I18N.has(`action.${a}`) ? t(`action.${a}`) : a);
  const auditHtml = (entries) => (entries.length
    ? entries.map((e, i) => `<div class="audit-item" style="animation-delay:${i * 0.03}s"><span class="dot"></span>
        <div><b>${esc(e.actor_name || 'system')}</b> <span class="muted">${esc(actionLabel(e.action))}</span>${e.detail ? ` · <span class="mono">${esc(e.detail)}</span>` : ''}</div>
        <time>${esc(fmtDate(e.created_at))}</time></div>`).join('')
    : `<div class="card-pad muted">${t('audit.empty')}</div>`);
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
      const { keys } = await api('/keys');
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
        try {
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

    async settings(panel) {
      const s = await api('/settings');
      const ch = (id) => (id ? `<span class="mono">#${esc(id)}</span>${s.guildId ? ` <a class="btn btn-sm" href="https://discord.com/channels/${s.guildId}/${id}" target="_blank" rel="noopener">↗</a>` : ''}` : `<span class="muted">${t('settings.notSet')}</span>`);
      const row = (label, value) => `<div class="set-row"><span>${label}</span><div>${value}</div></div>`;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>${t('tab.settings')}</h2><p>${t('settings.subtitle')}</p></div></div>
          <div class="card card-pad">
            ${row(t('settings.bot'), s.botConfigured ? `<span class="pill ${s.botOnline ? 'on' : 'off'}">● ${t(s.botOnline ? 'admin.botOnline' : 'admin.botOffline')}</span>` : `<span class="pill off">${t('settings.notConfigured')}</span>`)}
            ${row(t('settings.resultChannel'), ch(s.resultChannel))}
            ${row(t('settings.applyChannel'), ch(s.applyChannel))}
            ${row(t('settings.category'), s.ticketCategory ? `<span class="mono">${esc(s.ticketCategory)}</span>` : `<span class="muted">${t('settings.notSet')}</span>`)}
            ${row(t('settings.cooldown'), t('settings.days', { n: s.cooldownDays }))}
          </div>
          <p class="muted" style="font-size:14px;margin-top:14px">${t('settings.howto')}</p>
        </div>`;
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

  go(location.hash.slice(1) || 'overview');
});
