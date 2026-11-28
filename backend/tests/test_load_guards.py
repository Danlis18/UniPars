"""Захист від пікового навантаження: черга генерацій і одне оновлення новин замість сотні."""
import asyncio
import dataclasses

from app.core import config
from app.services import news, regeneration


class SlowProvider:
    def __init__(self):
        self.now = self.peak = 0

    async def stream(self, system, messages):
        self.now += 1
        self.peak = max(self.peak, self.now)
        await asyncio.sleep(0.05)
        self.now -= 1
        yield '{"title": "T", "sections": [{"heading": "Мета", "blocks": []}]}'


def test_regenerations_queue_limits_concurrent_ai_calls(monkeypatch):
    st = dataclasses.replace(config.get_settings(), max_concurrent_regenerations=3)
    monkeypatch.setattr(regeneration, "get_settings", lambda: st)
    monkeypatch.setattr(regeneration, "_slots", None)
    provider = SlowProvider()
    import app.integrations.ai.factory as factory

    monkeypatch.setattr(factory, "get_provider", lambda: provider)
    svc = regeneration.RegenerationService.__new__(regeneration.RegenerationService)
    opts = {"style": {"emphasis": ["bold"], "density": "medium", "seed": 1, "heading": "bold"}}

    async def many():
        return await asyncio.gather(*(svc._generate("текст", opts) for _ in range(10)))

    results = asyncio.run(many())
    assert len(results) == 10 and all(r["engine"] == "ai" for r in results)
    assert provider.peak == 3  # одночасно — не більше ліміту, решта дочекалась черги


def test_stale_news_source_refreshed_once_for_many_users(monkeypatch):
    calls = []

    async def fetch(source):
        calls.append(source["id"])
        await asyncio.sleep(0.05)
        return []

    monkeypatch.setattr(news.adapters, "fetch", fetch)

    class Store:
        def update(self, table, eq, values):
            return [{"id": eq["id"], "name": "Факультет", **values}]

    src = {"id": "src-1", "university_id": "u", "name": "Факультет"}

    async def crowd():
        return await asyncio.gather(*(news.sync_source(Store(), src) for _ in range(50)))

    out = asyncio.run(crowd())
    assert len(out) == 50 and calls == ["src-1"]  # 50 студентів — одне звернення до джерела
