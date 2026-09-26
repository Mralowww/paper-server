import os
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()


def _ids(value: str) -> set[str]:
    return {v.strip() for v in value.split(",") if v.strip()}


DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.getenv("DISCORD_REDIRECT_URI", "http://localhost:8000/auth/callback")
DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
DISCORD_GUILD_ID = os.getenv("DISCORD_GUILD_ID", "")
# 權限分級（身分組 ID，逗號分隔）：
#   客服 SUPPORT_ROLE_IDS  → 處理支援單
#   管理員 MOD_ROLE_IDS     → 支援單 + 懲處 / 玩家管理
#   超級管理員 ADMIN_ROLE_IDS → 全部（擁有 Administrator / Manage Server 權限或伺服器擁有者自動是）
SUPPORT_ROLE_IDS = _ids(os.getenv("SUPPORT_ROLE_IDS", ""))
MOD_ROLE_IDS = _ids(os.getenv("MOD_ROLE_IDS", ""))
ADMIN_ROLE_IDS = _ids(os.getenv("ADMIN_ROLE_IDS", ""))
# 擁有者 Discord 使用者 ID（逗號分隔），永遠是最高權限
OWNER_IDS = _ids(os.getenv("OWNER_IDS", ""))
# 新支援單通知頻道
TICKET_CHANNEL_ID = os.getenv("TICKET_CHANNEL_ID", "")
# 網站公開網址（用於 Discord 通知中的連結）
PUBLIC_URL = os.getenv("PUBLIC_URL", "https://www.sawsmp.me").rstrip("/")
# Minecraft 插件呼叫 /api/plugin/* 時使用的金鑰（Header: X-API-Key）
PLUGIN_API_KEY = os.getenv("PLUGIN_API_KEY", "")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "data/uploads")
# 每週結算結果公告頻道
ANNOUNCE_CHANNEL_ID = os.getenv("ANNOUNCE_CHANNEL_ID", "")
# 是否要求使用者必須在伺服器內才能上傳連結
REQUIRE_GUILD_MEMBER = os.getenv("REQUIRE_GUILD_MEMBER", "true").lower() == "true"

SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me-please")
DATABASE_PATH = os.getenv("DATABASE_PATH", "data/rewards.db")
TIMEZONE = ZoneInfo(os.getenv("TIMEZONE", "Asia/Taipei"))
# 抓取 Threads 數據的間隔（分鐘）
SCRAPE_INTERVAL_MIN = int(os.getenv("SCRAPE_INTERVAL_MIN", "60"))
MAX_LINKS_PER_WEEK = int(os.getenv("MAX_LINKS_PER_WEEK", "10"))
# 本地測試用：開啟後 /auth/dev-login?id=...&admin=1 可略過 Discord 登入（正式環境務必關閉）
DEV_LOGIN = os.getenv("DEV_LOGIN", "false").lower() == "true"


def setting_or_env(key: str, env_value: str) -> str:
    """後台設定優先，其次 .env。"""
    from . import db
    return (db.settings().get(key) or "").strip() or env_value
