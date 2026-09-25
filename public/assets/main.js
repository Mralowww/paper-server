/* Mc.Tierlist.Asia — shared site script */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const icon = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    arrow: '<svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    trophy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/></svg>',
    globe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    sword: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/></svg>',
    code: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
    shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  };

  const tierBadge = (tier, { retired = false, lg = false } = {}) => {
    const group = tier.slice(2);
    return `<span class="tier t${group}${tier.startsWith('LT') ? ' lt' : ''}${retired ? ' retired' : ''}${lg ? ' lg' : ''}" title="${retired ? '已退休 · ' : ''}${tier}">${retired ? 'R' : ''}${tier}</span>`;
  };
  const regionBadge = (r) => `<span class="region ${esc(r)}">${esc(r)}</span>`;
  const avatarUrl = (name, size = 64) => `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;
  const fallbackImg = "this.onerror=null;this.src='https://mc-heads.net/avatar/MHF_Steve/64'";

  async function api(path) {
    const res = await fetch(`/api/site${path}`, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || res.statusText), { status: res.status });
    return data;
  }

  function toast(msg, type = 'ok') {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    box.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2800);
  }

  // ---------- Chrome (nav + footer) ----------
  function renderChrome(page) {
    const loader = document.createElement('div');
    loader.className = 'page-loader';
    document.body.prepend(loader);

    const links = [
      ['home', '/', '首頁'],
      ['rankings', '/rankings', '排行榜'],
      ['docs', '/docs', '開發者 API'],
    ];
    const nav = document.createElement('header');
    nav.className = 'nav';
    nav.innerHTML = `
      <div class="container nav-inner">
        <a class="brand" href="/"><img src="/assets/logo.svg" alt=""><span>Mc.Tierlist<span class="accent">.Asia</span></span></a>
        <nav class="nav-links">${links.map(([id, href, label]) => `<a href="${href}" class="${id === page ? 'active' : ''}">${label}</a>`).join('')}
          <a href="/admin" class="${page === 'admin' ? 'active' : ''}">管理後台</a></nav>
        <div class="nav-right">
          <form class="nav-search" role="search">${icon.search}<input name="q" placeholder="搜尋玩家…" autocomplete="off" aria-label="搜尋玩家"><kbd>/</kbd></form>
          <button class="btn btn-sm btn-ghost menu-btn" aria-label="選單">${icon.menu}</button>
        </div>
      </div>`;
    document.body.prepend(nav);

    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    $('.menu-btn', nav).addEventListener('click', () => nav.classList.toggle('open'));

    const form = $('.nav-search', nav);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = form.q.value.trim();
      if (q) location.href = `/player/${encodeURIComponent(q)}`;
    });
    addEventListener('keydown', (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); form.q.focus(); }
    });

    const footer = document.createElement('footer');
    footer.className = 'site';
    footer.innerHTML = `
      <div class="container inner">
        <div class="brand"><img src="/assets/logo.svg" alt="" style="width:26px;height:26px"><span>Mc.Tierlist<span class="accent">.Asia</span></span></div>
        <div>© ${new Date().getFullYear()} Mc.Tierlist.Asia · 非 Mojang / Microsoft 官方網站</div>
        <div style="display:flex;gap:18px"><a href="/rankings">排行榜</a><a href="/docs">API 文件</a><a href="/admin">管理後台</a></div>
      </div>`;
    document.body.append(footer);
  }

  // ---------- Effects ----------
  function initReveal() {
    const els = $$('.reveal');
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
      <a class="board-row reveal${top}" style="--d:${Math.min(i, 12) * 0.04}s" href="/player/${encodeURIComponent(p.name)}">
        <div class="rank-cell"><span class="n">${p.rank}.</span><img src="${avatarUrl(p.name)}" alt="" loading="lazy" onerror="${fallbackImg}"></div>
        <div class="player-cell">
          <div class="pname">${esc(p.name)}</div>
          <div class="psub">${icon.trophy.replace('width="20" height="20"', 'width="14" height="14"')} <b>${p.points}</b> 分${v.retired ? ' · 已退休' : ''}</div>
        </div>
        <div class="region-cell">${regionBadge(p.region)}</div>
        <div class="tier-cell">${tierBadge(v.tier, { retired: v.retired })}</div>
      </a>`;
  }

  const emptyHtml = (title, text) => `
    <div class="empty reveal">
      <div>
        <div class="e-ico" style="margin:0 auto 18px">${icon.sword.replace(/20/g, '30')}</div>
        <h3>${title}</h3><p>${text}</p>
      </div>
    </div>`;

  const skeletonRows = (n) => Array.from({ length: n }, () => '<div class="skeleton" style="height:72px;margin-bottom:8px"></div>').join('');

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
        list.innerHTML = r.players.length
          ? r.players.map(rowHtml).join('')
          : emptyHtml('排行榜即將開放', '目前還沒有玩家上榜。完成測試後，玩家將會出現在這裡。');
      } catch {
        statEls.forEach((el) => { el.textContent = '—'; });
        list.innerHTML = emptyHtml('暫時無法載入', '請稍後重新整理頁面。');
      }
      initReveal();
    },

    async rankings() {
      const list = $('#board');
      const moreBtn = $('#loadMore');
      const state = { region: '', tier: '', search: '', offset: 0, limit: 50 };
      const params = new URLSearchParams(location.search);
      state.search = params.get('q') || '';
      $('#boardSearch').value = state.search;

      async function load(reset) {
        if (reset) { state.offset = 0; list.innerHTML = skeletonRows(6); }
        const q = new URLSearchParams({ limit: state.limit, offset: state.offset });
        if (state.region) q.set('region', state.region);
        if (state.tier) q.set('tier', state.tier);
        if (state.search) q.set('search', state.search);
        try {
          const data = await api(`/rankings/vanilla?${q}`);
          const html = data.players.map((p, i) => rowHtml(p, i)).join('');
          if (reset) list.innerHTML = html || emptyHtml(
            state.region || state.tier || state.search ? '沒有符合條件的玩家' : '排行榜即將開放',
            state.region || state.tier || state.search ? '換個篩選條件試試看。' : '目前還沒有玩家上榜，敬請期待！');
          else list.insertAdjacentHTML('beforeend', html);
          state.offset += data.players.length;
          moreBtn.hidden = state.offset >= data.total;
          $('#boardCount').textContent = `${data.total} 位玩家`;
        } catch {
          list.innerHTML = emptyHtml('暫時無法載入', '請稍後重新整理頁面。');
        }
        initReveal();
      }

      const bindChips = (root, key) => root.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        $$('.chip', root).forEach((c) => c.classList.toggle('active', c === chip));
        state[key] = chip.dataset.v;
        load(true);
      });
      bindChips($('#regionChips'), 'region');
      bindChips($('#tierChips'), 'tier');
      let t;
      $('#boardSearch').addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => { state.search = e.target.value.trim(); load(true); }, 250);
      });
      moreBtn.addEventListener('click', () => load(false));
      load(true);
    },

    async player() {
      const name = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || new URLSearchParams(location.search).get('name') || '');
      const root = $('#profile');
      try {
        const p = await api(`/players/${encodeURIComponent(name)}`);
        const v = p.tiers.vanilla;
        document.title = `${p.name} · Mc.Tierlist.Asia`;
        root.innerHTML = `
          <div class="profile-card spot reveal">
            <div class="body-render"><img src="https://mc-heads.net/body/${encodeURIComponent(p.name)}/220" alt="${esc(p.name)}" onerror="this.onerror=null;this.src='https://mc-heads.net/body/MHF_Steve/220'"></div>
            <h1>${esc(p.name)}</h1>
            <div class="profile-meta">${regionBadge(p.region)} ${tierBadge(v.tier, { retired: v.retired })}</div>
          </div>
          <div class="profile-main">
            <div class="kv">
              <div class="stat spot reveal" style="--d:.05s"><div class="ico">${icon.trophy}</div><div class="num">#<span data-to="${p.rank}">0</span></div><div class="lbl">總排名</div></div>
              <div class="stat spot reveal" style="--d:.1s"><div class="ico">${icon.bolt.replace(/22/g, '20')}</div><div class="num"><span data-to="${p.points}">0</span></div><div class="lbl">積分</div></div>
              <div class="stat spot reveal" style="--d:.15s"><div class="ico">${icon.globe}</div><div class="num">${esc(p.region)}</div><div class="lbl">地區</div></div>
            </div>
            <div class="mode-row spot reveal" style="--d:.2s">
              <div class="left"><div class="m-ico"><img src="/assets/vanilla.svg" alt="" width="26" height="26" style="image-rendering:pixelated"></div>Vanilla</div>
              ${tierBadge(v.tier, { retired: v.retired, lg: true })}
            </div>
            <p class="reveal" style="--d:.25s;color:var(--dim);font-size:13px;margin:0">最後更新：${new Date(p.updatedAt).toLocaleString('zh-TW')}</p>
          </div>`;
        $$('[data-to]', root).forEach((el) => countUp(el, Number(el.dataset.to)));
      } catch (err) {
        root.style.gridTemplateColumns = '1fr';
        root.innerHTML = emptyHtml(err.status === 404 ? '找不到這位玩家' : '暫時無法載入',
          err.status === 404 ? `「${esc(name)}」尚未被列入排行榜。` : '請稍後重新整理頁面。');
      }
      initReveal();
    },

    docs() {
      $$('.code').forEach((block) => {
        const btn = $('.copy-btn', block);
        btn?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText($('pre', block).innerText); btn.textContent = '已複製'; }
          catch { btn.textContent = '複製失敗'; }
          setTimeout(() => { btn.textContent = '複製'; }, 1500);
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

  window.MCTL = { $, $$, esc, icon, tierBadge, regionBadge, avatarUrl, toast, renderChrome, initReveal, initSpotlight, countUp };

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page;
    renderChrome(page);
    initSpotlight();
    if (pages[page]) pages[page]();
    else initReveal();
  });
})();
