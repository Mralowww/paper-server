"""SQLite storage shared by the website and the Discord bot."""
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


# ---------------------------------------------------------------- generic helpers
def audit(conn, actor, action, detail=None):
    conn.execute("INSERT INTO audit_log (actor_id, actor_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                 (actor.get("id") if actor else None, actor.get("username") if actor else "system",
                  action, detail, now_ms()))


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
    """Stores a test result, updates the player's tier and totals, and starts the cooldown. Returns (player_id, test_id)."""
    ts = now_ms()
    row = None
    if uuid:
        row = conn.execute("SELECT * FROM players WHERE REPLACE(uuid, '-', '') = ?", (uuid.replace("-", ""),)).fetchone()
    if not row:
        row = conn.execute("SELECT * FROM players WHERE name = ?", (mc_name,)).fetchone()
    if not row:
        row = conn.execute("SELECT * FROM players WHERE discord_id = ?", (str(applicant_id),)).fetchone()
    if row:
        conn.execute("""UPDATE players SET name = ?, uuid = COALESCE(?, uuid), discord_id = ?, tier = ?, retired = 0,
                        wins = wins + ?, losses = losses + ?, updated_at = ?, updated_by = ? WHERE id = ?""",
                     (mc_name, uuid, str(applicant_id), new_tier, wins, losses, ts, tester["id"], row["id"]))
        player_id = row["id"]
    else:
        cur = conn.execute("""INSERT INTO players (name, uuid, region, tier, retired, discord_id, wins, losses,
                              created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)""",
                           (mc_name, uuid, C.DEFAULT_REGION, new_tier, str(applicant_id), wins, losses, ts, ts, tester["id"]))
        player_id = cur.lastrowid
    # One Discord account ↔ one player row.
    conn.execute("UPDATE players SET discord_id = NULL WHERE discord_id = ? AND id != ?", (str(applicant_id), player_id))
    cur = conn.execute("""INSERT INTO tests (player_id, discord_id, mc_name, tester_id, tester_name, prev_tier, new_tier,
                          wins, losses, channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (player_id, str(applicant_id), mc_name, tester["id"], tester["username"], prev_tier, new_tier,
                        wins, losses, str(channel_id), ts))
    test_id = cur.lastrowid
    until = ts + C.TEST_COOLDOWN_DAYS * 86400 * 1000
    conn.execute("INSERT INTO cooldowns (discord_id, until) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET until = excluded.until",
                 (str(applicant_id), until))
    conn.execute("UPDATE tickets SET status = 'tested', test_id = ? WHERE channel_id = ?", (test_id, str(channel_id)))
    audit(conn, tester, "test_result", f"{mc_name}: {prev_tier or 'Unranked'} → {new_tier} ({wins}-{losses})")
    return player_id, test_id
