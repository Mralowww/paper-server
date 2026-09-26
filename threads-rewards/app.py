"""啟動入口（Pterodactyl 會執行此檔）。埠號讀取 SERVER_PORT，其次 PORT，預設 8000。"""
import os

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("SERVER_PORT") or os.getenv("PORT") or 8000)
    uvicorn.run("rewards.main:app", host="0.0.0.0", port=port, proxy_headers=True, forwarded_allow_ips="*")
