"""支援單系統：玩家在網頁開單、與客服即時對話，新單與回覆由 Discord 機器人通知。"""
import asyncio
import json
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from . import activity, config, db
from .deps import MOD, SUPPORT, current_user, display_name, public_user, require, user_level

router = APIRouter()
CATEGORIES = ("report", "bug", "connection", "sponsor", "appeal", "other")
STATUSES = ("open", "answered", "closed")
PRIORITIES = ("low", "normal", "high", "urgent")
MAX_OPEN = 3
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
notify_hook = None  # bot.py 設定：async (ticket, event, message) -> None


def now_iso() -> str:
    return db.iso(db.now_utc())


def _notify(ticket: dict, event: str, message: str = "") -> None:
    if notify_hook:
        asyncio.create_task(notify_hook(ticket, event, message))


def _clean_attachments(items: list[str]) -> list[str]:
    out = []
    for a in items[:6]:
        if isinstance(a, str) and a.startswith("/uploads/") and "/" not in a[len("/uploads/"):]:
            out.append(a)
    return out


async def _load(ticket_id: int, request: Request, user: dict) -> tuple[dict, int]:
    t = db.one("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
    if not t:
        raise HTTPException(404, "找不到支援單")
    level = await user_level(request, user)
    if t["user_id"] != user["id"] and level < SUPPORT:
        raise HTTPException(403, "無法查看此支援單")
    return t, level


def _unread_sql(staff: bool) -> str:
    return f"""(SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND COALESCE(m.author_id, '') != ?
               AND m.id > COALESCE((SELECT last_id FROM ticket_reads r WHERE r.user_id = ? AND r.ticket_id = t.id), 0)
               {'' if staff else 'AND m.internal = 0'})"""


def _row(t: dict) -> dict:
    t["user"] = public_user({"id": t["user_id"], "username": t.pop("username", "") or "?",
                             "global_name": t.pop("global_name", None), "avatar": t.pop("avatar", None)})
    return t


# ---------- 上傳 ----------

@router.post("/api/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(current_user)):
    ext = IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "只接受 PNG / JPG / GIF / WebP 圖片")
    data = await file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "圖片不可超過 5MB")
    name = f"{secrets.token_urlsafe(12)}{ext}"
    Path(config.UPLOAD_DIR, name).write_bytes(data)
    db.audit(user, "upload", name)
    return {"url": f"/uploads/{name}"}


# ---------- 玩家端 ----------

class TicketIn(BaseModel):
    category: str
    subject: str
    body: str
    target: str | None = None
    punishment_id: int | None = None
    attachments: list[str] = []
    fields: dict = {}


class MessageIn(BaseModel):
    body: str = ""
    attachments: list[str] = []
    internal: bool = False


class StatusIn(BaseModel):
    status: str | None = None
    urgent: bool | None = None
    claim: bool | None = None
    priority: str | None = None


@router.get("/api/tickets")
async def my_tickets(user: dict = Depends(current_user)):
    for_user = db.query(
        f"""SELECT t.*, {_unread_sql(False)} AS unread,
                   (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id AND m.internal = 0 ORDER BY id DESC LIMIT 1) AS last_body
            FROM tickets t WHERE t.user_id = ? ORDER BY t.status = 'closed', t.updated_at DESC""",
        (user["id"], user["id"], user["id"]))
    return {"tickets": for_user, "banned": bool(user.get("ticket_banned")),
            "violations": [x for x in (db.settings().get("violation_types") or "").splitlines() if x.strip()]}


@router.post("/api/tickets")
async def create_ticket(body: TicketIn, user: dict = Depends(current_user)):
    if body.category not in CATEGORIES:
        raise HTTPException(400, "請選擇分類")
    if user.get("ticket_banned"):
        raise HTTPException(403, "你已被禁止開立支援單，如有疑問請聯絡管理團隊")
    subject, text = body.subject.strip()[:120], body.body.strip()[:5000]
    if not subject or not text:
        raise HTTPException(400, "請填寫標題與內容")
    open_count = db.one("SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status != 'closed'", (user["id"],))["c"]
    if open_count >= MAX_OPEN:
        raise HTTPException(429, f"你同時最多只能有 {MAX_OPEN} 張處理中的支援單")
    target = (body.target or "").strip()[:16] or None
    pid = None
    if body.category == "appeal":
        if not body.punishment_id:
            raise HTTPException(400, "請選擇要申訴的懲處")
        pun = db.one("SELECT * FROM punishments WHERE id = ?", (body.punishment_id,))
        if not pun or pun["uuid"] != user.get("mc_uuid"):
            raise HTTPException(400, "只能申訴自己綁定的 Minecraft 帳號的懲處")
        pid = pun["id"]
    if body.category == "report" and not target:
        raise HTTPException(400, "請填寫檢舉對象的玩家名稱")
    now = now_iso()
    fields = {k: str(v)[:120] for k, v in (body.fields or {}).items() if k in ("violation", "world", "when", "version", "amount") and v}
    tid = db.execute(
        """INSERT INTO tickets(user_id, category, subject, target, punishment_id, fields, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""", (user["id"], body.category, subject, target, pid, json.dumps(fields, ensure_ascii=False), now, now))
    mid = db.execute("INSERT INTO ticket_messages(ticket_id, author_id, body, attachments, created_at) VALUES (?,?,?,?,?)",
                     (tid, user["id"], text, json.dumps(_clean_attachments(body.attachments)), now))
    db.execute("INSERT OR REPLACE INTO ticket_reads VALUES (?,?,?)", (user["id"], tid, mid))
    t = db.one("SELECT * FROM tickets WHERE id = ?", (tid,))
    _notify(dict(t, author=display_name(user)), "new", text)
    return {"ok": True, "id": tid}


