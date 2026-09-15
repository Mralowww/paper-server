# TierBadge

Fabric 客戶端模組(Minecraft 1.21.1),在遊戲裡玩家名稱旁邊(頭頂名牌、Tab 名單等)自動加上
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

改完存檔後重開遊戲生效。

## 建置(需要你自己的電腦,這裡沒辦法幫你編譯)

這個 sandbox 環境沒有對外連線去下載 Minecraft 本體、Yarn mappings、Fabric API 等建置素材,
所以**這份程式碼還沒有實際編譯測試過**,是照 Fabric 官方範例模組的標準寫法寫的。你在自己電腦上建置：

```bash
./gradlew build
```

建置產物在 `build/libs/tierbadge-1.0.0.jar`,丟進客戶端的 `mods/` 資料夾(需要先裝 [Fabric Loader](https://fabricmc.net/use/) + [Fabric API](https://modrinth.com/mod/fabric-api))。

建置前請先檢查 `gradle.properties` 裡的版本號:

- 去 https://fabricmc.net/develop 選 Minecraft 1.21.1,確認 `yarn_mappings`、`loader_version` 是不是最新的
- 去 https://modrinth.com/mod/fabric-api 確認 `fabric_version` 對應 1.21.1 的版本
- 這幾個版本號寫死在檔案裡的時候可能已經過時,版本不合會直接建置失敗,錯誤訊息通常會直接告訴你該換成哪個版本

如果 `PlayerDisplayNameMixin` 編譯失敗(通常是 mixin apply 失敗的錯誤),八成是 `getDisplayName` 這個方法在你用的 Yarn mappings 版本裡簽章跑掉了,
用 IDE 打開 `PlayerEntity` 反編譯後的原始碼確認一下正確的方法名稱/回傳型別再調整。

## 已知限制

- 只有這個模組使用者自己看得到標記(客戶端模組的通性),沒裝的人看不到
- 段位資料是「拉」的(定期輪詢),不是即時推送,改了段位後最多要等一個 `refreshIntervalSeconds` 才會更新
- 目前只處理 Vanilla 這個分類(跟網站現況一致)
