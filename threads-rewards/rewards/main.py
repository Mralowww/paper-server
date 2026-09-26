import asyncio
import logging

import httpx
import secrets
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from . import account, admin_ext, bot, matchmaking, config, db, discord_api, punish, scraper, stats, tasks, tickets
from .deps import admin_user, current_user, public_user, with_user

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
STATIC = Path(__file__).resolve().parent.parent / "static"
PAGES = {"/": "index.html", "/news": "news.html", "/rules": "rules.html", "/rewards": "rewards.html",
         "/links": "links.html", "/login": "login.html", "/admin": "admin.html", "/settings": "settings.html",
         "/support": "support.html", "/ticket": "ticket.html", "/account": "account.html",
         "/bans": "bans.html", "/player": "player.html", "/rankings": "rankings.html", "/docs": "docs.html", "/match": "match.html"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.conn()
    background = [asyncio.create_task(tasks.scheduler()), asyncio.create_task(bot.start())]
    yield
    for t in background:
        t.cancel()
    if not bot.bot.is_closed():
        await bot.bot.close()


app = FastAPI(title="鋸齒 SMP", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=config.SESSION_SECRET, max_age=60 * 60 * 24 * 30,
                   same_site="lax", https_only=config.DISCORD_REDIRECT_URI.startswith("https"))
app.mount("/static", StaticFiles(directory=STATIC), name="static")
Path(config.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=config.UPLOAD_DIR), name="uploads")
app.include_router(tickets.router)
app.include_router(punish.router)
app.include_router(account.router)
app.include_router(stats.router)
app.include_router(admin_ext.router)
app.include_router(matchmaking.router)
app.add_api_route("/staff", lambda: RedirectResponse("/admin#tickets"), include_in_schema=False)


for route, file in PAGES.items():
    app.add_api_route(route, lambda f=file: FileResponse(STATIC / f), include_in_schema=False)


# ---------- helpers ----------

def period_payload(start, end) -> dict:
    return {"start": db.iso(start), "end": db.iso(end)}


def upsert_user(u: dict, level: int) -> None:
    now = db.iso(db.now_utc())
    db.execute(
        """INSERT INTO users(id, username, global_name, avatar, is_admin, level, created_at, last_login)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET username=excluded.username, global_name=excluded.global_name,
               avatar=excluded.avatar, is_admin=excluded.is_admin, level=excluded.level,
               last_login=excluded.last_login""",
        (u["id"], u["username"], u.get("global_name"), u.get("avatar"), int(level >= 3), level, now, now),
    )


# ---------- auth ----------

@app.get("/auth/login", include_in_schema=False)
async def login(request: Request):
    if not config.DISCORD_CLIENT_ID:
        raise HTTPException(500, "尚未設定 DISCORD_CLIENT_ID")
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    nxt = request.query_params.get("next", "")
    if nxt.startswith("/") and not nxt.startswith("//"):
        request.session["next"] = nxt
    return RedirectResponse(discord_api.authorize_url(state))


@app.get("/auth/callback", include_in_schema=False)
async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error or not code or state != request.session.pop("oauth_state", None):
        return RedirectResponse("/login?error=oauth")
    try:
        user = await discord_api.exchange_code(code)
        status = await discord_api.member_status(user["id"], use_cache=False)
    except Exception:  # noqa: BLE001
        logging.exception("Discord 登入失敗")
        return RedirectResponse("/login?error=discord")
    if config.REQUIRE_GUILD_MEMBER and not status["member"]:
        return RedirectResponse("/login?error=not_member")
    upsert_user(user, status.get("level", 0))
    request.session["uid"] = user["id"]
    return RedirectResponse(request.session.pop("next", None) or "/account")


@app.get("/auth/dev-login", include_in_schema=False)
async def dev_login(request: Request, id: str = "100000000000000001", name: str = "tester", level: int = 0):
    if not config.DEV_LOGIN:
        raise HTTPException(404)
    upsert_user({"id": id, "username": name, "global_name": name, "avatar": None}, level)
    request.session["uid"] = id
    request.session["dev_level"] = level
    return RedirectResponse("/admin" if level else "/account")


@app.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


# ---------- public api ----------

@app.get("/api/me")
async def me(request: Request):
    uid = request.session.get("uid")
    user = uid and db.one("SELECT * FROM users WHERE id = ?", (uid,))
    if not user:
        return {"user": None}
    level = request.session.get("dev_level") if config.DEV_LOGIN and request.session.get("dev_level") is not None \
        else user.get("level") or 0
    return {"user": {**public_user(user), "level": level, "admin": level >= 3, "banned": bool(user["banned"]),
                     "mc": {"uuid": user["mc_uuid"], "name": user["mc_name"]} if user.get("mc_uuid") else None}}


