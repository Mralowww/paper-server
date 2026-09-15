# Mralow Tiers

類似 mctiers.com 的 Minecraft Vanilla PvP 排名網站。目前包含三個部分:

1. **網站 + 公開 API**(這個資料夾,`app.py`)— Flask,SQLite 儲存資料
2. **Discord Bot**(`discord_bot/bot.py`)— `/tier` 查詢指令 + tier 變動自動公告
3. **遊戲伺服器插件**(`../TierVerify`)— Paper 插件,提供 `/verify <code>` 指令

## 玩家綁定流程

1. 玩家到網站用 Discord 登入(`/login/discord`)
2. 網站產生一組 8 碼驗證碼,顯示在 `/account` 頁面
3. 玩家到 Minecraft 伺服器輸入 `/verify <驗證碼>`
4. `TierVerify` 插件呼叫網站的 `/internal/verify`(帶共用密鑰),核對成功後把 Discord 帳號跟 MC 帳號綁定

## 安裝

```bash
cd tierlist-web
pip install -r requirements.txt
cp .env.example .env   # 填入 Discord OAuth / 密鑰等設定
```

### 建立 Discord OAuth App(網站登入用)

1. 到 https://discord.com/developers/applications 建立一個 Application
2. 左側 OAuth2 > General,複製 Client ID / Client Secret 到 `.env`
3. Redirects 加上 `.env` 裡 `DISCORD_REDIRECT_URI` 的網址(部署後記得改成正式網域)

### 建立 Discord Bot(公告 + `/tier` 指令用)

1. 同一個 Application,左側 Bot > Reset Token,複製到 `.env` 的 `DISCORD_BOT_TOKEN`
2. 用 OAuth2 URL Generator 勾 `bot` + `applications.commands`,邀請進你的伺服器
3. `ANNOUNCE_CHANNEL_ID` 填公告要發到哪個頻道(右鍵頻道 > 複製 ID,需開發者模式)

### 管理員權限

不用另外維護名單。網站的 `/admin` 跟 DC bot 的 `/admin_set_tier`、`/admin_delete_player`、`/setup_apply_panel`,
都是即時檢查這個人在 `.env` 的 `DISCORD_GUILD_ID` 那個伺服器裡有沒有 **Administrator** 權限(伺服器擁有者也算)。
把伺服器 ID 填到 `.env` 就好,之後在 Discord 伺服器設定裡調整身份組權限即可控制誰是管理員。

網站的管理員判斷是在登入當下用 OAuth 的 `guilds` scope 查詢一次,存進 session,所以權限被拿掉後要重新登入才會生效。

## 執行

```bash
# 網站(含公開 API)
python app.py

# Discord bot,另開一個程序
python discord_bot/bot.py
```

## 部署遊戲伺服器插件

1. 在 `../TierVerify` 執行 `./gradlew build`(或你平常 build 其他插件的方式),產出的 jar 放進 `plugins/`
2. 啟動一次伺服器產生 `config.yml`,把 `backend-url` 改成網站的 `/internal/verify` 完整網址(要能從遊戲伺服器連到網站主機),`shared-secret` 要跟網站 `.env` 的 `PLUGIN_SHARED_SECRET` 完全一樣
3. 重啟伺服器,玩家就能用 `/verify <code>` 了

## 公開 API(給 Minecraft mod 用)

需要先在管理後台(`/admin`)建立一組 API Key。

### 查詢單一玩家

```
GET /api/v1/tier/<mc使用者名稱>
Header: X-API-Key: <你的 key>
```

```json
{"username": "Steve", "uuid": "...", "tier": "HT2", "region": "TW", "ranked": true}
```

未上榜的玩家會回傳 `"ranked": false`,`tier` 是 `null`。

### 列出全部排名

```
GET /api/v1/tiers
Header: X-API-Key: <你的 key>
```

```json
[{"username": "Steve", "uuid": "...", "tier": "HT2", "region": "TW"}, ...]
```

### 查詢玩家綁定關係

```
GET /api/v1/player/discord/<discord_id>
GET /api/v1/player/uuid/<mc_uuid>
Header: X-API-Key: <你的 key>
```

```json
{
  "discord_id": "...", "discord_username": "...", "mc_uuid": "...", "mc_username": "Steve",
  "tier": "HT2", "region": "TW", "last_test_at": 1234567890
}
```

找不到會回傳 404 `{"error": "not_found"}`。

### 查詢冷卻狀態

