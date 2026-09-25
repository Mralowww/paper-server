"""Renders Minecraft heads and front-facing bodies straight from Mojang skin textures, with a disk cache."""
import base64
import io
import json
import re
import threading
import time
import urllib.error
import urllib.request

from PIL import Image

from . import config as C

CACHE_DIR = C.DATA_DIR / "heads"
SKIN_TTL = 6 * 3600          # re-check a player's skin every 6 hours
NAME_TTL = 3600
UUID_RE = re.compile(r"^[0-9a-fA-F]{32}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_]{1,16}$")
FALLBACK = "MHF_Steve"

_lock = threading.Lock()
_names = {}   # lower name -> (uuid or None, fetched_at)
_skins = {}   # uuid -> (Image, slim, fetched_at)


def _get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "Mc.Tierlist.Asia"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, res.read()


def resolve_uuid(ident):
    """Name or UUID → undashed UUID, or None when the account doesn't exist."""
    ident = ident.replace("-", "")
    if UUID_RE.match(ident):
        return ident.lower()
    if not NAME_RE.match(ident):
        return None
    key = ident.lower()
    hit = _names.get(key)
    if hit and time.time() - hit[1] < NAME_TTL:
        return hit[0]
    try:
        status, body = _get(f"https://api.mojang.com/users/profiles/minecraft/{ident}")
        uuid = json.loads(body)["id"] if status == 200 and body else None
    except urllib.error.HTTPError as exc:
        if exc.code not in (204, 404):
            raise
        uuid = None
    _names[key] = (uuid, time.time())
    return uuid


def load_skin(uuid):
    """Returns (RGBA 64×64 skin, slim) for a UUID."""
    hit = _skins.get(uuid)
    if hit and time.time() - hit[2] < SKIN_TTL:
        return hit[0], hit[1]
    _, body = _get(f"https://sessionserver.mojang.com/session/minecraft/profile/{uuid}")
    props = json.loads(body).get("properties", [])
    textures = json.loads(base64.b64decode(props[0]["value"]))["textures"] if props else {}
    skin_info = textures.get("SKIN")
    if not skin_info:
        raise LookupError("no skin")
    _, png = _get(skin_info["url"].replace("http://", "https://"))
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    if img.height == 32:  # legacy 64×32 skin: mirror right limbs onto the left
        full = Image.new("RGBA", (64, 64))
        full.paste(img, (0, 0))
        for src, dst in (((0, 16, 16, 32), (16, 48)), ((40, 16, 56, 32), (32, 48))):
            full.paste(img.crop(src).transpose(Image.FLIP_LEFT_RIGHT), dst)
        img = full
    slim = skin_info.get("metadata", {}).get("model") == "slim"
    _skins[uuid] = (img, slim, time.time())
    return img, slim


def _layer(skin, box, overlay_box=None):
    part = skin.crop(box)
    if overlay_box:
        part.alpha_composite(skin.crop(overlay_box))
    return part


def render_face(skin):
    return _layer(skin, (8, 8, 16, 16), (40, 8, 48, 16))


def render_body(skin, slim):
    """Flat front view on a 16×32 canvas."""
    arm = 3 if slim else 4
    out = Image.new("RGBA", (16, 32))
    out.alpha_composite(render_face(skin), (4, 0))
    out.alpha_composite(_layer(skin, (20, 20, 28, 32), (20, 36, 28, 48)), (4, 8))                    # torso
    out.alpha_composite(_layer(skin, (44, 20, 44 + arm, 32), (44, 36, 44 + arm, 48)), (4 - arm, 8))  # right arm
    out.alpha_composite(_layer(skin, (36, 52, 36 + arm, 64), (52, 52, 52 + arm, 64)), (12, 8))       # left arm
    out.alpha_composite(_layer(skin, (4, 20, 8, 32), (4, 36, 8, 48)), (4, 20))                       # right leg
    out.alpha_composite(_layer(skin, (20, 52, 24, 64), (4, 52, 8, 64)), (8, 20))                     # left leg
    return out


def render(kind, ident, size):
    """PNG bytes for kind 'avatar' or 'body'. Falls back to Steve for unknown players."""
    size = max(8, min(512, int(size)))
    uuid = resolve_uuid(ident) or resolve_uuid(FALLBACK)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{uuid}_{kind}_{size}.png"
    if path.exists() and time.time() - path.stat().st_mtime < SKIN_TTL:
        return path.read_bytes()
    with _lock:
        try:
            skin, slim = load_skin(uuid)
        except (urllib.error.URLError, LookupError, OSError, ValueError, KeyError):
            if path.exists():  # serve the stale copy rather than nothing
                return path.read_bytes()
            skin, slim = load_skin(resolve_uuid(FALLBACK))
        img = render_face(skin) if kind == "avatar" else render_body(skin, slim)
        w = size if kind == "avatar" else size // 2
        img = img.resize((w, size), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        data = buf.getvalue()
        path.write_bytes(data)
        return data
