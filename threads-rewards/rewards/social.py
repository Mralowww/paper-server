"""社群短網址：/discord、/ig、/threads。網站上不顯示任何按鈕，後台可改連結並決定是否開放轉接。"""
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

from . import db

router = APIRouter()
STATIC = Path(__file__).resolve().parent.parent / "static"
# 代碼 → (網址設定, 開放設定, 預設網址)
LINKS = {
    "discord": ("discord_invite", "link_open_discord", "https://discord.gg/YEb2EfcsxY"),
    "ig": ("ig_url", "link_open_ig", "https://www.instagram.com/sawsmp_official_ig/"),
    "threads": ("threads_url", "link_open_threads", "https://www.threads.com/@sawsmp_official"),
}
ALIASES = {"/discord": "discord", "/dc": "discord", "/ig": "ig", "/instagram": "ig", "/threads": "threads"}


def target(key: str) -> str | None:
    url_key, open_key, default = LINKS[key]
    s = db.settings()
    if s.get(open_key) != "1":
        return None
    url = (s.get(url_key) or default).strip()
    return url if url.startswith("https://") else None


def _handler(key: str):
    async def go():
        url = target(key)
        if url:
            return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})
        return FileResponse(STATIC / "go.html", headers={"Cache-Control": "no-store"})
    return go


for path, key in ALIASES.items():
    router.add_api_route(path, _handler(key), include_in_schema=False)
