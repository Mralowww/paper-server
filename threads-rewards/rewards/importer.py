"""一次性匯入：啟動時若 data/import_advancedban.json 存在，就把 AdvancedBan 的紀錄匯入懲處系統，完成後改名為 .done。
重複執行不會重複匯入（以 source + uuid/ip + 類型 + 時間判斷）。"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from . import activity, config, db

SOURCE = "advancedban"


def _iso(ms: int | None) -> str | None:
    return None if ms is None else datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="seconds")


def _dashed(u: str) -> str:
    u = u.replace("-", "").lower()
    return f"{u[:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:]}" if len(u) == 32 else u


def run() -> None:
    path = Path(config.DATABASE_PATH).parent / "import_advancedban.json"
    if not path.exists():
        return
    rows = json.loads(path.read_text(encoding="utf-8"))
    added = skipped = 0
    for r in rows:
        uuid = r.get("uuid")
        if not uuid:
            p = db.one("SELECT uuid FROM players WHERE name = ? COLLATE NOCASE", (r["name"].lstrip("."),)) or \
                db.one("SELECT uuid FROM players WHERE name = ? COLLATE NOCASE", (r["name"],))
            uuid = p["uuid"] if p else f"ip:{r.get('ip') or r['name']}"
        uuid = _dashed(uuid)
        created = _iso(r["start"])
        if db.one("SELECT 1 FROM punishments WHERE source = ? AND uuid = ? AND type = ? AND created_at = ?",
                  (SOURCE, uuid, r["type"], created)):
            skipped += 1
            continue
        if not uuid.startswith("ip:"):
            db.execute("INSERT OR IGNORE INTO players(uuid, name) VALUES (?, ?)", (uuid, r["name"]))
            db.execute("INSERT OR IGNORE INTO player_names(uuid, name, first_seen) VALUES (?,?,?)", (uuid, r["name"], created))
        expires = _iso(r.get("end"))
        active = 1 if r.get("active") else 0
        # 已不在生效名單、又還沒到期（或永久）→ 表示被提前解除
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        lifted = not active and r["type"] != "kick" and (expires is None or expires > now)
        db.execute(
            """INSERT INTO punishments(type, uuid, name, ip, reason, staff_id, staff_name, source, created_at, expires_at, active,
                                       revoked_by, revoked_at, revoke_reason)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (r["type"], uuid, r["name"], r.get("ip"), r.get("reason") or "（未提供原因）", None, r.get("staff") or "CONSOLE",
             SOURCE, created, expires, active,
             *(("AdvancedBan", None, "已在 AdvancedBan 解除") if lifted else (None, None, None))))
        added += 1
    path.rename(path.with_suffix(".json.done"))
    activity.write(None, "punish.import", f"AdvancedBan：匯入 {added} 筆，略過 {skipped} 筆", category="punish",
                   meta={"added": added, "skipped": skipped, "file": path.name})
    logging.info("AdvancedBan 匯入完成：新增 %s 筆、略過 %s 筆", added, skipped)
