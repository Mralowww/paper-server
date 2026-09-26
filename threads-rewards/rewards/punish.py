"""懲處系統：玩家資料、封鎖／禁言／警告／踢出／IP 封鎖，以及給 Minecraft 插件呼叫的 API。

插件串接方式（之後實作插件時照此對接）：
  所有 /api/plugin/* 請求需帶 Header `X-API-Key: <PLUGIN_API_KEY>`
  POST /api/plugin/login      玩家登入前檢查 {uuid, name, ip} → {allowed, message, mute}
  POST /api/plugin/quit       玩家離線 {uuid}
  POST /api/plugin/heartbeat  每 5–10 秒回報線上玩家 {online:[{uuid,name}]} → {actions:[...]}
  POST /api/plugin/actions/ack 回報已執行的動作 {ids:[...]}
  POST /api/plugin/punish     遊戲內下的懲處 {uuid?, name, type, reason, duration, staff_name, ip?}
  POST /api/plugin/revoke     遊戲內解除 {name, type, staff_name, reason?}
  POST /api/plugin/link       玩家輸入 /link <code> {code, uuid, name}
"""
import asyncio
import json
import logging
import re
import time
from datetime import timedelta

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from . import config, db, discord_api
from .deps import ADMIN, MOD, display_name, public_user, require

router = APIRouter()
TYPES = ("ban", "mute", "warn", "kick", "ipban")
UUID_RE = re.compile(r"^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$", re.I)
NAME_RE = re.compile(r"^[A-Za-z0-9_]{2,16}$")


# ---------- helpers ----------

def dashed(uuid: str) -> str:
    u = uuid.replace("-", "").lower()
    return f"{u[:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:]}"


def now_iso() -> str:
    return db.iso(db.now_utc())


def expire_old() -> None:
    db.execute("UPDATE punishments SET active = 0 WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?",
               (now_iso(),))


