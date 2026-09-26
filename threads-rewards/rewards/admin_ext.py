"""後台擴充：總覽、遊戲權限節點、帳號綁定管理、團隊、網站狀態、插件金鑰。"""
import os
import platform
import re
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import bot, config, db, discord_api
from .deps import ADMIN, MOD, SUPPORT, display_name, public_user, require
from .punish import dashed, expire_old, now_iso, plugin_auth, plugin_last_seen, queue, resolve_player

router = APIRouter()
STARTED = time.time()
WEB_GROUPS = [("all", "所有玩家"), ("linked", "已綁定的玩家"), ("level:1", "客服以上"), ("level:2", "管理員以上"), ("level:3", "超級管理員")]
NODE_RE = re.compile(r"^-?[a-z0-9_.*-]{1,120}$", re.I)


# ---------- 總覽 ----------

@router.get("/api/staff/overview")
async def overview(staff: dict = Depends(require(SUPPORT))):
    expire_old()
    return {
        "level": staff["level"],
        "tickets": {r["status"]: r["c"] for r in db.query("SELECT status, COUNT(*) AS c FROM tickets GROUP BY status")},
        "urgent": db.one("SELECT COUNT(*) AS c FROM tickets WHERE status != 'closed' AND priority IN ('urgent','high')")["c"],
        "punishments": {r["type"]: r["c"] for r in db.query("SELECT type, COUNT(*) AS c FROM punishments WHERE active = 1 GROUP BY type")},
        "players": db.one("SELECT COUNT(*) AS total, COALESCE(SUM(online),0) AS online FROM players"),
        "linked": db.one("SELECT COUNT(*) AS c FROM users WHERE mc_uuid IS NOT NULL")["c"],
        "users": db.one("SELECT COUNT(*) AS c FROM users")["c"],
        "recent_punishments": db.query("SELECT id, type, name, uuid, reason, staff_name, created_at, active FROM punishments ORDER BY id DESC LIMIT 8"),
        "recent_tickets": db.query("""SELECT t.id, t.category, t.subject, t.status, t.priority, t.updated_at, u.username, u.global_name
                                      FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.status != 'closed'
                                      ORDER BY t.updated_at DESC LIMIT 8"""),
        "plugin_online": time.time() - plugin_last_seen() < 60,
    }


# ---------- 遊戲權限 ----------

class NodesIn(BaseModel):
    nodes: list[dict]


class GroupIn(BaseModel):
    role_id: str


def _groups() -> list[dict]:
    counts = {r["group_key"]: r["c"] for r in db.query("SELECT group_key, COUNT(*) AS c FROM perm_nodes GROUP BY group_key")}
    out = [{"key": k, "name": n, "kind": "web", "count": counts.get(k, 0)} for k, n in WEB_GROUPS]
    out += [{"key": g["group_key"], "name": g["name"], "color": g["color"], "kind": "discord", "count": counts.get(g["group_key"], 0)}
            for g in db.query("SELECT * FROM perm_groups ORDER BY name")]
    return out


@router.get("/api/admin/permissions")
async def permissions(_: dict = Depends(require(ADMIN))):
    nodes: dict[str, list] = {}
    for r in db.query("SELECT * FROM perm_nodes ORDER BY node"):
        nodes.setdefault(r["group_key"], []).append({"node": r["node"], "allow": bool(r["allow"])})
    try:
        roles = await discord_api.guild_roles()
    except Exception:  # noqa: BLE001
        roles = []
    return {"groups": _groups(), "nodes": nodes, "discord_roles": roles}


