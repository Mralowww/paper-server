"""Gameplay stats from the official server (sent by the TierlistLink plugin): kills, matches, presence, CorePlus data.

A "match" is a run of kills between the same two players in the same world with no gap longer than
MATCH_GAP; it ends when the gap passes, either player leaves or changes world, or one of them starts
fighting someone else. The score is each side's kills in that run.
"""
import json
import re

from . import db as D
from .links import norm_uuid

MATCH_GAP = 5 * 60 * 1000
CAUSES = ("crystal", "anchor", "melee", "projectile", "explosion", "other")
UUID_RE = re.compile(r"^[0-9a-f]{32}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_]{1,16}$")
WORLD_RE = re.compile(r"^[A-Za-z0-9_\-./]{1,64}$")
KILL_COL = {"crystal": "crystal_kills", "anchor": "anchor_kills", "melee": "melee_kills"}


def clean_ts(ts):
    now = D.now_ms()
    return int(ts) if isinstance(ts, (int, float)) and now - 7 * 86400e3 < ts <= now + 60e3 else now


def player_ref(data, key):
    """(uuid, name) from an event field like {"uuid": ..., "name": ...}, or (None, None)."""
    p = data.get(key) if isinstance(data.get(key), dict) else {}
    uuid, name = norm_uuid(str(p.get("uuid") or "")), str(p.get("name") or "")
    return (uuid, name) if UUID_RE.match(uuid) and NAME_RE.match(name) else (None, None)


def touch(conn, uuid, name, ts):
    conn.execute("""INSERT INTO gs_players (uuid, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
                    ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, last_seen = MAX(last_seen, excluded.last_seen)""",
                 (uuid, name, ts, ts))
    conn.execute("""INSERT INTO gs_names (uuid, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
                    ON CONFLICT(uuid, name) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen)""",
                 (uuid, name, ts, ts))


def bump_world(conn, uuid, world, **cols):
    conn.execute("INSERT OR IGNORE INTO gs_world_stats (uuid, world) VALUES (?, ?)", (uuid, world))
    sets = ", ".join(f"{k} = {k} + ?" for k in cols)
    conn.execute(f"UPDATE gs_world_stats SET {sets} WHERE uuid = ? AND world = ?", (*cols.values(), uuid, world))


# ---------------------------------------------------------------- matches
def finish_match(conn, m, reason, ts):
    if m["status"] != "live":
        return
    if m["p1_score"] == m["p2_score"]:
        winner, results = None, {m["p1_uuid"]: "draw", m["p2_uuid"]: "draw"}
    else:
        winner = m["p1_uuid"] if m["p1_score"] > m["p2_score"] else m["p2_uuid"]
        loser = m["p2_uuid"] if winner == m["p1_uuid"] else m["p1_uuid"]
        results = {winner: "win", loser: "loss"}
    conn.execute("UPDATE gs_matches SET status = 'done', winner_uuid = ?, end_reason = ?, ended_at = ? WHERE id = ?",
                 (winner, reason, max(ts, m["last_kill_at"]), m["id"]))
    for uuid, result in results.items():
        col = {"win": "match_wins", "loss": "match_losses", "draw": "match_draws"}[result]
        conn.execute(f"UPDATE gs_players SET matches = matches + 1, {col} = {col} + 1 WHERE uuid = ?", (uuid,))
        bump_world(conn, uuid, m["world"], matches=1, wins=1 if result == "win" else 0)


def live_matches_of(conn, uuid):
    return conn.execute("SELECT * FROM gs_matches WHERE status = 'live' AND (p1_uuid = ? OR p2_uuid = ?)", (uuid, uuid)).fetchall()


def end_matches_of(conn, uuid, reason, ts, keep=None):
    for m in live_matches_of(conn, uuid):
        if m["id"] != keep:
            stale = m["last_kill_at"] < ts - MATCH_GAP
            finish_match(conn, m, "timeout" if stale else reason, m["last_kill_at"] + MATCH_GAP if stale else ts)