def mask_ip(ip: str | None) -> str | None:
    if not ip:
        return ip
    parts = ip.split(".")
    return ".".join(parts[:2] + ["*", "*"]) if len(parts) == 4 else ip[: max(4, len(ip) // 2)] + "…"


def queue(action: str, payload: dict) -> None:
    db.execute("INSERT INTO plugin_actions(action, payload, created_at) VALUES (?,?,?)",
               (action, json.dumps(payload, ensure_ascii=False), now_iso()))


def fmt_expiry(expires_at: str | None) -> str:
    if not expires_at:
        return "永久"
    from datetime import datetime
    return datetime.fromisoformat(expires_at).astimezone(config.TIMEZONE).strftime("%Y-%m-%d %H:%M")


def kick_message(p: dict) -> str:
    title = {"ban": "你已被鋸齒 SMP 封鎖", "ipban": "你的 IP 已被鋸齒 SMP 封鎖", "kick": "你已被踢出鋸齒 SMP"}[p["type"]]
    lines = [title, "", f"原因：{p['reason']}"]
    if p["type"] != "kick":
        lines += [f"到期：{fmt_expiry(p['expires_at'])}", f"編號：#{p['id']}", "", f"申訴：{config.PUBLIC_URL}/support"]
    return "\n".join(lines)


async def mojang_lookup(name: str) -> dict | None:
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(f"https://api.mojang.com/users/profiles/minecraft/{name}")
    if r.status_code != 200:
        return None
    d = r.json()
    return {"uuid": dashed(d["id"]), "name": d["name"]}


def upsert_player(uuid: str, name: str, ip: str | None = None, online: bool | None = None) -> None:
    now = now_iso()
    db.execute(
        """INSERT INTO players(uuid, name, first_seen, last_seen, last_ip, online) VALUES (?,?,?,?,?,?)
           ON CONFLICT(uuid) DO UPDATE SET name = excluded.name,
               first_seen = COALESCE(players.first_seen, excluded.first_seen),
               last_seen = COALESCE(excluded.last_seen, players.last_seen),
               last_ip = COALESCE(excluded.last_ip, players.last_ip),
               online = COALESCE(?, players.online)""",
        (uuid, name, now if ip else None, now if ip else None, ip, int(bool(online)), None if online is None else int(online)))
    db.execute("INSERT OR IGNORE INTO player_names(uuid, name, first_seen) VALUES (?,?,?)", (uuid, name, now))
    if ip:
        db.execute("""INSERT INTO player_ips(uuid, ip, first_seen, last_seen) VALUES (?,?,?,?)
                      ON CONFLICT(uuid, ip) DO UPDATE SET last_seen = excluded.last_seen""", (uuid, ip, now, now))


async def resolve_player(name_or_uuid: str) -> dict:
    """由名稱或 UUID 找玩家；資料庫沒有就查 Mojang 並建立。"""
    q = name_or_uuid.strip()
    if UUID_RE.match(q):
        p = db.one("SELECT * FROM players WHERE uuid = ?", (dashed(q),))
        if p:
            return p
        raise HTTPException(404, "找不到這個 UUID 的玩家")
    if not NAME_RE.match(q):
        raise HTTPException(400, "玩家名稱格式不正確")
    p = db.one("SELECT * FROM players WHERE name = ? COLLATE NOCASE", (q,))
    if p:
        return p
    try:
        prof = await mojang_lookup(q)
    except httpx.HTTPError:
        raise HTTPException(502, "無法連線到 Mojang 驗證玩家")
    if not prof:
        raise HTTPException(404, "Mojang 查無此玩家名稱")
    upsert_player(prof["uuid"], prof["name"])
    return db.one("SELECT * FROM players WHERE uuid = ?", (prof["uuid"],))


def active_of(uuid: str, ptype: str) -> dict | None:
    return db.one("SELECT * FROM punishments WHERE uuid = ? AND type = ? AND active = 1 ORDER BY id DESC LIMIT 1",
                  (uuid, ptype))


log = logging.getLogger("rewards.punish")
heartbeat_hooks: list = []  # matchmaking 會註冊：清除離線玩家的配對
_last_heartbeat = {"at": 0.0}


def plugin_last_seen() -> float:
    return _last_heartbeat["at"]


def linked_discord(uuid: str) -> str | None:
    u = db.one("SELECT id FROM users WHERE mc_uuid = ?", (uuid,))
    return u and u["id"]


PT_NAMES = {"ban": "封禁", "mute": "禁言", "warn": "警告", "kick": "踢出", "ipban": "IP 封禁"}
PT_COLORS = {"ban": 0xEF6B6B, "mute": 0xE2C25A, "warn": 0xEB9A4F, "kick": 0x6FA8E8, "ipban": 0xB196EA}


async def _discord_sync(p: dict, undo: bool = False) -> None:
    """禁言 = 逾時或禁言身分組、封禁 = 封禁身分組、警告 = 私訊。"""
    uid = linked_discord(p["uuid"])
    if not uid:
        return
    s = db.settings()
    try:
        if p["type"] == "mute":
            role = s.get("discord_mute_role")
            if role:
                await discord_api.set_role(uid, role, not undo)
            else:
                until = None
                if not undo:
                    cap = db.now_utc() + timedelta(days=28)
                    until = min(p["expires_at"] or db.iso(cap), db.iso(cap))
                await discord_api.timeout(uid, until, p["reason"])
        elif p["type"] in ("ban", "ipban") and s.get("discord_ban_role"):
            await discord_api.set_role(uid, s["discord_ban_role"], not undo)
        if p["type"] in ("warn", "ban", "mute") and not undo:
            await discord_api.dm(uid, embed={
                "title": f"你在鋸齒 SMP 收到{PT_NAMES[p['type']]}", "color": PT_COLORS[p["type"]],
                "description": f"**原因**：{p['reason']}\n**到期**：{fmt_expiry(p['expires_at'])}\n**編號**：#{p['id']}\n\n如有異議請至 {config.PUBLIC_URL}/support 申訴。"})
    except Exception:  # noqa: BLE001
        log.exception("Discord 同步失敗 #%s", p["id"])


async def _log_channel(p: dict, revoked_by: str | None = None) -> None:
    ch = db.settings().get("punish_log_channel_id")
    if not ch:
        return
    title = f"{'✅ 解除' if revoked_by else '⚖️'}{PT_NAMES[p['type']]} · {p['name']}"
    desc = f"**原因**：{p['reason']}\n**執行者**：{revoked_by or p['staff_name']}"
    if not revoked_by and p["type"] != "kick":
        desc += f"\n**到期**：{fmt_expiry(p['expires_at'])}"
    await discord_api.send_channel(ch, {"title": title, "description": desc, "color": PT_COLORS[p["type"]],
                                        "footer": {"text": f"#{p['id']}"},
                                        "thumbnail": {"url": f"https://mc-heads.net/avatar/{p['uuid']}/64"}})


def _bg(coro) -> None:
    try:
        asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        pass


def create_punishment(player: dict, ptype: str, reason: str, duration: int | None, staff: dict | None,
                      staff_name: str, source: str = "web", ip: str | None = None,
                      silent: bool = False, discord_sync: bool = False) -> dict:
    if ptype not in TYPES:
        raise HTTPException(400, "不支援的懲處類型")
    reason = reason.strip()[:500]
    if not reason:
        raise HTTPException(400, "請填寫原因")
    if duration is not None and duration <= 0:
        raise HTTPException(400, "時長必須大於 0")
    expire_old()
    if ptype in ("ban", "mute", "ipban") and active_of(player["uuid"], ptype):
        raise HTTPException(409, "此玩家已有生效中的同類型懲處，請先解除或編輯")
    if ptype == "ipban":
        ip = ip or player.get("last_ip")
        if not ip:
            raise HTTPException(400, "此玩家沒有已知 IP，無法 IP 封鎖")
    now = db.now_utc()
    expires = db.iso(now + timedelta(seconds=duration)) if duration and ptype != "kick" else None
    pid = db.execute(
        """INSERT INTO punishments(type, uuid, name, ip, reason, staff_id, staff_name, source, created_at, expires_at,
                                  active, silent, discord_sync) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (ptype, player["uuid"], player["name"], ip if ptype == "ipban" else None, reason, staff and staff["id"],
         staff_name, source, db.iso(now), expires, 0 if ptype == "kick" else 1, int(silent), int(discord_sync)))
    p = db.one("SELECT * FROM punishments WHERE id = ?", (pid,))
    db.audit(staff, f"punish.{ptype}", f"#{pid} {player['name']} — {reason} ({fmt_expiry(expires)})")
    if source != "game":
        if ptype in ("ban", "ipban", "kick"):
            queue("kick", {"uuid": p["uuid"], "name": p["name"], "ip": p["ip"], "type": ptype,
                           "message": kick_message(p), "punishment_id": pid})
        else:
            queue(ptype, {"uuid": p["uuid"], "name": p["name"], "reason": reason, "expires_at": expires,
                          "punishment_id": pid})
    if discord_sync:
        _bg(_discord_sync(p))
    if not silent:
        _bg(_log_channel(p))
    if ptype == "warn":
        escalate(player, staff_name)
    return p


def escalate(player: dict, staff_name: str) -> None:
    s = db.settings()
    threshold, hours = int(s.get("warn_threshold") or 0), int(s.get("warn_ban_hours") or 24)
    if threshold <= 0 or active_of(player["uuid"], "ban"):
        return
    count = db.one("SELECT COUNT(*) AS c FROM punishments WHERE uuid = ? AND type = 'warn' AND active = 1",
                   (player["uuid"],))["c"]
    if count >= threshold:
        db.execute("UPDATE punishments SET active = 0, revoke_reason = '已累積升級為封鎖' WHERE uuid = ? AND type = 'warn' AND active = 1",
                   (player["uuid"],))
        create_punishment(player, "ban", f"累積 {count} 次警告（自動）", hours * 3600, None, "系統", source="auto")


def revoke(p: dict, staff: dict | None, staff_name: str, reason: str, notify_plugin: bool = True) -> None:
    if not p["active"]:
        raise HTTPException(400, "此懲處已不在生效中")
    db.execute("UPDATE punishments SET active = 0, revoked_by = ?, revoked_at = ?, revoke_reason = ? WHERE id = ?",
               (staff_name, now_iso(), reason.strip()[:300] or None, p["id"]))
    db.audit(staff, f"revoke.{p['type']}", f"#{p['id']} {p['name']} — {reason}")
    if notify_plugin and p["type"] == "mute":
        queue("unmute", {"uuid": p["uuid"], "name": p["name"], "punishment_id": p["id"]})
    if p.get("discord_sync"):
        _bg(_discord_sync(p, undo=True))
    if not p.get("silent"):
        _bg(_log_channel(p, revoked_by=staff_name))


def pun_public(p: dict, show_ip: bool = False) -> dict:
    d = dict(p)
    d["ip"] = p["ip"] if show_ip else None
    d["staff_id"] = None if not show_ip else p["staff_id"]
    return d


# ---------- 公開 API ----------

_mc_cache: dict[str, tuple[float, dict | None]] = {}


@router.get("/api/mc/{name}")
async def mc_check(name: str):
    """確認 Minecraft 帳號是否存在（開單、處罰表單即時驗證用），結果快取 10 分鐘。"""
    if not NAME_RE.match(name):
        return {"exists": False}
    key = name.lower()
    hit = _mc_cache.get(key)
    if not hit or time.time() - hit[0] > 600:
        local = db.one("SELECT uuid, name FROM players WHERE name = ? COLLATE NOCASE", (name,))
        try:
            prof = local or await mojang_lookup(name)
        except httpx.HTTPError:
            prof = None
        hit = (time.time(), prof)
        _mc_cache[key] = hit
    prof = hit[1]
    return {"exists": bool(prof), **(prof or {})}


@router.get("/api/punishments")
async def public_punishments(type: str = "", q: str = "", page: int = 1):
    expire_old()
    where, params = ["silent = 0"], []
    if type in TYPES:
        where.append("type = ?"); params.append(type)
    if q:
        where.append("name LIKE ?"); params.append(f"%{q}%")
    page = max(1, page)
    rows = db.query(f"SELECT * FROM punishments WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT 30 OFFSET ?",
                    (*params, (page - 1) * 30))
    counts = {r["type"]: r["c"] for r in db.query(
        "SELECT type, COUNT(*) AS c FROM punishments WHERE active = 1 GROUP BY type")}
    return {"punishments": [pun_public(r) for r in rows], "active_counts": counts, "page": page}


@router.get("/api/players/{name}")
async def public_player(name: str):
    expire_old()
    p = db.one("SELECT * FROM players WHERE name = ? COLLATE NOCASE", (name,))
    if not p:
        raise HTTPException(404, "找不到玩家")
    puns = db.query("SELECT * FROM punishments WHERE uuid = ? AND silent = 0 ORDER BY id DESC", (p["uuid"],))
    return {"player": {"uuid": p["uuid"], "name": p["name"], "first_seen": p["first_seen"], "last_seen": p["last_seen"],
                       "online": bool(p["online"])},
            "punishments": [pun_public(x) for x in puns]}


# ---------- 管理 API（等級 2 以上） ----------

class PunishIn(BaseModel):
    player: str
    type: str
    reason: str
    duration: int | None = None   # 秒；None = 永久
    ip: str | None = None
    silent: bool = False
    discord_sync: bool = False


class RevokeIn(BaseModel):
    reason: str = ""


class PunEdit(BaseModel):
    reason: str | None = None
    duration: int | None = None       # 從現在起算的新時長（秒）
    permanent: bool = False


class NotesIn(BaseModel):
    notes: str


@router.get("/api/staff/players")
async def staff_players(q: str = "", online: int = 0, staff: dict = Depends(require(MOD))):
    expire_old()
    where, params = [], []
    if q:
        if q.count(".") >= 1 and staff["level"] >= ADMIN and re.match(r"^[\d.:a-fA-F]+$", q):
            where.append("uuid IN (SELECT uuid FROM player_ips WHERE ip LIKE ?)"); params.append(f"{q}%")
        else:
            where.append("(name LIKE ? OR uuid LIKE ?)"); params += [f"%{q}%", f"{q.lower()}%"]
    if online:
        where.append("online = 1")
    rows = db.query(
        f"""SELECT p.*, (SELECT COUNT(*) FROM punishments x WHERE x.uuid = p.uuid) AS total,
                   (SELECT GROUP_CONCAT(type) FROM punishments x WHERE x.uuid = p.uuid AND x.active = 1) AS active_types
            FROM players p {'WHERE ' + ' AND '.join(where) if where else ''}
            ORDER BY p.online DESC, p.last_seen DESC LIMIT 60""", tuple(params))
    for r in rows:
        r["last_ip"] = r["last_ip"] if staff["level"] >= ADMIN else mask_ip(r["last_ip"])
        r["active_types"] = sorted(set((r["active_types"] or "").split(",")) - {""})
    return {"players": rows, "can_see_ip": staff["level"] >= ADMIN}


@router.post("/api/staff/players/lookup")
async def staff_lookup(body: dict, _: dict = Depends(require(MOD))):
    p = await resolve_player(str(body.get("player", "")))
    count = db.one("SELECT COUNT(*) AS c FROM punishments WHERE uuid = ?", (p["uuid"],))["c"]
    return {"uuid": p["uuid"], "name": p["name"], "discord_id": linked_discord(p["uuid"]), "past": count}


@router.get("/api/staff/players/{uuid}")
async def staff_player(uuid: str, staff: dict = Depends(require(MOD))):
    expire_old()
    p = db.one("SELECT * FROM players WHERE uuid = ?", (uuid,))
    if not p:
        raise HTTPException(404, "找不到玩家")
    show_ip = staff["level"] >= ADMIN
    ips = db.query("SELECT * FROM player_ips WHERE uuid = ? ORDER BY last_seen DESC", (uuid,))
    alts = db.query(
        """SELECT DISTINCT pl.uuid, pl.name, pl.online, pl.last_seen,
                  (SELECT GROUP_CONCAT(type) FROM punishments x WHERE x.uuid = pl.uuid AND x.active = 1) AS active_types
           FROM player_ips a JOIN player_ips b ON a.ip = b.ip AND b.uuid != a.uuid
           JOIN players pl ON pl.uuid = b.uuid WHERE a.uuid = ?""", (uuid,))
    linked = db.one("SELECT * FROM users WHERE mc_uuid = ?", (uuid,))
    tickets = db.query("""SELECT id, category, subject, status, created_at FROM tickets
                          WHERE target = ? COLLATE NOCASE OR user_id = ? ORDER BY id DESC LIMIT 20""",
                       (p["name"], linked["id"] if linked else ""))
    if not show_ip:
        p["last_ip"] = mask_ip(p["last_ip"])
        for i in ips:
            i["ip"] = mask_ip(i["ip"])
    return {
        "player": p,
        "punishments": [pun_public(x, show_ip) for x in db.query(
            "SELECT * FROM punishments WHERE uuid = ? ORDER BY id DESC", (uuid,))],
        "ips": ips, "alts": [dict(a, active_types=sorted(set((a["active_types"] or "").split(",")) - {""})) for a in alts],
        "linked": public_user(linked) if linked else None, "tickets": tickets, "can_see_ip": show_ip,
    }


@router.patch("/api/staff/players/{uuid}")
async def staff_player_notes(uuid: str, body: NotesIn, staff: dict = Depends(require(MOD))):
    if not db.one("SELECT 1 FROM players WHERE uuid = ?", (uuid,)):
        raise HTTPException(404, "找不到玩家")
    db.execute("UPDATE players SET notes = ? WHERE uuid = ?", (body.notes[:5000], uuid))
    db.audit(staff, "player.notes", uuid)
    return {"ok": True}


@router.get("/api/staff/punishments")
async def staff_punishments(type: str = "", active: int = -1, q: str = "", page: int = 1,
                            staff: dict = Depends(require(MOD))):
    expire_old()
    where, params = [], []
    if type in TYPES:
        where.append("type = ?"); params.append(type)
    if active in (0, 1):
        where.append("active = ?"); params.append(active)
    if q:
        where.append("(name LIKE ? OR reason LIKE ? OR staff_name LIKE ? OR CAST(id AS TEXT) = ?)")
        params += [f"%{q}%", f"%{q}%", f"%{q}%", q.lstrip("#")]
    page = max(1, page)
    rows = db.query(f"""SELECT * FROM punishments {'WHERE ' + ' AND '.join(where) if where else ''}
                        ORDER BY id DESC LIMIT 50 OFFSET ?""", (*params, (page - 1) * 50))
    counts = {r["type"]: r["c"] for r in db.query(
        "SELECT type, COUNT(*) AS c FROM punishments WHERE active = 1 GROUP BY type")}
    return {"punishments": [pun_public(r, staff["level"] >= ADMIN) for r in rows], "active_counts": counts, "page": page}


@router.post("/api/staff/punishments")
async def staff_punish(body: PunishIn, staff: dict = Depends(require(MOD))):
    if body.type == "ipban" and staff["level"] < ADMIN:
        raise HTTPException(403, "IP 封鎖需要超級管理員權限")
    player = await resolve_player(body.player)
    p = create_punishment(player, body.type, body.reason, body.duration, staff, display_name(staff),
                          ip=body.ip if staff["level"] >= ADMIN else None, silent=body.silent, discord_sync=body.discord_sync)
    return {"ok": True, "punishment": pun_public(p, staff["level"] >= ADMIN)}


@router.post("/api/staff/punishments/{pid}/revoke")
async def staff_revoke(pid: int, body: RevokeIn, staff: dict = Depends(require(MOD))):
    p = db.one("SELECT * FROM punishments WHERE id = ?", (pid,))
    if not p:
        raise HTTPException(404, "找不到懲處")
    revoke(p, staff, display_name(staff), body.reason)
    return {"ok": True}


@router.patch("/api/staff/punishments/{pid}")
async def staff_edit_punishment(pid: int, body: PunEdit, staff: dict = Depends(require(MOD))):
    p = db.one("SELECT * FROM punishments WHERE id = ?", (pid,))
    if not p:
        raise HTTPException(404, "找不到懲處")
    if body.reason is not None:
        if not body.reason.strip():
            raise HTTPException(400, "原因不可為空")
        db.execute("UPDATE punishments SET reason = ? WHERE id = ?", (body.reason.strip()[:500], pid))
    if body.permanent:
        db.execute("UPDATE punishments SET expires_at = NULL WHERE id = ?", (pid,))
    elif body.duration:
        db.execute("UPDATE punishments SET expires_at = ? WHERE id = ?",
                   (db.iso(db.now_utc() + timedelta(seconds=body.duration)), pid))
    db.audit(staff, "punish.edit", f"#{pid}")
    return {"ok": True, "punishment": db.one("SELECT * FROM punishments WHERE id = ?", (pid,))}


@router.get("/api/staff/audit")
async def staff_audit(_: dict = Depends(require(ADMIN))):
    return {"log": db.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200")}


@router.get("/api/staff/stats")
async def staff_stats(_: dict = Depends(require(MOD))):
    expire_old()
    return {
        "active": {r["type"]: r["c"] for r in db.query(
            "SELECT type, COUNT(*) AS c FROM punishments WHERE active = 1 GROUP BY type")},
        "players": db.one("SELECT COUNT(*) AS c, COALESCE(SUM(online),0) AS online FROM players"),
        "today": db.one("SELECT COUNT(*) AS c FROM punishments WHERE created_at >= ?",
                        (db.iso(db.now_utc() - timedelta(days=1)),))["c"],
        "plugin_pending": db.one("SELECT COUNT(*) AS c FROM plugin_actions WHERE done_at IS NULL")["c"],
        "plugin_configured": bool(config.setting_or_env("plugin_api_key", config.PLUGIN_API_KEY)),
        "plugin_online": time.time() - _last_heartbeat["at"] < 60,
    }


# ---------- Minecraft 插件 API ----------

def plugin_auth(x_api_key: str = Header(default="")) -> None:
    key = config.setting_or_env("plugin_api_key", config.PLUGIN_API_KEY)
    if not key or x_api_key != key:
        raise HTTPException(401, "invalid api key")


class PluginLogin(BaseModel):
    uuid: str
    name: str
    ip: str | None = None


class PluginPunish(BaseModel):
    name: str
    uuid: str | None = None
    type: str
    reason: str
    duration: int | None = None
    staff_name: str
    ip: str | None = None
    silent: bool = False


class PluginRevoke(BaseModel):
    name: str
    type: str
    staff_name: str
    reason: str = ""


@router.post("/api/plugin/login", dependencies=[Depends(plugin_auth)])
async def plugin_login(body: PluginLogin):
    _last_heartbeat["at"] = _last_heartbeat["at"] or time.time()
    uuid = dashed(body.uuid)
    upsert_player(uuid, body.name, body.ip, online=True)
    expire_old()
    ban = active_of(uuid, "ban")
    ipban = body.ip and db.one("SELECT * FROM punishments WHERE type = 'ipban' AND active = 1 AND ip = ? LIMIT 1", (body.ip,))
    block = ban or ipban
    if block:
        db.execute("UPDATE players SET online = 0 WHERE uuid = ?", (uuid,))
        return {"allowed": False, "message": kick_message(block), "punishment_id": block["id"]}
    mute = active_of(uuid, "mute")
    return {"allowed": True, "mute": mute and {"id": mute["id"], "reason": mute["reason"], "expires_at": mute["expires_at"]}}


@router.post("/api/plugin/quit", dependencies=[Depends(plugin_auth)])
async def plugin_quit(body: dict):
    db.execute("UPDATE players SET online = 0, last_seen = ? WHERE uuid = ?", (now_iso(), dashed(str(body.get("uuid", "0" * 32)))))
    return {"ok": True}


@router.post("/api/plugin/heartbeat", dependencies=[Depends(plugin_auth)])
async def plugin_heartbeat(body: dict):
    online = body.get("online") or []
    for hook in heartbeat_hooks:
        hook([dashed(pl["uuid"]) for pl in online if pl.get("uuid")])
    now = time.time()
    elapsed = int(min(120, now - _last_heartbeat["at"])) if _last_heartbeat["at"] else 0
    _last_heartbeat["at"] = now
    db.execute("UPDATE players SET online = 0 WHERE online = 1")
    if elapsed > 0:
        for pl in online:
            if pl.get("uuid"):
                db.execute("""INSERT INTO player_stats(uuid, playtime, updated_at) VALUES (?,?,?)
                              ON CONFLICT(uuid) DO UPDATE SET playtime = playtime + excluded.playtime, updated_at = excluded.updated_at""",
                           (dashed(pl["uuid"]), elapsed, now_iso()))
    for pl in online:
        if pl.get("uuid") and pl.get("name"):
            upsert_player(dashed(pl["uuid"]), pl["name"], online=True)
            db.execute("UPDATE players SET online = 1, last_seen = ? WHERE uuid = ?", (now_iso(), dashed(pl["uuid"])))
    expire_old()
    actions = db.query("SELECT id, action, payload, created_at FROM plugin_actions WHERE done_at IS NULL ORDER BY id LIMIT 100")
    for a in actions:
        a["payload"] = json.loads(a["payload"])
    return {"actions": actions}


@router.post("/api/plugin/actions/ack", dependencies=[Depends(plugin_auth)])
async def plugin_ack(body: dict):
    ids = [int(i) for i in body.get("ids", [])][:500]
    for i in ids:
        db.execute("UPDATE plugin_actions SET done_at = ? WHERE id = ?", (now_iso(), i))
    return {"ok": True, "acked": len(ids)}


@router.post("/api/plugin/punish", dependencies=[Depends(plugin_auth)])
async def plugin_punish(body: PluginPunish):
    player = db.one("SELECT * FROM players WHERE uuid = ?", (dashed(body.uuid),)) if body.uuid else None
    player = player or await resolve_player(body.name)
    staff = db.one("SELECT * FROM users WHERE mc_name = ? COLLATE NOCASE", (body.staff_name,))
    p = create_punishment(player, body.type, body.reason, body.duration, staff, body.staff_name[:32], source="game",
                          ip=body.ip, silent=body.silent)
    return {"ok": True, "id": p["id"], "uuid": p["uuid"], "name": p["name"], "expires_at": p["expires_at"], "ip": p["ip"],
            "message": kick_message(p) if p["type"] in ("ban", "ipban", "kick") else None}


@router.get("/api/plugin/history/{name}", dependencies=[Depends(plugin_auth)])
async def plugin_history(name: str):
    expire_old()
    player = await resolve_player(name)
    rows = db.query("SELECT * FROM punishments WHERE uuid = ? ORDER BY id DESC LIMIT 20", (player["uuid"],))
    linked = db.one("SELECT id, username FROM users WHERE mc_uuid = ?", (player["uuid"],))
    return {"player": {"uuid": player["uuid"], "name": player["name"], "online": bool(player.get("online")),
                       "last_ip": player.get("last_ip"), "first_seen": player.get("first_seen"), "last_seen": player.get("last_seen")},
            "discord": linked, "punishments": rows}


@router.post("/api/plugin/revoke", dependencies=[Depends(plugin_auth)])
async def plugin_revoke(body: PluginRevoke):
    player = await resolve_player(body.name)
    p = active_of(player["uuid"], body.type)
    if not p:
        raise HTTPException(404, "沒有生效中的此類懲處")
    revoke(p, None, body.staff_name[:32], body.reason, notify_plugin=False)
    return {"ok": True, "id": p["id"]}


@router.post("/api/plugin/link", dependencies=[Depends(plugin_auth)])
async def plugin_link(body: dict):
    code, uuid, name = str(body.get("code", "")).upper().strip(), dashed(str(body.get("uuid", ""))), str(body.get("name", ""))
    row = db.one("SELECT * FROM link_codes WHERE code = ? AND expires_at > ?", (code, now_iso()))
    if not row:
        return {"ok": False, "message": "驗證碼無效或已過期，請回網站重新產生。"}
    other = db.one("SELECT id FROM users WHERE mc_uuid = ? AND id != ?", (uuid, row["user_id"]))
    if other:
        return {"ok": False, "message": "這個 Minecraft 帳號已綁定其他網站帳號。"}
    upsert_player(uuid, name)
    db.execute("UPDATE users SET mc_uuid = ?, mc_name = ?, linked_at = ? WHERE id = ?", (uuid, name, now_iso(), row["user_id"]))
    db.execute("DELETE FROM link_codes WHERE user_id = ?", (row["user_id"],))
    user = db.one("SELECT * FROM users WHERE id = ?", (row["user_id"],))
    db.audit(user, "account.link", f"{name} ({uuid})")
    return {"ok": True, "message": f"綁定成功！已連結 Discord 帳號 {display_name(user)}。", "discord_id": user["id"]}


@router.get("/api/plugin/ping", dependencies=[Depends(plugin_auth)])
async def plugin_ping():
    return {"ok": True, "server": "sawsmp-web"}

