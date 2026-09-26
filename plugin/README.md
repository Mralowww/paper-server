# TierlistLink（Paper 插件）

Mc.Tierlist.Asia 官方伺服器用的插件：玩家進服時向網站確認
- 是否被封禁 → 直接擋下並顯示原因
- 是否已綁定 Discord → 沒綁定就踢出並顯示 6 位數驗證碼
- 玩家改名 → 網站排行榜自動更新名稱
- 伺服器戰績（1.1.0 起）→ 擊殺、死亡（含水晶／重生錨判定）、圖騰、對戰比分、所在世界、上線時間
- CorePlus 整合（1.1.0 起）→ 定時讀取 `plugins/CorePlus/playerdata/*.yml`（成就、水晶／重生錨統計、連續登入）與世界名稱，同步到網站
- 處罰系統（1.2.0 起）→ 遊戲內 `/ban` `/mute` 等指令，和網站「處罰管理」共用同一份紀錄；網站上的處罰幾秒內就會套用到遊戲
- 權限同步（1.2.0 起）→ 在網站「遊戲權限」設定的權限節點，玩家進服時自動套用

支援 Paper 1.21.11（Java 21）。

## 安裝

1. 網站後台 → **API Keys** → 建立金鑰，類型選 **官方伺服器插件**，複製金鑰（只會顯示一次）。
2. 把 `TierlistLink-1.2.0.jar` 放進伺服器的 `plugins/` 資料夾，重開伺服器。
3. 打開 `plugins/TierlistLink/config.yml`，把金鑰貼到 `server-key`。
4. 在後台輸入 `tierlist reload`，再輸入 `tierlist status` 確認「網站連線正常」。
5. 確認驗證碼正常後，到網站後台 → **帳號綁定** → 開啟「申請考試必須先綁定」。

## 指令

| 指令 | 說明 | 權限 |
|---|---|---|
| `/tierlist status` | 測試與網站的連線 | `tierlist.admin`（預設 OP） |
| `/tierlist reload` | 重新載入設定 | `tierlist.admin` |
| `/tierlist sync` | 立刻上傳待傳戰績與 CorePlus 資料 | `tierlist.admin` |

### 處罰指令

時間格式：`30m`、`12h`、`7d`、`1mo`、`1d12h`。旗標可放在原因前後：
`-s` 靜默（只通知有 `tierlist.notify` 的人，需要 `tierlist.silent`）、`-d` / `-nd` 同步／不同步到 Discord（沒寫就用網站預設）。

| 指令 | 說明 | 權限 |
|---|---|---|
| `/ban <玩家> [原因]` | 永久封禁 | `tierlist.ban` |
| `/tempban <玩家> <時間> [原因]` | 限時封禁 | `tierlist.tempban` |
| `/ipban <玩家> [-t 時間] [原因]` | 封鎖玩家最後登入的 IP | `tierlist.ipban` |
| `/unban <玩家> [原因]` | 解除封禁（含 IP 封禁） | `tierlist.unban` |
| `/mute <玩家> [原因]` | 永久禁言 | `tierlist.mute` |
| `/tempmute <玩家> <時間> [原因]` | 限時禁言 | `tierlist.tempmute` |
| `/unmute <玩家> [原因]` | 解除禁言 | `tierlist.unmute` |
| `/warn <玩家> <原因>` | 警告（畫面標題＋聊天訊息） | `tierlist.warn` |
| `/kick <玩家> [原因]` | 踢出並留下紀錄 | `tierlist.kick` |
| `/history <玩家>` | 查看處罰紀錄 | `tierlist.history` |
| `/check <玩家>` | 查看目前生效中的處罰 | `tierlist.check` |

其他權限：`tierlist.notify`（看到靜默處罰公告）、`tierlist.silent`（可用 `-s`）。
以上權限預設只給 OP；建議直接在網站後台 → **遊戲權限** 依網站身分、考官或 Discord 身分組設定，插件會自動同步。

被禁言時聊天和 `config.yml` 裡 `punish.muted-blocked-commands` 列出的私訊類指令都會被擋下。
`punish.sync-seconds`（預設 5）是向網站拉取新處罰的間隔。

## 編譯

```bash
cd plugin
mvn package
# 輸出：target/TierlistLink-1.2.0.jar
```
