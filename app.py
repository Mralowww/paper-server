"""Mc.Tierlist.Asia entry point: runs the website and, when configured, the Discord bot."""
import threading

from mctl import config as C
from mctl import db


def serve_web():
    from waitress import serve
    from mctl.web import app

    print(f"Mc.Tierlist.Asia website on {C.BASE_URL} (port {C.PORT})")
    serve(app, host=C.HOST, port=C.PORT, threads=8)


def main():
    db.init()
    if C.DISCORD_BOT_TOKEN and C.GUILD_ID:
        threading.Thread(target=serve_web, name="web", daemon=True).start()
        from mctl import bot
        bot.run()
    else:
        print("[bot] DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set — running website only.")
        serve_web()


if __name__ == "__main__":
    main()
