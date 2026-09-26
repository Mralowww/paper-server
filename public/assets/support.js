/* Mc.Tierlist.Asia — support tickets: player pages, live chat thread, staff inbox pieces */
(() => {
  const { $, $$, esc, t, toast, request, discordAvatar, avatarUrl, catIcon, catLabel, statusPill, emptyHtml, loginUrl, icon, initReveal, countUp, session } = window.MCTL;
  const { fmtDate, fmtRelative, lang } = window.I18N;
  const STEPS = ['open', 'in_progress', 'closed'];
  const POLL_MS = 6000;
  const GROUP_MS = 5 * 60 * 1000;
  const TZ = 'Asia/Taipei';
  const MAX_FILES = 3;
  const MAX_BYTES = 5 * 1024 * 1024;

  const nl2br = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  const dayKey = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
  const fmtDay = (ms) => new Date(ms).toLocaleDateString(lang, { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'long' });
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString(lang, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const svg = (d, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    status: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  };

  async function postForm(url, fd) {
    const res = await fetch(url, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const key = `error.${data.error}`;
      throw new Error(window.I18N.has(key) ? t(key) : (data.message || t('common.error')));
    }
    return data;
  }

  const stepper = (st) => `<div class="stepper">${STEPS.map((x, i) => `<div class="step ${STEPS.indexOf(st) >= i ? 'done' : ''} ${x === st ? 'current' : ''}"><span>${i + 1}</span>${t(`support.status.${x}`)}</div>`).join('<div class="step-line"></div>')}</div>`;
  const targetChip = (tk) => (tk.target_name ? `<a class="sp-target" href="/player/${encodeURIComponent(tk.target_name)}" target="_blank" rel="noopener"><img src="${avatarUrl(tk.target_uuid || tk.target_name, 32)}" alt="">${t('sp.reported')} <b>${esc(tk.target_name)}</b></a>` : '');

  // ================================================================ image picker (chips + paste + drag)
  function attachPicker(form, { dropArea } = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.multiple = true;
    input.hidden = true;
    form.append(input);
    const tray = $('.sp-tray', form);
    let files = [];
    const draw = () => {
      tray.innerHTML = files.map((f, i) => `<div class="sp-chip" style="--i:${i}"><img src="${URL.createObjectURL(f)}" alt=""><span>${esc(f.name.slice(0, 24))}</span><button type="button" data-rm="${i}" aria-label="${t('common.delete')}">×</button></div>`).join('');
      tray.hidden = !files.length;
      form.dispatchEvent(new Event('filechange'));
    };
    const add = (list) => {
      for (const f of list) {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast(t('error.invalid_file'), 'err'); continue; }
        if (f.size > MAX_BYTES) { toast(t('error.file_too_large'), 'err'); continue; }
        if (files.length >= MAX_FILES) { toast(t('error.too_many_files'), 'err'); break; }
        files.push(f);
      }
      draw();
    };
    $$('[data-pick]', form).forEach((b) => b.addEventListener('click', () => input.click()));
    input.addEventListener('change', () => { const picked = [...input.files]; input.value = ''; add(picked); });
    tray.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { files.splice(Number(rm.dataset.rm), 1); draw(); }
    });
    form.addEventListener('paste', (e) => {
      const pasted = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (pasted.length) { e.preventDefault(); add(pasted); }
    });
    const area = dropArea || form;
    let depth = 0;
    area.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); depth++; area.classList.add('sp-drag'); } });
    area.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    area.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; area.classList.remove('sp-drag'); } });
    area.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault(); depth = 0; area.classList.remove('sp-drag');
      add([...e.dataTransfer.files]);
    });
    form._files = () => files;
    return { files: () => files, clear: () => { files = []; draw(); } };
  }

  const autoGrow = (ta, max = 260) => {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(max, ta.scrollHeight)}px`; };
    ta.addEventListener('input', fit);
    fit();
  };

  // ================================================================ live thread
  function messageHtml(m, prev, viewerId, staffView) {
    if (m.kind === 'status') {
      return `<div class="sp-sys" data-id="${m.id}"><span>${svg(IC.status, 14)}${t('sp.statusChanged', { name: esc(m.author_name || '—'), status: `<b class="st-${esc(m.body)}">${t(`support.status.${m.body}`)}</b>` })}</span><time>${esc(fmtClock(m.created_at))}</time></div>`;
    }
    const mine = staffView ? !!m.is_staff : m.author_id === viewerId;
    const cont = prev && prev.kind !== 'status' && prev.author_id === m.author_id && m.created_at - prev.created_at < GROUP_MS
      && dayKey(prev.created_at) === dayKey(m.created_at);
    const imgs = m.attachments.length ? `<div class="sp-imgs n${Math.min(m.attachments.length, 3)}">${m.attachments.map((a) => `<a class="msg-img" href="/api/support/attachments/${a.id}" target="_blank" rel="noopener"><img class="thumb" src="/api/support/attachments/${a.id}" alt="${esc(a.orig_name || '')}" loading="lazy"></a>`).join('')}</div>` : '';
    return `<div class="sp-msg ${mine ? 'mine' : ''} ${m.is_staff ? 'staff' : ''} ${cont ? 'cont' : ''}" data-id="${m.id}">
      ${cont ? '<span class="sp-av-gap"></span>' : `<img class="sp-av" src="${discordAvatar(m.author_id, m.author_avatar)}" alt="">`}
      <div class="sp-bubble-wrap">
        ${cont ? '' : `<div class="sp-meta"><b>${esc(m.author_name || m.author_id)}</b>${m.is_staff ? `<span class="sp-badge">${svg(IC.check, 11)}${t('support.staff')}</span>` : ''}<time title="${esc(fmtDate(m.created_at))}">${esc(fmtClock(m.created_at))}</time></div>`}
        <div class="sp-bubble">${nl2br(m.body)}${imgs}</div>
      </div>
    </div>`;
  }

  /**
   * Mounts a ticket conversation into `root`.
   * opts: { id, staff: bool, headExtra(tk) → html, bindHead(root, tk, reload), templates: [] }
   * Returns { destroy() }.
   */
  async function mountThread(root, opts) {
    const { user } = await session;
    let timer = null;
    let alive = true;
    let lastId = 0;
    let lastMsg = null;
    let tk;
    const first = await request(`/api/support/tickets/${opts.id}`);
    tk = first.ticket;

    root.innerHTML = `
      <div class="sp-conv">
        <header class="sp-head">${headHtml(tk)}</header>
        <div class="sp-scroll"><div class="sp-thread"></div><button class="sp-jump" hidden>${svg(IC.down, 14)}${t('sp.newMessages')}</button></div>
        <div class="sp-composer-wrap"></div>
      </div>`;
    const scroller = $('.sp-scroll', root);
    const thread = $('.sp-thread', root);
    const jump = $('.sp-jump', root);

    function headHtml(x) {
      return `<div class="sp-head-main">${catIcon(x.category, 24)}
        <div class="sp-head-text">
          <div class="sp-head-meta"><span class="mono">#${x.id}</span><span>${catLabel(x.category)}</span>${opts.staff ? `<span>${esc(x.username || x.user_id)}</span>` : ''}<span>${esc(fmtDate(x.created_at))}</span></div>
          <h2>${esc(x.title)}</h2>
          <div class="sp-head-row">${stepper(x.status)}${targetChip(x)}</div>
        </div>
        ${opts.headExtra ? `<div class="sp-head-extra">${opts.headExtra(x)}</div>` : ''}</div>`;
    }
    const refreshHead = () => {
      $('.sp-head', root).innerHTML = headHtml(tk);
      opts.bindHead?.(root, tk, reloadAll);
      drawComposer();
    };

    const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    const toBottom = (smooth) => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    scroller.addEventListener('scroll', () => { if (nearBottom()) jump.hidden = true; });
    jump.addEventListener('click', () => { toBottom(true); jump.hidden = true; });

    function append(messages, animate) {
      let html = '';
      for (const m of messages) {
        if (!lastMsg || dayKey(lastMsg.created_at) !== dayKey(m.created_at)) html += `<div class="sp-day"><span>${esc(fmtDay(m.created_at))}</span></div>`;
        html += messageHtml(m, lastMsg, user.id, opts.staff);
        lastMsg = m;
        lastId = Math.max(lastId, m.id);
      }
      const wasBottom = nearBottom();
      const start = thread.children.length;
      thread.insertAdjacentHTML('beforeend', html);
      if (animate) [...thread.children].slice(start).forEach((el, i) => { el.classList.add('sp-in'); el.style.animationDelay = `${i * 60}ms`; });
      return wasBottom;
    }

    // ---- composer
    let picker = null;
    function drawComposer() {
      const wrap = $('.sp-composer-wrap', root);
      if (tk.status === 'closed' && !opts.staff) {
        wrap.innerHTML = `<div class="sp-closed">${svg(IC.check, 16)}${t('support.closedNote')}</div>`;
        return;
      }
      if (wrap.querySelector('form')) return;
      wrap.innerHTML = `<form class="sp-composer">
        ${opts.templates?.length ? `<div class="sp-quick">${svg(IC.bolt, 13)}${opts.templates.map((x, i) => `<button type="button" data-tpl="${i}" title="${esc(x)}">${esc(x.length > 26 ? `${x.slice(0, 26)}…` : x)}</button>`).join('')}${opts.manageTemplates ? `<button type="button" class="sp-quick-edit" data-tpl-edit>${t('sp.editTemplates')}</button>` : ''}</div>` : ''}
        <div class="sp-tray" hidden></div>
        <div class="sp-input">
          <button type="button" class="sp-icon-btn" data-pick title="${t('support.addImages')}">${svg(IC.clip, 18)}</button>
          <textarea name="body" rows="1" maxlength="4000" placeholder="${t(opts.staff ? 'sp.replyStaffPh' : 'sp.replyPh')}"></textarea>
          <button class="sp-send" title="${t('support.send')} (Ctrl+Enter)">${svg(IC.send, 18)}</button>
        </div>
        <div class="sp-hint">${t('sp.hint')}</div>
      </form>`;
      const form = $('form', wrap);
      const ta = $('textarea', form);
      autoGrow(ta);
      picker = attachPicker(form, { dropArea: root.querySelector('.sp-conv') });
      const sendBtn = $('.sp-send', form);
      const update = () => { sendBtn.classList.toggle('ready', !!ta.value.trim()); };
      ta.addEventListener('input', update);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tpl]');
        if (b) { ta.value = ta.value ? `${ta.value}\n${opts.templates[b.dataset.tpl]}` : opts.templates[b.dataset.tpl]; ta.dispatchEvent(new Event('input')); ta.focus(); }
        if (e.target.closest('[data-tpl-edit]')) opts.manageTemplates();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        const fd = new FormData();
        fd.append('body', text);
        picker.files().forEach((f) => fd.append('files', f));
        sendBtn.disabled = true;
        sendBtn.classList.add('sending');
        try {
          await postForm(`/api/support/tickets/${tk.id}/messages`, fd);
          ta.value = ''; ta.dispatchEvent(new Event('input'));
          picker.clear();
          sendBtn.classList.add('sent');
          setTimeout(() => sendBtn.classList.remove('sent'), 700);
          await poll(true);
        } catch (err) { toast(err.message, 'err'); }
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending');
      });
    }

    async function poll(force) {
      if (!alive || (!force && document.hidden)) return;
      try {
        const d = await request(`/api/support/tickets/${tk.id}?since=${lastId}`);
        if (d.ticket.status !== tk.status || d.ticket.target_name !== tk.target_name) { tk = d.ticket; refreshHead(); }
        tk = d.ticket;
        if (d.messages.length) {
          const wasBottom = append(d.messages, true);
          const theirs = d.messages.some((m) => m.author_id !== user.id);
          if (wasBottom || force) setTimeout(() => toBottom(true), 30);
          else if (theirs) jump.hidden = false;
          opts.onUpdate?.();
        }
      } catch { /* offline — try again next tick */ }
    }

    async function reloadAll() {
      const d = await request(`/api/support/tickets/${tk.id}`);
      tk = d.ticket;
      thread.innerHTML = '';
      lastMsg = null; lastId = 0;
      append(d.messages, false);
      refreshHead();
      toBottom(false);
      opts.onUpdate?.();
    }

    append(first.messages, true);
    refreshHead();
    requestAnimationFrame(() => toBottom(false));
    timer = setInterval(() => poll(false), POLL_MS);
    const onVis = () => { if (!document.hidden) poll(false); };
    document.addEventListener('visibilitychange', onVis);
    return {
      reload: reloadAll,
      destroy() { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); },
    };
  }

  // ================================================================ list item
  function previewText(x, staffView) {
    const l = x.last;
    if (!l) return '';
    if (l.kind === 'status') return `<span class="muted">${t('sp.statusTo', { status: t(`support.status.${l.body}`) })}</span>`;
    const who = staffView ? (l.staff ? t('sp.you') : esc(l.author || '')) : (l.staff ? t('support.staff') : t('sp.you'));
    return `<b>${who}：</b>${esc(l.body.replace(/\s+/g, ' '))}`;
  }

  // ================================================================ player page
  async function supportPage() {
    const root = $('#supportRoot');
    const { user } = await session;
    if (!user) {
      root.innerHTML = emptyHtml(t('support.title'), t('support.loginD'),
        `<p style="margin-top:20px"><a class="btn btn-discord" href="${loginUrl()}">${icon.discord}${t('nav.loginDiscord')}</a></p>`);
      return initReveal();
    }
    let view = null;
    const stop = () => { view?.destroy(); view = null; };
    let state = { filter: '', q: '' };

    async function showList() {
      stop();
      history.replaceState(null, '', '/support');
      root.innerHTML = '<div class="skeleton" style="height:180px;border-radius:24px;margin-bottom:18px"></div><div class="skeleton" style="height:320px;border-radius:18px"></div>';
      const d = await request('/api/support/tickets');
      const count = (st) => d.tickets.filter((x) => x.status === st).length;
      const unread = d.tickets.filter((x) => x.unread).length;
      root.innerHTML = `
        <section class="sp-hero reveal">
          <div class="sp-hero-art" aria-hidden="true">${['bug', 'appeal', 'report', 'other'].map((c, i) => `<span style="--i:${i}">${catIcon(c, 22)}</span>`).join('')}</div>
          <div class="sp-hero-text">
            <div class="kicker">Support</div>
            <h1>${t('support.title')}</h1>
            <p>${t('support.subtitle')}</p>
            ${unread ? `<div class="sp-hero-unread"><i></i>${t('sp.unreadCount', { n: unread })}</div>` : ''}
          </div>
          ${d.blocked ? '' : `<button class="btn btn-gold sp-new-btn" id="newTicket">${svg('<path d="M12 5v14M5 12h14"/>', 16)}${t('sp.newShort')}</button>`}
        </section>
        ${d.blocked ? `<div class="callout reveal" style="margin-bottom:18px">${t('support.blocked')}${d.blockReason ? ` — ${esc(d.blockReason)}` : ''}</div>` : ''}
        <div class="sp-stats reveal">
          ${STEPS.map((st) => `<button class="sp-stat ${st} ${state.filter === st ? 'on' : ''}" data-filter="${st}"><span class="sp-stat-ico">${svg(st === 'closed' ? IC.check : st === 'open' ? IC.chat : IC.status, 18)}</span><b data-n="${count(st)}">0</b><span>${t(`support.status.${st}`)}</span></button>`).join('')}
        </div>
        <div class="sp-toolbar reveal">
          <label class="sp-search">${svg(IC.search, 15)}<input placeholder="${t('sp.search')}" value="${esc(state.q)}"></label>
          <div class="seg">${['', ...STEPS].map((st) => `<button data-filter="${st}" class="${state.filter === st ? 'active' : ''}">${st ? t(`support.status.${st}`) : t('support.filterAll')}</button>`).join('')}</div>
        </div>
        <div class="sp-list"></div>`;
      $$('[data-n]', root).forEach((el) => countUp(el, Number(el.dataset.n)));
      const list = $('.sp-list', root);
      const draw = () => {
        const q = state.q.toLowerCase();
        const rows = d.tickets.filter((x) => (!state.filter || x.status === state.filter)
          && (!q || `${x.title} #${x.id} ${x.target_name || ''} ${catLabel(x.category)}`.toLowerCase().includes(q)));
        $$('[data-filter]', root).forEach((b) => b.classList.toggle(b.classList.contains('sp-stat') ? 'on' : 'active', b.dataset.filter === state.filter));
        list.innerHTML = rows.length ? rows.map((x, i) => `
          <a class="sp-card ${x.status} ${x.unread ? 'unread' : ''}" href="#${x.id}" data-open="${x.id}" style="--i:${Math.min(i, 12)}">
            ${catIcon(x.category, 20)}
            <span class="sp-card-main">
              <span class="sp-card-title"><b>${esc(x.title)}</b>${x.unread ? `<span class="sp-newtag">${t('sp.newReply')}</span>` : ''}</span>
              <span class="sp-card-prev">${previewText(x, false)}</span>
              <span class="sp-card-meta"><span class="mono">#${x.id}</span><span>${catLabel(x.category)}</span>${x.target_name ? `<span>${svg(IC.target, 12)}${esc(x.target_name)}</span>` : ''}<span>${svg(IC.chat, 12)}${x.message_count}</span><span>${esc(fmtRelative(x.updated_at))}</span></span>
            </span>
            ${statusPill(x.status)}
            <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>
          </a>`).join('') : `<div class="sp-empty">${catIcon('other', 30)}<h3>${d.tickets.length ? t('au.empty') : t('support.empty')}</h3>${d.tickets.length || d.blocked ? '' : `<button class="btn btn-gold" data-new>${t('support.new')}</button>`}</div>`;
      };
      draw();
      $('.sp-search input', root).addEventListener('input', (e) => { state.q = e.target.value.trim(); draw(); });
      root.onclick = (e) => {
        if (e.target.closest('#newTicket, [data-new]')) { location.hash = 'new'; return; }
        const f = e.target.closest('[data-filter]');
        if (f) { state.filter = state.filter === f.dataset.filter && f.classList.contains('sp-stat') ? '' : f.dataset.filter; draw(); return; }
        const a = e.target.closest('[data-open]');
        if (a) { e.preventDefault(); location.hash = a.dataset.open; }
      };
      initReveal();
    }

    function showNew() {
      stop();
      root.onclick = null;
      const cats = ['bug', 'appeal', 'report', 'other'];
      root.innerHTML = `
        <a href="#" class="link-more back-link" data-back>${t('support.back')}</a>
        <div class="sp-new">
          <form class="sp-form card" id="ticketForm" novalidate>
            <div class="sp-form-head"><div class="kicker">${t('sp.newKicker')}</div><h1>${t('support.newTitle')}</h1></div>
            <div class="sp-field"><label>${t('support.category')}</label>
              <div class="sp-cats">${cats.map((c, i) => `<label class="sp-cat ${c}"><input type="radio" name="category" value="${c}" ${i === 0 ? 'checked' : ''}>
                <span>${catIcon(c, 22)}<b>${catLabel(c)}</b><small>${t(`sp.catDesc.${c}`)}</small></span></label>`).join('')}</div></div>
            <div class="sp-field sp-target-field" hidden>
              <label>${t('sp.targetLabel')} <em>*</em></label>
              <div class="sp-player-input"><img alt="" src="/heads/avatar/MHF_Steve/64.png"><input class="input mono" name="target" maxlength="16" placeholder="${t('sp.targetPh')}" autocomplete="off"><span class="sp-check"></span></div>
              <small class="muted">${t('sp.targetHint')}</small>
            </div>
            <div class="sp-field"><label>${t('support.subject')} <em>*</em><span class="sp-count" data-for="title">0/100</span></label><input class="input" name="title" maxlength="100" placeholder="${t('sp.titlePh')}"></div>
            <div class="sp-field"><label>${t('support.body')} <em>*</em><span class="sp-count" data-for="body">0/4000</span></label><textarea class="input" name="body" rows="6" maxlength="4000" placeholder="${t('support.bodyPh')}"></textarea></div>
            <div class="sp-field"><label>${t('sp.images')}</label>
              <button type="button" class="sp-dropzone" data-pick>${svg(IC.clip, 20)}<b>${t('sp.dropTitle')}</b><small>${t('sp.dropHint', { n: MAX_FILES })}</small></button>
              <div class="sp-tray" hidden></div></div>
            <div class="sp-actions"><button type="button" class="btn" data-back>${t('common.cancel')}</button><button class="btn btn-gold sp-submit">${svg(IC.send, 16)}${t('support.submit')}</button></div>
          </form>
          <aside class="sp-tips card"><div class="sp-tips-inner"></div></aside>
        </div>`;
      const form = $('#ticketForm');
      const tips = $('.sp-tips-inner', root);
      attachPicker(form);
      const drawTips = (c) => {
        tips.classList.remove('in'); void tips.offsetWidth; tips.classList.add('in');
        tips.innerHTML = `${catIcon(c, 26)}<h3>${t(`sp.tip.${c}.t`)}</h3><ul>${t(`sp.tip.${c}.list`).split('|').map((x) => `<li>${svg(IC.check, 14)}<span>${esc(x)}</span></li>`).join('')}</ul><p class="muted">${t('sp.tipFoot')}</p>`;
        $('.sp-target-field', form).hidden = c !== 'report';
      };
      drawTips('bug');
      form.addEventListener('change', (e) => { if (e.target.name === 'category') drawTips(e.target.value); });
      $$('[data-back]', root).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; }));
      $$('.sp-count', form).forEach((c) => {
        const el = form[c.dataset.for];
        const max = Number(el.maxLength);
        const upd = () => { c.textContent = `${el.value.length}/${max}`; c.classList.toggle('warn', el.value.length > max * 0.9); };
        el.addEventListener('input', upd);
      });
      autoGrow(form.body, 420);

      // Reported player: live head preview + Mojang check.
      const tInput = form.target;
      const tImg = $('.sp-player-input img', form);
      const tCheck = $('.sp-check', form);
      let tTimer;
      tInput.addEventListener('input', () => {
        const v = tInput.value.trim();
        tCheck.className = 'sp-check';
        clearTimeout(tTimer);
        if (!/^[A-Za-z0-9_]{2,16}$/.test(v)) { tImg.src = '/heads/avatar/MHF_Steve/64.png'; if (v) tCheck.className = 'sp-check bad'; return; }
        tCheck.className = 'sp-check wait';
        tTimer = setTimeout(async () => {
          try {
            const r = await request(`/api/support/check-player?name=${encodeURIComponent(v)}`);
            if (tInput.value.trim() !== v) return;
            tCheck.className = `sp-check ${r.ok ? 'good' : 'bad'}`;
            if (r.ok) tImg.src = avatarUrl(r.uuid || v, 64);
          } catch { tCheck.className = 'sp-check'; }
        }, 450);
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cat = form.category.value;
        const fail = (el, key) => { toast(t(key), 'err'); el.focus(); el.closest('.sp-field').classList.remove('shake'); void el.offsetWidth; el.closest('.sp-field').classList.add('shake'); };
        if (cat === 'report' && (!tInput.value.trim() || tCheck.classList.contains('bad'))) return fail(tInput, 'error.invalid_target');
        if (!form.title.value.trim()) return fail(form.title, 'error.invalid_title');
        if (!form.body.value.trim()) return fail(form.body, 'error.invalid_body');
        const fd = new FormData();
        fd.append('category', cat);
        fd.append('title', form.title.value.trim());
        fd.append('body', form.body.value.trim());
        if (cat === 'report') fd.append('target', tInput.value.trim());
        form._files?.().forEach((f) => fd.append('files', f));
        const btn = $('.sp-submit', form);
        btn.disabled = true;
        btn.classList.add('loading');
        try {
          const { id } = await postForm('/api/support/tickets', fd);
          const ok = document.createElement('div');
          ok.className = 'sp-success';
          ok.innerHTML = `<div class="sp-success-card"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="m15 27 7 7 15-15"/></svg><h3>${t('sp.sentT')}</h3><p class="muted">${t('sp.sentD', { id })}</p></div>`;
          document.body.append(ok);
          setTimeout(() => { ok.classList.add('out'); location.hash = String(id); setTimeout(() => ok.remove(), 400); }, 1300);
        } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.classList.remove('loading'); }
      });
    }

    async function showTicket(id) {
      stop();
      root.onclick = null;
      root.innerHTML = '<div class="skeleton" style="height:560px;border-radius:22px"></div>';
      try {
        root.innerHTML = `<a href="#" class="link-more back-link" data-back>${t('support.back')}</a><div class="sp-conv-host"></div>`;
        $('[data-back]', root).addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });
        view = await mountThread($('.sp-conv-host', root), { id, staff: false });
      } catch {
        location.hash = '';
      }
    }

    const route = () => {
      const h = location.hash.slice(1);
      if (/^\d+$/.test(h)) return showTicket(h);
      if (h === 'new') return showNew();
      return showList();
    };
    addEventListener('hashchange', route);
    route();
  }

  window.MCTL_SUPPORT = { mountThread, previewText, targetChip, svg, IC };
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'support') supportPage();
  });
})();
