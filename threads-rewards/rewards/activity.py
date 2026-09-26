"""完整操作紀錄。

- 每個修改類請求（POST / PUT / PATCH / DELETE）都會留下一筆：操作者、IP、國家、User-Agent、
  方法、路徑、狀態碼、耗時、請求 ID 與（遮蔽敏感欄位後的）請求內容。
- 程式內以 db.audit() 寫入的語意事件（登入、處罰、修改設定…）會自動附上同一個請求的中繼資料，
  並可帶修改前 / 修改後的值；同一個請求就不再另外寫一筆通用紀錄。
- 插件高頻率的回報（心跳、戰績同步等）不記錄，避免洗版。
"""
import contextvars
import csv
import io
import json
import re
import secrets
import time

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from . import db
from .deps import ADMIN, require

CTX: contextvars.ContextVar[dict | None] = contextvars.ContextVar("activity_ctx", default=None)

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
SKIP = ("/api/plugin/heartbeat", "/api/plugin/actions/ack", "/api/plugin/stats", "/api/plugin/ping",
        "/api/plugin/kill", "/auth/dev-login")
SENSITIVE = re.compile(r"(secret|token|password|passwd|api_?key|plugin_key|authorization|^key$)", re.I)
MAX_BODY = 64_000
RETENTION_DAYS = 365

CATEGORY_PREFIX = [
    ("auth.", "auth"), ("punish", "punish"), ("revoke", "punish"), ("player.", "punish"),
    ("ticket", "ticket"), ("upload", "ticket"), ("account.", "account"), ("apikey", "account"),
    ("game.", "game"), ("match", "game"),
]
PATH_CATEGORY = [
    ("/auth/", "auth"), ("/api/plugin/", "game"), ("/api/staff/punishments", "punish"), ("/api/staff/players", "punish"),
    ("/api/tickets", "ticket"), ("/api/staff/ticket", "ticket"), ("/api/upload", "ticket"), ("/api/admin/", "admin"),
    ("/api/account", "account"), ("/api/me/", "account"), ("/api/my/", "account"), ("/api/match", "game"),
]


def category_for(action: str = "", path: str = "") -> str:
    for p, c in CATEGORY_PREFIX:
        if action.startswith(p):
            return c
    for p, c in PATH_CATEGORY:
        if path.startswith(p):
            return c
    return "admin" if action else "other"


def redact(v):
    if isinstance(v, dict):
        return {k: ("••••••" if SENSITIVE.search(str(k)) and v2 not in (None, "") else redact(v2)) for k, v2 in v.items()}
    if isinstance(v, list):
        return [redact(x) for x in v[:200]]
    if isinstance(v, str) and len(v) > 4000:
        return v[:4000] + "…"
    return v


def dumps(v) -> str | None:
    if v is None:
        return None
    try:
        return json.dumps(redact(v), ensure_ascii=False, default=str)[:MAX_BODY]
    except (TypeError, ValueError):
        return json.dumps(str(v)[:4000], ensure_ascii=False)


def diff(before: dict | None, after: dict | None) -> tuple[dict, dict]:
    """只留下有變動的欄位。"""
    before, after = before or {}, after or {}
    keys = [k for k in dict.fromkeys([*before, *after]) if before.get(k) != after.get(k)]
    return {k: before.get(k) for k in keys}, {k: after.get(k) for k in keys}


def ensure_schema() -> None:
    cols = {r["name"] for r in db.query("PRAGMA table_info(audit_log)")}
    for name, ddl in [("category", "TEXT"), ("target", "TEXT"), ("ip", "TEXT"), ("country", "TEXT"), ("user_agent", "TEXT"),
                      ("method", "TEXT"), ("path", "TEXT"), ("route", "TEXT"), ("query", "TEXT"), ("referer", "TEXT"),
                      ("status", "INTEGER"), ("duration_ms", "INTEGER"), ("request_id", "TEXT"),
                      ("before_json", "TEXT"), ("after_json", "TEXT"), ("payload_json", "TEXT"), ("meta_json", "TEXT")]:
        if name not in cols:
            db.execute(f"ALTER TABLE audit_log ADD COLUMN {name} {ddl}")
    db.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(id DESC)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_audit_cat ON audit_log(category)")


