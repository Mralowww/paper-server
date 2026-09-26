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
    if user["banned"] and user["id"] != config.SUPER_OWNER:
        raise HTTPException(403, "你的帳號已被停權")
    return user


async def user_level(request: Request, user: dict) -> int:
    """重新向 Discord 確認權限（快取 60 秒），並同步回資料庫。"""
    if user["id"] == config.SUPER_OWNER:
        try:
            save_roles(user, await discord_api.member_status(user["id"]))
        except Exception:  # noqa: BLE001
            pass
        return ADMIN
    if config.DEV_LOGIN and request.session.get("dev_level") is not None:
        return int(request.session["dev_level"])
    status = await discord_api.member_status(user["id"])
    level = status.get("level", 0)
    save_roles(user, status)
    if level != user.get("level") or int(level >= ADMIN) != user["is_admin"]:
        db.execute("UPDATE users SET level = ?, is_admin = ? WHERE id = ?", (level, int(level >= ADMIN), user["id"]))
    return level


def save_roles(user: dict, status: dict) -> None:
    """記錄使用者目前的 Discord 身分組（名稱與顏色，依高到低），網站顯示身分用。"""
    if "role_info" not in status:
        return  # 沒查到 Discord（例如未設定機器人）就保留原本的紀錄
    import json
    v = json.dumps(status.get("role_info") or [], ensure_ascii=False)
    if v != user.get("discord_roles"):
        db.execute("UPDATE users SET discord_roles = ? WHERE id = ?", (v, user["id"]))


def roles_of(u: dict) -> list:
    import json
    try:
        return json.loads(u.get("discord_roles") or "[]")
    except ValueError:
        return []


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


def is_owner(user_id: str | None) -> bool:
    return bool(user_id) and user_id == config.SUPER_OWNER


def protect_owner(user_id: str | None = None, mc_uuid: str | None = None) -> None:
    """最高擁有者（及其綁定的 Minecraft 帳號）不能被停權或處罰。"""
    if is_owner(user_id):
        raise HTTPException(403, "無法對最高擁有者執行此操作")
    if mc_uuid and db.one("SELECT 1 FROM users WHERE id = ? AND mc_uuid = ?", (config.SUPER_OWNER, mc_uuid)):
        raise HTTPException(403, "無法處罰最高擁有者的 Minecraft 帳號")
