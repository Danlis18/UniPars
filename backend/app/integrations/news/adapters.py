"""Адаптери джерел новин. Адреси джерел задає адміністратор університету;
у коді немає жодних «вгаданих» URL.

- rss:      RSS 2.0 або Atom.
- json_api: довільний JSON API; мапінг полів у news_sources.config:
            {"items_path": "data.items", "id": "id", "title": "title",
             "summary": "excerpt", "url": "link", "published_at": "date"}
- manual:   оголошення адміністратора, нічого не завантажує.
"""
from __future__ import annotations

import hashlib
import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

TIMEOUT = httpx.Timeout(10.0)
HEADERS = {"User-Agent": "UniPars-NewsBot/1.0"}


@dataclass
class FetchedItem:
    external_id: str
    title: str
    summary: str
    url: str | None
    published_at: str


def _clean(text: str | None, limit: int = 300) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def _date(value: str | None) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    for parse in (parsedate_to_datetime, lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))):
        try:
            d = parse(value)
            return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat()
        except Exception:
            continue
    return datetime.now(timezone.utc).isoformat()


def _id(*parts: str | None) -> str:
    return hashlib.sha1("|".join(p or "" for p in parts).encode()).hexdigest()


def parse_feed(content: bytes) -> list[FetchedItem]:
    root = ET.fromstring(content)
    out: list[FetchedItem] = []
    for item in root.iter():
        tag = item.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        get = lambda name: next((c for c in item if c.tag.split("}")[-1] == name), None)  # noqa: E731
        title_el, link_el = get("title"), get("link")
        link = (link_el.get("href") or link_el.text) if link_el is not None else None
        guid = get("guid") if tag == "item" else get("id")
        desc = get("description") if tag == "item" else (get("summary") or get("content"))
        date = get("pubDate") if tag == "item" else (get("published") or get("updated"))
        title = _clean(title_el.text if title_el is not None else "", 200)
        if not title:
            continue
        out.append(FetchedItem(
            external_id=(guid.text.strip() if guid is not None and guid.text else _id(link, title)),
            title=title, summary=_clean(desc.text if desc is not None else ""),
            url=link.strip() if link else None, published_at=_date(date.text if date is not None else None)))
    return out


def _path(obj, path: str | None):
    if not path:
        return obj
    for key in path.split("."):
        obj = obj.get(key) if isinstance(obj, dict) else None
    return obj


def parse_json(data, config: dict) -> list[FetchedItem]:
    items = _path(data, config.get("items_path")) or []
    out = []
    for it in items if isinstance(items, list) else []:
        title = _clean(str(_path(it, config.get("title", "title")) or ""), 200)
        if not title:
            continue
        url = _path(it, config.get("url", "url"))
        ext = _path(it, config.get("id", "id"))
        out.append(FetchedItem(external_id=str(ext) if ext else _id(url, title), title=title,
                               summary=_clean(str(_path(it, config.get("summary", "summary")) or "")),
                               url=str(url) if url else None,
                               published_at=_date(str(_path(it, config.get("published_at", "published_at")) or "") or None)))
    return out


async def fetch(source: dict) -> list[FetchedItem]:
    kind = source["kind"]
    if kind == "manual":
        return []
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True) as client:
        r = await client.get(source["url"])
        r.raise_for_status()
        if kind == "rss":
            return parse_feed(r.content)
        if kind == "json_api":
            return parse_json(r.json(), source.get("config") or {})
    raise ValueError(f"Невідомий тип джерела: {kind}")
