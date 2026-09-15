"""
Mralow Tiers 的 Discord bot。

功能:
- /tier <mc帳號>  查詢某玩家目前的 Vanilla Tier
- 每隔一段時間偵測資料庫裡的 tier 變動,自動在指定頻道公告

跟網站(app.py)共用同一個 SQLite 資料庫(tierlist.db),不需要額外的 API 呼叫。
"""

import os
import sys
from pathlib import Path

import discord
from discord import app_commands

sys.path.append(str(Path(__file__).resolve().parent.parent))
import models  # noqa: E402

DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
ANNOUNCE_CHANNEL_ID = int(os.environ.get("ANNOUNCE_CHANNEL_ID", "0") or "0")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "60"))

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

_last_seen_tiers: dict[str, str | None] = {}


@tree.command(name="tier", description="查詢某位玩家目前的 Vanilla Tier")
@app_commands.describe(username="Minecraft 帳號")
async def tier_command(interaction: discord.Interaction, username: str):
    player = models.get_player_by_mc_username(username)
    if not player or not player.get("vanilla_tier"):
        await interaction.response.send_message(f"找不到 `{username}` 的排名資料。")
        return
    await interaction.response.send_message(
        f"**{player['mc_username']}** 目前是 **{player['vanilla_tier']}**"
        + (f"(地區: {player['region']})" if player.get("region") else "")
    )


async def poll_tier_changes():
    await client.wait_until_ready()
    channel = client.get_channel(ANNOUNCE_CHANNEL_ID) if ANNOUNCE_CHANNEL_ID else None

    for p in models.list_all_players():
        _last_seen_tiers[p["discord_id"]] = p.get("vanilla_tier")

    while not client.is_closed():
        for p in models.list_all_players():
            old = _last_seen_tiers.get(p["discord_id"])
            new = p.get("vanilla_tier")
            if old != new:
                _last_seen_tiers[p["discord_id"]] = new
                if channel and new:
                    await channel.send(
                        f"🏆 **{p['mc_username']}** 的 Vanilla Tier 更新為 **{new}**!"
                    )
        await discord.utils.sleep_until(discord.utils.utcnow() + __import__("datetime").timedelta(
            seconds=POLL_INTERVAL_SECONDS
        ))


@client.event
async def on_ready():
    await tree.sync()
    client.loop.create_task(poll_tier_changes())
    print(f"已登入為 {client.user}")


def main():
    if not DISCORD_BOT_TOKEN:
        raise SystemExit("請設定環境變數 DISCORD_BOT_TOKEN")
    models.init_db()
    client.run(DISCORD_BOT_TOKEN)


if __name__ == "__main__":
    main()