@router.put("/api/admin/permissions/{group_key}")
async def save_nodes(group_key: str, body: NodesIn, admin: dict = Depends(require(ADMIN))):
    valid = {k for k, _ in WEB_GROUPS} | {g["group_key"] for g in db.query("SELECT group_key FROM perm_groups")}
    if group_key not in valid:
        raise HTTPException(404, "找不到身分")
    clean = {}
    for n in body.nodes[:300]:
        raw = str(n.get("node", "")).strip()
        node = raw.lstrip("-")
        if not NODE_RE.match(node):
            raise HTTPException(400, f"權限節點格式不正確：{node}")
        clean[node.lower()] = bool(n.get("allow", True)) and not raw.startswith("-")
    db.execute("DELETE FROM perm_nodes WHERE group_key = ?", (group_key,))
    for node, allow in clean.items():
        db.execute("INSERT INTO perm_nodes(group_key, node, allow) VALUES (?,?,?)", (group_key, node, int(allow)))
    queue("permissions_reload", {"group": group_key})
    db.audit(admin, "permissions.save", f"{group_key} ({len(clean)})")
    return {"ok": True}


@router.post("/api/admin/permissions/groups")
async def add_group(body: GroupIn, admin: dict = Depends(require(ADMIN))):
    roles = {r["id"]: r for r in await discord_api.guild_roles()}
    role = roles.get(body.role_id)
    if not role:
        raise HTTPException(404, "找不到 Discord 身分組")
    db.execute("INSERT OR REPLACE INTO perm_groups(group_key, name, color) VALUES (?,?,?)",
               (f"role:{role['id']}", role["name"], role["color"]))
    db.audit(admin, "permissions.group.add", role["name"])
    return {"ok": True, "key": f"role:{role['id']}"}


@router.delete("/api/admin/permissions/groups/{group_key}")
async def remove_group(group_key: str, admin: dict = Depends(require(ADMIN))):
    if not group_key.startswith("role:"):
        raise HTTPException(400, "網站身分不可移除")
    db.execute("DELETE FROM perm_nodes WHERE group_key = ?", (group_key,))
    db.execute("DELETE FROM perm_groups WHERE group_key = ?", (group_key,))
    queue("permissions_reload", {"group": group_key})
    db.audit(admin, "permissions.group.remove", group_key)
    return {"ok": True}


@router.get("/api/plugin/permissions/{uuid}", dependencies=[Depends(plugin_auth)])
async def player_permissions(uuid: str):
    """插件在玩家進服或收到 permissions_reload 時呼叫，取得該玩家應有的權限節點（拒絕優先）。"""
    uuid = dashed(uuid)
    user = db.one("SELECT * FROM users WHERE mc_uuid = ?", (uuid,))
    groups = ["all"]
    if user:
        groups.append("linked")
        groups += [f"level:{n}" for n in range(1, (user.get("level") or 0) + 1)]
        try:
            groups += [f"role:{r}" for r in await discord_api.member_role_ids(user["id"])]
        except Exception:  # noqa: BLE001
            pass
    rows = db.query(f"SELECT node, allow FROM perm_nodes WHERE group_key IN ({','.join('?' * len(groups))})", tuple(groups))
    deny = {r["node"] for r in rows if not r["allow"]}
    allow = sorted({r["node"] for r in rows if r["allow"]} - deny)
    return {"uuid": uuid, "groups": groups, "allow": allow, "deny": sorted(deny)}


# ---------- 帳號綁定管理 ----------

class LinkIn(BaseModel):
    user_id: str
    player: str


@router.get("/api/admin/links")
async def links(q: str = "", _: dict = Depends(require(MOD))):
    where, params = "", ()
    if q:
        where = "AND (username LIKE ? OR global_name LIKE ? OR mc_name LIKE ? OR id = ?)"
        params = (f"%{q}%", f"%{q}%", f"%{q}%", q)
    rows = db.query(f"SELECT * FROM users WHERE 1=1 {where} ORDER BY mc_uuid IS NULL, linked_at DESC, last_login DESC LIMIT 200", params)
    return {"users": [dict(public_user(u), mc_uuid=u["mc_uuid"], mc_name=u["mc_name"], linked_at=u["linked_at"],
                           level=u.get("level") or 0, ticket_banned=bool(u.get("ticket_banned"))) for u in rows]}


