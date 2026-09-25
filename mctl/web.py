"""Flask website: public pages, developer API, member pages and the staff panel."""
import hashlib
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from functools import wraps

from flask import Flask, abort, g, jsonify, redirect, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix

from . import bridge
from . import config as C
from . import db as D
from . import ddns
from . import panel as P

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

app = Flask(__name__, static_folder=None)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
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


@app.get("/auth/discord")
def discord_login():
    if not C.DISCORD_CLIENT_ID or not C.DISCORD_CLIENT_SECRET:
        return redirect("/?login_error=not_configured")
    state = secrets.token_hex(16)
    session["oauth_state"] = state
    nxt = request.args.get("next", "/")
    session["login_next"] = nxt if nxt.startswith("/") and not nxt.startswith("//") else "/"
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
    D.audit(db(), user, "login")
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
    })


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
    recent = [dict(r) for r in conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 8").fetchall()]
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
    D.audit(conn, user, "player_create", f"{value['name']} → {value['tier']}")
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
    D.audit(conn, user, "player_update", f"{value['name']}: {change}")
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
    D.audit(conn, current_user(), "player_delete", existing["name"])
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
    D.audit(conn, current_user(), "cooldown_reset", p["name"])
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
        SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.usage_count, k.revoked, k.created_by,
               m.username AS created_by_name
        FROM api_keys k LEFT JOIN members m ON m.discord_id = k.created_by ORDER BY k.id DESC""").fetchall()
    return jsonify({"keys": [dict(r) for r in rows]})


@route("/api/admin/keys", methods=["POST"], perm="manageKeys")
def create_key():
    name = str(body().get("name") or "").strip()
    if not name or len(name) > 48:
        return bad("invalid_key_name", "請輸入 1–48 字的名稱")
    key = f"mctl_{secrets.token_urlsafe(24)}"
    conn = db()
    conn.execute("INSERT INTO api_keys (name, prefix, key_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
                 (name, key[:12], sha256(key), current_user()["id"], D.now_ms()))
    D.audit(conn, current_user(), "key_create", name)
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
    D.audit(conn, current_user(), "key_revoke" if revoked else "key_restore", row["name"])
    conn.commit()
    return jsonify({"ok": True})


@route("/api/admin/keys/<int:kid>", methods=["DELETE"], perm="manageKeys")
def delete_key(kid):
    conn = db()
    row = conn.execute("SELECT * FROM api_keys WHERE id = ?", (kid,)).fetchone()
    if not row:
        return error(404, "not_found")
    conn.execute("DELETE FROM api_keys WHERE id = ?", (kid,))
    D.audit(conn, current_user(), "key_delete", row["name"])
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
        "ddns": {"enabled": ddns.enabled(), **ddns.state},
    })


@route("/api/admin/audit", perm="viewStaff")
def audit_list():
    limit = clamp_int(request.args.get("limit"), 1, 200, 100)
    rows = db().execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return jsonify({"entries": [dict(r) for r in rows]})




# ---------------------------------------------------------------- pages & static files
def page(name, status=200):
    resp = send_from_directory(C.PUBLIC, name, max_age=0)
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
    return send_from_directory(C.PUBLIC / "assets", filename, max_age=3600)


MANAGE_BLOCK_RE = re.compile(r"<!--MANAGE-->.*?<!--/MANAGE-->", re.S)


@app.get("/docs")
def docs_page():
    """The Management API section is only sent to staff and testers who can hold account keys."""
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
    conn.execute("""INSERT INTO bans (mc_name, uuid, discord_id, reason, created_by, created_by_name, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                 (name, uuid, discord_id, reason, user["id"], user["username"], D.now_ms(), expires))
    D.audit(conn, user, "ban_create", f"{name} ({'permanent' if not expires else duration}) — {reason}")
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
    D.audit(conn, user, "ban_revoke", b["mc_name"])
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
    D.audit(conn, user, "support_open", f"#{tid} {title}")
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
    D.audit(conn, current_user(), "support_status", f"#{tid} → {status}")
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
    D.audit(conn, current_user(), "support_delete", f"#{tid} {t['title']}")
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
    D.audit(conn, current_user(), "support_block", uid)
    conn.commit()
    return jsonify({"ok": True}), 201


@route("/api/admin/support/blocks/<uid>", methods=["DELETE"], perm="managePlayers")
def unblock_support_user(uid):
    conn = db()
    conn.execute("DELETE FROM support_blocks WHERE discord_id = ?", (uid,))
    D.audit(conn, current_user(), "support_unblock", uid)
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
    D.audit(conn, current_user(), "image_delete", f"#{a['ticket_id']} {a['orig_name'] or ''} ({a['size']} B)")
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
    D.audit(conn, current_user(), "image_cleanup", f"{len(rows)} images from closed tickets")
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
    D.audit(conn, user, "account_key_create", name)
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
    D.audit(conn, user, "account_key_delete", row["name"])
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
    D.audit(conn, current_user(), "account_key_revoke", f"{row['name']} ({row['user_id']})")
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
        P.save(conn, panel)
        D.audit(conn, user, "panel_update", panel["title"])
    if "open" in data:
        is_open = bool(data.get("open"))
        D.set_setting(conn, "applications_open", "1" if is_open else "0")
        D.audit(conn, user, "applications_open" if is_open else "applications_pause", None)
    conn.commit()
    posted, err = bot_call("refresh_apply_panel")
    return jsonify({"ok": True, "panelUpdated": bool(posted), "botError": bool(err)})


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
    D.audit(conn, user, "ticket_force_close", t["mc_name"])
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
    D.audit(conn, current_user(), "ticket_reopen", t["mc_name"])
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
    D.audit(conn, current_user(), "ticket_kind", f"{t['mc_name']} → {kind}")
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
