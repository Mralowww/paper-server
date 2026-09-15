import os
import secrets
import string
import time  # noqa: F401 (used by timestamp_to_date filter)

import requests
from flask import Flask, abort, jsonify, redirect, render_template, request, session, url_for

import models

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "http://localhost:8787/discord/callback")
PLUGIN_SHARED_SECRET = os.environ.get("PLUGIN_SHARED_SECRET", "")
SEED_ADMIN_DISCORD_ID = os.environ.get("SEED_ADMIN_DISCORD_ID", "")

DISCORD_API = "https://discord.com/api"
VERIFY_CODE_TTL_SECONDS = 600

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)

models.init_db()
if SEED_ADMIN_DISCORD_ID:
    with models.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO admins (discord_id) VALUES (?)", (SEED_ADMIN_DISCORD_ID,)
        )


@app.after_request
def add_security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    return resp


def current_discord_user():
    return session.get("discord_id"), session.get("discord_username")


def require_admin():
    discord_id, _ = current_discord_user()
    if not discord_id or not models.is_admin(discord_id):
        abort(403)


def gen_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ---------- 前台 ----------

def mc_avatar_url(mc_uuid):
    if not mc_uuid:
        return None
    return f"https://crafatar.com/avatars/{mc_uuid}?size=64&overlay"


app.jinja_env.globals["mc_avatar_url"] = mc_avatar_url
app.jinja_env.globals["tier_display_name"] = models.tier_display_name


@app.template_filter("timestamp_to_date")
def timestamp_to_date(ts):
    if not ts:
        return "-"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))


@app.route("/")
def index():
    players = models.list_ranked_players()
    return render_template("index.html", players=players, tiers=models.TIERS)


@app.route("/tests")
def tests():
    results = models.list_test_results(limit=100)
    return render_template("tests.html", results=results)


@app.route("/login/discord")
def login_discord():
    if not DISCORD_CLIENT_ID:
        return "尚未設定 DISCORD_CLIENT_ID,請聯絡管理員。", 500
    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify",
    }
    query = "&".join(f"{k}={requests.utils.quote(v)}" for k, v in params.items())
    return redirect(f"{DISCORD_API}/oauth2/authorize?{query}")


@app.route("/discord/callback")
def discord_callback():
    code = request.args.get("code")
    if not code:
        return redirect(url_for("index"))

    token_resp = requests.post(
        f"{DISCORD_API}/oauth2/token",
        data={
            "client_id": DISCORD_CLIENT_ID,
            "client_secret": DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": DISCORD_REDIRECT_URI,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    if token_resp.status_code != 200:
        return "Discord 登入失敗,請重試。", 400

    access_token = token_resp.json()["access_token"]
    user_resp = requests.get(
        f"{DISCORD_API}/users/@me",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    if user_resp.status_code != 200:
        return "取得 Discord 個人資料失敗,請重試。", 400

    user = user_resp.json()
    session["discord_id"] = user["id"]
    session["discord_username"] = user.get("username", "unknown")
    return redirect(url_for("account"))


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/account")
def account():
    discord_id, discord_username = current_discord_user()
    if not discord_id:
        return redirect(url_for("login_discord"))

    player = models.get_player_by_discord_id(discord_id)
    new_code = request.args.get("new_code") == "1"
    code = None
    if new_code or not player or not player.get("mc_uuid"):
        code = gen_code()
        models.upsert_verify_code(code, discord_id, discord_username, VERIFY_CODE_TTL_SECONDS)

    return render_template(
        "account.html",
        discord_username=discord_username,
        player=player,
        code=code,
        ttl_minutes=VERIFY_CODE_TTL_SECONDS // 60,
        is_admin=models.is_admin(discord_id),
    )


# ---------- 遊戲伺服器插件呼叫的內部驗證 API ----------

@app.route("/internal/verify", methods=["POST"])
def internal_verify():
    if not PLUGIN_SHARED_SECRET or request.headers.get("X-Plugin-Secret") != PLUGIN_SHARED_SECRET:
        abort(403)

    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().upper()
    mc_uuid = (data.get("mc_uuid") or "").strip()
    mc_username = (data.get("mc_username") or "").strip()

    if not code or not mc_uuid or not mc_username:
        return jsonify({"error": "missing_fields"}), 400

    record = models.consume_verify_code(code)
    if not record:
        return jsonify({"error": "invalid_or_expired_code"}), 404

    ok, reason = models.bind_player(
        record["discord_id"], record["discord_username"], mc_uuid, mc_username
    )
    if not ok:
        return jsonify({"error": reason}), 409

    return jsonify({"ok": True})


# ---------- 管理後台 ----------

@app.route("/admin")
def admin_home():
    require_admin()
    players = models.list_all_players()
    api_keys = models.list_api_keys()
    return render_template("admin.html", players=players, tiers=models.TIERS, api_keys=api_keys)


@app.route("/admin/set_tier", methods=["POST"])
def admin_set_tier():
    require_admin()
    mc_username = request.form.get("mc_username", "").strip()
    tier = request.form.get("tier", "").strip() or None
    region = request.form.get("region", "").strip() or None
    if tier and tier not in models.TIERS:
        abort(400)
    ok = models.set_tier(mc_username, tier, region)
    if not ok:
        abort(404)
    return redirect(url_for("admin_home"))


@app.route("/admin/api_keys/create", methods=["POST"])
def admin_create_api_key():
    require_admin()
    label = request.form.get("label", "").strip() or "未命名"
    key = "tlk_" + secrets.token_urlsafe(32)
    models.create_api_key(key, label)
    return redirect(url_for("admin_home"))


@app.route("/admin/api_keys/revoke", methods=["POST"])
def admin_revoke_api_key():
    require_admin()
    key = request.form.get("key", "").strip()
    models.revoke_api_key(key)
    return redirect(url_for("admin_home"))


# ---------- 對外公開 API(給 Minecraft mod 用) ----------

def require_api_key():
    key = request.headers.get("X-API-Key") or request.args.get("api_key")
    if not key or not models.check_api_key(key):
        abort(401)


@app.route("/api/v1/tier/<username>")
def api_get_tier(username):
    require_api_key()
    player = models.get_player_by_mc_username(username)
    if not player or not player.get("vanilla_tier"):
        return jsonify({"username": username, "tier": None, "ranked": False}), 200
    return jsonify(
        {
            "username": player["mc_username"],
            "uuid": player["mc_uuid"],
            "tier": player["vanilla_tier"],
            "region": player.get("region"),
            "ranked": True,
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    app.run(host="0.0.0.0", port=port)
