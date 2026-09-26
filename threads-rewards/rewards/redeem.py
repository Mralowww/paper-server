"""兌換碼：管理員設定獎品（遊戲內執行的指令），玩家在網站輸入兌換碼，插件在遊戲內發獎。

兌換碼形式：
  public  公開碼：一個碼大家共用，每人限兌 per_user 次，可設總次數上限
  single  一次性碼：批量產生 N 個不同的碼，每個碼只能用一次
  player  指定玩家碼：只有名單內的 Minecraft 玩家能兌換
  role    身分限定碼：需要指定的 Discord 身分（贊助者 / 加成者）或段位以上

玩家必須：登入網站、已綁定 Minecraft 帳號、當下在遊戲內線上。發獎由插件執行，結果回報後才算兌換成功；
失敗（離線、插件沒回應）不會佔用次數。
"""
import asyncio
import csv
import io
import json
import re
import secrets
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from . import activity, db, security
from .deps import ADMIN, current_user, require
from .punish import now_iso, plugin_auth, plugin_last_seen, queue

router = APIRouter()
KINDS = ("public", "single", "player", "role")
ROLES = ("sponsor", "booster")
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{2,39}$")
PENDING_TIMEOUT = 60  # 秒：插件沒回報結果就視為失敗，不佔用次數
SCHEMA = """
CREATE TABLE IF NOT EXISTS redeem_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
    commands TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
    max_uses INTEGER NOT NULL DEFAULT 0, per_user INTEGER NOT NULL DEFAULT 1,
    starts_at TEXT, ends_at TEXT, active INTEGER NOT NULL DEFAULT 1,
    players TEXT NOT NULL DEFAULT '', roles TEXT NOT NULL DEFAULT '', min_tier INTEGER NOT NULL DEFAULT -1,
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS redeem_codes (
    code TEXT PRIMARY KEY, reward_id INTEGER NOT NULL, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_reward ON redeem_codes(reward_id);
CREATE TABLE IF NOT EXISTS redeem_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reward_id INTEGER NOT NULL, code TEXT NOT NULL, user_id TEXT NOT NULL, mc_uuid TEXT NOT NULL, mc_name TEXT,
    status TEXT NOT NULL, reason TEXT, ip TEXT, created_at TEXT NOT NULL, done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_redeem_log_reward ON redeem_log(reward_id, status);
CREATE INDEX IF NOT EXISTS idx_redeem_log_user ON redeem_log(user_id);
"""
_ready = False
_lock = asyncio.Lock()
LIVE = "status IN ('pending','delivered')"


def ensure_schema() -> None:
    global _ready
    if not _ready:
        db.conn().executescript(SCHEMA)
        _ready = True


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def gen_code(prefix: str = "") -> str:
    body = "-".join("".join(secrets.choice(ALPHABET) for _ in range(4)) for _ in range(3))
    return f"{prefix}-{body}" if prefix else body


def norm(code: str) -> str:
    return re.sub(r"\s+", "", code or "").upper()[:40]


def expire_pending() -> None:
    """超過時間沒收到插件回報的兌換 → 失敗（插件離線或版本太舊）。"""
    ensure_schema()
    cutoff = datetime.fromtimestamp(time.time() - PENDING_TIMEOUT, timezone.utc).isoformat(timespec="seconds")
    db.execute("UPDATE redeem_log SET status = 'failed', reason = 'timeout', done_at = ? WHERE status = 'pending' AND created_at < ?",
               (now_iso(), cutoff))


def _reward_public(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "description": r["description"], "kind": r["kind"]}


def _online(uuid: str) -> bool:
    p = db.one("SELECT online FROM players WHERE uuid = ?", (uuid,))
    return bool(p and p["online"]) and time.time() - plugin_last_seen() < 30


# ---------- 玩家 ----------

@router.get("/api/redeem/status")
async def my_status(request: Request):
    ensure_schema(); expire_pending()
    uid = request.session.get("uid")
    u = db.one("SELECT * FROM users WHERE id = ?", (uid,)) if uid else None
    if not u:
        return {"logged_in": False, "plugin_online": time.time() - plugin_last_seen() < 30}
    hist = db.query("""SELECT l.id, l.code, l.status, l.reason, l.created_at, l.done_at, r.name, r.description FROM redeem_log l
                       LEFT JOIN redeem_rewards r ON r.id = l.reward_id WHERE l.user_id = ? ORDER BY l.id DESC LIMIT 30""", (u["id"],))
    for h in hist:
        h["code"] = _mask(h["code"])
    return {"logged_in": True, "linked": bool(u["mc_uuid"]), "mc_name": u["mc_name"], "mc_uuid": u["mc_uuid"],
            "online": bool(u["mc_uuid"]) and _online(u["mc_uuid"]), "plugin_online": time.time() - plugin_last_seen() < 30, "history": hist}


