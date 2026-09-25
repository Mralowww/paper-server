const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { db, audit, rankedPlayers, stats } = require('./db');
const { TIER_POINTS, REGION_IDS } = require('./tiers');
const { requireAdmin, requireSuper, sameOrigin } = require('./auth');
const { sha256, clampInt } = require('./util');

const router = express.Router();
router.use(sameOrigin, requireAdmin);

const NAME_RE = /^[A-Za-z0-9_]{2,16}$/;
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const DISCORD_ID_RE = /^\d{15,21}$/;

const bad = (res, message) => res.status(400).json({ error: 'bad_request', message });

router.get('/me', (req, res) => res.json(req.admin));

router.get('/overview', (req, res) => {
  const keys = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(usage_count), 0) AS calls FROM api_keys WHERE revoked = 0').get();
  const admins = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  const recent = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 8').all();
  res.json({ ...stats(), activeKeys: keys.n, apiCalls: keys.calls, admins, recent });
});

// ---------- Players ----------
function validatePlayer(body) {
  const name = String(body.name || '').trim();
  const uuid = String(body.uuid || '').trim() || null;
  const region = String(body.region || '').toUpperCase();
  const tier = String(body.tier || '').toUpperCase();
  if (!NAME_RE.test(name)) return { error: '玩家名稱需為 2–16 個英數字或底線' };
  if (uuid && !UUID_RE.test(uuid)) return { error: 'UUID 格式不正確' };
  if (!REGION_IDS.has(region)) return { error: '請選擇地區' };
  if (!(tier in TIER_POINTS)) return { error: '請選擇 Tier' };
  return { value: { name, uuid, region, tier, retired: body.retired ? 1 : 0 } };
}

router.get('/players', (req, res) => res.json({ players: rankedPlayers() }));

router.post('/players', (req, res) => {
  const { value, error } = validatePlayer(req.body || {});
  if (error) return bad(res, error);
  if (db.prepare('SELECT 1 FROM players WHERE name = ?').get(value.name)) return bad(res, '此玩家已存在');
  const now = Date.now();
  db.prepare('INSERT INTO players (name, uuid, region, tier, retired, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(value.name, value.uuid, value.region, value.tier, value.retired, now, now, req.admin.id);
  audit(req.admin, 'player_create', `${value.name} → ${value.tier} (${value.region})`);
  res.status(201).json({ ok: true });
});

router.put('/players/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const { value, error } = validatePlayer(req.body || {});
  if (error) return bad(res, error);
  const clash = db.prepare('SELECT id FROM players WHERE name = ? AND id != ?').get(value.name, existing.id);
  if (clash) return bad(res, '已有其他玩家使用這個名稱');
  db.prepare('UPDATE players SET name = ?, uuid = ?, region = ?, tier = ?, retired = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(value.name, value.uuid, value.region, value.tier, value.retired, Date.now(), req.admin.id, existing.id);
  const change = existing.tier !== value.tier ? `${existing.tier} → ${value.tier}` : 'details updated';
  audit(req.admin, 'player_update', `${value.name}: ${change}`);
  res.json({ ok: true });
});

router.delete('/players/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM players WHERE id = ?').run(existing.id);
  audit(req.admin, 'player_delete', existing.name);
  res.json({ ok: true });
});

// ---------- API keys ----------
router.get('/keys', (req, res) => {
  const keys = db.prepare(`
    SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.usage_count, k.revoked, k.created_by,
           a.username AS created_by_name
    FROM api_keys k LEFT JOIN admins a ON a.discord_id = k.created_by ORDER BY k.id DESC`).all();
  res.json({ keys });
});

router.post('/keys', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 48) return bad(res, '請輸入 1–48 字的名稱');
  const key = `mctl_${crypto.randomBytes(24).toString('base64url')}`;
  db.prepare('INSERT INTO api_keys (name, prefix, key_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, key.slice(0, 12), sha256(key), req.admin.id, Date.now());
  audit(req.admin, 'key_create', name);
  res.status(201).json({ key });
});

router.patch('/keys/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const revoked = req.body?.revoked ? 1 : 0;
  db.prepare('UPDATE api_keys SET revoked = ? WHERE id = ?').run(revoked, row.id);
  audit(req.admin, revoked ? 'key_revoke' : 'key_restore', row.name);
  res.json({ ok: true });
});

router.delete('/keys/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(row.id);
  audit(req.admin, 'key_delete', row.name);
  res.json({ ok: true });
});

// ---------- Admins ----------
router.get('/admins', (req, res) => {
  const admins = db.prepare('SELECT * FROM admins ORDER BY role DESC, created_at ASC').all()
    .map((a) => ({ ...a, protected: config.superAdminIds.includes(a.discord_id) }));
  res.json({ admins });
});

function guardTarget(req, res) {
  const id = String(req.params.id);
  if (config.superAdminIds.includes(id)) { bad(res, '此超級管理員由伺服器設定保護，無法在後台修改'); return false; }
  if (id === req.admin.id) { bad(res, '不能修改自己的權限'); return false; }
  return true;
}

router.post('/admins', requireSuper, (req, res) => {
  const id = String(req.body?.discordId || '').trim();
  const role = req.body?.role === 'super' ? 'super' : 'admin';
  if (!DISCORD_ID_RE.test(id)) return bad(res, 'Discord ID 格式不正確（15–21 位數字）');
  if (db.prepare('SELECT 1 FROM admins WHERE discord_id = ?').get(id)) return bad(res, '此使用者已是管理員');
  db.prepare('INSERT INTO admins (discord_id, role, added_by, created_at) VALUES (?, ?, ?, ?)').run(id, role, req.admin.id, Date.now());
  audit(req.admin, 'admin_add', `${id} (${role})`);
  res.status(201).json({ ok: true });
});

router.put('/admins/:id', requireSuper, (req, res) => {
  if (!guardTarget(req, res)) return;
  const row = db.prepare('SELECT * FROM admins WHERE discord_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const role = req.body?.role === 'super' ? 'super' : 'admin';
  db.prepare('UPDATE admins SET role = ? WHERE discord_id = ?').run(role, row.discord_id);
  audit(req.admin, 'admin_role', `${row.username || row.discord_id}: ${row.role} → ${role}`);
  res.json({ ok: true });
});

router.delete('/admins/:id', requireSuper, (req, res) => {
  if (!guardTarget(req, res)) return;
  const row = db.prepare('SELECT * FROM admins WHERE discord_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM admins WHERE discord_id = ?').run(row.discord_id);
  audit(req.admin, 'admin_remove', row.username || row.discord_id);
  res.json({ ok: true });
});

// ---------- Audit ----------
router.get('/audit', (req, res) => {
  const limit = clampInt(req.query.limit, 1, 200, 100);
  res.json({ entries: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) });
});

module.exports = router;