def sweep(conn, now=None):
    """Closes matches whose last kill is older than the gap."""
    now = now or D.now_ms()
    for m in conn.execute("SELECT * FROM gs_matches WHERE status = 'live' AND last_kill_at < ?", (now - MATCH_GAP,)).fetchall():
        finish_match(conn, m, "timeout", m["last_kill_at"] + MATCH_GAP)


def match_for_kill(conn, killer, kname, victim, vname, world, ts):
    """Adds the kill to the pair's running match (or starts one). Returns the match id."""
    m = conn.execute("""SELECT * FROM gs_matches WHERE status = 'live' AND world = ? AND last_kill_at >= ?
                        AND ((p1_uuid = ? AND p2_uuid = ?) OR (p1_uuid = ? AND p2_uuid = ?))""",
                     (world, ts - MATCH_GAP, killer, victim, victim, killer)).fetchone()
    # Anyone in another running match (different opponent/world, or timed out) closes it first.
    for uuid in (killer, victim):
        end_matches_of(conn, uuid, "new_opponent", ts, keep=m and m["id"])
    if m:
        col = "p1_score" if m["p1_uuid"] == killer else "p2_score"
        conn.execute(f"UPDATE gs_matches SET {col} = {col} + 1, last_kill_at = ?, p1_name = CASE WHEN p1_uuid = ? THEN ? ELSE p1_name END, "
                     "p2_name = CASE WHEN p2_uuid = ? THEN ? ELSE p2_name END WHERE id = ?",
                     (ts, killer, kname, killer, kname, m["id"]))
        return m["id"]
    cur = conn.execute("""INSERT INTO gs_matches (p1_uuid, p1_name, p2_uuid, p2_name, world, p1_score, p2_score, started_at, last_kill_at)
                          VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)""", (killer, kname, victim, vname, world, ts, ts))
    return cur.lastrowid


