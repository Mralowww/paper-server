import hmac
import os
import secrets
import string
import threading
import time  # noqa: F401 (used by timestamp_to_date filter)
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import (
    Flask, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for,
)
from werkzeug.utils import secure_filename

import models

DOWNLOADS_DIR = Path(__file__).parent / "data" / "downloads"
ALLOWED_DOWNLOAD_EXTENSIONS = {".jar"}

load_dotenv()

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "http://localhost:8787/discord/callback")
PLUGIN_SHARED_SECRET = os.environ.get("PLUGIN_SHARED_SECRET", "")
DISCORD_GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "")

DISCORD_API = "https://discord.com/api"
VERIFY_CODE_TTL_SECONDS = 600
PERMISSION_ADMINISTRATOR = 0x8

# 暴力猜 PLUGIN_SHARED_SECRET 的簡易防護:同一個 IP 連續猜錯太多次就先鎖一陣子。
# 存在記憶體就好,重啟網站會重置,不需要為了這個再多開一張資料表。
_SECRET_FAIL_LIMIT = 6
_SECRET_LOCKOUT_SECONDS = 5 * 60
_secret_fail_counts: dict[str, tuple[int, float]] = {}

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FORCE_SECURE_COOKIES") == "1",
    # 模組下載檔案(.jar)需要比較大的上傳上限,其餘 API 端點的請求本體其實都很小,
    # 這個上限主要是擋掉異常巨大的請求,不是真的預期會有人上傳到滿
    MAX_CONTENT_LENGTH=64 * 1024 * 1024,
)

models.init_db()


@app.after_request
def add_security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' https://crafatar.com data:; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src https://fonts.gstatic.com; "
        "script-src 'self'; "
        "frame-ancestors 'none'"
    )
    return resp


def current_discord_user():
    return session.get("discord_id"), session.get("discord_username")


def require_admin():
    discord_id, _ = current_discord_user()
    if not discord_id or not session.get("is_admin"):
        abort(403)


def gen_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ---------- 前台 ----------

def mc_avatar_url(mc_uuid):
    if not mc_uuid:
        return None
    return f"https://crafatar.com/avatars/{mc_uuid}?size=64&overlay"


def namemc_url(mc_username):
    if not mc_username:
        return None
    return f"https://namemc.com/profile/{requests.utils.quote(mc_username)}"


app.jinja_env.globals["mc_avatar_url"] = mc_avatar_url
app.jinja_env.globals["namemc_url"] = namemc_url
app.jinja_env.globals["tier_display_name"] = models.tier_display_name


@app.template_filter("timestamp_to_date")
def timestamp_to_date(ts):
    if not ts:
        return "-"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))


@app.route("/")
def index():
    players = models.list_ranked_players()
    stats = {
        "total": len(players),
        "top_tier": sum(1 for p in players if p["vanilla_tier"] == "HT1"),
        "regions": len({p["region"] for p in players if p.get("region")}),
    }
    return render_template("index.html", players=players, tiers=models.TIERS, stats=stats)


@app.route("/docs")
def docs():
    return render_template("docs.html")


SUPPORTED_MC_VERSIONS = ["1.21"] + [f"1.21.{i}" for i in range(1, 12)]


@app.route("/downloads")
def downloads():
    selected_version = request.args.get("mc_version") or ""
    items = models.list_downloads(mc_version=selected_version or None)
    return render_template(
        "downloads.html", downloads=items,
        mc_versions=SUPPORTED_MC_VERSIONS, selected_version=selected_version,
    )


@app.route("/downloads/file/<int:download_id>")
def downloads_file(download_id):
    item = models.get_download(download_id)
    if not item:
        abort(404)
    return send_from_directory(
        DOWNLOADS_DIR, item["stored_filename"],
        as_attachment=True, download_name=item["original_filename"],
    )


@app.route("/tests")
def tests():
    results = models.list_test_results(limit=100)
    return render_template("tests.html", results=results)


@app.route("/login/discord")
def login_discord():
    if not DISCORD_CLIENT_ID:
        return "尚未設定 DISCORD_CLIENT_ID,請聯絡管理員。", 500

    state = secrets.token_urlsafe(24)
    session["oauth_state"] = state

    params = {
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify guilds",
        "state": state,
    }
    query = "&".join(f"{k}={requests.utils.quote(v)}" for k, v in params.items())
    return redirect(f"{DISCORD_API}/oauth2/authorize?{query}")


@app.route("/discord/callback")
def discord_callback():
    code = request.args.get("code")
    state = request.args.get("state")
    expected_state = session.pop("oauth_state", None)

    if not code or not state or not expected_state or not hmac.compare_digest(state, expected_state):
        return "登入請求驗證失敗,請重新登入(避免 CSRF 攻擊)。", 400

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
    session["is_admin"] = check_is_administrator(access_token)
    return redirect(url_for("account"))


