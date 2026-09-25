/* Mc.Tierlist.Asia — admin panel */
document.addEventListener('DOMContentLoaded', () => {
  const { $, $$, esc, tierBadge, regionBadge, avatarUrl, toast, countUp } = window.MCTL;
  const root = $('#adminRoot');
  const TIERS = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
  const REGIONS = [['AS', '亞洲'], ['NA', '北美'], ['EU', '歐洲'], ['SA', '南美'], ['OC', '大洋洲'], ['AF', '非洲']];
  const ACTIONS = {
    login: '登入後台', login_denied: '嘗試登入（無權限）', seed: '初始化管理員',
    player_create: '新增玩家', player_update: '更新玩家', player_delete: '刪除玩家',
    key_create: '建立 API Key', key_revoke: '停用 API Key', key_restore: '啟用 API Key', key_delete: '刪除 API Key',
    admin_add: '新增管理員', admin_role: '變更管理員權限', admin_remove: '移除管理員',
  };
  const ERRORS = {
    not_admin: '這個 Discord 帳號沒有管理員權限。',
    invalid_state: '登入驗證失敗，請重新嘗試。',
    discord_failed: '無法連線到 Discord，請稍後再試。',
    not_configured: '伺服器尚未設定 Discord 登入（DISCORD_CLIENT_ID / SECRET）。',
  };

  let me = null;

  async function api(path, opts = {}) {
    const res = await fetch(`/api/admin${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { renderLogin(); throw new Error('unauthorized'); }
    if (!res.ok) throw new Error(data.message || data.error || '發生錯誤');
    return data;
  }

  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('zh-TW', { hour12: false }) : '—');
  const discordAvatar = (a) => (a.avatar
    ? `https://cdn.discordapp.com/avatars/${a.discord_id || a.id}/${a.avatar}.png?size=64`
    : 'https://cdn.discordapp.com/embed/avatars/0.png');

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

  function confirmDialog(title, text, danger = true) {
    return new Promise((resolve) => {
      let answered = false;
      modal(`
        <h3>${title}</h3><p class="muted" style="margin:0">${text}</p>
        <div class="modal-actions"><button class="btn" data-close>取消</button><button class="btn ${danger ? 'btn-danger' : 'btn-gold'}" id="ok">確定</button></div>`,
      (bg, close) => {
        $('#ok', bg).addEventListener('click', () => { answered = true; resolve(true); close(); });
        new MutationObserver((_, obs) => { if (!bg.isConnected) { obs.disconnect(); if (!answered) resolve(false); } })
          .observe(document.body, { childList: true });
      });
    });
  }

  // ---------- Login ----------
  function renderLogin() {
    const err = new URLSearchParams(location.search).get('error');
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card reveal in">
          <img src="/assets/logo.svg" alt="">
          <h1>管理後台</h1>
          <p>僅限 Mc.Tierlist.Asia 管理團隊使用，請使用 Discord 帳號登入。</p>
          <a class="btn btn-discord" href="/auth/discord">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.9 19.9 0 0 0 6 3l1.3-2a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4-2 1 1.3 2a19.8 19.8 0 0 0 6-3c.5-5.1-.8-9.6-3.6-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
            使用 Discord 登入
          </a>
          ${err ? `<div class="login-err">${esc(ERRORS[err] || '登入失敗')}</div>` : ''}
        </div>
      </div>`;
  }

  // ---------- Shell ----------
  const TABS = [
    ['overview', '總覽', '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>'],
    ['players', '玩家管理', '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'],
    ['keys', 'API Keys', '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>'],
    ['admins', '管理員', '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'],
    ['audit', '操作紀錄', '<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>'],
  ];

  function renderShell() {
    if (location.search) history.replaceState(null, '', '/admin');
    root.innerHTML = `
      <div class="admin">
        <aside class="side">
          <div class="me">
            <img src="${discordAvatar(me)}" alt="">
            <div class="who"><b>${esc(me.username)}</b><span class="role ${me.role}">${me.role === 'super' ? '超級管理員' : '管理員'}</span></div>
          </div>
          <nav class="side-nav">
            ${TABS.map(([id, label, path]) => `<button data-tab="${id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>${label}</button>`).join('')}
          </nav>
          <button class="btn btn-ghost btn-sm" id="logout">登出</button>
        </aside>
        <section id="panel"></section>
      </div>`;
    $('.side-nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) go(b.dataset.tab);
    });
    $('#logout').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      me = null;
      renderLogin();
    });
    go(location.hash.slice(1) || 'overview');
  }

  function go(tab) {
    if (!views[tab]) tab = 'overview';
    history.replaceState(null, '', `#${tab}`);
    $$('.side-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    // Fresh element per view so event listeners from the previous view don't pile up.
    const old = $('#panel');
    const panel = old.cloneNode(false);
    old.replaceWith(panel);
    panel.innerHTML = '<div class="skeleton" style="height:320px"></div>';
    views[tab](panel).catch((err) => {
      if (err.message !== 'unauthorized') panel.innerHTML = `<div class="empty"><div><h3>載入失敗</h3><p>${esc(err.message)}</p></div></div>`;
    });
  }

  const auditHtml = (entries) => (entries.length
    ? entries.map((e, i) => `<div class="audit-item" style="animation-delay:${i * 0.03}s"><span class="dot"></span>
        <div><b>${esc(e.actor_name || 'system')}</b> <span class="muted">${esc(ACTIONS[e.action] || e.action)}</span>${e.detail ? ` · <span class="mono">${esc(e.detail)}</span>` : ''}</div>
        <time>${fmtTime(e.created_at)}</time></div>`).join('')
    : '<div class="card-pad muted">尚無紀錄</div>');

  // ---------- Views ----------
  const views = {
    async overview(panel) {
      const d = await api('/overview');
      const stat = (n, label, d2) => `<div class="stat spot reveal in" style="animation:panel-in .5s var(--ease) ${d2}s both"><div class="num" data-n="${n}">0</div><div class="lbl">${label}</div></div>`;
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>歡迎回來，${esc(me.username)}</h2><p>Mc.Tierlist.Asia 管理總覽</p></div></div>
          <div class="stats" style="margin:0 0 20px">
            ${stat(d.players, '排名玩家', 0)}${stat(d.tier1, 'Tier 1 玩家', 0.05)}${stat(d.activeKeys, '啟用中 API Key', 0.1)}${stat(d.apiCalls, 'API 總呼叫次數', 0.15)}
          </div>
          <div class="panel-head"><div><h2 style="font-size:19px">最近操作</h2></div><button class="btn btn-sm" data-go="audit">查看全部</button></div>
          <div class="card audit">${auditHtml(d.recent)}</div>
        </div>`;
      $$('[data-n]', panel).forEach((el) => countUp(el, Number(el.dataset.n)));
      $('[data-go]', panel).addEventListener('click', () => go('audit'));
    },

    async players(panel) {
      const { players } = await api('/players');
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div><h2>玩家管理</h2><p>共 ${players.length} 位玩家 · Vanilla</p></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input class="input" id="pFilter" placeholder="搜尋玩家…" style="width:200px;height:42px">
              <button class="btn btn-gold" id="addPlayer">＋ 新增玩家</button>
            </div>
          </div>
          <div class="card">${players.length ? `
            <div class="table-wrap"><table class="data">
              <thead><tr><th>#</th><th>玩家</th><th>地區</th><th>Tier</th><th>積分</th><th>更新時間</th><th></th></tr></thead>
              <tbody>${players.map((p, i) => `
                <tr data-name="${esc(p.name.toLowerCase())}" style="animation-delay:${Math.min(i, 20) * 0.02}s">
                  <td class="mono muted">${p.rank}</td>
                  <td><div class="cell-player"><img src="${avatarUrl(p.name, 32)}" alt="" loading="lazy">${esc(p.name)}</div></td>
                  <td>${regionBadge(p.region)}</td>
                  <td>${tierBadge(p.tier, { retired: !!p.retired })}</td>
                  <td class="mono">${p.points}</td>
                  <td class="muted" style="font-size:13px">${fmtTime(p.updated_at)}</td>
                  <td><div class="actions"><button class="btn btn-sm" data-edit="${p.id}">編輯</button><button class="btn btn-sm btn-danger" data-del="${p.id}">刪除</button></div></td>
                </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty" style="border:0"><div><h3>還沒有玩家</h3><p>點擊「新增玩家」開始建立排行榜。</p></div></div>'}
          </div>
        </div>`;
      $('#addPlayer').addEventListener('click', () => playerForm());
      $('#pFilter').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        $$('tr[data-name]', panel).forEach((tr) => { tr.hidden = !tr.dataset.name.includes(q); });
      });
      panel.addEventListener('click', async (e) => {
        const edit = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]');
        if (edit) playerForm(players.find((p) => String(p.id) === edit.dataset.edit));
        if (del) {
          const p = players.find((x) => String(x.id) === del.dataset.del);
          if (await confirmDialog('刪除玩家', `確定要將 <b>${esc(p.name)}</b> 從排行榜移除嗎？此操作無法復原。`)) {
            try { await api(`/players/${p.id}`, { method: 'DELETE' }); toast(`已刪除 ${p.name}`); go('players'); }
            catch (err) { toast(err.message, 'err'); }
          }
        }
      });
    },

    async keys(panel) {
      const { keys } = await api('/keys');
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div><h2>API Keys</h2><p>提供給開發者讀取排行榜資料。Key 只會在建立時顯示一次。</p></div>
            <button class="btn btn-gold" id="addKey">＋ 建立 Key</button>
          </div>
          <div class="card">${keys.length ? `
            <div class="table-wrap"><table class="data">
              <thead><tr><th>名稱</th><th>Key</th><th>狀態</th><th>呼叫次數</th><th>最後使用</th><th>建立者</th><th></th></tr></thead>
              <tbody>${keys.map((k, i) => `
                <tr style="animation-delay:${i * 0.03}s">
                  <td><b>${esc(k.name)}</b><div class="muted" style="font-size:12px">${fmtTime(k.created_at)}</div></td>
                  <td class="mono muted">${esc(k.prefix)}…</td>
                  <td>${k.revoked ? '<span class="pill off">已停用</span>' : '<span class="pill on">啟用中</span>'}</td>
                  <td class="mono">${k.usage_count.toLocaleString()}</td>
                  <td class="muted" style="font-size:13px">${fmtTime(k.last_used_at)}</td>
                  <td class="muted">${esc(k.created_by_name || k.created_by || '—')}</td>
                  <td><div class="actions">
                    <button class="btn btn-sm" data-toggle="${k.id}" data-revoked="${k.revoked}">${k.revoked ? '啟用' : '停用'}</button>
                    <button class="btn btn-sm btn-danger" data-del="${k.id}">刪除</button></div></td>
                </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty" style="border:0"><div><h3>尚未建立 API Key</h3><p>建立一把 Key 並交給開發者，他們就能透過 /api/v1 讀取資料。</p></div></div>'}
          </div>
        </div>`;
      $('#addKey').addEventListener('click', () => modal(`
        <h3>建立 API Key</h3>
        <form id="keyForm">
          <div class="field"><label>名稱（用途 / 開發者）</label><input class="input" name="name" maxlength="48" placeholder="例如：Discord Bot - 小明" required></div>
          <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn btn-gold">建立</button></div>
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
        const t = e.target.closest('[data-toggle]');
        const d = e.target.closest('[data-del]');
        try {
          if (t) {
            await api(`/keys/${t.dataset.toggle}`, { method: 'PATCH', body: { revoked: t.dataset.revoked === '0' } });
            toast(t.dataset.revoked === '0' ? '已停用 Key' : '已啟用 Key');
            go('keys');
          }
          if (d && await confirmDialog('刪除 API Key', '刪除後使用這把 Key 的程式將立即無法存取 API。')) {
            await api(`/keys/${d.dataset.del}`, { method: 'DELETE' });
            toast('已刪除 Key');
            go('keys');
          }
        } catch (err) { toast(err.message, 'err'); }
      });
    },

    async admins(panel) {
      const { admins } = await api('/admins');
      const isSuper = me.role === 'super';
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head">
            <div><h2>管理員</h2><p>${isSuper ? '你可以新增、移除管理員，或變更他們的權限。' : '只有超級管理員可以修改管理員名單。'}</p></div>
            ${isSuper ? '<button class="btn btn-gold" id="addAdmin">＋ 新增管理員</button>' : ''}
          </div>
          <div class="card"><div class="table-wrap"><table class="data">
            <thead><tr><th>管理員</th><th>Discord ID</th><th>權限</th><th>最後登入</th><th></th></tr></thead>
            <tbody>${admins.map((a, i) => {
              const self = a.discord_id === me.id;
              const editable = isSuper && !self && !a.protected;
              return `<tr style="animation-delay:${i * 0.03}s">
                <td><div class="cell-player"><img src="${discordAvatar(a)}" alt="" style="border-radius:50%;image-rendering:auto">${esc(a.username || '（尚未登入）')}${self ? ' <span class="muted">（你）</span>' : ''}</div></td>
                <td class="mono muted">${esc(a.discord_id)}</td>
                <td>${editable
                  ? `<select class="input" data-role="${a.discord_id}" style="height:34px;width:auto"><option value="admin" ${a.role === 'admin' ? 'selected' : ''}>管理員</option><option value="super" ${a.role === 'super' ? 'selected' : ''}>超級管理員</option></select>`
                  : `<span class="role ${a.role}">${a.role === 'super' ? '超級管理員' : '管理員'}</span>${a.protected ? ' <span class="muted" title="由伺服器設定保護">🔒</span>' : ''}`}</td>
                <td class="muted" style="font-size:13px">${fmtTime(a.last_login_at)}</td>
                <td><div class="actions">${editable ? `<button class="btn btn-sm btn-danger" data-remove="${a.discord_id}">移除</button>` : ''}</div></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div></div>
        </div>`;
      if (!isSuper) return;
      $('#addAdmin').addEventListener('click', () => modal(`
        <h3>新增管理員</h3>
        <form id="adminForm">
          <div class="field"><label>Discord 使用者 ID</label><input class="input mono" name="discordId" inputmode="numeric" placeholder="例如：1041596704434167868" required></div>
          <div class="field"><label>權限</label><select class="input" name="role"><option value="admin">管理員</option><option value="super">超級管理員</option></select></div>
          <p class="muted" style="font-size:13px;margin:0">在 Discord 開啟開發者模式後，右鍵使用者 →「複製使用者 ID」。</p>
          <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn btn-gold">新增</button></div>
        </form>`, (bg, close) => {
        $('#adminForm', bg).addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('/admins', { method: 'POST', body: { discordId: e.target.discordId.value.trim(), role: e.target.role.value } });
            close(); toast('已新增管理員'); go('admins');
          } catch (err) { toast(err.message, 'err'); }
        });
      }));
      panel.addEventListener('change', async (e) => {
        const sel = e.target.closest('[data-role]');
        if (!sel) return;
        try { await api(`/admins/${sel.dataset.role}`, { method: 'PUT', body: { role: sel.value } }); toast('已更新權限'); }
        catch (err) { toast(err.message, 'err'); go('admins'); }
      });
      panel.addEventListener('click', async (e) => {
        const r = e.target.closest('[data-remove]');
        if (r && await confirmDialog('移除管理員', `確定要移除 <span class="mono">${esc(r.dataset.remove)}</span> 的管理員權限嗎？`)) {
          try { await api(`/admins/${r.dataset.remove}`, { method: 'DELETE' }); toast('已移除管理員'); go('admins'); }
          catch (err) { toast(err.message, 'err'); }
        }
      });
    },

    async audit(panel) {
      const { entries } = await api('/audit?limit=200');
      panel.innerHTML = `
        <div class="panel">
          <div class="panel-head"><div><h2>操作紀錄</h2><p>最近 200 筆管理操作</p></div></div>
          <div class="card audit">${auditHtml(entries)}</div>
        </div>`;
    },
  };

  function showKey(key) {
    modal(`
      <h3>API Key 已建立</h3>
      <p class="muted" style="margin:0 0 14px">請立即複製並妥善保存。關閉視窗後將<b style="color:var(--gold-2)">無法再次查看</b>這把 Key。</p>
      <div class="key-reveal"><span style="flex:1">${esc(key)}</span></div>
      <div class="modal-actions"><button class="btn" id="copyKey">複製</button><button class="btn btn-gold" data-close>我已保存</button></div>`,
    (bg) => {
      $('#copyKey', bg).addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(key); e.target.textContent = '已複製 ✓'; } catch { toast('複製失敗，請手動選取', 'err'); }
      });
    });
    go('keys');
  }

  function playerForm(p) {
    const editing = !!p;
    let tier = p?.tier || 'LT5';
    modal(`
      <h3>${editing ? `編輯玩家 · ${esc(p.name)}` : '新增玩家'}</h3>
      <form id="playerForm">
        <div class="field"><label>Minecraft 名稱</label><input class="input" name="name" maxlength="16" value="${esc(p?.name || '')}" placeholder="例如：Steve" required></div>
        <div class="field"><label>UUID（選填）</label><input class="input mono" name="uuid" value="${esc(p?.uuid || '')}" placeholder="8667ba71-b85a-4004-af54-457a9734eed7"></div>
        <div class="field"><label>地區</label><select class="input" name="region">${REGIONS.map(([id, n]) => `<option value="${id}" ${(p?.region || 'AS') === id ? 'selected' : ''}>${id} · ${n}</option>`).join('')}</select></div>
        <div class="field"><label>Vanilla Tier</label><div class="tier-picker">${TIERS.map((t) => `<button type="button" data-t="${t}" class="${t === tier ? 'active' : ''}">${t}</button>`).join('')}</div></div>
        <label class="check"><input type="checkbox" name="retired" ${p?.retired ? 'checked' : ''}> 已退休（排行榜上會標示 R）</label>
        <div class="modal-actions"><button type="button" class="btn" data-close>取消</button><button class="btn btn-gold">${editing ? '儲存' : '新增'}</button></div>
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
        const body = { name: form.name.value.trim(), uuid: form.uuid.value.trim(), region: form.region.value, tier, retired: form.retired.checked };
        try {
          await api(editing ? `/players/${p.id}` : '/players', { method: editing ? 'PUT' : 'POST', body });
          close();
          toast(editing ? `已更新 ${body.name}` : `已新增 ${body.name}`);
          go('players');
        } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  // ---------- Boot ----------
  api('/me').then((data) => { me = data; renderShell(); }).catch(() => {});
});
