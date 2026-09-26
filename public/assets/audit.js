/* Mc.Tierlist.Asia — audit log page (/audit, admins only) */
document.addEventListener('DOMContentLoaded', async () => {
  const { $, $$, esc, t, avatarUrl, discordAvatar, toast, countUp, session, levelChips, loginUrl, icon, initReveal } = window.MCTL;
  const { fmtDate, fmtRelative, lang } = window.I18N;
  const root = $('#auditRoot');
  const { user: me, permissions: perms } = await session;

  if (!me || !perms.viewAudit) {
    root.innerHTML = `
      <div class="login-wrap"><div class="login-card reveal in">
        <img src="/assets/cube.svg" alt=""><h1>${t('nav.audit')}</h1>
        <p>${me ? t('au.denied') : t('admin.loginD')}</p>
        ${me ? `<a class="btn" href="/">${t('page404.back')}</a>` : `<a class="btn btn-discord" href="${loginUrl()}">${icon.discord}${t('nav.loginDiscord')}</a>`}
      </div></div>`;
    return;
  }

  async function api(path) {
    const res = await fetch(`/api/admin/audit${path}`, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || t('common.error'));
    return data;
  }

  // ---------------------------------------------------------------- vocabulary
  const CATEGORIES = {
    auth: ['login'],
    players: ['player_create', 'player_update', 'player_delete', 'cooldown_reset', 'mc_rename'],
    tests: ['test_result', 'ticket_open', 'ticket_close', 'ticket_force_close', 'ticket_reopen', 'ticket_kind'],
    bans: ['ban_create', 'ban_revoke', 'punish_ban', 'punish_ipban', 'punish_mute', 'punish_warn', 'punish_kick',
      'unpunish_ban', 'unpunish_ipban', 'unpunish_mute', 'unpunish_warn', 'unpunish_kick', 'punish_settings'],
    support: ['support_open', 'support_status', 'support_delete', 'support_block', 'support_unblock', 'support_claim', 'support_unclaim', 'support_priority', 'appeal_accept', 'appeal_reject', 'image_delete', 'image_cleanup'],
    keys: ['key_create', 'key_revoke', 'key_restore', 'key_delete', 'account_key_create', 'account_key_delete', 'account_key_revoke'],
    links: ['mc_link', 'mc_unlink', 'link_required'],
    settings: ['panel_update', 'applications_open', 'applications_pause', 'result_template_update', 'discord_invite_update',
      'site_update', 'setup_result_channel', 'setup_apply', 'setup_support_channel', 'perms_update', 'support_templates'],
    discord: ['roleup', 'roleup_approve', 'roleup_deny'],
    system: ['ddns_update'],
  };
  const CAT_OF = Object.fromEntries(Object.entries(CATEGORIES).flatMap(([c, list]) => list.map((a) => [a, c])));
  const CAT_ICON = {
    auth: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    players: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/>',
    tests: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    bans: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    support: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    keys: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3"/>',
    links: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3"/>',
    discord: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    system: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/>',
  };
  const catSvg = (c, size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CAT_ICON[c] || CAT_ICON.system}</svg>`;
  const actionLabel = (a) => (window.I18N.has(`action.${a}`) ? t(`action.${a}`) : a);
  const srcLabel = (s) => t(`au.src.${s || 'legacy'}`);
  const ttLabel = (x) => (window.I18N.has(`au.tt.${x}`) ? t(`au.tt.${x}`) : x);
  const FIELD = {
    tier: 'col.tier', name: 'col.name', status: 'col.status',
  };
  const fieldLabel = (f) => (FIELD[f] && window.I18N.has(FIELD[f]) ? `${t(FIELD[f])} <span class="mono muted">${esc(f)}</span>` : `<span class="mono">${esc(f)}</span>`);
  const TZ = 'Asia/Taipei';
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString(lang, { timeZone: TZ, hour12: false });
  const fmtDay = (ms) => new Date(ms).toLocaleDateString(lang, { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const fmtFull = (ms) => new Date(ms).toLocaleString(lang, { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dayKey = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

  function parseUA(ua) {
    if (!ua) return null;
    const browser = (/Edg\//.test(ua) && 'Edge') || (/OPR\//.test(ua) && 'Opera') || (/Discord/.test(ua) && 'Discord')
      || (/Chrome\//.test(ua) && 'Chrome') || (/Firefox\//.test(ua) && 'Firefox') || (/Safari\//.test(ua) && 'Safari')
      || (/TierlistLink/.test(ua) && 'TierlistLink') || (/python|curl|Java|node/i.test(ua) && ua.split(/[/ ]/)[0]) || '?';
    const os = (/Windows/.test(ua) && 'Windows') || (/iPhone|iPad/.test(ua) && 'iOS') || (/Android/.test(ua) && 'Android')
      || (/Mac OS X/.test(ua) && 'macOS') || (/Linux/.test(ua) && 'Linux') || '';
    return `${browser}${os ? ` · ${os}` : ''}`;
  }

  // ---------------------------------------------------------------- tooltip
  const tip = document.createElement('div');
  tip.className = 'au-tip';
  document.body.append(tip);
  const showTip = (e, html) => {
    tip.innerHTML = html;
    tip.classList.add('on');
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, e.clientY - r.height - 12)}px)`;
  };
  const hideTip = () => tip.classList.remove('on');

  // ---------------------------------------------------------------- charts (single series, gold)
  const barPath = (x, y, w, h, r) => {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  };
  const niceMax = (v) => {
    if (v <= 4) return 4;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
  };

  /** Vertical bar chart: items [{label, value, tip}] */
  function columnChart(el, items, { labelEvery = 1 } = {}) {
    const W = el.clientWidth || 600;
    const H = 180;
    const pad = { l: 34, r: 6, t: 10, b: 24 };
    const max = niceMax(Math.max(1, ...items.map((i) => i.value)));
    const iw = W - pad.l - pad.r;
    const slot = iw / Math.max(1, items.length);
    const bw = Math.max(2, Math.min(28, slot - 2));
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
    const grid = [0, max / 2, max].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="au-grid"/>
      <text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" class="au-axis">${Math.round(v)}</text>`).join('');
    const bars = items.map((it, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      return `<g class="au-col" data-i="${i}"><rect x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${H - pad.t - pad.b}" fill="transparent"/>
        <path d="${barPath(x, y(it.value), bw, y(0) - y(it.value), 4)}" class="au-bar"/>
        ${i % labelEvery === 0 ? `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="au-axis">${esc(it.label)}</text>` : ''}</g>`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">${grid}${bars}</svg>`;
    $$('.au-col', el).forEach((g) => {
      const it = items[g.dataset.i];
      g.addEventListener('mousemove', (e) => showTip(e, it.tip));
      g.addEventListener('mouseleave', hideTip);
    });
  }

  /** Horizontal bars with direct value labels: items [{label, value, html?, onClick?}] */
  function barList(el, items) {
    const max = Math.max(1, ...items.map((i) => i.value));
    el.innerHTML = items.length ? items.map((it, i) => `
      <button type="button" class="au-hbar" data-i="${i}" style="--w:${(it.value / max) * 100}%">
        <span class="au-hbar-label">${it.html || esc(it.label)}</span>
        <span class="au-hbar-track"><i></i></span>
        <span class="au-hbar-val mono">${it.value.toLocaleString()}</span>
      </button>`).join('') : `<div class="muted" style="padding:10px 0">${t('au.u.noData')}</div>`;
    $$('.au-hbar', el).forEach((b) => b.addEventListener('click', () => items[b.dataset.i].onClick?.()));
  }

  function renderCharts(stats, box, { onAction, onActor } = {}) {
    const days = [];
    const map = Object.fromEntries(stats.daily.map((d) => [d.day, d.count]));
    for (let i = stats.days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86400e3);
      days.push({ label: k.slice(5).replace('-', '/'), value: map[k] || 0, tip: `<b>${esc(k)}</b><br>${(map[k] || 0).toLocaleString()} ${t('au.total')}` });
    }
    columnChart($('[data-chart=daily]', box), days, { labelEvery: Math.ceil(days.length / 10) });
    columnChart($('[data-chart=hourly]', box), stats.byHour.map((v, h) => ({ label: String(h), value: v, tip: `<b>${h}:00–${h}:59</b><br>${v.toLocaleString()} ${t('au.total')}` })), { labelEvery: 3 });
    barList($('[data-chart=actions]', box), stats.byAction.map((a) => ({
      label: actionLabel(a.action), value: a.count, html: `${catSvg(CAT_OF[a.action])} ${esc(actionLabel(a.action))}`, onClick: () => onAction?.(a.action) })));
    const actorBox = $('[data-chart=actors]', box);
    if (actorBox) {
      barList(actorBox, stats.byActor.map((a) => ({ label: a.name || t('au.system'), value: a.count, onClick: () => onActor?.(a.id || 'system') })));
    }
  }

  const chartsHtml = (withActors = true) => `
    <div class="au-charts">
      <div class="card card-pad au-chart wide"><h3>${t('au.daily')}</h3><div data-chart="daily"></div></div>
      <div class="card card-pad au-chart"><h3>${t('au.hourly')}</h3><div data-chart="hourly"></div></div>
      <div class="card card-pad au-chart"><h3>${t('au.byAction')}</h3><div data-chart="actions" class="au-hbars"></div></div>
      ${withActors ? `<div class="card card-pad au-chart"><h3>${t('au.byActor')}</h3><div data-chart="actors" class="au-hbars"></div></div>` : ''}
    </div>`;

  // ---------------------------------------------------------------- log rows
  const actorAvatar = (e) => (e.actor_id ? discordAvatar(e.actor_id, e.actor_avatar) : '/assets/cube.svg');
  function rowHtml(e) {
    const cat = CAT_OF[e.action] || 'system';
    return `<button type="button" class="au-row" data-entry="${e.id}">
      <span class="au-time mono">${esc(fmtTime(e.created_at))}</span>
      <span class="au-actor"><img src="${actorAvatar(e)}" alt="">${esc(e.actor_name || t('au.system'))}</span>
      <span class="au-action"><i class="au-cat">${catSvg(cat)}</i>${esc(actionLabel(e.action))}</span>
      <span class="au-target">${e.target_type ? `<span class="au-chip">${esc(ttLabel(e.target_type))} · ${esc(e.target_name || e.target_id)}</span>` : ''}</span>
      <span class="au-detail">${esc(e.detail || '')}${e.changes ? ` <span class="au-diffcount">Δ${Object.keys(e.changes).length}</span>` : ''}</span>
      <span class="au-src"><span class="au-src-badge ${esc(e.source || 'legacy')}">${esc(srcLabel(e.source))}</span>${e.ip ? `<span class="mono muted">${esc(e.ip)}</span>` : ''}</span>
    </button>`;
  }

  /** Paged log list bound to a filter-producing function. */
  function logList(box, getParams) {
    let before = null;
    let lastDay = null;
    let busy = false;
    let done = false;
    const list = $('.au-list', box);
    const more = $('.au-more', box);
    async function load(reset) {
      if (busy || (done && !reset)) return;
      busy = true;
      if (reset) { before = null; lastDay = null; done = false; list.innerHTML = '<div class="skeleton" style="height:220px;border-radius:14px"></div>'; }
      try {
        const p = getParams();
        if (before) p.set('before', before);
        p.set('limit', '60');
        const d = await api(`?${p}`);
        if (reset) list.innerHTML = '';
        let html = '';
        for (const e of d.entries) {
          const k = dayKey(e.created_at);
          if (k !== lastDay) { html += `<div class="au-day">${esc(fmtDay(e.created_at))}</div>`; lastDay = k; }
          html += rowHtml(e);
        }
        list.insertAdjacentHTML('beforeend', html);
        if (reset && !d.entries.length) list.innerHTML = `<div class="card-pad muted" style="text-align:center">${t('au.empty')}</div>`;
        before = d.nextBefore;
        done = !d.hasMore;
        more.textContent = done ? (d.entries.length || !reset ? t('au.end') : '') : t('au.loadMore');
        more.disabled = done;
      } catch (err) { toast(err.message, 'err'); }
      busy = false;
    }
    more.addEventListener('click', () => load());
    new IntersectionObserver((es) => { if (es[0].isIntersecting) load(); }, { rootMargin: '400px' }).observe(more);
    list.addEventListener('click', (e) => { const r = e.target.closest('[data-entry]'); if (r) openEntry(Number(r.dataset.entry)); });
    return { reload: () => load(true) };
  }

  // ---------------------------------------------------------------- detail drawer
  const drawer = document.createElement('aside');
  drawer.className = 'au-drawer';
  drawer.innerHTML = '<div class="au-drawer-bg" data-close></div><div class="au-drawer-panel" role="dialog" aria-modal="true"></div>';
  document.body.append(drawer);
  const closeDrawer = () => drawer.classList.remove('open');
  drawer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDrawer(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  const val = (v) => {
    if (v === null || v === undefined || v === '') return `<span class="muted">${t('au.d.empty')}</span>`;
    if (typeof v === 'object') return `<code class="au-code">${esc(JSON.stringify(v))}</code>`;
    if (typeof v === 'number' && v > 1e12 && v < 5e12) return `${esc(String(v))} <span class="muted">(${esc(fmtFull(v))})</span>`;
    return esc(String(v));
  };
  const kvTable = (obj) => `<div class="au-kv">${Object.entries(obj).map(([k, v]) => `<div class="k mono">${esc(k)}</div><div class="v">${val(v)}</div>`).join('')}</div>`;
  const json = (v) => `<pre class="au-json">${esc(JSON.stringify(v, null, 2))}</pre>`;

  async function openEntry(id) {
    const panel = $('.au-drawer-panel', drawer);
    panel.innerHTML = '<div class="skeleton" style="height:100%;border-radius:0"></div>';
    drawer.classList.add('open');
    let d;
    try { d = await api(`/${id}`); } catch (err) { toast(err.message, 'err'); return closeDrawer(); }
    const e = d.entry;
    const meta = { ...(e.meta || {}) };
    const request = meta.request; delete meta.request;
    const discord = meta.discord; delete meta.discord;
    delete meta.host;
    const cat = CAT_OF[e.action] || 'system';
    const legacy = !e.source;
    panel.innerHTML = `
      <div class="au-d-head">
        <div><div class="kicker">#${e.id} · ${esc(t(`au.cat.${cat}`))}</div><h2>${catSvg(cat, 18)} ${esc(actionLabel(e.action))}</h2>
          <div class="muted" style="font-size:13px">${esc(fmtFull(e.created_at))}（${esc(fmtRelative(e.created_at))}）</div></div>
        <button class="btn btn-sm btn-ghost" data-close aria-label="close">✕</button>
      </div>
      <div class="au-d-body">
        ${e.detail ? `<p class="au-d-detail">${esc(e.detail)}</p>` : ''}
        ${legacy ? `<div class="callout" style="margin-bottom:16px">${t('au.d.legacy')}</div>` : ''}
        <section><h4>${t('au.d.who')}</h4>
          <div class="au-d-card"><img src="${actorAvatar(e)}" alt=""><div><b>${esc(e.actor_name || t('au.system'))}</b><div class="mono muted" style="font-size:12px">${esc(e.actor_id || 'system')}</div></div>
          <a class="btn btn-sm" href="#user/${esc(e.actor_id || 'system')}" data-close>${t('au.d.profile')}</a></div></section>
        ${e.target_type ? `<section><h4>${t('au.d.target')}</h4>
          <div class="au-d-card">${e.target_type === 'player' ? `<img src="${avatarUrl(e.target_name || 'MHF_Steve', 64)}" alt="" class="px">` : ''}
            <div><b>${esc(e.target_name || '—')}</b><div class="muted" style="font-size:12px">${esc(ttLabel(e.target_type))} · <span class="mono">${esc(e.target_id)}</span></div></div>
            <button class="btn btn-sm" data-filter-target="${esc(e.target_type)}|${esc(e.target_id)}|${esc(e.target_name || '')}">${t('au.d.allTarget')}</button></div></section>` : ''}
        ${e.changes ? `<section><h4>${t('au.d.changes')}</h4><div class="au-diff">
          <div class="h">${t('au.d.field')}</div><div class="h">${t('au.d.before')}</div><div class="h">${t('au.d.after')}</div>
          ${Object.entries(e.changes).map(([f, [a, b]]) => `<div class="f">${fieldLabel(f)}</div><div class="old">${val(a)}</div><div class="new">${val(b)}</div>`).join('')}
        </div></section>` : ''}
        ${!legacy ? `<section><h4>${t('au.d.origin')}</h4><div class="au-kv">
          <div class="k">${t('au.col.source')}</div><div class="v"><span class="au-src-badge ${esc(e.source)}">${esc(srcLabel(e.source))}</span></div>
          ${e.ip ? `<div class="k">IP</div><div class="v"><span class="mono">${esc(e.ip)}</span> <button class="btn btn-sm btn-ghost" data-filter-ip="${esc(e.ip)}">${t('au.d.filterIp')}</button></div>` : ''}
          ${e.user_agent ? `<div class="k">${t('au.d.device')}</div><div class="v"><b>${esc(parseUA(e.user_agent))}</b><div class="mono muted au-ua">${esc(e.user_agent)}</div></div>` : ''}
        </div></section>` : ''}
        ${request ? `<section><h4>${t('au.d.request')}</h4><div class="au-req"><span class="au-method">${esc(request.method)}</span><span class="mono">${esc(request.path)}</span></div>
          ${request.query ? kvTable(request.query) : ''}${request.body !== undefined ? json(request.body) : ''}${request.form ? kvTable(request.form) : ''}${request.files?.length ? kvTable(Object.fromEntries(request.files.map((f, i) => [`file ${i + 1}`, `${f.name} (${f.type})`]))) : ''}</section>` : ''}
        ${discord ? `<section><h4>${t('au.d.discord')}</h4>${kvTable(Object.fromEntries(Object.entries(discord).filter(([, v]) => v !== null && v !== undefined)))}</section>` : ''}
        ${Object.keys(meta).length ? `<section><h4>${t('au.d.extra')}</h4>${json(meta)}</section>` : ''}
        ${d.related.length ? `<section><h4>${t('au.d.related')}</h4><div class="au-related">${d.related.map((r) => `
          <button type="button" data-entry="${r.id}"><span class="mono muted">${esc(fmtFull(r.created_at))}</span><b>${esc(actionLabel(r.action))}</b><span class="muted">${esc(r.actor_name || t('au.system'))}</span></button>`).join('')}</div></section>` : ''}
        <section><details class="au-raw"><summary>${t('au.d.raw')}</summary><button class="btn btn-sm" data-copy>${t('au.d.copy')}</button>${json(e)}</details></section>
      </div>`;
    panel.scrollTop = 0;
    $('[data-copy]', panel).addEventListener('click', async (ev) => {
      ev.preventDefault();
      try { await navigator.clipboard.writeText(JSON.stringify(e, null, 2)); toast(t('au.d.copied')); } catch { /* ignore */ }
    });
    $$('[data-entry]', panel).forEach((b) => b.addEventListener('click', () => openEntry(Number(b.dataset.entry))));
    $('[data-filter-target]', panel)?.addEventListener('click', (ev) => {
      const [type, tid, name] = ev.currentTarget.dataset.filterTarget.split('|');
      closeDrawer();
      navigate({ target_type: type, target_id: tid, target_name: name });
    });
    $('[data-filter-ip]', panel)?.addEventListener('click', (ev) => { closeDrawer(); navigate({ ip: ev.currentTarget.dataset.filterIp }); });
  }

  // ---------------------------------------------------------------- routing (#?filters / #user/<id>)
  const FILTER_KEYS = ['q', 'actor', 'cat', 'source', 'from', 'to', 'target_type', 'target_id', 'target_name', 'ip', 'days'];
  function readHash() {
    const h = location.hash.slice(1);
    if (h.startsWith('user/')) return { view: 'user', id: decodeURIComponent(h.slice(5).split('?')[0]) };
    return { view: 'log', params: new URLSearchParams(h.replace(/^\?/, '')) };
  }
  function navigate(filters) {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    location.hash = `?${p}`;
  }
  const toApiParams = (f) => {
    const p = new URLSearchParams();
    ['q', 'actor', 'source', 'target_type', 'target_id', 'ip'].forEach((k) => { if (f.get(k)) p.set(k, f.get(k)); });
    if (f.get('cat') && CATEGORIES[f.get('cat')]) p.set('action', CATEGORIES[f.get('cat')].join(','));
    else if (f.get('action')) p.set('action', f.get('action'));
    const dayStart = (v) => new Date(`${v}T00:00:00+08:00`).getTime();
    if (f.get('from')) p.set('from', dayStart(f.get('from')));
    if (f.get('to')) p.set('to', dayStart(f.get('to')) + 86400e3);
    return p;
  };

  let facets = null;
  async function getFacets() {
    facets = facets || await api('/facets');
    return facets;
  }

  // ---------------------------------------------------------------- main log view
  async function showLog(f) {
    const days = [7, 30, 90, 365].includes(Number(f.get('days'))) ? Number(f.get('days')) : 30;
    const fc = await getFacets();
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur || '') === String(v) ? 'selected' : ''}>${label}</option>`;
    root.innerHTML = `
      <div class="au-head reveal">
        <div><div class="kicker">${t('au.kicker')}</div><h1>${t('nav.audit')}</h1><p class="muted">${t('au.subtitle')}</p></div>
        <div class="seg au-range">${[7, 30, 90, 365].map((d) => `<button data-days="${d}" class="${d === days ? 'active' : ''}">${t(`au.range.${d}`)}</button>`).join('')}</div>
      </div>
      <div class="stats au-stats reveal">${['total', 'actors', 'topAction', 'today'].map((k) => `<div class="stat"><div class="num" data-s="${k}">—</div><div class="lbl">${t(`au.${k}`)}</div></div>`).join('')}</div>
      <div class="reveal">${chartsHtml()}</div>
      <form class="au-filters card card-pad reveal" id="auFilters">
        <input class="input" name="q" value="${esc(f.get('q') || '')}" placeholder="${t('au.search')}">
        <select class="input" name="actor">${opt('', t('au.allActors'), f.get('actor'))}${fc.actors.map((a) => opt(a.id || 'system', `${esc(a.name || t('au.system'))} (${a.count})`, f.get('actor'))).join('')}</select>
        <select class="input" name="cat">${opt('', t('au.allCats'), f.get('cat'))}${Object.keys(CATEGORIES).map((c) => opt(c, t(`au.cat.${c}`), f.get('cat'))).join('')}</select>
        <select class="input" name="source">${opt('', t('au.allSources'), f.get('source'))}${['web', 'discord', 'api', 'server', 'system', 'legacy'].map((s) => opt(s, srcLabel(s), f.get('source'))).join('')}</select>
        <label class="au-date"><span>${t('au.from')}</span><input class="input mono" type="date" name="from" value="${esc(f.get('from') || '')}"></label>
        <label class="au-date"><span>${t('au.to')}</span><input class="input mono" type="date" name="to" value="${esc(f.get('to') || '')}"></label>
        <button type="button" class="btn" id="auClear">${t('au.clear')}</button>
        ${f.get('target_id') || f.get('ip') ? `<div class="au-active">
          ${f.get('target_id') ? `<span class="au-chip on">${t('au.filterTarget')}：${esc(ttLabel(f.get('target_type')))} · ${esc(f.get('target_name') || f.get('target_id'))}<button type="button" data-drop="target">✕</button></span>` : ''}
          ${f.get('ip') ? `<span class="au-chip on">IP：<span class="mono">${esc(f.get('ip'))}</span><button type="button" data-drop="ip">✕</button></span>` : ''}</div>` : ''}
      </form>
      <div class="au-log"><div class="au-list"></div><button class="btn au-more" type="button">${t('au.loadMore')}</button></div>`;

    const current = Object.fromEntries(FILTER_KEYS.map((k) => [k, f.get(k) || '']));
    const form = $('#auFilters');
    const apply = (patch) => navigate({ ...current, ...patch });
    let qTimer;
    form.addEventListener('input', (e) => {
      if (e.target.name === 'q') { clearTimeout(qTimer); qTimer = setTimeout(() => apply({ q: e.target.value.trim() }), 450); }
    });
    form.addEventListener('change', (e) => { if (e.target.name && e.target.name !== 'q') apply({ [e.target.name]: e.target.value }); });
    form.addEventListener('submit', (e) => { e.preventDefault(); apply({ q: form.q.value.trim() }); });
    $('#auClear').addEventListener('click', () => navigate({ days: current.days }));
    $$('[data-drop]', form).forEach((b) => b.addEventListener('click', () => apply(b.dataset.drop === 'ip' ? { ip: '' } : { target_type: '', target_id: '', target_name: '' })));
    $$('[data-days]').forEach((b) => b.addEventListener('click', () => apply({ days: b.dataset.days })));

    const apiParams = toApiParams(f);
    logList($('.au-log'), () => new URLSearchParams(apiParams)).reload();
    initReveal();

    const statParams = new URLSearchParams(apiParams);
    statParams.set('days', days);
    const todayParams = new URLSearchParams(apiParams);
    todayParams.set('days', 1);
    const [stats, today] = await Promise.all([api(`/stats?${statParams}`), api(`/stats?${todayParams}`)]);
    const top = stats.byAction[0];
    countUp($('[data-s=total]'), stats.total);
    countUp($('[data-s=actors]'), stats.activeActors);
    countUp($('[data-s=today]'), today.daily.find((d) => d.day === dayKey(Date.now()))?.count || 0);
    $('[data-s=topAction]').innerHTML = top ? `<span class="au-topaction">${esc(actionLabel(top.action))}</span>` : '—';
    renderCharts(stats, root, {
      onAction: (a) => apply({ cat: CAT_OF[a] || '' }),
      onActor: (id) => { location.hash = `user/${encodeURIComponent(id)}`; },
    });
  }

  // ---------------------------------------------------------------- member profile view
  async function showUser(id) {
    root.innerHTML = '<div class="skeleton" style="height:420px;border-radius:20px;margin-top:40px"></div>';
    let u;
    try { u = await api(`/actor/${encodeURIComponent(id)}`); } catch (err) {
      root.innerHTML = `<div class="empty"><div><h3>${t('au.empty')}</h3><p><a class="btn" href="#">${t('au.u.back')}</a></p></div></div>`;
      return;
    }
    const isSystem = id === 'system';
    root.innerHTML = `
      <a class="au-back" href="#">← ${t('au.u.back')}</a>
      <div class="au-profile card card-pad reveal">
        <img src="${isSystem ? '/assets/cube.svg' : discordAvatar(id, u.avatar)}" alt="">
        <div class="au-profile-main"><h1>${esc(u.name || t('au.system'))}</h1>
          <div class="mono muted" style="font-size:12.5px">${esc(id)}</div>
          <div class="chips-row" style="margin-top:8px">${u.access ? levelChips({ ...u.access, badges: [] }) : ''}${!isSystem && !u.inGuild ? ` <span class="pill off">${t('au.u.notInGuild')}</span>` : ''}</div></div>
      </div>
      <div class="stats au-stats reveal">
        <div class="stat"><div class="num" data-n="${u.total}">0</div><div class="lbl">${t('au.u.total')}</div></div>
        <div class="stat"><div class="num sm">${esc(fmtRelative(u.first))}</div><div class="lbl">${t('au.u.first')}</div><div class="muted au-sub">${esc(fmtFull(u.first))}</div></div>
        <div class="stat"><div class="num sm">${esc(fmtRelative(u.last))}</div><div class="lbl">${t('au.u.last')}</div><div class="muted au-sub">${esc(fmtFull(u.last))}</div></div>
        <div class="stat"><div class="num" data-n="${u.actedOn}">0</div><div class="lbl">${t('au.u.actedOn')}</div></div>
      </div>
      <div class="reveal">${chartsHtml(false)}</div>
      <div class="au-grid2 reveal">
        <div class="card card-pad"><h3>${t('au.u.ips')}</h3>${u.ips.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>IP</th><th>${t('au.d.device')}</th><th>${t('au.u.last')}</th><th></th></tr></thead>
          <tbody>${u.ips.map((r) => `<tr><td class="mono">${esc(r.ip)}<div class="muted" style="font-size:11px">${t('au.u.times', { n: r.count })}</div></td>
            <td style="font-size:13px">${esc(parseUA(r.ua) || '—')}</td><td class="muted" style="font-size:12px">${esc(fmtFull(r.last))}</td>
            <td><a class="btn btn-sm btn-ghost" href="#?ip=${encodeURIComponent(r.ip)}">${t('au.d.filterIp')}</a></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${t('au.u.noData')}</p>`}</div>
        <div class="card card-pad"><h3>${t('au.u.devices')}</h3>${u.agents.length ? u.agents.map((a) => `
          <div class="au-device"><b>${esc(parseUA(a.ua))}</b><span class="muted" style="font-size:12px">${t('au.u.times', { n: a.count })} · ${esc(fmtRelative(a.last))}</span><div class="mono muted au-ua">${esc(a.ua)}</div></div>`).join('') : `<p class="muted">${t('au.u.noData')}</p>`}
          <h3 style="margin-top:20px">${t('au.u.targets')}</h3><div class="au-hbars" data-chart="targets"></div></div>
      </div>
      <div class="panel-head reveal" style="margin:26px 0 12px"><h2 style="font-size:20px">${t('au.u.history')}</h2></div>
      <div class="au-log"><div class="au-list"></div><button class="btn au-more" type="button">${t('au.loadMore')}</button></div>`;
    $$('[data-n]', root).forEach((el) => countUp(el, Number(el.dataset.n)));
    barList($('[data-chart=targets]', root), u.targets.map((x) => ({
      label: x.name || x.id, value: x.count, html: `<span class="muted">${esc(ttLabel(x.type))}</span> ${esc(x.name || x.id)}`,
      onClick: () => navigate({ target_type: x.type, target_id: x.id, target_name: x.name || '' }) })));
    logList($('.au-log', root), () => new URLSearchParams({ actor: id })).reload();
    initReveal();
    const stats = await api(`/stats?${new URLSearchParams({ actor: id, days: 90 })}`);
    renderCharts(stats, root, { onAction: (a) => navigate({ actor: id, cat: CAT_OF[a] || '' }) });
  }

  // ---------------------------------------------------------------- boot
  function route() {
    hideTip();
    closeDrawer();
    const r = readHash();
    scrollTo({ top: 0 });
    (r.view === 'user' ? showUser(r.id) : showLog(r.params)).catch((err) => {
      root.innerHTML = `<div class="empty"><div><h3>${t('empty.errT')}</h3><p>${esc(err.message)}</p></div></div>`;
    });
  }
  addEventListener('hashchange', route);
  document.title = `${t('nav.audit')} · Mc.Tierlist.Asia`;
  route();
});
