"""每週排行：每週一 00:00（台灣時間）記錄一次所有玩家的戰績基準點，本週數據 = 目前戰績 − 本週基準。

週結束時把每位玩家當週的增加量封存到 week_stats，之後可隨時查看過去每一週的排名。
"""
import logging
from datetime import datetime, timedelta, timezone

from . import db

log = logging.getLogger("rewards.weekly")
TW = timezone(timedelta(hours=8))
FIELDS = ("kills", "deaths", "wins", "losses", "playtime")
SCHEMA = """
CREATE TABLE IF NOT EXISTS week_base (
    week TEXT NOT NULL, uuid TEXT NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0, playtime INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (week, uuid)
);
CREATE TABLE IF NOT EXISTS week_stats (
    week TEXT NOT NULL, uuid TEXT NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0, playtime INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (week, uuid)
);
CREATE TABLE IF NOT EXISTS weeks (week TEXT PRIMARY KEY, archived_at TEXT, champion TEXT, players INTEGER NOT NULL DEFAULT 0);
"""
_ready = False


def ensure_schema() -> None:
    global _ready
    if not _ready:
        db.conn().executescript(SCHEMA)
        _ready = True


def week_of(dt: datetime | None = None) -> str:
    """回傳該時間所屬週的週一日期（台灣時間）。"""
    d = (dt or datetime.now(timezone.utc)).astimezone(TW)
    return (d - timedelta(days=d.weekday())).strftime("%Y-%m-%d")


def week_range(week: str) -> dict:
    start = datetime.strptime(week, "%Y-%m-%d").replace(tzinfo=TW)
    end = start + timedelta(days=7)
    return {"week": week, "start": start.astimezone(timezone.utc).isoformat(), "end": end.astimezone(timezone.utc).isoformat()}


def ensure_base(uuid: str | None = None, values: dict | None = None) -> None:
    """替還沒有本週基準點的玩家建立基準（新玩家 / 部署後第一次）。values 指定時以該值為基準。"""
    ensure_schema()
    wk = week_of()
    if values is not None and uuid:
        db.execute(f"INSERT OR IGNORE INTO week_base(week, uuid, {', '.join(FIELDS)}) VALUES (?,?,?,?,?,?,?)",
                   (wk, uuid, *[int(values.get(f) or 0) for f in FIELDS]))
        return
    cond, params = ("WHERE uuid = ?", (wk, uuid)) if uuid else ("", (wk,))
    db.execute(f"INSERT OR IGNORE INTO week_base(week, uuid, {', '.join(FIELDS)}) SELECT ?, uuid, {', '.join(FIELDS)} FROM player_stats {cond}", params)


def tick() -> None:
    """每分鐘執行：建立本週基準，並封存已結束的週。"""
    ensure_schema()
    wk = week_of()
    ensure_base()
    for (old,) in [(r["week"],) for r in db.query("SELECT DISTINCT week FROM week_base WHERE week < ? ORDER BY week", (wk,))]:
        if db.one("SELECT 1 FROM weeks WHERE week = ? AND archived_at IS NOT NULL", (old,)):
            db.execute("DELETE FROM week_base WHERE week = ?", (old,))
            continue
        nxt = db.one("SELECT MIN(week) AS w FROM week_base WHERE week > ?", (old,))["w"] or wk
        # 當週增加量 = 下一週的基準 − 當週基準（下一週沒有基準的玩家用目前戰績）
        rows = db.query(f"""SELECT b.uuid, {', '.join(f'MAX(COALESCE(n.{f}, s.{f}, b.{f}) - b.{f}, 0) AS {f}' for f in FIELDS)}
                            FROM week_base b LEFT JOIN week_base n ON n.uuid = b.uuid AND n.week = ?
                            LEFT JOIN player_stats s ON s.uuid = b.uuid WHERE b.week = ?""", (nxt, old))
        active = [r for r in rows if any(r[f] for f in FIELDS)]
        for r in active:
            db.execute(f"INSERT OR REPLACE INTO week_stats(week, uuid, {', '.join(FIELDS)}) VALUES (?,?,?,?,?,?,?)",
                       (old, r["uuid"], *[r[f] for f in FIELDS]))
        top = max((r for r in active if r["kills"] > 0), key=lambda r: (r["kills"], r["kills"] / max(r["deaths"], 1)), default=None)
        db.execute("INSERT OR REPLACE INTO weeks(week, archived_at, champion, players) VALUES (?,?,?,?)",
                   (old, db.iso(db.now_utc()), top and top["uuid"], len(active)))
        db.execute("DELETE FROM week_base WHERE week = ?", (old,))
        log.info("已封存 %s 週排行（%d 位玩家）", old, len(active))


def rows(week: str | None) -> list[dict]:
    """某週每位玩家的增加量；week=None 代表本週（即時）。"""
    ensure_schema()
    if not week or week == week_of():
        ensure_base()
        return db.query(f"""SELECT p.uuid, p.name, p.online, {', '.join(f'MAX(s.{f} - b.{f}, 0) AS {f}' for f in FIELDS)}
                            FROM week_base b JOIN player_stats s ON s.uuid = b.uuid JOIN players p ON p.uuid = b.uuid
                            WHERE b.week = ?""", (week_of(),))
    return db.query(f"""SELECT p.uuid, p.name, p.online, {', '.join(f'w.{f}' for f in FIELDS)}
                        FROM week_stats w JOIN players p ON p.uuid = w.uuid WHERE w.week = ?""", (week,))


def weeks() -> list[dict]:
    ensure_schema()
    cur = week_of()
    out = [dict(week_range(cur), current=True, players=None, champion=None)]
    for r in db.query("SELECT w.week, w.players, p.name AS champion FROM weeks w LEFT JOIN players p ON p.uuid = w.champion ORDER BY w.week DESC LIMIT 52"):
        out.append(dict(week_range(r["week"]), current=False, players=r["players"], champion=r["champion"]))
    return out


def champion_counts() -> dict[str, int]:
    ensure_schema()
    return {r["champion"]: r["n"] for r in db.query("SELECT champion, COUNT(*) AS n FROM weeks WHERE champion IS NOT NULL GROUP BY champion")}
