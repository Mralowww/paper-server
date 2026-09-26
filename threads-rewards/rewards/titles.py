"""稱號：依照玩家的各種數據自動取得的小徽章（與只看擊殺的段位分開），一個人可以同時擁有很多個。

後台設定 titles，每行「名稱|條件|顏色|圖示|介紹」；條件可用 & 串接，例如 kdr>=3&kills>=30。
可用的數值：playtime_h（小時）、kills、deaths、kdr、best_streak、wins、losses、matches、winrate、
各擊殺方式（crystal、anchor、mace、sword、axe、spear、trident、bow…）、weekly_champ（週冠軍次數）。
"""
import re

from . import db

DEFAULT = "\n".join([
    "常客|playtime_h>=24|#60a5fa|history|累積遊玩 24 小時",
    "老玩家|playtime_h>=100|#a78bfa|history|累積遊玩 100 小時",
    "肝帝|playtime_h>=300|#f59e0b|history|累積遊玩 300 小時，肝已經不是自己的了",
    "住在伺服器|playtime_h>=1000|rainbow|home|累積遊玩 1000 小時，伺服器就是你家",
    "第一滴血|kills>=1|#f87171|sword|拿下第一個擊殺",
    "百人斬|kills>=100|#ef4444|sword|累積 100 個擊殺",
    "連殺王|best_streak>=10|#fb7a3c|activity|單次連續擊殺 10 人",
    "無雙|best_streak>=25|rainbow|sparkle|單次連續擊殺 25 人，無人能擋",
    "收割機|kdr>=3&kills>=30|#22c55e|chart|KDR 達到 3（至少 30 殺）",
    "屢敗屢戰|deaths>=100|#9ca3af|shield|死亡 100 次依然回到戰場",
    "水晶大師|crystal>=50|#e879f9|crystal|用終界水晶擊殺 50 次",
    "錨定者|anchor>=30|#8b5cf6|anchor|用重生錨擊殺 30 次",
    "重錘之神|mace>=30|#94a3b8|mace|用重錘擊殺 30 次",
    "劍聖|sword>=50|#38bdf8|sword|用劍擊殺 50 次",
    "決鬥家|wins>=20|#0ea5e9|trophy|對戰勝利 20 場",
    "常勝軍|winrate>=70&matches>=20|#10b981|trophy|對戰勝率 70% 以上（至少 20 場）",
    "週冠軍|weekly_champ>=1|#fbbf24|trophy|拿過一次每週擊殺冠軍",
    "王朝|weekly_champ>=3|rainbow|gem|拿過 3 次每週擊殺冠軍",
])
_COND = re.compile(r"^\s*([a-z_]+)\s*(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)\s*$")


def _color(c: str) -> str:
    return c if c == "rainbow" or re.fullmatch(r"#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?", c or "") else "#9ca3af"


def definitions() -> list[dict]:
    raw = db.settings().get("titles") or DEFAULT
    out = []
    for i, line in enumerate(raw.splitlines()):
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 2 or not parts[0]:
            continue
        conds = [m.groups() for c in parts[1].split("&") if (m := _COND.match(c))]
        if not conds:
            continue
        out.append({"id": i, "name": parts[0][:20], "conds": [(k, op, float(v)) for k, op, v in conds],
                    "cond": parts[1], "color": _color(parts[2] if len(parts) > 2 else ""),
                    "icon": re.sub(r"[^a-z]", "", parts[3] if len(parts) > 3 else "") or "gem", "desc": parts[4] if len(parts) > 4 else ""})
    return out


def values(s: dict, methods: dict | None = None, champ: int = 0) -> dict:
    matches = (s.get("wins") or 0) + (s.get("losses") or 0)
    v = {"playtime_h": (s.get("playtime") or 0) / 3600, "kills": s.get("kills") or 0, "deaths": s.get("deaths") or 0,
         "kdr": (s.get("kills") or 0) / max(s.get("deaths") or 0, 1), "best_streak": s.get("best_streak") or 0,
         "wins": s.get("wins") or 0, "losses": s.get("losses") or 0, "matches": matches,
         "winrate": (s.get("wins") or 0) / matches * 100 if matches else 0, "weekly_champ": champ}
    v.update(methods or {})
    return v


def _ok(val: float, op: str, need: float) -> bool:
    return {">=": val >= need, "<=": val <= need, ">": val > need, "<": val < need, "=": val == need}[op]


def _progress(v: dict, t: dict) -> float:
    ps = []
    for k, op, need in t["conds"]:
        val = v.get(k, 0)
        ps.append(1.0 if _ok(val, op, need) else (min(1.0, val / need) if op in (">=", ">") and need > 0 else 0.0))
    return min(ps) if ps else 0.0


def evaluate(v: dict, defs: list[dict] | None = None, full: bool = False) -> list[dict]:
    defs = defs if defs is not None else definitions()
    out = []
    for t in defs:
        got = all(_ok(v.get(k, 0), op, need) for k, op, need in t["conds"])
        if got or full:
            item = {k: t[k] for k in ("id", "name", "color", "icon", "desc")}
            if full:
                item.update(earned=got, progress=round(_progress(v, t), 3))
            out.append(item)
    return out


def methods_for(uuids: list[str]) -> dict[str, dict]:
    if not uuids:
        return {}
    out: dict[str, dict] = {}
    for i in range(0, len(uuids), 500):
        chunk = uuids[i:i + 500]
        for r in db.query(f"SELECT uuid, method, count FROM kill_methods WHERE uuid IN ({','.join('?' * len(chunk))})", tuple(chunk)):
            out.setdefault(r["uuid"], {})[r["method"]] = r["count"]
    return out
