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
