"""Discord ↔ Minecraft account links, verified by a code the official server shows on join."""
import json
import secrets
import threading
import time
import urllib.request

from . import config as C
from . import db as D

CODE_TTL = 10 * 60 * 1000
NAME_CHECK_INTERVAL = 24 * 3600 * 1000   # re-check linked names with Mojang once a day
CODE_ALPHABET = "0123456789"


def norm_uuid(u):
    return (u or "").replace("-", "").lower()


def dashed(u):
    u = norm_uuid(u)
    return f"{u[:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:]}"


def link_for(conn, discord_id):
    row = conn.execute("SELECT * FROM mc_links WHERE discord_id = ?", (str(discord_id),)).fetchone()
    return dict(row) if row else None


def link_by_uuid(conn, uuid):
    row = conn.execute("SELECT * FROM mc_links WHERE uuid = ?", (norm_uuid(uuid),)).fetchone()
    return dict(row) if row else None


def public_link(link):
    return link and {"uuid": dashed(link["uuid"]), "name": link["mc_name"], "linkedAt": link["linked_at"]}


def required(conn):
    return D.get_setting(conn, "link_required", "0") == "1"


def issue_code(conn, uuid, name):
    """Returns (code, expires_at) for this account, reusing a still-valid code so rejoining doesn't change it."""
    uuid, now = norm_uuid(uuid), D.now_ms()
    conn.execute("DELETE FROM link_codes WHERE expires_at <= ?", (now,))
    row = conn.execute("SELECT code, expires_at FROM link_codes WHERE uuid = ?", (uuid,)).fetchone()
    if row:
        conn.execute("UPDATE link_codes SET mc_name = ? WHERE uuid = ?", (name, uuid))
        return row["code"], row["expires_at"]
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not conn.execute("SELECT 1 FROM link_codes WHERE code = ?", (code,)).fetchone():
            break
    expires = now + CODE_TTL
    conn.execute("INSERT INTO link_codes (code, uuid, mc_name, expires_at) VALUES (?, ?, ?, ?)", (code, uuid, name, expires))
    return code, expires


class LinkError(Exception):
    """code is an i18n/error key; message is the Chinese text shown by the bot."""
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def redeem(conn, user, code):
    """Links user (dict with id/username) to the account behind `code`. Returns the new link."""
    code = str(code or "").strip()
    if not (len(code) == 6 and code.isdigit()):
        raise LinkError("invalid_code", "驗證碼是 6 位數字。")
    did = str(user["id"])
    existing = link_for(conn, did)
    if existing:
        raise LinkError("already_linked", f"你已經綁定 {existing['mc_name']}，如需更換請開客服單聯絡管理層。")
    row = conn.execute("SELECT * FROM link_codes WHERE code = ? AND expires_at > ?", (code, D.now_ms())).fetchone()
    if not row:
        raise LinkError("code_not_found", "驗證碼錯誤或已過期，請重新進入伺服器取得新的驗證碼。")
    uuid, name = row["uuid"], row["mc_name"]
    if link_by_uuid(conn, uuid):
        raise LinkError("account_taken", f"{name} 已綁定其他 Discord 帳號，如有疑問請開客服單。")
    # Existing leaderboard entry for this account: take it over unless it belongs to someone else.
    player = conn.execute("SELECT * FROM players WHERE REPLACE(LOWER(uuid), '-', '') = ?", (uuid,)).fetchone() \
        or conn.execute("SELECT * FROM players WHERE name = ? AND (uuid IS NULL OR uuid = '')", (name,)).fetchone()
    if player and player["discord_id"] and player["discord_id"] != did:
        raise LinkError("player_owned", f"排行榜上的 {player['name']} 已屬於其他 Discord 帳號，請開客服單由管理層處理。")
    now = D.now_ms()
    conn.execute("INSERT INTO mc_links (discord_id, uuid, mc_name, linked_at, checked_at) VALUES (?, ?, ?, ?, ?)",
                 (did, uuid, name, now, now))
    conn.execute("DELETE FROM link_codes WHERE uuid = ?", (uuid,))
    if player:
        conn.execute("UPDATE players SET discord_id = NULL WHERE discord_id = ? AND id != ?", (did, player["id"]))
        conn.execute("UPDATE players SET discord_id = ?, uuid = ? WHERE id = ?", (did, dashed(uuid), player["id"]))
        rename_player(conn, player["id"], name)
    D.audit(conn, user, "mc_link", f"{name} ({dashed(uuid)})")
    return link_for(conn, did)


def unlink(conn, actor, discord_id):
    link = link_for(conn, discord_id)
    if not link:
        return None
    conn.execute("DELETE FROM mc_links WHERE discord_id = ?", (str(discord_id),))
    # The leaderboard entry stays, but no longer belongs to this Discord account.
    conn.execute("UPDATE players SET discord_id = NULL WHERE discord_id = ? AND REPLACE(LOWER(uuid), '-', '') = ?",
                 (str(discord_id), link["uuid"]))
    D.audit(conn, actor, "mc_unlink", f"{link['mc_name']} ({dashed(link['uuid'])}) ← {discord_id}")
    return link


def rename_player(conn, player_id, name):
    """Renames a leaderboard entry unless another entry already uses that name."""
    clash = conn.execute("SELECT id FROM players WHERE name = ? AND id != ?", (name, player_id)).fetchone()
    if not clash:
        conn.execute("UPDATE players SET name = ? WHERE id = ? AND name != ?", (name, player_id, name))


def sync_name(conn, uuid, name):
    """Records the current name for a UUID (from a server join or Mojang). Returns True if something changed."""
    uuid = norm_uuid(uuid)
    changed = conn.execute("UPDATE mc_links SET mc_name = ?, checked_at = ? WHERE uuid = ? AND mc_name != ?",
                           (name, D.now_ms(), uuid, name)).rowcount
    conn.execute("UPDATE mc_links SET checked_at = ? WHERE uuid = ?", (D.now_ms(), uuid))
    for p in conn.execute("SELECT id, name FROM players WHERE REPLACE(LOWER(uuid), '-', '') = ?", (uuid,)).fetchall():
        if p["name"] != name:
            rename_player(conn, p["id"], name)
            changed = 1
            D.audit(conn, None, "mc_rename", f"{p['name']} → {name}")
    return bool(changed)


# ---------------------------------------------------------------- background name sync
def _mojang_name(uuid):
    req = urllib.request.Request(f"https://sessionserver.mojang.com/session/minecraft/profile/{uuid}",
                                 headers={"User-Agent": "Mc.Tierlist.Asia"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read()).get("name") if res.status == 200 else None


def _sync_loop():
    time.sleep(60)
    while True:
        try:
            with D.transaction() as conn:
                cutoff = D.now_ms() - NAME_CHECK_INTERVAL
                uuids = [r["uuid"] for r in conn.execute(
                    "SELECT uuid FROM mc_links WHERE checked_at < ? ORDER BY checked_at LIMIT 200", (cutoff,))]
            for uuid in uuids:
                try:
                    name = _mojang_name(uuid)
                except Exception as exc:  # Mojang down or rate limited: try again next round
                    print(f"[links] name check {uuid}: {exc}")
                    break
                with D.transaction() as conn:
                    if name:
                        sync_name(conn, uuid, name)
                    else:
                        conn.execute("UPDATE mc_links SET checked_at = ? WHERE uuid = ?", (D.now_ms(), uuid))
                time.sleep(1.5)
        except Exception as exc:
            print(f"[links] sync failed: {exc}")
        time.sleep(15 * 60)


def start():
    threading.Thread(target=_sync_loop, name="mc-name-sync", daemon=True).start()
