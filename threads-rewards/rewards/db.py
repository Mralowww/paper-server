import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from . import config

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

DEFAULT_SETTINGS = {
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
CREATE TABLE IF NOT EXISTS settled_periods (period_start TEXT PRIMARY KEY, settled_at TEXT NOT NULL);
"""


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
