# TierVerify

Paper 插件(Minecraft 1.21.1),給 [Mralow Tiers](../tierlist-web) 網站用的伺服器端插件。

已經實際編譯成功過(Gradle 8.14.3),沒有 `gradlew` wrapper,直接用系統的 Gradle:

```bash
gradle build
```

建置產物在 `build/libs/TierVerify-1.0.0.jar`,丟進伺服器的 `plugins/` 資料夾。

## 功能

1. **`/verify <code>`**:玩家在網站用 Discord 登入拿到驗證碼後,進遊戲打這個指令,插件會呼叫網站的
   `/internal/verify` 核對,核對成功就把這個 MC 帳號跟 Discord 帳號綁定
2. **模組清單回報**:接收 [TierBadge](../TierBadge) 模組透過插件頻道 `tierbadge:modlist` 送來的已安裝模組清單,
   轉送到網站的 `/internal/modlist` 存起來(給管理後台查詢用)

## 設定

第一次啟動會在 `plugins/TierVerify/config.yml` 產生設定檔:

```yaml
backend-base-url: "http://127.0.0.1:8787"
shared-secret: "CHANGE_ME_TO_A_LONG_RANDOM_SECRET"
timeout-seconds: 5
```

- `backend-base-url`:網站(tierlist-web)的網址根目錄,不要加結尾斜線,插件會自己組出
  `/internal/verify`、`/internal/modlist` 這兩個端點
- `shared-secret`:必須跟網站 `.env` 裡的 `PLUGIN_SHARED_SECRET` 完全一致,用來確認請求真的是從
  這台遊戲伺服器發出的
- `timeout-seconds`:呼叫網站 API 的逾時秒數

改完設定檔要重啟伺服器才會生效。
