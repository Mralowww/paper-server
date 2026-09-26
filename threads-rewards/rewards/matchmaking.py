"""網頁配對系統：已綁定且在遊戲中上線的玩家可在網頁排隊，湊滿兩人即建立對戰，
由插件把雙方傳送到地表的安全隨機位置。一方死亡／退出遊戲判負，超過時間限制為平手。

插件回報：
  動作 match_start {match_id, a:{uuid,name}, b:{uuid,name}, time_limit}（經由 heartbeat 下發）
  POST /api/plugin/match/started {match_id, world, x, y, z}
  POST /api/plugin/match/end     {match_id, winner_uuid|null, reason: death|quit|timeout}
  POST /api/plugin/match/cancel  {match_id, reason}
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import db
from .deps import current_user
from .punish import active_of, dashed, expire_old, heartbeat_hooks, now_iso, plugin_auth, queue

router = APIRouter()
PENDING_TIMEOUT = 120  # 秒：插件未在時限內開始對戰就取消


def _active_match(uuid: str) -> dict | None:
    return db.one("""SELECT * FROM matches WHERE status IN ('pending', 'active') AND (winner_uuid = ? OR loser_uuid = ?)
                     ORDER BY id DESC LIMIT 1""", (uuid, uuid))


def _cleanup(online: list[str] | None = None) -> None:
    """移除離線玩家的排隊、取消逾時未開始的對戰。"""
    if online is not None:
        rows = db.query("SELECT uuid FROM match_queue")
        for r in rows:
            if r["uuid"] not in online:
                db.execute("DELETE FROM match_queue WHERE uuid = ?", (r["uuid"],))
    limit = db.iso(db.now_utc() - timedelta(seconds=PENDING_TIMEOUT))
    db.execute("""UPDATE matches SET status = 'cancelled', reason = 'start_timeout', ended_at = ?
                  WHERE status = 'pending' AND created_at < ?""", (now_iso(), limit))


heartbeat_hooks.append(_cleanup)


def _try_pair() -> dict | None:
    rows = db.query("SELECT * FROM match_queue ORDER BY joined_at LIMIT 2")
    if len(rows) < 2:
        return None
    a, b = rows
    db.execute("DELETE FROM match_queue WHERE uuid IN (?, ?)", (a["uuid"], b["uuid"]))
    limit = int(db.settings().get("match_time_limit") or 60)
    mid = db.execute(
        """INSERT INTO matches(winner_uuid, winner_name, loser_uuid, loser_name, winner_score, loser_score, world, method,
                               created_at, status) VALUES (?,?,?,?,0,0,NULL,'queue',?,'pending')""",
        (a["uuid"], a["name"], b["uuid"], b["name"], now_iso()))
    queue("match_start", {"match_id": mid, "a": {"uuid": a["uuid"], "name": a["name"]},
                          "b": {"uuid": b["uuid"], "name": b["name"]}, "time_limit": limit * 60})
    return db.one("SELECT * FROM matches WHERE id = ?", (mid,))


def _public_match(m: dict) -> dict:
    return {"id": m["id"], "status": m["status"], "a": {"uuid": m["winner_uuid"], "name": m["winner_name"]},
            "b": {"uuid": m["loser_uuid"], "name": m["loser_name"]}, "world": m["world"], "reason": m["reason"],
            "draw": bool(m["draw"]), "created_at": m["created_at"], "started_at": m["started_at"], "ended_at": m["ended_at"]}


# ---------- 網頁 ----------

@router.get("/api/match/state")
async def state(user: dict = Depends(current_user)):
    _cleanup()
    s = db.settings()
    out = {"enabled": s.get("match_enabled", "1") == "1", "linked": bool(user.get("mc_uuid")), "online": False,
           "queued": None, "match": None, "time_limit": int(s.get("match_time_limit") or 60),
           "queue_size": db.one("SELECT COUNT(*) AS c FROM match_queue")["c"]}
    if user.get("mc_uuid"):
        p = db.one("SELECT online FROM players WHERE uuid = ?", (user["mc_uuid"],))
        out["online"] = bool(p and p["online"])
        q = db.one("SELECT joined_at FROM match_queue WHERE uuid = ?", (user["mc_uuid"],))
        out["queued"] = q and q["joined_at"]
        m = _active_match(user["mc_uuid"])
        out["match"] = m and _public_match(m)
        last = db.one("""SELECT * FROM matches WHERE status = 'finished' AND method = 'queue' AND (winner_uuid = ? OR loser_uuid = ?)
                         ORDER BY id DESC LIMIT 1""", (user["mc_uuid"], user["mc_uuid"]))
        out["last"] = last and dict(_public_match(last), won=not last["draw"] and last["winner_uuid"] == user["mc_uuid"])
    return out


@router.post("/api/match/queue")
async def join(user: dict = Depends(current_user)):
    s = db.settings()
    if s.get("match_enabled", "1") != "1":
        raise HTTPException(403, "配對系統目前關閉中")
    uuid = user.get("mc_uuid")
    if not uuid:
        raise HTTPException(400, "請先在「我的帳號」綁定 Minecraft 帳號")
    p = db.one("SELECT * FROM players WHERE uuid = ?", (uuid,))
    if not p or not p["online"]:
        raise HTTPException(400, "你必須在遊戲中上線才能配對")
    expire_old()
    if active_of(uuid, "ban"):
        raise HTTPException(403, "你目前被封鎖，無法配對")
    if _active_match(uuid):
        raise HTTPException(409, "你已經在一場對戰中")
    db.execute("INSERT OR IGNORE INTO match_queue(uuid, user_id, name, joined_at) VALUES (?,?,?,?)",
               (uuid, user["id"], p["name"], now_iso()))
    m = _try_pair()
    return {"ok": True, "matched": bool(m and uuid in (m["winner_uuid"], m["loser_uuid"])), "match": m and _public_match(m)}


@router.delete("/api/match/queue")
async def leave(user: dict = Depends(current_user)):
    if user.get("mc_uuid"):
        db.execute("DELETE FROM match_queue WHERE uuid = ?", (user["mc_uuid"],))
    return {"ok": True}


@router.get("/api/match/live")
async def live():
    _cleanup()
    active = db.query("SELECT * FROM matches WHERE status IN ('pending', 'active') ORDER BY id DESC LIMIT 20")
    recent = db.query("SELECT * FROM matches WHERE status = 'finished' ORDER BY id DESC LIMIT 12")
    return {"queue_size": db.one("SELECT COUNT(*) AS c FROM match_queue")["c"],
            "online": db.one("SELECT COUNT(*) AS c FROM players WHERE online = 1")["c"],
            "active": [_public_match(m) for m in active], "recent": [_public_match(m) for m in recent]}


# ---------- 插件 ----------

class StartedIn(BaseModel):
    match_id: int
    world: str | None = None
    x: float | None = None
    y: float | None = None
    z: float | None = None


class EndIn(BaseModel):
    match_id: int
    winner_uuid: str | None = None
    reason: str = "death"


class CancelIn(BaseModel):
    match_id: int
    reason: str = "cancelled"


@router.post("/api/plugin/match/started", dependencies=[Depends(plugin_auth)])
async def started(body: StartedIn):
    m = db.one("SELECT * FROM matches WHERE id = ?", (body.match_id,))
    if not m or m["status"] != "pending":
        raise HTTPException(409, "對戰狀態不正確")
    db.execute("UPDATE matches SET status = 'active', started_at = ?, world = ? WHERE id = ?",
               (now_iso(), (body.world or "")[:40] or None, body.match_id))
    return {"ok": True}


@router.post("/api/plugin/match/end", dependencies=[Depends(plugin_auth)])
async def end(body: EndIn):
    m = db.one("SELECT * FROM matches WHERE id = ?", (body.match_id,))
    if not m or m["status"] not in ("pending", "active"):
        raise HTTPException(409, "對戰狀態不正確")
    now = now_iso()
    reason = body.reason if body.reason in ("death", "quit", "timeout") else "death"
    winner = dashed(body.winner_uuid) if body.winner_uuid else None
    if winner and winner not in (m["winner_uuid"], m["loser_uuid"]):
        raise HTTPException(400, "勝者不屬於這場對戰")
    if not winner:
        db.execute("UPDATE matches SET status = 'finished', draw = 1, reason = ?, ended_at = ? WHERE id = ?", (reason, now, m["id"]))
        return {"ok": True, "draw": True}
    loser = m["loser_uuid"] if winner == m["winner_uuid"] else m["winner_uuid"]
    names = {m["winner_uuid"]: m["winner_name"], m["loser_uuid"]: m["loser_name"]}
    db.execute("""UPDATE matches SET status = 'finished', winner_uuid = ?, winner_name = ?, loser_uuid = ?, loser_name = ?,
                  winner_score = 1, loser_score = 0, reason = ?, ended_at = ? WHERE id = ?""",
               (winner, names[winner], loser, names[loser], reason, now, m["id"]))
    for uuid, col in ((winner, "wins"), (loser, "losses")):
        db.execute("INSERT OR IGNORE INTO player_stats(uuid, updated_at) VALUES (?, ?)", (uuid, now))
        db.execute(f"UPDATE player_stats SET {col} = {col} + 1, updated_at = ? WHERE uuid = ?", (now, uuid))
    return {"ok": True, "winner": names[winner], "loser": names[loser]}


@router.post("/api/plugin/match/cancel", dependencies=[Depends(plugin_auth)])
async def cancel(body: CancelIn):
    db.execute("UPDATE matches SET status = 'cancelled', reason = ?, ended_at = ? WHERE id = ? AND status IN ('pending', 'active')",
               (body.reason[:40], now_iso(), body.match_id))
    return {"ok": True}