@router.post("/api/admin/links")
async def manual_link(body: LinkIn, staff: dict = Depends(require(MOD))):
    if not db.one("SELECT 1 FROM users WHERE id = ?", (body.user_id,)):
        raise HTTPException(404, "找不到網站帳號")
    p = await resolve_player(body.player)
    if db.one("SELECT 1 FROM users WHERE mc_uuid = ? AND id != ?", (p["uuid"], body.user_id)):
        raise HTTPException(409, "這個 Minecraft 帳號已綁定其他帳號")
    db.execute("UPDATE users SET mc_uuid = ?, mc_name = ?, linked_at = ? WHERE id = ?", (p["uuid"], p["name"], now_iso(), body.user_id))
    db.audit(staff, "link.manual", f"{body.user_id} → {p['name']}")
    from .account import sync_linked_role
    await sync_linked_role(body.user_id, True)
    return {"ok": True}


@router.delete("/api/admin/links/{user_id}")
async def manual_unlink(user_id: str, staff: dict = Depends(require(MOD))):
    db.execute("UPDATE users SET mc_uuid = NULL, mc_name = NULL, linked_at = NULL WHERE id = ?", (user_id,))
    db.audit(staff, "link.remove", user_id)
    from .account import sync_linked_role
    await sync_linked_role(user_id, False)
    return {"ok": True}


# ---------- 團隊 ----------

@router.get("/api/admin/team")
async def team(_: dict = Depends(require(SUPPORT))):
    rows = db.query("SELECT * FROM users WHERE level >= 1 ORDER BY level DESC, last_login DESC")
    stats = {r["staff_id"]: r["c"] for r in db.query("SELECT staff_id, COUNT(*) AS c FROM punishments WHERE staff_id IS NOT NULL GROUP BY staff_id")}
    replies = {r["author_id"]: r["c"] for r in db.query("SELECT author_id, COUNT(*) AS c FROM ticket_messages WHERE staff = 1 GROUP BY author_id")}
    return {"team": [dict(public_user(u), level=u["level"], last_login=u["last_login"], mc_name=u["mc_name"],
                          punishments=stats.get(u["id"], 0), replies=replies.get(u["id"], 0)) for u in rows],
            "roles": {"support": sorted(config.SUPPORT_ROLE_IDS), "mod": sorted(config.MOD_ROLE_IDS), "admin": sorted(config.ADMIN_ROLE_IDS)}}


# ---------- 網站狀態 / 儲存空間 ----------

def _dir_size(path: str) -> tuple[int, int]:
    total = count = 0
    for f in Path(path).glob("*"):
        if f.is_file():
            total += f.stat().st_size; count += 1
    return total, count


@router.get("/api/admin/status")
async def status(_: dict = Depends(require(ADMIN))):
    db_size = sum(os.path.getsize(p) for p in (config.DATABASE_PATH, config.DATABASE_PATH + "-wal") if os.path.exists(p))
    up_size, up_count = _dir_size(config.UPLOAD_DIR)
    last = plugin_last_seen()
    return {
        "uptime": int(time.time() - STARTED), "python": platform.python_version(),
        "db_bytes": db_size, "uploads_bytes": up_size, "uploads_count": up_count,
        "bot": {"configured": bool(config.DISCORD_BOT_TOKEN), "ready": bot.bot.is_ready(),
                "latency_ms": round(bot.bot.latency * 1000) if bot.bot.is_ready() else None,
                "name": str(bot.bot.user) if bot.bot.user else None},
        "plugin": {"configured": bool(config.setting_or_env("plugin_api_key", config.PLUGIN_API_KEY)),
                   "online": time.time() - last < 60, "last_seen": int(time.time() - last) if last else None,
                   "pending": db.one("SELECT COUNT(*) AS c FROM plugin_actions WHERE done_at IS NULL")["c"]},
        "oauth": bool(config.DISCORD_CLIENT_ID and config.DISCORD_CLIENT_SECRET),
        "counts": {t: db.one(f"SELECT COUNT(*) AS c FROM {t}")["c"] for t in
                   ("users", "players", "punishments", "tickets", "ticket_messages", "matches", "links", "news")},
    }


