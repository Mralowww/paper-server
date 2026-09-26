"""抓取 Threads 公開貼文頁面的互動數據。

Threads 沒有公開的讀取 API（官方 API 只能讀取授權帳號本人的貼文），
因此這裡直接讀取公開頁面內嵌的 JSON。公開頁面不會提供瀏覽數，
瀏覽數由管理員在後台手動填寫。Meta 若改版頁面，只需要調整本檔的解析規則。
"""
import html
import re

import httpx

URL_RE = re.compile(
    r"^https?://(?:www\.)?threads\.(?:net|com)/@([A-Za-z0-9._]+)/post/([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)

# 以一般瀏覽器 UA 取得的頁面不含互動數，搜尋引擎爬蟲 UA 取得的伺服器端渲染頁面才有
HEADERS = {
    "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml",
}

FIELDS = {
    "likes": [r'"like_count":\s*(\d+)'],
    "replies": [r'"direct_reply_count":\s*(\d+)', r'"reply_count":\s*(\d+)'],
    "reposts": [r'"repost_count":\s*(\d+)', r'"reshare_count":\s*(\d+)'],
    "quotes": [r'"quote_count":\s*(\d+)'],
    "views": [r'"view_count":\s*(\d+)'],
}

OG_RE = re.compile(r'<meta\s+property="og:(description|title)"\s+content="([^"]*)"', re.I)
OG_COUNTS = {
    "likes": re.compile(r"([\d,.]+[KkMm萬]?)\s*(?:likes?|個讚|讚)", re.I),
    "replies": re.compile(r"([\d,.]+[KkMm萬]?)\s*(?:repl(?:y|ies)|則回覆|回覆)", re.I),
}


class ScrapeError(Exception):
    pass


def parse_url(url: str) -> tuple[str, str, str] | None:
    """回傳 (標準化網址, 作者, 貼文代碼)；格式不符回傳 None。"""
    m = URL_RE.match(url.strip())
    if not m:
        return None
    author, code = m.group(1), m.group(2)
    return f"https://www.threads.com/@{author}/post/{code}", author, code


def _human_number(text: str) -> int:
    text = text.replace(",", "").strip()
    mult = 1
    if text[-1:] in "Kk":
        mult, text = 1_000, text[:-1]
    elif text[-1:] in "Mm":
        mult, text = 1_000_000, text[:-1]
    elif text[-1:] == "萬":
        mult, text = 10_000, text[:-1]
    return int(float(text) * mult)


CODE_RE = re.compile(r'"code":"([A-Za-z0-9_-]{6,})"')


def _last(pattern: str, text: str) -> int | None:
    found = re.findall(pattern, text)
    return int(found[-1]) if found else None


def _first(pattern: str, text: str) -> int | None:
    m = re.search(pattern, text)
    return int(m.group(1)) if m else None


def parse_page(page: str, code: str) -> dict:
    """頁面內嵌 JSON 會包含目標貼文與其回覆。每則貼文的回覆/轉發數出現在該貼文
    "code" 之前，按讚數出現在 "code" 之後、下一則貼文之前，依此切出目標貼文的範圍。"""
    codes = [(m.start(), m.group(1)) for m in CODE_RE.finditer(page)]
    idx = next((i for i, (_, c) in enumerate(codes) if c == code), None)
    result: dict = {}
    if idx is not None:
        pos = codes[idx][0]
        prev_pos = codes[idx - 1][0] if idx > 0 else 0
        next_pos = codes[idx + 1][0] if idx + 1 < len(codes) else len(page)
        before, after = page[prev_pos:pos], page[pos:next_pos]
        for field, patterns in FIELDS.items():
            for pat in patterns:
                val = _first(pat, after) if field == "likes" else _last(pat, before)
                if val is None:
                    val = _first(pat, after) if field != "likes" else _last(pat, before)
                if val is not None:
                    result[field] = val
                    break

    og = {k.lower(): html.unescape(v) for k, v in OG_RE.findall(page)}
    if "likes" not in result:
        for field, rx in OG_COUNTS.items():
            m = rx.search(og.get("description", ""))
            if m and field not in result:
                result[field] = _human_number(m.group(1))
    result["content"] = og.get("description", "")[:300]

    if "likes" not in result:
        raise ScrapeError("無法在公開頁面找到按讚數（貼文可能已刪除、設為私人，或 Threads 改版）")
    result["reposts"] = result.get("reposts", 0) + result.pop("quotes", 0)
    return result


async def fetch_stats(url: str) -> dict:
    parsed = parse_url(url)
    if not parsed:
        raise ScrapeError("不是有效的 Threads 貼文網址")
    norm, _, code = parsed
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=20) as client:
        resp = await client.get(norm)
    if resp.status_code == 404:
        raise ScrapeError("貼文不存在（404）")
    if resp.status_code >= 400:
        raise ScrapeError(f"Threads 回應 HTTP {resp.status_code}")
    return parse_page(resp.text, code)
