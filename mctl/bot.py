"""Discord bot: test applications, ticket channels, /result flow and tier-role sync."""
import asyncio
import logging
import re

import aiohttp
import discord
from discord import app_commands

from . import bridge
from . import config as C
from . import db as D
from . import links as L
from . import panel as P

log = logging.getLogger("mctl.bot")

MC_NAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")
TIER_COLORS = {"1": 0xF2C14E, "2": 0xC3C9D6, "3": 0xCD7F32, "4": 0x6B7590, "5": 0x4B5263}
STAFF_ROLES = [C.ROLE_FOUNDER, C.ROLE_DEVELOPER, C.ROLE_ADMIN, C.ROLE_MODERATOR, C.ROLE_HELPER]
REGION_LABEL = dict(C.REGIONS)[C.DEFAULT_REGION]


def access(member):
    return C.access_for(member.id, [r.id for r in getattr(member, "roles", [])])


def tracked_role_ids(member):
    return [r.id for r in member.roles if r.id in C.TRACKED_ROLES]


def rank_name(tier):
    with conn() as c:
        return P.tier_label(P.load_result(c), tier)


APPLY_MODAL_ID = "mctl:apply_modal"


def modal_values(data):
    """custom_id → value for every text input in a modal submit payload."""
    out = {}

    def walk(node):
        if isinstance(node, dict):
            if "custom_id" in node and "value" in node:
                out[node["custom_id"]] = node["value"]
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(data.get("components", []))
    return out


def conn():
    return D.transaction()


def ix_meta(interaction, **extra):
    """Discord interaction details for the audit log."""
    data = interaction.data or {}
    ch = interaction.channel
    return {"discord": {
        "type": interaction.type.name, "command": interaction.command.name if interaction.command else None,
        "customId": data.get("custom_id"), "options": data.get("options"),
        "channelId": str(interaction.channel_id) if interaction.channel_id else None,
        "channelName": getattr(ch, "name", None), "guildId": str(interaction.guild_id) if interaction.guild_id else None,
        "user": {"id": str(interaction.user.id), "tag": str(interaction.user)}, "locale": str(interaction.locale),
        **extra}}


def actor_of(interaction):
    return {"id": str(interaction.user.id), "username": interaction.user.display_name}


# ---------------------------------------------------------------- bot
class TierBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        intents.members = True
        super().__init__(intents=intents, allowed_mentions=discord.AllowedMentions(everyone=False, roles=True, users=True))
        self.tree = app_commands.CommandTree(self)
        self.tree.on_error = self.on_app_command_error
        self.http_session = None

    @property
    def guild(self):
        return self.get_guild(C.GUILD_ID)

    async def setup_hook(self):
        self.http_session = aiohttp.ClientSession(headers={"User-Agent": "Mc.Tierlist.Asia bot"})
        self.add_view(ApplyView())
        self.add_view(CloseView())
        self.add_dynamic_items(ResultTierSelect, ResultButton, RoleupButton)
        guild = discord.Object(id=C.GUILD_ID)
        # Wipe every previously registered command (global and guild), then register ours on the guild.
        self.tree.clear_commands(guild=None)
        await self.tree.sync()
        self.tree.clear_commands(guild=guild)
        for cmd in (cmd_setuptier, cmd_setupapply, cmd_setupsupport, cmd_result, cmd_roleup, cmd_verify):
            self.tree.add_command(cmd, guild=guild)
        synced = await self.tree.sync(guild=guild)
        log.info("Registered %d guild commands: %s", len(synced), ", ".join(c.name for c in synced))

    async def close(self):
        if self.http_session:
            await self.http_session.close()
        await super().close()

    async def on_ready(self):
        log.info("Bot ready as %s", self.user)
        guild = self.guild
        if not guild:
            log.error("Bot is not in guild %s — check DISCORD_GUILD_ID and invite the bot.", C.GUILD_ID)
            return
        await self.sync_member_cache(guild)

    async def sync_member_cache(self, guild):
        if not guild.chunked:
            await guild.chunk()
        with conn() as c:
            rows = c.execute("SELECT discord_id, in_guild FROM members").fetchall()
            known = {r["discord_id"] for r in rows}
            was_gone = {r["discord_id"] for r in rows if not r["in_guild"]}
            linked = {r["discord_id"] for r in c.execute("SELECT discord_id FROM players WHERE discord_id IS NOT NULL")}
            seen = set()
            for m in guild.members:
                roles = tracked_role_ids(m)
                if roles or str(m.id) in known or str(m.id) in linked:
                    # A member who rejoined while the bot was offline keeps their saved snapshot.
                    D.upsert_member(c, m.id, m.display_name, m.avatar.key if m.avatar else None, roles,
                                    save=str(m.id) not in was_gone)
                    seen.add(str(m.id))
            for gone in known - seen:
                c.execute("UPDATE members SET in_guild = 0 WHERE discord_id = ?", (gone,))
        log.info("Member cache synced (%d members)", len(seen))

    async def on_member_update(self, before, after):
        if after.guild.id != C.GUILD_ID:
            return
        if tracked_role_ids(before) != tracked_role_ids(after) or before.display_name != after.display_name:
            with conn() as c:
                D.upsert_member(c, after.id, after.display_name, after.avatar.key if after.avatar else None, tracked_role_ids(after))

    async def on_member_remove(self, member):
        with conn() as c:
            c.execute("UPDATE members SET in_guild = 0 WHERE discord_id = ?", (str(member.id),))

    async def on_member_join(self, member):
        with conn() as c:
            if D.member(c, member.id):
                D.upsert_member(c, member.id, member.display_name, member.avatar.key if member.avatar else None,
                                tracked_role_ids(member), save=False)

    async def on_interaction(self, interaction: discord.Interaction):
        """Modal submits are routed here by custom_id so they keep working across restarts."""
        if interaction.type != discord.InteractionType.modal_submit:
            return
        cid = interaction.data.get("custom_id", "")
        try:
            if cid == APPLY_MODAL_ID:
                await handle_apply(interaction, modal_values(interaction.data).get("mc_name", ""))
            elif m := SCORE_MODAL_RE.fullmatch(cid):
                await handle_score(interaction, int(m["ch"]), m["tier"], modal_values(interaction.data))
        except Exception:
            log.exception("modal %s failed", cid)
            await reply(interaction, "⚠️ 發生錯誤，請稍後再試或聯絡管理員。")

    async def on_guild_channel_delete(self, channel):
        with conn() as c:
            c.execute("UPDATE tickets SET status = 'closed', closed_at = ? WHERE channel_id = ? AND status != 'closed'",
                      (D.now_ms(), str(channel.id)))

    async def on_app_command_error(self, interaction, error):
        if isinstance(error, app_commands.CheckFailure):
            msg = "❌ 你沒有權限使用這個指令。"
        else:
            log.exception("Command failed", exc_info=error)
            msg = "⚠️ 發生錯誤，請稍後再試或聯絡管理員。"
        await reply(interaction, msg)

    async def mojang_profile(self, name):
        """Returns {'id', 'name'} for an existing Java account, None if it doesn't exist. Raises on network errors."""
        async with self.http_session.get(f"https://api.mojang.com/users/profiles/minecraft/{name}",
                                         timeout=aiohttp.ClientTimeout(total=10)) as res:
            if res.status in (204, 404):
                return None
            res.raise_for_status()
            data = await res.json()
            uid = data["id"]
            return {"name": data["name"], "id": f"{uid[:8]}-{uid[8:12]}-{uid[12:16]}-{uid[16:20]}-{uid[20:]}"}