```
GET /api/v1/cooldown/<mc使用者名稱>
Header: X-API-Key: <你的 key>
```

```json
{"username": "Steve", "can_test": false, "remaining_seconds": 2591000, "next_test_type": "advanced"}
```

`next_test_type` 是依照玩家目前段位判斷下一次要考普通(`normal`)還是高階(`advanced`)測試。查無此人一律回傳可以測試。

### 查詢測試紀錄

```
GET /api/v1/tests?username=<可省略>&limit=<可省略,預設 50,最多 200>
Header: X-API-Key: <你的 key>
```

不帶 `username` 會回傳全站最近的測試紀錄;帶了就只回傳該玩家的紀錄。

```json
[{
  "username": "Steve", "uuid": "...", "region": "TW", "game_name": "Sumo",
  "score_wins": 3, "score_losses": 0, "tier_before": null, "tier_after": "HT3",
  "test_type": "normal", "examiner": "examiner#0001", "created_at": 1234567890
}]
```

## 目前排名分類

先只做 **Vanilla** 一個分類,Tier 從高到低為 `HT1 LT1 HT2 LT2 HT3 LT3 HT4 LT4 HT5 LT5`。之後要加其他分類(UHC、Pot、NethOP...)需要擴充 `models.py` 的資料表結構,再加對應的後台/前台頁面。

## 考試系統(測試機器人)

- 玩家在有申請面板的頻道(用 `/setup_apply_panel` 貼出)按「🎫 申請測試」
- 系統自動判斷這次要考 **普通測試**(目前段位是 LT3 以下或未評級,7 天冷卻)還是 **高階測試**(目前段位是 HT3 或更好,30 天冷卻),冷卻中會直接告知還要等多久
- 通過後自動在 `TICKET_CATEGORY_ID` 分類底下建立一個只有申請人 + 考官身份組看得到的私密頻道(考試單),頻道內有「🔒 關閉考試單」按鈕
- 考官在考試單頻道內打 `/result`,跳出表單填寫伺服器地區、遊戲名稱、比分(勝-敗)、取得段位,送出後會:
  - 更新玩家的段位與本次測試時間(影響下次冷卻判定)
  - 在考試單頻道 + `RESULTS_CHANNEL_ID`(若有設定)發布考試結果 Embed,附上玩家的 Minecraft 頭像(crafatar)
  - 寫入資料庫,網站的 `/tests` 頁面會顯示完整測試紀錄(含頭像)

需要的環境變數(`.env.example` 已列出):`EXAMINER_ROLE_ID`(考官身份組)、`TICKET_CATEGORY_ID`(考試單分類頻道)、`RESULTS_CHANNEL_ID`(結果公告頻道,可留空)。

## 管理員直接編輯(需要 Administrator 權限)

- 網站 `/admin`:編輯任何玩家的 MC 帳號 / 地區 / Tier,或整筆刪除
- DC bot `/admin_set_tier <mc帳號> [tier] [region]`:直接設定任何玩家的段位跟地區,tier 留空清除段位
- DC bot `/admin_delete_player <mc帳號>`:刪除某玩家的所有排名資料

這三個都會檢查操作者在 Discord 伺服器裡是否有 Administrator 權限,沒有的話會被拒絕。

## 安全性

- Discord OAuth 登入有 `state` 防 CSRF,登入請求被竄改或重放會直接拒絕
- session cookie 是 `HttpOnly` + `SameSite=Lax`,JS 拿不到也不會被跨站表單濫用
- `/internal/verify` 的共用密鑰用 timing-safe 比對(`hmac.compare_digest`),同一個 IP 連續猜錯 6 次會鎖 5 分鐘
- 所有頁面都有基本的 CSP / `X-Frame-Options: DENY` / `X-Content-Type-Options: nosniff`
- `.env`、`data/`(內含 SQLite 資料庫)都在 `.gitignore` 裡,不會被推上 GitHub

如果之後在網站前面加了反向代理提供 HTTPS,記得把 `.env` 的 `FORCE_SECURE_COOKIES` 設成 `1`,
沒有 HTTPS 的情況下設了會導致 session cookie 完全送不出去、無法登入。

## 尚未做、之後可以再加強的部分

- 多分類排名(目前只有 Vanilla)
- 地區篩選 UI(資料庫已經有 `region` 欄位)
- 考試單頻道目前用 bot 自己的資料庫做冷卻/紀錄判斷,沒有做「重複開單防呆」以外的排隊機制,考官人力吃緊時可能需要另外加上「排隊中/處理中」狀態
