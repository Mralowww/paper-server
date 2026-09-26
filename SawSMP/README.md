# SawSMP 插件

鋸齒 SMP 的核心插件，負責遊戲與網站之間的同步。支援 Paper 與 Folia 1.21.x，需要 Java 21。

## 功能

- **懲處**：`/ban` `/tempban` `/ipban` `/mute` `/tempmute` `/warn` `/kick`，以及 `/unban` `/unipban` `/unmute`。
  指令會取代原版的同名指令。處罰會寫入網站，網站下的處罰也會同步到遊戲（踢出、禁言、警告）。
  - 用法：`/ban <玩家> [時長] [-s] [原因]`，時長可寫 `30m`、`12h`、`3d`、`1mo`、`perm`
  - `-s`：靜默處罰，只有擁有 `sawsmp.notify` 的人會看到
- **進服檢查**：被封鎖（含 IP 封鎖）的玩家無法進入，畫面會顯示原因、到期時間和申訴連結。
- **禁言**：擋下聊天和 `/msg`、`/tell`、`/me` 等私訊指令。
- **查詢**：`/history <玩家>` 看處罰紀錄，`/check <玩家>` 看目前狀態。
- **帳號綁定**：`/link <驗證碼>`，驗證碼在網站「我的帳號」產生。
- **權限同步**：網站後台「遊戲權限」設定的節點會自動套用，不需要 LuckPerms。
- **戰績**：自動回報 PVP 擊殺與擊殺方式到網站排行榜（末地水晶、重生錨、近戰、重錘、弓箭、TNT、摔落）。
- **配對對戰**：玩家在網站 `/match` 配對，插件會把兩人傳送到地表的安全隨機位置。
  一方死亡或退出遊戲判負，超過時間限制為平手。結束後會傳回原位置。

## 安裝

1. `gradle build`，把 `build/libs/SawSMP-1.0.0.jar` 放進伺服器的 `plugins/`
2. 啟動一次產生 `plugins/SawSMP/config.yml`
3. 到網站「後台 → API Keys」產生插件金鑰，填入 `api.key`，並確認 `api.url` 是網站網址
4. 執行 `/sawsmp reload`，再用 `/sawsmp status` 確認連線正常

## 權限

| 節點 | 預設 | 說明 |
|---|---|---|
| `sawsmp.punish.*` | op | 全部處罰指令（也可以分開給，例如 `sawsmp.punish.mute`） |
| `sawsmp.history` / `sawsmp.check` | op | 查詢指令 |
| `sawsmp.silent` | op | 可以使用 `-s` 靜默處罰 |
| `sawsmp.notify` | op | 收到處罰通知 |
| `sawsmp.admin` | op | `/sawsmp`，以及在 `/check` 看到 IP |