def _mask(code: str) -> str:
    return code if len(code) <= 6 else code[:4] + "•" * (len(code) - 6) + code[-2:]


class RedeemIn(BaseModel):
    code: str


def _fail(uid: str, status: int, msg: str, count: bool = True):
    if count:
        security.ratelimit(f"redeem-bad:{uid}", 15, 3600, "錯誤次數太多，請一小時後再試")
    raise HTTPException(status, msg)


@router.post("/api/redeem")
async def redeem(body: RedeemIn, request: Request, user: dict = Depends(current_user)):
    ensure_schema(); expire_pending()
    security.ratelimit(f"redeem:{user['id']}", 6, 60, "兌換太頻繁，請稍後再試")
    code = norm(body.code)
    if not CODE_RE.match(code):
        _fail(user["id"], 400, "兌換碼格式不正確")
    u = db.one("SELECT * FROM users WHERE id = ?", (user["id"],))
    if not u["mc_uuid"]:
        raise HTTPException(400, "請先到「我的帳號」綁定 Minecraft 帳號")
    async with _lock:
        c = db.one("SELECT * FROM redeem_codes WHERE code = ?", (code,))
        r = c and db.one("SELECT * FROM redeem_rewards WHERE id = ?", (c["reward_id"],))
        if not c or not r:
            _fail(user["id"], 404, "兌換碼無效")
        if c["disabled"] or not r["active"]:
            _fail(user["id"], 410, "這個兌換碼已停用")
        now = _now()
        if (s := _parse(r["starts_at"])) and now < s:
            _fail(user["id"], 403, "兌換活動尚未開始", count=False)
        if (e := _parse(r["ends_at"])) and now >= e:
            _fail(user["id"], 410, "這個兌換碼已過期")
        # 資格
        if r["kind"] == "player":
            names = {n.strip().lower() for n in re.split(r"[\s,，、]+", r["players"]) if n.strip()}
            if (u["mc_name"] or "").lower() not in names and u["mc_uuid"].lower() not in names:
                _fail(user["id"], 403, "這個兌換碼不是給你的")
        if r["kind"] == "role":
            from .roles import badges_of  # noqa: PLC0415
            need = [x for x in (r["roles"] or "").split(",") if x in ROLES]
            if need and not set(need) & set(badges_of(u)):
                _fail(user["id"], 403, "你沒有兌換這個獎品需要的身分（" + "、".join({"sponsor": "贊助者", "booster": "加成者"}[x] for x in need) + "）", count=False)
            if r["min_tier"] >= 0:
                from .stats import tier_of, tiers  # noqa: PLC0415
                st = db.one("SELECT kills FROM player_stats WHERE uuid = ?", (u["mc_uuid"],))
                if tier_of((st or {}).get("kills", 0))["level"] < r["min_tier"]:
                    ts = tiers()
                    _fail(user["id"], 403, f"需要段位「{ts[min(r['min_tier'], len(ts) - 1)]['name']}」以上才能兌換", count=False)
        # 次數
        mine = db.one(f"SELECT COUNT(*) AS n FROM redeem_log WHERE reward_id = ? AND (user_id = ? OR mc_uuid = ?) AND {LIVE}",
                      (r["id"], u["id"], u["mc_uuid"]))["n"]
        if mine >= max(1, r["per_user"]):
            _fail(user["id"], 409, "你已經兌換過這個獎品了", count=False)
        if r["kind"] == "single" and db.one(f"SELECT 1 FROM redeem_log WHERE code = ? AND {LIVE}", (code,)):
            _fail(user["id"], 409, "這個兌換碼已經被使用過了")
        if r["max_uses"] > 0 and db.one(f"SELECT COUNT(*) AS n FROM redeem_log WHERE reward_id = ? AND {LIVE}", (r["id"],))["n"] >= r["max_uses"]:
            _fail(user["id"], 410, "這個獎品已經被兌換完了", count=False)
        if not _online(u["mc_uuid"]):
            raise HTTPException(409, f"請先登入遊戲（{u['mc_name']}），在線上才能領取獎品")
        cmds = [x.strip().lstrip("/") for x in r["commands"].splitlines() if x.strip()]
        ip = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else None)
        lid = db.execute("INSERT INTO redeem_log(reward_id, code, user_id, mc_uuid, mc_name, status, ip, created_at) VALUES (?,?,?,?,?,?,?,?)",
                         (r["id"], code, u["id"], u["mc_uuid"], u["mc_name"], "pending", ip, now_iso()))
        queue("redeem", {"log_id": lid, "uuid": u["mc_uuid"], "name": u["mc_name"], "reward": r["name"], "commands": cmds, "message": r["message"]})
    activity.write(user, "redeem.request", r["name"], category="account", target=str(r["id"]), meta={"code": _mask(code), "log_id": lid})
    return {"ok": True, "log_id": lid, "reward": _reward_public(r)}


