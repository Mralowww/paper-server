# TierBadge

Fabric 客戶端模組(Minecraft 1.21.x),在遊戲裡玩家名稱旁邊(頭頂名牌、Tab 名單等)自動加上
[Mralow Tiers](../tierlist-web) 網站上的段位標記,例如 `Steve [HT3]`。

只讀資料,不會改動遊戲行為,也不需要伺服器端安裝什麼東西(跟 `../TierVerify` 那個伺服器插件是兩回事)。

## 運作方式

1. 進遊戲後背景執行緒每隔一段時間(預設 60 秒)呼叫網站的 `GET /api/v1/tiers`,把全部已評級玩家的段位抓回來存進記憶體
2. Mixin 攔截 `PlayerEntity#getDisplayName()`,如果快取裡有這個玩家的段位,就在名字後面加上彩色的 `[HT3]` 這種標記
3. 因為 `getDisplayName()` 是遊戲裡大部分「顯示玩家名稱」的地方共用的方法,所以名牌、Tab 名單通常都會一起顯示,不用每個地方個別修改

## 設定

第一次啟動遊戲後,`config/tierbadge.json` 會自動產生:

```json
{
  "baseUrl": "http://localhost:8787",
  "apiKey": "",
  "refreshIntervalSeconds": 60,
  "badgeColor": "#7c8cff"
}
```

- `baseUrl`:改成 Mralow Tiers 網站的網址(例如 `http://mralow.sytes.net:8787`)
- `apiKey`:到網站管理後台(`/admin`)申請一組 API Key 填進來
- `refreshIntervalSeconds`:多久跟網站同步一次段位資料,最低 10 秒
- `sendModList`:進伺服器時要不要把目前安裝的所有 Fabric 模組清單,透過插件頻道
  `tierbadge:modlist` 回報給伺服器端的 `TierVerify` 插件(它會再轉送到網站存起來)。
  沒裝 `TierVerify` 的伺服器收不到訊息,不會出錯;不想讓伺服器看到你裝了哪些模組可以關掉(預設開啟)

改完存檔後重開遊戲生效。

## 建置

已經實際編譯成功過(Gradle 8.14.3 + Fabric Loom 1.9.2),沒有 `gradlew` wrapper,直接用系統的 Gradle:

```bash
gradle build
```

建置產物在 `build/libs/tierbadge-1.0.0.jar`,丟進客戶端的 `mods/` 資料夾(需要先裝 [Fabric Loader](https://fabricmc.net/use/) + [Fabric API](https://modrinth.com/mod/fabric-api))。

建置前請先檢查 `gradle.properties` 裡的版本號:

- 去 https://fabricmc.net/develop 選 Minecraft 1.21.1,確認 `yarn_mappings`、`loader_version` 是不是最新的
- 去 https://modrinth.com/mod/fabric-api 確認 `fabric_version` 對應 1.21.1 的版本
- 這幾個版本號寫死在檔案裡的時候可能已經過時,版本不合會直接建置失敗,錯誤訊息通常會直接告訴你該換成哪個版本

如果 `PlayerDisplayNameMixin` 編譯失敗(通常是 mixin apply 失敗的錯誤),八成是 `getDisplayName` 這個方法在你用的 Yarn mappings 版本裡簽章跑掉了,
用 IDE 打開 `PlayerEntity` 反編譯後的原始碼確認一下正確的方法名稱/回傳型別再調整。

## 跨版本支援(1.21 ~ 1.21.x)

`fabric.mod.json` 的 `depends.minecraft` 已經寫成 `">=1.21- <1.22-"`,理論上同一包 jar 可以讓 Fabric Loader
在 1.21 到 1.22 之前的任何點版本(1.21.1、1.21.2……)都能載入,不用每個版本各編一包。

但這只是「Loader 允不允許載入」的範圍設定,不是「保證能動」:

- `PlayerDisplayNameMixin` 是攔截 `PlayerEntity#getDisplayName()`,只要 Mojang 在某個點版本沒改這個方法的
  名稱或簽章,一包 jar 通常真的可以跨好幾個點版本正常運作,這是 Fabric intermediary mapping 這層的常見特性
- 如果哪個版本 Mojang 剛好動到這個方法,遊戲啟動時 Mixin apply 會直接失敗、丟出明確的錯誤訊息(不會是那種
  「看起來能跑但邏輯是錯的」的沉默失敗),那個版本就需要另外調整 mixin 目標重新編譯一包
- 建置的時候 `gradle.properties` 裡的 `minecraft_version`/`yarn_mappings` 還是只能填一個版本,Loom 是拿那個
  版本來產生反混淆的原始碼給你對照。建議固定用最低支援版本(1.21 或 1.21.1)去編,再實際去其他點版本開遊戲
  裝上測試過,確認名牌真的有顯示、也沒有任何 Mixin 錯誤,再正式發布

換句話說:**「宣告支援 1.21~1.21.x」跟「每個版本都實測過」是兩件事**,正式發布前建議至少挑幾個常見版本
(例如最低、最高、中間一個)實際玩一輪確認。網站的 `/downloads` 頁面上傳新版本時可以填「支援版本」欄位,
方便玩家自己選對應的版本下載,也方便你之後針對某個版本另外出一包修正版。

## 已知限制

- 只有這個模組使用者自己看得到標記(客戶端模組的通性),沒裝的人看不到
- 段位資料是「拉」的(定期輪詢),不是即時推送,改了段位後最多要等一個 `refreshIntervalSeconds` 才會更新
- 目前只處理 Vanilla 這個分類(跟網站現況一致)
