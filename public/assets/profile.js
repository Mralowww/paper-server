/* Mc.Tierlist.Asia — player page: overview / server stats / match history */
document.addEventListener('DOMContentLoaded', async () => {
  const { $, $$, esc, t, icon, avatarUrl, loginUrl, toast, countUp, initReveal, emptyHtml, testsTable, resultCell, scoreCell,
    tierBadge, badgesHtml, TITLE_STYLE, fallbackImg, discordLink, regionName, request } = window.MCTL;
  const { fmtDate, fmtRelative, lang } = window.I18N;
  const root = $('#profile');
  const ident = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
  const TZ = 'Asia/Taipei';

  let general;
  try {
    general = await request(`/api/profile/${encodeURIComponent(ident)}`);
  } catch (err) {
    root.innerHTML = err.status === 404
      ? emptyHtml(t('empty.notFoundT'), esc(t('empty.notFoundD', { name: ident })))
      : emptyHtml(t('empty.errT'), t('empty.errD'));
    return initReveal();
  }
  const g = general;
  document.title = `${g.name} · Mc.Tierlist.Asia`;
  if (g.name.toLowerCase() !== ident.toLowerCase()) history.replaceState(null, '', `/player/${encodeURIComponent(g.name)}${location.hash}`);

  // ---------------------------------------------------------------- helpers
  const svg = (d, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    names: '<path d="M4 7h16M4 12h10M4 17h7"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
  };
  const CAUSES = ['crystal', 'anchor', 'melee', 'projectile', 'explosion', 'other'];
  const causeIcon = (c) => `<img class="mc-ico" src="/assets/icons/${CAUSES.includes(c) ? c : 'other'}.svg" alt="">`;
  const WORLD_ART = ['lobby', 'plains', 'desert', 'badlands', 'mushroom', 'snow', 'nether', 'end'];
  let worldMap = g.worlds || {};
  const worldInfo = (w) => {
    const info = worldMap[w] || {};
    const id = info.id && WORLD_ART.includes(info.id) ? info.id
      : WORLD_ART.find((k) => String(w).toLowerCase().includes(k)) || (/nether/i.test(w) ? 'nether' : /the_end|_end$/i.test(w) ? 'end' : 'default');
    return { id, name: info.display || (window.I18N.has(`world.${id}`) ? t(`world.${id}`) : w) };
  };
  const worldThumb = (w, cls = '') => `<img class="world-thumb ${cls}" src="/assets/worlds/${worldInfo(w).id}.svg" alt="" loading="lazy">`;
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
  const ratio = (a, b) => (b ? (a / b).toFixed(2) : a ? `${a}.00` : '0.00');
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString(lang, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const fmtDay = (ms) => new Date(ms).toLocaleDateString(lang, { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const dayKey = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
  const fmtDuration = (ms) => {
    const h = Math.floor(ms / 3600e3);
    const m = Math.floor((ms % 3600e3) / 60e3);
    return h ? t('pf.hm', { h, m }) : t('pf.m', { m });
  };
  const lockedHtml = () => `
    <div class="pf-locked card card-pad">
      <div class="pf-lock-ico">${svg(IC.lock, 26)}</div>
      <h3>${t('pf.lockedT')}</h3><p class="muted">${t('pf.lockedD')}</p>
      <a class="btn btn-discord" href="${loginUrl()}">${icon.discord}${t('nav.loginDiscord')}</a>
    </div>`;
  const copyBtn = (text) => `<button class="pf-copy" data-copy="${esc(text)}" title="${t('common.copy')}">${svg(IC.copy, 13)}</button>`;

  // ---------------------------------------------------------------- shell
  const TABS = [['general', 'pf.tab.general', IC.user], ['stats', 'pf.tab.stats', IC.chart], ['matches', 'pf.tab.matches', IC.history]];
  const p = g.player;
  root.innerHTML = `
    <div class="pf reveal">
      <div class="pf-head">
        <h1 class="pf-name">${esc(g.name)}${p ? badgesHtml(p.badges) : ''}</h1>
        <nav class="pf-tabs">${TABS.map(([id, key, ic]) => `<button data-tab="${id}">${svg(ic, 15)}<span>${t(key)}</span></button>`).join('')}</nav>
      </div>
      <div class="pf-grid">
        <aside class="pf-side">
          <div class="pf-skin${p?.banned ? ' banned' : ''}"><img src="/heads/body/${esc(g.uuid)}/480.png" alt="${esc(g.name)}" onerror="this.onerror=null;this.src='/heads/body/MHF_Steve/480.png'"></div>
          ${p ? `<div class="title-pill ${TITLE_STYLE[p.title] || 'rookie'}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 22 10 12 22 2 10Z"/></svg>${esc(t(`title.${TITLE_STYLE[p.title] || 'rookie'}`))}</div>` : ''}
          ${p?.banned ? `<div class="pcard-ban">⛔ ${t('ban.cardNote')}</div>` : ''}
          <div class="pf-side-links">
            <a class="btn btn-sm" href="https://namemc.com/profile/${esc(g.uuid)}" target="_blank" rel="noopener">NameMC ↗</a>
            ${g.isMe ? `<a class="btn btn-sm" href="/settings">${svg(IC.gear, 14)}${t('nav.settings')}</a>` : ''}
          </div>
        </aside>
        <section class="pf-main" id="pfMain"></section>
      </div>
    </div>`;

  root.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (!c) return;
    try { await navigator.clipboard.writeText(c.dataset.copy); toast(t('common.copied')); } catch { toast(t('common.copyFailed'), 'err'); }
  });

  // ---------------------------------------------------------------- overview
  function general_() {
    const pres = g.presence;
    let activity;
    if (!g.loggedIn) activity = `<p class="muted pf-note">${t('pf.loginForActivity')}</p>`;
    else if (!pres) activity = `<div class="pf-status off"><i></i><div><b>${t('pf.neverPlayed')}</b><span>${t('pf.neverPlayedD')}</span></div></div>`;
    else if (pres.online) activity = `<div class="pf-status on"><i></i><div><small>${t('pf.playingNow')}</small><b>${esc(worldInfo(pres.world).name)}</b></div>${worldThumb(pres.world, 'sm')}</div>`;
    else activity = `<div class="pf-status off"><i></i><div><small>${t('pf.offline')}</small><b>${esc(t('pf.lastSeen', { time: fmtRelative(pres.last_seen) }))}</b><span>${esc(fmtDate(pres.last_seen))}</span></div></div>`;

    const self = g.self;
    const selfHtml = self ? `
      <div class="pf-card"><h3>${svg(IC.sword)}${t('pf.myTest')}</h3>
        <div class="pf-mini-grid">
          <div class="pf-mini">${self.cooldownUntil ? `<b>${esc(fmtRelative(self.cooldownUntil))}</b><span>${t('me.cooldown')} · ${esc(fmtDate(self.cooldownUntil))}</span>` : `<b class="ok">✓</b><span>${t('me.ready')}</span>`}</div>
          <div class="pf-mini">${self.openTicket ? `<b>${esc(self.openTicket.mc_name)}</b><span>${t('me.openTicket')}</span>${self.guildId ? `<a class="btn btn-sm" href="${discordLink(self.guildId, self.openTicket.channel_id)}" target="_blank" rel="noopener">${t('me.openInDiscord')} ↗</a>` : ''}` : `<b class="muted">—</b><span>${t('me.openTicket')}</span>`}</div>
        </div></div>` : '';

    const v = p?.tiers.vanilla;
    return `
      <div class="pf-cols">
        <div class="pf-card"><h3>${svg(IC.names)}${t('pf.names')}</h3>
          <ol class="pf-names">${g.names.map((n, i) => `<li><span class="n">${i + 1}</span><b>${esc(n.name)}</b>
            ${n.first_seen ? `<span class="muted">${esc(new Date(n.first_seen).toLocaleDateString(lang))}</span><span class="muted rel">${esc(fmtRelative(n.first_seen))}</span>` : '<span></span><span></span>'}
            ${copyBtn(n.name)}</li>`).join('')}</ol>
          <div class="pf-uuid"><span class="muted">${t('pf.uuid')}</span><code>${esc(g.uuid)}</code>${copyBtn(g.uuid)}</div>
          <p class="muted pf-note">${t('pf.namesNote')}</p>
        </div>
        <div class="pf-card"><h3>${svg(IC.activity)}${t('pf.activity')}</h3>${activity}</div>
      </div>
      <div class="pf-card"><h3>${svg(IC.trophy)}${t('pf.rankings')}</h3>
        ${p ? `<div class="pf-rank">
          <div class="tier-tile t${v.tier.slice(2)}${v.retired ? ' retired' : ''}"><div class="tile-ico"><img src="/assets/vanilla.svg" alt="Vanilla"></div><span>${v.retired ? 'R' : ''}${v.tier}</span></div>
          <div class="pf-rank-info"><div><small>${t('card.position')}</small><b>#${p.rank}</b></div><div><small>${t('pf.points')}</small><b>${p.points}</b></div>
            <div><small>${t('rank.region')}</small><b>${esc(regionName(p.region))}</b></div>
            ${p.stats ? `<div><small>${t('pf.testRecord')}</small><b><span class="win">${p.stats.wins}</span> – <span class="loss">${p.stats.losses}</span></b></div>` : ''}</div>
        </div>` : `<p class="muted">${t('pf.unranked')}</p>`}
      </div>
      ${selfHtml}
      <div class="pf-card"><h3>${svg(IC.history)}${t('pf.recentTests')}</h3>
        ${!g.loggedIn ? `<p class="muted pf-note">${t('pf.loginForTests')}</p>`
          : g.tests?.length ? testsTable(g.tests, [
            ['col.date', (x) => `<span class="muted">${esc(fmtDate(x.created_at))}</span>`],
            ['col.result', resultCell], ['col.score', scoreCell], ['col.tester', (x) => esc(x.tester_name || '—')],
          ]) : `<p class="muted">${t('me.noTests')}</p>`}
      </div>`;
  }

  // ---------------------------------------------------------------- stats
  async function stats_(box) {
    if (!g.loggedIn) { box.innerHTML = lockedHtml(); return; }
    box.innerHTML = '<div class="skeleton" style="height:420px;border-radius:18px"></div>';
    const d = await request(`/api/profile/${encodeURIComponent(g.uuid)}/stats`);
    worldMap = { ...worldMap, ...d.worlds };
    const s = d.stats;
    const v = p?.tiers.vanilla;
    const tierInfo = p ? `
      <div class="pf-card"><div class="pf-card-head"><div><div class="kicker">${t('pf.testKicker')}</div><h3 class="big">${t('pf.tierInfo')}</h3></div><span class="muted">Vanilla</span></div>
        <div class="pf-tiles five">
          <div><small>${t('pf.kit')}</small><b>Vanilla</b></div>
          <div><small>Tier</small><b class="gold">${v.retired ? 'R' : ''}${v.tier}</b></div>
          <div><small>${t('card.position')}</small><b>#${p.rank}</b></div>
          <div><small>${t('pf.testRecord')}</small><b>${p.stats ? `${p.stats.wins} W · ${p.stats.losses} L` : '—'}</b></div>
          <div><small>${t('card.winrate')}</small><b>${p.stats ? pct(p.stats.wins, p.stats.wins + p.stats.losses) : '—'}</b></div>
        </div>
        <p class="muted pf-note">${t('pf.tierNote')}</p>
      </div>` : '';
    if (!s) {
      box.innerHTML = `<div class="pf-card pf-empty">${worldThumb('plains', 'lg')}<h3>${t('pf.noServerT')}</h3><p class="muted">${t('pf.noServerD')}</p></div>${tierInfo}`;
      return;
    }
    const kd = s.pvpDeaths ? s.kills / s.pvpDeaths : s.kills;
    const played = s.wins + s.losses + s.draws;
    const types = [['crystal', s.killTypes.crystal], ['anchor', s.killTypes.anchor], ['melee', s.killTypes.melee], ['other', s.killTypes.other]];
    const maxType = Math.max(1, ...types.map((x) => x[1]));
    const cp = s.coreplus;
    box.innerHTML = `
      <div class="pf-card">
        <h3 class="center">${t('pf.statsTitle', { name: esc(g.name) })}</h3>
        <div class="pf-tiles five">
          <div><small>${t('pf.kills')}</small><b data-n="${s.kills}">0</b></div>
          <div><small>${t('pf.deaths')}</small><b data-n="${s.deaths}">0</b></div>
          <div><small>KDR</small><b class="${kd >= 1 ? 'win' : 'loss'}">${kd.toFixed(2)}</b></div>
          <div><small>${t('pf.curStreak')}</small><b data-n="${s.curStreak}">0</b></div>
          <div><small>${t('pf.matches')}</small><b data-n="${s.matches}">0</b></div>
        </div>
        <div class="pf-rows">
          <div><span>${t('pf.winRate')}</span><b class="win">${pct(s.wins, played)}</b></div>
          <div><span>${t('pf.wl')}</span><b>${ratio(s.wins, s.losses)}</b></div>
          <div><span>${t('pf.lossRate')}</span><b class="loss">${pct(s.losses, played)}</b></div>
          <div><span>${t('pf.bestStreak')}</span><b>${s.bestStreak}</b></div>
          <div><span>${t('pf.matchWins')}</span><b>${s.wins}</b></div>
          <div><span>${t('pf.matchLosses')}</span><b>${s.losses}${s.draws ? ` <span class="muted">· ${t('pf.draws', { n: s.draws })}</span>` : ''}</b></div>
          <div><span>${t('pf.totems')}</span><b>${s.totemPops}</b></div>
          <div><span>${t('pf.playtime')}</span><b>${esc(fmtDuration(s.playtimeMs))}</b></div>
        </div>
      </div>
      <div class="pf-cols">
        <div class="pf-card"><h3>${t('pf.killTypes')}</h3>
          <div class="pf-bars">${types.map(([k, n]) => `<div class="pf-bar"><span>${causeIcon(k)} ${t(`pf.cause.${k}`)}</span><i style="--w:${(n / maxType) * 100}%"></i><b>${n}</b></div>`).join('')}</div>
        </div>
        <div class="pf-card"><h3>${t('pf.rivals')}</h3>
          ${s.rivals.length ? `<div class="pf-rivals">${s.rivals.map(rivalHtml).join('')}</div>${moreBtn('rivals', s.rivalCount)}` : `<p class="muted">${t('pf.none')}</p>`}
        </div>
      </div>
      <div class="pf-card"><h3>${t('pf.recent')}</h3>
        ${s.recent.length ? `<div class="pf-log">${s.recent.map(logRow).join('')}</div>${moreBtn('log')}` : `<p class="muted">${t('pf.none')}</p>`}
      </div>
      <div class="pf-card"><h3>${svg(IC.globe)}${t('pf.byWorld')}</h3>
        ${s.worlds.length ? `<div class="pf-worlds">${s.worlds.map(worldRow).join('')}</div>${moreBtn('worlds', s.worldCount)}` : `<p class="muted">${t('pf.none')}</p>`}
      </div>
      ${cp ? `<div class="pf-card"><div class="pf-card-head"><h3>${t('pf.coreplus')}</h3><span class="muted" style="font-size:12px">${t('pf.syncedAt', { time: esc(fmtRelative(cp.syncedAt)) })}</span></div>
        <div class="pf-tiles five">
          <div><small>${t('pf.achievements')}</small><b>${cp.achievements}</b></div>
          <div><small>${t('pf.loginStreak')}</small><b>${cp.loginStreak}</b></div>
          <div><small>${t('pf.crystalPlace')}</small><b>${(cp.stats.crystal_place || 0).toLocaleString()}</b></div>
          <div><small>${t('pf.anchorCharge')}</small><b>${(cp.stats.anchor_charge || 0).toLocaleString()}</b></div>
          <div><small>${t('pf.totems')}</small><b>${(cp.stats.totem_pop || 0).toLocaleString()}</b></div>
        </div></div>` : ''}
      ${tierInfo}
      <p class="muted pf-note" style="text-align:center">${t('pf.statsNote', { since: esc(fmtDate(s.firstSeen)) })}</p>`;
    $$('[data-n]', box).forEach((el) => countUp(el, Number(el.dataset.n)));
    $$('[data-full]', box).forEach((b) => b.addEventListener('click', () => openFull(b.dataset.full)));
  }

  const moreBtn = (tab, n) => `<button class="pf-more-link" data-full="${tab}">${t('pf.viewAll')}${n ? ` <span class="muted">(${n})</span>` : ''} →</button>`;
  const rivalHtml = (r) => `<a href="/player/${encodeURIComponent(r.name)}"><img src="${avatarUrl(r.opp, 32)}" alt="" onerror="${fallbackImg}"><span>${esc(r.name)}</span>
    ${r.last_at ? `<small class="muted">${esc(fmtRelative(r.last_at))}</small>` : ''}<b><span class="win">${r.kills}</span> – <span class="loss">${r.deaths}</span></b></a>`;
  const worldRow = (w) => `<div class="pf-world">${worldThumb(w.world)}
    <div class="pf-world-name"><b>${esc(worldInfo(w.world).name)}</b><span class="mono muted">${w.last_at ? esc(fmtRelative(w.last_at)) : esc(w.world)}</span></div>
    <div><small>${t('pf.kills')}</small><b>${w.kills}</b></div><div><small>${t('pf.deaths')}</small><b>${w.deaths}</b></div>
    <div><small>KDR</small><b>${ratio(w.kills, w.deaths)}</b></div><div><small>${t('pf.matches')}</small><b>${w.matches}</b></div>
    <div><small>${t('pf.winRate')}</small><b>${pct(w.wins, w.matches)}</b></div></div>`;
  const logRow = (k, i = 0) => `<div class="pf-logrow ${k.role}" style="--i:${i}">
    <span class="pf-log-badge">${t(k.role === 'kill' ? 'pf.kill' : 'pf.death')}</span>
    <span class="pf-log-main">${k.opponent ? `<span>${t(k.role === 'kill' ? 'pf.killed' : 'pf.killedBy')} <a href="/player/${encodeURIComponent(k.opponent.name)}">${esc(k.opponent.name)}</a></span>` : `<span class="muted">${t('pf.selfDeath')}</span>`}
      <small class="muted">${causeIcon(k.cause)} ${t(`pf.cause.${k.cause}`)}${k.killerHealth != null ? ` · ❤ ${k.killerHealth}` : ''}${k.victimPops ? ` · ${t('pf.pops', { n: k.victimPops })}` : ''}</small></span>
    <span class="pf-log-world">${worldThumb(k.world, 'xs')}<span>${esc(worldInfo(k.world).name)}</span></span>
    <span class="pf-log-time mono muted" title="${esc(fmtDate(k.at))}">${esc(fmtRelative(k.at))}</span>
  </div>`;

  // ---------------------------------------------------------------- full stats dialog
  function openFull(tab = 'log') {
    const bg = document.createElement('div');
    bg.className = 'pfx-bg';
    bg.innerHTML = `
      <div class="pfx" role="dialog" aria-modal="true" aria-label="${t('pf.fullTitle')}">
        <header class="pfx-head">
          <img src="${avatarUrl(g.uuid, 64)}" alt="" onerror="${fallbackImg}">
          <div><div class="kicker">${t('pf.fullKicker')}</div><h2>${t('pf.fullTitle')} · ${esc(g.name)}</h2></div>
          <button class="pfx-x" aria-label="${t('card.close')}">✕</button>
        </header>
        <nav class="pfx-tabs"><i class="pfx-ink"></i>
          ${[['log', 'pf.tabLog'], ['worlds', 'pf.byWorld'], ['rivals', 'pf.rivalsAll']].map(([id, key]) => `<button data-t="${id}">${t(key)}</button>`).join('')}
        </nav>
        <div class="pfx-body"></div>
      </div>`;
    document.body.append(bg);
    document.body.classList.add('pfx-open');
    const body = $('.pfx-body', bg);
    const close = () => {
      bg.classList.add('closing');
      document.body.classList.remove('pfx-open');
      removeEventListener('keydown', onKey);
      setTimeout(() => bg.remove(), 320);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    $('.pfx-x', bg).addEventListener('click', close);

    const ink = $('.pfx-ink', bg);
    async function select(id) {
      $$('.pfx-tabs button', bg).forEach((b) => {
        b.classList.toggle('active', b.dataset.t === id);
        if (b.dataset.t === id) { ink.style.width = `${b.offsetWidth}px`; ink.style.transform = `translateX(${b.offsetLeft}px)`; }
      });
      body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
      body.scrollTop = 0;
      try {
        if (id === 'log') await fullLog(body);
        else if (id === 'worlds') await fullWorlds(body);
        else await fullRivals(body);
      } catch (err) { body.innerHTML = `<p class="muted pfx-empty">${esc(err.message)}</p>`; }
    }
    $$('.pfx-tabs button', bg).forEach((b) => b.addEventListener('click', () => select(b.dataset.t)));
    requestAnimationFrame(() => select(tab));
  }

  async function fullLog(body) {
    const worldOpts = Object.keys(worldMap);
    const f = { type: 'all', cause: '', world: '', opp: '', from: '', to: '' };
    body.innerHTML = `
      <div class="pfx-filters">
        <div class="seg" data-f="type">${['all', 'kills', 'deaths'].map((x) => `<button data-v="${x}" class="${x === 'all' ? 'active' : ''}">${t(`pf.f.${x}`)}</button>`).join('')}</div>
        <div class="seg" data-f="cause">${['', 'crystal', 'anchor', 'melee', 'other'].map((x) => `<button data-v="${x}" class="${x === '' ? 'active' : ''}">${x ? `${causeIcon(x)} ${t(`pf.cause.${x}`)}` : t('pf.f.anyCause')}</button>`).join('')}</div>
        <div class="pfx-row">
          <select class="input" data-f="world"><option value="">${t('pf.f.anyWorld')}</option>${worldOpts.map((w) => `<option value="${esc(w)}">${esc(worldInfo(w).name)}</option>`).join('')}</select>
          <input class="input" data-f="opp" maxlength="16" placeholder="${t('pf.f.opp')}">
          <label class="pfx-date"><span>${t('au.from')}</span><input class="input mono" type="date" data-f="from"></label>
          <label class="pfx-date"><span>${t('au.to')}</span><input class="input mono" type="date" data-f="to"></label>
        </div>
      </div>
      <div class="pfx-summary"></div>
      <div class="pfx-list"></div>
      <div class="pfx-foot"><button class="btn btn-sm pfx-more" hidden>${t('au.loadMore')}</button></div>`;
    const list = $('.pfx-list', body);
    const more = $('.pfx-more', body);
    const summary = $('.pfx-summary', body);
    let before = null;
    let token = 0;
    async function load(reset) {
      const my = ++token;
      if (reset) { before = null; list.innerHTML = '<div class="skeleton" style="height:180px;border-radius:12px"></div>'; }
      const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
      if (before) q.set('before', before);
      const d = await request(`/api/profile/${encodeURIComponent(g.uuid)}/log?${q}`);
      if (my !== token) return;
      if (reset) {
        list.innerHTML = '';
        summary.innerHTML = `<span><b>${d.summary.total.toLocaleString()}</b> ${t('pf.f.records')}</span><span class="win"><b>${d.summary.kills}</b> ${t('pf.kills')}</span><span class="loss"><b>${d.summary.deaths}</b> ${t('pf.deaths')}</span><span><b>${ratio(d.summary.kills, d.summary.deaths)}</b> KDR</span>`;
      }
      if (reset && !d.items.length) list.innerHTML = `<p class="muted pfx-empty">${t('au.empty')}</p>`;
      list.insertAdjacentHTML('beforeend', d.items.map((k, i) => logRow(k, i)).join(''));
      before = d.items.at(-1)?.id;
      more.hidden = !d.hasMore;
    }
    let timer;
    body.addEventListener('click', (e) => {
      const b = e.target.closest('.seg[data-f] button');
      if (!b) return;
      const seg = b.parentElement;
      $$('button', seg).forEach((x) => x.classList.toggle('active', x === b));
      f[seg.dataset.f] = b.dataset.v;
      load(true);
    });
    $$('select[data-f], input[data-f]', body).forEach((el) => el.addEventListener(el.tagName === 'INPUT' && el.type !== 'date' ? 'input' : 'change', () => {
      f[el.dataset.f] = el.value.trim();
      clearTimeout(timer);
      timer = setTimeout(() => load(true), el.type === 'date' || el.tagName === 'SELECT' ? 0 : 350);
    }));
    more.addEventListener('click', () => load(false));
    await load(true);
  }

  async function fullWorlds(body) {
    body.innerHTML = '<div class="skeleton" style="height:240px;border-radius:12px"></div>';
    const d = await request(`/api/profile/${encodeURIComponent(g.uuid)}/worlds`);
    worldMap = { ...worldMap, ...d.names };
    body.innerHTML = d.worlds.length ? `<div class="pf-worlds pfx-stagger">${d.worlds.map((w, i) => worldRow(w).replace('class="pf-world"', `class="pf-world" style="--i:${i}"`)).join('')}</div>`
      : `<p class="muted pfx-empty">${t('pf.none')}</p>`;
  }

  async function fullRivals(body) {
    body.innerHTML = `<input class="input pfx-search" maxlength="16" placeholder="${t('pf.f.opp')}"><div class="pf-rivals pfx-stagger pfx-rivals"></div>`;
    const box = $('.pfx-rivals', body);
    let timer;
    const load = async (q = '') => {
      const d = await request(`/api/profile/${encodeURIComponent(g.uuid)}/rivals${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      box.innerHTML = d.rivals.length ? d.rivals.map((r, i) => rivalHtml(r).replace('<a ', `<a style="--i:${Math.min(i, 30)}" `)).join('') : `<p class="muted pfx-empty">${t('au.empty')}</p>`;
    };
    $('.pfx-search', body).addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => load(e.target.value.trim()), 300); });
    await load();
  }

  // ---------------------------------------------------------------- match history
  async function matches_(box) {
    if (!g.loggedIn) { box.innerHTML = lockedHtml(); return; }
    box.innerHTML = `<div class="pf-matches"></div><button class="btn pf-more" hidden>${t('au.loadMore')}</button>`;
    const list = $('.pf-matches', box);
    const more = $('.pf-more', box);
    let before = null;
    let lastDay = null;
    async function load() {
      more.disabled = true;
      const d = await request(`/api/profile/${encodeURIComponent(g.uuid)}/matches${before ? `?before=${before}` : ''}`);
      worldMap = { ...worldMap, ...d.worlds };
      if (!before && !d.matches.length) {
        list.innerHTML = `<div class="pf-card pf-empty">${worldThumb('desert', 'lg')}<h3>${t('pf.noMatchesT')}</h3><p class="muted">${t('pf.noMatchesD')}</p></div>`;
        return;
      }
      let html = '';
      for (const m of d.matches) {
        const k = dayKey(m.startedAt);
        if (k !== lastDay) { html += `<div class="pf-day">${esc(fmtDay(m.startedAt))}</div>`; lastDay = k; }
        const w = worldInfo(m.world);
        html += `<button class="pf-match ${m.result}" data-match="${m.id}">
          ${worldThumb(m.world)}
          <span class="pf-res">${t(`pf.res.${m.result}`)}</span>
          <span class="pf-vs"><b>${esc(m.me)} <span class="muted">vs</span> <a href="/player/${encodeURIComponent(m.opponent.name)}">${esc(m.opponent.name)}</a></b>
            <span class="muted">${esc(w.name)}</span><span class="muted mono">${esc(fmtTime(m.startedAt))}${m.endedAt - m.startedAt > 60e3 ? ` – ${esc(fmtTime(m.endedAt))}` : ''}</span></span>
          <span class="pf-opp"><img src="${avatarUrl(m.opponent.uuid, 40)}" alt="" onerror="${fallbackImg}"></span>
          <span class="pf-score"><b>${m.score[0]}</b><i>–</i><b>${m.score[1]}</b></span>
        </button><div class="pf-kills" data-kills="${m.id}" hidden></div>`;
      }
      list.insertAdjacentHTML('beforeend', html);
      before = d.matches.at(-1)?.id;
      more.hidden = !d.hasMore;
      more.disabled = false;
    }
    list.addEventListener('click', async (e) => {
      if (e.target.closest('a')) return;
      const b = e.target.closest('[data-match]');
      if (!b) return;
      const panel = $(`[data-kills="${b.dataset.match}"]`, list);
      panel.hidden = !panel.hidden;
      b.classList.toggle('open', !panel.hidden);
      if (panel.hidden || panel.dataset.loaded) return;
      panel.dataset.loaded = '1';
      panel.innerHTML = '<div class="skeleton" style="height:60px;border-radius:10px"></div>';
      const { kills } = await request(`/api/profile/match/${b.dataset.match}`);
      panel.innerHTML = kills.map((k) => `<div class="pf-kill"><span class="mono muted">${esc(fmtTime(k.created_at))}</span>
        <span>${causeIcon(k.cause)}</span><b class="${k.killer_name === g.name ? 'win' : 'loss'}">${esc(k.killer_name || '?')}</b>
        <span class="muted">→</span><span>${esc(k.victim_name)}</span>
        <span class="muted pf-kill-meta">${t(`pf.cause.${k.cause}`)}${k.killer_health != null ? ` · ❤ ${k.killer_health}` : ''}${k.victim_pops ? ` · ${t('pf.pops', { n: k.victim_pops })}` : ''}</span></div>`).join('');
    });
    more.addEventListener('click', () => load().catch((err) => toast(err.message, 'err')));
    await load();
  }

  // ---------------------------------------------------------------- routing
  const main = $('#pfMain');
  async function show(tab) {
    if (!TABS.some(([id]) => id === tab)) tab = 'general';
    $$('.pf-tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    main.classList.remove('in');
    void main.offsetWidth;
    main.classList.add('in');
    try {
      if (tab === 'general') main.innerHTML = general_();
      else if (tab === 'stats') await stats_(main);
      else await matches_(main);
    } catch (err) {
      main.innerHTML = emptyHtml(t('empty.errT'), t('empty.errD'));
    }
  }
  $$('.pf-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    history.replaceState(null, '', `#${b.dataset.tab}`);
    show(b.dataset.tab);
  }));
  show(location.hash.slice(1));
  initReveal();
});
