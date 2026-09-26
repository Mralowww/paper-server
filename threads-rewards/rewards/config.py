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
# 額外視為管理員的身分組 ID（逗號分隔）；擁有 Administrator / Manage Server 權限者一律視為管理員
ADMIN_ROLE_IDS = _ids(os.getenv("ADMIN_ROLE_IDS", ""))
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
