"""Інтерфейс AI-провайдера. Щоб замінити провайдера — реалізуйте цей клас
і зареєструйте його у factory.py."""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Protocol


@dataclass
class ChatMessage:
    role: str  # "user" | "assistant"
    content: str


class AIUnavailable(Exception):
    """Провайдер недоступний / не налаштований / перевищив ліміт."""


class AIRefused(Exception):
    """Модель відмовилась відповідати на запит."""


class AIProvider(Protocol):
    name: str

    def stream(self, system: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        """Повертає текст відповіді частинами."""
        ...
