"""Punishments (ban / ipban / mute / warn / kick) shared by the website, the Discord bot and the game server."""
import json
import re
import time

from . import bridge
from . import db as D
from . import gamestats as GS
from . import links as L

TYPES = ("ban", "ipban", "mute", "warn", "kick")
LASTING = ("ban", "ipban", "mute")          # types that stay active until they expire or are revoked
NAME_RE = re.compile(r"^[A-Za-z0-9_]{2,16}$")
IP_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,39}$")
UNIT_MS = {"s": 1000, "m": 60_000, "h": 3_600_000, "d": 86_400_000, "w": 7 * 86_400_000,
           "mo": 30 * 86_400_000, "y": 365 * 86_400_000}
DUR_RE = re.compile(r"(\d+)\s*(mo|y|w|d|h|m|s)", re.I)
MAX_MS = 20 * 365 * 86_400_000


def parse_duration(text):
    """'1d12h' → ms; 'perm'/'' → None. Raises ValueError on garbage."""
    text = str(text or "").strip().lower()
    if text in ("", "perm", "permanent", "forever", "永久"):
        return None
    if not re.fullmatch(r"(\s*\d+\s*(mo|y|w|d|h|m|s)\s*)+", text):
        raise ValueError("invalid_duration")
    total = sum(int(n) * UNIT_MS[u.lower()] for n, u in DUR_RE.findall(text))
    if not 0 < total <= MAX_MS:
        raise ValueError("invalid_duration")
    return total


def fmt_duration(ms):
    if not ms:
        return "永久"
    parts = []
    for unit, label in (("d", "天"), ("h", "小時"), ("m", "分鐘")):
        n, ms = divmod(ms, UNIT_MS[unit])
        if n:
            parts.append(f"{n} {label}")
    return " ".join(parts) or "不到 1 分鐘"


def taipei(ms):
    return time.strftime("%Y/%m/%d %H:%M", time.gmtime(ms / 1000 + 8 * 3600))


def status(p, now=None):
    now = now or D.now_ms()
    if p["type"] in ("warn", "kick"):
        return "revoked" if p["revoked_at"] else "done"
    return "revoked" if p["revoked_at"] else "expired" if p["expires_at"] and p["expires_at"] <= now else "active"


def row(p):
    p = dict(p)
    p["status"] = status(p)
    p["uuid_dashed"] = L.dashed(p["uuid"]) if p.get("uuid") else None
    return p


# ---------------------------------------------------------------- targets
def resolve_target(conn, ident):
    """Name / UUID → {'uuid', 'name', 'discord_id'} using everything the site knows, then Mojang."""
    ident = str(ident or "").strip()
    uuid = GS.find_uuid(conn, ident) if ident else None
    name = ident
    if not uuid and NAME_RE.match(ident):
        from . import heads
        try:
            uuid = heads.resolve_uuid(ident)
        except Exception:
            uuid = None
    if uuid:
        for sql in ("SELECT mc_name AS n FROM mc_links WHERE uuid = ?", "SELECT name AS n FROM gs_players WHERE uuid = ?",
                    "SELECT name AS n FROM players WHERE REPLACE(LOWER(uuid), '-', '') = ?"):
            r = conn.execute(sql, (uuid,)).fetchone()
            if r:
                name = r["n"]
                break
    elif not NAME_RE.match(ident):
        return None
    link = L.link_by_uuid(conn, uuid) if uuid else None
    player = conn.execute("SELECT discord_id FROM players WHERE (REPLACE(LOWER(uuid), '-', '') = ? AND ? != '') OR name = ?",
                          (uuid or "", uuid or "", name)).fetchone()
    return {"uuid": uuid, "name": name, "discord_id": (link and link["discord_id"]) or (player and player["discord_id"])}


def last_ip(conn, uuid):
    r = conn.execute("SELECT ip FROM gs_ips WHERE uuid = ? ORDER BY last_seen DESC LIMIT 1", (uuid,)).fetchone()
    return r and r["ip"]


