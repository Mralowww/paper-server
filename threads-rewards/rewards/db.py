import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from . import config

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

DEFAULT_SETTINGS = {
    "maintenance": "", "vapid_private_pem": "",
    "w_views": "1",
    "w_likes": "10",
    "w_replies": "15",
    "w_reposts": "20",
    "settle_weekday": "0",  # 0 = 週一
    "settle_hour": "0",
    "announcement": "",
    "reward_1": "",
    "reward_2": "",
    "reward_3": "",
    "server_address": "sawsmp.me",
    "discord_invite": "",
    "rules": "",
    "warn_threshold": "3",        # 累積幾次有效警告後自動限時封鎖（0 = 關閉）
    "warn_ban_hours": "24",
    "plugin_api_key": "",
    "ticket_channel_id": "",
    "announce_channel_id": "",
    "punish_log_channel_id": "",
    "discord_ban_role": "",
    "discord_mute_role": "",
    "discord_linked_role": "",
    "reason_presets": "使用外掛\n辱罵他人\n洗頻\n利用 Bug\n惡意破壞\n使用小號規避處罰",
    "violation_types": "外掛 / 作弊\n辱罵 / 騷擾\n惡意破壞\n洗頻 / 廣告\n利用漏洞\n其他",
    "canned_replies": "你好，我們已經收到你的回報，正在處理中，請耐心等候。\n可以提供更多細節或截圖嗎？\n已處理完畢，感謝你的回報！\n此問題已轉交相關人員處理。",
    "match_enabled": "1",
    "match_time_limit": "60",
    "rank_tiers": "0:戰鬥新手\n50:熟練戰士\n150:精英鬥士\n400:戰場大師\n1000:傳奇",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    global_name TEXT,
    avatar TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login TEXT
);
CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    url TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL,
    author TEXT,
    content TEXT,
    likes INTEGER NOT NULL DEFAULT 0,
    replies INTEGER NOT NULL DEFAULT 0,
    reposts INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    last_error TEXT,
    last_scraped TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at);
CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);
CREATE TABLE IF NOT EXISTS snapshots (
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    likes INTEGER, replies INTEGER, reposts INTEGER, views INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS weekly_results (
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    rank INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    score REAL NOT NULL,
    link_count INTEGER NOT NULL,
    PRIMARY KEY (period_start, rank)
);
CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tag TEXT NOT NULL DEFAULT 'news',
    pinned INTEGER NOT NULL DEFAULT 0,
    author_id TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS link_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
    uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_seen TEXT,
    last_seen TEXT,
    last_ip TEXT,
    online INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS player_ips (
    uuid TEXT NOT NULL,
    ip TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (uuid, ip)
);
CREATE INDEX IF NOT EXISTS idx_player_ips_ip ON player_ips(ip);
CREATE TABLE IF NOT EXISTS punishments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,              -- ban / mute / warn / kick / ipban
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    ip TEXT,
    reason TEXT NOT NULL,
    staff_id TEXT,
    staff_name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',   -- web / game / auto
    created_at TEXT NOT NULL,
    expires_at TEXT,                      -- NULL = 永久
    active INTEGER NOT NULL DEFAULT 1,
    revoked_by TEXT,
    revoked_at TEXT,
    revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pun_uuid ON punishments(uuid);
CREATE INDEX IF NOT EXISTS idx_pun_active ON punishments(active, type);
CREATE TABLE IF NOT EXISTS plugin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    done_at TEXT
);
CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open / answered / closed
    urgent INTEGER NOT NULL DEFAULT 0,
    target TEXT,                            -- 檢舉對象玩家名稱
    punishment_id INTEGER,                  -- 申訴的懲處
    claimed_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, updated_at);
CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT,
    body TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    staff INTEGER NOT NULL DEFAULT 0,
    internal INTEGER NOT NULL DEFAULT 0,
    system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tmsg_ticket ON ticket_messages(ticket_id, id);