def check_is_administrator(access_token: str) -> bool:
    """判斷這個玩家在指定 Discord 伺服器裡是否有 Administrator 權限(伺服器擁有者也算)。"""
    if not DISCORD_GUILD_ID:
        return False
    try:
        resp = requests.get(
            f"{DISCORD_API}/users/@me/guilds",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
    except requests.RequestException:
        return False
    if resp.status_code != 200:
        return False

    for guild in resp.json():
        if guild.get("id") == DISCORD_GUILD_ID:
            permissions = int(guild.get("permissions", 0))
            return bool(permissions & PERMISSION_ADMINISTRATOR)
    return False


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
        is_admin=session.get("is_admin", False),
    )


# ---------- 遊戲伺服器插件呼叫的內部驗證 API ----------

def _is_locked_out(ip: str) -> bool:
    count, locked_until = _secret_fail_counts.get(ip, (0, 0))
    return count >= _SECRET_FAIL_LIMIT and time.time() < locked_until


def _record_secret_failure(ip: str):
    count, _ = _secret_fail_counts.get(ip, (0, 0))
    count += 1
    _secret_fail_counts[ip] = (count, time.time() + _SECRET_LOCKOUT_SECONDS)


def _clear_secret_failures(ip: str):
    _secret_fail_counts.pop(ip, None)


@app.route("/internal/verify", methods=["POST"])
def internal_verify():
    client_ip = request.remote_addr or "unknown"
    if _is_locked_out(client_ip):
        abort(429)

    provided_secret = request.headers.get("X-Plugin-Secret") or ""
    if not PLUGIN_SHARED_SECRET or not hmac.compare_digest(provided_secret, PLUGIN_SHARED_SECRET):
        _record_secret_failure(client_ip)
        abort(403)

    _clear_secret_failures(client_ip)

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
    download_items = models.list_downloads()
    return render_template(
        "admin.html", players=players, tiers=models.TIERS, api_keys=api_keys,
        downloads=download_items, mc_versions=SUPPORTED_MC_VERSIONS,
    )


@app.route("/admin/players/<int:player_id>/edit", methods=["POST"])
def admin_edit_player(player_id):
    require_admin()
    mc_username = request.form.get("mc_username", "").strip() or None
    region = request.form.get("region", "").strip() or None
    tier_raw = request.form.get("tier", "__unset__")
    tier = None if tier_raw == "" else (tier_raw if tier_raw != "__unset__" else "__unset__")
    if tier not in ("__unset__", None) and tier not in models.TIERS:
        abort(400)
    ok = models.update_player(player_id, mc_username=mc_username, region=region, tier=tier)
    if not ok:
        abort(404)
    return redirect(url_for("admin_home"))


@app.route("/admin/players/<int:player_id>/delete", methods=["POST"])
def admin_delete_player(player_id):
    require_admin()
    models.delete_player(player_id)
    return redirect(url_for("admin_home"))


@app.route("/admin/downloads/upload", methods=["POST"])
def admin_upload_download():
    require_admin()
    discord_id, _ = current_discord_user()

    file = request.files.get("file")
    version = request.form.get("version", "").strip()
    mc_version_min = request.form.get("mc_version_min", "").strip()
    mc_version_max = request.form.get("mc_version_max", "").strip()
    description = request.form.get("description", "").strip() or None

    if not file or not file.filename or not version or not mc_version_min or not mc_version_max:
        abort(400)
    if models.parse_mc_version(mc_version_min) > models.parse_mc_version(mc_version_max):
        abort(400, description="最低版本不能比最高版本新")

    original_name = secure_filename(file.filename)
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_DOWNLOAD_EXTENSIONS:
        abort(400, description="只能上傳 .jar 檔案")

    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    stored_filename = f"{secrets.token_hex(8)}_{original_name}"
    file.save(DOWNLOADS_DIR / stored_filename)

    models.create_download(
        stored_filename, original_name, version, mc_version_min, mc_version_max, description, discord_id
    )
    return redirect(url_for("admin_home"))


@app.route("/admin/downloads/<int:download_id>/delete", methods=["POST"])
def admin_delete_download(download_id):
    require_admin()
    item = models.delete_download(download_id)
    if item:
        file_path = DOWNLOADS_DIR / item["stored_filename"]
        file_path.unlink(missing_ok=True)
    return redirect(url_for("admin_home"))


@app.route("/admin/api_keys/create", methods=["POST"])
def admin_create_api_key():
    require_admin()
    label = request.form.get("label", "").strip() or "未命名"
    scope = request.form.get("scope", "read").strip()
    if scope not in ("read", "control"):
        abort(400)
    key = "tlk_" + secrets.token_urlsafe(32)
    models.create_api_key(key, label, scope)
    return redirect(url_for("admin_home"))