def record_ip(conn, uuid, ip):
    if not uuid or not ip or not IP_RE.match(ip):
        return
    ts = D.now_ms()
    conn.execute("""INSERT INTO gs_ips (uuid, ip, first_seen, last_seen) VALUES (?, ?, ?, ?)
                    ON CONFLICT(uuid, ip) DO UPDATE SET last_seen = excluded.last_seen""", (uuid, ip, ts, ts))


# ---------------------------------------------------------------- create / revoke
class PunishError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def create(conn, *, kind, target, reason, duration_ms=None, actor, source, silent=False, discord_sync=False,
           ip=None, ticket_id=None):
    """Stores a punishment and returns it. `actor` is {'id', 'username'} (id None for console)."""
    if kind not in TYPES:
        raise PunishError("invalid_type", "處罰類型不正確")
    reason = str(reason or "").strip()[:300] or "違反伺服器規則"
    if kind not in LASTING:
        duration_ms = None
    if kind == "ipban":
        ip = ip or (target.get("uuid") and last_ip(conn, target["uuid"]))
        if not ip:
            raise PunishError("no_ip", "找不到這位玩家的 IP，他需要先進過伺服器")
    if kind in LASTING:
        existing = find_active(conn, kind, uuid=target.get("uuid"), name=target.get("name"), ip=ip if kind == "ipban" else None)
        if existing:
            raise PunishError("already_punished", f"{target['name']} 已經有生效中的{LABEL[kind]}（#{existing['id']}）")
    ts = D.now_ms()
    expires = ts + duration_ms if duration_ms else None
    cur = conn.execute(
        """INSERT INTO bans (type, mc_name, uuid, discord_id, ip, reason, created_by, created_by_name, created_at, expires_at,
                             source, silent, discord_sync, ticket_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (kind, target["name"], target.get("uuid") and L.dashed(target["uuid"]), target.get("discord_id"), ip, reason,
         actor.get("id"), actor.get("username"), ts, expires, source, 1 if silent else 0, 1 if discord_sync else 0, ticket_id, ts))
    p = row(conn.execute("SELECT * FROM bans WHERE id = ?", (cur.lastrowid,)).fetchone())
    D.audit(conn, actor if actor.get("id") else {"id": None, "username": actor.get("username") or "console"},
            f"punish_{kind}", f"#{p['id']} {target['name']} ({fmt_duration(duration_ms) if kind in LASTING else '—'}) — {reason}",
            target=("ban", p["id"], target["name"]), source=source,
            meta={"punishment": {k: p[k] for k in ("id", "type", "mc_name", "uuid", "discord_id", "reason", "expires_at", "silent", "discord_sync")},
                  "ip": bool(ip)})
    return p


def revoke(conn, pid, actor, reason="", source="web"):
    p = conn.execute("SELECT * FROM bans WHERE id = ?", (pid,)).fetchone()
    if not p:
        raise PunishError("not_found", "找不到這筆處罰")
    if p["revoked_at"] or status(p) != "active":
        raise PunishError("not_active", "這筆處罰已經不在生效中")
    ts = D.now_ms()
    conn.execute("UPDATE bans SET revoked_at = ?, revoked_by = ?, revoked_by_name = ?, revoke_reason = ?, updated_at = ? WHERE id = ?",
                 (ts, actor.get("id"), actor.get("username"), str(reason or "")[:300] or None, ts, pid))
    D.audit(conn, actor if actor.get("id") else {"id": None, "username": actor.get("username") or "console"},
            f"unpunish_{p['type']}", f"#{pid} {p['mc_name']}" + (f" — {reason}" if reason else ""),
            target=("ban", pid, p["mc_name"]), changes={"status": ["active", "revoked"]}, source=source, meta={"punishment": dict(p)})
    return row(conn.execute("SELECT * FROM bans WHERE id = ?", (pid,)).fetchone())


LABEL = {"ban": "封禁", "ipban": "IP 封禁", "mute": "禁言", "warn": "警告", "kick": "踢出"}


def find_active(conn, kind, uuid=None, name=None, discord_id=None, ip=None):
    """Active punishment of `kind` ('ban' also matches IP bans) for any of the identities."""
    kinds = ("ban", "ipban") if kind == "ban" else (kind,)
    clauses, args = [], []
    if uuid:
        clauses.append("REPLACE(LOWER(uuid), '-', '') = ?")
        args.append(L.norm_uuid(uuid))
    if name:
        clauses.append("mc_name = ? COLLATE NOCASE")
        args.append(name)
    if discord_id:
        clauses.append("discord_id = ?")
        args.append(str(discord_id))
    if ip:
        clauses.append("(type = 'ipban' AND ip = ?)")
        args.append(ip)
    if not clauses:
        return None
    r = conn.execute(f"""SELECT * FROM bans WHERE {D.LIVE_SQL} AND type IN ({','.join('?' * len(kinds))})
                         AND ({' OR '.join(clauses)}) ORDER BY id DESC LIMIT 1""", (D.now_ms(), *kinds, *args)).fetchone()
    return row(r) if r else None


def active_mutes(conn):
    return [row(r) for r in conn.execute(f"SELECT * FROM bans WHERE {D.LIVE_SQL} AND type = 'mute'", (D.now_ms(),))]


def history(conn, uuid=None, name=None, discord_id=None, limit=50):
    clauses, args = [], []
    if uuid:
        clauses.append("REPLACE(LOWER(uuid), '-', '') = ?")
        args.append(L.norm_uuid(uuid))
    if name:
        clauses.append("mc_name = ? COLLATE NOCASE")
        args.append(name)
    if discord_id:
        clauses.append("discord_id = ?")
        args.append(str(discord_id))
    if not clauses:
        return []
    return [row(r) for r in conn.execute(f"SELECT * FROM bans WHERE {' OR '.join(clauses)} ORDER BY id DESC LIMIT ?", (*args, limit))]


def changes_since(conn, cursor, limit=200):
    """Punishments created or revoked after `cursor` (updated_at ms) — what the game server needs to act on."""
    rows = conn.execute("SELECT * FROM bans WHERE updated_at > ? ORDER BY updated_at, id LIMIT ?", (cursor, limit)).fetchall()
    return [row(r) for r in rows]


# ---------------------------------------------------------------- messages shown in game
def screen(p, host):
    """Kick / login screen text (legacy § colours)."""
    until = f"{taipei(p['expires_at'])}（台灣時間）" if p.get("expires_at") else "永久"
    head = {"ban": "§c§l你已被封禁", "ipban": "§c§l你的 IP 已被封禁", "kick": "§e§l你已被踢出伺服器"}.get(p["type"], "§c§l處罰")
    body = f"{head}\n\n§7原因：§f{p['reason']}\n"
    if p["type"] != "kick":
        body += f"§7期限：§f{until}\n§7處罰編號：§f#{p['id']}\n\n§8申訴請至 {host}/support"
    return body


def chat_line(p):
    until = f"§f{taipei(p['expires_at'])}" if p.get("expires_at") else "§f永久"
    return f"§c你目前被禁言（#{p['id']}）§7原因：§f{p['reason']} §7到期：{until}"


def broadcast_line(p, actor_name):
    verb = {"ban": "封禁了", "ipban": "IP 封禁了", "mute": "禁言了", "warn": "警告了", "kick": "踢出了"}[p["type"]]
    dur = f" §7({fmt_duration(p['expires_at'] - p['created_at'])})" if p.get("expires_at") else (" §7(永久)" if p["type"] in LASTING else "")
    return f"§6[處罰] §e{actor_name} §f{verb} §e{p['mc_name']}{dur} §7原因：§f{p['reason']}"


# ---------------------------------------------------------------- Discord side effects
def discord_apply(pid):
    async def run():
        from . import bot
        await bot.apply_punishment(pid)
    bridge.submit(run)


def discord_undo(pid):
    async def run():
        from . import bot
        await bot.undo_punishment(pid)
    bridge.submit(run)


def settings(conn):
    raw = D.get_setting(conn, "punish_settings")
    base = {"discordDefault": False, "muteRole": "", "banRole": "", "broadcast": True}
    try:
        base.update(json.loads(raw) if raw else {})
    except ValueError:
        pass
    return base
