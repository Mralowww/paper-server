"""SQLite storage shared by the website and the Discord bot."""
import contextvars
import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config as C

C.DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = C.DATA_DIR / "tierlist.db"

SCHEMA = """
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
CREATE TABLE IF NOT EXISTS members (
  discord_id  TEXT PRIMARY KEY,
  username    TEXT,
  avatar      TEXT,
  roles       TEXT NOT NULL DEFAULT '[]',
  in_guild    INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  channel_id    TEXT PRIMARY KEY,
  applicant_id  TEXT NOT NULL,
  mc_name       TEXT NOT NULL,
  uuid          TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('normal', 'high')),
  prev_tier     TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  test_id       INTEGER,
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER,
  closed_by     TEXT
);
CREATE TABLE IF NOT EXISTS tests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    INTEGER,
  discord_id   TEXT,
  mc_name      TEXT NOT NULL,
  tester_id    TEXT NOT NULL,
  tester_name  TEXT,
  prev_tier    TEXT,
  new_tier     TEXT NOT NULL,
  wins         INTEGER NOT NULL,
  losses       INTEGER NOT NULL,
  channel_id   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cooldowns (
  discord_id  TEXT PRIMARY KEY,
  until       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  mc_name          TEXT NOT NULL,
  uuid             TEXT,
  discord_id       TEXT,
  reason           TEXT NOT NULL,
  created_by       TEXT,
  created_by_name  TEXT,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER,
  revoked_at       INTEGER,
  revoked_by_name  TEXT
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT NOT NULL,
  username          TEXT,
  category          TEXT NOT NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS support_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL,
  author_name TEXT,
  is_staff    INTEGER NOT NULL DEFAULT 0,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS support_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id  INTEGER NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL,
  orig_name   TEXT,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS support_blocks (
  discord_id  TEXT PRIMARY KEY,
  reason      TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  usage_count   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mc_links (
  discord_id  TEXT PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  mc_name     TEXT NOT NULL,
  linked_at   INTEGER NOT NULL,
  checked_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS link_codes (
  code        TEXT PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  mc_name     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gs_players (
  uuid          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kills         INTEGER NOT NULL DEFAULT 0,
  deaths        INTEGER NOT NULL DEFAULT 0,
  pvp_deaths    INTEGER NOT NULL DEFAULT 0,
  crystal_kills INTEGER NOT NULL DEFAULT 0,
  anchor_kills  INTEGER NOT NULL DEFAULT 0,
  melee_kills   INTEGER NOT NULL DEFAULT 0,
  other_kills   INTEGER NOT NULL DEFAULT 0,
  totem_pops    INTEGER NOT NULL DEFAULT 0,
  cur_streak    INTEGER NOT NULL DEFAULT 0,
  best_streak   INTEGER NOT NULL DEFAULT 0,
  matches       INTEGER NOT NULL DEFAULT 0,
  match_wins    INTEGER NOT NULL DEFAULT 0,
  match_losses  INTEGER NOT NULL DEFAULT 0,
  match_draws   INTEGER NOT NULL DEFAULT 0,
  playtime_ms   INTEGER NOT NULL DEFAULT 0,
  online        INTEGER NOT NULL DEFAULT 0,
  world         TEXT,
  session_start INTEGER,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gs_world_stats (
  uuid     TEXT NOT NULL,
  world    TEXT NOT NULL,
  kills    INTEGER NOT NULL DEFAULT 0,
  deaths   INTEGER NOT NULL DEFAULT 0,
  matches  INTEGER NOT NULL DEFAULT 0,
  wins     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uuid, world)
);
CREATE TABLE IF NOT EXISTS gs_kills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  killer_uuid   TEXT,
  killer_name   TEXT,
  victim_uuid   TEXT NOT NULL,
  victim_name   TEXT NOT NULL,
  world         TEXT NOT NULL,
  cause         TEXT NOT NULL,
  killer_health REAL,
  victim_pops   INTEGER NOT NULL DEFAULT 0,
  match_id      INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gs_matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  p1_uuid     TEXT NOT NULL,
  p1_name     TEXT NOT NULL,
  p2_uuid     TEXT NOT NULL,
  p2_name     TEXT NOT NULL,
  world       TEXT NOT NULL,
  p1_score    INTEGER NOT NULL DEFAULT 0,
  p2_score    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'live',
  winner_uuid TEXT,
  end_reason  TEXT,
  started_at  INTEGER NOT NULL,
  last_kill_at INTEGER NOT NULL,
  ended_at    INTEGER
);
CREATE TABLE IF NOT EXISTS gs_names (
  uuid        TEXT NOT NULL,
  name        TEXT NOT NULL,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  PRIMARY KEY (uuid, name)
);
CREATE TABLE IF NOT EXISTS gs_coreplus (
  uuid         TEXT PRIMARY KEY,
  name         TEXT,
  stats        TEXT NOT NULL DEFAULT '{}',
  achievements TEXT NOT NULL DEFAULT '[]',
  login_streak INTEGER NOT NULL DEFAULT 0,
  synced_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
"""