bot = TierBot()


async def reply(interaction, content=None, **kwargs):
    kwargs.setdefault("ephemeral", True)
    if interaction.response.is_done():
        await interaction.followup.send(content, **kwargs)
    else:
        await interaction.response.send_message(content, **kwargs)


async def get_member(guild, user_id):
    m = guild.get_member(int(user_id))
    if m is None:
        try:
            m = await guild.fetch_member(int(user_id))
        except discord.NotFound:
            return None
    return m


async def sync_tier_role(discord_id, tier):
    """Gives the member exactly one tier role. Returns an error message or None."""
    guild = bot.guild
    member = guild and await get_member(guild, discord_id)
    if not member:
        return "找不到該成員，未更新身分組。"
    remove = [r for r in member.roles if r.id in C.ROLE_TIER and r.id != C.TIER_ROLE[tier]]
    target = guild.get_role(C.TIER_ROLE[tier])
    try:
        if remove:
            await member.remove_roles(*remove, reason=f"Tier update → {tier}")
        if target and target not in member.roles:
            await member.add_roles(target, reason=f"Tier update → {tier}")
    except discord.Forbidden:
        return "機器人權限不足，無法更新身分組（請把機器人身分組拉到 Tier 身分組上方）。"
    return None


def result_embed(mc_name, tester_id, prev_tier, new_tier, wins, losses, preview=False):
    """Result embed built from the template edited in the staff settings."""
    with conn() as c:
        tpl = P.load_result(c)
    e = discord.Embed(title=tpl["title"].replace("{player}", mc_name), color=TIER_COLORS[new_tier[2]])
    if preview:
        e.set_author(name="預覽 — 按下「確認發送」後才會發布")
    e.set_thumbnail(url=f"{C.BASE_URL}/heads/body/{mc_name}/128.png")
    e.add_field(name=f"{tpl['tester']}:", value=f"<@{tester_id}>", inline=False)
    e.add_field(name=f"{tpl['region']}:", value=tpl["region_value"], inline=False)
    e.add_field(name=f"{tpl['username']}:", value=mc_name, inline=False)
    e.add_field(name=f"{tpl['previous']}:", value=P.tier_label(tpl, prev_tier), inline=False)
    e.add_field(name=f"{tpl['earned']}:", value=P.tier_label(tpl, new_tier), inline=False)
    e.add_field(name=f"{tpl['wins']}:", value=str(wins), inline=True)
    e.add_field(name=f"{tpl['losses']}:", value=str(losses), inline=True)
    e.set_footer(text=tpl["footer"])
    e.timestamp = discord.utils.utcnow()
    return e


# ---------------------------------------------------------------- setup commands
def is_admin(interaction):
    return access(interaction.user)["level"] >= C.LEVEL_ADMIN


@app_commands.command(name="setuptier", description="設定考試結果要發送到哪個頻道")
@app_commands.describe(channel="考試結果發送頻道")
@app_commands.default_permissions(manage_guild=True)
@app_commands.guild_only()
@app_commands.check(is_admin)
async def cmd_setuptier(interaction: discord.Interaction, channel: discord.TextChannel):
    perms = channel.permissions_for(interaction.guild.me)
    if not (perms.view_channel and perms.send_messages and perms.embed_links):
        return await reply(interaction, f"❌ 機器人在 {channel.mention} 沒有「發送訊息／嵌入連結」權限。")
    with conn() as c:
        D.set_setting(c, "result_channel_id", channel.id)
        D.audit(c, actor_of(interaction), "setup_result_channel", f"#{channel.name}", target=("setting", "result_channel_id", "考試結果頻道"),
                changes={"channel": [None, f"#{channel.name} ({channel.id})"]}, meta=ix_meta(interaction), source="discord")
    await reply(interaction, f"✅ 考試結果將發送到 {channel.mention}")


@app_commands.command(name="setupapply", description="在頻道放置「考試申請」按鈕，並設定考試單建立的類別")
@app_commands.describe(channel="放置申請按鈕的頻道", category="考試單頻道要建立在哪個類別")
@app_commands.default_permissions(manage_guild=True)
@app_commands.guild_only()
@app_commands.check(is_admin)
async def cmd_setupapply(interaction: discord.Interaction, channel: discord.TextChannel, category: discord.CategoryChannel):
    me = interaction.guild.me
    if not category.permissions_for(me).manage_channels:
        return await reply(interaction, f"❌ 機器人在類別「{category.name}」沒有「管理頻道」權限。")
    with conn() as c:
        panel, is_open = P.load(c), P.applications_open(c)
    message = await channel.send(embed=panel_embed(panel, is_open), view=apply_view(panel, is_open))
    with conn() as c:
        D.set_setting(c, "apply_channel_id", channel.id)
        D.set_setting(c, "apply_message_id", message.id)
        D.set_setting(c, "ticket_category_id", category.id)
        D.audit(c, actor_of(interaction), "setup_apply", f"#{channel.name} / {category.name}",
                target=("setting", "apply_channel_id", "考試申請面板"),
                meta=ix_meta(interaction, applyChannel=str(channel.id), messageId=str(message.id), category=str(category.id)),
                source="discord")
    await reply(interaction, f"✅ 已在 {channel.mention} 放置申請按鈕，考試單會建立在「{category.name}」。")


