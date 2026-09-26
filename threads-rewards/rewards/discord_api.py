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
    """回傳 {"member": bool, "level": 0-3, "admin": bool, "roles": [名稱...]}。

    等級：3 超級管理員（擁有者、Administrator / Manage Server 權限、ADMIN_ROLE_IDS）、
    2 管理員（MOD_ROLE_IDS）、1 客服（SUPPORT_ROLE_IDS）、0 一般成員。結果快取 60 秒。
    """
    if user_id in config.OWNER_IDS:
        return {"member": True, "level": 3, "admin": True, "roles": ["Owner"]}
    if not config.DISCORD_BOT_TOKEN or not config.DISCORD_GUILD_ID:
        return {"member": True, "level": 0, "admin": False, "roles": []}
    cached = _admin_cache.get(user_id)
    if use_cache and cached and time.time() - cached[0] < 60:
        return cached[1]

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{API}/guilds/{config.DISCORD_GUILD_ID}/members/{user_id}",
                                headers=_bot_headers())
        if resp.status_code == 404:
            status = {"member": False, "level": 0, "admin": False, "roles": []}
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
            level = 3 if admin else 2 if role_ids & config.MOD_ROLE_IDS else 1 if role_ids & config.SUPPORT_ROLE_IDS else 0
            names = [guild["roles"][r]["name"] for r in member.get("roles", []) if r in guild["roles"]]
            status = {"member": True, "level": level, "admin": admin, "roles": names}
    _admin_cache[user_id] = (time.time(), status)
    return status


def avatar_url(user: dict) -> str:
    if user.get("avatar"):
        return f"https://cdn.discordapp.com/avatars/{user['id']}/{user['avatar']}.png?size=128"
    return f"https://cdn.discordapp.com/embed/avatars/{(int(user['id']) >> 22) % 6}.png"


# ---------- 懲處同步 / 身分組 ----------

async def guild_roles() -> list[dict]:
    """伺服器身分組（不含 @everyone），依位置排序。"""
    if not config.DISCORD_BOT_TOKEN or not config.DISCORD_GUILD_ID:
        return []
    async with httpx.AsyncClient(timeout=15) as client:
        info = await _guild_roles(client)
    roles = [r for r in info["roles"].values() if r["id"] != config.DISCORD_GUILD_ID and not r.get("managed")]
    return [{"id": r["id"], "name": r["name"], "color": f"#{r['color']:06x}" if r["color"] else None, "position": r["position"]}
            for r in sorted(roles, key=lambda r: -r["position"])]


async def member_role_ids(user_id: str) -> set[str]:
    if not config.DISCORD_BOT_TOKEN or not config.DISCORD_GUILD_ID:
        return set()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{API}/guilds/{config.DISCORD_GUILD_ID}/members/{user_id}", headers=_bot_headers())
    return set(r.json().get("roles", [])) if r.status_code == 200 else set()


async def timeout(user_id: str, until_iso: str | None, reason: str = "") -> bool:
    """禁言 = Discord 逾時（最長 28 天）；until_iso 為 None 代表解除。"""
    headers = {**_bot_headers(), "X-Audit-Log-Reason": reason[:500].encode("utf-8").decode("latin-1", "ignore")}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.patch(f"{API}/guilds/{config.DISCORD_GUILD_ID}/members/{user_id}",
                               headers=headers, json={"communication_disabled_until": until_iso})
    return r.status_code < 300


async def set_role(user_id: str, role_id: str, add: bool) -> bool:
    async with httpx.AsyncClient(timeout=15) as client:
        url = f"{API}/guilds/{config.DISCORD_GUILD_ID}/members/{user_id}/roles/{role_id}"
        r = await (client.put(url, headers=_bot_headers()) if add else client.delete(url, headers=_bot_headers()))
    return r.status_code < 300


async def dm(user_id: str, content: str = "", embed: dict | None = None) -> bool:
    async with httpx.AsyncClient(timeout=15) as client:
        ch = await client.post(f"{API}/users/@me/channels", headers=_bot_headers(), json={"recipient_id": user_id})
        if ch.status_code >= 300:
            return False
        body = {"content": content} if content else {}
        if embed:
            body["embeds"] = [embed]
        r = await client.post(f"{API}/channels/{ch.json()['id']}/messages", headers=_bot_headers(), json=body)
    return r.status_code < 300


async def send_channel(channel_id: str, embed: dict) -> bool:
    if not channel_id or not config.DISCORD_BOT_TOKEN:
        return False
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{API}/channels/{channel_id}/messages", headers=_bot_headers(), json={"embeds": [embed]})
    return r.status_code < 300


async def member_detail(user_id: str) -> dict:
    """Discord 帳號建立時間、是否在伺服器、加入時間與身分組（含顏色）。"""
    created = ((int(user_id) >> 22) + 1420070400000) / 1000 if user_id.isdigit() else None
    out = {"created_at": created, "in_guild": False, "joined_at": None, "roles": [], "username": None}
    if not config.DISCORD_BOT_TOKEN or not config.DISCORD_GUILD_ID:
        return out
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{API}/guilds/{config.DISCORD_GUILD_ID}/members/{user_id}", headers=_bot_headers())
        if r.status_code != 200:
            return out
        m = r.json()
        guild = await _guild_roles(client)
    roles = [guild["roles"][rid] for rid in m.get("roles", []) if rid in guild["roles"]]
    out.update(in_guild=True, joined_at=m.get("joined_at"), username=m.get("user", {}).get("username"),
               roles=[{"id": x["id"], "name": x["name"], "color": f"#{x['color']:06x}" if x["color"] else None}
                      for x in sorted(roles, key=lambda x: -x["position"])])
    return out
