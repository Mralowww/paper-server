# TierlistLink（Paper 插件）

Mc.Tierlist.Asia 官方伺服器用的插件：玩家進服時向網站確認
- 是否被封禁 → 直接擋下並顯示原因
- 是否已綁定 Discord → 沒綁定就踢出並顯示 6 位數驗證碼
- 玩家改名 → 網站排行榜自動更新名稱

支援 Paper 1.21.11（Java 21）。

## 安裝

1. 網站後台 → **API Keys** → 建立金鑰，類型選 **官方伺服器插件**，複製金鑰（只會顯示一次）。
2. 把 `TierlistLink-1.0.0.jar` 放進伺服器的 `plugins/` 資料夾，重開伺服器。
3. 打開 `plugins/TierlistLink/config.yml`，把金鑰貼到 `server-key`。
4. 在後台輸入 `tierlist reload`，再輸入 `tierlist status` 確認「網站連線正常」。
5. 確認驗證碼正常後，到網站後台 → **帳號綁定** → 開啟「申請考試必須先綁定」。

## 指令

| 指令 | 說明 | 權限 |
|---|---|---|
| `/tierlist status` | 測試與網站的連線 | `tierlist.admin`（預設 OP） |
| `/tierlist reload` | 重新載入設定 | `tierlist.admin` |

## 編譯

```bash
cd plugin
mvn package
# 輸出：target/TierlistLink-1.0.0.jar
```