@app_commands.command(name="setupsupport", description="設定網站客服單的通知頻道")
@app_commands.describe(channel="新客服單與回覆的通知頻道")
@app_commands.default_permissions(manage_guild=True)
@app_commands.guild_only()
@app_commands.check(is_admin)
async def cmd_setupsupport(interaction: discord.Interaction, channel: discord.TextChannel):
    perms = channel.permissions_for(interaction.guild.me)
    if not (perms.view_channel and perms.send_messages and perms.embed_links):
        return await reply(interaction, f"❌ 機器人在 {channel.mention} 沒有「發送訊息／嵌入連結」權限。")
    with conn() as c:
        D.set_setting(c, "support_channel_id", channel.id)
        D.audit(c, actor_of(interaction), "setup_support_channel", f"#{channel.name}", target=("setting", "support_channel_id", "客服通知頻道"),
                changes={"channel": [None, f"#{channel.name} ({channel.id})"]}, meta=ix_meta(interaction), source="discord")
    await reply(interaction, f"✅ 網站客服單通知將發送到 {channel.mention}")


# ---------------------------------------------------------------- support notifications
SUPPORT_CATEGORY_LABELS = {"bug": "🐞 問題回報", "appeal": "⚖️ 封禁申訴", "report": "🚩 檢舉", "other": "💬 其他"}


async def _support_channel():
    with conn() as c:
        cid = D.get_setting(c, "support_channel_id")
    return bot.get_channel(int(cid)) if cid else None


async def notify_support_new(tid, user_id, category, title, snippet, url):
    channel = await _support_channel()
    if not channel:
        return
    e = discord.Embed(title=f"🎫 新客服單 #{tid}｜{title}", url=url, color=0xF2C14E, description=snippet)
    e.add_field(name="分類", value=SUPPORT_CATEGORY_LABELS.get(category, category))
    e.add_field(name="開單者", value=f"<@{user_id}>")
    e.set_footer(text="Mc.Tierlist.Asia · 點標題前往後台處理")
    e.timestamp = discord.utils.utcnow()
    try:
        await channel.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as exc:
        log.warning("support notify failed: %s", exc)


async def notify_support_reply(tid, user_id, title, snippet, url):
    channel = await _support_channel()
    if not channel:
        return
    e = discord.Embed(title=f"💬 客服單 #{tid} 有新回覆｜{title}", url=url, color=0x5C9AE6, description=snippet)
    e.add_field(name="回覆者", value=f"<@{user_id}>")
    try:
        await channel.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as exc:
        log.warning("support notify failed: %s", exc)


async def dm_support_update(user_id, tid, title, kind, url):
    """DMs the ticket owner that staff replied to (or closed) their ticket."""
    try:
        user = bot.get_user(int(user_id)) or await bot.fetch_user(int(user_id))
        if kind == "closed":
            e = discord.Embed(title=f"🔒 你的客服單 #{tid} 已關閉", color=0x6B7590,
                              description=f"「{title}」已被管理團隊關閉。\n[前往網站查看]({url})")
        else:
            e = discord.Embed(title=f"📩 你的客服單 #{tid} 有新回覆", color=0xF2C14E,
                              description=f"管理團隊回覆了「{title}」。\n[前往網站查看]({url})")
        e.set_footer(text="Mc.Tierlist.Asia")
        await user.send(embed=e)
    except (discord.Forbidden, discord.NotFound):
        log.info("could not DM %s (DMs closed or user not found)", user_id)
    except discord.HTTPException as exc:
        log.warning("DM failed: %s", exc)


# ---------------------------------------------------------------- applications
def ban_message(ban):
    until = f"<t:{ban['expires_at'] // 1000}:F>" if ban["expires_at"] else "永久"
    return f"⛔ 你已被封禁，無法申請考試。\n原因：{ban['reason']}\n期限：{until}"


def application_block(c, user_id):
    """Why this user can't apply right now, or None."""
    if not P.applications_open(c):
        return "目前暫停考試申請，請留意公告。"
    ban = D.find_active_ban(c, discord_id=user_id)
    if ban:
        return ban_message(ban)
    ticket = c.execute("SELECT channel_id FROM tickets WHERE applicant_id = ? AND status = 'open'", (str(user_id),)).fetchone()
    if ticket:
        return f"❌ 你已經有一張進行中的考試單：<#{ticket['channel_id']}>"
    until = D.cooldown_until(c, user_id)
    if until:
        return f"⏳ 你還在冷卻中，可於 <t:{until // 1000}:F>（<t:{until // 1000}:R>）再次申請。"
    return None


def panel_embed(panel, is_open):
    embed = discord.Embed(title=panel["title"], description=P.render(panel["description"]) or None,
                          color=int(panel["color"].lstrip("#"), 16))
    if panel["rules"]:
        embed.add_field(name=panel["rules_title"] or "\u200b", value=P.render(panel["rules"]), inline=False)
    if panel["types"]:
        embed.add_field(name=panel["types_title"] or "\u200b", value=P.render(panel["types"]), inline=False)
    embed.set_footer(text="Mc.Tierlist.Asia")
    return embed


def apply_view(panel, is_open):
    view = ApplyView()
    button = view.children[0]
    button.label = panel["button"] if is_open else panel["paused_button"]
    button.disabled = not is_open
    button.style = discord.ButtonStyle.success if is_open else discord.ButtonStyle.secondary
    return view