@router.get("/api/redeem/{log_id}")
async def redeem_state(log_id: int, user: dict = Depends(current_user)):
    ensure_schema(); expire_pending()
    row = db.one("SELECT id, status, reason, done_at, reward_id FROM redeem_log WHERE id = ? AND user_id = ?", (log_id, user["id"]))
    if not row:
        raise HTTPException(404, "找不到這筆兌換")
    return row


class ResultIn(BaseModel):
    log_id: int
    ok: bool
    reason: str | None = None
    executed: int | None = None


@router.post("/api/plugin/redeem-result", dependencies=[Depends(plugin_auth)])
async def plugin_result(body: ResultIn):
    ensure_schema()
    row = db.one("SELECT * FROM redeem_log WHERE id = ?", (body.log_id,))
    if not row:
        return {"ok": False}
    status = "delivered" if body.ok else "failed"
    db.execute("UPDATE redeem_log SET status = ?, reason = ?, done_at = ? WHERE id = ? AND status IN ('pending','failed')",
               (status, (body.reason or "")[:80] or None, now_iso(), body.log_id))
    activity.write(None, "redeem.delivered" if body.ok else "redeem.failed", row["mc_name"] or "", category="account",
                   target=str(row["reward_id"]), meta={"log_id": body.log_id, "reason": body.reason, "executed": body.executed})
    return {"ok": True}


# ---------- 管理 ----------

class RewardIn(BaseModel):
    name: str
    description: str = ""
    kind: str = "public"
    code: str | None = None          # public / player / role：自訂代碼（空白 = 自動產生）
    count: int = 1                   # single：產生幾個碼
    prefix: str = ""                 # single：代碼前綴
    commands: str = ""
    message: str = ""
    max_uses: int = 0
    per_user: int = 1
    starts_at: str | None = None
    ends_at: str | None = None
    active: bool = True
    players: str = ""
    roles: list[str] = []
    min_tier: int = -1


def _clean(b: RewardIn) -> dict:
    if b.kind not in KINDS:
        raise HTTPException(400, "兌換碼形式不正確")
    if not b.name.strip():
        raise HTTPException(400, "請輸入獎品名稱")
    cmds = [x.strip() for x in b.commands.splitlines() if x.strip()]
    if not cmds:
        raise HTTPException(400, "請至少設定一個發獎指令")
    if len(cmds) > 30 or any(len(x) > 400 for x in cmds):
        raise HTTPException(400, "指令太多或太長")
    for ts in (b.starts_at, b.ends_at):
        if ts and not _parse(ts):
            raise HTTPException(400, "時間格式不正確")
    if b.starts_at and b.ends_at and _parse(b.starts_at) >= _parse(b.ends_at):
        raise HTTPException(400, "結束時間必須晚於開始時間")
    if b.kind == "player" and not b.players.strip():
        raise HTTPException(400, "請輸入可以兌換的玩家名稱")
    roles = [r for r in b.roles if r in ROLES]
    if b.kind == "role" and not roles and b.min_tier < 0:
        raise HTTPException(400, "請選擇需要的身分或段位")
    return {"name": b.name.strip()[:60], "description": b.description.strip()[:300], "kind": b.kind, "commands": "\n".join(cmds),
            "message": b.message.strip()[:200], "max_uses": max(0, b.max_uses), "per_user": max(1, min(b.per_user, 1000)),
            "starts_at": b.starts_at or None, "ends_at": b.ends_at or None, "active": int(b.active),
            "players": b.players.strip()[:2000], "roles": ",".join(roles), "min_tier": max(-1, min(b.min_tier, 50))}


