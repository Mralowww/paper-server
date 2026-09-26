"""Discord 身分組相關：通知身分組自助領取、贊助者 / 加成者徽章。"""
import asyncio
import json
import logging
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import activity, config, db, discord_api, security
from .deps import current_user, roles_of

log = logging.getLogger("rewards.roles")
router = APIRouter()
API = "https://discord.com/api/v10"
DEFAULT_NOTIFY = [
    {"id": "1546908276690788453", "name": "公告通知", "desc": "伺服器重要公告、規則更新", "icon": "news"},
    {"id": "1546908278003339386", "name": "活動通知", "desc": "活動、比賽與獎勵開放時通知你", "icon": "gift"},
    {"id": "1546908279882518678", "name": "廢話通知", "desc": "日常閒聊、有趣的東西（比較吵）", "icon": "message"},
    {"id": "1546908281803644988", "name": "維護通知", "desc": "伺服器維護、重啟與停機時間", "icon": "settings"},
]
_counts = {"at": 0.0, "data": {}, "total": 0}
_lock = asyncio.Lock()
COOLDOWN = 10  # 同一個身分組切換後的冷卻秒數
_cool: dict[tuple[str, str], float] = {}


def _cooldowns(uid: str) -> dict[str, int]:
    now = time.time()
    return {rid: int(t - now) + 1 for (u, rid), t in list(_cool.items()) if u == uid and t > now}


def notify_roles() -> list[dict]:
    raw = db.settings().get("notify_roles")
    if raw:
        out = []
        for line in raw.splitlines():
            parts = [p.strip() for p in line.split("|")]
            if parts and parts[0].isdigit():
                out.append({"id": parts[0], "name": parts[1] if len(parts) > 1 and parts[1] else "通知",
                            "desc": parts[2] if len(parts) > 2 else "", "icon": parts[3] if len(parts) > 3 and parts[3] else "bell"})
        if out:
            return out
    return DEFAULT_NOTIFY


def badge_roles() -> dict:
    s = db.settings()
    return {"sponsor": s.get("sponsor_role_id") or "1539867828839252020", "booster": s.get("booster_role_id") or "1533474407354339562"}


def badges_of(u: dict | None) -> list[str]:
    """由記錄的 Discord 身分組判斷贊助者 / 加成者。"""
    if not u:
        return []
    ids = {r.get("id") for r in roles_of(u)}
    return [k for k, rid in badge_roles().items() if rid in ids]


async def counts(force: bool = False) -> dict:
    """統計每個身分組的人數（翻頁讀取整個成員清單，快取 2 分鐘）。"""
    if not force and time.time() - _counts["at"] < 120:
        return _counts
    async with _lock:
        if not force and time.time() - _counts["at"] < 120:
            return _counts
        tally: dict[str, int] = {}; total = 0; after = "0"
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                for _ in range(50):
                    r = await client.get(f"{API}/guilds/{config.DISCORD_GUILD_ID}/members", params={"limit": 1000, "after": after},
                                         headers={"Authorization": f"Bot {config.DISCORD_BOT_TOKEN}"})
                    if r.status_code != 200:
                        raise RuntimeError(f"members {r.status_code}")
                    page = r.json()
                    for m in page:
                        total += 1
                        for rid in m.get("roles", []):
                            tally[rid] = tally.get(rid, 0) + 1
                    if len(page) < 1000:
                        break
                    after = page[-1]["user"]["id"]
            _counts.update(at=time.time(), data=tally, total=total)
        except Exception:  # noqa: BLE001
            log.warning("讀取成員清單失敗", exc_info=True)
            _counts["at"] = time.time() - 90  # 30 秒後再試
    return _counts


@router.get("/api/notify-roles")
async def list_roles():
    return await _payload(None)


async def _payload(user: dict | None) -> dict:
    c = await counts()
    mine: set[str] = set(); member = None
    if user:
        try:
            mine = await discord_api.member_role_ids(user["id"]); member = bool(mine) or (await discord_api.member_status(user["id"])).get("member", False)
        except Exception:  # noqa: BLE001
            member = None
    return {"roles": [dict(r, count=c["data"].get(r["id"], 0), on=r["id"] in mine) for r in notify_roles()],
            "members": c["total"], "member": member, "logged_in": bool(user),
            "badges": {k: c["data"].get(v, 0) for k, v in badge_roles().items()},
            "cooldown": COOLDOWN, "cooldowns": _cooldowns(user["id"]) if user else {}}


@router.get("/api/notify-roles/me")
async def my_roles(user: dict = Depends(current_user)):
    return await _payload(user)


class ToggleIn(BaseModel):
    on: bool


@router.post("/api/notify-roles/{role_id}")
async def toggle(role_id: str, body: ToggleIn, user: dict = Depends(current_user)):
    role = next((r for r in notify_roles() if r["id"] == role_id), None)
    if not role:
        raise HTTPException(404, "找不到這個通知身分組")
    now = time.time()
    left = _cool.get((user["id"], role_id), 0) - now
    if left > 0:
        raise HTTPException(429, f"冷卻中，請 {int(left) + 1} 秒後再切換「{role['name']}」", headers={"Retry-After": str(int(left) + 1)})
    security.ratelimit(f"nrole:{user['id']}", 6, 60, "切換太頻繁，請一分鐘後再試")
    _cool[(user["id"], role_id)] = now + COOLDOWN
    if len(_cool) > 5000:
        for k in [k for k, t in _cool.items() if t < now]:
            _cool.pop(k, None)
    st = await discord_api.member_status(user["id"])
    if not st.get("member"):
        raise HTTPException(400, "請先加入鋸齒 SMP 的 Discord 伺服器")
    ok = await discord_api.set_role(user["id"], role_id, body.on)
    if not ok:
        raise HTTPException(502, "Discord 設定身分組失敗，請稍後再試")
    if _counts["data"]:
        _counts["data"][role_id] = max(0, _counts["data"].get(role_id, 0) + (1 if body.on else -1))
    discord_api._admin_cache.pop(user["id"], None)
    activity.write(user, "notify.role.add" if body.on else "notify.role.remove", role["name"], category="account", target=role_id)
    return {"ok": True, "on": body.on, "count": _counts["data"].get(role_id, 0), "cooldown": COOLDOWN}
