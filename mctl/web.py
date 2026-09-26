"""Flask website: public pages, developer API, member pages and the staff panel."""
import hashlib
import hmac
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, abort, g, jsonify, redirect, request, send_from_directory, session

from . import bridge
from . import config as C
from . import db as D
from . import ddns
from . import panel as P
from . import site as S
from . import links as L
from . import gamestats as GS

NAME_RE = re.compile(r"^[A-Za-z0-9_]{2,16}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$", re.I)
DISCORD_ID_RE = re.compile(r"^\d{15,21}$")
DISCORD_API = "https://discord.com/api/v10"


def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()


def clamp_int(value, lo, hi, fallback):
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return fallback


class RateLimiter:
    """Fixed-window in-memory rate limiter keyed by an arbitrary string."""

    def __init__(self, limit_per_min):
        self.limit = limit_per_min
        self.windows = {}
        self.lock = threading.Lock()

    def hit(self, key):
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


api_limiter = RateLimiter(C.API_RATE_LIMIT)
site_limiter = RateLimiter(C.SITE_RATE_LIMIT)
server_limiter = RateLimiter(1200)  # the official server calls once per join

app = Flask(__name__, static_folder=None)
class OriginGuard:
    """Trusts client IP/scheme headers only on requests that carry Cloudflare's secret header.

    With ORIGIN_ENFORCE on, anything else (someone hitting the host's IP:port directly) is refused,
    so Cloudflare can't be bypassed and client IPs can't be spoofed for rate limiting.
    """

    def __init__(self, wsgi):
        self.wsgi = wsgi

    def __call__(self, environ, start_response):
        secret = C.ORIGIN_SECRET
        trusted = bool(secret) and hmac.compare_digest(environ.pop("HTTP_X_ORIGIN_SECRET", ""), secret)
        environ["mctl.via_cloudflare"] = trusted
        if not trusted and secret and C.ORIGIN_ENFORCE:
            start_response("403 Forbidden", [("Content-Type", "text/plain; charset=utf-8")])
            return [b"Forbidden: please use https://tierlist.asia"]
        if trusted or not C.ORIGIN_ENFORCE:
            # Until enforcement is switched on, keep honouring Cloudflare's headers so rate limits stay per-visitor.
            ip = environ.get("HTTP_CF_CONNECTING_IP")
            if ip:
                environ["REMOTE_ADDR"] = ip
            proto = environ.get("HTTP_X_FORWARDED_PROTO")
            if proto in ("http", "https"):
                environ["wsgi.url_scheme"] = proto
        return self.wsgi(environ, start_response)


app.wsgi_app = OriginGuard(app.wsgi_app)
app.config.update(
    SECRET_KEY=C.SESSION_SECRET,
    SESSION_COOKIE_NAME="mctl_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=C.BASE_URL.startswith("https://"),
    PERMANENT_SESSION_LIFETIME=timedelta(days=7),
    MAX_CONTENT_LENGTH=16 * 1024 * 1024,
)
app.json.ensure_ascii = False
app.json.sort_keys = False


def db():
    if "db" not in g:
        g.db = D.connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()
    D.AUDIT_CTX.set(None)


SECRET_FIELD_RE = re.compile(r"key|token|secret|password|code", re.I)


def scrub(value, depth=0):
    """Request data safe to keep in the audit log: secrets masked, long text trimmed."""
    if isinstance(value, dict):
        return {k: "***" if SECRET_FIELD_RE.search(str(k)) else scrub(v, depth + 1) for k, v in list(value.items())[:50]}
    if isinstance(value, list):
        return [scrub(v, depth + 1) for v in value[:50]]
    if isinstance(value, str) and len(value) > 500:
        return value[:500] + f"…（共 {len(value)} 字）"
    return value


@app.before_request
def audit_context():
    """Everything an audit entry written during this request should know about the request."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        req = {"method": request.method, "path": request.path}
    else:
        req = {"method": request.method, "path": request.path}
        if request.args:
            req["query"] = scrub(request.args.to_dict())
        if request.is_json:
            req["body"] = scrub(request.get_json(silent=True))
        elif request.form or request.files:
            req["form"] = scrub(request.form.to_dict())
            req["files"] = [{"name": f.filename, "type": f.mimetype} for f in request.files.getlist("files")][:10]
    D.AUDIT_CTX.set({"source": "web", "ip": request.remote_addr, "ua": (request.user_agent.string or "")[:300],
                     "request": req, "host": request.host})


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


def bad(code, message):
    return error(400, code, message)


def body():
    return request.get_json(silent=True) or {}


# ---------------------------------------------------------------- current user
USER_KEY_PREFIX = "mctlu_"


def request_api_key():
    auth = request.headers.get("Authorization", "")
    return (request.headers.get("X-API-Key") or (auth[7:] if auth.startswith("Bearer ") else "")).strip()


def current_user():
    """The signed-in Discord user with access info, or None. Roles come from the local member cache.

    Staff can also authenticate with a personal account API key (mctlu_…) instead of the session cookie.
    """
    if "user" in g:
        return g.user
    g.user = None
    g.via_key = None
    uid = session.get("user_id")
    if not uid:
        key = request_api_key()
        if key.startswith(USER_KEY_PREFIX):
            row = db().execute("SELECT id, user_id FROM user_keys WHERE key_hash = ?", (sha256(key),)).fetchone()
            if row:
                uid, g.via_key = row["user_id"], row["id"]
    if uid:
        m = D.member(db(), uid)
        roles = m["roles"] if m and m["in_guild"] else []
        g.user = {
            "id": uid,
            "username": (m and m["username"]) or session.get("username") or uid,
            "avatar": (m and m["avatar"]) or session.get("avatar"),
            "inGuild": bool(m and m["in_guild"]),
            **C.access_for(uid, roles),
        }
        if g.via_key:
            # A key stops working as soon as its owner loses their staff/tester roles.
            if not key_eligible(g.user):
                g.user = None
                return None
            g.user["username"] = f"{g.user['username']} (API)"
            db().execute("UPDATE user_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?",
                         (D.now_ms(), g.via_key))
            db().commit()
    return g.user


def key_eligible(user):
    return bool(user and (user["level"] >= C.LEVEL_HELPER or user["tester"]))


def permissions(user):
    lvl = user["level"] if user else 0
    return {
        "viewStaff": lvl >= C.LEVEL_HELPER,
        "managePlayers": lvl >= C.LEVEL_MODERATOR,
        "manageKeys": lvl >= C.LEVEL_ADMIN,
        "manageSettings": lvl >= C.LEVEL_ADMIN,
        "testerPanel": bool(user and (user["tester"] or lvl >= C.LEVEL_ADMIN)),
        "giveResults": bool(user and (user["tester"] or lvl >= C.LEVEL_ADMIN)),
        "manageTickets": lvl >= C.LEVEL_MODERATOR,
        "accountKeys": key_eligible(user),
        "viewAudit": lvl >= C.LEVEL_ADMIN,
    }


def same_origin():
    """Blocks cross-origin state-changing requests to cookie-authenticated endpoints."""
    if request.method in ("GET", "HEAD"):
        return True
    origin = request.headers.get("Origin")
    if origin:
        return urllib.parse.urlsplit(origin).netloc == request.host
    fetch_site = request.headers.get("Sec-Fetch-Site")
    return not fetch_site or fetch_site == "same-origin"


def route(rule, methods=("GET",), level=None, perm=None, login=True):
    """Registers a cookie-authenticated JSON endpoint with an optional access check."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            if g.via_key:
                ctx = D.AUDIT_CTX.get()
                if ctx is not None:
                    ctx.update(source="api", accountKeyId=g.via_key)
                allowed, headers = api_limiter.hit(f"ukey:{g.via_key}")
                g.extra_headers = headers
                if not allowed:
                    return error(429, "rate_limited", "Too many requests, slow down.")
            elif not same_origin():
                return error(403, "bad_origin")
            if login and not user:
                return error(401, "unauthorized")
            if level and user["level"] < level:
                return error(403, "forbidden")
            if perm and not permissions(user)[perm]:
                return error(403, "forbidden")
            return fn(*args, **kwargs)
        app.add_url_rule(rule, endpoint=f"{fn.__module__}.{fn.__name__}", view_func=wrapper, methods=list(methods))
        return wrapper
    return decorator


# ---------------------------------------------------------------- public read API
def read_rankings(mode, detailed):
    if not any(m["id"] == mode for m in C.MODES):
        return error(404, "unknown_mode")
    players = D.ranked_players(db())
    region = (request.args.get("region") or "").upper()
    if region:
        if region not in {r for r, _ in C.REGIONS}:
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
                    "players": [D.public_player(p, detailed) for p in players[offset:offset + limit]]})


def read_player(name, detailed):
    name = name.lower()
    bare = name.replace("-", "")
    for p in D.ranked_players(db()):
        if p["name"].lower() == name or (p["uuid"] and p["uuid"].replace("-", "").lower() == bare):
            return jsonify(D.public_player(p, detailed))
    return error(404, "player_not_found")


def dispatch_read(path, detailed):
    parts = [s for s in path.split("/") if s]
    if parts == ["stats"]:
        return jsonify(D.site_stats(db()))
    if parts == ["modes"]:
        return jsonify({"modes": C.MODES,
                        "tiers": [{"id": t, "points": p, "name": C.TIER_NAMES[t]} for t, p, _ in reversed(C.TIERS)],
                        "regions": [{"id": r, "name": n} for r, n in C.REGIONS]})
    if len(parts) == 2 and parts[0] == "rankings":
        return read_rankings(parts[1], detailed)
    if parts == ["players"]:
        return read_rankings("vanilla", detailed)
    if len(parts) == 2 and parts[0] == "players":
        return read_player(parts[1], detailed)
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
    db().execute("UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?", (D.now_ms(), row["id"]))
    db().commit()
    parts = [x for x in path.split("/") if x]
    if parts and parts[0] == "bans" and len(parts) <= 2:
        return read_bans(parts)
    return dispatch_read(path, detailed=True)


@app.route("/api/site/<path:path>")
def api_site(path):
    """Website's own API: same-origin only, rate limited per IP. Win/loss details need a signed-in user."""
    fetch_site = request.headers.get("Sec-Fetch-Site")
    if fetch_site and fetch_site != "same-origin":
        return error(403, "use_developer_api", "Use /api/v1 with an API key.")
    allowed, headers = site_limiter.hit(f"ip:{request.remote_addr}")
    g.extra_headers = headers
    if not allowed:
        return error(429, "rate_limited", "Too many requests, slow down.")
    return dispatch_read(path, detailed=current_user() is not None)


# ---------------------------------------------------------------- auth
def http_json(url, data=None, headers=None):
    payload = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=payload, headers={"User-Agent": "Mc.Tierlist.Asia (https://mc.tierlist.asia, 1.0)", **(headers or {})})
    if payload:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode())


