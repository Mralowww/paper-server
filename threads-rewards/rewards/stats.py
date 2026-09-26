"""戰績與排行榜：由 Minecraft 插件回報擊殺 / 對戰，網站提供排行榜、玩家頁與開發者 API。

插件回報：
  POST /api/plugin/kill   {killer:{uuid,name}, victim:{uuid,name}, method}
      method 建議值：crystal / anchor / melee / bow / mace / tnt / fall / other
  POST /api/plugin/match  {winner:{uuid,name}, loser:{uuid,name}, winner_score, loser_score, world, method}
  遊玩時間由 /api/plugin/heartbeat 自動累計。

開發者 API（Header: X-API-Key: saw_xxx，於「我的帳號 → 開發者 API」申請）：
  GET /api/v1/players/{name}   GET /api/v1/leaderboard?sort=kills   GET /api/v1/punishments/{name}
"""
import hashlib
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from . import db
from .deps import current_user
from .punish import dashed, expire_old, now_iso, plugin_auth, pun_public, upsert_player

router = APIRouter()
SORTS = {
    "kills": "s.kills DESC", "kdr": "(CAST(s.kills AS REAL) / MAX(s.deaths, 1)) DESC, s.kills DESC",
    "wins": "s.wins DESC", "streak": "s.best_streak DESC", "playtime": "s.playtime DESC",
    "winrate": "(CAST(s.wins AS REAL) / MAX(s.wins + s.losses, 1)) DESC, s.wins DESC",
}


def tiers() -> list[tuple[int, str]]:
    out = []
    for line in (db.settings().get("rank_tiers") or "").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            if k.strip().isdigit():
                out.append((int(k), v.strip()))
    return sorted(out) or [(0, "戰鬥新手")]


def tier_of(kills: int) -> dict:
    ts = tiers()
    idx = max(i for i, (need, _) in enumerate(ts) if kills >= need) if any(kills >= n for n, _ in ts) else 0
    nxt = ts[idx + 1] if idx + 1 < len(ts) else None
    return {"name": ts[idx][1], "level": idx, "next": nxt and {"name": nxt[1], "kills": nxt[0]}}


def _stat_row(uuid: str) -> dict:
    db.execute("INSERT OR IGNORE INTO player_stats(uuid, updated_at) VALUES (?, ?)", (uuid, now_iso()))
    return db.one("SELECT * FROM player_stats WHERE uuid = ?", (uuid,))


def enrich(s: dict) -> dict:
    s["kdr"] = round(s["kills"] / max(s["deaths"], 1), 2)
    total = s["wins"] + s["losses"]
    s["matches"] = total
    s["winrate"] = round(s["wins"] / total * 100, 1) if total else 0
    s["wl"] = round(s["wins"] / max(s["losses"], 1), 2)
    s["tier"] = tier_of(s["kills"])
    return s


# ---------- 插件回報 ----------

class Who(BaseModel):
    uuid: str
    name: str


class KillIn(BaseModel):
    killer: Who | None = None
    victim: Who
    method: str = "other"


class MatchIn(BaseModel):
    winner: Who
    loser: Who
    winner_score: int = 1
    loser_score: int = 0
    world: str | None = None
    method: str | None = None


@router.post("/api/plugin/kill", dependencies=[Depends(plugin_auth)])
async def plugin_kill(body: KillIn):
    now, method = now_iso(), (body.method or "other")[:24].lower()
    v = dashed(body.victim.uuid)
    upsert_player(v, body.victim.name)
    _stat_row(v)
    db.execute("UPDATE player_stats SET deaths = deaths + 1, streak = 0, updated_at = ? WHERE uuid = ?", (now, v))
    if body.killer:
        k = dashed(body.killer.uuid)
        upsert_player(k, body.killer.name)
        _stat_row(k)
        db.execute("""UPDATE player_stats SET kills = kills + 1, streak = streak + 1,
                      best_streak = MAX(best_streak, streak + 1), updated_at = ? WHERE uuid = ?""", (now, k))
        db.execute("""INSERT INTO kill_methods(uuid, method, count) VALUES (?,?,1)
                      ON CONFLICT(uuid, method) DO UPDATE SET count = count + 1""", (k, method))
    return {"ok": True}


