"""資料同步：一鍵對齊 Minecraft、網站、Discord 三邊的狀態。

- 網站：處理到期的懲處、統計資料
- Discord：重新確認每個帳號的管理等級、補上 / 移除 linked 身分組、封禁 / 禁言身分組
- Minecraft：插件踢出仍被封禁的線上玩家、清掉原版與 AdvancedBan 裡已在網站解除的紀錄、重載權限、重新同步戰績
"""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException

from . import account, activity, config, db, discord_api
from .deps import ADMIN, require
from .punish import expire_old, kick_message, now_iso, plugin_auth, plugin_last_seen, queue

log = logging.getLogger("rewards.sync")
router = APIRouter()
LIFTED_DAYS = 90
state: dict = {"running": False}


def _step(part: str, key: str, status: str, detail: str = "", **counts) -> None:
    state["parts"][part]["steps"][key] = {"status": status, "detail": detail, **counts}


async def _web() -> None:
    p = state["parts"]["web"]; p["status"] = "running"
    before = db.one("SELECT COUNT(*) AS n FROM punishments WHERE active = 1")["n"]
    expire_old()
    after = db.one("SELECT COUNT(*) AS n FROM punishments WHERE active = 1")["n"]
    _step("web", "expire", "done", n=before - after)
    _step("web", "stats", "done", users=db.one("SELECT COUNT(*) AS n FROM users")["n"],
          linked=db.one("SELECT COUNT(*) AS n FROM users WHERE mc_uuid IS NOT NULL")["n"],
          players=db.one("SELECT COUNT(*) AS n FROM players")["n"], active=after)
    p["status"] = "done"


async def _discord() -> None:
    p = state["parts"]["discord"]; p["status"] = "running"
    if not config.DISCORD_BOT_TOKEN or not config.DISCORD_GUILD_ID:
        p["status"] = "skipped"; p["detail"] = "未設定 Discord 機器人"
        return
    s = db.settings()
    linked_role = account.linked_role()
    ban_role, mute_role = s.get("discord_ban_role"), s.get("discord_mute_role")
    users = db.query("SELECT id, level, mc_uuid FROM users")
    changed = added = removed = errors = left = 0
    _step("discord", "levels", "running", n=0, total=len(users))
    _step("discord", "linked", "running" if linked_role else "skipped", added=0, removed=0)
    for i, u in enumerate(users):
        try:
            st = await discord_api.member_status(u["id"], use_cache=False)
            if not st.get("member"):
                left += 1
            lvl = st.get("level", 0)
            if lvl != (u["level"] or 0):
                db.execute("UPDATE users SET level = ?, is_admin = ? WHERE id = ?", (lvl, int(lvl >= 3), u["id"]))
                changed += 1
            if linked_role and st.get("member"):
                has = linked_role in await discord_api.member_role_ids(u["id"])
                want = bool(u["mc_uuid"])
                if has != want:
                    await discord_api.set_role(u["id"], linked_role, want)
                    added += want; removed += not want
        except Exception:  # noqa: BLE001
            errors += 1
            log.warning("同步 Discord 帳號失敗 %s", u["id"], exc_info=True)
        _step("discord", "levels", "running", n=i + 1, total=len(users), changed=changed, left=left)
        if linked_role:
            _step("discord", "linked", "running", added=added, removed=removed)
        await asyncio.sleep(0.35)  # 避免撞到 Discord 速率限制
    _step("discord", "levels", "done", n=len(users), total=len(users), changed=changed, left=left, errors=errors)
    if linked_role:
        _step("discord", "linked", "done", added=added, removed=removed)
    # 封禁 / 禁言身分組（只調整身分組，不重發私訊）
    fixed = 0
    if ban_role or mute_role:
        _step("discord", "roles", "running")
        rows = db.query("""SELECT p.type, p.active, u.id AS uid FROM punishments p JOIN users u ON u.mc_uuid = p.uuid
                           WHERE p.type IN ('ban','ipban','mute') AND p.discord_sync = 1""")
        want: dict[tuple[str, str], bool] = {}
        for r in rows:
            role = ban_role if r["type"] in ("ban", "ipban") else mute_role
            if role:
                want[(r["uid"], role)] = want.get((r["uid"], role), False) or bool(r["active"])
        for (uid, role), on in want.items():
            try:
                has = role in await discord_api.member_role_ids(uid)
                if has != on:
                    await discord_api.set_role(uid, role, on); fixed += 1
            except Exception:  # noqa: BLE001
                errors += 1
            await asyncio.sleep(0.35)
        _step("discord", "roles", "done", fixed=fixed)
    else:
        _step("discord", "roles", "skipped", "未設定封禁 / 禁言身分組")
    p["status"] = "done" if not errors else "warn"