# Columns added after the first release.
MIGRATIONS = [
    ("players", "discord_id", "TEXT"),
    ("players", "wins", "INTEGER NOT NULL DEFAULT 0"),
    ("players", "losses", "INTEGER NOT NULL DEFAULT 0"),
    # Last known roles while in the guild; survives leaving so /roleup can restore them.
    ("members", "saved_roles", "TEXT NOT NULL DEFAULT '[]'"),
    # 'read' = developer API key, 'server' = the official Minecraft server plugin.
    ("api_keys", "scope", "TEXT NOT NULL DEFAULT 'read'"),
    # Detailed audit trail: where it came from, what it touched, and what changed.
    ("audit_log", "source", "TEXT"),
    ("audit_log", "ip", "TEXT"),
    ("audit_log", "user_agent", "TEXT"),
    ("audit_log", "target_type", "TEXT"),
    ("audit_log", "target_id", "TEXT"),
    ("audit_log", "target_name", "TEXT"),
    ("audit_log", "changes", "TEXT"),
    ("audit_log", "meta", "TEXT"),
]


def now_ms():
    return int(time.time() * 1000)


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


@contextmanager
def transaction():
    """Short-lived connection that commits on success and is always closed."""
    conn = connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init():
    with transaction() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        for table, column, decl in MIGRATIONS:
            cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if column not in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        conn.execute("CREATE INDEX IF NOT EXISTS players_discord ON players (discord_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS tests_tester ON tests (tester_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS tests_discord ON tests (discord_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS bans_active ON bans (revoked_at, expires_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS support_user ON support_tickets (user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS support_msg_ticket ON support_messages (ticket_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS gs_kills_killer ON gs_kills (killer_uuid, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS gs_kills_victim ON gs_kills (victim_uuid, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS gs_matches_p1 ON gs_matches (p1_uuid, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS gs_matches_p2 ON gs_matches (p2_uuid, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS gs_matches_live ON gs_matches (status, last_kill_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS gs_players_name ON gs_players (name COLLATE NOCASE)")
        conn.execute("CREATE INDEX IF NOT EXISTS audit_actor ON audit_log (actor_id, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS audit_action ON audit_log (action, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS audit_target ON audit_log (target_type, target_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS audit_time ON audit_log (created_at)")


# ---------------------------------------------------------------- generic helpers
# Request context set by the website for the current thread (source, IP, user agent, request data).
AUDIT_CTX = contextvars.ContextVar("audit_ctx", default=None)


def diff(before, after, fields=None):
    """{field: [old, new]} for fields whose value changed."""
    before, after = before or {}, after or {}
    keys = fields or sorted(set(before) | set(after))
    return {k: [before.get(k), after.get(k)] for k in keys if before.get(k) != after.get(k)}


def flatten(value, prefix=""):
    """{"a": {"b": 1}} → {"a.b": 1}; lists of dicts are keyed by position."""
    out = {}
    items = value.items() if isinstance(value, dict) else enumerate(value) if isinstance(value, list) else None
    if items is None:
        return {prefix: value}
    for k, v in items:
        key = f"{prefix}.{k}" if prefix else str(k)
        if isinstance(v, (dict, list)) and v:
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out


