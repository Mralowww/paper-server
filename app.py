"""Mc.Tierlist.Asia entry point: runs the website and, when configured, the Discord bot."""
import os
import threading
import urllib.request

from mctl import config as C
from mctl import db


def public_ip():
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=4) as res:
            return res.read().decode().strip()
    except OSError:
        return None


def announce():
    """Prints where the site can be reached, so it shows up in the hosting console."""
    ip = public_ip() or os.environ.get("SERVER_IP") or "未知"
    print("=" * 52)
    print(" Mc.Tierlist.Asia 已啟動")
    print(f"  公開 IP  : {ip}")
    print(f"  連線位址 : http://{ip}:{C.PORT}")
    print(f"  網站網址 : {C.BASE_URL}")
    print("=" * 52, flush=True)


def serve_web():
    from waitress import serve
    from mctl.web import app

    announce()
    serve(app, host=C.HOST, port=C.PORT, threads=8)


def main():
    db.init()
    from mctl import ddns
    ddns.start()
    from mctl import links
    links.start()
    if C.DISCORD_BOT_TOKEN and C.GUILD_ID:
        threading.Thread(target=serve_web, name="web", daemon=True).start()
        from mctl import bot
        bot.run()
    else:
        print("[bot] DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set — running website only.")
        serve_web()


if __name__ == "__main__":
    main()
