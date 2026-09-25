const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { TIER_POINTS } = require('./tiers');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'tierlist.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    uuid        TEXT,
    region      TEXT NOT NULL,
    tier        TEXT NOT NULL,
    retired     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    updated_by  TEXT
  );

  CREATE TABLE IF NOT EXISTS admins (
    discord_id    TEXT PRIMARY KEY,
    role          TEXT NOT NULL CHECK (role IN ('super', 'admin')),
    username      TEXT,
    avatar        TEXT,
    added_by      TEXT,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    prefix        TEXT NOT NULL,
    key_hash      TEXT NOT NULL UNIQUE,
    created_by    TEXT,
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER,
    usage_count   INTEGER NOT NULL DEFAULT 0,
    revoked       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id    TEXT,
    actor_name  TEXT,
    action      TEXT NOT NULL,
    detail      TEXT,
    created_at  INTEGER NOT NULL
  );
`);

// Seed admins. Config super admins are always forced to 'super'.
{
  const now = Date.now();
  const upsertSuper = db.prepare(`
    INSERT INTO admins (discord_id, role, added_by, created_at) VALUES (?, 'super', 'config', ?)
    ON CONFLICT(discord_id) DO UPDATE SET role = 'super'
  `);
  const insertAdmin = db.prepare(`
    INSERT OR IGNORE INTO admins (discord_id, role, added_by, created_at) VALUES (?, 'admin', 'config', ?)
  `);
  const seeded = db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'seed'`).get().n > 0;
  for (const id of config.superAdminIds) upsertSuper.run(id, now);
  if (!seeded) {
    for (const id of config.seedAdminIds) insertAdmin.run(id, now);
    db.prepare(`INSERT INTO audit_log (actor_name, action, detail, created_at) VALUES ('system', 'seed', 'Initial admins seeded', ?)`).run(now);
  }
}

function audit(actor, action, detail) {
  db.prepare(`INSERT INTO audit_log (actor_id, actor_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(actor?.id ?? null, actor?.username ?? 'system', action, detail ?? null, Date.now());
}

/** All players with points and competition-style rank (ties share a rank). */
function rankedPlayers() {
  const rows = db.prepare('SELECT * FROM players').all().map((p) => ({ ...p, points: TIER_POINTS[p.tier] ?? 0 }));
  rows.sort((a, b) => b.points - a.points || a.retired - b.retired || a.name.localeCompare(b.name));
  let rank = 0;
  rows.forEach((p, i) => {
    if (i === 0 || p.points !== rows[i - 1].points) rank = i + 1;
    p.rank = rank;
  });
  return rows;
}

function publicPlayer(p) {
  return {
    rank: p.rank,
    name: p.name,
    uuid: p.uuid || null,
    region: p.region,
    points: p.points,
    tiers: { vanilla: { tier: p.tier, points: p.points, retired: !!p.retired } },
    updatedAt: new Date(p.updated_at).toISOString(),
  };
}

function stats() {
  const players = rankedPlayers();
  return {
    players: players.length,
    tier1: players.filter((p) => p.tier === 'HT1' || p.tier === 'LT1').length,
    regions: new Set(players.map((p) => p.region)).size,
    modes: 1,
  };
}

module.exports = { db, audit, rankedPlayers, publicPlayer, stats };
