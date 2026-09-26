"""背景工作：定期更新 Threads 數據、每週結算前三名。"""
import asyncio
import logging
from datetime import timedelta

from . import config, db, scraper, weekly

log = logging.getLogger("rewards.tasks")
announce_hook = None  # bot.py 啟動後會設定為 async 函式 (period_start, period_end, winners)


async def refresh_link(link: dict) -> dict:
    try:
        stats = await scraper.fetch_stats(link["url"])
    except Exception as e:  # noqa: BLE001 — 任何錯誤都記錄在連結上
        db.execute("UPDATE links SET last_error = ?, last_scraped = ? WHERE id = ?",
                   (str(e)[:300], db.iso(db.now_utc()), link["id"]))
        return {"ok": False, "error": str(e)}
    views = stats.get("views", link["views"]) or link["views"]  # 公開頁面通常沒有瀏覽數，保留手動值
    db.execute(
        """UPDATE links SET likes = ?, replies = ?, reposts = ?, views = ?, content = COALESCE(NULLIF(?, ''), content),
                  last_error = NULL, last_scraped = ? WHERE id = ?""",
        (stats["likes"], stats.get("replies", 0), stats.get("reposts", 0), views,
         stats.get("content", ""), db.iso(db.now_utc()), link["id"]),
    )
    db.execute("INSERT INTO snapshots(link_id, ts, likes, replies, reposts, views) VALUES (?,?,?,?,?,?)",
               (link["id"], db.iso(db.now_utc()), stats["likes"], stats.get("replies", 0),
                stats.get("reposts", 0), views))
    return {"ok": True, **stats}


async def refresh_period(start, end) -> int:
    links = db.query("SELECT * FROM links WHERE status = 'active' AND created_at >= ? AND created_at < ?",
                     (db.iso(start), db.iso(end)))
    for link in links:
        await refresh_link(link)
        await asyncio.sleep(2)  # 避免過快被 Threads 限流
    return len(links)


async def settle(start, end) -> list[dict]:
    """結算指定週期：先最後更新一次數據，再寫入前三名。"""
    key = db.iso(start)
    if db.one("SELECT 1 FROM settled_periods WHERE period_start = ?", (key,)):
        return db.query("SELECT * FROM weekly_results WHERE period_start = ? ORDER BY rank", (key,))
    await refresh_period(start, end)
    top = db.leaderboard(start, end, limit=3)
    for rank, row in enumerate(top, 1):
        db.execute("INSERT OR REPLACE INTO weekly_results VALUES (?,?,?,?,?,?)",
                   (key, db.iso(end), rank, row["id"], row["score"] or 0, row["link_count"]))
    db.execute("INSERT OR REPLACE INTO settled_periods VALUES (?, ?)", (key, db.iso(db.now_utc())))
    log.info("已結算 %s，共 %d 名得獎者", key, len(top))
    if announce_hook and top:
        try:
            await announce_hook(start, end, top)
        except Exception:  # noqa: BLE001
            log.exception("Discord 公告失敗")
    return top


async def scheduler() -> None:
    last_refresh = float("-inf")
    loop = asyncio.get_running_loop()
    while True:
        try:
            start, end = db.period_bounds()
            prev_start, prev_end = db.period_bounds(start - timedelta(seconds=1))  # 前一週期
            if not db.one("SELECT 1 FROM settled_periods WHERE period_start = ?", (db.iso(prev_start),)):
                has_links = db.one("SELECT 1 FROM links WHERE created_at >= ? AND created_at < ?",
                                   (db.iso(prev_start), db.iso(prev_end)))
                if has_links:
                    await settle(prev_start, prev_end)
                else:
                    db.execute("INSERT OR IGNORE INTO settled_periods VALUES (?, ?)",
                               (db.iso(prev_start), db.iso(db.now_utc())))
            try:
                weekly.tick()
            except Exception:  # noqa: BLE001
                log.exception("每週排行封存失敗")
            if loop.time() - last_refresh >= config.SCRAPE_INTERVAL_MIN * 60:
                last_refresh = loop.time()
                await refresh_period(start, end)
        except Exception:  # noqa: BLE001
            log.exception("排程執行失敗")
        await asyncio.sleep(60)
