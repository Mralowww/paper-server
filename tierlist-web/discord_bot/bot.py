"""
Mralow Tiers 的 Discord bot。

功能:
- /tier <mc帳號>       查詢某玩家目前的 Vanilla Tier
- /setup_apply_panel   (管理員) 在目前頻道貼出「申請測試」按鈕面板
- 玩家按「申請測試」    依冷卻時間 + 目前段位自動判斷普通/高階測試,建立私密考試單頻道
- /result              (考官身份組) 在考試單頻道內開啟表單,填寫並發布考試結果
- Tier 變動自動公告到指定頻道
"""

import asyncio
import datetime
import os
import sys
from pathlib import Path

import discord
from discord import app_commands

sys.path.append(str(Path(__file__).resolve().parent.parent))
import models  # noqa: E402

DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
ANNOUNCE_CHANNEL_ID = int(os.environ.get("ANNOUNCE_CHANNEL_ID", "0") or "0")
RESULTS_CHANNEL_ID = int(os.environ.get("RESULTS_CHANNEL_ID", "0") or "0")
TICKET_CATEGORY_ID = int(os.environ.get("TICKET_CATEGORY_ID", "0") or "0")
EXAMINER_ROLE_ID = int(os.environ.get("EXAMINER_ROLE_ID", "0") or "0")
POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "60"))

TEST_TYPE_LABEL = {models.TEST_TYPE_NORMAL: "普通測試", models.TEST_TYPE_ADVANCED: "高階測試"}

APPLY_BUTTON_ID = "tierlist:apply_test"
CLOSE_BUTTON_ID = "tierlist:close_ticket"

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

_last_seen_tiers: dict[str, str | None] = {}


def mc_avatar_url(mc_uuid: str | None) -> str | None:
    if not mc_uuid:
        return None
    return f"https://crafatar.com/avatars/{mc_uuid}?size=128&overlay"


def namemc_url(mc_username: str | None) -> str | None:
    if not mc_username:
        return None
    return f"https://namemc.com/profile/{mc_username}"


def format_remaining(seconds: int) -> str:
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days > 0:
        return f"{days} 天 {hours} 小時"
    if hours > 0:
        return f"{hours} 小時 {minutes} 分鐘"
    return f"{max(minutes, 1)} 分鐘"


def is_examiner(member: discord.Member) -> bool:
    if EXAMINER_ROLE_ID == 0:
        return False
    return any(r.id == EXAMINER_ROLE_ID for r in member.roles)


class ApplyView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="🎫 申請測試", style=discord.ButtonStyle.blurple, custom_id=APPLY_BUTTON_ID)
    async def apply(self, interaction: discord.Interaction, button: discord.ui.Button):
        player = models.get_player_by_discord_id(str(interaction.user.id))
        if not player or not player.get("mc_uuid"):
            await interaction.response.send_message(
                "你還沒有在網站綁定 Minecraft 帳號,請先到網站用 Discord 登入並完成 `/verify` 綁定。",
                ephemeral=True,
            )
            return

        existing = models.get_open_ticket_by_discord_id(str(interaction.user.id))
        if existing:
            await interaction.response.send_message(
                f"你已經有一個進行中的考試單:<#{existing['channel_id']}>", ephemeral=True
            )
            return

        can_test, remaining, test_type = models.check_test_cooldown(str(interaction.user.id))
        if not can_test:
            await interaction.response.send_message(
                f"你目前是 **{TEST_TYPE_LABEL[test_type]}** 冷卻中,還需要等 **{format_remaining(remaining)}** 才能再次申請。",
                ephemeral=True,
            )
            return

        if TICKET_CATEGORY_ID == 0:
            await interaction.response.send_message("考試單分類頻道尚未設定,請聯絡管理員。", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        guild = interaction.guild
        category = guild.get_channel(TICKET_CATEGORY_ID)
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True),
            guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True),
        }
        examiner_role = guild.get_role(EXAMINER_ROLE_ID) if EXAMINER_ROLE_ID else None
        if examiner_role:
            overwrites[examiner_role] = discord.PermissionOverwrite(view_channel=True, send_messages=True)

        channel_name = f"test-{player['mc_username'].lower()}"
        channel = await guild.create_text_channel(
            channel_name, category=category, overwrites=overwrites
        )

        models.create_ticket(
            str(channel.id), str(interaction.user.id), str(interaction.user),
            player.get("mc_uuid"), player.get("mc_username"), test_type,
        )

        embed = discord.Embed(
            title="考試單",
            description=(
                f"申請人:{interaction.user.mention}\n"
                f"Minecraft 帳號:**{player['mc_username']}**\n"
                f"測試類型:**{TEST_TYPE_LABEL[test_type]}**\n"
                f"目前段位:**{models.tier_display_name(player.get('vanilla_tier'))}**\n\n"
                + (f"{examiner_role.mention} 請安排時間進行測試。" if examiner_role else "請考官安排時間進行測試。")
            ),
            color=discord.Color.blurple(),
        )
        avatar = mc_avatar_url(player.get("mc_uuid"))
        if avatar:
            embed.set_thumbnail(url=avatar)

        await channel.send(embed=embed, view=CloseView())
        await interaction.followup.send(f"考試單已建立:{channel.mention}", ephemeral=True)