async def _minecraft() -> None:
    p = state["parts"]["mc"]; p["status"] = "running"
    bans = db.query("SELECT id, type, uuid, name, ip, reason, expires_at FROM punishments WHERE active = 1 AND type IN ('ban','ipban')")
    lifted = db.query(
        f"""SELECT DISTINCT p.type, p.uuid, p.name, p.ip FROM punishments p
            WHERE p.type IN ('ban','ipban','mute') AND p.active = 0
              AND COALESCE(p.revoked_at, p.expires_at, p.created_at) >= strftime('%Y-%m-%dT%H:%M:%S', 'now', '-{LIFTED_DAYS} days')
              AND NOT EXISTS (SELECT 1 FROM punishments q WHERE q.uuid = p.uuid AND q.type = p.type AND q.active = 1)""")
    payload = {"banned": [{"uuid": b["uuid"], "name": b["name"], "ip": b["ip"], "type": b["type"], "message": kick_message(b)} for b in bans],
               "lifted": [{"uuid": r["uuid"], "name": r["name"], "ip": r["ip"], "type": r["type"]} for r in lifted],
               "sync_id": state["id"]}
    queue("full_sync", payload)
    action_id = db.one("SELECT MAX(id) AS id FROM plugin_actions")["id"]
    p["action_id"] = action_id
    _step("mc", "queued", "done", banned=len(bans), lifted=len(lifted))
    online = time.time() - plugin_last_seen() < 60
    if not online:
        _step("mc", "plugin", "warn", "插件目前離線，會在下次連線時自動執行")
        p["status"] = "warn"
        return
    _step("mc", "plugin", "running", "等待插件執行…")
    for _ in range(60):
        row = db.one("SELECT done_at FROM plugin_actions WHERE id = ?", (action_id,))
        if row and row["done_at"]:
            break
        await asyncio.sleep(1)
    row = db.one("SELECT done_at FROM plugin_actions WHERE id = ?", (action_id,))
    if not (row and row["done_at"]):
        _step("mc", "plugin", "warn", "插件沒有在 60 秒內回應，稍後會自動執行")
        p["status"] = "warn"
        return
    for _ in range(10):  # 等插件回報執行結果
        if state.get("report"):
            break
        await asyncio.sleep(0.5)
    rep = state.get("report") or {}
    _step("mc", "plugin", "done", kicked=rep.get("kicked", 0), pardoned=rep.get("pardoned", 0), online=rep.get("online", 0),
          advancedban=rep.get("advancedban", False))
    p["status"] = "done"


async def _run(actor: dict) -> None:
    t0 = time.time()
    try:
        await _web()
        await asyncio.gather(_discord(), _minecraft())
    except Exception as e:  # noqa: BLE001
        log.exception("資料同步失敗")
        state["error"] = str(e)
    finally:
        state["running"] = False
        state["finished_at"] = now_iso()
        state["duration"] = round(time.time() - t0, 1)
        summary = {k: {"status": v["status"], **{s: {kk: vv for kk, vv in st.items() if kk != "status"} for s, st in v["steps"].items()}}
                   for k, v in state["parts"].items()}
        activity.write(actor, "sync.run", f"資料同步完成（{state['duration']} 秒）", category="admin", meta=summary)


@router.post("/api/admin/sync")
async def start_sync(admin: dict = Depends(require(ADMIN))):
    if state.get("running"):
        return {"ok": True, "state": state, "already": True}
    state.clear()
    state.update(running=True, id=int(time.time()), started_at=now_iso(), by=admin.get("global_name") or admin.get("username"), report=None,
                 parts={k: {"status": "pending", "steps": {}} for k in ("mc", "web", "discord")})
    activity.write(admin, "sync.start", "開始資料同步", category="admin")
    asyncio.create_task(_run(admin))
    return {"ok": True, "state": state}


@router.get("/api/admin/sync")
async def sync_status(_: dict = Depends(require(ADMIN))):
    return {"state": state}


@router.post("/api/plugin/sync-report", dependencies=[Depends(plugin_auth)])
async def sync_report(body: dict):
    if state.get("id") and body.get("sync_id") == state["id"]:
        state["report"] = {k: body.get(k) for k in ("kicked", "pardoned", "online", "advancedban")}
    return {"ok": True}
