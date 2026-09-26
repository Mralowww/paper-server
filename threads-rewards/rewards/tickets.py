"""支援單系統：玩家在網頁開單、與客服即時對話，新單與回覆由 Discord 機器人通知。"""
import asyncio
import json
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from . import activity, config, db, discord_api, push
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


def ensure_schema() -> None:
    cols = {r["name"] for r in db.query("PRAGMA table_info(ticket_messages)")}
    for name, ddl in [("reply_to", "INTEGER"), ("deleted_at", "TEXT"), ("deleted_by", "TEXT"), ("forwarded", "TEXT")]:
        if name not in cols:
            db.execute(f"ALTER TABLE ticket_messages ADD COLUMN {name} {ddl}")
    db.execute("""CREATE TABLE IF NOT EXISTS ticket_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, subject TEXT NOT NULL, owner_id TEXT, owner_name TEXT,
        closed_by TEXT, closed_by_name TEXT, reason TEXT, transcript TEXT NOT NULL, message_count INTEGER NOT NULL, created_at TEXT NOT NULL)""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_tlogs_ticket ON ticket_logs(ticket_id)")


def _push_new(t: dict, author: str, text: str, event: str) -> None:
    """新單 / 玩家回覆 → 推播給客服；客服回覆 → 推播給開單玩家。"""
    url = f"/desk#{t['id']}"
    if event == "new":
        push.fire(push.staff_ids(), {"title": f"新客服單 #{t['id']}", "body": f"{author}：{t['subject']}\n{text[:120]}", "url": url, "tag": f"ticket-{t['id']}"}, "tickets")
    elif event == "reply":
        push.fire(push.staff_ids(), {"title": f"客服單 #{t['id']} 有新回覆", "body": f"{author}：{text[:140]}", "url": url, "tag": f"ticket-{t['id']}"}, "tickets")
    elif event == "staff_reply":
        push.fire([t["user_id"]], {"title": f"你的客服單 #{t['id']} 有新回覆", "body": text[:160], "url": f"/ticket?id={t['id']}", "tag": f"ticket-{t['id']}"}, "replies")


class MessageIn(BaseModel):
    reply_to: int | None = None
    body: str = ""
    attachments: list[str] = []
    internal: bool = False


class StatusIn(BaseModel):
    reason: str | None = None
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
    _push_new(t, display_name(user), text, "new")
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
    for m in msgs:
        m["forwarded"] = json.loads(m["forwarded"]) if m.get("forwarded") else None
        if m.get("deleted_at") and not staff:
            m["body"], m["attachments"] = "", []
        if m.get("reply_to"):
            q = db.one("SELECT m.id, m.body, m.deleted_at, m.internal, u.username, u.global_name FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ? AND m.ticket_id = ?",
                       (m["reply_to"], ticket_id))
            m["reply"] = q and (staff or not q["internal"]) and {"id": q["id"], "name": q["global_name"] or q["username"] or "?",
                                                                 "body": "" if q["deleted_at"] and not staff else q["body"][:140], "deleted": bool(q["deleted_at"])}
    if msgs and not (request.query_params.get("peek") == "1"):
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
        extra["logs"] = db.query("SELECT id, closed_by_name, reason, message_count, created_at FROM ticket_logs WHERE ticket_id = ? ORDER BY id DESC", (ticket_id,))
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
    reply_to = body.reply_to if body.reply_to and db.one("SELECT 1 FROM ticket_messages WHERE id = ? AND ticket_id = ?", (body.reply_to, ticket_id)) else None
    now = now_iso()
    mid = db.execute(
        "INSERT INTO ticket_messages(ticket_id, author_id, body, attachments, staff, internal, reply_to, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (ticket_id, user["id"], text, json.dumps(atts), int(staff and t["user_id"] != user["id"]), int(internal), reply_to, now))
    if not internal:
        status = "answered" if staff and t["user_id"] != user["id"] else "open"
        db.execute("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?", (status, now, ticket_id))
        if status == "open":
            _notify(dict(t, author=display_name(user)), "reply", text)
            _push_new(t, display_name(user), text, "reply")
        else:
            _push_new(t, display_name(user), text, "staff_reply")
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
        if body.status == "closed" and t["status"] != "closed":
            await close_ticket(t, user, (body.reason or "").strip()[:500])
        else:
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


# ---------- 關單：保存紀錄 + Discord 私訊通知 ----------

def _transcript(ticket_id: int) -> list[dict]:
    rows = db.query("""SELECT m.*, u.username, u.global_name FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
                       WHERE m.ticket_id = ? ORDER BY m.id""", (ticket_id,))
    return [{"id": r["id"], "author_id": r["author_id"], "author": r["global_name"] or r["username"] or ("系統" if r["system"] else "?"),
             "body": r["body"], "attachments": json.loads(r["attachments"] or "[]"), "staff": bool(r["staff"]), "internal": bool(r["internal"]),
             "system": bool(r["system"]), "reply_to": r.get("reply_to"), "deleted_at": r.get("deleted_at"), "deleted_by": r.get("deleted_by"),
             "forwarded": json.loads(r["forwarded"]) if r.get("forwarded") else None, "created_at": r["created_at"]} for r in rows]


async def close_ticket(t: dict, user: dict, reason: str) -> int:
    now = now_iso()
    closer = display_name(user)
    note = "已關閉支援單" + (f"：{reason}" if reason else "")
    db.execute("UPDATE tickets SET status = 'closed', updated_at = ? WHERE id = ?", (now, t["id"]))
    db.execute("INSERT INTO ticket_messages(ticket_id, author_id, body, system, created_at) VALUES (?,?,?,1,?)", (t["id"], user["id"], note, now))
    owner = db.one("SELECT * FROM users WHERE id = ?", (t["user_id"],))
    msgs = _transcript(t["id"])
    log_id = db.execute(
        """INSERT INTO ticket_logs(ticket_id, subject, owner_id, owner_name, closed_by, closed_by_name, reason, transcript, message_count, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (t["id"], t["subject"], t["user_id"], owner and (owner.get("global_name") or owner.get("username")), user["id"], closer,
         reason or None, json.dumps({"ticket": {k: t.get(k) for k in ("id", "category", "subject", "target", "priority", "created_at")}, "messages": msgs},
                                    ensure_ascii=False), sum(1 for m in msgs if not m["system"]), now))
    db.audit(user, "ticket.close", f"#{t['id']} {t['subject']}" + (f" — {reason}" if reason else ""), target=t["id"], meta={"log_id": log_id})
    # 由客服關單時私訊通知玩家（不附對話紀錄）
    if t["user_id"] != user["id"]:
        embed = {"title": f"你的客服單 #{t['id']} 已關閉", "color": 0x97C8C7,
                 "description": f"**{t['subject']}**", "fields": [{"name": "關閉原因", "value": reason or "未提供原因"},
                                                                  {"name": "處理人員", "value": closer, "inline": True}],
                 "footer": {"text": "鋸齒 SMP 客服中心 · 如有需要可在網站重新開啟或開立新的客服單"}, "url": f"{config.PUBLIC_URL}/ticket?id={t['id']}"}
        async def _dm():
            try:
                await discord_api.dm(t["user_id"], embed=embed)
            except Exception:  # noqa: BLE001
                import logging
                logging.getLogger("rewards.tickets").warning("關單私訊失敗 #%s", t["id"], exc_info=True)
        asyncio.create_task(_dm())
        push.fire([t["user_id"]], {"title": f"客服單 #{t['id']} 已關閉", "body": reason or t["subject"], "url": f"/ticket?id={t['id']}", "tag": f"ticket-{t['id']}"}, "replies")
    return log_id


class CloseIn(BaseModel):
    reason: str = ""


@router.post("/api/tickets/{ticket_id}/close")
async def close(ticket_id: int, body: CloseIn, request: Request, user: dict = Depends(current_user)):
    t, level = await _load(ticket_id, request, user)
    if t["status"] == "closed":
        raise HTTPException(400, "支援單已經關閉")
    log_id = await close_ticket(t, user, body.reason.strip()[:500])
    return {"ok": True, "log_id": log_id}


@router.post("/api/tickets/{ticket_id}/read")
async def mark_read(ticket_id: int, body: dict, request: Request, user: dict = Depends(current_user)):
    await _load(ticket_id, request, user)
    last = int(body.get("last_id") or 0) or (db.one("SELECT MAX(id) AS m FROM ticket_messages WHERE ticket_id = ?", (ticket_id,))["m"] or 0)
    if body.get("unread"):
        prev = db.one("SELECT MAX(id) AS m FROM ticket_messages WHERE ticket_id = ? AND id < ?", (ticket_id, last))["m"] or 0
        last = prev
    db.execute("INSERT OR REPLACE INTO ticket_reads VALUES (?,?,?)", (user["id"], ticket_id, last))
    return {"ok": True, "last_id": last}


@router.delete("/api/tickets/{ticket_id}/messages/{mid}")
async def delete_message(ticket_id: int, mid: int, request: Request, user: dict = Depends(current_user)):
    t, level = await _load(ticket_id, request, user)
    m = db.one("SELECT * FROM ticket_messages WHERE id = ? AND ticket_id = ?", (mid, ticket_id))
    if not m or m["system"]:
        raise HTTPException(404, "找不到訊息")
    if m["deleted_at"]:
        raise HTTPException(400, "訊息已經刪除")
    if level < SUPPORT and m["author_id"] != user["id"]:
        raise HTTPException(403, "只能刪除自己的訊息")
    db.execute("UPDATE ticket_messages SET deleted_at = ?, deleted_by = ? WHERE id = ?", (now_iso(), display_name(user), mid))
    db.audit(user, "ticket.message.delete", f"#{ticket_id} 訊息 {mid}", target=ticket_id, before={"body": m["body"], "attachments": json.loads(m["attachments"] or "[]")})
    return {"ok": True}


class ForwardIn(BaseModel):
    to: int
    visible: bool = False   # 預設轉成內部備註，只有客服看得到
    note: str = ""


@router.post("/api/staff/tickets/{ticket_id}/messages/{mid}/forward")
async def forward_message(ticket_id: int, mid: int, body: ForwardIn, staff: dict = Depends(require(SUPPORT))):
    m = db.one("""SELECT m.*, u.username, u.global_name FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
                  WHERE m.id = ? AND m.ticket_id = ?""", (mid, ticket_id))
    if not m or m["system"] or m["deleted_at"]:
        raise HTTPException(404, "找不到訊息")
    dst = db.one("SELECT * FROM tickets WHERE id = ?", (body.to,))
    if not dst or body.to == ticket_id:
        raise HTTPException(404, "找不到目標客服單")
    now = now_iso()
    meta = {"ticket": ticket_id, "message": mid, "author": m["global_name"] or m["username"] or "?", "created_at": m["created_at"], "by": display_name(staff)}
    text = (body.note.strip() + "\n\n" if body.note.strip() else "") + m["body"]
    new_id = db.execute(
        "INSERT INTO ticket_messages(ticket_id, author_id, body, attachments, staff, internal, forwarded, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (body.to, staff["id"], text[:5000], m["attachments"], 1, int(not body.visible), json.dumps(meta, ensure_ascii=False), now))
    db.execute("UPDATE tickets SET updated_at = ? WHERE id = ?", (now, body.to))
    db.audit(staff, "ticket.message.forward", f"#{ticket_id} → #{body.to}", target=body.to, meta={**meta, "visible": body.visible})
    return {"ok": True, "id": new_id}


@router.get("/api/staff/tickets/{ticket_id}/logs/{log_id}")
async def ticket_log(ticket_id: int, log_id: int, _: dict = Depends(require(SUPPORT))):
    r = db.one("SELECT * FROM ticket_logs WHERE id = ? AND ticket_id = ?", (log_id, ticket_id))
    if not r:
        raise HTTPException(404, "找不到紀錄")
    r["transcript"] = json.loads(r["transcript"])
    return r


@router.get("/api/staff/tickets/{ticket_id}/logs/{log_id}/download")
async def ticket_log_txt(ticket_id: int, log_id: int, _: dict = Depends(require(SUPPORT))):
    from fastapi.responses import PlainTextResponse
    r = db.one("SELECT * FROM ticket_logs WHERE id = ? AND ticket_id = ?", (log_id, ticket_id))
    if not r:
        raise HTTPException(404, "找不到紀錄")
    tr = json.loads(r["transcript"])
    lines = [f"鋸齒 SMP 客服單 #{ticket_id}：{r['subject']}", f"開單者：{r['owner_name']}  關閉者：{r['closed_by_name']}  關閉時間：{r['created_at']}",
             f"關閉原因：{r['reason'] or '未提供'}", "=" * 60]
    for m in tr["messages"]:
        tag = "[系統]" if m["system"] else "[內部備註]" if m["internal"] else "[客服]" if m["staff"] else ""
        extra = (f"（已由 {m['deleted_by']} 刪除）" if m["deleted_at"] else "") + (f"（轉發自 #{m['forwarded']['ticket']}）" if m.get("forwarded") else "")
        lines.append(f"[{m['created_at']}] {tag}{m['author']}{extra}：{m['body']}" + (f"  附件：{' '.join(m['attachments'])}" if m["attachments"] else ""))
    return PlainTextResponse("\n".join(lines), headers={"Content-Disposition": f"attachment; filename=ticket-{ticket_id}-log-{log_id}.txt"})


@router.get("/api/staff/ticket-logs")
async def all_logs(q: str = "", _: dict = Depends(require(SUPPORT))):
    where, args = "", ()
    if q:
        where, args = "WHERE subject LIKE ? OR owner_name LIKE ? OR CAST(ticket_id AS TEXT) = ?", (f"%{q}%", f"%{q}%", q.lstrip("#"))
    return {"logs": db.query(f"SELECT id, ticket_id, subject, owner_name, closed_by_name, reason, message_count, created_at FROM ticket_logs {where} ORDER BY id DESC LIMIT 200", args)}


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