class CloseView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="🔒 關閉考試單", style=discord.ButtonStyle.red, custom_id=CLOSE_BUTTON_ID)
    async def close(self, interaction: discord.Interaction, button: discord.ui.Button):
        ticket = models.get_open_ticket_by_channel(str(interaction.channel.id))
        if not ticket:
            await interaction.response.send_message("這個考試單已經關閉了。", ephemeral=True)
            return

        member = interaction.user
        allowed = str(member.id) == ticket["discord_id"] or (
            isinstance(member, discord.Member) and is_examiner(member)
        )
        if not allowed:
            await interaction.response.send_message("你沒有權限關閉這個考試單。", ephemeral=True)
            return

        models.close_ticket(str(interaction.channel.id))
        await interaction.response.send_message("考試單已關閉,這個頻道 10 秒後會自動刪除。")
        await asyncio.sleep(10)
        try:
            await interaction.channel.delete()
        except discord.HTTPException:
            pass


class ResultModal(discord.ui.Modal, title="發布考試結果"):
    region = discord.ui.TextInput(label="伺服器地區", placeholder="例如 TW", required=True, max_length=32)
    game_name = discord.ui.TextInput(label="遊戲名稱 / 測試項目", placeholder="例如 Sumo / Battle", required=True, max_length=64)
    score = discord.ui.TextInput(label="比分紀錄 (勝-敗)", placeholder="例如 3-0", required=True, max_length=16)
    tier_after = discord.ui.TextInput(
        label=f"取得段位 ({'/'.join(models.TIERS)})", placeholder="例如 HT3", required=True, max_length=8
    )

    def __init__(self, ticket: dict, examiner: discord.Member):
        super().__init__()
        self.ticket = ticket
        self.examiner = examiner

    async def on_submit(self, interaction: discord.Interaction):
        tier_value = self.tier_after.value.strip().upper()
        if tier_value not in models.TIERS:
            await interaction.response.send_message(
                f"段位格式錯誤,必須是這些其中之一:{', '.join(models.TIERS)}", ephemeral=True
            )
            return

        try:
            wins_str, losses_str = self.score.value.strip().split("-", 1)
            wins, losses = int(wins_str.strip()), int(losses_str.strip())
        except ValueError:
            await interaction.response.send_message("比分格式錯誤,請用「勝-敗」,例如 3-0", ephemeral=True)
            return

        applicant_id = self.ticket["discord_id"]
        player_before = models.get_player_by_discord_id(applicant_id)
        tier_before = player_before.get("vanilla_tier") if player_before else None

        models.record_test_result(
            ticket_id=self.ticket["id"],
            discord_id=applicant_id,
            mc_uuid=self.ticket.get("mc_uuid"),
            mc_username=self.ticket.get("mc_username") or "unknown",
            examiner_discord_id=str(self.examiner.id),
            examiner_username=str(self.examiner),
            region=self.region.value.strip(),
            game_name=self.game_name.value.strip(),
            score_wins=wins,
            score_losses=losses,
            tier_before=tier_before,
            tier_after=tier_value,
            test_type=self.ticket["test_type"],
        )

        applicant_name = self.ticket.get("discord_username") or applicant_id
        embed = discord.Embed(
            title=f"{applicant_name} 的考試結果",
            url=namemc_url(self.ticket.get("mc_username")),
            color=discord.Color.green(),
        )
        embed.add_field(name="考官", value=self.examiner.mention, inline=False)
        embed.add_field(name="伺服器地區", value=self.region.value.strip(), inline=False)
        embed.add_field(name="遊戲名稱", value=self.game_name.value.strip(), inline=False)
        embed.add_field(name="比分紀錄", value=f"{wins} 勝 - {losses} 敗", inline=False)
        embed.add_field(name="考前段位", value=models.tier_display_name(tier_before), inline=False)
        embed.add_field(name="取得段位", value=models.tier_display_name(tier_value), inline=False)
        avatar = mc_avatar_url(self.ticket.get("mc_uuid"))
        if avatar:
            embed.set_thumbnail(url=avatar)

        await interaction.response.send_message(embed=embed)

        if RESULTS_CHANNEL_ID:
            results_channel = interaction.guild.get_channel(RESULTS_CHANNEL_ID)
            if results_channel:
                await results_channel.send(embed=embed)