async def refresh_apply_panel():
    """Edits the posted panel to match the saved text and open/paused state. Returns True when updated."""
    with conn() as c:
        panel, is_open = P.load(c), P.applications_open(c)
        channel_id, message_id = D.get_setting(c, "apply_channel_id"), D.get_setting(c, "apply_message_id")
    channel = bot.get_channel(int(channel_id or 0))
    if not channel or not message_id:
        return False
    try:
        message = await channel.fetch_message(int(message_id))
        await message.edit(embed=panel_embed(panel, is_open), view=apply_view(panel, is_open))
        return True
    except discord.NotFound:
        return False


class ApplyView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="申請考試", style=discord.ButtonStyle.success, custom_id="mctl:apply")
    async def apply(self, interaction: discord.Interaction, _button):
        with conn() as c:
            block = application_block(c, interaction.user.id)
            ready = D.get_setting(c, "ticket_category_id")
            link = L.link_for(c, interaction.user.id)
            need_link = L.required(c)
        if block:
            return await reply(interaction, block)
        if not ready:
            return await reply(interaction, "⚠️ 考試系統尚未設定完成，請聯絡管理員。")
        if link:
            await interaction.response.defer(ephemeral=True, thinking=True)
            return await start_ticket(interaction, {"name": link["mc_name"], "id": L.dashed(link["uuid"])})
        if need_link:
            return await reply(interaction, embed=verify_help_embed())
        modal = discord.ui.Modal(title="申請 Vanilla 考試", custom_id=APPLY_MODAL_ID, timeout=600)
        modal.add_item(discord.ui.TextInput(label="Minecraft ID", placeholder="例如：Steve", min_length=3,
                                            max_length=16, custom_id="mc_name"))
        await interaction.response.send_modal(modal)


async def handle_apply(interaction: discord.Interaction, name):
    await interaction.response.defer(ephemeral=True, thinking=True)
    name = name.strip()
    if not MC_NAME_RE.match(name):
        return await reply(interaction, "❌ Minecraft ID 只能包含英文、數字與底線（3–16 字）。")
    try:
        profile = await bot.mojang_profile(name)
    except (aiohttp.ClientError, asyncio.TimeoutError):
        return await reply(interaction, "⚠️ 目前無法連線到 Mojang 驗證帳號，請稍後再試。")
    if not profile:
        return await reply(interaction, f"❌ 找不到 Minecraft 帳號 **{name}**，請確認拼字（需為正版 Java 帳號）。")
    with conn() as c:
        link = L.link_for(c, interaction.user.id)
        need_link = L.required(c)
        owner = L.link_by_uuid(c, profile["id"])
    if link:  # linked after opening the form: always use the verified account
        profile = {"name": link["mc_name"], "id": L.dashed(link["uuid"])}
    elif need_link:
        return await reply(interaction, embed=verify_help_embed())
    elif owner and owner["discord_id"] != str(interaction.user.id):
        return await reply(interaction, f"❌ **{profile['name']}** 已綁定其他 Discord 帳號，如有疑問請聯絡管理員。")
    await start_ticket(interaction, profile)


async def start_ticket(interaction: discord.Interaction, profile):
    """Opens a test ticket for a verified Minecraft profile {'name', 'id'}; the interaction must be deferred."""
    user = interaction.user
    guild = interaction.guild
    with conn() as c:
        block = application_block(c, user.id)
        if block:
            return await reply(interaction, block)
        ban = D.find_active_ban(c, name=profile["name"], uuid=profile["id"])
        if ban:
            return await reply(interaction, ban_message(ban))
        owner = c.execute("SELECT discord_id FROM players WHERE (REPLACE(uuid, '-', '') = ? OR name = ?) "
                          "AND discord_id IS NOT NULL AND discord_id != ?",
                          (profile["id"].replace("-", ""), profile["name"], str(user.id))).fetchone()
        if owner:
            return await reply(interaction, f"❌ **{profile['name']}** 已綁定其他 Discord 帳號，如有疑問請聯絡管理員。")
        category = guild.get_channel(int(D.get_setting(c, "ticket_category_id") or 0))
    if not isinstance(category, discord.CategoryChannel):
        return await reply(interaction, "⚠️ 考試單類別不存在，請管理員重新使用 /setupapply。")

    prev_tier = C.tier_from_roles([r.id for r in user.roles])
    high = prev_tier is not None and C.TIER_ORDER.index(prev_tier) >= C.TIER_ORDER.index(C.HIGH_TEST_FROM)
    allow = discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True,
                                        attach_files=True, embed_links=True)
    overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        user: allow,
        guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, manage_channels=True,
                                              embed_links=True, read_message_history=True),
    }
    tester_roles = [C.ROLE_SENIOR_TESTER] + ([] if high else [C.ROLE_TESTER])
    for rid in tester_roles + STAFF_ROLES:
        role = guild.get_role(rid)
        if role:
            overwrites[role] = allow
    try:
        channel = await guild.create_text_channel(
            f"{'高階' if high else ''}考試-{profile['name']}", category=category, overwrites=overwrites,
            topic=f"{profile['name']} 的 Vanilla {'高階' if high else '普通'}考試 · 申請人 {user} ({user.id})",
            reason=f"Tier test application by {user}")
    except discord.Forbidden:
        return await reply(interaction, "⚠️ 機器人沒有建立頻道的權限，請聯絡管理員。")

    with conn() as c:
        c.execute("INSERT INTO tickets (channel_id, applicant_id, mc_name, uuid, kind, prev_tier, created_at) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?)",
                  (str(channel.id), str(user.id), profile["name"], profile["id"], "high" if high else "normal",
                   prev_tier, D.now_ms()))
        D.upsert_member(c, user.id, user.display_name, user.avatar.key if user.avatar else None, tracked_role_ids(user))
        D.audit(c, {"id": str(user.id), "username": user.display_name}, "ticket_open", f"{profile['name']} ({'high' if high else 'normal'})",
                target=("ticket", channel.id, profile["name"]), source="discord",
                meta=ix_meta(interaction, ticket={"channel": str(channel.id), "uuid": profile["id"], "kind": "high" if high else "normal",
                                                  "prevTier": prev_tier}))

    kind_label = "🟣 高階考試" if high else "🟢 普通考試"
    embed = discord.Embed(
        title=f"{kind_label} · {profile['name']}",
        color=0xA66CE0 if high else 0x3DDC97,
        description=("考官會盡快與你聯繫，請耐心等候並準備好上線。\n"
                     "考官完成考試後請在此頻道使用 **`/result`** 登錄結果。"),
    )
    embed.set_thumbnail(url=f"{C.BASE_URL}/heads/avatar/{profile['name']}/128.png")
    embed.add_field(name="考生", value=user.mention)
    embed.add_field(name="Minecraft ID", value=profile["name"])
    embed.add_field(name="目前段位", value=rank_name(prev_tier))
    embed.add_field(name="負責考官", value=f"<@&{C.ROLE_SENIOR_TESTER}>" if high else f"<@&{C.ROLE_TESTER}> / <@&{C.ROLE_SENIOR_TESTER}>", inline=False)
    embed.set_footer(text="Mc.Tierlist.Asia")
    ping = f"<@&{C.ROLE_SENIOR_TESTER}>" if high else f"<@&{C.ROLE_TESTER}>"
    await channel.send(f"{user.mention} {ping}", embed=embed, view=CloseView())
    await reply(interaction, f"✅ 已驗證 **{profile['name']}**，你的考試單：{channel.mention}")


