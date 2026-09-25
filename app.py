"""Mc.Tierlist.Asia — Minecraft Vanilla PvP tier list with developer API and Discord admin panel."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, abort, g, jsonify, redirect, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"


# ---------------------------------------------------------------- config
def load_dotenv(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(ROOT / ".env")


def env_list(name, default):
    return [s.strip() for s in os.environ.get(name, default).split(",") if s.strip()]


PORT = int(os.environ.get("PORT") or os.environ.get("SERVER_PORT") or 3000)
HOST = os.environ.get("HOST", "0.0.0.0")
BASE_URL = os.environ.get("BASE_URL", f"http://localhost:{PORT}").rstrip("/")
PRODUCTION = (os.environ.get("APP_ENV") or os.environ.get("NODE_ENV") or "").lower() == "production"
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = f"{BASE_URL}/auth/discord/callback"
# Super admins listed here are seeded on start and can never be removed or demoted from the panel.
SUPER_ADMIN_IDS = env_list("SUPER_ADMIN_IDS", "995145509897523221")
# Regular admins seeded on first start; afterwards they are managed from the panel.
SEED_ADMIN_IDS = env_list("ADMIN_IDS", "1041596704434167868")
API_RATE_LIMIT = int(os.environ.get("API_RATE_LIMIT_PER_MIN") or 60)
SITE_RATE_LIMIT = int(os.environ.get("SITE_RATE_LIMIT_PER_MIN") or 240)
ALLOW_DEV_LOGIN = os.environ.get("ALLOW_DEV_LOGIN") == "true" and not PRODUCTION

if not SESSION_SECRET:
    if PRODUCTION:
        raise SystemExit("SESSION_SECRET must be set in production")
    SESSION_SECRET = "dev-only-insecure-secret"
    print("[config] SESSION_SECRET is not set; using an insecure development secret.")

TIERS = [("HT1", 60), ("LT1", 45), ("HT2", 30), ("LT2", 20), ("HT3", 10),
         ("LT3", 6), ("HT4", 4), ("LT4", 3), ("HT5", 2), ("LT5", 1)]
TIER_POINTS = dict(TIERS)
REGIONS = [("AS", "Asia"), ("NA", "North America"), ("EU", "Europe"),
           ("SA", "South America"), ("OC", "Oceania"), ("AF", "Africa")]
REGION_IDS = {r for r, _ in REGIONS}
MODES = [{"id": "vanilla", "name": "Vanilla"}]

NAME_RE = re.compile(r"^[A-Za-z0-9_]{2,16}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$", re.I)
DISCORD_ID_RE = re.compile(r"^\d{15,21}$")


def now_ms():
    return int(time.time() * 1000)


def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()


def clamp_int(value, lo, hi, fallback):
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return fallback


# ---------------------------------------------------------------- database
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "tierlist.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  uuid        TEXT,
  region      TEXT NOT NULL,
  tier        TEXT NOT NULL,
  retired     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);
CREATE TABLE IF NOT EXISTS admins (
  discord_id    TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('super', 'admin')),
  username      TEXT,
  avatar        TEXT,
  added_by      TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  usage_count   INTEGER NOT NULL DEFAULT 0,
  revoked       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
"""


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        ts = now_ms()
        for admin_id in SUPER_ADMIN_IDS:
            conn.execute(
                "INSERT INTO admins (discord_id, role, added_by, created_at) VALUES (?, 'super', 'config', ?) "
                "ON CONFLICT(discord_id) DO UPDATE SET role = 'super'", (admin_id, ts))
        seeded = conn.execute("SELECT COUNT(*) FROM audit_log WHERE action = 'seed'").fetchone()[0] > 0
        if not seeded:
            for admin_id in SEED_ADMIN_IDS:
                conn.execute("INSERT OR IGNORE INTO admins (discord_id, role, added_by, created_at) "
                             "VALUES (?, 'admin', 'config', ?)", (admin_id, ts))
            conn.execute("INSERT INTO audit_log (actor_name, action, detail, created_at) "
                         "VALUES ('system', 'seed', 'Initial admins seeded', ?)", (ts,))