@tree.command(name="setup_apply_panel", description="[管理員] 在目前頻道貼出申請測試面板")
@app_commands.checks.has_permissions(administrator=True)
async def setup_apply_panel(interaction: discord.Interaction):
    embed = discord.Embed(
        title="Vanilla PvP 測試申請",
        description="點下方按鈕申請測試。系統會依照你目前的段位自動判斷這次是普通測試(7 天冷卻)還是高階測試(30 天冷卻)。",
        color=discord.Color.blurple(),
    )
    await interaction.channel.send(embed=embed, view=ApplyView())
    await interaction.response.send_message("面板已發佈。", ephemeral=True)


@tree.command(name="result", description="[考官] 在考試單頻道內發布考試結果")
async def result_command(interaction: discord.Interaction):
    if not isinstance(interaction.user, discord.Member) or not is_examiner(interaction.user):
        await interaction.response.send_message("只有考官身份組可以使用這個指令。", ephemeral=True)
        return

    ticket = models.get_open_ticket_by_channel(str(interaction.channel.id))
    if not ticket:
        await interaction.response.send_message("請在一個進行中的考試單頻道內使用這個指令。", ephemeral=True)
        return

    await interaction.response.send_modal(ResultModal(ticket, interaction.user))


@tree.command(name="admin_set_tier", description="[管理員] 直接設定任何玩家的 Tier / 地區")
@app_commands.describe(mc_username="Minecraft 帳號", tier=f"新的段位({'/'.join(models.TIERS)}),留空表示清除段位",
                        region="地區,留空表示不變更")
@app_commands.checks.has_permissions(administrator=True)
async def admin_set_tier(interaction: discord.Interaction, mc_username: str, tier: str = "", region: str = ""):
    tier_value = tier.strip().upper() or None
    if tier_value and tier_value not in models.TIERS:
        await interaction.response.send_message(
            f"段位格式錯誤,必須是這些其中之一:{', '.join(models.TIERS)}", ephemeral=True
        )
        return

    player = models.get_player_by_mc_username(mc_username)
    if not player:
        await interaction.response.send_message(f"找不到已綁定 `{mc_username}` 的玩家。", ephemeral=True)
        return

    models.set_tier(mc_username, tier_value, region.strip() or None)
    await interaction.response.send_message(
        f"已更新 **{player['mc_username']}**:段位 → {models.tier_display_name(tier_value)}"
        + (f",地區 → {region.strip()}" if region.strip() else "")
    )


@tree.command(name="admin_delete_player", description="[管理員] 刪除某個玩家的所有排名資料")
@app_commands.describe(mc_username="Minecraft 帳號")
@app_commands.checks.has_permissions(administrator=True)
async def admin_delete_player(interaction: discord.Interaction, mc_username: str):
    player = models.get_player_by_mc_username(mc_username)
    if not player:
        await interaction.response.send_message(f"找不到已綁定 `{mc_username}` 的玩家。", ephemeral=True)
        return

    models.delete_player(player["id"])
    await interaction.response.send_message(f"已刪除 **{player['mc_username']}** 的所有排名資料。")


@tree.command(name="tier", description="查詢某位玩家目前的 Vanilla Tier")
@app_commands.describe(username="Minecraft 帳號")
async def tier_command(interaction: discord.Interaction, username: str):
    player = models.get_player_by_mc_username(username)
    if not player or not player.get("vanilla_tier"):
        await interaction.response.send_message(f"找不到 `{username}` 的排名資料。")
        return

    embed = discord.Embed(
        title=player["mc_username"],
        url=namemc_url(player["mc_username"]),
        description=f"目前段位:**{models.tier_display_name(player['vanilla_tier'])}**"
        + (f"\n地區:{player['region']}" if player.get("region") else ""),
        color=discord.Color.blurple(),
    )
    avatar = mc_avatar_url(player.get("mc_uuid"))
    if avatar:
        embed.set_thumbnail(url=avatar)
    await interaction.response.send_message(embed=embed)


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
                        f"🏆 **{p['mc_username']}** 的 Vanilla Tier 更新為 **{models.tier_display_name(new)}**!"
                    )
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


@tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError):
    if isinstance(error, app_commands.MissingPermissions):
        message = "只有 Administrator 權限的人可以使用這個指令。"
    else:
        message = f"發生錯誤:{error}"

    if interaction.response.is_done():
        await interaction.followup.send(message, ephemeral=True)
    else:
        await interaction.response.send_message(message, ephemeral=True)


@client.event
async def on_ready():
    client.add_view(ApplyView())
    client.add_view(CloseView())
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