@app.route("/admin/api_keys/revoke", methods=["POST"])
def admin_revoke_api_key():
    require_admin()
    key = request.form.get("key", "").strip()
    models.revoke_api_key(key)
    return redirect(url_for("admin_home"))


# ---------- 對外公開 API(給 Minecraft mod 用) ----------

def require_api_key(required_scope: str | None = None):
    key = request.headers.get("X-API-Key") or request.args.get("api_key")
    if not key or not models.check_api_key(key, required_scope=required_scope):
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


@app.route("/api/v1/tiers")
def api_list_tiers():
    require_api_key()
    players = models.list_ranked_players()
    return jsonify(
        [
            {
                "username": p["mc_username"],
                "uuid": p["mc_uuid"],
                "tier": p["vanilla_tier"],
                "region": p.get("region"),
            }
            for p in players
        ]
    )


def serialize_player(player):
    return {
        "discord_id": player["discord_id"],
        "discord_username": player["discord_username"],
        "mc_uuid": player.get("mc_uuid"),
        "mc_username": player.get("mc_username"),
        "tier": player.get("vanilla_tier"),
        "region": player.get("region"),
        "last_test_at": player.get("last_test_at"),
    }


@app.route("/api/v1/player/discord/<discord_id>")
def api_get_player_by_discord(discord_id):
    require_api_key()
    player = models.get_player_by_discord_id(discord_id)
    if not player:
        return jsonify({"error": "not_found"}), 404
    return jsonify(serialize_player(player))


@app.route("/api/v1/player/uuid/<mc_uuid>")
def api_get_player_by_uuid(mc_uuid):
    require_api_key()
    player = models.get_player_by_mc_uuid(mc_uuid)
    if not player:
        return jsonify({"error": "not_found"}), 404
    return jsonify(serialize_player(player))


@app.route("/api/v1/cooldown/<username>")
def api_get_cooldown(username):
    require_api_key()
    player = models.get_player_by_mc_username(username)
    if not player:
        return jsonify({"username": username, "can_test": True, "remaining_seconds": 0, "next_test_type": "normal"})

    can_test, remaining, test_type = models.check_test_cooldown(player["discord_id"])
    return jsonify(
        {
            "username": player["mc_username"],
            "can_test": can_test,
            "remaining_seconds": remaining,
            "next_test_type": test_type,
        }
    )


@app.route("/api/v1/tests")
def api_list_tests():
    require_api_key()
    username = request.args.get("username")
    try:
        limit = min(max(int(request.args.get("limit", 50)), 1), 200)
    except ValueError:
        abort(400)

    results = models.list_test_results(limit=limit, mc_username=username)
    return jsonify(
        [
            {
                "username": r["mc_username"],
                "uuid": r["mc_uuid"],
                "region": r.get("region"),
                "game_name": r.get("game_name"),
                "score_wins": r["score_wins"],
                "score_losses": r["score_losses"],
                "tier_before": r.get("tier_before"),
                "tier_after": r["tier_after"],
                "test_type": r["test_type"],
                "examiner": r["examiner_username"],
                "created_at": r["created_at"],
            }
            for r in results
        ]
    )


@app.route("/api/v1/discord/announce", methods=["POST"])
def api_discord_announce():
    require_api_key(required_scope="control")

    data = request.get_json(silent=True) or {}
    channel_id = str(data.get("channel_id") or "").strip()
    message = str(data.get("message") or "").strip()

    if not channel_id or not channel_id.isdigit():
        return jsonify({"error": "invalid_channel_id"}), 400
    if not message or len(message) > 2000:
        return jsonify({"error": "invalid_message"}), 400

    key = request.headers.get("X-API-Key") or request.args.get("api_key")
    message_id = models.enqueue_discord_message(channel_id, message, created_by=f"apikey:{key[:12]}...")
    return jsonify({"ok": True, "queued_id": message_id}), 202


def start_discord_bot_in_background():
    """有些主機一次只能跑一支 Python 程式(例如 Pterodactyl 的 Generic Python egg),
    這種情況下把 Discord bot 跟網站放進同一個程序,用背景執行緒跑,兩邊都能動。
    如果有能力另外開一支程序跑 discord_bot/bot.py,那樣做更乾淨,不強制用這個。"""
    if not os.environ.get("DISCORD_BOT_TOKEN") or os.environ.get("RUN_BOT_IN_WEB_PROCESS") != "1":
        return

    def _run():
        from discord_bot import bot as discord_bot_module
        discord_bot_module.run_in_current_thread()

    thread = threading.Thread(target=_run, name="discord-bot", daemon=True)
    thread.start()


if __name__ == "__main__":
    start_discord_bot_in_background()
    port = int(os.environ.get("PORT") or os.environ.get("SERVER_PORT") or 8787)
    app.run(host="0.0.0.0", port=port)