@router.get("/api/tickets/{ticket_id}")
async def get_ticket(ticket_id: int, request: Request, after: int = 0, user: dict = Depends(current_user)):
    t, level = await _load(ticket_id, request, user)
    staff = level >= SUPPORT
    msgs = db.query(
        f"""SELECT m.*, u.username, u.global_name, u.avatar FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
            WHERE m.ticket_id = ? AND m.id > ? {'' if staff else 'AND m.internal = 0'} ORDER BY m.id""",
        (ticket_id, after))
    for m in msgs:
        m["attachments"] = json.loads(m["attachments"] or "[]")
        m["author"] = public_user({"id": m["author_id"], "username": m.pop("username"), "global_name": m.pop("global_name"),
                                   "avatar": m.pop("avatar")}) if m["author_id"] and m.get("username") else None
        m.pop("username", None); m.pop("global_name", None); m.pop("avatar", None)
    if msgs:
        db.execute("INSERT OR REPLACE INTO ticket_reads VALUES (?,?,?)", (user["id"], ticket_id, msgs[-1]["id"]))
    owner = db.one("SELECT * FROM users WHERE id = ?", (t["user_id"],))
    extra = {}
    if t["punishment_id"]:
        extra["punishment"] = db.one("SELECT id, type, name, uuid, reason, staff_name, created_at, expires_at, active FROM punishments WHERE id = ?",
                                     (t["punishment_id"],))
    t["fields"] = json.loads(t.get("fields") or "{}")
    if t["target"]:
        tp = db.one("SELECT uuid, name FROM players WHERE name = ? COLLATE NOCASE", (t["target"],))
        extra["target_player"] = tp
        if staff and tp:
            extra["target_history"] = db.query("SELECT id, type, reason, created_at, active FROM punishments WHERE uuid = ? ORDER BY id DESC LIMIT 10",
                                               (tp["uuid"],))
    if staff:
        extra["owner_banned"] = bool(owner and owner.get("ticket_banned"))
        extra["canned"] = [x for x in (db.settings().get("canned_replies") or "").splitlines() if x.strip()]
        extra["owner_mc"] = owner and owner.get("mc_name") and {"name": owner["mc_name"], "uuid": owner["mc_uuid"]}
        claimer = t["claimed_by"] and db.one("SELECT * FROM users WHERE id = ?", (t["claimed_by"],))
        extra["claimed"] = public_user(claimer) if claimer else None
    return {"ticket": t, "owner": public_user(owner), "messages": msgs, "staff": staff, "level": level, **extra}


@router.post("/api/tickets/{ticket_id}/messages")
async def post_message(ticket_id: int, body: MessageIn, request: Request, user: dict = Depends(current_user)):
    t, level = await _load(ticket_id, request, user)
    staff = level >= SUPPORT
    text, atts = body.body.strip()[:5000], _clean_attachments(body.attachments)
    if not text and not atts:
        raise HTTPException(400, "訊息不可為空")
    if t["status"] == "closed" and not staff:
        raise HTTPException(400, "支援單已關閉")
    internal = body.internal and staff
    now = now_iso()
    mid = db.execute(
        "INSERT INTO ticket_messages(ticket_id, author_id, body, attachments, staff, internal, created_at) VALUES (?,?,?,?,?,?,?)",
        (ticket_id, user["id"], text, json.dumps(atts), int(staff and t["user_id"] != user["id"]), int(internal), now))
    if not internal:
        status = "answered" if staff and t["user_id"] != user["id"] else "open"
        db.execute("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?", (status, now, ticket_id))
        if status == "open":
            _notify(dict(t, author=display_name(user)), "reply", text)
    db.execute("INSERT OR REPLACE INTO ticket_reads VALUES (?,?,?)", (user["id"], ticket_id, mid))
    return {"ok": True, "id": mid}