def refresh_member(user):
    """Fetches the user's guild roles with the bot token and stores them in the member cache."""
    if not (C.DISCORD_BOT_TOKEN and C.GUILD_ID):
        return
    try:
        m = http_json(f"{DISCORD_API}/guilds/{C.GUILD_ID}/members/{user['id']}",
                      headers={"Authorization": f"Bot {C.DISCORD_BOT_TOKEN}"})
        D.upsert_member(db(), user["id"], m.get("nick") or user["username"], user["avatar"], m.get("roles", []))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:  # not in the guild
            D.upsert_member(db(), user["id"], user["username"], user["avatar"], [], in_guild=False, save=False)
        else:
            print(f"[auth] member lookup failed: {exc}")
    except urllib.error.URLError as exc:
        print(f"[auth] member lookup failed: {exc}")
    db().commit()


SAFE_NEXT_RE = re.compile(r"^/(?![/\\])[A-Za-z0-9\-._~/%?=&#]*$")


def safe_next(nxt):
    """Only same-site paths — rejects //host, /\\host and anything with odd characters."""
    return nxt if isinstance(nxt, str) and SAFE_NEXT_RE.match(nxt) and "\\" not in nxt else "/"


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "viaCloudflare": bool(request.environ.get("mctl.via_cloudflare"))})