# ---------------------------------------------------------------- /verify
def verify_help_embed():
    embed = discord.Embed(
        title="請先綁定 Minecraft 帳號",
        color=0xF2C14E,
        description=(f"申請考試前需要先綁定你的正版 Minecraft 帳號：\n\n"
                     f"**1.** 用你的帳號進入伺服器 `{C.SERVER_ADDRESS}`\n"
                     f"**2.** 畫面會顯示 6 位數驗證碼\n"
                     f"**3.** 在這裡使用 `/verify 驗證碼`，或到 {C.BASE_URL}/me 輸入\n\n"
                     "綁定完成後再按一次「申請考試」即可。"))
    embed.set_footer(text="Mc.Tierlist.Asia")
    return embed


@app_commands.command(name="verify", description="輸入伺服器給你的驗證碼，綁定 Minecraft 帳號")
@app_commands.describe(code="進入伺服器時顯示的 6 位數驗證碼")
@app_commands.guild_only()
async def cmd_verify(interaction: discord.Interaction, code: str):
    user = interaction.user
    actor = {"id": str(user.id), "username": user.display_name}
    try:
        with conn() as c:
            link = L.redeem(c, actor, code)
            player = c.execute("SELECT tier FROM players WHERE discord_id = ?", (str(user.id),)).fetchone()
    except L.LinkError as exc:
        return await reply(interaction, f"❌ {exc}")
    embed = discord.Embed(title="綁定成功", color=0x3DDC97,
                          description=f"{user.mention} 已綁定 Minecraft 帳號 **{link['mc_name']}**。\n之後申請考試會自動使用這個帳號。")
    embed.set_thumbnail(url=f"{C.BASE_URL}/heads/avatar/{L.dashed(link['uuid'])}/128.png")
    embed.set_footer(text="Mc.Tierlist.Asia")
    await reply(interaction, embed=embed)
    if player:
        await sync_tier_role(user.id, player["tier"])


# ---------------------------------------------------------------- /result
# Every step keeps its state in the component custom_id and reloads the ticket from the database,
# so the menus keep working after the bot restarts.
class Draft:
    def __init__(self, ticket, tester, prev_tier, allowed):
        self.ticket = ticket
        self.tester = tester
        self.prev_tier = prev_tier
        self.allowed = allowed
        self.new_tier = None

    @property
    def channel_id(self):
        return int(self.ticket["channel_id"])

    def intro_embed(self):
        e = discord.Embed(
            title="登錄考試結果",
            color=0xA66CE0 if self.ticket["kind"] == "high" else 0x3DDC97,
            description="**1. 選擇考後段位** → 2. 輸入比分 → 3. 確認發送",
        )
        e.set_thumbnail(url=f"{C.BASE_URL}/heads/avatar/{self.ticket['mc_name']}/96.png")
        e.add_field(name="考生", value=f"<@{self.ticket['applicant_id']}>")
        e.add_field(name="Minecraft ID", value=self.ticket["mc_name"])
        e.add_field(name="目前段位", value=rank_name(self.prev_tier))
        e.add_field(name="可選段位", value=f"{self.allowed[0]} ～ {self.allowed[-1]}", inline=False)
        return e


def can_test(user, ticket):
    acc = access(user)
    if acc["level"] >= C.LEVEL_ADMIN or acc["seniorTester"]:
        return True, C.TIER_ORDER
    if acc["tester"]:
        if ticket["kind"] == "high":
            return False, None
        return True, C.TIER_ORDER[:C.TIER_ORDER.index(C.TESTER_MAX_TIER) + 1]
    return False, None


async def load_draft(interaction, channel_id):
    """Rebuilds the /result state for this tester and ticket. Returns (draft, error message)."""
    with conn() as c:
        row = c.execute("SELECT * FROM tickets WHERE channel_id = ?", (str(channel_id),)).fetchone()
    if not row:
        return None, "❌ 請在考試單頻道內使用這個指令。"
    ticket = dict(row)
    if ticket["status"] != "open":
        return None, "ℹ️ 這張考試單已經登錄過結果了。"
    ok, allowed = can_test(interaction.user, ticket)
    if not ok:
        return None, ("❌ 高階考試需由高階考官負責。" if access(interaction.user)["tester"] else "❌ 只有考官可以登錄考試結果。")
    if str(interaction.user.id) == ticket["applicant_id"]:
        return None, "❌ 你不能登錄自己的考試結果。"
    applicant = await get_member(interaction.guild, ticket["applicant_id"])
    prev = C.tier_from_roles([r.id for r in applicant.roles]) if applicant else ticket["prev_tier"]
    return Draft(ticket, interaction.user, prev, allowed), None


@app_commands.command(name="result", description="登錄這張考試單的考試結果")
@app_commands.guild_only()
async def cmd_result(interaction: discord.Interaction):
    draft, err = await load_draft(interaction, interaction.channel_id)
    if err:
        return await reply(interaction, err)
    await interaction.response.send_message(embed=draft.intro_embed(), view=tier_view(draft), ephemeral=True)