@router.post("/api/admin/uploads/cleanup")
async def cleanup_uploads(admin: dict = Depends(require(ADMIN))):
    """刪除沒有被任何訊息引用的上傳圖片。"""
    used = set()
    for r in db.query("SELECT attachments FROM ticket_messages WHERE attachments != '[]'"):
        used |= {a.rsplit("/", 1)[-1] for a in __import__("json").loads(r["attachments"])}
    removed = 0
    for f in Path(config.UPLOAD_DIR).glob("*"):
        if f.is_file() and f.name not in used and time.time() - f.stat().st_mtime > 3600:
            f.unlink(); removed += 1
    db.audit(admin, "uploads.cleanup", str(removed))
    return {"ok": True, "removed": removed}


@router.post("/api/admin/plugin-key")
async def regen_plugin_key(admin: dict = Depends(require(ADMIN))):
    key = "sawp_" + secrets.token_urlsafe(32)
    db.set_settings({"plugin_api_key": key})
    db.audit(admin, "plugin.key.regenerate", display_name(admin))
    return {"key": key}


@router.get("/api/admin/discord-roles")
async def discord_roles(_: dict = Depends(require(ADMIN))):
    try:
        return {"roles": await discord_api.guild_roles()}
    except Exception:  # noqa: BLE001
        return {"roles": []}


@router.get("/api/staff/presets")
async def presets(_: dict = Depends(require(SUPPORT))):
    s = db.settings()
    split = lambda k: [x.strip() for x in (s.get(k) or "").splitlines() if x.strip()]  # noqa: E731
    return {"reasons": split("reason_presets"), "canned": split("canned_replies"), "violations": split("violation_types")}


@router.get("/api/admin/links/{user_id}")
async def link_detail(user_id: str, _: dict = Depends(require(MOD))):
    from datetime import datetime, timezone
    from .stats import enrich
    u = db.one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not u:
        raise HTTPException(404, "找不到網站帳號")
    try:
        dd = await discord_api.member_detail(user_id)
    except Exception:  # noqa: BLE001
        dd = {"created_at": None, "in_guild": None, "joined_at": None, "roles": []}
    if dd.get("created_at"):
        dd["created_at"] = datetime.fromtimestamp(dd["created_at"], timezone.utc).isoformat(timespec="seconds")
    mc = None
    if u["mc_uuid"]:
        p = db.one("SELECT * FROM players WHERE uuid = ?", (u["mc_uuid"],)) or {"uuid": u["mc_uuid"], "name": u["mc_name"], "online": 0, "last_seen": None, "first_seen": None}
        st = db.one("SELECT * FROM player_stats WHERE uuid = ?", (u["mc_uuid"],))
        stats = enrich(st) if st else None
        rank = db.one("SELECT COUNT(*) + 1 AS r FROM player_stats WHERE kills > ?", (st["kills"],))["r"] if st and st["kills"] else None
        mc = {"uuid": p["uuid"], "name": p["name"], "online": bool(p.get("online")), "last_seen": p.get("last_seen"),
              "first_seen": p.get("first_seen"), "linked_at": u["linked_at"], "stats": stats, "rank": rank,
              "names": db.query("SELECT name, first_seen FROM player_names WHERE uuid = ? ORDER BY first_seen DESC", (p["uuid"],))}
    tickets = db.query("SELECT id, category, subject, status, created_at FROM tickets WHERE user_id = ? ORDER BY id DESC LIMIT 30", (user_id,))
    puns = db.query("SELECT * FROM punishments WHERE uuid = ? ORDER BY id DESC LIMIT 30", (u["mc_uuid"],)) if u["mc_uuid"] else []
    audit = db.query("SELECT * FROM audit_log WHERE actor_id = ? OR detail LIKE ? ORDER BY id DESC LIMIT 30", (user_id, f"%{user_id}%"))
    return {"user": dict(public_user(u), level=u.get("level") or 0, ticket_banned=bool(u.get("ticket_banned")),
                         created_at=u["created_at"], last_login=u["last_login"]),
            "discord": dd, "mc": mc, "tickets": tickets, "punishments": puns, "audit": audit}