@app.get("/auth/discord")
def discord_login():
    if not C.DISCORD_CLIENT_ID or not C.DISCORD_CLIENT_SECRET:
        return redirect("/?login_error=not_configured")
    state = secrets.token_hex(16)
    session["oauth_state"] = state
    session["login_next"] = safe_next(request.args.get("next", "/"))
    params = urllib.parse.urlencode({
        "client_id": C.DISCORD_CLIENT_ID,
        "redirect_uri": C.DISCORD_REDIRECT_URI,
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
        return redirect("/?login_error=invalid_state")
    try:
        token = http_json(f"{DISCORD_API}/oauth2/token", {
            "client_id": C.DISCORD_CLIENT_ID,
            "client_secret": C.DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": C.DISCORD_REDIRECT_URI,
        })
        user = http_json(f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bearer {token['access_token']}"})
    except (urllib.error.URLError, KeyError, ValueError) as exc:
        print(f"[auth] Discord login failed: {exc}")
        return redirect("/?login_error=discord_failed")
    return sign_in({"id": user["id"], "username": user.get("global_name") or user["username"], "avatar": user.get("avatar")})


if C.ALLOW_DEV_LOGIN:
    print("[auth] ALLOW_DEV_LOGIN is enabled — /auth/dev lets anyone sign in as anyone. Never enable in production.")

    @app.get("/auth/dev")
    def dev_login():
        uid = request.args.get("id", "")
        roles = [r for r in request.args.get("roles", "").split(",") if r]
        D.upsert_member(db(), uid, f"dev-{uid[-4:]}", None, roles)
        db().commit()
        session["dev"] = True
        return sign_in({"id": uid, "username": f"dev-{uid[-4:]}", "avatar": None})


def sign_in(user):
    nxt = session.pop("login_next", "/")
    if not session.pop("dev", False):
        refresh_member(user)
    session.clear()
    session.permanent = True
    session.update(user_id=user["id"], username=user["username"], avatar=user["avatar"])
    D.audit(db(), user, "login", target=("member", user["id"], user["username"]))
    db().commit()
    return redirect(nxt)


@app.post("/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- member endpoints
@route("/api/me", login=False)
def me():
    user = current_user()
    return jsonify({"user": user, "permissions": permissions(user), "serverAddress": C.SERVER_ADDRESS})


@route("/api/me/profile")
def my_profile():
    user = current_user()
    conn = db()
    player = next((p for p in D.ranked_players(conn) if p["discord_id"] == user["id"]), None)
    tests = [dict(r) for r in conn.execute(
        "SELECT id, mc_name, tester_name, prev_tier, new_tier, wins, losses, created_at FROM tests "
        "WHERE discord_id = ? ORDER BY id DESC LIMIT 50", (user["id"],)).fetchall()]
    ticket = conn.execute("SELECT channel_id, mc_name, kind, created_at FROM tickets WHERE applicant_id = ? AND status = 'open'",
                          (user["id"],)).fetchone()
    return jsonify({
        "player": D.public_player(player, detailed=True) if player else None,
        "tests": tests,
        "cooldownUntil": D.cooldown_until(conn, user["id"]),
        "openTicket": dict(ticket) if ticket else None,
        "guildId": str(C.GUILD_ID) if C.GUILD_ID else None,
        "link": L.public_link(L.link_for(conn, user["id"])),
        "linkRequired": L.required(conn),
        "serverAddress": C.SERVER_ADDRESS,
    })


@route("/api/me/link", methods=["POST"])
def link_account():
    allowed, headers = site_limiter.hit(f"link:{current_user()['id']}")
    g.extra_headers = headers
    if not allowed:
        return error(429, "rate_limited")
    conn = db()
    try:
        link = L.redeem(conn, current_user(), body().get("code"))
    except L.LinkError as exc:
        return bad(exc.code, str(exc))
    player = conn.execute("SELECT tier FROM players WHERE discord_id = ?", (current_user()["id"],)).fetchone()
    conn.commit()
    if player:
        bridge.submit(_sync_role, current_user()["id"], player["tier"])
    return jsonify({"ok": True, "link": L.public_link(link)})


@route("/api/tester/overview", perm="testerPanel")
def tester_overview():
    user = current_user()
    conn = db()
    mine = [dict(r) for r in conn.execute(
        "SELECT id, mc_name, discord_id, prev_tier, new_tier, wins, losses, created_at FROM tests "
        "WHERE tester_id = ? ORDER BY id DESC LIMIT 100", (user["id"],)).fetchall()]
    kinds = ("normal", "high") if (user["seniorTester"] or user["level"] >= C.LEVEL_ADMIN) else ("normal",)
    tickets = [dict(r) for r in conn.execute(
        f"SELECT t.channel_id, t.applicant_id, t.mc_name, t.kind, t.prev_tier, t.created_at, m.username AS applicant_name "
        f"FROM tickets t LEFT JOIN members m ON m.discord_id = t.applicant_id "
        f"WHERE t.status = 'open' AND t.kind IN ({','.join('?' * len(kinds))}) ORDER BY t.created_at", kinds).fetchall()]
    week_ago = D.now_ms() - 7 * 86400 * 1000
    return jsonify({
        "tests": mine,
        "totals": {"all": len(mine), "week": sum(1 for t in mine if t["created_at"] >= week_ago)},
        "tickets": tickets,
        "guildId": str(C.GUILD_ID) if C.GUILD_ID else None,
        "maxTier": "HT1" if user["seniorTester"] else C.TESTER_MAX_TIER,
    })


# ---------------------------------------------------------------- staff panel
@route("/api/admin/overview", perm="viewStaff")
def overview():
    conn = db()
    keys = conn.execute("SELECT COUNT(*) AS n, COALESCE(SUM(usage_count), 0) AS calls FROM api_keys WHERE revoked = 0").fetchone()
    open_tickets = conn.execute("SELECT COUNT(*) FROM tickets WHERE status = 'open'").fetchone()[0]
    recent = [dict(r) for r in conn.execute(
        "SELECT id, actor_id, actor_name, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 8").fetchall()] \
        if permissions(current_user())["viewAudit"] else []
    return jsonify({**D.site_stats(conn), "activeKeys": keys["n"], "apiCalls": keys["calls"],
                    "openTickets": open_tickets, "botOnline": bridge.running(), "recent": recent})


def validate_player(data):
    name = str(data.get("name") or "").strip()
    uuid = str(data.get("uuid") or "").strip() or None
    tier = str(data.get("tier") or "").upper()
    discord_id = str(data.get("discordId") or "").strip() or None
    if not NAME_RE.match(name):
        return None, ("invalid_name", "玩家名稱需為 2–16 個英數字或底線")
    if uuid and not UUID_RE.match(uuid):
        return None, ("invalid_uuid", "UUID 格式不正確")
    if tier not in C.TIER_POINTS:
        return None, ("invalid_tier", "請選擇 Tier")
    if discord_id and not DISCORD_ID_RE.match(discord_id):
        return None, ("invalid_discord_id", "Discord ID 格式不正確")
    return {
        "name": name, "uuid": uuid, "region": C.DEFAULT_REGION, "tier": tier, "discord_id": discord_id,
        "retired": 1 if data.get("retired") else 0,
        "wins": clamp_int(data.get("wins"), 0, 100000, 0),
        "losses": clamp_int(data.get("losses"), 0, 100000, 0),
    }, None


async def _sync_role(discord_id, tier):
    from .bot import sync_tier_role  # bot-only import
    await sync_tier_role(discord_id, tier)


@route("/api/admin/players", perm="viewStaff")
def list_players():
    conn = db()
    players = D.ranked_players(conn)
    now = D.now_ms()
    cds = {r["discord_id"]: r["until"] for r in conn.execute("SELECT * FROM cooldowns WHERE until > ?", (now,))}
    for p in players:
        p["cooldown_until"] = cds.get(p["discord_id"])
    return jsonify({"players": players})


@route("/api/admin/players", methods=["POST"], perm="managePlayers")
def create_player():
    value, err = validate_player(body())
    if err:
        return bad(*err)
    conn = db()
    if conn.execute("SELECT 1 FROM players WHERE name = ?", (value["name"],)).fetchone():
        return bad("player_exists", "此玩家已存在")
    ts = D.now_ms()
    user = current_user()
    if value["discord_id"]:
        conn.execute("UPDATE players SET discord_id = NULL WHERE discord_id = ?", (value["discord_id"],))
    conn.execute("""INSERT INTO players (name, uuid, region, tier, retired, discord_id, wins, losses, created_at, updated_at, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                 (value["name"], value["uuid"], value["region"], value["tier"], value["retired"], value["discord_id"],
                  value["wins"], value["losses"], ts, ts, user["id"]))
    pid = conn.execute("SELECT id FROM players WHERE name = ?", (value["name"],)).fetchone()["id"]
    D.audit(conn, user, "player_create", f"{value['name']} → {value['tier']}", target=("player", pid, value["name"]),
            changes=D.diff({}, value))
    conn.commit()
    if value["discord_id"]:
        bridge.submit(_sync_role, value["discord_id"], value["tier"])
    return jsonify({"ok": True}), 201


@route("/api/admin/players/<int:pid>", methods=["PUT"], perm="managePlayers")
def update_player(pid):
    conn = db()
    existing = conn.execute("SELECT * FROM players WHERE id = ?", (pid,)).fetchone()
    if not existing:
        return error(404, "not_found")
    value, err = validate_player(body())
    if err:
        return bad(*err)
    if conn.execute("SELECT 1 FROM players WHERE name = ? AND id != ?", (value["name"], pid)).fetchone():
        return bad("name_taken", "已有其他玩家使用這個名稱")
    user = current_user()
    if value["discord_id"]:
        conn.execute("UPDATE players SET discord_id = NULL WHERE discord_id = ? AND id != ?", (value["discord_id"], pid))
    conn.execute("""UPDATE players SET name = ?, uuid = ?, region = ?, tier = ?, retired = ?, discord_id = ?, wins = ?, losses = ?,
                    updated_at = ?, updated_by = ? WHERE id = ?""",
                 (value["name"], value["uuid"], value["region"], value["tier"], value["retired"], value["discord_id"],
                  value["wins"], value["losses"], D.now_ms(), user["id"], pid))
    change = f"{existing['tier']} → {value['tier']}" if existing["tier"] != value["tier"] else "details updated"
    D.audit(conn, user, "player_update", f"{value['name']}: {change}", target=("player", pid, value["name"]),
            changes=D.diff({k: existing[k] for k in value}, value))
    conn.commit()
    if value["discord_id"] and existing["tier"] != value["tier"]:
        bridge.submit(_sync_role, value["discord_id"], value["tier"])
    return jsonify({"ok": True})


@route("/api/admin/players/<int:pid>", methods=["DELETE"], perm="managePlayers")
def delete_player(pid):
    conn = db()
    existing = conn.execute("SELECT * FROM players WHERE id = ?", (pid,)).fetchone()
    if not existing:
        return error(404, "not_found")
    conn.execute("DELETE FROM players WHERE id = ?", (pid,))
    D.audit(conn, current_user(), "player_delete", existing["name"], target=("player", pid, existing["name"]),
            meta={"deleted": dict(existing)})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/players/<int:pid>/cooldown", methods=["DELETE"], perm="managePlayers")
def reset_cooldown(pid):
    conn = db()
    p = conn.execute("SELECT * FROM players WHERE id = ?", (pid,)).fetchone()
    if not p:
        return error(404, "not_found")
    if p["discord_id"]:
        conn.execute("DELETE FROM cooldowns WHERE discord_id = ?", (p["discord_id"],))
    D.audit(conn, current_user(), "cooldown_reset", p["name"], target=("player", pid, p["name"]),
            meta={"discordId": p["discord_id"]})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/tests", perm="viewStaff")
def list_tests():
    limit = clamp_int(request.args.get("limit"), 1, 500, 200)
    rows = db().execute("SELECT * FROM tests ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return jsonify({"tests": [dict(r) for r in rows]})


@route("/api/admin/keys", perm="manageKeys")
def list_keys():
    rows = db().execute("""
        SELECT k.id, k.name, k.prefix, k.scope, k.created_at, k.last_used_at, k.usage_count, k.revoked, k.created_by,
               m.username AS created_by_name
        FROM api_keys k LEFT JOIN members m ON m.discord_id = k.created_by ORDER BY k.id DESC""").fetchall()
    return jsonify({"keys": [dict(r) for r in rows]})


@route("/api/admin/keys", methods=["POST"], perm="manageKeys")
def create_key():
    name = str(body().get("name") or "").strip()
    if not name or len(name) > 48:
        return bad("invalid_key_name", "請輸入 1–48 字的名稱")
    scope = "server" if body().get("scope") == "server" else "read"
    key = f"{'mctls' if scope == 'server' else 'mctl'}_{secrets.token_urlsafe(24)}"
    conn = db()
    conn.execute("INSERT INTO api_keys (name, prefix, key_hash, created_by, created_at, scope) VALUES (?, ?, ?, ?, ?, ?)",
                 (name, key[:12], sha256(key), current_user()["id"], D.now_ms(), scope))
    kid = conn.execute("SELECT id FROM api_keys WHERE key_hash = ?", (sha256(key),)).fetchone()["id"]
    D.audit(conn, current_user(), "key_create", f"{name} ({scope})", target=("key", kid, name),
            meta={"scope": scope, "prefix": key[:12]})
    conn.commit()
    return jsonify({"key": key}), 201


@route("/api/admin/keys/<int:kid>", methods=["PATCH"], perm="manageKeys")
def toggle_key(kid):
    conn = db()
    row = conn.execute("SELECT * FROM api_keys WHERE id = ?", (kid,)).fetchone()
    if not row:
        return error(404, "not_found")
    revoked = 1 if body().get("revoked") else 0
    conn.execute("UPDATE api_keys SET revoked = ? WHERE id = ?", (revoked, kid))
    D.audit(conn, current_user(), "key_revoke" if revoked else "key_restore", row["name"], target=("key", kid, row["name"]),
            changes={"revoked": [bool(row["revoked"]), bool(revoked)]})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/keys/<int:kid>", methods=["DELETE"], perm="manageKeys")
def delete_key(kid):
    conn = db()
    row = conn.execute("SELECT * FROM api_keys WHERE id = ?", (kid,)).fetchone()
    if not row:
        return error(404, "not_found")
    conn.execute("DELETE FROM api_keys WHERE id = ?", (kid,))
    D.audit(conn, current_user(), "key_delete", row["name"], target=("key", kid, row["name"]),
            meta={"deleted": {k: row[k] for k in row.keys() if k != "key_hash"}})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/team", perm="viewStaff")
def team():
    out = []
    for r in db().execute("SELECT * FROM members WHERE in_guild = 1").fetchall():
        roles = json.loads(r["roles"])
        acc = C.access_for(r["discord_id"], roles)
        if acc["level"] >= C.LEVEL_HELPER or acc["tester"]:
            out.append({"id": r["discord_id"], "username": r["username"], "avatar": r["avatar"], **acc})
    out.sort(key=lambda m: (-m["level"], not m["seniorTester"], not m["tester"], (m["username"] or "").lower()))
    return jsonify({"members": out})


@route("/api/admin/settings", perm="manageSettings")
def settings():
    conn = db()
    return jsonify({
        "botOnline": bridge.running(),
        "botConfigured": bool(C.DISCORD_BOT_TOKEN and C.GUILD_ID),
        "guildId": str(C.GUILD_ID) if C.GUILD_ID else None,
        "resultChannel": D.get_setting(conn, "result_channel_id"),
        "applyChannel": D.get_setting(conn, "apply_channel_id"),
        "ticketCategory": D.get_setting(conn, "ticket_category_id"),
        "cooldownDays": C.TEST_COOLDOWN_DAYS,
        "discordInvite": discord_invite(conn),
        "linkRequired": L.required(conn),
        "ddns": {"enabled": ddns.enabled(), **ddns.state},
    })


# ---------------------------------------------------------------- audit log (admins)
AUDIT_TZ = "+8 hours"   # group by Taiwan calendar day / hour


def audit_filters():
    """SQL WHERE clause + args from the query string."""
    a = request.args
    where, args = [], []
    if a.get("actor"):
        where.append("actor_id IS ?" if a["actor"] != "system" else "actor_id IS NULL")
        if a["actor"] != "system":
            args.append(a["actor"])
    actions = [x for x in (a.get("action") or "").split(",") if re.fullmatch(r"[a-z_]{2,40}", x)]
    if actions:
        where.append(f"action IN ({','.join('?' * len(actions))})")
        args += actions
    if a.get("source"):
        where.append("source IS ?" if a["source"] != "legacy" else "source IS NULL")
        if a["source"] != "legacy":
            args.append(a["source"])
    if a.get("target_type"):
        where.append("target_type = ?")
        args.append(a["target_type"])
    if a.get("target_id"):
        where.append("target_id = ?")
        args.append(a["target_id"])
    if a.get("ip"):
        where.append("ip = ?")
        args.append(a["ip"])
    if a.get("q"):
        like = f"%{a['q'][:100]}%"
        where.append("(detail LIKE ? OR actor_name LIKE ? OR target_name LIKE ? OR action LIKE ? OR ip LIKE ? OR meta LIKE ? OR changes LIKE ?)")
        args += [like] * 7
    for key, op in (("from", ">="), ("to", "<")):
        if a.get(key):
            where.append(f"created_at {op} ?")
            args.append(clamp_int(a[key], 0, 10**14, 0))
    return (" WHERE " + " AND ".join(where)) if where else "", args


def audit_row(r):
    e = dict(r)
    for k in ("changes", "meta"):
        try:
            e[k] = json.loads(e[k]) if e.get(k) else None
        except ValueError:
            pass
    return e


@route("/api/admin/audit", perm="viewAudit")
def audit_list():
    limit = clamp_int(request.args.get("limit"), 1, 200, 50)
    where, args = audit_filters()
    before = clamp_int(request.args.get("before"), 0, 10**12, 0)
    if before:
        where += (" AND " if where else " WHERE ") + "id < ?"
        args.append(before)
    rows = db().execute(f"""SELECT a.*, m.avatar AS actor_avatar FROM audit_log a
                            LEFT JOIN members m ON m.discord_id = a.actor_id {where}
                            ORDER BY a.id DESC LIMIT ?""", (*args, limit + 1)).fetchall()
    entries = [audit_row(r) for r in rows[:limit]]
    return jsonify({"entries": entries, "hasMore": len(rows) > limit,
                    "nextBefore": entries[-1]["id"] if entries else None})


@route("/api/admin/audit/facets", perm="viewAudit")
def audit_facets():
    conn = db()
    actors = conn.execute("""SELECT a.actor_id AS id, MAX(a.actor_name) AS name, m.avatar, COUNT(*) AS count,
                             MAX(a.created_at) AS last FROM audit_log a LEFT JOIN members m ON m.discord_id = a.actor_id
                             GROUP BY a.actor_id ORDER BY count DESC LIMIT 300""").fetchall()
    actions = conn.execute("SELECT action, COUNT(*) AS count FROM audit_log GROUP BY action ORDER BY count DESC").fetchall()
    sources = conn.execute("SELECT COALESCE(source, 'legacy') AS source, COUNT(*) AS count FROM audit_log GROUP BY 1").fetchall()
    return jsonify({"actors": [dict(r) for r in actors], "actions": [dict(r) for r in actions],
                    "sources": [dict(r) for r in sources],
                    "total": conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]})


@route("/api/admin/audit/stats", perm="viewAudit")
def audit_stats():
    conn = db()
    days = clamp_int(request.args.get("days"), 1, 365, 30)
    where, args = audit_filters()
    since = D.now_ms() - days * 86400 * 1000
    where += (" AND " if where else " WHERE ") + "created_at >= ?"
    args.append(since)
    day_expr = f"date(created_at / 1000, 'unixepoch', '{AUDIT_TZ}')"
    hour_expr = f"CAST(strftime('%H', created_at / 1000, 'unixepoch', '{AUDIT_TZ}') AS INTEGER)"
    q = lambda sql: [dict(r) for r in conn.execute(sql.format(w=where), args).fetchall()]
    by_hour = {r["hour"]: r["count"] for r in q(f"SELECT {hour_expr} AS hour, COUNT(*) AS count FROM audit_log{{w}} GROUP BY 1")}
    return jsonify({
        "days": days,
        "total": q("SELECT COUNT(*) AS n FROM audit_log{w}")[0]["n"],
        "daily": q(f"SELECT {day_expr} AS day, COUNT(*) AS count FROM audit_log{{w}} GROUP BY 1 ORDER BY 1"),
        "byHour": [by_hour.get(h, 0) for h in range(24)],
        "byAction": q("SELECT action, COUNT(*) AS count FROM audit_log{w} GROUP BY 1 ORDER BY 2 DESC LIMIT 12"),
        "byActor": q("SELECT actor_id AS id, MAX(actor_name) AS name, COUNT(*) AS count FROM audit_log{w} "
                     "GROUP BY actor_id ORDER BY 3 DESC LIMIT 10"),
        "bySource": q("SELECT COALESCE(source, 'legacy') AS source, COUNT(*) AS count FROM audit_log{w} GROUP BY 1 ORDER BY 2 DESC"),
        "activeActors": q("SELECT COUNT(DISTINCT actor_id) AS n FROM audit_log{w}")[0]["n"],
    })


@route("/api/admin/audit/actor/<actor_id>", perm="viewAudit")
def audit_actor(actor_id):
    conn = db()
    uid = None if actor_id == "system" else actor_id
    cond, args = ("actor_id IS NULL", []) if uid is None else ("actor_id = ?", [uid])
    head = conn.execute(f"SELECT COUNT(*) AS total, MIN(created_at) AS first, MAX(created_at) AS last, MAX(actor_name) AS name "
                        f"FROM audit_log WHERE {cond}", args).fetchone()
    if not head["total"]:
        return error(404, "not_found")
    m = D.member(conn, uid) if uid else None
    acc = C.access_for(uid, m["roles"] if m and m["in_guild"] else []) if uid else None
    ips = conn.execute(f"""SELECT ip, COUNT(*) AS count, MIN(created_at) AS first, MAX(created_at) AS last,
                           MAX(user_agent) AS ua FROM audit_log WHERE {cond} AND ip IS NOT NULL
                           GROUP BY ip ORDER BY last DESC LIMIT 50""", args).fetchall()
    agents = conn.execute(f"""SELECT user_agent AS ua, COUNT(*) AS count, MAX(created_at) AS last FROM audit_log
                              WHERE {cond} AND user_agent IS NOT NULL AND user_agent != ''
                              GROUP BY user_agent ORDER BY last DESC LIMIT 20""", args).fetchall()
    targets = conn.execute(f"""SELECT target_type AS type, target_id AS id, MAX(target_name) AS name, COUNT(*) AS count
                               FROM audit_log WHERE {cond} AND target_type IS NOT NULL
                               GROUP BY target_type, target_id ORDER BY count DESC LIMIT 15""", args).fetchall()
    on_them = conn.execute("SELECT COUNT(*) FROM audit_log WHERE target_type = 'member' AND target_id = ?",
                           (uid or "",)).fetchone()[0]
    return jsonify({
        "id": actor_id, "name": (m and m["username"]) or head["name"], "avatar": m and m["avatar"],
        "inGuild": bool(m and m["in_guild"]), "access": acc,
        "total": head["total"], "first": head["first"], "last": head["last"], "actedOn": on_them,
        "ips": [dict(r) for r in ips], "agents": [dict(r) for r in agents], "targets": [dict(r) for r in targets],
    })


@route("/api/admin/audit/<int:eid>", perm="viewAudit")
def audit_entry(eid):
    conn = db()
    row = conn.execute("""SELECT a.*, m.avatar AS actor_avatar FROM audit_log a
                          LEFT JOIN members m ON m.discord_id = a.actor_id WHERE a.id = ?""", (eid,)).fetchone()
    if not row:
        return error(404, "not_found")
    e = audit_row(row)
    related = []
    if e["target_type"]:
        related = [audit_row(r) for r in conn.execute(
            "SELECT id, actor_id, actor_name, action, detail, created_at, source FROM audit_log "
            "WHERE target_type = ? AND target_id = ? AND id != ? ORDER BY id DESC LIMIT 15",
            (e["target_type"], e["target_id"], eid)).fetchall()]
    return jsonify({"entry": e, "related": related})




# ---------------------------------------------------------------- official Minecraft server
def server_key_ok():
    key = request_api_key()
    row = db().execute("SELECT id FROM api_keys WHERE key_hash = ? AND scope = 'server' AND revoked = 0",
                       (sha256(key),)).fetchone() if key else None
    if row:
        db().execute("UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?", (D.now_ms(), row["id"]))
    return row


def taipei_time(ms):
    return time.strftime("%Y/%m/%d %H:%M", time.gmtime(ms / 1000 + 8 * 3600))


BAN_KICK = "§c§l你已被封禁\n\n§7原因：§f{reason}\n§7期限：§f{until}\n\n§8申訴請至 {host}/support"
LINK_KICK = ("§6§lMc.Tierlist.Asia\n\n§f進入伺服器前，請先綁定你的 Discord 帳號\n\n§7你的驗證碼\n§e§l{code}\n\n"
             "§7到 §f{host}/me §7輸入驗證碼\n§7或在 Discord 使用 §f/verify {code}\n\n§8驗證碼 10 分鐘內有效")
LINK_CHAT = "§6[Tierlist] §f你尚未綁定 Discord，驗證碼 §e§l{code}§r§f：到 §e{host}/me §f或在 Discord 使用 §e/verify {code}"


@app.post("/api/server/join")
def server_join():
    """Called by the Paper plugin before a player joins: ban check, link code, name sync."""
    err = server_request()
    if err:
        return err
    data = body()
    uuid, name = L.norm_uuid(str(data.get("uuid") or "")), str(data.get("name") or "")
    if not re.fullmatch(r"[0-9a-f]{32}", uuid) or not re.fullmatch(r"[A-Za-z0-9_]{1,16}", name):
        return bad("invalid_player", "uuid / name missing")
    host = urllib.parse.urlsplit(C.BASE_URL).netloc
    conn = db()
    L.sync_name(conn, uuid, name)
    link = L.link_by_uuid(conn, uuid)
    ban = D.find_active_ban(conn, name=name, uuid=uuid, discord_id=link and link["discord_id"])
    if ban:
        conn.commit()
        until = taipei_time(ban["expires_at"]) + "（台灣時間）" if ban["expires_at"] else "永久"
        return jsonify({"allow": False, "reason": "banned",
                        "kickMessage": BAN_KICK.format(reason=ban["reason"], until=until, host=host)})
    if link:
        conn.commit()
        m = D.member(conn, link["discord_id"])
        return jsonify({"allow": True, "linked": True,
                        "discord": {"id": link["discord_id"], "name": m and m["username"]}})
    code, expires = L.issue_code(conn, uuid, name)
    conn.commit()
    return jsonify({"allow": False, "reason": "unlinked", "linked": False, "code": code, "expiresAt": expires,
                    "kickMessage": LINK_KICK.format(code=code, host=host),
                    "chatMessage": LINK_CHAT.format(code=code, host=host)})


def server_request():
    """Common checks for plugin → website calls. Returns an error response or None."""
    allowed, headers = server_limiter.hit(f"ip:{request.remote_addr}")
    g.extra_headers = headers
    if not allowed:
        return error(429, "rate_limited")
    key = server_key_ok()
    if not key:
        return error(401, "invalid_server_key")
    D.AUDIT_CTX.get().update(source="server", serverKeyId=key["id"])
    return None


def save_worlds(conn, data):
    """World display names the plugin read from CorePlus (world → {id, display})."""
    raw = data.get("worlds")
    if not isinstance(raw, dict):
        return
    clean = {}
    for world, info in list(raw.items())[:50]:
        if GS.WORLD_RE.match(str(world)) and isinstance(info, dict):
            clean[str(world)] = {"id": re.sub(r"[^a-z0-9_-]", "", str(info.get("id") or "").lower())[:32],
                                 "display": str(info.get("display") or world)[:40]}
    if clean:
        D.set_setting(conn, "gs_worlds", json.dumps(clean, ensure_ascii=False))


@app.post("/api/server/events")
def server_events():
    err = server_request()
    if err:
        return err
    events = body().get("events")
    if not isinstance(events, list):
        return bad("invalid_events", "events must be a list")
    conn = db()
    ok = sum(1 for ev in events[:1000] if isinstance(ev, dict) and GS.handle(conn, ev))
    GS.sweep(conn)
    conn.commit()
    return jsonify({"ok": True, "accepted": ok})


@app.post("/api/server/presence")
def server_presence():
    err = server_request()
    if err:
        return err
    data = body()
    players = data.get("players") if isinstance(data.get("players"), list) else []
    conn = db()
    save_worlds(conn, data)
    n = GS.presence(conn, [p for p in players if isinstance(p, dict)], D.now_ms())
    GS.sweep(conn)
    conn.commit()
    return jsonify({"ok": True, "online": n})


@app.post("/api/server/coreplus")
def server_coreplus():
    err = server_request()
    if err:
        return err
    players = body().get("players")
    if not isinstance(players, list):
        return bad("invalid_players", "players must be a list")
    conn = db()
    n = GS.save_coreplus(conn, [p for p in players if isinstance(p, dict)], D.now_ms())
    conn.commit()
    return jsonify({"ok": True, "saved": n})


# ---------------------------------------------------------------- player profile (website)
def profile_limit():
    allowed, headers = site_limiter.hit(f"ip:{request.remote_addr}")
    g.extra_headers = headers
    return None if allowed else error(429, "rate_limited")


def resolve_profile(ident):
    """(uuid, name) for a player page, from local data or Mojang. None if the account doesn't exist."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", ident):
        return None
    conn = db()
    uuid = GS.find_uuid(conn, ident)
    if not uuid:
        from . import heads
        try:
            uuid = heads.resolve_uuid(ident)
        except Exception:
            uuid = None
    if not uuid:
        return None
    row = (conn.execute("SELECT name FROM gs_players WHERE uuid = ?", (uuid,)).fetchone()
           or conn.execute("SELECT mc_name AS name FROM mc_links WHERE uuid = ?", (uuid,)).fetchone()
           or conn.execute("SELECT name FROM players WHERE REPLACE(LOWER(uuid), '-', '') = ?", (uuid,)).fetchone())
    return uuid, (row["name"] if row else ident)


@app.get("/api/profile/<ident>")
def profile_general(ident):
    err = profile_limit()
    if err:
        return err
    found = resolve_profile(ident)
    if not found:
        return error(404, "player_not_found")
    uuid, name = found
    conn = db()
    user = current_user()
    player = next((p for p in D.ranked_players(conn) if L.norm_uuid(p["uuid"]) == uuid), None) \
        or next((p for p in D.ranked_players(conn) if p["name"].lower() == name.lower() and not p["uuid"]), None)
    link = L.link_by_uuid(conn, uuid)
    is_me = bool(user and ((link and link["discord_id"] == user["id"]) or (player and player["discord_id"] == user["id"])))
    out = {
        "uuid": L.dashed(uuid), "name": name, "isMe": is_me, "loggedIn": bool(user),
        "player": D.public_player(player, detailed=bool(user)) if player else None,
        "names": GS.names(conn, uuid) or [{"name": name, "first_seen": None, "last_seen": None}],
        "known": bool(conn.execute("SELECT 1 FROM gs_players WHERE uuid = ?", (uuid,)).fetchone()),
        "worlds": GS.worlds(conn),
    }
    if user:
        out["presence"] = GS.presence_of(conn, uuid)
        did = (link and link["discord_id"]) or (player and player["discord_id"])
        cond, args = ("(discord_id = ? OR player_id = ?)", [did, player["id"]]) if did and player else \
            ("discord_id = ?", [did]) if did else ("player_id = ?", [player["id"]]) if player else ("0", [])
        out["tests"] = [dict(r) for r in conn.execute(
            f"SELECT id, mc_name, tester_name, prev_tier, new_tier, wins, losses, created_at FROM tests WHERE {cond} "
            "ORDER BY id DESC LIMIT 10", args).fetchall()]
    if is_me:
        ticket = conn.execute("SELECT channel_id, mc_name, kind, created_at FROM tickets WHERE applicant_id = ? AND status = 'open'",
                              (user["id"],)).fetchone()
        out["self"] = {"cooldownUntil": D.cooldown_until(conn, user["id"]), "openTicket": dict(ticket) if ticket else None,
                       "guildId": str(C.GUILD_ID) if C.GUILD_ID else None}
    return jsonify(out)


@route("/api/profile/<ident>/stats")
def profile_stats(ident):
    err = profile_limit()
    if err:
        return err
    found = resolve_profile(ident)
    if not found:
        return error(404, "player_not_found")
    conn = db()
    return jsonify({"stats": GS.stats(conn, found[0]), "worlds": GS.worlds(conn)})


@route("/api/profile/<ident>/matches")
def profile_matches(ident):
    err = profile_limit()
    if err:
        return err
    found = resolve_profile(ident)
    if not found:
        return error(404, "player_not_found")
    conn = db()
    items, more = GS.matches(conn, found[0], clamp_int(request.args.get("before"), 0, 10**12, 0) or None,
                             clamp_int(request.args.get("limit"), 1, 50, 30))
    return jsonify({"matches": items, "hasMore": more, "worlds": GS.worlds(conn)})


@route("/api/profile/<ident>/log")
def profile_log(ident):
    err = profile_limit()
    if err:
        return err
    found = resolve_profile(ident)
    if not found:
        return error(404, "player_not_found")
    a = request.args
    day = lambda v: int(datetime.fromisoformat(f"{v}T00:00:00+08:00").timestamp() * 1000) \
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v or "") else None
    end = day(a.get("to"))
    items, more, summary = GS.kill_log(
        db(), found[0], kind=a.get("type", "all"), cause=a.get("cause", ""), world=(a.get("world") or "")[:64],
        opp=(a.get("opp") or "")[:16], start=day(a.get("from")), end=end and end + 86400 * 1000,
        before=clamp_int(a.get("before"), 0, 10**12, 0) or None, limit=clamp_int(a.get("limit"), 1, 50, 30))
    return jsonify({"items": items, "hasMore": more, "summary": summary})


@route("/api/profile/<ident>/worlds")
def profile_worlds(ident):
    err = profile_limit()
    if err:
        return err
    found = resolve_profile(ident)
    if not found:
        return error(404, "player_not_found")
    return jsonify({"worlds": GS.world_stats(db(), found[0]), "names": GS.worlds(db())})


@route("/api/profile/<ident>/rivals")
def profile_rivals(ident):
    err = profile_limit()
    if err:
        return err
    found = resolve_profile(ident)
    if not found:
        return error(404, "player_not_found")
    return jsonify({"rivals": GS.rivals(db(), found[0], (request.args.get("q") or "")[:16])})


@route("/api/profile/match/<int:mid>")
def profile_match(mid):
    return jsonify({"kills": GS.match_kills(db(), mid)})


@route("/api/admin/links", perm="viewStaff")
def list_links():
    q = (request.args.get("q") or "").strip()
    like = f"%{q}%"
    rows = db().execute("""
        SELECT l.*, m.username, m.avatar FROM mc_links l LEFT JOIN members m ON m.discord_id = l.discord_id
        WHERE ? = '' OR l.mc_name LIKE ? OR l.discord_id LIKE ? OR m.username LIKE ? OR l.uuid LIKE ?
        ORDER BY l.linked_at DESC LIMIT 300""", (q, like, like, like, like.replace("-", ""))).fetchall()
    total = db().execute("SELECT COUNT(*) FROM mc_links").fetchone()[0]
    return jsonify({"total": total, "links": [{**dict(r), "uuid": L.dashed(r["uuid"])} for r in rows]})


@route("/api/admin/links/<did>", methods=["DELETE"], perm="managePlayers")
def delete_link(did):
    conn = db()
    if not L.unlink(conn, current_user(), did):
        return error(404, "not_found")
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/link-required", methods=["PUT"], perm="manageSettings")
def set_link_required():
    on = bool(body().get("on"))
    conn = db()
    before = L.required(conn)
    D.set_setting(conn, "link_required", "1" if on else "0")
    D.audit(conn, current_user(), "link_required", "on" if on else "off", target=("setting", "link_required", "申請考試必須先綁定"),
            changes={"linkRequired": [before, on]})
    conn.commit()
    return jsonify({"ok": True, "linkRequired": on})


# ---------------------------------------------------------------- pages & static files
def gated(key):
    """The countdown/maintenance page when `key` is closed to the public; staff pass through in preview."""
    gate = S.gate(S.load(db()), key)
    if not gate or permissions(current_user())["viewStaff"]:
        return None
    payload = json.dumps({**gate, "now": D.now_ms(), "page": key}, ensure_ascii=False).replace("<", "\\u003c")
    html = (C.PUBLIC / "gate.html").read_text(encoding="utf-8").replace("<!--GATE-->", f"<script>window.GATE={payload}</script>")
    resp = app.response_class(html, status=503, mimetype="text/html")
    resp.headers["Cache-Control"] = "no-store"
    if gate["until"]:
        resp.headers["Retry-After"] = str(max(1, (gate["until"] - D.now_ms()) // 1000))
    return resp


def page(name, status=200):
    key = "home" if name == "index.html" else name.removesuffix(".html")
    if status == 200 and key in S.PAGES:
        blocked = gated(key)
        if blocked:
            return blocked
    resp = send_from_directory(C.PUBLIC, name, max_age=0)
    resp.status_code = status
    resp.headers["Cache-Control"] = "private, no-cache"
    return resp


@app.get("/api/status")
def site_status():
    """Public: announcements plus whether a page is closed (launch countdown / maintenance)."""
    state = S.load(db())
    key = request.args.get("page", "")
    gate = S.gate(state, key) if key in S.PAGES else None
    anns = [{k: a[k] for k in ("id", "rev", "text", "style", "dismissible", "link", "linkText")}
            for a in S.active_announcements(state)]
    resp = jsonify({"now": D.now_ms(), "launchAt": state["launchAt"], "gate": gate,
                    "preview": bool(gate and permissions(current_user())["viewStaff"]), "announcements": anns})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@route("/api/admin/site", perm="manageSettings")
def get_site_state():
    return jsonify({"state": S.load(db()), "pages": S.PAGES, "now": D.now_ms()})


@route("/api/admin/site", methods=["PUT"], perm="manageSettings")
def put_site_state():
    try:
        state = S.validate(body())
    except ValueError as exc:
        return bad(str(exc), "設定內容不正確")
    conn = db()
    before = S.load(conn)
    S.save(conn, state)
    closed = [p for p, m in state["maintenance"]["pages"].items() if m["on"]]
    D.audit(conn, current_user(), "site_update",
            f"launch={state['launchAt'] or '-'} all={'on' if state['maintenance']['all']['on'] else 'off'} "
            f"pages={','.join(closed) or '-'} announcements={len(state['announcements'])}",
            target=("setting", "site_state", "網站狀態"), changes=D.diff(D.flatten(before), D.flatten(state)))
    conn.commit()
    return jsonify({"ok": True, "state": state})


@app.get("/")
def home():
    return page("index.html")


@app.get("/player/<path:_name>")
def player_page(_name):
    return page("player.html")


INVITE_RE = re.compile(r"^https://(discord\.gg|discord\.com/invite)/[A-Za-z0-9-]{2,32}$")


def discord_invite(conn):
    return D.get_setting(conn, "discord_invite") or C.DEFAULT_DISCORD_INVITE


@app.get("/discord")
def discord_redirect():
    """Short link tierlist.asia/discord → the current Discord invite (editable in Settings)."""
    resp = redirect(discord_invite(db()), code=302)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@route("/api/admin/discord-invite", methods=["PUT"], perm="manageSettings")
def set_discord_invite():
    url = str(body().get("url") or "").strip()
    if not INVITE_RE.match(url):
        return bad("invalid_invite", "邀請連結格式不正確（例如 https://discord.gg/xxxx）")
    conn = db()
    before = discord_invite(conn)
    D.set_setting(conn, "discord_invite", url)
    D.audit(conn, current_user(), "discord_invite_update", url, target=("setting", "discord_invite", "Discord 邀請連結"),
            changes={"url": [before, url]})
    conn.commit()
    return jsonify({"ok": True})


@app.get("/heads/<kind>/<ident>/<int:size>.png")
def head_image(kind, ident, size):
    """Player head/body rendered from the official Mojang skin (cached on disk and by Cloudflare)."""
    from . import heads
    if kind not in ("avatar", "body") or not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", ident):
        abort(404)
    try:
        data = heads.render(kind, ident, size)
    except Exception as exc:  # Mojang unreachable and nothing cached
        print(f"[heads] {kind}/{ident}: {exc}")
        return redirect(f"https://mc-heads.net/{kind}/{ident}/{size}")
    resp = app.response_class(data, mimetype="image/png")
    resp.headers["Cache-Control"] = "public, max-age=21600"
    return resp


@app.get("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(C.PUBLIC / "assets", filename, max_age=3600)


MANAGE_BLOCK_RE = re.compile(r"<!--MANAGE-->.*?<!--/MANAGE-->", re.S)


@app.get("/docs")
def docs_page():
    """The Management API section is only sent to staff and testers who can hold account keys."""
    blocked = gated("docs")
    if blocked:
        return blocked
    html = (C.PUBLIC / "docs.html").read_text(encoding="utf-8")
    if not key_eligible(current_user()):
        html = MANAGE_BLOCK_RE.sub("", html)
    resp = app.response_class(html, mimetype="text/html")
    resp.headers["Cache-Control"] = "private, no-cache"
    resp.headers["Vary"] = "Cookie"
    return resp


@app.get("/<name>")
def named_page(name):
    if re.fullmatch(r"[a-z0-9-]+", name) and name != "404" and (C.PUBLIC / f"{name}.html").is_file():
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


# ================================================================ bans
DURATIONS = {"1d": 1, "7d": 7, "30d": 30}


def ban_row(b):
    now = D.now_ms()
    status = ("revoked" if b["revoked_at"] else
              "expired" if b["expires_at"] and b["expires_at"] <= now else "active")
    return {**b, "status": status}


@route("/api/admin/bans", perm="viewStaff")
def list_bans():
    rows = db().execute("SELECT * FROM bans ORDER BY id DESC LIMIT 500").fetchall()
    return jsonify({"bans": [ban_row(dict(r)) for r in rows]})


@route("/api/admin/bans", methods=["POST"], perm="managePlayers")
def create_ban():
    data = body()
    name = str(data.get("name") or "").strip()
    reason = str(data.get("reason") or "").strip()
    discord_id = str(data.get("discordId") or "").strip() or None
    if not NAME_RE.match(name):
        return bad("invalid_name", "玩家名稱需為 2–16 個英數字或底線")
    if not reason or len(reason) > 300:
        return bad("invalid_reason", "請輸入 1–300 字的封禁原因")
    if discord_id and not DISCORD_ID_RE.match(discord_id):
        return bad("invalid_discord_id", "Discord ID 格式不正確")
    duration = str(data.get("duration") or "perm")
    if duration == "perm":
        expires = None
    elif duration in DURATIONS:
        expires = D.now_ms() + DURATIONS[duration] * 86400 * 1000
    else:
        days = clamp_int(data.get("days"), 1, 3650, 0)
        if not days:
            return bad("invalid_duration", "請輸入 1–3650 天")
        expires = D.now_ms() + days * 86400 * 1000
    conn = db()
    player = conn.execute("SELECT * FROM players WHERE name = ?", (name,)).fetchone()
    uuid = player["uuid"] if player else None
    discord_id = discord_id or (player["discord_id"] if player else None)
    if player:
        name = player["name"]
    user = current_user()
    cur = conn.execute("""INSERT INTO bans (mc_name, uuid, discord_id, reason, created_by, created_by_name, created_at, expires_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                       (name, uuid, discord_id, reason, user["id"], user["username"], D.now_ms(), expires))
    D.audit(conn, user, "ban_create", f"{name} ({'permanent' if not expires else duration}) — {reason}",
            target=("ban", cur.lastrowid, name),
            meta={"ban": {"mcName": name, "uuid": uuid, "discordId": discord_id, "reason": reason, "duration": duration,
                          "expiresAt": expires, "playerId": player["id"] if player else None}})
    conn.commit()
    return jsonify({"ok": True}), 201


@route("/api/admin/bans/<int:bid>/revoke", methods=["POST"], perm="managePlayers")
def revoke_ban(bid):
    conn = db()
    b = conn.execute("SELECT * FROM bans WHERE id = ?", (bid,)).fetchone()
    if not b:
        return error(404, "not_found")
    user = current_user()
    conn.execute("UPDATE bans SET revoked_at = ?, revoked_by_name = ? WHERE id = ? AND revoked_at IS NULL",
                 (D.now_ms(), user["username"], bid))
    D.audit(conn, user, "ban_revoke", b["mc_name"], target=("ban", bid, b["mc_name"]),
            changes={"status": ["active", "revoked"]}, meta={"ban": dict(b)})
    conn.commit()
    return jsonify({"ok": True})


def public_ban(b):
    return {"name": b["mc_name"], "uuid": b["uuid"], "reason": b["reason"],
            "bannedAt": D.iso(b["created_at"]), "expiresAt": D.iso(b["expires_at"]) if b["expires_at"] else None}


def read_bans(parts):
    """Developer API: /bans lists active bans, /bans/{name|uuid} checks one player."""
    if len(parts) == 1:
        return jsonify({"bans": [public_ban(b) for b in D.active_bans(db())]})
    q = parts[1]
    is_uuid = bool(UUID_RE.match(q))
    b = D.find_active_ban(db(), name=None if is_uuid else q, uuid=q if is_uuid else None)
    return jsonify({"banned": bool(b), "ban": public_ban(b) if b else None})


# ================================================================ support tickets
IMAGE_TYPES = [(b"\x89PNG\r\n\x1a\n", "image/png", "png"), (b"\xff\xd8\xff", "image/jpeg", "jpg"),
               (b"GIF87a", "image/gif", "gif"), (b"GIF89a", "image/gif", "gif")]


def sniff_image(head):
    for magic, mime, ext in IMAGE_TYPES:
        if head.startswith(magic):
            return mime, ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def storage_used():
    total = 0
    for path in C.DATA_DIR.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
    return total


def read_uploads():
    """Validates uploaded images. Returns (list of (bytes, mime, ext, name), error tuple)."""
    files = [f for f in request.files.getlist("files") if f and f.filename]
    if len(files) > C.UPLOAD_MAX_FILES:
        return None, ("too_many_files", f"每則訊息最多 {C.UPLOAD_MAX_FILES} 張圖片")
    out = []
    for f in files:
        data = f.read(C.UPLOAD_MAX_BYTES + 1)
        if len(data) > C.UPLOAD_MAX_BYTES:
            return None, ("file_too_large", "每張圖片最多 5MB")
        kind = sniff_image(data[:16])
        if not kind:
            return None, ("invalid_file", "只能上傳 PNG、JPG、GIF 或 WEBP 圖片")
        out.append((data, kind[0], kind[1], (f.filename or "")[:100]))
    if out and storage_used() + sum(len(d) for d, *_ in out) > C.STORAGE_LIMIT_BYTES:
        return None, ("storage_full", "伺服器儲存空間不足，暫時無法上傳圖片")
    return out, None


def save_message(conn, ticket_id, user, is_staff, text, uploads):
    ts = D.now_ms()
    cur = conn.execute("INSERT INTO support_messages (ticket_id, author_id, author_name, is_staff, body, created_at) "
                       "VALUES (?, ?, ?, ?, ?, ?)", (ticket_id, user["id"], user["username"], 1 if is_staff else 0, text, ts))
    C.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    for data, mime, ext, orig in uploads:
        stored = f"{secrets.token_hex(16)}.{ext}"
        (C.UPLOAD_DIR / stored).write_bytes(data)
        conn.execute("INSERT INTO support_attachments (ticket_id, message_id, stored_name, orig_name, mime, size, created_at) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)", (ticket_id, cur.lastrowid, stored, orig, mime, len(data), ts))
    conn.execute("UPDATE support_tickets SET updated_at = ? WHERE id = ?", (ts, ticket_id))


def delete_attachment_files(rows):
    for r in rows:
        try:
            (C.UPLOAD_DIR / r["stored_name"]).unlink(missing_ok=True)
        except OSError as exc:
            print(f"[support] could not delete {r['stored_name']}: {exc}")


def is_support_staff(user):
    return bool(user and user["level"] >= C.LEVEL_HELPER)


def load_ticket(tid):
    """Ticket the current user may see (owner or staff), or None."""
    user = current_user()
    t = db().execute("SELECT * FROM support_tickets WHERE id = ?", (tid,)).fetchone()
    if not t or (t["user_id"] != user["id"] and not is_support_staff(user)):
        return None
    return dict(t)


def ticket_payload(t):
    conn = db()
    msgs = [dict(r) for r in conn.execute("""SELECT sm.*, m.avatar AS author_avatar FROM support_messages sm
                                              LEFT JOIN members m ON m.discord_id = sm.author_id
                                              WHERE sm.ticket_id = ? ORDER BY sm.id""", (t["id"],))]
    atts = {}
    for a in conn.execute("SELECT id, message_id, orig_name, mime, size FROM support_attachments WHERE ticket_id = ?", (t["id"],)):
        atts.setdefault(a["message_id"], []).append(dict(a))
    for m in msgs:
        m["attachments"] = atts.get(m["id"], [])
    return {"ticket": t, "messages": msgs}


def text_field(name, max_len):
    return str(request.form.get(name) or "").strip()[:max_len + 1]


def site_url(path):
    return f"{C.BASE_URL}{path}"


async def _notify(kind, *args):
    from . import bot
    await getattr(bot, kind)(*args)


@route("/api/support/tickets")
def my_tickets():
    user = current_user()
    conn = db()
    rows = conn.execute("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC", (user["id"],)).fetchall()
    blocked = conn.execute("SELECT reason FROM support_blocks WHERE discord_id = ?", (user["id"],)).fetchone()
    return jsonify({"tickets": [dict(r) for r in rows], "blocked": bool(blocked),
                    "blockReason": blocked["reason"] if blocked else None,
                    "categories": list(C.SUPPORT_CATEGORIES), "maxFiles": C.UPLOAD_MAX_FILES})


@route("/api/support/tickets", methods=["POST"])
def open_ticket():
    user = current_user()
    conn = db()
    if conn.execute("SELECT 1 FROM support_blocks WHERE discord_id = ?", (user["id"],)).fetchone():
        return error(403, "support_blocked", "你已被禁止開立客服單")
    open_count = conn.execute("SELECT COUNT(*) FROM support_tickets WHERE user_id = ? AND status != 'closed'",
                              (user["id"],)).fetchone()[0]
    if open_count >= C.SUPPORT_MAX_OPEN:
        return bad("too_many_open", f"最多同時開 {C.SUPPORT_MAX_OPEN} 張客服單")
    category = request.form.get("category", "")
    title, text = text_field("title", 100), text_field("body", 4000)
    if category not in C.SUPPORT_CATEGORIES:
        return bad("invalid_category", "請選擇分類")
    if not title or len(title) > 100:
        return bad("invalid_title", "標題需為 1–100 字")
    if not text or len(text) > 4000:
        return bad("invalid_body", "內容需為 1–4000 字")
    uploads, err = read_uploads()
    if err:
        return bad(*err)
    ts = D.now_ms()
    cur = conn.execute("INSERT INTO support_tickets (user_id, username, category, title, status, created_at, updated_at) "
                       "VALUES (?, ?, ?, ?, 'open', ?, ?)", (user["id"], user["username"], category, title, ts, ts))
    tid = cur.lastrowid
    save_message(conn, tid, user, False, text, uploads)
    D.audit(conn, user, "support_open", f"#{tid} {title}", target=("support", tid, title),
            meta={"category": category, "images": len(uploads), "length": len(text)})
    conn.commit()
    bridge.submit(_notify, "notify_support_new", tid, user["id"], category, title, text[:300], site_url(f"/admin#support/{tid}"))
    return jsonify({"ok": True, "id": tid}), 201


@route("/api/support/tickets/<int:tid>")
def get_ticket(tid):
    t = load_ticket(tid)
    if not t:
        return error(404, "not_found")
    return jsonify(ticket_payload(t))


@route("/api/support/tickets/<int:tid>/messages", methods=["POST"])
def reply_ticket(tid):
    t = load_ticket(tid)
    if not t:
        return error(404, "not_found")
    user = current_user()
    staff = is_support_staff(user) and user["id"] != t["user_id"]
    if t["status"] == "closed" and not staff:
        return bad("ticket_closed", "此客服單已關閉")
    text = text_field("body", 4000)
    if not text or len(text) > 4000:
        return bad("invalid_body", "內容需為 1–4000 字")
    uploads, err = read_uploads()
    if err:
        return bad(*err)
    conn = db()
    save_message(conn, tid, user, staff, text, uploads)
    if staff and t["status"] == "open":
        conn.execute("UPDATE support_tickets SET status = 'in_progress' WHERE id = ?", (tid,))
    conn.commit()
    if staff:
        bridge.submit(_notify, "dm_support_update", t["user_id"], tid, t["title"], "reply", site_url(f"/support#{tid}"))
    else:
        bridge.submit(_notify, "notify_support_reply", tid, user["id"], t["title"], text[:300], site_url(f"/admin#support/{tid}"))
    return jsonify({"ok": True}), 201


@route("/api/support/attachments/<int:aid>")
def get_attachment(aid):
    a = db().execute("SELECT * FROM support_attachments WHERE id = ?", (aid,)).fetchone()
    if not a or not load_ticket(a["ticket_id"]):
        return error(404, "not_found")
    resp = send_from_directory(C.UPLOAD_DIR, a["stored_name"], mimetype=a["mime"], max_age=3600)
    resp.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
    resp.headers["Cache-Control"] = "private, max-age=3600"
    return resp


# ---- staff side
@route("/api/admin/support", perm="viewStaff")
def admin_tickets():
    status = request.args.get("status", "")
    conn = db()
    sql = """SELECT t.*, (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count,
                    (SELECT is_staff FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_is_staff
             FROM support_tickets t"""
    args = ()
    if status in ("open", "in_progress", "closed"):
        sql += " WHERE t.status = ?"
        args = (status,)
    rows = conn.execute(sql + " ORDER BY CASE t.status WHEN 'closed' THEN 1 ELSE 0 END, t.updated_at DESC LIMIT 300", args).fetchall()
    counts = {r["status"]: r["n"] for r in conn.execute("SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status")}
    return jsonify({"tickets": [dict(r) for r in rows], "counts": counts})


@route("/api/admin/support/<int:tid>", methods=["PATCH"], perm="viewStaff")
def set_ticket_status(tid):
    status = body().get("status")
    if status not in ("open", "in_progress", "closed"):
        return bad("invalid_status", "狀態不正確")
    conn = db()
    t = conn.execute("SELECT * FROM support_tickets WHERE id = ?", (tid,)).fetchone()
    if not t:
        return error(404, "not_found")
    conn.execute("UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?", (status, D.now_ms(), tid))
    D.audit(conn, current_user(), "support_status", f"#{tid} → {status}", target=("support", tid, t["title"]),
            changes={"status": [t["status"], status]}, meta={"owner": t["user_id"]})
    conn.commit()
    if status == "closed" and t["status"] != "closed":
        bridge.submit(_notify, "dm_support_update", t["user_id"], tid, t["title"], "closed", site_url(f"/support#{tid}"))
    return jsonify({"ok": True})


@route("/api/admin/support/<int:tid>", methods=["DELETE"], perm="managePlayers")
def delete_ticket(tid):
    conn = db()
    t = conn.execute("SELECT * FROM support_tickets WHERE id = ?", (tid,)).fetchone()
    if not t:
        return error(404, "not_found")
    delete_attachment_files(conn.execute("SELECT stored_name FROM support_attachments WHERE ticket_id = ?", (tid,)).fetchall())
    conn.execute("DELETE FROM support_tickets WHERE id = ?", (tid,))
    D.audit(conn, current_user(), "support_delete", f"#{tid} {t['title']}", target=("support", tid, t["title"]),
            meta={"deleted": dict(t)})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/support/blocks", perm="viewStaff")
def list_support_blocks():
    rows = db().execute("""SELECT b.*, m.username FROM support_blocks b
                           LEFT JOIN members m ON m.discord_id = b.discord_id ORDER BY b.created_at DESC""").fetchall()
    return jsonify({"blocks": [dict(r) for r in rows]})


@route("/api/admin/support/blocks", methods=["POST"], perm="managePlayers")
def block_support_user():
    data = body()
    uid = str(data.get("discordId") or "").strip()
    reason = str(data.get("reason") or "").strip()[:300] or None
    if not DISCORD_ID_RE.match(uid):
        return bad("invalid_discord_id", "Discord ID 格式不正確")
    conn = db()
    conn.execute("INSERT INTO support_blocks (discord_id, reason, created_by, created_at) VALUES (?, ?, ?, ?) "
                 "ON CONFLICT(discord_id) DO UPDATE SET reason = excluded.reason",
                 (uid, reason, current_user()["id"], D.now_ms()))
    m = D.member(conn, uid)
    D.audit(conn, current_user(), "support_block", uid, target=("member", uid, m and m["username"]), meta={"reason": reason})
    conn.commit()
    return jsonify({"ok": True}), 201


@route("/api/admin/support/blocks/<uid>", methods=["DELETE"], perm="managePlayers")
def unblock_support_user(uid):
    conn = db()
    conn.execute("DELETE FROM support_blocks WHERE discord_id = ?", (uid,))
    m = D.member(conn, uid)
    D.audit(conn, current_user(), "support_unblock", uid, target=("member", uid, m and m["username"]))
    conn.commit()
    return jsonify({"ok": True})


# ---- storage
@route("/api/admin/storage", perm="viewStaff")
def storage():
    conn = db()
    rows = conn.execute("""SELECT a.id, a.ticket_id, a.orig_name, a.mime, a.size, a.created_at, t.title, t.status
                           FROM support_attachments a JOIN support_tickets t ON t.id = a.ticket_id
                           ORDER BY a.size DESC LIMIT 500""").fetchall()
    images = conn.execute("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM support_attachments").fetchone()
    closed = conn.execute("""SELECT COUNT(*) AS n, COALESCE(SUM(a.size), 0) AS bytes FROM support_attachments a
                             JOIN support_tickets t ON t.id = a.ticket_id WHERE t.status = 'closed'""").fetchone()
    return jsonify({
        "used": storage_used(), "limit": C.STORAGE_LIMIT_BYTES,
        "images": dict(images), "closedImages": dict(closed),
        "attachments": [dict(r) for r in rows],
    })


@route("/api/admin/storage/attachments/<int:aid>", methods=["DELETE"], perm="managePlayers")
def delete_attachment(aid):
    conn = db()
    a = conn.execute("SELECT * FROM support_attachments WHERE id = ?", (aid,)).fetchone()
    if not a:
        return error(404, "not_found")
    delete_attachment_files([a])
    conn.execute("DELETE FROM support_attachments WHERE id = ?", (aid,))
    D.audit(conn, current_user(), "image_delete", f"#{a['ticket_id']} {a['orig_name'] or ''} ({a['size']} B)",
            target=("support", a["ticket_id"], f"#{a['ticket_id']}"), meta={"attachment": dict(a)})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/storage/cleanup", methods=["POST"], perm="managePlayers")
def cleanup_storage():
    conn = db()
    rows = conn.execute("""SELECT a.* FROM support_attachments a JOIN support_tickets t ON t.id = a.ticket_id
                           WHERE t.status = 'closed'""").fetchall()
    delete_attachment_files(rows)
    conn.execute("DELETE FROM support_attachments WHERE id IN (SELECT a.id FROM support_attachments a "
                 "JOIN support_tickets t ON t.id = a.ticket_id WHERE t.status = 'closed')")
    D.audit(conn, current_user(), "image_cleanup", f"{len(rows)} images from closed tickets",
            meta={"count": len(rows), "bytes": sum(r["size"] for r in rows), "tickets": sorted({r["ticket_id"] for r in rows})})
    conn.commit()
    return jsonify({"ok": True, "deleted": len(rows)})


# ================================================================ account API keys
@route("/api/me/keys", perm="accountKeys")
def my_keys():
    rows = db().execute("SELECT id, name, prefix, created_at, last_used_at, usage_count FROM user_keys "
                        "WHERE user_id = ? ORDER BY id DESC", (current_user()["id"],)).fetchall()
    return jsonify({"keys": [dict(r) for r in rows]})


@route("/api/me/keys", methods=["POST"], perm="accountKeys")
def create_my_key():
    if g.via_key:
        return error(403, "forbidden", "Account keys cannot create other keys")
    name = str(body().get("name") or "").strip()
    if not name or len(name) > 48:
        return bad("invalid_key_name", "請輸入 1–48 字的名稱")
    user = current_user()
    conn = db()
    if conn.execute("SELECT COUNT(*) FROM user_keys WHERE user_id = ?", (user["id"],)).fetchone()[0] >= 5:
        return bad("too_many_keys", "每個帳號最多 5 把 API Key")
    key = f"{USER_KEY_PREFIX}{secrets.token_urlsafe(30)}"
    conn.execute("INSERT INTO user_keys (user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                 (user["id"], name, key[:12], sha256(key), D.now_ms()))
    D.audit(conn, user, "account_key_create", name, target=("member", user["id"], user["username"]), meta={"prefix": key[:12]})
    conn.commit()
    return jsonify({"key": key}), 201


@route("/api/me/keys/<int:kid>", methods=["DELETE"], perm="accountKeys")
def delete_my_key(kid):
    user = current_user()
    conn = db()
    row = conn.execute("SELECT * FROM user_keys WHERE id = ? AND user_id = ?", (kid, user["id"])).fetchone()
    if not row:
        return error(404, "not_found")
    conn.execute("DELETE FROM user_keys WHERE id = ?", (kid,))
    D.audit(conn, user, "account_key_delete", row["name"], target=("member", user["id"], user["username"]),
            meta={"key": {"id": kid, "name": row["name"], "prefix": row["prefix"], "uses": row["usage_count"]}})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/account-keys", perm="manageKeys")
def all_account_keys():
    rows = db().execute("""SELECT k.id, k.user_id, k.name, k.prefix, k.created_at, k.last_used_at, k.usage_count, m.username
                           FROM user_keys k LEFT JOIN members m ON m.discord_id = k.user_id ORDER BY k.id DESC""").fetchall()
    return jsonify({"keys": [dict(r) for r in rows]})


@route("/api/admin/account-keys/<int:kid>", methods=["DELETE"], perm="manageKeys")
def revoke_account_key(kid):
    conn = db()
    row = conn.execute("SELECT * FROM user_keys WHERE id = ?", (kid,)).fetchone()
    if not row:
        return error(404, "not_found")
    conn.execute("DELETE FROM user_keys WHERE id = ?", (kid,))
    m = D.member(conn, row["user_id"])
    D.audit(conn, current_user(), "account_key_revoke", f"{row['name']} ({row['user_id']})",
            target=("member", row["user_id"], m and m["username"]),
            meta={"key": {"id": kid, "name": row["name"], "prefix": row["prefix"], "uses": row["usage_count"]}})
    conn.commit()
    return jsonify({"ok": True})


# ================================================================ applications, panel, tickets
def bot_call(fn_name, *args):
    """Runs a bot coroutine from the web thread. Returns (result, error response)."""
    async def run(*a):
        from . import bot
        return await getattr(bot, fn_name)(*a)
    try:
        return bridge.call(run, *args), None
    except RuntimeError:
        return None, error(503, "bot_offline", "Discord 機器人目前離線")
    except Exception as exc:  # timeout or Discord error
        print(f"[bot] {fn_name} failed: {exc}")
        return None, error(502, "bot_failed", "Discord 機器人執行失敗")


@route("/api/admin/applications", perm="viewStaff")
def get_applications():
    conn = db()
    return jsonify({"open": P.applications_open(conn), "panel": P.load(conn), "defaults": P.DEFAULTS,
                    "cooldownDays": C.TEST_COOLDOWN_DAYS,
                    "panelPosted": bool(D.get_setting(conn, "apply_message_id")),
                    "applyChannel": D.get_setting(conn, "apply_channel_id")})


@route("/api/admin/applications", methods=["PUT"], perm="manageSettings")
def set_applications():
    data = body()
    conn = db()
    user = current_user()
    if "panel" in data:
        panel, bad_field = P.validate(data.get("panel") or {})
        if bad_field:
            return bad("invalid_panel", f"欄位格式不正確：{bad_field}")
        before = P.load(conn)
        P.save(conn, panel)
        D.audit(conn, user, "panel_update", panel["title"], target=("setting", "apply_panel", "考試申請面板"),
                changes=D.diff(before, panel))
    if "open" in data:
        is_open = bool(data.get("open"))
        was_open = P.applications_open(conn)
        D.set_setting(conn, "applications_open", "1" if is_open else "0")
        D.audit(conn, user, "applications_open" if is_open else "applications_pause", None,
                target=("setting", "applications_open", "考試申請"), changes={"open": [was_open, is_open]})
    conn.commit()
    posted, err = bot_call("refresh_apply_panel")
    return jsonify({"ok": True, "panelUpdated": bool(posted), "botError": bool(err)})


@route("/api/admin/result-template", perm="viewStaff")
def get_result_template():
    return jsonify({"template": P.load_result(db()), "defaults": P.RESULT_DEFAULTS})


@route("/api/admin/result-template", methods=["PUT"], perm="manageSettings")
def set_result_template():
    tpl, bad_field = P.validate_result(body())
    if bad_field:
        return bad("invalid_template", f"欄位不可空白或過長：{bad_field}")
    conn = db()
    before = P.load_result(conn)
    P.save_result(conn, tpl)
    D.audit(conn, current_user(), "result_template_update", tpl["title"], target=("setting", "result_template", "考試結果樣式"),
            changes=D.diff(before, tpl))
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/tickets", perm="viewStaff")
def list_tickets():
    status = request.args.get("status", "open")
    sql = """SELECT t.*, m.username AS applicant_name, x.tester_name, x.new_tier, x.wins, x.losses
             FROM tickets t LEFT JOIN members m ON m.discord_id = t.applicant_id
             LEFT JOIN tests x ON x.id = t.test_id"""
    args = ()
    if status in ("open", "tested", "closed"):
        sql += " WHERE t.status = ?"
        args = (status,)
    rows = db().execute(sql + " ORDER BY t.created_at DESC LIMIT 300", args).fetchall()
    counts = {r["status"]: r["n"] for r in db().execute("SELECT status, COUNT(*) AS n FROM tickets GROUP BY status")}
    return jsonify({"tickets": [dict(r) for r in rows], "counts": counts, "guildId": str(C.GUILD_ID) if C.GUILD_ID else None})


def load_test_ticket(channel_id):
    return db().execute("SELECT * FROM tickets WHERE channel_id = ?", (str(channel_id),)).fetchone()


@route("/api/admin/tickets/<channel_id>/close", methods=["POST"], perm="manageTickets")
def close_test_ticket(channel_id):
    t = load_test_ticket(channel_id)
    if not t:
        return error(404, "not_found")
    user = current_user()
    conn = db()
    conn.execute("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE channel_id = ?",
                 (D.now_ms(), user["id"], t["channel_id"]))
    D.audit(conn, user, "ticket_force_close", t["mc_name"], target=("ticket", t["channel_id"], t["mc_name"]),
            changes={"status": [t["status"], "closed"]}, meta={"ticket": dict(t)})
    conn.commit()
    _, err = bot_call("delete_ticket_channel", int(t["channel_id"]), user["username"])
    return jsonify({"ok": True, "botError": bool(err)})


@route("/api/admin/tickets/<channel_id>/reopen", methods=["POST"], perm="manageTickets")
def reopen_test_ticket(channel_id):
    t = load_test_ticket(channel_id)
    if not t:
        return error(404, "not_found")
    exists, err = bot_call("ticket_channel_exists", int(t["channel_id"]))
    if err:
        return err
    if not exists:
        return bad("channel_gone", "考試頻道已被刪除，無法重新開啟")
    conn = db()
    conn.execute("UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL WHERE channel_id = ?", (t["channel_id"],))
    D.audit(conn, current_user(), "ticket_reopen", t["mc_name"], target=("ticket", t["channel_id"], t["mc_name"]),
            changes={"status": [t["status"], "open"]}, meta={"ticket": dict(t)})
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/tickets/<channel_id>/kind", methods=["POST"], perm="manageTickets")
def set_ticket_kind(channel_id):
    t = load_test_ticket(channel_id)
    kind = body().get("kind")
    if not t:
        return error(404, "not_found")
    if kind not in ("normal", "high"):
        return bad("invalid_kind", "類型不正確")
    conn = db()
    conn.execute("UPDATE tickets SET kind = ? WHERE channel_id = ?", (kind, t["channel_id"]))
    D.audit(conn, current_user(), "ticket_kind", f"{t['mc_name']} → {kind}", target=("ticket", t["channel_id"], t["mc_name"]),
            changes={"kind": [t["kind"], kind]})
    conn.commit()
    _, err = bot_call("apply_ticket_kind", int(t["channel_id"]), kind)
    return jsonify({"ok": True, "botError": bool(err)})


# ================================================================ direct results
def mojang_profile(name):
    try:
        req = urllib.request.Request(f"https://api.mojang.com/users/profiles/minecraft/{urllib.parse.quote(name)}",
                                     headers={"User-Agent": "Mc.Tierlist.Asia"})
        with urllib.request.urlopen(req, timeout=10) as res:
            if res.status == 204:
                return None
            data = json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        if exc.code in (204, 404):
            return None
        raise
    if not data.get("id"):
        return None
    u = data["id"]
    return {"name": data["name"], "id": f"{u[:8]}-{u[8:12]}-{u[12:16]}-{u[16:20]}-{u[20:]}"}


def allowed_tiers(user):
    if user["seniorTester"] or user["level"] >= C.LEVEL_ADMIN:
        return C.TIER_ORDER
    return C.TIER_ORDER[:C.TIER_ORDER.index(C.TESTER_MAX_TIER) + 1]


@route("/api/results", methods=["POST"], perm="giveResults")
def give_result():
    """Gives a tier directly (without a Discord ticket) — same effect as /result."""
    data = body()
    user = current_user()
    name = str(data.get("name") or "").strip()
    discord_id = str(data.get("discordId") or "").strip() or None
    tier = str(data.get("tier") or "").upper()
    wins = clamp_int(data.get("wins"), 0, 99, -1)
    losses = clamp_int(data.get("losses"), 0, 99, -1)
    if not NAME_RE.match(name):
        return bad("invalid_name", "玩家名稱需為 2–16 個英數字或底線")
    if discord_id and not DISCORD_ID_RE.match(discord_id):
        return bad("invalid_discord_id", "Discord ID 格式不正確")
    if tier not in allowed_tiers(user):
        return error(403, "tier_not_allowed", "你不能給予這個段位")
    if wins < 0 or losses < 0:
        return bad("invalid_score", "勝敗場需為 0–99")
    try:
        profile = mojang_profile(name)
    except (urllib.error.URLError, ValueError):
        return error(502, "mojang_unavailable", "目前無法連線到 Mojang 驗證帳號")
    if not profile:
        return bad("mc_not_found", "找不到這個 Minecraft 帳號")
    conn = db()
    existing = conn.execute("SELECT * FROM players WHERE REPLACE(uuid, '-', '') = ? OR name = ?",
                            (profile["id"].replace("-", ""), profile["name"])).fetchone()
    discord_id = discord_id or (existing["discord_id"] if existing else None)
    if discord_id and discord_id == user["id"]:
        return error(403, "self_result", "你不能給自己成績")
    m = D.member(conn, discord_id) if discord_id else None
    prev = C.tier_from_roles(m["roles"]) if m and m["in_guild"] else (existing["tier"] if existing else None)
    tester = {"id": user["id"], "username": user["username"]}
    D.record_test(conn, applicant_id=discord_id, mc_name=profile["name"], uuid=profile["id"], tester=tester,
                  prev_tier=prev, new_tier=tier, wins=wins, losses=losses, channel_id=None)
    conn.commit()
    notes, err = bot_call("publish_result", discord_id, profile["name"], user["id"], prev, tier, wins, losses)
    return jsonify({"ok": True, "name": profile["name"], "prevTier": prev, "tier": tier,
                    "notes": notes or [], "botError": bool(err)}), 201


@app.route("/api/<path:_rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_not_found(_rest):
    return error(404, "not_found")