def tier_view(draft):
    view = discord.ui.View(timeout=600)
    view.add_item(ResultTierSelect(draft.channel_id, draft))
    view.add_item(ResultButton("x", draft.channel_id))
    return view


def confirm_view(channel_id, tier, wins, losses):
    view = discord.ui.View(timeout=600)
    for act in ("ok", "edit", "no"):
        view.add_item(ResultButton(act, channel_id, tier, wins, losses))
    return view


class ResultTierSelect(discord.ui.DynamicItem[discord.ui.Select], template=r"mctl:rt:(?P<ch>\d+)"):
    def __init__(self, channel_id, draft=None):
        if draft:
            options = [discord.SelectOption(label=f"{t} • {rank_name(t)}", value=t, default=(t == draft.new_tier),
                                            description="目前段位" if t == draft.prev_tier else None)
                       for t in reversed(draft.allowed)]
        else:
            options = [discord.SelectOption(label="-", value="-")]
        super().__init__(discord.ui.Select(custom_id=f"mctl:rt:{channel_id}", placeholder="選擇考後段位…", options=options))
        self.channel_id = int(channel_id)

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["ch"])

    async def callback(self, interaction: discord.Interaction):
        draft, err = await load_draft(interaction, self.channel_id)
        if err:
            return await interaction.response.edit_message(content=err, embed=None, view=None)
        tier = interaction.data["values"][0]
        if tier not in draft.allowed:
            return await reply(interaction, "❌ 你不能給予這個段位。")
        await interaction.response.send_modal(score_modal(self.channel_id, tier, draft.ticket["mc_name"]))


def score_modal(channel_id, tier, mc_name, wins=None, losses=None):
    modal = discord.ui.Modal(title=f"比分 · {mc_name} → {tier}"[:45], custom_id=f"mctl:rs:{channel_id}:{tier}", timeout=600)
    modal.add_item(discord.ui.TextInput(label="考生勝場（Wins）", placeholder="例如：3", max_length=2, custom_id="wins",
                                        default=None if wins is None else str(wins)))
    modal.add_item(discord.ui.TextInput(label="考生敗場（Losses）", placeholder="例如：2", max_length=2, custom_id="losses",
                                        default=None if losses is None else str(losses)))
    return modal


SCORE_MODAL_RE = re.compile(r"mctl:rs:(?P<ch>\d+):(?P<tier>[HL]T[1-5])")


async def handle_score(interaction: discord.Interaction, channel_id, tier, values):
    try:
        wins, losses = int(values.get("wins", "")), int(values.get("losses", ""))
        if not (0 <= wins <= 99 and 0 <= losses <= 99):
            raise ValueError
    except ValueError:
        return await reply(interaction, "❌ 比分必須是 0–99 的數字，請重新選擇段位後再輸入一次。")
    draft, err = await load_draft(interaction, channel_id)
    if err:
        return await reply(interaction, err)
    if tier not in draft.allowed:
        return await reply(interaction, "❌ 你不能給予這個段位。")
    embed = result_embed(draft.ticket["mc_name"], interaction.user.id, draft.prev_tier, tier, wins, losses, preview=True)
    await interaction.response.edit_message(content="請確認以下內容，確認後將發送到考試結果頻道：",
                                            embed=embed, view=confirm_view(channel_id, tier, wins, losses))


RESULT_BUTTONS = {
    "ok": ("確認發送", discord.ButtonStyle.success),
    "edit": ("編輯", discord.ButtonStyle.secondary),
    "no": ("取消", discord.ButtonStyle.danger),
    "x": ("取消", discord.ButtonStyle.secondary),
}


class ResultButton(discord.ui.DynamicItem[discord.ui.Button],
                   template=r"mctl:rc:(?P<act>ok|edit|no|x):(?P<ch>\d+)(?::(?P<tier>[HL]T[1-5]):(?P<w>\d{1,2}):(?P<l>\d{1,2}))?"):
    def __init__(self, act, channel_id, tier=None, wins=None, losses=None):
        label, style = RESULT_BUTTONS[act]
        custom_id = f"mctl:rc:{act}:{channel_id}" + (f":{tier}:{wins}:{losses}" if tier else "")
        super().__init__(discord.ui.Button(label=label, style=style, custom_id=custom_id, row=1 if act == "x" else None))
        self.act, self.channel_id, self.tier = act, int(channel_id), tier
        self.wins = None if wins is None else int(wins)
        self.losses = None if losses is None else int(losses)

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["act"], match["ch"], match["tier"], match["w"], match["l"])

    async def callback(self, interaction: discord.Interaction):
        if self.act in ("no", "x"):
            return await interaction.response.edit_message(content="已取消登錄。", embed=None, view=None)
        draft, err = await load_draft(interaction, self.channel_id)
        if err:
            return await interaction.response.edit_message(content=err, embed=None, view=None)
        if self.tier not in draft.allowed:
            return await interaction.response.edit_message(content="❌ 你不能給予這個段位。", embed=None, view=None)
        if self.act == "edit":
            draft.new_tier = self.tier
            return await interaction.response.edit_message(content=None, embed=draft.intro_embed(), view=tier_view(draft))
        await finalize_result(interaction, draft, self.tier, self.wins, self.losses)


