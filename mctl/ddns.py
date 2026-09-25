"""Keeps the Cloudflare A records pointed at this host's current public IP (dynamic DNS)."""
import json
import threading
import time
import urllib.error
import urllib.request

from . import config as C
from . import db as D

CF_API = "https://api.cloudflare.com/client/v4"
IP_SOURCES = ("https://api.ipify.org", "https://ipv4.icanhazip.com", "https://checkip.amazonaws.com")

state = {"ip": None, "checkedAt": None, "updatedAt": None, "error": None, "records": []}


def enabled():
    return bool(C.CF_API_TOKEN and C.CF_ZONE_ID and C.CF_DNS_RECORDS)


def public_ip():
    for url in IP_SOURCES:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mc.Tierlist.Asia"}), timeout=8) as res:
                ip = res.read().decode().strip()
            parts = ip.split(".")
            if len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
                return ip
        except (urllib.error.URLError, OSError, ValueError):
            continue
    return None


def cf(method, path, body=None):
    req = urllib.request.Request(f"{CF_API}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {C.CF_API_TOKEN}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            data = json.loads(exc.read().decode())
        except ValueError:
            raise RuntimeError(f"Cloudflare HTTP {exc.code}") from exc
    if not data.get("success"):
        msg = "; ".join(e.get("message", "") for e in data.get("errors", [])) or "unknown error"
        raise RuntimeError(f"Cloudflare: {msg}")
    return data["result"]


def sync_once():
    """Checks the public IP and fixes any record that points elsewhere. Returns a list of changed names."""
    ip = public_ip()
    state["checkedAt"] = D.now_ms()
    if not ip:
        raise RuntimeError("無法取得主機的公開 IP")
    state["ip"] = ip
    changed, summary = [], []
    for name in C.CF_DNS_RECORDS:
        records = cf("GET", f"/zones/{C.CF_ZONE_ID}/dns_records?name={name}")
        a_records = [r for r in records if r["type"] == "A"]
        if not a_records:
            if records:  # a CNAME (or other record) owns this name — leave it alone
                summary.append({"name": name, "status": f"skipped ({records[0]['type']})"})
                continue
            cf("POST", f"/zones/{C.CF_ZONE_ID}/dns_records",
               {"type": "A", "name": name, "content": ip, "proxied": True, "ttl": 1})
            changed.append(name)
            summary.append({"name": name, "status": "created", "content": ip})
            continue
        for r in a_records:
            if r["content"] != ip:
                cf("PATCH", f"/zones/{C.CF_ZONE_ID}/dns_records/{r['id']}", {"content": ip})
                changed.append(name)
                summary.append({"name": name, "status": "updated", "from": r["content"], "content": ip})
            else:
                summary.append({"name": name, "status": "ok", "content": ip})
    state["records"] = summary
    return changed


def loop():
    last_error = None
    while True:
        try:
            changed = sync_once()
            state["error"] = None
            if changed:
                state["updatedAt"] = D.now_ms()
                msg = f"{', '.join(changed)} → {state['ip']}"
                print(f"[ddns] Cloudflare DNS updated: {msg}", flush=True)
                with D.transaction() as c:
                    D.audit(c, {"id": None, "username": "DDNS"}, "ddns_update", msg, source="system",
                            target=("setting", "dns", "Cloudflare DNS"), meta={"records": changed, "ip": state["ip"]})
            last_error = None
        except Exception as exc:  # network outages are expected; keep retrying
            state["error"] = str(exc)
            if str(exc) != last_error:
                print(f"[ddns] {exc}", flush=True)
            last_error = str(exc)
        time.sleep(C.DDNS_INTERVAL)


def start():
    if not enabled():
        print("[ddns] CF_API_TOKEN / CF_ZONE_ID not set — Cloudflare DNS auto-update disabled.")
        return
    print(f"[ddns] Keeping {', '.join(C.CF_DNS_RECORDS)} pointed at this host (every {C.DDNS_INTERVAL}s).")
    threading.Thread(target=loop, name="ddns", daemon=True).start()
