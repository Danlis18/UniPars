"""Нагадування про кінець підписки за 3 дні: сповіщення в UniPars і push у браузер.

Запускається щогодини (.github/workflows/reminders.yml → POST /api/internal/subscription-reminders).
Для кожного періоду підписки нагадуємо один раз (subscriptions.reminded_period_end); після продовження
period_end змінюється — і перед новим кінцем нагадування прийде знову.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.repositories.store import Store
from app.services import push
from app.services.notifications import notify

REMIND_BEFORE = timedelta(days=3)


def _dt(v) -> datetime:
    return v if isinstance(v, datetime) else datetime.fromisoformat(str(v))


def _kyiv_date(d: datetime) -> str:
    try:
        from zoneinfo import ZoneInfo

        d = d.astimezone(ZoneInfo("Europe/Kyiv"))
    except Exception:  # немає бази часових поясів — показуємо за UTC+2
        d = d.astimezone(timezone(timedelta(hours=2)))
    return d.strftime("%d.%m")


def subscription_reminders(store: Store, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    subs = store.select("subscriptions", [("period_end", "gte", now.isoformat()), ("period_end", "lte", (now + REMIND_BEFORE).isoformat())])
    reminded = pushed = 0
    for s in subs:
        end = _dt(s["period_end"])
        if s.get("canceled_at") or _dt(s["period_start"]) > now:
            continue
        if s.get("reminded_period_end") and _dt(s["reminded_period_end"]) == end:
            continue  # для цього кінця періоду вже нагадали
        b = store.rpc("billing_balance", {"p_user": s["user_id"]})
        sub = b.get("subscription") or {}
        if sub.get("id") != s["id"]:
            continue  # є новіша активна підписка — нагадаємо перед її кінцем
        left, total = sub.get("credits_left", 0), sub.get("credits_included", 0)
        title = f"Підписка UniPars закінчується {_kyiv_date(end)}"
        body = (f"Лишилось {left} з {total} генерацій. Продовжте підписку, щоб не втратити їх." if left
                else "Генерації з підписки використано. Продовжте підписку, щоб і далі регенерувати звіти.")
        # спершу позначка, потім сповіщення: повторний запуск не надішле вдруге навіть після збою відправки
        store.update("subscriptions", {"id": s["id"]}, {"reminded_period_end": s["period_end"]})
        notify(store, s["user_id"], None, "subscription_ending", title, body, "/billing")
        pushed += push.send(store, s["user_id"], title, body, "/billing")
        reminded += 1
    return {"reminded": reminded, "pushed": pushed}
