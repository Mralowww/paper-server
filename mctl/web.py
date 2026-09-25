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
    MAX_CONTENT_LENGTH=32 * 1024,
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
def current_user():
    """The signed-in Discord user with access info, or None. Roles come from the local member cache."""
    if "user" in g:
        return g.user
    g.user = None
    uid = session.get("user_id")
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
    return g.user


def permissions(user):
    lvl = user["level"] if user else 0
    return {
        "viewStaff": lvl >= C.LEVEL_HELPER,
        "managePlayers": lvl >= C.LEVEL_MODERATOR,
        "manageKeys": lvl >= C.LEVEL_ADMIN,
        "manageSettings": lvl >= C.LEVEL_ADMIN,
        "testerPanel": bool(user and (user["tester"] or lvl >= C.LEVEL_ADMIN)),
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
            if not same_origin():
                return error(403, "bad_origin")
            user = current_user()
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
    return jsonify({"user": user, "permissions": permissions(user)})


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
    })


@route("/api/admin/audit", perm="viewStaff")
def audit_list():
    limit = clamp_int(request.args.get("limit"), 1, 200, 100)
    rows = db().execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return jsonify({"entries": [dict(r) for r in rows]})


@app.route("/api/<path:_rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def api_not_found(_rest):
    return error(404, "not_found")


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