def _add_codes(reward_id: int, n: int, prefix: str) -> list[str]:
    prefix = re.sub(r"[^A-Z0-9]", "", prefix.upper())[:10]
    out, now = [], now_iso()
    while len(out) < n:
        c = gen_code(prefix)
        if not db.one("SELECT 1 FROM redeem_codes WHERE code = ?", (c,)):
            db.execute("INSERT INTO redeem_codes(code, reward_id, created_at) VALUES (?,?,?)", (c, reward_id, now))
            out.append(c)
    return out


def _stats(r: dict) -> dict:
    s = db.one(f"""SELECT COALESCE(SUM(status = 'delivered'), 0) AS delivered, COALESCE(SUM(status = 'pending'), 0) AS pending,
                          COALESCE(SUM(status = 'failed'), 0) AS failed, COUNT(DISTINCT CASE WHEN {LIVE} THEN user_id END) AS users
                   FROM redeem_log WHERE reward_id = ?""", (r["id"],))
    codes = db.one("SELECT COUNT(*) AS n FROM redeem_codes WHERE reward_id = ?", (r["id"],))["n"]
    first = db.one("SELECT code FROM redeem_codes WHERE reward_id = ? ORDER BY rowid LIMIT 1", (r["id"],))
    now, st, en = _now(), _parse(r["starts_at"]), _parse(r["ends_at"])
    used = s["delivered"] + s["pending"]
    state = "off" if not r["active"] else "scheduled" if st and now < st else "ended" if en and now >= en else \
        "soldout" if (r["max_uses"] and used >= r["max_uses"]) or (r["kind"] == "single" and codes and used >= codes) else "live"
    return dict(r, **s, used=used, codes=codes, code=first and first["code"] if r["kind"] != "single" else None, state=state,
                roles=[x for x in (r["roles"] or "").split(",") if x])


@router.get("/api/admin/redeem")
async def admin_list(_: dict = Depends(require(ADMIN))):
    ensure_schema(); expire_pending()
    rows = [_stats(r) for r in db.query("SELECT * FROM redeem_rewards ORDER BY id DESC")]
    return {"rewards": rows, "plugin_online": time.time() - plugin_last_seen() < 30}


@router.post("/api/admin/redeem")
async def admin_create(body: RewardIn, admin: dict = Depends(require(ADMIN))):
    ensure_schema()
    v = _clean(body)
    code = None
    if body.kind != "single":
        code = norm(body.code or "") or gen_code()
        if not CODE_RE.match(code):
            raise HTTPException(400, "代碼只能用英文、數字、- 或 _（3–40 字）")
        if db.one("SELECT 1 FROM redeem_codes WHERE code = ?", (code,)):
            raise HTTPException(409, "這個代碼已經存在")
    elif not 1 <= body.count <= 5000:
        raise HTTPException(400, "一次性碼數量需介於 1–5000")
    rid = db.execute(f"""INSERT INTO redeem_rewards({', '.join(v)}, created_by, created_at) VALUES ({', '.join('?' * (len(v) + 2))})""",
                     (*v.values(), admin["id"], now_iso()))
    codes = _add_codes(rid, body.count, body.prefix) if body.kind == "single" else []
    if code:
        db.execute("INSERT INTO redeem_codes(code, reward_id, created_at) VALUES (?,?,?)", (code, rid, now_iso()))
    activity.write(admin, "redeem.create", v["name"], category="admin", target=str(rid),
                   after={k: v[k] for k in ("kind", "max_uses", "per_user", "starts_at", "ends_at", "commands")}, meta={"codes": len(codes) or 1})
    return {"ok": True, "id": rid, "code": code, "codes": codes[:50], "count": len(codes)}


@router.put("/api/admin/redeem/{rid}")
async def admin_update(rid: int, body: RewardIn, admin: dict = Depends(require(ADMIN))):
    ensure_schema()
    old = db.one("SELECT * FROM redeem_rewards WHERE id = ?", (rid,))
    if not old:
        raise HTTPException(404, "找不到獎品")
    v = _clean(body)
    v["kind"] = old["kind"]  # 形式建立後不能改
    db.execute(f"UPDATE redeem_rewards SET {', '.join(f'{k} = ?' for k in v)}, updated_at = ? WHERE id = ?", (*v.values(), now_iso(), rid))
    if old["kind"] != "single" and body.code and norm(body.code) != (db.one("SELECT code FROM redeem_codes WHERE reward_id = ?", (rid,)) or {}).get("code"):
        nc = norm(body.code)
        if not CODE_RE.match(nc) or db.one("SELECT 1 FROM redeem_codes WHERE code = ?", (nc,)):
            raise HTTPException(409, "代碼格式不正確或已存在")
        db.execute("UPDATE redeem_codes SET code = ? WHERE reward_id = ?", (nc, rid))
    b, a = activity.diff({k: old[k] for k in v}, v)
    activity.write(admin, "redeem.update", v["name"], category="admin", target=str(rid), before=b, after=a)
    return {"ok": True}


