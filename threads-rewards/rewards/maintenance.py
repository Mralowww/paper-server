"""維修模式：可整站維修，或只維修個別分頁 / 功能；達到指定等級的管理員登入後可略過。

最高擁有者（config.SUPER_OWNER）永遠可以略過。外掛（/api/plugin）、後台與登入流程永遠不受影響。
"""
import json
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import activity, config, db
from .deps import ADMIN, require

router = APIRouter()
STATIC = Path(__file__).resolve().parent.parent / "static"

# 分頁（路徑 → 代碼）
PAGES = {"/": "home", "/rankings": "rankings", "/player": "rankings", "/match": "match", "/support": "support", "/ticket": "support",
         "/rewards": "rewards", "/links": "rewards", "/account": "account", "/bans": "bans", "/news": "news", "/rules": "rules",
         "/docs": "docs", "/settings": "settings"}
PAGE_KEYS = ["home", "rankings", "match", "support", "rewards", "account", "bans", "news", "rules", "docs", "settings"]
# 功能（API 路徑前綴 → 代碼）
FEATURES = [("/api/tickets", "tickets"), ("/api/upload", "tickets"), ("/api/match", "match"), ("/api/my/links", "rewards"),
            ("/api/history", "rewards"), ("/api/account", "linking"), ("/api/leaderboard", "stats"), ("/api/players", "stats"),
            ("/api/profile", "stats"), ("/api/punishments", "punish_public"), ("/api/mc/", "punish_public"),
            ("/api/me/keys", "devapi"), ("/api/v1/", "devapi"), ("/api/push/", "notify")]
FEATURE_KEYS = ["tickets", "match", "rewards", "linking", "stats", "punish_public", "devapi", "notify"]
# 永遠放行
ALWAYS = ("/static/", "/uploads/", "/auth/", "/api/plugin/", "/api/admin/", "/api/staff/", "/api/me", "/api/maintenance",
          "/api/server", "/api/rules", "/sw.js", "/login", "/admin", "/desk", "/favicon")
DEFAULT = {"global": False, "pages": [], "features": [], "message": "", "eta": None, "bypass_level": 2}
_cache = {"at": 0.0, "v": None}


def get() -> dict:
    if time.time() - _cache["at"] > 3 or _cache["v"] is None:
        raw = db.settings().get("maintenance")
        try:
            v = {**DEFAULT, **(json.loads(raw) if raw else {})}
        except ValueError:
            v = dict(DEFAULT)
        _cache.update(at=time.time(), v=v)
    return _cache["v"]


def _level(scope) -> tuple[int, bool]:
    uid = (scope.get("session") or {}).get("uid")
    if not uid:
        return -1, False
    if uid == config.SUPER_OWNER:
        return 99, True
    u = db.one("SELECT level, banned FROM users WHERE id = ?", (uid,))
    if not u or u["banned"]:
        return -1, False
    lvl = u["level"] or 0
    if config.DEV_LOGIN and (scope.get("session") or {}).get("dev_level") is not None:
        lvl = int(scope["session"]["dev_level"])
    return lvl, False


def blocked(path: str, m: dict) -> tuple[str, str] | None:
    """回傳 (種類, 代碼)；不受影響時回傳 None。"""
    if path.startswith(ALWAYS) or path in ALWAYS:
        return None
    if path.startswith("/api/"):
        for prefix, key in FEATURES:
            if path.startswith(prefix) and key in m["features"]:
                return "feature", key
        if m["global"]:
            return "feature", "all"
        return None
    key = PAGES.get(path)
    if key and (m["global"] or key in m["pages"]):
        return "page", key
    return None


class MaintenanceMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        m = get()
        if not (m["global"] or m["pages"] or m["features"]):
            return await self.app(scope, receive, send)
        hit = blocked(scope["path"], m)
        if hit:
            lvl, owner = _level(scope)
            if owner or lvl >= int(m.get("bypass_level") or 2):
                scope.setdefault("state", {})["maintenance_bypass"] = True
                return await self.app(scope, receive, send)
            kind, key = hit
            if kind == "feature" or scope["method"] != "GET":
                resp = JSONResponse({"detail": m["message"] or "此功能正在維修中，請稍後再試", "maintenance": True, "feature": key, "eta": m["eta"]},
                                    status_code=503, headers={"Retry-After": "120"})
            else:
                resp = FileResponse(STATIC / "maintenance.html", status_code=503, headers={"Retry-After": "120", "Cache-Control": "no-store"})
            return await resp(scope, receive, send)
        return await self.app(scope, receive, send)


# ---------- API ----------

@router.get("/api/maintenance")
async def status(request: Request):
    m = get()
    lvl, owner = _level(request.scope)
    return {"global": m["global"], "pages": m["pages"], "features": m["features"], "message": m["message"], "eta": m["eta"],
            "active": bool(m["global"] or m["pages"] or m["features"]), "bypass": owner or lvl >= int(m.get("bypass_level") or 2)}


class MaintIn(BaseModel):
    global_: bool = False
    pages: list[str] = []
    features: list[str] = []
    message: str = ""
    eta: str | None = None
    bypass_level: int = 2

    model_config = {"populate_by_name": True, "alias_generator": lambda f: "global" if f == "global_" else f}


@router.get("/api/admin/maintenance")
async def admin_get(_: dict = Depends(require(ADMIN))):
    return {"state": get(), "pages": PAGE_KEYS, "features": FEATURE_KEYS}


@router.put("/api/admin/maintenance")
async def admin_set(body: MaintIn, admin: dict = Depends(require(ADMIN))):
    if not 1 <= body.bypass_level <= 3:
        raise HTTPException(400, "略過等級需介於 1–3")
    old = get()
    new = {"global": body.global_, "pages": [p for p in body.pages if p in PAGE_KEYS], "features": [f for f in body.features if f in FEATURE_KEYS],
           "message": body.message.strip()[:500], "eta": (body.eta or None) and body.eta[:40], "bypass_level": body.bypass_level,
           "updated_by": admin.get("global_name") or admin.get("username"), "updated_at": db.iso(db.now_utc())}
    db.set_settings({"maintenance": json.dumps(new, ensure_ascii=False)})
    _cache["at"] = 0
    b, a = activity.diff({k: old.get(k) for k in ("global", "pages", "features", "message", "eta", "bypass_level")},
                         {k: new[k] for k in ("global", "pages", "features", "message", "eta", "bypass_level")})
    on = new["global"] or new["pages"] or new["features"]
    activity.write(admin, "maintenance.update", "開啟維修模式" if on and not (old["global"] or old["pages"] or old["features"]) else
                   "關閉維修模式" if not on else "調整維修範圍", category="admin", before=b, after=a)
    return {"ok": True, "state": new}