def write(actor: dict | None, action: str, detail: str, *, target=None, before=None, after=None, meta=None,
          category: str | None = None) -> int:
    """寫入一筆紀錄；在請求中呼叫時會自動附上請求中繼資料。"""
    ctx = CTX.get()
    name = actor and (actor.get("global_name") or actor.get("username") or actor.get("name"))
    if not name:
        name = "system" if not ctx else ("Minecraft 插件" if ctx["path"].startswith("/api/plugin/") else "訪客")
    row_id = db.execute(
        """INSERT INTO audit_log(actor_id, actor_name, action, detail, created_at, category, target, ip, country, user_agent,
                                 method, path, query, referer, request_id, before_json, after_json, meta_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (actor and actor.get("id"), name, action, str(detail)[:1000], db.iso(db.now_utc()),
         category or category_for(action, ctx["path"] if ctx else ""), None if target is None else str(target)[:200],
         ctx and ctx["ip"], ctx and ctx["country"], ctx and ctx["ua"], ctx and ctx["method"], ctx and ctx["path"],
         ctx and ctx["query"], ctx and ctx["referer"], ctx and ctx["id"], dumps(before), dumps(after), dumps(meta)))
    if ctx is not None:
        ctx["rows"].append(row_id)
    return row_id


def _actor_from_session(scope) -> tuple[str | None, str | None]:
    uid = (scope.get("session") or {}).get("uid")
    if not uid:
        return None, None
    u = db.one("SELECT username, global_name FROM users WHERE id = ?", (uid,))
    return uid, u and (u["global_name"] or u["username"])


def _route(scope) -> str:
    r = scope.get("route")
    if r is not None and getattr(r, "path", None):
        return r.path
    path = scope["path"]
    for k, v in (scope.get("path_params") or {}).items():
        path = path.replace(f"/{v}", "/{" + k + "}", 1)
    return path


class ActivityMiddleware:
    """純 ASGI 中介層（放在 SessionMiddleware 內側，才讀得到 session）。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("utf-8", "replace") for k, v in scope.get("headers", [])}
        client = scope.get("client") or ("", 0)
        ip = headers.get("cf-connecting-ip") or headers.get("x-forwarded-for", "").split(",")[0].strip() or client[0]
        path = scope["path"]
        ctx = {"id": secrets.token_hex(6), "ip": ip, "country": headers.get("cf-ipcountry"), "ua": headers.get("user-agent", "")[:400],
               "method": scope["method"], "path": path, "query": scope.get("query_string", b"").decode("utf-8", "replace")[:500] or None,
               "referer": headers.get("referer", "")[:400] or None, "rows": []}
        track = scope["method"] in MUTATING and not path.startswith(SKIP) and not path.startswith("/static")
        ctype = headers.get("content-type", "")
        body = bytearray(); size = [0]

        async def recv():
            msg = await receive()
            if msg["type"] == "http.request":
                chunk = msg.get("body", b"")
                size[0] += len(chunk)
                if "json" in ctype and len(body) < MAX_BODY:
                    body.extend(chunk[: MAX_BODY - len(body)])
            return msg

        status = [500]

        async def snd(msg):
            if msg["type"] == "http.response.start":
                status[0] = msg["status"]
            await send(msg)

        token = CTX.set(ctx)
        t0 = time.perf_counter()
        try:
            await self.app(scope, recv if track else receive, snd)
        finally:
            CTX.reset(token)
            if track:
                try:
                    self._record(scope, ctx, status[0], int((time.perf_counter() - t0) * 1000), bytes(body), size[0], ctype)
                except Exception:  # noqa: BLE001 — 紀錄失敗不能影響請求
                    import logging
                    logging.exception("寫入操作紀錄失敗")

    @staticmethod
    def _record(scope, ctx, status, ms, body: bytes, size: int, ctype: str):
        route = _route(scope)
        if body:
            try:
                payload = dumps(json.loads(body))
            except ValueError:
                payload = dumps(body.decode("utf-8", "replace")[:2000])
        elif size:
            payload = dumps({"_content_type": ctype.split(";")[0], "_bytes": size})
        else:
            payload = None
        if ctx["rows"]:
            marks = ",".join("?" * len(ctx["rows"]))
            db.execute(f"UPDATE audit_log SET status = ?, duration_ms = ?, route = ?, payload_json = COALESCE(payload_json, ?) WHERE id IN ({marks})",
                       (status, ms, route, payload, *ctx["rows"]))
            return
        uid, name = _actor_from_session(scope)
        if route.startswith("/api/plugin/"):
            name = name or "Minecraft 插件"
        db.execute(
            """INSERT INTO audit_log(actor_id, actor_name, action, detail, created_at, category, ip, country, user_agent, method, path,
                                     route, query, referer, status, duration_ms, request_id, payload_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (uid, name or "訪客", "request", f"{ctx['method']} {route}", db.iso(db.now_utc()), category_for("", route),
             ctx["ip"], ctx["country"], ctx["ua"], ctx["method"], ctx["path"], route, ctx["query"], ctx["referer"],
             status, ms, ctx["id"], payload))


def prune() -> None:
    db.execute("DELETE FROM audit_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%S', 'now', ?)", (f"-{RETENTION_DAYS} days",))


# ---------- 查詢 API（僅最高管理員） ----------

router = APIRouter()
COLS = "id, actor_id, actor_name, action, detail, created_at, category, target, ip, country, user_agent, method, path, route, status, duration_ms, request_id"


def _filters(q: str, category: str, actor: str, action: str, status: str, since: str, until: str, ip: str):
    where, args = [], []
    if q:
        like = f"%{q}%"
        where.append("(detail LIKE ? OR action LIKE ? OR actor_name LIKE ? OR actor_id = ? OR ip LIKE ? OR path LIKE ? OR target LIKE ? OR payload_json LIKE ?)")
        args += [like, like, like, q, like, like, like, like]
    if category:
        where.append("category = ?"); args.append(category)
    if actor:
        where.append("actor_id = ?"); args.append(actor)
    if action:
        where.append("action = ?"); args.append(action)
    if ip:
        where.append("ip = ?"); args.append(ip)
    if status == "error":
        where.append("status >= 400")
    elif status == "ok":
        where.append("(status IS NULL OR status < 400)")
    if since:
        where.append("created_at >= ?"); args.append(since)
    if until:
        where.append("created_at <= ?"); args.append(until)
    return (" WHERE " + " AND ".join(where)) if where else "", args


@router.get("/api/admin/activity")
async def activity(q: str = "", category: str = "", actor: str = "", action: str = "", status: str = "", ip: str = "",
                   since: str = "", until: str = "", before_id: int = 0, limit: int = Query(50, le=200),
                   _: dict = Depends(require(ADMIN))):
    where, args = _filters(q.strip(), category, actor, action, status, since, until, ip)
    page_where = where + (" AND " if where else " WHERE ") + "id < ?" if before_id else where
    rows = db.query(f"SELECT {COLS} FROM audit_log{page_where} ORDER BY id DESC LIMIT ?",
                    (*args, *([before_id] if before_id else []), limit))
    counts = {r["category"] or "other": r["n"] for r in db.query(
        f"SELECT category, COUNT(*) AS n FROM audit_log{where} GROUP BY category", args)} if not before_id else None
    since_day = db.one("SELECT COUNT(*) AS n, COUNT(DISTINCT actor_id) AS a, COUNT(DISTINCT ip) AS i FROM audit_log WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%S', 'now', '-1 day')")
    return {"rows": rows, "counts": counts, "more": len(rows) == limit,
            "day": since_day, "logins": db.one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.login' AND created_at >= strftime('%Y-%m-%dT%H:%M:%S', 'now', '-1 day')")["n"],
            "failed": db.one("SELECT COUNT(*) AS n FROM audit_log WHERE (status >= 400 OR action = 'auth.login_failed') AND created_at >= strftime('%Y-%m-%dT%H:%M:%S', 'now', '-1 day')")["n"]}


@router.get("/api/admin/activity/export.csv")
async def activity_csv(q: str = "", category: str = "", actor: str = "", action: str = "", status: str = "", ip: str = "",
                       since: str = "", until: str = "", _: dict = Depends(require(ADMIN))):
    where, args = _filters(q.strip(), category, actor, action, status, since, until, ip)
    rows = db.query(f"SELECT * FROM audit_log{where} ORDER BY id DESC LIMIT 20000", args)
    buf = io.StringIO(); buf.write("﻿")
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": "attachment; filename=sawsmp-activity.csv"})


@router.get("/api/admin/activity/{row_id}")
async def activity_detail(row_id: int, _: dict = Depends(require(ADMIN))):
    r = db.one("SELECT * FROM audit_log WHERE id = ?", (row_id,))
    if not r:
        from fastapi import HTTPException
        raise HTTPException(404, "找不到紀錄")
    for k in ("before_json", "after_json", "payload_json", "meta_json"):
        try:
            r[k[:-5]] = json.loads(r.pop(k)) if r.get(k) else None
        except ValueError:
            r[k[:-5]] = r.pop(k)
    related = db.query(f"SELECT {COLS} FROM audit_log WHERE request_id = ? AND id != ? ORDER BY id", (r["request_id"], row_id)) if r.get("request_id") else []
    actor = db.one("SELECT id, username, global_name, avatar, level, mc_name, mc_uuid, last_login FROM users WHERE id = ?", (r["actor_id"],)) if r.get("actor_id") else None
    return {"row": r, "related": related, "actor": actor,
            "actor_recent": db.query(f"SELECT {COLS} FROM audit_log WHERE actor_id = ? AND id != ? ORDER BY id DESC LIMIT 8", (r["actor_id"], row_id)) if r.get("actor_id") else [],
            "ip_actors": db.query("SELECT actor_id, actor_name, COUNT(*) AS n, MAX(created_at) AS last FROM audit_log WHERE ip = ? AND actor_id IS NOT NULL GROUP BY actor_id ORDER BY n DESC LIMIT 10", (r["ip"],)) if r.get("ip") else []}