async def finalize_result(interaction, draft, tier, wins, losses):
    ticket = draft.ticket
    with conn() as c:
        # Claim the ticket atomically so a double click can't post two results.
        claimed = c.execute("UPDATE tickets SET status = 'tested' WHERE channel_id = ? AND status = 'open'",
                            (ticket["channel_id"],)).rowcount
    if not claimed:
        return await interaction.response.edit_message(content="ℹ️ 這張考試單已經登錄過結果了。", embed=None, view=None)
    await interaction.response.edit_message(content="⏳ 發送中…", embed=None, view=None)

    tester = {"id": str(interaction.user.id), "username": interaction.user.display_name}
    with conn() as c:
        D.record_test(c, applicant_id=ticket["applicant_id"], mc_name=ticket["mc_name"], uuid=ticket["uuid"],
                      tester=tester, prev_tier=draft.prev_tier, new_tier=tier, wins=wins, losses=losses,
                      channel_id=ticket["channel_id"])
        result_channel_id = D.get_setting(c, "result_channel_id")

    notes = []
    role_error = await sync_tier_role(ticket["applicant_id"], tier)
    if role_error:
        notes.append(f"⚠️ {role_error}")

    embed = result_embed(ticket["mc_name"], interaction.user.id, draft.prev_tier, tier, wins, losses)
    mention = f"<@{ticket['applicant_id']}>"
    results = interaction.guild.get_channel(int(result_channel_id or 0))
    if results:
        try:
            await results.send(mention, embed=embed, allowed_mentions=discord.AllowedMentions(users=True, roles=False))
        except discord.Forbidden:
            notes.append(f"⚠️ 無法發送到 {results.mention}（權限不足）。")
    else:
        notes.append("⚠️ 尚未設定考試結果頻道，請管理員使用 /setuptier。")

    await interaction.channel.send(f"{mention} 考試結果已登錄！", embed=embed, view=CloseView(),
                                   allowed_mentions=discord.AllowedMentions(users=True, roles=False))
    await interaction.edit_original_response(content="✅ 考試結果已發送！" + ("\n" + "\n".join(notes) if notes else ""))


# ---------------------------------------------------------------- closing tickets
class CloseView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="關閉此考試單", emoji="🔒", style=discord.ButtonStyle.danger, custom_id="mctl:close")
    async def close(self, interaction: discord.Interaction, _button):
        acc = access(interaction.user)
        if not (acc["tester"] or acc["level"] >= C.LEVEL_HELPER):
            return await reply(interaction, "❌ 只有考官或管理團隊可以關閉考試單。")
        with conn() as c:
            ticket = c.execute("SELECT * FROM tickets WHERE channel_id = ?", (str(interaction.channel_id),)).fetchone()
            if not ticket:
                return await reply(interaction, "❌ 找不到這張考試單的紀錄。")
            c.execute("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE channel_id = ?",
                      (D.now_ms(), str(interaction.user.id), str(interaction.channel_id)))
            D.audit(c, actor_of(interaction), "ticket_close", ticket["mc_name"], target=("ticket", interaction.channel_id, ticket["mc_name"]),
                    changes={"status": [ticket["status"], "closed"]}, meta=ix_meta(interaction), source="discord")
        await interaction.response.send_message(f"🔒 {interaction.user.mention} 關閉了考試單，頻道將在 5 秒後刪除。")
        await asyncio.sleep(5)
        try:
            await interaction.channel.delete(reason=f"Ticket closed by {interaction.user}")
        except discord.HTTPException:
            pass


# ---------------------------------------------------------------- website actions
async def ticket_channel_exists(channel_id):
    channel = bot.get_channel(channel_id)
    if channel:
        return True
    try:
        await bot.fetch_channel(channel_id)
        return True
    except (discord.NotFound, discord.Forbidden):
        return False


async def delete_ticket_channel(channel_id, actor_name):
    channel = bot.get_channel(channel_id)
    if channel:
        try:
            await channel.delete(reason=f"Ticket closed from website by {actor_name}")
        except discord.HTTPException as exc:
            log.warning("could not delete ticket channel %s: %s", channel_id, exc)
    return True


async def apply_ticket_kind(channel_id, kind):
    """Normal tickets are visible to testers; high tickets only to senior testers."""
    channel = bot.get_channel(channel_id)
    if not channel:
        return False
    tester = channel.guild.get_role(C.ROLE_TESTER)
    if tester:
        if kind == "high":
            await channel.set_permissions(tester, overwrite=None, reason="Ticket set to high test")
        else:
            await channel.set_permissions(tester, view_channel=True, send_messages=True, read_message_history=True,
                                          attach_files=True, embed_links=True, reason="Ticket set to normal test")
    name = channel.name.removeprefix("高階")
    await channel.edit(name=f"高階{name}" if kind == "high" else name)
    return True


async def publish_result(discord_id, mc_name, tester_id, prev_tier, tier, wins, losses):
    """Role sync + result embed for a result given from the website. Returns a list of warnings."""
    notes = []
    if discord_id:
        err = await sync_tier_role(discord_id, tier)
        if err:
            notes.append(err)
    with conn() as c:
        result_channel_id = D.get_setting(c, "result_channel_id")
    channel = bot.get_channel(int(result_channel_id or 0))
    if not channel:
        notes.append("尚未設定考試結果頻道（/setuptier）。")
        return notes
    embed = result_embed(mc_name, tester_id, prev_tier, tier, wins, losses)
    try:
        await channel.send(f"<@{discord_id}>" if discord_id else None, embed=embed,
                           allowed_mentions=discord.AllowedMentions(users=True, roles=False))
    except discord.HTTPException:
        notes.append("無法發送到考試結果頻道（權限不足）。")
    return notes


# ---------------------------------------------------------------- /roleup
STAFF_GATED_ROLES = set(C.ROLE_LEVEL) | {C.ROLE_TESTER, C.ROLE_SENIOR_TESTER}


def can_approve_staff(member):
    ids = {r.id for r in member.roles}
    return C.ROLE_FOUNDER in ids or C.ROLE_DEVELOPER in ids or str(member.id) in C.OWNER_IDS


def assignable(guild, role_id):
    role = guild.get_role(int(role_id))
    if not role or role.managed or role >= guild.me.top_role:
        return None
    return role


