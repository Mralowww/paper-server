"""Discord OAuth2 登入與伺服器身分組權限檢查（透過 Bot Token 呼叫 REST API）。"""
import time
from urllib.parse import urlencode

import httpx

from . import config

API = "https://discord.com/api/v10"
ADMINISTRATOR = 1 << 3
MANAGE_GUILD = 1 << 5

_admin_cache: dict[str, tuple[float, dict]] = {}
_roles_cache: tuple[float, dict] | None = None


def authorize_url(state: str) -> str:
    return "https://discord.com/oauth2/authorize?" + urlencode({
        "client_id": config.DISCORD_CLIENT_ID,
        "redirect_uri": config.DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify",
        "state": state,
        "prompt": "none",
    })


async def exchange_code(code: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        tok = await client.post(f"{API}/oauth2/token", data={
            "client_id": config.DISCORD_CLIENT_ID,
            "client_secret": config.DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": config.DISCORD_REDIRECT_URI,
        })
        tok.raise_for_status()
        me = await client.get(f"{API}/users/@me",
                              headers={"Authorization": f"Bearer {tok.json()['access_token']}"})
        me.raise_for_status()
        return me.json()


def _bot_headers() -> dict:
    return {"Authorization": f"Bot {config.DISCORD_BOT_TOKEN}"}


async def _guild_roles(client: httpx.AsyncClient) -> dict:
    global _roles_cache
    if _roles_cache and time.time() - _roles_cache[0] < 300:
        return _roles_cache[1]
    guild = await client.get(f"{API}/guilds/{config.DISCORD_GUILD_ID}", headers=_bot_headers())
    guild.raise_for_status()
    data = guild.json()
    info = {"owner_id": data["owner_id"], "roles": {r["id"]: r for r in data["roles"]}}
    _roles_cache = (time.time(), info)
    return info


async def member_status(user_id: str, use_cache: bool = True) -> dict:
    """回傳 {"member": bool, "admin": bool, "roles": [名稱...]}。

    管理員判定：伺服器擁有者、身分組含 Administrator 或 Manage Server 權限、
    或身分組在 ADMIN_ROLE_IDS 設定中。結果快取 60 秒。
    """
    if not config.DISCORD_BOT_TOKEN or not config.DISCORD_GUILD_ID:
        return {"member": True, "admin": False, "roles": []}
    cached = _admin_cache.get(user_id)
    if use_cache and cached and time.time() - cached[0] < 60:
        return cached[1]

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{API}/guilds/{config.DISCORD_GUILD_ID}/members/{user_id}",
                                headers=_bot_headers())
        if resp.status_code == 404:
            status = {"member": False, "admin": False, "roles": []}
        else:
            resp.raise_for_status()
            member = resp.json()
            guild = await _guild_roles(client)
            role_ids = set(member.get("roles", [])) | {config.DISCORD_GUILD_ID}  # @everyone
            perms = 0
            for rid in role_ids:
                role = guild["roles"].get(rid)
                if role:
                    perms |= int(role["permissions"])
            admin = (
                user_id == guild["owner_id"]
                or bool(perms & (ADMINISTRATOR | MANAGE_GUILD))
                or bool(role_ids & config.ADMIN_ROLE_IDS)
            )
            names = [guild["roles"][r]["name"] for r in member.get("roles", []) if r in guild["roles"]]
            status = {"member": True, "admin": admin, "roles": names}
    _admin_cache[user_id] = (time.time(), status)
    return status


def avatar_url(user: dict) -> str:
    if user.get("avatar"):
        return f"https://cdn.discordapp.com/avatars/{user['id']}/{user['avatar']}.png?size=128"
    return f"https://cdn.discordapp.com/embed/avatars/{(int(user['id']) >> 22) % 6}.png"