@app.get("/api/overview")
async def overview():
    start, end = db.period_bounds()
    board = [with_user(r) for r in db.leaderboard(start, end, limit=20)]
    s = db.settings()
    totals = db.one(
        """SELECT COUNT(*) AS links, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(likes),0) AS likes,
                  COALESCE(SUM(views),0) AS views, COALESCE(SUM(replies),0) AS replies,
                  COALESCE(SUM(reposts),0) AS reposts
           FROM links WHERE status = 'active' AND created_at >= ? AND created_at < ?""",
        (db.iso(start), db.iso(end)))
    last = db.one("SELECT period_start, period_end FROM weekly_results ORDER BY period_start DESC LIMIT 1")
    winners = []
    if last:
        winners = [with_user(r) for r in db.query(
            """SELECT w.rank, w.score, w.link_count, u.* FROM weekly_results w JOIN users u ON u.id = w.user_id
               WHERE w.period_start = ? ORDER BY w.rank""", (last["period_start"],))]
    return {
        "period": period_payload(start, end),
        "leaderboard": board,
        "totals": totals,
        "last_winners": {"period": last, "winners": winners},
        "announcement": s.get("announcement", ""),
        "rewards": [s.get("reward_1", ""), s.get("reward_2", ""), s.get("reward_3", "")],
        "weights": db.weights(),
        "max_links": config.MAX_LINKS_PER_WEEK,
    }


@app.get("/api/history")
async def history():
    rows = db.query(
        """SELECT w.*, u.username, u.global_name, u.avatar FROM weekly_results w
           JOIN users u ON u.id = w.user_id ORDER BY w.period_start DESC, w.rank LIMIT 60""")
    weeks: dict[str, dict] = {}
    for r in rows:
        r.update(public_user({**r, "id": r["user_id"]}))
        weeks.setdefault(r["period_start"], {"start": r["period_start"], "end": r["period_end"], "winners": []})
        weeks[r["period_start"]]["winners"].append(r)
    return {"weeks": list(weeks.values())}


@app.get("/api/search")
async def search(q: str = ""):
    q = q.strip()
    if not q:
        return {"users": [], "links": []}
    like = f"%{q}%"
    users = [public_user(u) for u in db.query(
        "SELECT * FROM users WHERE banned = 0 AND (username LIKE ? OR global_name LIKE ?) LIMIT 8", (like, like))]
    links = db.query(
        """SELECT id, url, author, content, likes FROM links WHERE status = 'active'
           AND (url LIKE ? OR author LIKE ? OR content LIKE ?) ORDER BY created_at DESC LIMIT 8""",
        (like, like, like))
    return {"users": users, "links": links}


_status_cache: dict = {"at": 0.0, "data": None}


@app.get("/api/server")
async def server_info():
    """伺服器位址、Discord 邀請、規則，以及透過 mcsrvstat.us 查詢的即時狀態（快取 60 秒）。"""
    s = db.settings()
    address = s.get("server_address") or "sawsmp.me"
    if time.time() - _status_cache["at"] > 60 or (_status_cache["data"] or {}).get("address") != address:
        status = {"address": address, "online": False}
        try:
            async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "SawSMP-Website/1.0"}) as client:
                d = (await client.get(f"https://api.mcsrvstat.us/3/{address}")).json()
            status.update(online=bool(d.get("online")), players=d.get("players", {}).get("online", 0),
                          max=d.get("players", {}).get("max", 0), version=d.get("version", ""),
                          motd=" ".join(d.get("motd", {}).get("clean", [])))
        except Exception:  # noqa: BLE001
            logging.warning("查詢伺服器狀態失敗", exc_info=True)
        _status_cache.update(at=time.time(), data=status)
    return {"status": _status_cache["data"], "discord_invite": s.get("discord_invite", ""),
            "rules": s.get("rules", ""), "announcement": s.get("announcement", "")}


@app.get("/api/news")
async def news(limit: int = 20):
    rows = db.query("""SELECT n.*, u.username, u.global_name, u.avatar FROM news n
                       LEFT JOIN users u ON u.id = n.author_id
                       ORDER BY n.pinned DESC, n.created_at DESC LIMIT ?""", (min(limit, 100),))
    for r in rows:
        r["author"] = public_user({"id": r["author_id"], "username": r["username"], "global_name": r["global_name"],
                                   "avatar": r["avatar"]}) if r["author_id"] and r["username"] else None
    return {"news": rows}


# ---------- my links ----------

class LinkIn(BaseModel):
    url: str


