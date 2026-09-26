"""瀏覽器推播通知（Web Push）：網頁關著也能在桌面跳出通知。

自行實作 VAPID（RFC 8292）與 aes128gcm 內容加密（RFC 8291），只依賴 cryptography。
"""
import asyncio
import base64
import json
import logging
import os
import time
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import config, db
from .deps import SUPPORT, current_user

log = logging.getLogger("rewards.push")
router = APIRouter()
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731


def unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def ensure_schema() -> None:
    db.execute("""CREATE TABLE IF NOT EXISTS push_subs (
        endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
        kinds TEXT NOT NULL DEFAULT 'tickets', user_agent TEXT, created_at TEXT NOT NULL)""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id)")


def _vapid() -> tuple[ec.EllipticCurvePrivateKey, str]:
    """VAPID 金鑰存在設定表；第一次使用時產生。"""
    s = db.settings()
    pem = s.get("vapid_private_pem")
    if not pem:
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        db.set_settings({"vapid_private_pem": pem})
    key = serialization.load_pem_private_key(pem.encode(), password=None)
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return key, b64(pub)


def _jwt(key: ec.EllipticCurvePrivateKey, aud: str) -> str:
    head = b64(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
    body = b64(json.dumps({"aud": aud, "exp": int(time.time()) + 12 * 3600,
                           "sub": f"mailto:admin@{urlparse(config.PUBLIC_URL).hostname or 'sawsmp.me'}"}).encode())
    r, s = decode_dss_signature(key.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256())))
    return f"{head}.{body}.{b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


def _encrypt(payload: bytes, p256dh: str, auth: str) -> bytes:
    ua_pub = unb64(p256dh); auth_secret = unb64(auth)
    as_key = ec.generate_private_key(ec.SECP256R1())
    as_pub = as_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = as_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub))
    ikm = HKDF(hashes.SHA256(), 32, auth_secret, b"WebPush: info\x00" + ua_pub + as_pub).derive(shared)
    salt = os.urandom(16)
    cek = HKDF(hashes.SHA256(), 16, salt, b"Content-Encoding: aes128gcm\x00").derive(ikm)
    nonce = HKDF(hashes.SHA256(), 12, salt, b"Content-Encoding: nonce\x00").derive(ikm)
    cipher = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + (4096).to_bytes(4, "big") + bytes([len(as_pub)]) + as_pub + cipher


async def _send_one(client: httpx.AsyncClient, sub: dict, data: dict) -> None:
    key, pub = _vapid()
    u = urlparse(sub["endpoint"])
    try:
        r = await client.post(sub["endpoint"], content=_encrypt(json.dumps(data, ensure_ascii=False).encode(), sub["p256dh"], sub["auth"]),
                              headers={"TTL": "86400", "Content-Encoding": "aes128gcm", "Urgency": "high",
                                       "Authorization": f"vapid t={_jwt(key, f'{u.scheme}://{u.netloc}')}, k={pub}"})
        if r.status_code in (404, 410):
            db.execute("DELETE FROM push_subs WHERE endpoint = ?", (sub["endpoint"],))
        elif r.status_code >= 300:
            log.warning("推播失敗 %s：%s %s", u.netloc, r.status_code, r.text[:200])
    except Exception:  # noqa: BLE001
        log.warning("推播失敗", exc_info=True)


async def send(user_ids: list[str] | None, data: dict, kind: str | None = "tickets") -> None:
    """推播給指定使用者（None = 所有訂閱者）。data：title / body / url / tag。"""
    rows = db.query("SELECT * FROM push_subs")
    rows = [r for r in rows if (kind is None or kind in (r["kinds"] or "").split(",")) and (user_ids is None or r["user_id"] in user_ids)]
    if not rows:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        await asyncio.gather(*(_send_one(client, r, data) for r in rows))


def fire(user_ids: list[str] | None, data: dict, kind: str = "tickets") -> None:
    try:
        asyncio.get_running_loop().create_task(send(user_ids, data, kind))
    except RuntimeError:
        pass


def staff_ids(min_level: int = SUPPORT) -> list[str]:
    return [u["id"] for u in db.query("SELECT id FROM users WHERE level >= ?", (min_level,))]


# ---------- API ----------

class SubIn(BaseModel):
    endpoint: str
    keys: dict
    kinds: list[str] = ["tickets"]


@router.get("/api/push/key")
async def push_key():
    return {"key": _vapid()[1]}


@router.get("/api/push/status")
async def push_status(user: dict = Depends(current_user)):
    return {"subscriptions": db.query("SELECT endpoint, kinds, user_agent, created_at FROM push_subs WHERE user_id = ?", (user["id"],))}


@router.post("/api/push/subscribe")
async def subscribe(body: SubIn, user: dict = Depends(current_user)):
    if not body.endpoint.startswith("https://") or not body.keys.get("p256dh") or not body.keys.get("auth"):
        raise HTTPException(400, "訂閱資料不正確")
    kinds = ",".join(k for k in body.kinds if k in ("tickets", "replies")) or "tickets"
    db.execute("""INSERT INTO push_subs(endpoint, user_id, p256dh, auth, kinds, created_at) VALUES (?,?,?,?,?,?)
                  ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, kinds = excluded.kinds""",
               (body.endpoint, user["id"], body.keys["p256dh"], body.keys["auth"], kinds, db.iso(db.now_utc())))
    return {"ok": True}


@router.post("/api/push/unsubscribe")
async def unsubscribe(body: dict, user: dict = Depends(current_user)):
    db.execute("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?", (str(body.get("endpoint", "")), user["id"]))
    return {"ok": True}


@router.post("/api/push/test")
async def push_test(user: dict = Depends(current_user)):
    await send([user["id"]], {"title": "鋸齒 SMP", "body": "桌面通知已開啟，之後有新的客服單或回覆會在這裡提醒你。", "url": "/settings", "tag": "test"}, kind=None)
    return {"ok": True}
