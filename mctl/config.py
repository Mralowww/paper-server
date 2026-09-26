"""Settings loaded from the environment (and an optional .env file)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"


def _load_dotenv(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(ROOT / ".env")


def _list(name, default=""):
    return [s.strip() for s in os.environ.get(name, default).split(",") if s.strip()]


def _int(name, default):
    try:
        return int(os.environ.get(name) or default)
    except ValueError:
        return default


PORT = _int("PORT", 0) or _int("SERVER_PORT", 3000)
HOST = os.environ.get("HOST", "0.0.0.0")
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}").rstrip("/")
PRODUCTION = (os.environ.get("APP_ENV") or os.environ.get("NODE_ENV") or "").lower() == "production"
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = f"{BASE_URL}/auth/discord/callback"
DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
GUILD_ID = _int("DISCORD_GUILD_ID", 0)

# Accounts that always get full access, regardless of Discord roles.
OWNER_IDS = set(_list("SUPER_ADMIN_IDS", "995145509897523221"))

API_RATE_LIMIT = _int("API_RATE_LIMIT_PER_MIN", 60)
SITE_RATE_LIMIT = _int("SITE_RATE_LIMIT_PER_MIN", 240)
TEST_COOLDOWN_DAYS = _int("TEST_COOLDOWN_DAYS", 7)
# Origin protection: Cloudflare adds X-Origin-Secret (Transform Rule); only those requests are trusted.
ORIGIN_SECRET = os.environ.get("ORIGIN_SECRET", "")
ORIGIN_ENFORCE = os.environ.get("ORIGIN_ENFORCE", "false").lower() == "true"

# Cloudflare dynamic DNS: keeps these A records pointed at this host's public IP.
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")
CF_ZONE_ID = os.environ.get("CF_ZONE_ID", "")
CF_DNS_RECORDS = _list("CF_DNS_RECORDS", "tierlist.asia,www.tierlist.asia")
DDNS_INTERVAL = max(60, _int("DDNS_INTERVAL", 300))

# Site opens to the public at this time (ISO 8601, e.g. 2026-09-26T15:00:00+08:00); editable later in Settings.
LAUNCH_AT = os.environ.get("LAUNCH_AT", "")
DEFAULT_DISCORD_INVITE = os.environ.get("DISCORD_INVITE", "https://discord.gg/dYP9xdyq5v")
SERVER_ADDRESS = os.environ.get("SERVER_ADDRESS", "Mc.Tierlist.Asia")
UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_MAX_BYTES = 5 * 1024 * 1024
UPLOAD_MAX_FILES = 3
# Refuse new uploads once the data folder reaches this size (hosting plan has 1 GB).
STORAGE_LIMIT_BYTES = _int("STORAGE_LIMIT_MB", 900) * 1024 * 1024
SUPPORT_CATEGORIES = ("bug", "appeal", "report", "suggest", "other")
SUPPORT_MAX_OPEN = 3
ALLOW_DEV_LOGIN = os.environ.get("ALLOW_DEV_LOGIN") == "true" and not PRODUCTION

if not SESSION_SECRET:
    if PRODUCTION:
        raise SystemExit("SESSION_SECRET must be set in production")
    SESSION_SECRET = "dev-only-insecure-secret"
    print("[config] SESSION_SECRET is not set; using an insecure development secret.")

# ---------------------------------------------------------------- tiers
# (id, points, Discord role id), lowest first.
TIERS = [
    ("LT5", 1, 1515243509181972530),
    ("HT5", 2, 1515243496728952976),
    ("LT4", 3, 1515243484141850634),
    ("HT4", 4, 1515243471315931176),
    ("LT3", 6, 1515243457835176127),
    ("HT3", 10, 1515243441783574548),
    ("LT2", 20, 1515243424742117386),
    ("HT2", 30, 1515243407197601907),
    ("LT1", 45, 1515243393079447619),
    ("HT1", 60, 1515243364902113281),
]
TIER_ORDER = [t for t, _, _ in TIERS]                 # low → high
TIER_POINTS = {t: p for t, p, _ in TIERS}
TIER_ROLE = {t: r for t, _, r in TIERS}
ROLE_TIER = {r: t for t, _, r in TIERS}
TIER_NAMES = {t: f"{'High' if t[0] == 'H' else 'Low'} Tier {t[2]}" for t in TIER_ORDER}

# Testers may award up to LT3; senior testers anything. Players at HT3+ need a senior tester.
TESTER_MAX_TIER = "LT3"
HIGH_TEST_FROM = "HT3"

REGIONS = [("TW", "台灣")]
DEFAULT_REGION = "TW"
MODES = [{"id": "vanilla", "name": "Vanilla"}]
# Same thresholds MCTiers uses; with Vanilla only, 60 points (HT1) is the maximum.
TITLES = [(400, "Combat Grandmaster"), (250, "Combat Master"), (100, "Combat Ace"),
          (50, "Combat Specialist"), (20, "Combat Cadet"), (10, "Combat Novice"), (0, "Rookie")]

# ---------------------------------------------------------------- roles
ROLE_TESTER = 1515242436530671776
ROLE_SENIOR_TESTER = 1521945944994873374
ROLE_FOUNDER = 1510142660592271440
ROLE_DEVELOPER = 1510142660592271437
ROLE_ADMIN = 1510142660592271438
ROLE_MODERATOR = 1510142660592271439
ROLE_HELPER = 1510142660592271435
ROLE_BOOSTER = 1515239442267377807
ROLE_MEDIA = 1515646689879527495

# Access levels, highest wins.
LEVEL_MEMBER, LEVEL_HELPER, LEVEL_MODERATOR, LEVEL_ADMIN, LEVEL_OWNER = 1, 2, 3, 4, 5
LEVEL_NAMES = {1: "member", 2: "helper", 3: "moderator", 4: "admin", 5: "owner"}
ROLE_LEVEL = {
    ROLE_FOUNDER: LEVEL_OWNER,
    ROLE_DEVELOPER: LEVEL_OWNER,
    ROLE_ADMIN: LEVEL_ADMIN,
    ROLE_MODERATOR: LEVEL_MODERATOR,
    ROLE_HELPER: LEVEL_HELPER,
}
BADGE_ROLES = {ROLE_BOOSTER: "booster", ROLE_MEDIA: "media"}

# Roles worth caching locally (everything the site or bot cares about).
TRACKED_ROLES = set(ROLE_TIER) | set(ROLE_LEVEL) | set(BADGE_ROLES) | {ROLE_TESTER, ROLE_SENIOR_TESTER}


def access_for(discord_id, role_ids):
    roles = {int(r) for r in role_ids}
    level = max([LEVEL_MEMBER] + [ROLE_LEVEL[r] for r in roles if r in ROLE_LEVEL])
    if str(discord_id) in OWNER_IDS:
        level = LEVEL_OWNER
    senior = ROLE_SENIOR_TESTER in roles
    return {
        "level": level,
        "levelName": LEVEL_NAMES[level],
        "tester": senior or ROLE_TESTER in roles,
        "seniorTester": senior,
        "badges": [BADGE_ROLES[r] for r in BADGE_ROLES if r in roles],
    }


def tier_from_roles(role_ids):
    """Highest tier role a member holds, or None when unranked."""
    roles = {int(r) for r in role_ids}
    held = [t for t in TIER_ORDER if TIER_ROLE[t] in roles]
    return held[-1] if held else None


def title_for(points):
    return next(name for threshold, name in TITLES if points >= threshold)
