# Mc.Tierlist.Asia

亞洲 Minecraft Vanilla PvP Tier 排行榜，包含：

- **公開網站**：首頁、排行榜（地區／Tier 篩選、搜尋）、玩家頁、開發者 API 文件
- **開發者 API**（`/api/v1`）：需要 API Key，每把 Key 每分鐘 60 次請求
- **管理後台**（`/admin`）：Discord 登入，管理玩家 Tier、API Key、管理員，並保留操作紀錄

## 需求

- Python **3.9 以上**（資料庫使用內建 SQLite，不需另外安裝）

## 安裝與啟動

```bash
pip install -r requirements.txt
cp .env.example .env   # 填入設定
python app.py
```

- 伺服器使用 waitress，監聽 `PORT`（或託管提供的 `SERVER_PORT`），預設 3000。
- 資料存放在 `data/tierlist.db`，請定期備份這個資料夾。

## Discord 登入設定

1. 到 <https://discord.com/developers/applications> 建立 Application
2. OAuth2 → 把 **Client ID** 與 **Client Secret** 填到 `.env`
3. OAuth2 → Redirects 加入 `{BASE_URL}/auth/discord/callback`

## 權限

| 角色 | 可以做的事 |
| --- | --- |
| 超級管理員 | 所有功能 + 新增／移除管理員、變更權限 |
| 管理員 | 管理玩家、API Key，查看紀錄 |

`SUPER_ADMIN_IDS` 裡的帳號受保護，無法在後台被移除或降級。

## 反向代理

若放在 Nginx / Cloudflare 後方，請轉發 `Host` 與 `X-Forwarded-*` 標頭。`BASE_URL` 使用 `https://` 時，登入 Cookie 會自動設為 Secure。
