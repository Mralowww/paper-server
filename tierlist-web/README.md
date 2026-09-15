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

### 設定第一個管理員

把你自己的 Discord 使用者 ID 填到 `.env` 的 `SEED_ADMIN_DISCORD_ID`,啟動網站後這個帳號登入就會有管理後台權限(`/admin`)。之後可以直接改資料庫 `admins` 表新增其他管理員。

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

```
GET /api/v1/tier/<mc使用者名稱>
Header: X-API-Key: <你的 key>
```

回應範例:

```json
{"username": "Steve", "uuid": "...", "tier": "HT2", "region": "TW", "ranked": true}
```

未上榜的玩家會回傳 `"ranked": false`,`tier` 是 `null`。

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

## 尚未做、之後可以再加強的部分

- 多分類排名(目前只有 Vanilla)
- 地區篩選 UI(資料庫已經有 `region` 欄位)
- 考試單頻道目前用 bot 自己的資料庫做冷卻/紀錄判斷,沒有做「重複開單防呆」以外的排隊機制,考官人力吃緊時可能需要另外加上「排隊中/處理中」狀態