@router.post("/api/plugin/match", dependencies=[Depends(plugin_auth)])
async def plugin_match(body: MatchIn):
    w, lo = dashed(body.winner.uuid), dashed(body.loser.uuid)
    upsert_player(w, body.winner.name); upsert_player(lo, body.loser.name)
    _stat_row(w); _stat_row(lo)
    now = now_iso()
    db.execute("UPDATE player_stats SET wins = wins + 1, updated_at = ? WHERE uuid = ?", (now, w))
    db.execute("UPDATE player_stats SET losses = losses + 1, updated_at = ? WHERE uuid = ?", (now, lo))
    mid = db.execute(
        """INSERT INTO matches(winner_uuid, winner_name, loser_uuid, loser_name, winner_score, loser_score, world, method, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (w, body.winner.name, lo, body.loser.name, body.winner_score, body.loser_score,
         (body.world or "")[:40] or None, (body.method or "")[:24] or None, now))
    return {"ok": True, "id": mid}


# ---------- 公開 ----------

def leaderboard_rows(sort: str, limit: int, q: str = "") -> list[dict]:
    order = SORTS.get(sort, SORTS["kills"])
    where, params = ["(s.kills + s.deaths + s.wins + s.losses) > 0"], []
    if q:
        where.append("p.name LIKE ?"); params.append(f"%{q}%")
    rows = db.query(f"""SELECT s.*, p.name, p.online FROM player_stats s JOIN players p ON p.uuid = s.uuid
                        WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?""", (*params, min(max(limit, 1), 200)))
    return [enrich(r) for r in rows]


@router.get("/api/leaderboard")
async def leaderboard(sort: str = "kills", limit: int = 100, q: str = ""):
    rows = leaderboard_rows(sort, limit, q)
    totals = db.one("""SELECT COUNT(*) AS players, COALESCE(SUM(kills),0) AS kills, COALESCE(SUM(playtime),0) AS playtime
                       FROM player_stats""")
    totals["matches"] = db.one("SELECT COUNT(*) AS c FROM matches WHERE status = 'finished'")["c"]
    totals["online"] = db.one("SELECT COUNT(*) AS c FROM players WHERE online = 1")["c"]
    return {"sort": sort if sort in SORTS else "kills", "players": rows, "totals": totals}


def profile(name: str, match_limit: int = 50) -> dict:
    expire_old()
    p = db.one("SELECT * FROM players WHERE name = ? COLLATE NOCASE", (name,)) or \
        db.one("SELECT * FROM players WHERE uuid = ?", (dashed(name),) if len(name.replace("-", "")) == 32 else ("",))
    if not p:
        raise HTTPException(404, "找不到玩家")
    uuid = p["uuid"]
    stats = enrich(db.one("SELECT * FROM player_stats WHERE uuid = ?", (uuid,)) or
                   {"kills": 0, "deaths": 0, "streak": 0, "best_streak": 0, "wins": 0, "losses": 0, "playtime": 0})
    rank = None
    if stats["kills"]:
        rank = db.one("SELECT COUNT(*) + 1 AS r FROM player_stats WHERE kills > ?", (stats["kills"],))["r"]
    methods = db.query("SELECT method, count FROM kill_methods WHERE uuid = ? ORDER BY count DESC", (uuid,))
    matches = db.query("""SELECT * FROM matches WHERE status = 'finished' AND (winner_uuid = ? OR loser_uuid = ?) ORDER BY id DESC LIMIT ?""",
                       (uuid, uuid, match_limit))
    for m in matches:
        me_won = m["winner_uuid"] == uuid and not m["draw"]
        m.update(won=me_won, opponent=m["loser_name"] if me_won else m["winner_name"],
                 opponent_uuid=m["loser_uuid"] if me_won else m["winner_uuid"],
                 my_score=m["winner_score"] if me_won else m["loser_score"],
                 their_score=m["loser_score"] if me_won else m["winner_score"])
    rivals = db.query(
        """SELECT opp_uuid AS uuid, MAX(opp_name) AS name, SUM(win) AS wins, SUM(1 - win) AS losses, MAX(created_at) AS last
           FROM (SELECT loser_uuid AS opp_uuid, loser_name AS opp_name, 1 AS win, created_at FROM matches WHERE winner_uuid = ? AND status = 'finished' AND draw = 0
                 UNION ALL SELECT winner_uuid, winner_name, 0, created_at FROM matches WHERE loser_uuid = ? AND status = 'finished' AND draw = 0)
           GROUP BY opp_uuid ORDER BY COUNT(*) DESC, last DESC LIMIT 5""", (uuid, uuid))
    linked = db.one("SELECT id FROM users WHERE mc_uuid = ?", (uuid,))
    puns = db.query("""SELECT * FROM punishments WHERE uuid = ? AND silent = 0 AND type != 'kick' ORDER BY id DESC LIMIT 30""", (uuid,))
    return {
        "player": {"uuid": uuid, "name": p["name"], "online": bool(p["online"]), "first_seen": p["first_seen"],
                   "last_seen": p["last_seen"], "linked": bool(linked)},
        "stats": stats, "rank": rank, "methods": methods, "matches": matches, "rivals": rivals,
        "punishments": [pun_public(x) for x in puns],
    }


@router.get("/api/players")
async def search_players(q: str = "", limit: int = 10):
    q = q.strip()
    if not q:
        return {"players": []}
    return {"players": db.query("""SELECT uuid, name, online FROM players WHERE name LIKE ?
                                   ORDER BY name = ? COLLATE NOCASE DESC, online DESC, last_seen DESC LIMIT ?""",
                                (f"%{q}%", q, min(limit, 30)))}


@router.get("/api/profile/{name}")
async def public_profile(name: str):
    return profile(name)


# ---------- 開發者 API Keys ----------

def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class KeyIn(BaseModel):
    name: str


@router.get("/api/me/keys")
async def my_keys(user: dict = Depends(current_user)):
    return {"keys": db.query("SELECT id, name, prefix, created_at, last_used, uses FROM api_keys WHERE user_id = ? ORDER BY id DESC",
                             (user["id"],))}


@router.post("/api/me/keys")
async def create_key(body: KeyIn, user: dict = Depends(current_user)):
    if db.one("SELECT COUNT(*) AS c FROM api_keys WHERE user_id = ?", (user["id"],))["c"] >= 5:
        raise HTTPException(429, "每個帳號最多 5 組 API 金鑰")
    key = "saw_" + secrets.token_urlsafe(30)
    db.execute("INSERT INTO api_keys(user_id, name, prefix, key_hash, created_at) VALUES (?,?,?,?,?)",
               (user["id"], (body.name.strip() or "未命名")[:40], key[:10], _hash(key), now_iso()))
    db.audit(user, "apikey.create", body.name[:40])
    return {"key": key}


@router.delete("/api/me/keys/{key_id}")
async def delete_key(key_id: int, user: dict = Depends(current_user)):
    db.execute("DELETE FROM api_keys WHERE id = ? AND user_id = ?", (key_id, user["id"]))
    return {"ok": True}


def api_key_auth(x_api_key: str = Header(default="")) -> dict:
    if not x_api_key:
        raise HTTPException(401, "missing_api_key：請在 X-API-Key 標頭帶入金鑰")
    row = db.one("SELECT * FROM api_keys WHERE key_hash = ?", (_hash(x_api_key),))
    if not row:
        raise HTTPException(401, "invalid_api_key")
    db.execute("UPDATE api_keys SET last_used = ?, uses = uses + 1 WHERE id = ?", (now_iso(), row["id"]))
    return row


@router.get("/api/v1/players/{name}", dependencies=[Depends(api_key_auth)])
async def v1_player(name: str):
    d = profile(name, match_limit=20)
    d.pop("punishments", None)
    return d


@router.get("/api/v1/leaderboard", dependencies=[Depends(api_key_auth)])
async def v1_leaderboard(sort: str = "kills", limit: int = 50):
    return {"sort": sort, "players": leaderboard_rows(sort, limit)}


@router.get("/api/v1/punishments/{name}", dependencies=[Depends(api_key_auth)])
async def v1_punishments(name: str):
    p = db.one("SELECT uuid, name FROM players WHERE name = ? COLLATE NOCASE", (name,))
    if not p:
        raise HTTPException(404, "not_found")
    expire_old()
    rows = db.query("SELECT * FROM punishments WHERE uuid = ? AND silent = 0 ORDER BY id DESC", (p["uuid"],))
    return {"player": p, "punishments": [pun_public(r) for r in rows]}