# ---------------------------------------------------------------- events
def handle(conn, ev):
    """Applies one event from the plugin. Returns True if it was understood."""
    kind = ev.get("type")
    ts = clean_ts(ev.get("ts"))
    world = str(ev.get("world") or "")
    world = world if WORLD_RE.match(world) else "unknown"
    if kind in ("join", "quit", "world"):
        uuid, name = player_ref(ev, "player")
        if not uuid:
            return False
        touch(conn, uuid, name, ts)
        if kind == "join":
            conn.execute("UPDATE gs_players SET online = 1, world = ?, session_start = ? WHERE uuid = ?", (world, ts, uuid))
        elif kind == "quit":
            conn.execute("""UPDATE gs_players SET playtime_ms = playtime_ms + MAX(0, ? - COALESCE(session_start, ?)),
                            online = 0, session_start = NULL, world = ? WHERE uuid = ?""", (ts, ts, world, uuid))
            end_matches_of(conn, uuid, "quit", ts)
        else:
            conn.execute("UPDATE gs_players SET world = ? WHERE uuid = ?", (world, uuid))
            end_matches_of(conn, uuid, "world_change", ts)
        return True
    if kind == "totem":
        uuid, name = player_ref(ev, "player")
        if not uuid:
            return False
        touch(conn, uuid, name, ts)
        conn.execute("UPDATE gs_players SET totem_pops = totem_pops + 1 WHERE uuid = ?", (uuid,))
        return True
    if kind == "death":
        victim, vname = player_ref(ev, "victim")
        if not victim:
            return False
        killer, kname = player_ref(ev, "killer")
        if killer == victim:
            killer = None
        cause = ev.get("cause") if ev.get("cause") in CAUSES else "other"
        touch(conn, victim, vname, ts)
        conn.execute("UPDATE gs_players SET deaths = deaths + 1, cur_streak = 0, pvp_deaths = pvp_deaths + ? WHERE uuid = ?",
                     (1 if killer else 0, victim))
        bump_world(conn, victim, world, deaths=1)
        match_id = None
        if killer:
            touch(conn, killer, kname, ts)
            col = KILL_COL.get(cause, "other_kills")
            conn.execute(f"""UPDATE gs_players SET kills = kills + 1, {col} = {col} + 1, cur_streak = cur_streak + 1,
                             best_streak = MAX(best_streak, cur_streak + 1) WHERE uuid = ?""", (killer,))
            bump_world(conn, killer, world, kills=1)
            match_id = match_for_kill(conn, killer, kname, victim, vname, world, ts)
        health = ev.get("killerHealth")
        conn.execute("""INSERT INTO gs_kills (killer_uuid, killer_name, victim_uuid, victim_name, world, cause, killer_health,
                        victim_pops, match_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                     (killer, kname, victim, vname, world, cause,
                      round(float(health), 1) if isinstance(health, (int, float)) else None,
                      max(0, min(int(ev.get("victimPops") or 0), 99)), match_id, ts))
        return True
    return False


def presence(conn, players, ts):
    """Heartbeat: exactly these players are online now (list of {uuid, name, world})."""
    online = set()
    for p in players[:500]:
        uuid, name = player_ref({"p": p}, "p")
        if not uuid:
            continue
        world = str(p.get("world") or "")
        online.add(uuid)
        touch(conn, uuid, name, ts)
        row = conn.execute("SELECT online, world FROM gs_players WHERE uuid = ?", (uuid,)).fetchone()
        if row["world"] and world and row["world"] != world:
            end_matches_of(conn, uuid, "world_change", ts)
        conn.execute("UPDATE gs_players SET online = 1, world = ?, session_start = COALESCE(session_start, ?) WHERE uuid = ?",
                     (world if WORLD_RE.match(world) else row["world"], ts, uuid))
    for r in conn.execute("SELECT uuid, session_start FROM gs_players WHERE online = 1").fetchall():
        if r["uuid"] not in online:  # missed quit event (crash, restart)
            conn.execute("""UPDATE gs_players SET online = 0, playtime_ms = playtime_ms + MAX(0, ? - COALESCE(session_start, ?)),
                            session_start = NULL WHERE uuid = ?""", (ts, ts, r["uuid"]))
            end_matches_of(conn, r["uuid"], "quit", ts)
    return len(online)


def save_coreplus(conn, entries, ts):
    n = 0
    for e in entries[:2000]:
        uuid, name = player_ref({"p": e}, "p")
        if not uuid:
            continue
        stats = {str(k)[:40]: int(v) for k, v in (e.get("stats") or {}).items() if isinstance(v, (int, float))}
        ach = [str(a)[:80] for a in (e.get("achievements") or [])][:500]
        conn.execute("""INSERT INTO gs_coreplus (uuid, name, stats, achievements, login_streak, synced_at) VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, stats = excluded.stats,
                        achievements = excluded.achievements, login_streak = excluded.login_streak, synced_at = excluded.synced_at""",
                     (uuid, name, json.dumps(stats), json.dumps(ach), int(e.get("loginStreak") or 0), ts))
        n += 1
    return n


# ---------------------------------------------------------------- reads
def find_uuid(conn, ident):
    """Name or UUID → undashed UUID using everything the site knows about (leaderboard, links, server)."""
    bare = norm_uuid(ident)
    if UUID_RE.match(bare):
        return bare
    for sql in ("SELECT REPLACE(LOWER(uuid), '-', '') AS u FROM players WHERE name = ? AND uuid IS NOT NULL AND uuid != ''",
                "SELECT uuid AS u FROM mc_links WHERE mc_name = ? COLLATE NOCASE",
                "SELECT uuid AS u FROM gs_players WHERE name = ? COLLATE NOCASE ORDER BY last_seen DESC",
                "SELECT uuid AS u FROM gs_names WHERE name = ? COLLATE NOCASE ORDER BY last_seen DESC"):
        row = conn.execute(sql, (ident,)).fetchone()
        if row and row["u"]:
            return row["u"]
    return None


def names(conn, uuid):
    return [dict(r) for r in conn.execute("SELECT name, first_seen, last_seen FROM gs_names WHERE uuid = ? ORDER BY first_seen",
                                          (uuid,)).fetchall()]


def worlds(conn):
    try:
        return json.loads(D.get_setting(conn, "gs_worlds") or "{}")
    except ValueError:
        return {}


def stats(conn, uuid):
    p = conn.execute("SELECT * FROM gs_players WHERE uuid = ?", (uuid,)).fetchone()
    if not p:
        return None
    p = dict(p)
    if p["online"] and p["session_start"]:
        p["playtime_ms"] += max(0, D.now_ms() - p["session_start"])
    cp = conn.execute("SELECT * FROM gs_coreplus WHERE uuid = ?", (uuid,)).fetchone()
    all_worlds = world_stats(conn, uuid)
    all_rivals = rivals(conn, uuid)
    return {
        "kills": p["kills"], "deaths": p["deaths"], "pvpDeaths": p["pvp_deaths"],
        "killTypes": {"crystal": p["crystal_kills"], "anchor": p["anchor_kills"], "melee": p["melee_kills"], "other": p["other_kills"]},
        "totemPops": p["totem_pops"], "curStreak": p["cur_streak"], "bestStreak": p["best_streak"],
        "matches": p["matches"], "wins": p["match_wins"], "losses": p["match_losses"], "draws": p["match_draws"],
        "playtimeMs": p["playtime_ms"], "firstSeen": p["first_seen"], "lastSeen": p["last_seen"],
        "worlds": all_worlds[:PREVIEW], "worldCount": len(all_worlds),
        "rivals": all_rivals[:PREVIEW], "rivalCount": len(all_rivals),
        "recent": kill_log(conn, uuid, limit=PREVIEW)[0],
        "coreplus": cp and {"stats": json.loads(cp["stats"]), "achievements": len(json.loads(cp["achievements"])),
                            "loginStreak": cp["login_streak"], "syncedAt": cp["synced_at"]},
    }


PREVIEW = 6


def world_stats(conn, uuid):
    """Every world this player fought in, most recent first."""
    return [dict(r) for r in conn.execute("""
        SELECT w.world, w.kills, w.deaths, w.matches, w.wins,
               (SELECT MAX(created_at) FROM gs_kills k WHERE k.world = w.world AND (k.killer_uuid = w.uuid OR k.victim_uuid = w.uuid)) AS last_at
        FROM gs_world_stats w WHERE w.uuid = ? ORDER BY last_at DESC, w.kills + w.deaths DESC""", (uuid,)).fetchall()]


def rivals(conn, uuid, q=""):
    """Everyone this player killed or was killed by, most fought first."""
    like = f"%{q}%"
    return [dict(r) for r in conn.execute("""
        SELECT opp, MAX(name) AS name, SUM(k) AS kills, SUM(d) AS deaths, MAX(at) AS last_at FROM (
          SELECT victim_uuid AS opp, victim_name AS name, 1 AS k, 0 AS d, created_at AS at FROM gs_kills WHERE killer_uuid = ?
          UNION ALL SELECT killer_uuid, killer_name, 0, 1, created_at FROM gs_kills WHERE victim_uuid = ? AND killer_uuid IS NOT NULL)
        GROUP BY opp HAVING ? = '' OR MAX(name) LIKE ? ORDER BY kills + deaths DESC, last_at DESC LIMIT 500""",
        (uuid, uuid, q, like)).fetchall()]


def kill_log(conn, uuid, kind="all", cause="", world="", opp="", start=None, end=None, before=None, limit=30):
    """Kills and deaths of one player, newest first. Returns (items, has_more, summary)."""
    where, args = [], []
    if kind == "kills":
        where.append("killer_uuid = ?")
        args.append(uuid)
    elif kind == "deaths":
        where.append("victim_uuid = ?")
        args.append(uuid)
    else:
        where.append("(killer_uuid = ? OR victim_uuid = ?)")
        args += [uuid, uuid]
    if cause in CAUSES:
        where.append("cause IN ('projectile', 'explosion', 'other')" if cause == "other" else "cause = ?")
        if cause != "other":
            args.append(cause)
    if world:
        where.append("world = ?")
        args.append(world)
    if opp:
        where.append("((killer_uuid = ? AND victim_name LIKE ?) OR (victim_uuid = ? AND killer_name LIKE ?))")
        args += [uuid, f"%{opp}%", uuid, f"%{opp}%"]
    if start:
        where.append("created_at >= ?")
        args.append(start)
    if end:
        where.append("created_at < ?")
        args.append(end)
    base = " AND ".join(where)
    summary = conn.execute(f"SELECT COUNT(*) AS total, SUM(killer_uuid = ?) AS kills, SUM(victim_uuid = ?) AS deaths "
                           f"FROM gs_kills WHERE {base}", (uuid, uuid, *args)).fetchone()
    if before:
        base += " AND id < ?"
        args.append(before)
    rows = conn.execute(f"SELECT * FROM gs_kills WHERE {base} ORDER BY id DESC LIMIT ?", (*args, limit + 1)).fetchall()
    items = []
    for r in rows[:limit]:
        won = r["killer_uuid"] == uuid
        items.append({
            "id": r["id"], "role": "kill" if won else "death", "world": r["world"], "cause": r["cause"],
            "opponent": {"uuid": r["victim_uuid"], "name": r["victim_name"]} if won
            else ({"uuid": r["killer_uuid"], "name": r["killer_name"]} if r["killer_uuid"] else None),
            "killerHealth": r["killer_health"], "victimPops": r["victim_pops"], "matchId": r["match_id"], "at": r["created_at"],
        })
    return items, len(rows) > limit, {"total": summary["total"], "kills": summary["kills"] or 0, "deaths": summary["deaths"] or 0}


def matches(conn, uuid, before=None, limit=30):
    args = [uuid, uuid]
    extra = ""
    if before:
        extra = " AND id < ?"
        args.append(before)
    rows = conn.execute(f"SELECT * FROM gs_matches WHERE (p1_uuid = ? OR p2_uuid = ?){extra} ORDER BY id DESC LIMIT ?",
                        (*args, limit + 1)).fetchall()
    out = []
    for m in rows[:limit]:
        me_first = m["p1_uuid"] == uuid
        out.append({
            "id": m["id"], "world": m["world"], "status": m["status"],
            "opponent": {"uuid": m["p2_uuid"] if me_first else m["p1_uuid"], "name": m["p2_name"] if me_first else m["p1_name"]},
            "me": m["p1_name"] if me_first else m["p2_name"],
            "score": [m["p1_score"], m["p2_score"]] if me_first else [m["p2_score"], m["p1_score"]],
            "result": "live" if m["status"] == "live" else "draw" if not m["winner_uuid"] else "win" if m["winner_uuid"] == uuid else "loss",
            "startedAt": m["started_at"], "endedAt": m["ended_at"] or m["last_kill_at"],
        })
    return out, len(rows) > limit


def match_kills(conn, match_id):
    return [dict(r) for r in conn.execute("SELECT killer_name, victim_name, cause, killer_health, victim_pops, created_at "
                                          "FROM gs_kills WHERE match_id = ? ORDER BY id", (match_id,)).fetchall()]


def presence_of(conn, uuid):
    p = conn.execute("SELECT online, world, last_seen FROM gs_players WHERE uuid = ?", (uuid,)).fetchone()
    return dict(p) if p else None
