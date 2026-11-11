"""Адаптер Claude API (Anthropic)."""
from __future__ import annotations

from typing import AsyncIterator

import anthropic

from .base import AIRefused, AIUnavailable, ChatMessage


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, timeout: int) -> None:
        self.client = anthropic.AsyncAnthropic(api_key=api_key, timeout=timeout, max_retries=2)
        self.model = model

    async def stream(self, system: str, messages: list[ChatMessage]) -> AsyncIterator[str]:
        try:
            async with self.client.beta.messages.stream(
                model=self.model,
                max_tokens=64000,
                # Якщо модель відмовить, сервер автоматично спробує резервну модель
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                thinking={"type": "adaptive"},
                output_config={"effort": "medium"},
                system=system,
                messages=[{"role": m.role, "content": m.content} for m in messages],
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()
                if final.stop_reason == "refusal":
                    raise AIRefused()
        except AIRefused:
            raise
        except anthropic.AuthenticationError as e:
            raise AIUnavailable("Невірний ключ AI-провайдера") from e
        except anthropic.RateLimitError as e:
            raise AIUnavailable("AI-провайдер тимчасово перевантажений, спробуйте за хвилину") from e
        except anthropic.APITimeoutError as e:
            raise AIUnavailable("AI не відповів вчасно") from e
        except anthropic.APIConnectionError as e:
            raise AIUnavailable("Немає з'єднання з AI-провайдером") from e
        except anthropic.APIStatusError as e:
            raise AIUnavailable(f"Помилка AI-провайдера ({e.status_code})") from e