@app_commands.command(name="roleup", description="依資料庫紀錄恢復你的身分組")
@app_commands.guild_only()
async def cmd_roleup(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True, thinking=True)
    user, guild = interaction.user, interaction.guild
    with conn() as c:
        record = D.member(c, user.id)
        player = c.execute("SELECT tier FROM players WHERE discord_id = ?", (str(user.id),)).fetchone()
    saved = {int(r) for r in (record["saved_roles"] if record else [])} & C.TRACKED_ROLES
    tier = player["tier"] if player else C.tier_from_roles(saved)
    if not saved and not tier:
        return await reply(interaction, "ℹ️ 資料庫中沒有你的身分組紀錄。")

    wanted = {r for r in saved if r not in C.ROLE_TIER}
    have = {r.id for r in user.roles}
    applied, skipped = [], []
    if tier and C.TIER_ROLE[tier] not in have:
        err = await sync_tier_role(user.id, tier)
        (skipped if err else applied).append(f"<@&{C.TIER_ROLE[tier]}>")
    normal = [assignable(guild, r) for r in wanted - STAFF_GATED_ROLES if r not in have]
    normal = [r for r in normal if r]
    if normal:
        try:
            await user.add_roles(*normal, reason="/roleup restore")
            applied += [r.mention for r in normal]
        except discord.Forbidden:
            skipped += [r.mention for r in normal]
    staff = [r for r in (assignable(guild, x) for x in wanted & STAFF_GATED_ROLES if x not in have) if r]

    lines = []
    if applied:
        lines.append("✅ 已恢復：" + " ".join(applied))
    if skipped:
        lines.append("⚠️ 無法套用（機器人權限不足）：" + " ".join(skipped))
    if staff:
        embed = discord.Embed(
            title="🛡️ 管理身分組恢復申請", color=0xF2C14E,
            description=f"{user.mention} 申請依資料庫紀錄恢復以下管理身分組：\n" + "\n".join(f"• {r.mention}" for r in staff))
        embed.set_footer(text="僅限創始人／開發者核准")
        await interaction.channel.send(embed=embed, view=staff_approve_view(user.id, [r.id for r in staff]),
                                       allowed_mentions=discord.AllowedMentions.none())
        lines.append("🛡️ 管理身分組需由創始人／開發者核准，已送出申請。")
    if not lines:
        lines.append("👍 你已經擁有所有紀錄中的身分組。")
    with conn() as c:
        D.audit(c, {"id": str(user.id), "username": user.display_name}, "roleup",
                f"applied {len(applied)}, pending staff {len(staff)}", target=("member", user.id, user.display_name), source="discord",
                meta=ix_meta(interaction, applied=[getattr(r, "name", str(r)) for r in applied],
                             pendingStaff=[getattr(r, "name", str(r)) for r in staff]))
    await reply(interaction, "\n".join(lines))


STAFF_ROLE_ORDER = sorted(STAFF_GATED_ROLES)


def staff_approve_view(target_id, role_ids):
    mask = sum(1 << STAFF_ROLE_ORDER.index(r) for r in role_ids if r in STAFF_ROLE_ORDER)
    view = discord.ui.View(timeout=600)
    view.add_item(RoleupButton("y", target_id, mask))
    view.add_item(RoleupButton("n", target_id, mask))
    return view


class RoleupButton(discord.ui.DynamicItem[discord.ui.Button], template=r"mctl:ra:(?P<act>y|n):(?P<uid>\d+):(?P<mask>\d+)"):
    def __init__(self, act, target_id, mask):
        approve = act == "y"
        super().__init__(discord.ui.Button(label="核准套用" if approve else "拒絕",
                                           style=discord.ButtonStyle.success if approve else discord.ButtonStyle.danger,
                                           custom_id=f"mctl:ra:{act}:{target_id}:{mask}"))
        self.act, self.target_id, self.mask = act, int(target_id), int(mask)

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["act"], match["uid"], match["mask"])

    async def finish(self, interaction, text, color):
        embed = interaction.message.embeds[0]
        embed.color = color
        embed.add_field(name="結果", value=text, inline=False)
        await interaction.response.edit_message(embed=embed, view=None)

    async def callback(self, interaction: discord.Interaction):
        if not can_approve_staff(interaction.user):
            return await reply(interaction, "❌ 只有創始人或開發者可以核准。")
        actor = {"id": str(interaction.user.id), "username": interaction.user.display_name}
        if self.act == "n":
            with conn() as c:
                m = D.member(c, self.target_id)
                D.audit(c, actor, "roleup_deny", str(self.target_id), target=("member", self.target_id, m and m["username"]),
                        meta=ix_meta(interaction), source="discord")
            return await self.finish(interaction, f"已由 {interaction.user.mention} 拒絕。", 0xFF5A5F)
        member = await get_member(interaction.guild, self.target_id)
        if not member:
            return await self.finish(interaction, "該成員已不在伺服器。", 0x6B7590)
        role_ids = [r for i, r in enumerate(STAFF_ROLE_ORDER) if self.mask >> i & 1]
        roles = [r for r in (assignable(interaction.guild, x) for x in role_ids) if r]
        try:
            await member.add_roles(*roles, reason=f"/roleup approved by {interaction.user}")
        except discord.Forbidden:
            return await self.finish(interaction, "機器人權限不足，無法套用。", 0xFF5A5F)
        with conn() as c:
            D.audit(c, actor, "roleup_approve", f"{member.display_name}: {', '.join(r.name for r in roles)}",
                    target=("member", member.id, member.display_name), source="discord",
                    meta=ix_meta(interaction, roles=[{"id": str(r.id), "name": r.name} for r in roles]))
        await self.finish(interaction, f"已由 {interaction.user.mention} 核准並套用。", 0x3DDC97)


# ---------------------------------------------------------------- web helpers
async def member_profile(discord_id):
    """Live Discord details for the staff panel, or None when the user is not in the guild."""
    guild = bot.guild
    member = guild and await get_member(guild, discord_id)
    if not member:
        return None
    roles = sorted((r for r in member.roles if not r.is_default()), key=lambda r: r.position, reverse=True)
    return {
        "displayName": member.display_name, "username": str(member), "nick": member.nick,
        "joinedAt": int(member.joined_at.timestamp() * 1000) if member.joined_at else None,
        "boostingSince": int(member.premium_since.timestamp() * 1000) if member.premium_since else None,
        "bot": member.bot,
        "roles": [{"id": str(r.id), "name": r.name, "color": f"#{r.color.value:06x}" if r.color.value else None,
                   "managed": r.managed} for r in roles],
    }


# ---------------------------------------------------------------- entry
def run():
    if not (C.DISCORD_BOT_TOKEN and C.GUILD_ID):
        print("[bot] DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set — bot disabled.")
        return False
    bridge.bot = bot
    if logging.getLogger().handlers:
        logging.getLogger().setLevel(logging.INFO)
    else:
        discord.utils.setup_logging(level=logging.INFO)
    bot.run(C.DISCORD_BOT_TOKEN, log_handler=None)
    return True

