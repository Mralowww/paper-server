"""Minecraft permission nodes granted from the website: rules map a subject (website level, tester flag,
Discord role, everyone) to a list of nodes. '-node' denies. Higher website levels inherit lower levels' nodes."""
import json
import re

from . import config as C
from . import db as D
from . import links as L

NODE_RE = re.compile(r"^-?[A-Za-z0-9_.*\-]{1,120}$")
LEVEL_SUBJECTS = ["level:helper", "level:moderator", "level:admin", "level:owner"]
FIXED_SUBJECTS = ["everyone", "linked", *LEVEL_SUBJECTS, "tester", "senior"]
KNOWN_NODES = [
    "tierlist.warn", "tierlist.kick", "tierlist.mute", "tierlist.tempmute", "tierlist.unmute",
    "tierlist.ban", "tierlist.tempban", "tierlist.unban", "tierlist.ipban", "tierlist.history", "tierlist.check",
    "tierlist.notify", "tierlist.silent", "tierlist.admin",
]
DEFAULTS = {
    "level:helper": ["tierlist.warn", "tierlist.kick", "tierlist.mute", "tierlist.tempmute", "tierlist.history",
                     "tierlist.check", "tierlist.notify", "tierlist.silent"],
    "level:moderator": ["tierlist.ban", "tierlist.tempban", "tierlist.unmute"],
    "level:admin": ["tierlist.unban", "tierlist.ipban", "tierlist.admin"],
}
LEVEL_OF = {"level:helper": C.LEVEL_HELPER, "level:moderator": C.LEVEL_MODERATOR, "level:admin": C.LEVEL_ADMIN, "level:owner": C.LEVEL_OWNER}


def valid_subject(s):
    return s in FIXED_SUBJECTS or bool(re.fullmatch(r"role:\d{15,21}", s))


def load(conn):
    rows = conn.execute("SELECT subject, nodes, updated_at FROM perm_rules").fetchall()
    if not rows and D.get_setting(conn, "perm_rules_seeded") != "1":
        save(conn, {k: v for k, v in DEFAULTS.items()})
        D.set_setting(conn, "perm_rules_seeded", "1")
        conn.commit()
        rows = conn.execute("SELECT subject, nodes, updated_at FROM perm_rules").fetchall()
    return {r["subject"]: json.loads(r["nodes"]) for r in rows}


def save(conn, rules):
    """Replaces all rules. Returns the new version."""
    ts = D.now_ms()
    conn.execute("DELETE FROM perm_rules")
    for subject, nodes in rules.items():
        conn.execute("INSERT INTO perm_rules (subject, nodes, updated_at) VALUES (?, ?, ?)", (subject, json.dumps(nodes), ts))
    D.set_setting(conn, "perms_version", ts)
    return ts


def version(conn):
    return int(D.get_setting(conn, "perms_version", "0") or 0)


def clean(rules):
    """Validates an incoming {subject: [nodes]} dict. Raises ValueError."""
    if not isinstance(rules, dict) or len(rules) > 100:
        raise ValueError("invalid_rules")
    out = {}
    for subject, nodes in rules.items():
        if not valid_subject(str(subject)) or not isinstance(nodes, list):
            raise ValueError("invalid_rules")
        good = []
        for n in nodes[:200]:
            n = str(n).strip()
            if not NODE_RE.match(n):
                raise ValueError("invalid_node")
            if n not in good:
                good.append(n)
        out[str(subject)] = good
    return out


def subjects_for(conn, uuid):
    """Which rule subjects apply to this Minecraft account (via its linked Discord member)."""
    subjects = ["everyone"]
    link = L.link_by_uuid(conn, uuid)
    if not link:
        return subjects, None
    subjects.append("linked")
    m = D.member(conn, link["discord_id"])
    roles = m["roles"] if m and m["in_guild"] else []
    acc = C.access_for(link["discord_id"], roles)
    subjects += [s for s in LEVEL_SUBJECTS if acc["level"] >= LEVEL_OF[s]]
    if acc["tester"]:
        subjects.append("tester")
    if acc["seniorTester"]:
        subjects.append("senior")
    subjects += [f"role:{r}" for r in roles]
    return subjects, acc


def nodes_for(conn, uuid, rules=None):
    """{node: True/False} for one player; later subjects (higher levels, roles) override earlier ones."""
    rules = rules if rules is not None else load(conn)
    subjects, _ = subjects_for(conn, L.norm_uuid(uuid))
    out = {}
    for s in subjects:
        for n in rules.get(s, []):
            out[n.lstrip("-")] = not n.startswith("-")
    return out
