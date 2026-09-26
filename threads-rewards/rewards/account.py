"""帳號中心：網站（Discord 登入）↔ Minecraft 綁定，查看自己的懲處。"""
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends

from . import db
from .deps import current_user

router = APIRouter()
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉易混淆字元


@router.get("/api/account")
async def account(user: dict = Depends(current_user)):
    code = db.one("SELECT code, expires_at FROM link_codes WHERE user_id = ? AND expires_at > ?",
                  (user["id"], db.iso(db.now_utc())))
    punishments, player = [], None
    if user.get("mc_uuid"):
        player = db.one("SELECT uuid, name, first_seen, last_seen, online FROM players WHERE uuid = ?", (user["mc_uuid"],))
        punishments = db.query("""SELECT id, type, reason, staff_name, created_at, expires_at, active FROM punishments
                                  WHERE uuid = ? AND type != 'kick' ORDER BY id DESC""", (user["mc_uuid"],))
        appealed = {r["punishment_id"] for r in db.query(
            "SELECT punishment_id FROM tickets WHERE user_id = ? AND punishment_id IS NOT NULL", (user["id"],))}
        for p in punishments:
            p["appealed"] = p["id"] in appealed
    return {
        "mc": {"uuid": user["mc_uuid"], "name": user["mc_name"], "linked_at": user["linked_at"]} if user.get("mc_uuid") else None,
        "player": player, "code": code, "punishments": punishments,
        "tickets": db.one("SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status != 'closed'", (user["id"],))["c"],
    }


@router.post("/api/account/link-code")
async def link_code(user: dict = Depends(current_user)):
    db.execute("DELETE FROM link_codes WHERE user_id = ? OR expires_at <= ?", (user["id"], db.iso(db.now_utc())))
    code = "".join(secrets.choice(ALPHABET) for _ in range(6))
    expires = db.iso(db.now_utc() + timedelta(minutes=10))
    db.execute("INSERT INTO link_codes(code, user_id, expires_at) VALUES (?,?,?)", (code, user["id"], expires))
    return {"code": code, "expires_at": expires}


@router.delete("/api/account/link")
async def unlink(user: dict = Depends(current_user)):
    db.execute("UPDATE users SET mc_uuid = NULL, mc_name = NULL, linked_at = NULL WHERE id = ?", (user["id"],))
    db.audit(user, "account.unlink", user.get("mc_name") or "")
    return {"ok": True}