CREATE TABLE IF NOT EXISTS ticket_reads (
    user_id TEXT NOT NULL,
    ticket_id INTEGER NOT NULL,
    last_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, ticket_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    actor_name TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS player_stats (
    uuid TEXT PRIMARY KEY,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    playtime INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS kill_methods (
    uuid TEXT NOT NULL,
    method TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (uuid, method)
);
CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    winner_uuid TEXT NOT NULL, winner_name TEXT NOT NULL,
    loser_uuid TEXT NOT NULL, loser_name TEXT NOT NULL,
    winner_score INTEGER NOT NULL DEFAULT 1, loser_score INTEGER NOT NULL DEFAULT 0,
    world TEXT, method TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_w ON matches(winner_uuid, id);
CREATE INDEX IF NOT EXISTS idx_matches_l ON matches(loser_uuid, id);
CREATE TABLE IF NOT EXISTS perm_nodes (
    group_key TEXT NOT NULL,          -- all / linked / level:1..3 / role:<discord role id>
    node TEXT NOT NULL,
    allow INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (group_key, node)
);
CREATE TABLE IF NOT EXISTS perm_groups (group_key TEXT PRIMARY KEY, name TEXT, color TEXT);
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used TEXT,
    uses INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS player_names (
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    PRIMARY KEY (uuid, name)
);
CREATE TABLE IF NOT EXISTS match_queue (
    uuid TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    joined_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settled_periods (period_start TEXT PRIMARY KEY, settled_at TEXT NOT NULL);
"""


def _migrate(c: sqlite3.Connection) -> None:
    cols = {r[1] for r in c.execute("PRAGMA table_info(users)")}
    for name, ddl in (("level", "INTEGER NOT NULL DEFAULT 0"), ("mc_uuid", "TEXT"), ("mc_name", "TEXT"),
                      ("linked_at", "TEXT")):
        if name not in cols:
            c.execute(f"ALTER TABLE users ADD COLUMN {name} {ddl}")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_mc ON users(mc_uuid) WHERE mc_uuid IS NOT NULL")
    extra = {"users": [("ticket_banned", "INTEGER NOT NULL DEFAULT 0")],
             "punishments": [("silent", "INTEGER NOT NULL DEFAULT 0"), ("discord_sync", "INTEGER NOT NULL DEFAULT 0")],
             "tickets": [("priority", "TEXT NOT NULL DEFAULT 'normal'"), ("fields", "TEXT NOT NULL DEFAULT '{}'")],
             "matches": [("status", "TEXT NOT NULL DEFAULT 'finished'"), ("reason", "TEXT"), ("draw", "INTEGER NOT NULL DEFAULT 0"),
                         ("started_at", "TEXT"), ("ended_at", "TEXT")]}
    for table, columns in extra.items():
        have = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
        for name, ddl in columns:
            if name not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def audit(actor: dict | None, action: str, detail: str, **extra) -> int:
    """寫入操作紀錄；extra 可帶 target / before / after / meta / category（詳見 activity.write）。"""
    from . import activity
    return activity.write(actor, action, detail, **extra)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(config.DATABASE_PATH) or ".", exist_ok=True)
        _conn = sqlite3.connect(config.DATABASE_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
        _conn.executescript(SCHEMA)
        _migrate(_conn)
        for k, v in DEFAULT_SETTINGS.items():
            _conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))
        _conn.commit()
    return _conn


def query(sql: str, params: tuple = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in conn().execute(sql, params).fetchall()]


def one(sql: str, params: tuple = ()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: tuple = ()) -> int:
    with _lock:
        cur = conn().execute(sql, params)
        conn().commit()
        return cur.lastrowid


# ---------- settings ----------

def settings() -> dict[str, str]:
    return {r["key"]: r["value"] for r in query("SELECT key, value FROM settings")}


def set_settings(values: dict[str, str]) -> None:
    with _lock:
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                conn().execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (k, str(v)))
        conn().commit()


def weights() -> dict[str, float]:
    s = settings()
    return {m: float(s.get(f"w_{m}", "0") or 0) for m in ("views", "likes", "replies", "reposts")}


# ---------- periods ----------

def period_bounds(at: datetime | None = None) -> tuple[datetime, datetime]:
    """回傳 `at` 所在的統計週期 [start, end)，以後台設定的結算星期與小時為分界（本地時區）。"""
    s = settings()
    weekday, hour = int(s["settle_weekday"]), int(s["settle_hour"])
    local = (at or now_utc()).astimezone(config.TIMEZONE)
    start = local.replace(hour=hour, minute=0, second=0, microsecond=0)
    start -= timedelta(days=(local.weekday() - weekday) % 7)
    if start > local:
        start -= timedelta(days=7)
    return start, start + timedelta(days=7)


def score_sql(w: dict[str, float]) -> str:
    return (f"(l.views*{w['views']} + l.likes*{w['likes']} + "
            f"l.replies*{w['replies']} + l.reposts*{w['reposts']})")


def leaderboard(start: datetime, end: datetime, limit: int = 50) -> list[dict]:
    w = weights()
    return query(
        f"""SELECT u.id, u.username, u.global_name, u.avatar,
                   SUM({score_sql(w)}) AS score, COUNT(l.id) AS link_count,
                   SUM(l.views) AS views, SUM(l.likes) AS likes,
                   SUM(l.replies) AS replies, SUM(l.reposts) AS reposts
            FROM links l JOIN users u ON u.id = l.user_id
            WHERE l.status = 'active' AND u.banned = 0 AND l.created_at >= ? AND l.created_at < ?
            GROUP BY u.id ORDER BY score DESC, link_count DESC LIMIT ?""",
        (iso(start), iso(end), limit),
    )
