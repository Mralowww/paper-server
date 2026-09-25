"""Editable text of the Discord test-application panel (stored in settings, edited from the website)."""
import json

from . import config as C
from . import db as D

DEFAULTS = {
    "title": "Vanilla 考試申請",
    "description": "點擊下方按鈕並輸入你的 Minecraft ID，即可申請 Vanilla 考試。",
    "rules_title": "申請須知",
    "rules": ("- 考試結果公布後，需等待 {cooldown} 天才能再次申請\n"
              "- 請使用正版 Java 帳號的 ID，系統會自動驗證\n"
              "- 送出後會為你建立專屬的考試頻道"),
    "types_title": "考試類型",
    "types": ("- 一般考試：目前段位 LT3 以下（含未排名），由考官負責\n"
              "- 高階考試：目前段位 HT3 以上，由高階考官負責"),
    "button": "申請考試",
    "paused_button": "暫停申請中",
    "color": "#F2C14E",
}
LIMITS = {"title": 100, "description": 1500, "rules_title": 100, "rules": 1000, "types_title": 100, "types": 1000,
          "button": 40, "paused_button": 40, "color": 7}


def load(conn):
    raw = D.get_setting(conn, "apply_panel")
    data = dict(DEFAULTS)
    if raw:
        try:
            data.update({k: v for k, v in json.loads(raw).items() if k in DEFAULTS})
        except ValueError:
            pass
    return data


def validate(body):
    out = {}
    for key, default in DEFAULTS.items():
        value = str(body.get(key, default) or "").strip()
        if key in ("title", "button", "paused_button") and not value:
            return None, key
        if len(value) > LIMITS[key]:
            return None, key
        out[key] = value
    color = out["color"].lstrip("#")
    if len(color) != 6 or any(c not in "0123456789abcdefABCDEF" for c in color):
        return None, "color"
    out["color"] = f"#{color.upper()}"
    return out, None


def save(conn, data):
    D.set_setting(conn, "apply_panel", json.dumps(data, ensure_ascii=False))


def applications_open(conn):
    return D.get_setting(conn, "applications_open", "1") == "1"


def render(text):
    return text.replace("{cooldown}", str(C.TEST_COOLDOWN_DAYS))


# ---------------------------------------------------------------- result embed template
RESULT_DEFAULTS = {
    "title": "{player} 的考試結果 🏆",
    "tester": "考官",
    "region": "地區",
    "region_value": "台灣",
    "username": "玩家名稱",
    "previous": "原本段位",
    "earned": "獲得段位",
    "wins": "勝場",
    "losses": "敗場",
    "tier_format": "{level} Tier {n}",
    "high": "高階",
    "low": "低階",
    "unranked": "未排名",
    "footer": "Mc.Tierlist.Asia",
}
RESULT_LIMITS = {"title": 200, "tier_format": 60, "footer": 200}


def load_result(conn):
    raw = D.get_setting(conn, "result_template")
    data = dict(RESULT_DEFAULTS)
    if raw:
        try:
            data.update({k: v for k, v in json.loads(raw).items() if k in RESULT_DEFAULTS})
        except ValueError:
            pass
    return data


def validate_result(body):
    out = {}
    for key, default in RESULT_DEFAULTS.items():
        value = str(body.get(key, default) or "").strip()
        if not value or len(value) > RESULT_LIMITS.get(key, 100):
            return None, key
        out[key] = value
    return out, None


def save_result(conn, data):
    D.set_setting(conn, "result_template", json.dumps(data, ensure_ascii=False))


def tier_label(tpl, tier):
    """LT5 → e.g. "低階 Tier 5" using the template; None → the unranked text."""
    if not tier:
        return tpl["unranked"]
    return (tpl["tier_format"].replace("{code}", tier).replace("{n}", tier[2])
            .replace("{level}", tpl["high"] if tier[0] == "H" else tpl["low"]))
