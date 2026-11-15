"""Навчальний рік і курс. Курс не зберігається «намертво»: він рахується від
року вступу, тож 1 вересня кожен студент автоматично переходить на наступний курс."""
from __future__ import annotations

import re
from datetime import date

MAX_COURSE = 6


def today() -> date:  # окрема функція — щоб тести могли підмінити дату
    return date.today()


def academic_year_start(d: date | None = None) -> int:
    d = d or today()
    return d.year if d.month >= 9 else d.year - 1


def course_from_entry(entry_year: int | None, d: date | None = None) -> int | None:
    if not entry_year:
        return None
    return max(1, min(academic_year_start(d) - int(entry_year) + 1, MAX_COURSE))


def entry_from_course(course: int, d: date | None = None) -> int:
    return academic_year_start(d) - int(course) + 1


def current_course(membership: dict) -> int | None:
    return course_from_entry(membership.get("entry_year")) or membership.get("course")


def group_for_course(name: str, course: int) -> str | None:
    """«ФЕП-21» на 3-му курсі → «ФЕП-31» (шифр групи містить номер курсу)."""
    m = re.match(r"^(.*-)(\d)(\d+)$", name or "")
    return f"{m.group(1)}{course}{m.group(3)}" if m else None