def db():
    if "db" not in g:
        g.db = connect()
    return g.db


def audit(actor, action, detail=None):
    db().execute("INSERT INTO audit_log (actor_id, actor_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                 (actor.get("id") if actor else None, actor.get("username") if actor else "system",
                  action, detail, now_ms()))
    db().commit()


def ranked_players():
    """All players with points and competition-style rank (ties share a rank)."""
    rows = [dict(r) for r in db().execute("SELECT * FROM players").fetchall()]
    for p in rows:
        p["points"] = TIER_POINTS.get(p["tier"], 0)
    rows.sort(key=lambda p: (-p["points"], p["retired"], p["name"].lower()))
    rank = 0
    for i, p in enumerate(rows):
        if i == 0 or p["points"] != rows[i - 1]["points"]:
            rank = i + 1
        p["rank"] = rank
    return rows


def public_player(p):
    return {
        "rank": p["rank"],
        "name": p["name"],
        "uuid": p["uuid"] or None,
        "region": p["region"],
        "points": p["points"],
        "tiers": {"vanilla": {"tier": p["tier"], "points": p["points"], "retired": bool(p["retired"])}},
        "updatedAt": datetime.fromtimestamp(p["updated_at"] / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def site_stats():
    players = ranked_players()
    return {
        "players": len(players),
        "tier1": sum(1 for p in players if p["tier"] in ("HT1", "LT1")),
        "regions": len({p["region"] for p in players}),
        "modes": 1,
    }


# ---------------------------------------------------------------- rate limiting
class RateLimiter:
    """Fixed-window in-memory rate limiter keyed by an arbitrary string."""

    def __init__(self, limit_per_min):
        self.limit = limit_per_min
        self.windows = {}
        self.lock = threading.Lock()

    def hit(self, key):
        """Returns (allowed, headers)."""
        now = time.time()
        with self.lock:
            if len(self.windows) > 10000:
                self.windows = {k: w for k, w in self.windows.items() if w[1] > now}
            count, reset = self.windows.get(key, (0, 0))
            if reset <= now:
                count, reset = 0, now + 60
            count += 1
            self.windows[key] = (count, reset)
        headers = {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(max(0, self.limit - count)),
            "X-RateLimit-Reset": str(int(reset + 0.999)),
        }
        if count > self.limit:
            headers["Retry-After"] = str(int(reset - now + 0.999))
            return False, headers
        return True, headers


api_limiter = RateLimiter(API_RATE_LIMIT)
site_limiter = RateLimiter(SITE_RATE_LIMIT)


# ---------------------------------------------------------------- app
app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    SECRET_KEY=SESSION_SECRET,
    SESSION_COOKIE_NAME="mctl_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=BASE_URL.startswith("https://"),
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=32 * 1024,
)
app.json.ensure_ascii = False
app.json.sort_keys = False


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


@app.after_request
def security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["X-Frame-Options"] = "DENY"
    for k, v in getattr(g, "extra_headers", {}).items():
        resp.headers[k] = v
    return resp


def error(status, code, message=None):
    body = {"error": code}
    if message:
        body["message"] = message
    return jsonify(body), status


# ---------------------------------------------------------------- public read API
def read_stats():
    return jsonify(site_stats())


def read_modes():
    return jsonify({
        "modes": MODES,
        "tiers": [{"id": t, "points": p} for t, p in TIERS],
        "regions": [{"id": r, "name": n} for r, n in REGIONS],
    })


def read_rankings(mode):
    if not any(m["id"] == mode for m in MODES):
        return error(404, "unknown_mode")
    players = ranked_players()
    region = (request.args.get("region") or "").upper()
    if region:
        if region not in REGION_IDS:
            return error(400, "invalid_region")
        players = [p for p in players if p["region"] == region]
    tier = (request.args.get("tier") or "").upper()
    # Accepts an exact tier ("HT1") or a tier group ("1" matches HT1 and LT1).
    if tier:
        players = [p for p in players if (p["tier"].endswith(tier) if re.fullmatch(r"[1-5]", tier) else p["tier"] == tier)]
    search = (request.args.get("search") or "").lower()
    if search:
        players = [p for p in players if search in p["name"].lower()]
    limit = clamp_int(request.args.get("limit"), 1, 100, 50)
    offset = clamp_int(request.args.get("offset"), 0, 10**9, 0)
    return jsonify({"mode": mode, "total": len(players), "limit": limit, "offset": offset,
                    "players": [public_player(p) for p in players[offset:offset + limit]]})


def read_player(name):
    name = name.lower()
    bare = name.replace("-", "")
    for p in ranked_players():
        if p["name"].lower() == name or (p["uuid"] and p["uuid"].replace("-", "").lower() == bare):
            return jsonify(public_player(p))
    return error(404, "player_not_found")


def dispatch_read(path):
    parts = [s for s in path.split("/") if s]
    if parts == ["stats"]:
        return read_stats()
    if parts == ["modes"]:
        return read_modes()
    if len(parts) == 2 and parts[0] == "rankings":
        return read_rankings(parts[1])
    if parts == ["players"]:
        return read_rankings("vanilla")
    if len(parts) == 2 and parts[0] == "players":
        return read_player(parts[1])
    return error(404, "not_found")


@app.route("/api/v1/", defaults={"path": ""}, methods=["GET", "OPTIONS"])
@app.route("/api/v1/<path:path>", methods=["GET", "OPTIONS"])
def api_v1(path):
    """Developer API: requires an API key."""
    g.extra_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "X-API-Key, Authorization",
        "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
    }
    if request.method == "OPTIONS":
        return "", 204
    auth = request.headers.get("Authorization", "")
    key = request.headers.get("X-API-Key") or (auth[7:] if auth.startswith("Bearer ") else "")
    if not key:
        return error(401, "missing_api_key", "Send your key in the X-API-Key header.")
    row = db().execute("SELECT id, revoked FROM api_keys WHERE key_hash = ?", (sha256(key.strip()),)).fetchone()
    if not row or row["revoked"]:
        return error(401, "invalid_api_key")
    allowed, headers = api_limiter.hit(f"key:{row['id']}")
    g.extra_headers.update(headers)
    if not allowed:
        return error(429, "rate_limited", "Too many requests, slow down.")
    db().execute("UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?", (now_ms(), row["id"]))
    db().commit()
    return dispatch_read(path)