@app.get("/api/my/links")
async def my_links(user: dict = Depends(current_user)):
    start, end = db.period_bounds()
    w = db.weights()
    links = db.query(
        f"""SELECT l.*, {db.score_sql(w)} AS score FROM links l WHERE l.user_id = ?
            ORDER BY l.created_at DESC LIMIT 200""", (user["id"],))
    board = db.leaderboard(start, end, limit=1000)
    rank = next((i + 1 for i, r in enumerate(board) if r["id"] == user["id"]), None)
    mine = board[rank - 1] if rank else None
    for l in links:
        l["this_period"] = db.iso(start) <= l["created_at"] < db.iso(end)
    return {"links": links, "rank": rank, "summary": mine, "period": period_payload(start, end),
            "limit": config.MAX_LINKS_PER_WEEK}


@app.post("/api/my/links")
async def add_link(body: LinkIn, user: dict = Depends(current_user)):
    parsed = scraper.parse_url(body.url)
    if not parsed:
        raise HTTPException(400, "請貼上 Threads 貼文網址，例如 https://www.threads.com/@帳號/post/xxxx")
    url, author, code = parsed
    if db.one("SELECT 1 FROM links WHERE url = ? OR code = ?", (url, code)):
        raise HTTPException(409, "這個連結已經有人上傳過了")
    start, end = db.period_bounds()
    count = db.one("SELECT COUNT(*) AS c FROM links WHERE user_id = ? AND created_at >= ? AND created_at < ?",
                   (user["id"], db.iso(start), db.iso(end)))["c"]
    if count >= config.MAX_LINKS_PER_WEEK:
        raise HTTPException(429, f"每週最多上傳 {config.MAX_LINKS_PER_WEEK} 則連結")
    link_id = db.execute(
        "INSERT INTO links(user_id, url, code, author, created_at) VALUES (?,?,?,?,?)",
        (user["id"], url, code, author, db.iso(db.now_utc())))
    result = await tasks.refresh_link(db.one("SELECT * FROM links WHERE id = ?", (link_id,)))
    return {"ok": True, "id": link_id, "scrape": result}


_refresh_at: dict[int, float] = {}


@app.post("/api/my/links/{link_id}/refresh")
async def refresh_my_link(link_id: int, user: dict = Depends(current_user)):
    link = db.one("SELECT * FROM links WHERE id = ? AND user_id = ?", (link_id, user["id"]))
    if not link:
        raise HTTPException(404, "找不到連結")
    if time.time() - _refresh_at.get(link_id, 0) < 600:
        raise HTTPException(429, "每 10 分鐘只能手動更新一次")
    _refresh_at[link_id] = time.time()
    return await tasks.refresh_link(link)


@app.delete("/api/my/links/{link_id}")
async def delete_my_link(link_id: int, user: dict = Depends(current_user)):
    start, _ = db.period_bounds()
    link = db.one("SELECT * FROM links WHERE id = ? AND user_id = ?", (link_id, user["id"]))
    if not link:
        raise HTTPException(404, "找不到連結")
    if link["created_at"] < db.iso(start):
        raise HTTPException(400, "已結算週期的連結無法刪除")
    db.execute("DELETE FROM snapshots WHERE link_id = ?", (link_id,))
    db.execute("DELETE FROM links WHERE id = ?", (link_id,))
    return {"ok": True}


# ---------- admin ----------

class LinkPatch(BaseModel):
    views: int | None = None
    status: str | None = None


class UserPatch(BaseModel):
    banned: bool


class SettleIn(BaseModel):
    week_offset: int = -1  # -1 = 上一週期；0 = 本週期（提前結算）


@app.get("/api/admin/overview")
async def admin_overview(week_offset: int = 0, _: dict = Depends(admin_user)):
    start, end = db.period_bounds()
    start, end = start + timedelta(weeks=week_offset), end + timedelta(weeks=week_offset)
    w = db.weights()
    links = db.query(
        f"""SELECT l.*, {db.score_sql(w)} AS score, u.username, u.global_name, u.avatar
            FROM links l JOIN users u ON u.id = l.user_id
            WHERE l.created_at >= ? AND l.created_at < ? ORDER BY score DESC""",
        (db.iso(start), db.iso(end)))
    for l in links:
        l["user"] = public_user({"id": l["user_id"], "username": l["username"],
                                 "global_name": l["global_name"], "avatar": l["avatar"]})
    users = [dict(public_user(u), banned=bool(u["banned"]), admin=bool(u["is_admin"]),
                  created_at=u["created_at"], last_login=u["last_login"], links=u["links"])
             for u in db.query("""SELECT u.*, (SELECT COUNT(*) FROM links WHERE user_id = u.id) AS links
                                  FROM users u ORDER BY u.last_login DESC""")]
    settled = db.one("SELECT settled_at FROM settled_periods WHERE period_start = ?", (db.iso(start),))
    return {
        "period": period_payload(start, end), "week_offset": week_offset,
        "leaderboard": [with_user(r) for r in db.leaderboard(start, end, limit=50)],
        "links": links, "users": users, "settings": db.settings(),
        "settled_at": settled and settled["settled_at"],
        "errors": sum(1 for l in links if l["last_error"]),
    }


