"""Site-wide state: launch countdown, per-page maintenance and announcement banners (stored in settings)."""
import hashlib
import json
import re
import secrets
from datetime import datetime

from . import config as C
from . import db as D

PAGES = ["home", "rankings", "player", "support", "docs", "me", "tester"]
STYLES = ("gold", "info", "warn")
LINK_RE = re.compile(r"^(https://[^\s<>\"']{3,300}|/[A-Za-z0-9\-._~/%?=&#]{0,200})$")
MAX_ANNOUNCEMENTS = 10
SETTING_KEY = "site_state"


def _default_launch():
    try:
        return int(datetime.fromisoformat(C.LAUNCH_AT).timestamp() * 1000) if C.LAUNCH_AT else None
    except ValueError:
        print(f"[site] invalid LAUNCH_AT: {C.LAUNCH_AT!r}")
        return None


def _blank_maint():
    return {"on": False, "reason": "", "until": None}


def load(conn):
    raw = D.get_setting(conn, SETTING_KEY)
    state = json.loads(raw) if raw else {"launchAt": _default_launch()}
    maint = state.get("maintenance") or {}
    return {
        "launchAt": state.get("launchAt"),
        "maintenance": {
            "all": {**_blank_maint(), **(maint.get("all") or {})},
            "pages": {p: {**_blank_maint(), **((maint.get("pages") or {}).get(p) or {})} for p in PAGES},
        },
        "announcements": state.get("announcements") or [],
    }


def _ms(value):
    if value in (None, "", 0):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value < 4102444800000:
        raise ValueError("invalid_time")
    return int(value)


def _text(value, max_len):
    return str(value or "").strip()[:max_len]


def _maint(data):
    data = data if isinstance(data, dict) else {}
    return {"on": bool(data.get("on")), "reason": _text(data.get("reason"), 200), "until": _ms(data.get("until"))}


def _announcement(data):
    if not isinstance(data, dict):
        raise ValueError("invalid_announcement")
    text = _text(data.get("text"), 300)
    if not text:
        raise ValueError("announcement_empty")
    link = _text(data.get("link"), 300)
    if link and not LINK_RE.match(link):
        raise ValueError("invalid_link")
    style = data.get("style") if data.get("style") in STYLES else "gold"
    start, end = _ms(data.get("startAt")), _ms(data.get("endAt"))
    if start and end and end <= start:
        raise ValueError("invalid_range")
    aid = data.get("id") if isinstance(data.get("id"), str) and re.fullmatch(r"[a-z0-9]{6,16}", data["id"]) else secrets.token_hex(4)
    # rev changes whenever the content changes, so a dismissed banner comes back after an edit.
    rev = hashlib.sha256(f"{text}\n{link}".encode()).hexdigest()[:8]
    return {"id": aid, "text": text, "style": style, "dismissible": bool(data.get("dismissible", True)),
            "link": link, "linkText": _text(data.get("linkText"), 40), "startAt": start, "endAt": end, "rev": rev}


def validate(data):
    """Raises ValueError(code) on bad input; returns the normalized state."""
    if not isinstance(data, dict):
        raise ValueError("invalid_body")
    maint = data.get("maintenance") if isinstance(data.get("maintenance"), dict) else {}
    pages = maint.get("pages") if isinstance(maint.get("pages"), dict) else {}
    anns = data.get("announcements") or []
    if not isinstance(anns, list) or len(anns) > MAX_ANNOUNCEMENTS:
        raise ValueError("too_many_announcements")
    return {
        "launchAt": _ms(data.get("launchAt")),
        "maintenance": {"all": _maint(maint.get("all")), "pages": {p: _maint(pages.get(p)) for p in PAGES}},
        "announcements": [_announcement(a) for a in anns],
    }


def save(conn, state):
    D.set_setting(conn, SETTING_KEY, json.dumps(state, ensure_ascii=False))


def gate(state, page, now=None):
    """What blocks this page for the public right now, or None."""
    now = now or D.now_ms()
    if state["launchAt"] and now < state["launchAt"]:
        return {"kind": "launch", "until": state["launchAt"]}
    for m in (state["maintenance"]["all"], state["maintenance"]["pages"].get(page)):
        if m and m["on"] and not (m["until"] and now >= m["until"]):
            return {"kind": "maintenance", "reason": m["reason"], "until": m["until"]}
    return None


def active_announcements(state, now=None):
    now = now or D.now_ms()
    return [a for a in state["announcements"]
            if (not a["startAt"] or now >= a["startAt"]) and (not a["endAt"] or now < a["endAt"])]
