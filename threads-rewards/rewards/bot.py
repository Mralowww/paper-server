"""Discord 機器人：公告每週前三名，並提供 /排行榜 與 /我的推廣 指令。"""
import logging

import discord
from discord import app_commands

from . import config, db, tasks

log = logging.getLogger("rewards.bot")
GOLD = 0xF5C542
MEDALS = ["🥇", "🥈", "🥉"]


class RewardsBot(discord.Client):
    def __init__(self) -> None:
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        register(self.tree)
        if config.DISCORD_GUILD_ID:
            guild = discord.Object(id=int(config.DISCORD_GUILD_ID))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        tasks.announce_hook = self.announce

    async def on_ready(self) -> None:
        log.info("機器人已登入：%s", self.user)
        await self.change_presence(activity=discord.Activity(
            type=discord.ActivityType.watching, name="Threads 推廣排行"))

    async def announce(self, start, end, winners: list[dict]) -> None:
        if not config.ANNOUNCE_CHANNEL_ID:
            return
        channel = self.get_channel(int(config.ANNOUNCE_CHANNEL_ID)) or \
            await self.fetch_channel(int(config.ANNOUNCE_CHANNEL_ID))
        s = db.settings()
        tz = config.TIMEZONE
        embed = discord.Embed(
            title="🏆 本週 Threads 推廣前三名",
            description=f"統計期間：{start.astimezone(tz):%m/%d %H:%M} – {end.astimezone(tz):%m/%d %H:%M}",
            color=GOLD,
        )
        for i, w in enumerate(winners):
            reward = s.get(f"reward_{i + 1}") or ""
            embed.add_field(
                name=f"{MEDALS[i]} 第 {i + 1} 名",
                value=(f"<@{w['id']}>\n分數 **{w['score']:,.0f}** · {w['link_count']} 則連結\n"
                       f"❤️ {w['likes']:,} · 💬 {w['replies']:,} · 🔁 {w['reposts']:,} · 👁 {w['views']:,}"
                       + (f"\n🎁 {reward}" if reward else "")),
                inline=False,
            )
        await channel.send(embed=embed)


def board_embed(title: str, rows: list[dict]) -> discord.Embed:
    embed = discord.Embed(title=title, color=GOLD)
    if not rows:
        embed.description = "本週還沒有人上傳連結，快來搶第一！"
        return embed
    lines = []
    for i, r in enumerate(rows):
        prefix = MEDALS[i] if i < 3 else f"`#{i + 1}`"
        lines.append(f"{prefix} <@{r['id']}> — **{r['score']:,.0f}** 分（{r['link_count']} 則）")
    embed.description = "\n".join(lines)
    return embed


def register(tree: app_commands.CommandTree) -> None:
    @tree.command(name="排行榜", description="查看本週 Threads 推廣排行榜")
    async def leaderboard(interaction: discord.Interaction) -> None:
        start, end = db.period_bounds()
        rows = db.leaderboard(start, end, limit=10)
        await interaction.response.send_message(embed=board_embed("📊 本週推廣排行榜", rows))

    @tree.command(name="我的推廣", description="查看自己本週的推廣數據")
    async def mine(interaction: discord.Interaction) -> None:
        start, end = db.period_bounds()
        rows = db.leaderboard(start, end, limit=1000)
        uid = str(interaction.user.id)
        rank = next((i for i, r in enumerate(rows) if r["id"] == uid), None)
        if rank is None:
            await interaction.response.send_message("你本週還沒有上傳任何連結。", ephemeral=True)
            return
        r = rows[rank]
        await interaction.response.send_message(
            f"目前第 **{rank + 1}** 名，分數 **{r['score']:,.0f}**（{r['link_count']} 則連結）", ephemeral=True)


bot = RewardsBot()


async def start() -> None:
    if not config.DISCORD_BOT_TOKEN:
        log.warning("未設定 DISCORD_BOT_TOKEN，機器人不啟動")
        return
    await bot.start(config.DISCORD_BOT_TOKEN)
