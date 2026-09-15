import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "tierlist.db"

TIERS = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE NOT NULL,
    discord_username TEXT NOT NULL,
    mc_uuid TEXT UNIQUE,
    mc_username TEXT,
    vanilla_tier TEXT,
    region TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verify_codes (
    code TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    discord_username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS admins (
    discord_id TEXT PRIMARY KEY
);
"""


@contextmanager
def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript(SCHEMA)


def upsert_verify_code(code: str, discord_id: str, discord_username: str, ttl_seconds: int = 600):
    now = int(time.time())
    with get_db() as conn:
        conn.execute("DELETE FROM verify_codes WHERE discord_id = ?", (discord_id,))
        conn.execute(
            "INSERT INTO verify_codes (code, discord_id, discord_username, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (code, discord_id, discord_username, now, now + ttl_seconds),
        )


def consume_verify_code(code: str):
    now = int(time.time())
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM verify_codes WHERE code = ? AND expires_at >= ?", (code, now)
        ).fetchone()
        if not row:
            return None
        conn.execute("DELETE FROM verify_codes WHERE code = ?", (code,))
        return dict(row)


def get_player_by_mc_uuid(mc_uuid: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM players WHERE mc_uuid = ?", (mc_uuid,)).fetchone()
        return dict(row) if row else None


def get_player_by_discord_id(discord_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM players WHERE discord_id = ?", (discord_id,)).fetchone()
        return dict(row) if row else None


def get_player_by_mc_username(mc_username: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM players WHERE mc_username = ? COLLATE NOCASE", (mc_username,)
        ).fetchone()
        return dict(row) if row else None


def bind_player(discord_id: str, discord_username: str, mc_uuid: str, mc_username: str):
    now = int(time.time())
    with get_db() as conn:
        existing_mc = conn.execute(
            "SELECT discord_id FROM players WHERE mc_uuid = ?", (mc_uuid,)
        ).fetchone()
        if existing_mc and existing_mc["discord_id"] != discord_id:
            return False, "mc_taken"

        existing_discord = conn.execute(
            "SELECT id FROM players WHERE discord_id = ?", (discord_id,)
        ).fetchone()
        if existing_discord:
            conn.execute(
                "UPDATE players SET mc_uuid = ?, mc_username = ?, discord_username = ?, updated_at = ? "
                "WHERE discord_id = ?",
                (mc_uuid, mc_username, discord_username, now, discord_id),
            )
        else:
            conn.execute(
                "INSERT INTO players (discord_id, discord_username, mc_uuid, mc_username, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (discord_id, discord_username, mc_uuid, mc_username, now, now),
            )
        return True, "ok"


def set_tier(mc_username: str, tier: str | None, region: str | None = None):
    if tier is not None and tier not in TIERS:
        raise ValueError("invalid tier")
    now = int(time.time())
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE players SET vanilla_tier = ?, region = COALESCE(?, region), updated_at = ? "
            "WHERE mc_username = ? COLLATE NOCASE",
            (tier, region, now, mc_username),
        )
        return cur.rowcount > 0


def list_ranked_players():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM players WHERE vanilla_tier IS NOT NULL "
            "ORDER BY CASE vanilla_tier "
            + " ".join(f"WHEN '{t}' THEN {i}" for i, t in enumerate(TIERS))
            + " END, mc_username COLLATE NOCASE"
        ).fetchall()
        return [dict(r) for r in rows]


def list_all_players():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM players ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


def is_admin(discord_id: str) -> bool:
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM admins WHERE discord_id = ?", (discord_id,)).fetchone()
        return row is not None


def create_api_key(key: str, label: str):
    now = int(time.time())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO api_keys (key, label, created_at) VALUES (?, ?, ?)", (key, label, now)
        )


def revoke_api_key(key: str):
    with get_db() as conn:
        conn.execute("UPDATE api_keys SET revoked = 1 WHERE key = ?", (key,))


def list_api_keys():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM api_keys ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


def check_api_key(key: str) -> bool:
    now = int(time.time())
    with get_db() as conn:
        row = conn.execute(
            "SELECT key FROM api_keys WHERE key = ? AND revoked = 0", (key,)
        ).fetchone()
        if not row:
            return False
        conn.execute("UPDATE api_keys SET last_used_at = ? WHERE key = ?", (now, key))
        return True
