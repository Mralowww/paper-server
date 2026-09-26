# Threads 獎勵計畫

用 Discord 登入、上傳 Threads 貼文連結，系統自動抓取按讚／回覆／轉發數，每週結算前三名並由 Discord 機器人公告。

- 後端：FastAPI + SQLite + discord.py（同一個程序）
- 前端：原生 HTML / CSS / JS，黑金電競風，中英雙語，音效全部即時合成
- 頁面：`/` 主頁、`/links` 我的連結、`/login` 登入、`/admin` 管理後台、`/settings` 設定

## 數據來源

Threads 官方 API 只能讀取授權帳號本人的貼文，所以這裡改讀**公開貼文頁面**（`rewards/scraper.py`）。

- 可取得：按讚、回覆、轉發（含引用）
- 無法取得：**瀏覽數**，需要管理員在後台「連結」分頁手動填寫
- Meta 如果改版頁面，只需調整 `scraper.py` 的解析規則

## 管理員判定

機器人透過 Bot Token 讀取使用者在 `DISCORD_GUILD_ID` 伺服器的身分組，符合下列任一條件就是管理員：
伺服器擁有者、身分組有 **Administrator** 或 **Manage Server** 權限、身分組 ID 在 `ADMIN_ROLE_IDS` 中。

## 設定 Discord

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 建立 Application
2. **OAuth2** → 加入 Redirect：`http://你的網址/auth/callback`（和 `DISCORD_REDIRECT_URI` 完全一致）
3. **Bot** → 取得 Token，用這個網址邀請機器人：
   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot%20applications.commands&permissions=19456`
4. 複製 `.env.example` 為 `.env` 並填入

機器人指令：`/排行榜`、`/我的推廣`

## 執行

```bash
pip install -r requirements.txt
cp .env.example .env   # 填入設定
python app.py          # 埠號讀取 SERVER_PORT / PORT，預設 8000
```

本地測試不接 Discord：在 `.env` 設 `DEV_LOGIN=true`，打開 `/auth/dev-login?admin=1` 即可登入為管理員（正式環境務必關閉）。

## 計分與結算

- 分數 = 按讚×權重 + 回覆×權重 + 轉發×權重 + 瀏覽×權重（後台可調整）
- 週期以後台設定的「結算星期＋小時」為分界（時區 `TIMEZONE`，預設 Asia/Taipei）
- 連結依上傳時間歸屬週期；週期結束後自動結算、存入名人堂並公告
- 數據每 `SCRAPE_INTERVAL_MIN` 分鐘更新一次；使用者可每 10 分鐘手動更新一次
