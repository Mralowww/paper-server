import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "tierlist.db"

TIERS = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"]

# 目前段位是 HT3 或更好(HT1/LT1/HT2/LT2/HT3)算高階測試,30 天冷卻
# 其餘(LT3 以下)或尚未評級算普通測試,7 天冷卻
ADVANCED_TIERS = set(TIERS[: TIERS.index("HT3") + 1])
NORMAL_TEST_COOLDOWN_SECONDS = 7 * 24 * 3600
ADVANCED_TEST_COOLDOWN_SECONDS = 30 * 24 * 3600

TEST_TYPE_NORMAL = "normal"
TEST_TYPE_ADVANCED = "advanced"

TICKET_STATUS_OPEN = "open"
TICKET_STATUS_CLOSED = "closed"

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE NOT NULL,
    discord_username TEXT NOT NULL,
    mc_uuid TEXT UNIQUE,
    mc_username TEXT,
    vanilla_tier TEXT,
    region TEXT,
    last_test_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT UNIQUE NOT NULL,
    discord_id TEXT NOT NULL,
    discord_username TEXT NOT NULL,
    mc_uuid TEXT,
    mc_username TEXT,
    test_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER,
    discord_id TEXT NOT NULL,
    mc_uuid TEXT,
    mc_username TEXT NOT NULL,
    examiner_discord_id TEXT NOT NULL,
    examiner_username TEXT NOT NULL,
    region TEXT,
    game_name TEXT,
    score_wins INTEGER NOT NULL,
    score_losses INTEGER NOT NULL,
    tier_before TEXT,
    tier_after TEXT NOT NULL,
    test_type TEXT NOT NULL,
    created_at INTEGER NOT NULL
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


def get_player_by_id(player_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM players WHERE id = ?", (player_id,)).fetchone()
        return dict(row) if row else None


def update_player(player_id: int, mc_username: str | None = None, region: str | None = None,
                   tier: str | None = "__unset__"):
    """管理員直接編輯玩家資料。mc_username/region 為 None 表示不變更;
    tier 用 "__unset__" 當『不變更』的哨兵值,因為 None 本身是合法的『清除段位』。"""
    if tier != "__unset__" and tier is not None and tier not in TIERS:
        raise ValueError("invalid tier")

    now = int(time.time())
    with get_db() as conn:
        row = conn.execute("SELECT * FROM players WHERE id = ?", (player_id,)).fetchone()
        if not row:
            return False

        new_mc_username = mc_username if mc_username is not None else row["mc_username"]
        new_region = region if region is not None else row["region"]
        new_tier = row["vanilla_tier"] if tier == "__unset__" else tier

        conn.execute(
            "UPDATE players SET mc_username = ?, region = ?, vanilla_tier = ?, updated_at = ? WHERE id = ?",
            (new_mc_username, new_region, new_tier, now, player_id),
        )
        return True


def delete_player(player_id: int):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM players WHERE id = ?", (player_id,))
        return cur.rowcount > 0


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


# ---------- 測試 (Testing) ----------

def required_test_type(current_tier: str | None) -> str:
    """依照玩家『目前』段位判斷這次要考的是普通測試還是高階測試。"""
    if current_tier and current_tier in ADVANCED_TIERS:
        return TEST_TYPE_ADVANCED
    return TEST_TYPE_NORMAL


def cooldown_seconds_for(test_type: str) -> int:
    return ADVANCED_TEST_COOLDOWN_SECONDS if test_type == TEST_TYPE_ADVANCED else NORMAL_TEST_COOLDOWN_SECONDS


def check_test_cooldown(discord_id: str):
    """回傳 (可以測試: bool, 剩餘秒數: int, 這次要考的類型: str)。"""
    player = get_player_by_discord_id(discord_id)
    current_tier = player.get("vanilla_tier") if player else None
    test_type = required_test_type(current_tier)

    if not player or not player.get("last_test_at"):
        return True, 0, test_type

    elapsed = int(time.time()) - player["last_test_at"]
    remaining = cooldown_seconds_for(test_type) - elapsed
    if remaining <= 0:
        return True, 0, test_type
    return False, remaining, test_type


def create_ticket(channel_id: str, discord_id: str, discord_username: str, mc_uuid: str | None,
                   mc_username: str | None, test_type: str):
    now = int(time.time())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tickets (channel_id, discord_id, discord_username, mc_uuid, mc_username, "
            "test_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
            (channel_id, discord_id, discord_username, mc_uuid, mc_username, test_type, now),
        )


def get_open_ticket_by_channel(channel_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'", (channel_id,)
        ).fetchone()
        return dict(row) if row else None


def get_open_ticket_by_discord_id(discord_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM tickets WHERE discord_id = ? AND status = 'open'", (discord_id,)
        ).fetchone()
        return dict(row) if row else None


def close_ticket(channel_id: str):
    now = int(time.time())
    with get_db() as conn:
        conn.execute(
            "UPDATE tickets SET status = 'closed', closed_at = ? WHERE channel_id = ?",
            (now, channel_id),
        )


def record_test_result(*, ticket_id: int | None, discord_id: str, mc_uuid: str | None, mc_username: str,
                        examiner_discord_id: str, examiner_username: str, region: str, game_name: str,
                        score_wins: int, score_losses: int, tier_before: str | None, tier_after: str,
                        test_type: str):
    if tier_after not in TIERS:
        raise ValueError("invalid tier")
    now = int(time.time())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO test_results (ticket_id, discord_id, mc_uuid, mc_username, examiner_discord_id, "
            "examiner_username, region, game_name, score_wins, score_losses, tier_before, tier_after, "
            "test_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ticket_id, discord_id, mc_uuid, mc_username, examiner_discord_id, examiner_username,
             region, game_name, score_wins, score_losses, tier_before, tier_after, test_type, now),
        )

        existing = conn.execute(
            "SELECT id FROM players WHERE discord_id = ?", (discord_id,)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE players SET vanilla_tier = ?, region = COALESCE(?, region), "
                "last_test_at = ?, updated_at = ? WHERE discord_id = ?",
                (tier_after, region, now, now, discord_id),
            )


def tier_display_name(tier: str | None) -> str:
    if not tier:
        return "未評級"
    prefix = "High" if tier.startswith("H") else "Low"
    number = tier[2:]
    return f"{prefix} Tier {number}"


def list_test_results(limit: int = 50):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM test_results ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