@app.patch("/api/admin/links/{link_id}")
async def admin_patch_link(link_id: int, body: LinkPatch, _: dict = Depends(admin_user)):
    if not db.one("SELECT 1 FROM links WHERE id = ?", (link_id,)):
        raise HTTPException(404, "找不到連結")
    if body.views is not None:
        db.execute("UPDATE links SET views = ? WHERE id = ?", (max(0, body.views), link_id))
    if body.status is not None:
        if body.status not in ("active", "rejected"):
            raise HTTPException(400, "狀態只能是 active 或 rejected")
        db.execute("UPDATE links SET status = ? WHERE id = ?", (body.status, link_id))
    return {"ok": True}


@app.post("/api/admin/links/{link_id}/refresh")
async def admin_refresh_link(link_id: int, _: dict = Depends(admin_user)):
    link = db.one("SELECT * FROM links WHERE id = ?", (link_id,))
    if not link:
        raise HTTPException(404, "找不到連結")
    return await tasks.refresh_link(link)


@app.delete("/api/admin/links/{link_id}")
async def admin_delete_link(link_id: int, _: dict = Depends(admin_user)):
    db.execute("DELETE FROM snapshots WHERE link_id = ?", (link_id,))
    db.execute("DELETE FROM links WHERE id = ?", (link_id,))
    return {"ok": True}


@app.patch("/api/admin/users/{user_id}")
async def admin_patch_user(user_id: str, body: UserPatch, admin: dict = Depends(admin_user)):
    if user_id == admin["id"]:
        raise HTTPException(400, "不能停權自己")
    db.execute("UPDATE users SET banned = ? WHERE id = ?", (int(body.banned), user_id))
    return {"ok": True}


@app.put("/api/admin/settings")
async def admin_settings(body: dict, _: dict = Depends(admin_user)):
    clean = {}
    for k, v in body.items():
        if k.startswith("w_"):
            try:
                v = max(0.0, float(v))
            except (TypeError, ValueError):
                raise HTTPException(400, f"{k} 必須是數字")
        elif k == "settle_weekday" and not (0 <= int(v) <= 6):
            raise HTTPException(400, "結算星期需介於 0–6")
        elif k == "settle_hour" and not (0 <= int(v) <= 23):
            raise HTTPException(400, "結算小時需介於 0–23")
        clean[k] = v
    db.set_settings(clean)
    return {"ok": True, "settings": db.settings()}


@app.post("/api/admin/settle")
async def admin_settle(body: SettleIn, _: dict = Depends(admin_user)):
    start, end = db.period_bounds()
    start, end = start + timedelta(weeks=body.week_offset), end + timedelta(weeks=body.week_offset)
    db.execute("DELETE FROM settled_periods WHERE period_start = ?", (db.iso(start),))
    db.execute("DELETE FROM weekly_results WHERE period_start = ?", (db.iso(start),))
    winners = await tasks.settle(start, end)
    return {"ok": True, "winners": [with_user(dict(w)) for w in winners]}


class NewsIn(BaseModel):
    title: str
    body: str
    tag: str = "news"
    pinned: bool = False


def _check_news(body: NewsIn) -> None:
    if not body.title.strip() or not body.body.strip():
        raise HTTPException(400, "標題與內容不可為空")
    if body.tag not in ("news", "update", "event", "maintenance"):
        raise HTTPException(400, "不支援的分類")


@app.post("/api/admin/news")
async def admin_add_news(body: NewsIn, admin: dict = Depends(admin_user)):
    _check_news(body)
    nid = db.execute("INSERT INTO news(title, body, tag, pinned, author_id, created_at) VALUES (?,?,?,?,?,?)",
                     (body.title.strip(), body.body.strip(), body.tag, int(body.pinned), admin["id"],
                      db.iso(db.now_utc())))
    return {"ok": True, "id": nid}


@app.put("/api/admin/news/{news_id}")
async def admin_edit_news(news_id: int, body: NewsIn, _: dict = Depends(admin_user)):
    _check_news(body)
    db.execute("UPDATE news SET title = ?, body = ?, tag = ?, pinned = ? WHERE id = ?",
               (body.title.strip(), body.body.strip(), body.tag, int(body.pinned), news_id))
    return {"ok": True}


@app.delete("/api/admin/news/{news_id}")
async def admin_delete_news(news_id: int, _: dict = Depends(admin_user)):
    db.execute("DELETE FROM news WHERE id = ?", (news_id,))
    return {"ok": True}


@app.post("/api/admin/refresh-all")
async def admin_refresh_all(_: dict = Depends(admin_user)):
    start, end = db.period_bounds()
    asyncio.create_task(tasks.refresh_period(start, end))
    return {"ok": True}
