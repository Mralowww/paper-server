"""共用的使用者工具與權限檢查。"""
from fastapi import HTTPException, Request

from . import config, db, discord_api

SUPPORT, MOD, ADMIN = 1, 2, 3
LEVEL_NAMES = {0: "member", 1: "support", 2: "mod", 3: "admin"}


def public_user(u: dict) -> dict:
    return {"id": u["id"], "username": u["username"], "name": u.get("global_name") or u["username"],
            "avatar": discord_api.avatar_url(u)}


def with_user(row: dict) -> dict:
    row.update(public_user(row))
    return row


def display_name(u: dict) -> str:
    return u.get("global_name") or u["username"]


async def current_user(request: Request) -> dict:
    uid = request.session.get("uid")
    user = uid and db.one("SELECT * FROM users WHERE id = ?", (uid,))
    if not user:
        raise HTTPException(401, "請先登入")
    if user["banned"]:
        raise HTTPException(403, "你的帳號已被停權")
    return user


async def user_level(request: Request, user: dict) -> int:
    """重新向 Discord 確認權限（快取 60 秒），並同步回資料庫。"""
    if config.DEV_LOGIN and request.session.get("dev_level") is not None:
        return int(request.session["dev_level"])
    status = await discord_api.member_status(user["id"])
    level = status.get("level", 0)
    if level != user.get("level") or int(level >= ADMIN) != user["is_admin"]:
        db.execute("UPDATE users SET level = ?, is_admin = ? WHERE id = ?", (level, int(level >= ADMIN), user["id"]))
    return level


def require(min_level: int):
    async def dep(request: Request) -> dict:
        user = await current_user(request)
        level = await user_level(request, user)
        if level < min_level:
            raise HTTPException(403, "權限不足")
        user["level"] = level
        return user
    return dep


admin_user = require(ADMIN)
