"""安全性：回應標頭（CSP、防嵌入、防 MIME 猜測…）與簡易的請求頻率限制。"""
import base64
import hashlib
import re
import time
from pathlib import Path

from fastapi import HTTPException

STATIC = Path(__file__).resolve().parent.parent / "static"


def _inline_hashes() -> list[str]:
    """頁面裡唯一的內嵌腳本（主題初始化）的 SHA-256，讓 CSP 不必開 unsafe-inline。"""
    out = set()
    for f in STATIC.glob("*.html"):
        for m in re.findall(r"<script>(.*?)</script>", f.read_text(encoding="utf-8"), re.S):
            out.add("'sha256-" + base64.b64encode(hashlib.sha256(m.encode()).digest()).decode() + "'")
    return sorted(out)


CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' " + " ".join(_inline_hashes()) + " https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://cloudflareinsights.com",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
])
HEADERS = [
    (b"content-security-policy", CSP.encode()),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
]


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]

        async def snd(msg):
            if msg["type"] == "http.response.start":
                have = {k.lower() for k, _ in msg.get("headers", [])}
                extra = [(k, v) for k, v in HEADERS if k not in have]
                if path.startswith("/uploads/"):
                    # 使用者上傳的檔案：一律當附件以外的純圖片處理，禁止在網站網域下執行任何內容
                    extra.append((b"content-security-policy", b"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"))
                    extra = [(k, v) for k, v in extra if not (k == b"content-security-policy" and v == CSP.encode())]
                if path.startswith("/api/") and b"cache-control" not in have:
                    extra.append((b"cache-control", b"no-store"))
                msg["headers"] = list(msg.get("headers", [])) + extra
            await send(msg)

        await self.app(scope, receive, snd)


# ---------- 簡易頻率限制（單一程序、記憶體內） ----------
_hits: dict[str, list[float]] = {}


def ratelimit(key: str, limit: int, window: int, message: str = "操作太頻繁，請稍後再試") -> None:
    now = time.time()
    arr = [t for t in _hits.get(key, []) if now - t < window]
    if len(arr) >= limit:
        _hits[key] = arr
        raise HTTPException(429, message)
    arr.append(now)
    _hits[key] = arr
    if len(_hits) > 20000:  # 定期清掉舊的
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > 3600]:
            _hits.pop(k, None)


def safe_next(nxt: str | None) -> str | None:
    """只接受站內相對路徑（擋掉 //evil.com、/\\evil.com、控制字元等開放轉址手法）。"""
    if not nxt or not nxt.startswith("/") or nxt.startswith("//") or "\\" in nxt or any(ord(c) < 32 for c in nxt):
        return None
    return nxt[:300]


# 瀏覽器推播服務的網域白名單（避免被拿來對任意網址發請求）
PUSH_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com",
              ".notify.windows.com", ".push.apple.com")


def push_host_ok(url: str) -> bool:
    from urllib.parse import urlparse
    u = urlparse(url)
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or (h.startswith(".") and host.endswith(h)) for h in PUSH_HOSTS)


IMAGE_MAGIC = {".png": [b"\x89PNG\r\n\x1a\n"], ".jpg": [b"\xff\xd8\xff"], ".gif": [b"GIF87a", b"GIF89a"], ".webp": [b"RIFF"]}


def image_ok(ext: str, data: bytes) -> bool:
    sigs = IMAGE_MAGIC.get(ext, [])
    ok = any(data.startswith(s) for s in sigs)
    return ok and (ext != ".webp" or data[8:12] == b"WEBP")