class ActiveIn(BaseModel):
    active: bool


@router.patch("/api/admin/redeem/{rid}")
async def admin_toggle(rid: int, body: ActiveIn, admin: dict = Depends(require(ADMIN))):
    ensure_schema()
    r = db.one("SELECT name, active FROM redeem_rewards WHERE id = ?", (rid,))
    if not r:
        raise HTTPException(404, "找不到獎品")
    db.execute("UPDATE redeem_rewards SET active = ?, updated_at = ? WHERE id = ?", (int(body.active), now_iso(), rid))
    activity.write(admin, "redeem.enable" if body.active else "redeem.disable", r["name"], category="admin", target=str(rid),
                   before={"active": bool(r["active"])}, after={"active": body.active})
    return {"ok": True}


@router.delete("/api/admin/redeem/{rid}")
async def admin_delete(rid: int, admin: dict = Depends(require(ADMIN))):
    ensure_schema()
    r = db.one("SELECT name FROM redeem_rewards WHERE id = ?", (rid,))
    if not r:
        raise HTTPException(404, "找不到獎品")
    db.execute("DELETE FROM redeem_codes WHERE reward_id = ?", (rid,))
    db.execute("DELETE FROM redeem_rewards WHERE id = ?", (rid,))
    activity.write(admin, "redeem.delete", r["name"], category="admin", target=str(rid))
    return {"ok": True}


class MoreIn(BaseModel):
    count: int
    prefix: str = ""


@router.post("/api/admin/redeem/{rid}/codes")
async def admin_more(rid: int, body: MoreIn, admin: dict = Depends(require(ADMIN))):
    ensure_schema()
    r = db.one("SELECT name, kind FROM redeem_rewards WHERE id = ?", (rid,))
    if not r or r["kind"] != "single":
        raise HTTPException(400, "只有一次性碼可以追加")
    if not 1 <= body.count <= 5000:
        raise HTTPException(400, "數量需介於 1–5000")
    codes = _add_codes(rid, body.count, body.prefix)
    activity.write(admin, "redeem.codes", r["name"], category="admin", target=str(rid), meta={"added": len(codes)})
    return {"ok": True, "codes": codes[:50], "count": len(codes)}


def _codes(rid: int) -> list[dict]:
    return db.query(f"""SELECT c.code, c.created_at, c.disabled, l.mc_name AS used_by, l.done_at AS used_at, l.status
                        FROM redeem_codes c LEFT JOIN redeem_log l ON l.id = (SELECT MAX(id) FROM redeem_log WHERE code = c.code AND {LIVE})
                        WHERE c.reward_id = ? ORDER BY c.rowid""", (rid,))


@router.get("/api/admin/redeem/{rid}/codes")
async def admin_codes(rid: int, _: dict = Depends(require(ADMIN))):
    ensure_schema()
    return {"codes": _codes(rid)}


@router.get("/api/admin/redeem/{rid}/codes.csv")
async def admin_codes_csv(rid: int, admin: dict = Depends(require(ADMIN))):
    ensure_schema()
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["code", "used_by", "used_at", "status"])
    for c in _codes(rid):
        w.writerow([c["code"], c["used_by"] or "", c["used_at"] or "", c["status"] or "unused"])
    activity.write(admin, "redeem.export", str(rid), category="admin", target=str(rid))
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="redeem-{rid}.csv"'})


@router.get("/api/admin/redeem-logs")
async def admin_logs(reward_id: int | None = None, limit: int = 100, _: dict = Depends(require(ADMIN))):
    ensure_schema(); expire_pending()
    where, params = ("WHERE l.reward_id = ?", (reward_id,)) if reward_id else ("", ())
    rows = db.query(f"""SELECT l.*, r.name AS reward, u.global_name, u.username FROM redeem_log l LEFT JOIN redeem_rewards r ON r.id = l.reward_id
                        LEFT JOIN users u ON u.id = l.user_id {where} ORDER BY l.id DESC LIMIT ?""", (*params, min(max(limit, 1), 500)))
    return {"logs": rows}
