# Mc.Tierlist.Asia

Minecraft Vanilla PvP Tier 排行榜 + Discord 考試機器人。

- **網站**：首頁、排行榜、玩家卡片、開發者 API 文件；中文／English／Tiếng Việt
- **會員頁**（Discord 登入）：我的資料、考官面板、管理後台，依 Discord 身分組顯示不同內容
- **開發者 API**（`/api/v1`）：需要 API Key
- **Discord 機器人**：考試申請、考試單、`/result`、`/setuptier`、`/setupapply`、`/roleup`

## 啟動

```bash
pip install -r requirements.txt
cp .env.example .env   # 填入設定
python app.py
```

設定了 `DISCORD_BOT_TOKEN` 與 `DISCORD_GUILD_ID` 時，網站與機器人會在同一個程式中執行；否則只啟動網站。資料存在 `data/tierlist.db`。

## Discord 設定

1. Developer Portal → Bot：開啟 **Server Members Intent**
2. OAuth2 → Redirects 加入 `{BASE_URL}/auth/discord/callback`
3. 邀請機器人（權限：管理頻道、管理身分組、發送訊息、嵌入連結），並把機器人身分組拉到所有 Tier 身分組之上
4. 在伺服器使用 `/setuptier <頻道>` 與 `/setupapply <頻道> <類別>`

## 機器人指令

| 指令 | 權限 | 說明 |
| --- | --- | --- |
| `/setuptier <頻道>` | 管理員以上 | 設定考試結果發送頻道 |
| `/setupapply <頻道> <類別>` | 管理員以上 | 放置「申請考試」按鈕並設定考試單類別 |
| `/result` | 考官／高階考官 | 在考試單內登錄結果：選段位 → 輸入比分 → 預覽確認 |
| `/roleup` | 所有人 | 依資料庫恢復身分組；管理身分組需創始人／開發者核准 |

- 考官可給 LT5～LT3，高階考官可給 LT5～HT1
- 目前段位 HT3 以上的申請為高階考試，只有高階考官看得到
- 考試結果發出後開始 7 天冷卻

## 網站權限

| 身分 | 可以看到 |
| --- | --- |
| 訪客 | 排行榜、玩家卡片 |
| 登入成員 | ＋ 我的資料、勝敗場 |
| 考官 | ＋ 考官面板 |
| 小幫手 | ＋ 後台唯讀 |
| Moderator | ＋ 管理玩家、重置冷卻 |
| 管理員 | ＋ API Key、設定 |
| 創始人／開發者 | 全部 |