@router.post("/api/tickets/{ticket_id}/status")
async def set_status(ticket_id: int, body: StatusIn, request: Request, user: dict = Depends(current_user)):
    t, level = await _load(ticket_id, request, user)
    staff = level >= SUPPORT
    now, notes = now_iso(), []
    before = {k: t.get(k) for k in ("status", "urgent", "priority", "claimed_by")}
    if body.status is not None:
        if body.status not in STATUSES or (not staff and body.status not in ("closed", "open")):
            raise HTTPException(400, "不允許的狀態")
        if not staff and body.status == "open" and t["status"] != "closed":
            raise HTTPException(400, "支援單尚未關閉")
        db.execute("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?", (body.status, now, ticket_id))
        notes.append({"closed": "已關閉支援單", "open": "重新開啟支援單", "answered": "標記為已回覆"}[body.status])
    if staff and body.urgent is not None:
        db.execute("UPDATE tickets SET urgent = ? WHERE id = ?", (int(body.urgent), ticket_id))
        notes.append("標記為緊急" if body.urgent else "取消緊急")
    if staff and body.priority is not None:
        if body.priority not in PRIORITIES:
            raise HTTPException(400, "優先度不正確")
        db.execute("UPDATE tickets SET priority = ?, urgent = ? WHERE id = ?", (body.priority, int(body.priority == "urgent"), ticket_id))
        notes.append(f"優先度改為 {dict(low='低', normal='一般', high='高', urgent='緊急')[body.priority]}")
    if staff and body.claim is not None:
        db.execute("UPDATE tickets SET claimed_by = ? WHERE id = ?", (user["id"] if body.claim else None, ticket_id))
        notes.append("接手此支援單" if body.claim else "釋出此支援單")
    for n in notes:
        db.execute("INSERT INTO ticket_messages(ticket_id, author_id, body, system, created_at) VALUES (?,?,?,1,?)",
                   (ticket_id, user["id"], n, now))
    if notes:
        after = db.one("SELECT status, urgent, priority, claimed_by FROM tickets WHERE id = ?", (ticket_id,))
        b, a = activity.diff(before, after)
        db.audit(user, "ticket.update", f"#{ticket_id} " + "、".join(notes), target=ticket_id, before=b, after=a)
    return {"ok": True}


# ---------- 客服端 ----------

@router.get("/api/staff/tickets")
async def staff_tickets(status: str = "active", category: str = "", q: str = "", mine: int = 0,
                        staff: dict = Depends(require(SUPPORT))):
    where, params = [], [staff["id"], staff["id"]]
    if status == "active":
        where.append("t.status != 'closed'")
    elif status in STATUSES:
        where.append("t.status = ?"); params.append(status)
    if category in CATEGORIES:
        where.append("t.category = ?"); params.append(category)
    if mine:
        where.append("t.claimed_by = ?"); params.append(staff["id"])
    if q:
        where.append("(t.subject LIKE ? OR t.target LIKE ? OR u.username LIKE ? OR u.global_name LIKE ? OR CAST(t.id AS TEXT) = ?)")
        params += [f"%{q}%"] * 4 + [q.lstrip("#")]
    rows = db.query(
        f"""SELECT t.*, u.username, u.global_name, u.avatar, {_unread_sql(True)} AS unread,
                   (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY id DESC LIMIT 1) AS last_body,
                   (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.system = 0) AS msg_count
            FROM tickets t JOIN users u ON u.id = t.user_id
            {'WHERE ' + ' AND '.join(where) if where else ''}
            ORDER BY t.status = 'closed', CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                     t.updated_at DESC LIMIT 200""",
        tuple(params))
    counts = {r["status"]: r["c"] for r in db.query("SELECT status, COUNT(*) AS c FROM tickets GROUP BY status")}
    return {"tickets": [_row(r) for r in rows], "counts": counts}


@router.delete("/api/staff/tickets/{ticket_id}")
async def delete_ticket(ticket_id: int, staff: dict = Depends(require(MOD))):
    db.execute("DELETE FROM ticket_messages WHERE ticket_id = ?", (ticket_id,))
    db.execute("DELETE FROM ticket_reads WHERE ticket_id = ?", (ticket_id,))
    db.execute("DELETE FROM tickets WHERE id = ?", (ticket_id,))
    db.audit(staff, "ticket.delete", f"#{ticket_id}")
    return {"ok": True}


@router.post("/api/staff/ticket-ban/{user_id}")
async def ticket_ban(user_id: str, body: dict, staff: dict = Depends(require(SUPPORT))):
    banned = bool(body.get("banned", True))
    db.execute("UPDATE users SET ticket_banned = ? WHERE id = ?", (int(banned), user_id))
    db.audit(staff, "ticket.ban" if banned else "ticket.unban", user_id)
    return {"ok": True}


@router.get("/api/staff/ticket-bans")
async def ticket_bans(_: dict = Depends(require(SUPPORT))):
    return {"users": [public_user(u) for u in db.query("SELECT * FROM users WHERE ticket_banned = 1")]}