def audit(conn, actor, action, detail=None, *, target=None, changes=None, meta=None, source=None):
    """Writes an audit entry.

    target  = (type, id, name) of what was acted on, e.g. ("player", 12, "Steve")
    changes = {field: [before, after]}
    meta    = any extra JSON-able data (merged with the request/interaction context)
    """
    ctx = AUDIT_CTX.get() or {}
    actor_id = actor.get("id") if actor else None
    source = source or ctx.get("source") or ("discord" if actor_id else "system")
    info = {k: v for k, v in ctx.items() if k not in ("source", "ip", "ua")}
    if meta:
        info.update(meta)
    t_type, t_id, t_name = (list(target) + [None, None, None])[:3] if target else (None, None, None)
    conn.execute("""INSERT INTO audit_log (actor_id, actor_name, action, detail, created_at, source, ip, user_agent,
                    target_type, target_id, target_name, changes, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                 (actor_id, actor.get("username") if actor else "system", action, detail, now_ms(), source,
                  ctx.get("ip"), ctx.get("ua"), t_type, None if t_id is None else str(t_id), t_name,
                  json.dumps(changes, ensure_ascii=False, default=str) if changes else None,
                  json.dumps(info, ensure_ascii=False, default=str) if info else None))


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (key, None if value is None else str(value)))


def upsert_member(conn, discord_id, username, avatar, roles, in_guild=True, save=True):
    """Stores current roles; with save=True they also become the snapshot /roleup restores from."""
    roles_json = json.dumps([str(r) for r in roles])
    conn.execute("""
        INSERT INTO members (discord_id, username, avatar, roles, saved_roles, in_guild, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET username = COALESCE(excluded.username, members.username),
          avatar = excluded.avatar, roles = excluded.roles, in_guild = excluded.in_guild, updated_at = excluded.updated_at,
          saved_roles = CASE WHEN ? THEN excluded.saved_roles ELSE members.saved_roles END
    """, (str(discord_id), username, avatar, roles_json, roles_json if save else "[]", 1 if in_guild else 0, now_ms(),
          1 if save else 0))


def member(conn, discord_id):
    row = conn.execute("SELECT * FROM members WHERE discord_id = ?", (str(discord_id),)).fetchone()
    if not row:
        return None
    m = dict(row)
    m["roles"] = json.loads(m["roles"])
    m["saved_roles"] = json.loads(m.get("saved_roles") or "[]")
    return m


def cooldown_until(conn, discord_id):
    row = conn.execute("SELECT until FROM cooldowns WHERE discord_id = ?", (str(discord_id),)).fetchone()
    return row["until"] if row and row["until"] > now_ms() else None


# ---------------------------------------------------------------- bans
ACTIVE_BAN_SQL = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)"


def active_bans(conn):
    return [dict(r) for r in conn.execute(f"SELECT * FROM bans WHERE {ACTIVE_BAN_SQL} ORDER BY id DESC", (now_ms(),))]


def find_active_ban(conn, discord_id=None, name=None, uuid=None):
    """The active ban matching any of the given identities, or None."""
    clauses, args = [], []
    if discord_id:
        clauses.append("discord_id = ?")
        args.append(str(discord_id))
    if name:
        clauses.append("mc_name = ? COLLATE NOCASE")
        args.append(name)
    if uuid:
        clauses.append("REPLACE(uuid, '-', '') = ?")
        args.append(uuid.replace("-", "").lower())
    if not clauses:
        return None
    row = conn.execute(f"SELECT * FROM bans WHERE {ACTIVE_BAN_SQL} AND ({' OR '.join(clauses)}) ORDER BY id DESC LIMIT 1",
                       (now_ms(), *args)).fetchone()
    return dict(row) if row else None


def banned_keys(conn):
    """(names, uuids, discord ids) with an active ban — for flagging players in bulk."""
    names, uuids, ids = set(), set(), set()
    for b in active_bans(conn):
        names.add(b["mc_name"].lower())
        if b["uuid"]:
            uuids.add(b["uuid"].replace("-", "").lower())
        if b["discord_id"]:
            ids.add(b["discord_id"])
    return names, uuids, ids


# ---------------------------------------------------------------- players
def ranked_players(conn):
    """All players with points and competition-style rank (ties share a rank)."""
    rows = [dict(r) for r in conn.execute("""
        SELECT p.*, m.roles AS member_roles FROM players p
        LEFT JOIN members m ON m.discord_id = p.discord_id AND m.in_guild = 1""").fetchall()]
    for p in rows:
        p["points"] = C.TIER_POINTS.get(p["tier"], 0)
        roles = {int(r) for r in json.loads(p.pop("member_roles") or "[]")}
        p["badges"] = [name for rid, name in C.BADGE_ROLES.items() if rid in roles]
    names, uuids, ids = banned_keys(conn)
    for p in rows:
        p["banned"] = (p["name"].lower() in names or (p["uuid"] or "").replace("-", "").lower() in uuids
                       or (p["discord_id"] or "") in ids)
    rows.sort(key=lambda p: (-p["points"], p["retired"], p["name"].lower()))
    rank = 0
    for i, p in enumerate(rows):
        if i == 0 or p["points"] != rows[i - 1]["points"]:
            rank = i + 1
        p["rank"] = rank
    return rows


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def public_player(p, detailed=False):
    out = {
        "rank": p["rank"],
        "name": p["name"],
        "uuid": p["uuid"] or None,
        "region": p["region"],
        "points": p["points"],
        "title": C.title_for(p["points"]),
        "badges": p["badges"],
        "banned": p["banned"],
        "tiers": {"vanilla": {"tier": p["tier"], "points": p["points"], "retired": bool(p["retired"])}},
        "updatedAt": iso(p["updated_at"]),
    }
    if detailed:
        out["stats"] = {"wins": p["wins"], "losses": p["losses"]}
    return out


def site_stats(conn):
    players = ranked_players(conn)
    return {
        "players": len(players),
        "tier1": sum(1 for p in players if p["tier"] in ("HT1", "LT1")),
        "tier2": sum(1 for p in players if p["tier"] in ("HT2", "LT2")),
        "regions": len({p["region"] for p in players}),
        "modes": 1,
        "tests": conn.execute("SELECT COUNT(*) FROM tests").fetchone()[0],
    }


def record_test(conn, *, applicant_id, mc_name, uuid, tester, prev_tier, new_tier, wins, losses, channel_id):
    """Stores a test result, updates the player's tier and totals, and starts the cooldown. Returns (player_id, test_id).

    applicant_id may be None for results given from the website to a player without a linked Discord account;
    channel_id is None for results that did not come from a ticket.
    """
    ts = now_ms()
    did = str(applicant_id) if applicant_id else None
    row = None
    if uuid:
        row = conn.execute("SELECT * FROM players WHERE REPLACE(uuid, '-', '') = ?", (uuid.replace("-", ""),)).fetchone()
    if not row:
        row = conn.execute("SELECT * FROM players WHERE name = ?", (mc_name,)).fetchone()
    if not row and did:
        row = conn.execute("SELECT * FROM players WHERE discord_id = ?", (did,)).fetchone()
    if row:
        conn.execute("""UPDATE players SET name = ?, uuid = COALESCE(?, uuid), discord_id = COALESCE(?, discord_id), tier = ?,
                        retired = 0, wins = wins + ?, losses = losses + ?, updated_at = ?, updated_by = ? WHERE id = ?""",
                     (mc_name, uuid, did, new_tier, wins, losses, ts, tester["id"], row["id"]))
        player_id = row["id"]
    else:
        cur = conn.execute("""INSERT INTO players (name, uuid, region, tier, retired, discord_id, wins, losses,
                              created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)""",
                           (mc_name, uuid, C.DEFAULT_REGION, new_tier, did, wins, losses, ts, ts, tester["id"]))
        player_id = cur.lastrowid
    if did:
        # One Discord account ↔ one player row.
        conn.execute("UPDATE players SET discord_id = NULL WHERE discord_id = ? AND id != ?", (did, player_id))
        until = ts + C.TEST_COOLDOWN_DAYS * 86400 * 1000
        conn.execute("INSERT INTO cooldowns (discord_id, until) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET until = excluded.until",
                     (did, until))
    cur = conn.execute("""INSERT INTO tests (player_id, discord_id, mc_name, tester_id, tester_name, prev_tier, new_tier,
                          wins, losses, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (player_id, did, mc_name, tester["id"], tester["username"], prev_tier, new_tier,
                        wins, losses, str(channel_id) if channel_id else "web", ts))
    test_id = cur.lastrowid
    if channel_id:
        conn.execute("UPDATE tickets SET status = 'tested', test_id = ? WHERE channel_id = ?", (test_id, str(channel_id)))
    audit(conn, tester, "test_result", f"{mc_name}: {prev_tier or 'Unranked'} → {new_tier} ({wins}-{losses})",
          target=("player", player_id, mc_name), changes={"tier": [prev_tier, new_tier]},
          meta={"test": {"id": test_id, "wins": wins, "losses": losses, "applicant": did, "channel": channel_id and str(channel_id),
                         "uuid": uuid}})
    return player_id, test_id