@app.route("/api/site/<path:path>")
def api_site(path):
    """Website's own API: same-origin only, rate limited per IP."""
    fetch_site = request.headers.get("Sec-Fetch-Site")
    if fetch_site and fetch_site != "same-origin":
        return error(403, "use_developer_api", "Use /api/v1 with an API key.")
    allowed, headers = site_limiter.hit(f"ip:{request.remote_addr}")
    g.extra_headers = headers
    if not allowed:
        return error(429, "rate_limited", "Too many requests, slow down.")
    return dispatch_read(path)


# ---------------------------------------------------------------- auth
DISCORD_API = "https://discord.com/api/v10"


def http_json(url, data=None, headers=None):
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": "Mc.Tierlist.Asia", **(headers or {})})
    if body:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode())


@app.get("/auth/discord")
def discord_login():
    if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET:
        return redirect("/admin?error=not_configured")
    state = secrets.token_hex(16)
    session["oauth_state"] = state
    params = urllib.parse.urlencode({
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify",
        "state": state,
        "prompt": "none",
    })
    return redirect(f"https://discord.com/oauth2/authorize?{params}")


@app.get("/auth/discord/callback")
def discord_callback():
    code, state = request.args.get("code"), request.args.get("state")
    expected = session.pop("oauth_state", None)
    if not code or not state or not expected or not secrets.compare_digest(state, expected):
        return redirect("/admin?error=invalid_state")
    try:
        token = http_json(f"{DISCORD_API}/oauth2/token", {
            "client_id": DISCORD_CLIENT_ID,
            "client_secret": DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": DISCORD_REDIRECT_URI,
        })
        user = http_json(f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bearer {token['access_token']}"})
    except (urllib.error.URLError, KeyError, ValueError) as exc:
        print(f"[auth] Discord login failed: {exc}")
        return redirect("/admin?error=discord_failed")
    return sign_in({"id": user["id"], "username": user.get("global_name") or user["username"], "avatar": user.get("avatar")})


if ALLOW_DEV_LOGIN:
    print("[auth] ALLOW_DEV_LOGIN is enabled — /auth/dev lets anyone sign in as any admin. Never enable in production.")

    @app.get("/auth/dev")
    def dev_login():
        uid = request.args.get("id", "")
        return sign_in({"id": uid, "username": f"dev-{uid}", "avatar": None})


def sign_in(user):
    admin = db().execute("SELECT * FROM admins WHERE discord_id = ?", (user["id"],)).fetchone()
    if not admin:
        audit(user, "login_denied", "Not an admin")
        return redirect("/admin?error=not_admin")
    db().execute("UPDATE admins SET username = ?, avatar = ?, last_login_at = ? WHERE discord_id = ?",
                 (user["username"], user["avatar"], now_ms(), user["id"]))
    db().commit()
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    audit(user, "login")
    return redirect("/admin")


@app.post("/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


def same_origin():
    """Blocks cross-origin state-changing requests to the cookie-authenticated admin API."""
    if request.method in ("GET", "HEAD"):
        return True
    origin = request.headers.get("Origin")
    if origin:
        return urllib.parse.urlsplit(origin).netloc == request.host
    fetch_site = request.headers.get("Sec-Fetch-Site")
    return not fetch_site or fetch_site == "same-origin"


def admin_route(rule, methods=("GET",), super_only=False):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not same_origin():
                return error(403, "bad_origin")
            # Reload the admin on every request so removals take effect immediately.
            uid = session.get("user_id")
            row = uid and db().execute("SELECT * FROM admins WHERE discord_id = ?", (uid,)).fetchone()
            if not row:
                session.pop("user_id", None)
                return error(401, "unauthorized")
            g.admin = {"id": row["discord_id"], "username": row["username"] or row["discord_id"],
                       "avatar": row["avatar"], "role": row["role"]}
            if super_only and g.admin["role"] != "super":
                return error(403, "forbidden", "只有超級管理員可以執行此操作")
            return fn(*args, **kwargs)
        app.add_url_rule(f"/api/admin{rule}", endpoint=f"admin_{fn.__name__}", view_func=wrapper, methods=list(methods))
        return wrapper
    return decorator


def bad(message):
    return error(400, "bad_request", message)


def body():
    return request.get_json(silent=True) or {}


# ---------------------------------------------------------------- admin API
@admin_route("/me")
def me():
    return jsonify(g.admin)


@admin_route("/overview")
def overview():
    keys = db().execute("SELECT COUNT(*) AS n, COALESCE(SUM(usage_count), 0) AS calls FROM api_keys WHERE revoked = 0").fetchone()
    admins = db().execute("SELECT COUNT(*) FROM admins").fetchone()[0]
    recent = [dict(r) for r in db().execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 8").fetchall()]
    return jsonify({**site_stats(), "activeKeys": keys["n"], "apiCalls": keys["calls"], "admins": admins, "recent": recent})


def validate_player(data):
    name = str(data.get("name") or "").strip()
    uuid = str(data.get("uuid") or "").strip() or None
    region = str(data.get("region") or "").upper()
    tier = str(data.get("tier") or "").upper()
    if not NAME_RE.match(name):
        return None, "玩家名稱需為 2–16 個英數字或底線"
    if uuid and not UUID_RE.match(uuid):
        return None, "UUID 格式不正確"
    if region not in REGION_IDS:
        return None, "請選擇地區"
    if tier not in TIER_POINTS:
        return None, "請選擇 Tier"
    return {"name": name, "uuid": uuid, "region": region, "tier": tier, "retired": 1 if data.get("retired") else 0}, None


@admin_route("/players")
def list_players():
    return jsonify({"players": ranked_players()})


@admin_route("/players", methods=["POST"])
def create_player():
    value, err = validate_player(body())
    if err:
        return bad(err)
    if db().execute("SELECT 1 FROM players WHERE name = ?", (value["name"],)).fetchone():
        return bad("此玩家已存在")
    ts = now_ms()
    db().execute("INSERT INTO players (name, uuid, region, tier, retired, created_at, updated_at, updated_by) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                 (value["name"], value["uuid"], value["region"], value["tier"], value["retired"], ts, ts, g.admin["id"]))
    db().commit()
    audit(g.admin, "player_create", f"{value['name']} → {value['tier']} ({value['region']})")
    return jsonify({"ok": True}), 201


@admin_route("/players/<int:pid>", methods=["PUT"])
def update_player(pid):
    existing = db().execute("SELECT * FROM players WHERE id = ?", (pid,)).fetchone()
    if not existing:
        return error(404, "not_found")
    value, err = validate_player(body())
    if err:
        return bad(err)
    if db().execute("SELECT 1 FROM players WHERE name = ? AND id != ?", (value["name"], pid)).fetchone():
        return bad("已有其他玩家使用這個名稱")
    db().execute("UPDATE players SET name = ?, uuid = ?, region = ?, tier = ?, retired = ?, updated_at = ?, updated_by = ? "
                 "WHERE id = ?",
                 (value["name"], value["uuid"], value["region"], value["tier"], value["retired"], now_ms(), g.admin["id"], pid))
    db().commit()
    change = f"{existing['tier']} → {value['tier']}" if existing["tier"] != value["tier"] else "details updated"
    audit(g.admin, "player_update", f"{value['name']}: {change}")
    return jsonify({"ok": True})


@admin_route("/players/<int:pid>", methods=["DELETE"])
def delete_player(pid):
    existing = db().execute("SELECT * FROM players WHERE id = ?", (pid,)).fetchone()
    if not existing:
        return error(404, "not_found")
    db().execute("DELETE FROM players WHERE id = ?", (pid,))
    db().commit()
    audit(g.admin, "player_delete", existing["name"])
    return jsonify({"ok": True})


@admin_route("/keys")
def list_keys():
    rows = db().execute("""
        SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.usage_count, k.revoked, k.created_by,
               a.username AS created_by_name
        FROM api_keys k LEFT JOIN admins a ON a.discord_id = k.created_by ORDER BY k.id DESC""").fetchall()
    return jsonify({"keys": [dict(r) for r in rows]})


@admin_route("/keys", methods=["POST"])
def create_key():
    name = str(body().get("name") or "").strip()
    if not name or len(name) > 48:
        return bad("請輸入 1–48 字的名稱")
    key = f"mctl_{secrets.token_urlsafe(24)}"
    db().execute("INSERT INTO api_keys (name, prefix, key_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
                 (name, key[:12], sha256(key), g.admin["id"], now_ms()))
    db().commit()
    audit(g.admin, "key_create", name)
    return jsonify({"key": key}), 201


@admin_route("/keys/<int:kid>", methods=["PATCH"])
def toggle_key(kid):
    row = db().execute("SELECT * FROM api_keys WHERE id = ?", (kid,)).fetchone()
    if not row:
        return error(404, "not_found")
    revoked = 1 if body().get("revoked") else 0
    db().execute("UPDATE api_keys SET revoked = ? WHERE id = ?", (revoked, kid))
    db().commit()
    audit(g.admin, "key_revoke" if revoked else "key_restore", row["name"])
    return jsonify({"ok": True})


@admin_route("/keys/<int:kid>", methods=["DELETE"])
def delete_key(kid):
    row = db().execute("SELECT * FROM api_keys WHERE id = ?", (kid,)).fetchone()
    if not row:
        return error(404, "not_found")
    db().execute("DELETE FROM api_keys WHERE id = ?", (kid,))
    db().commit()
    audit(g.admin, "key_delete", row["name"])
    return jsonify({"ok": True})


@admin_route("/admins")
def list_admins():
    rows = db().execute("SELECT * FROM admins ORDER BY role DESC, created_at ASC").fetchall()
    return jsonify({"admins": [{**dict(r), "protected": r["discord_id"] in SUPER_ADMIN_IDS} for r in rows]})


def guard_target(target_id):
    if target_id in SUPER_ADMIN_IDS:
        return bad("此超級管理員由伺服器設定保護，無法在後台修改")
    if target_id == g.admin["id"]:
        return bad("不能修改自己的權限")
    return None


@admin_route("/admins", methods=["POST"], super_only=True)
def add_admin():
    data = body()
    target = str(data.get("discordId") or "").strip()
    role = "super" if data.get("role") == "super" else "admin"
    if not DISCORD_ID_RE.match(target):
        return bad("Discord ID 格式不正確（15–21 位數字）")
    if db().execute("SELECT 1 FROM admins WHERE discord_id = ?", (target,)).fetchone():
        return bad("此使用者已是管理員")
    db().execute("INSERT INTO admins (discord_id, role, added_by, created_at) VALUES (?, ?, ?, ?)",
                 (target, role, g.admin["id"], now_ms()))
    db().commit()
    audit(g.admin, "admin_add", f"{target} ({role})")
    return jsonify({"ok": True}), 201


@admin_route("/admins/<target>", methods=["PUT"], super_only=True)
def set_admin_role(target):
    blocked = guard_target(target)
    if blocked:
        return blocked
    row = db().execute("SELECT * FROM admins WHERE discord_id = ?", (target,)).fetchone()
    if not row:
        return error(404, "not_found")
    role = "super" if body().get("role") == "super" else "admin"
    db().execute("UPDATE admins SET role = ? WHERE discord_id = ?", (role, target))
    db().commit()
    audit(g.admin, "admin_role", f"{row['username'] or target}: {row['role']} → {role}")
    return jsonify({"ok": True})


@admin_route("/admins/<target>", methods=["DELETE"], super_only=True)
def remove_admin(target):
    blocked = guard_target(target)
    if blocked:
        return blocked
    row = db().execute("SELECT * FROM admins WHERE discord_id = ?", (target,)).fetchone()
    if not row:
        return error(404, "not_found")
    db().execute("DELETE FROM admins WHERE discord_id = ?", (target,))
    db().commit()
    audit(g.admin, "admin_remove", row["username"] or target)
    return jsonify({"ok": True})


@admin_route("/audit")
def audit_list():
    limit = clamp_int(request.args.get("limit"), 1, 200, 100)
    rows = db().execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return jsonify({"entries": [dict(r) for r in rows]})


@app.route("/api/admin/<path:_rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def admin_not_found(_rest):
    return error(404, "not_found")


# ---------------------------------------------------------------- pages & static files
def page(name, status=200):
    resp = send_from_directory(PUBLIC, name, max_age=0)
    resp.status_code = status
    return resp


@app.get("/")
def home():
    return page("index.html")


@app.get("/player/<path:_name>")
def player_page(_name):
    return page("player.html")


@app.get("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(PUBLIC / "assets", filename, max_age=3600)


@app.get("/<name>")
def named_page(name):
    if re.fullmatch(r"[a-z0-9-]+", name) and name != "404" and (PUBLIC / f"{name}.html").is_file():
        return page(f"{name}.html")
    abort(404)


@app.errorhandler(404)
def not_found(_exc):
    if request.path.startswith("/api/"):
        return error(404, "not_found")
    return page("404.html", 404)


@app.errorhandler(413)
def too_large(_exc):
    return error(413, "payload_too_large")


init_db()

if __name__ == "__main__":
    from waitress import serve

    print(f"Mc.Tierlist.Asia running on {BASE_URL} (port {PORT})")
    serve(app, host=HOST, port=PORT, threads=8)
