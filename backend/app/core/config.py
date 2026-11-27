"""Конфігурація з змінних середовища. Секрети живуть лише тут, на сервері."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _load_dotenv() -> None:
    env = Path(__file__).resolve().parents[2] / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def _origin(value: str) -> str:
    v = value.strip().strip("\"'").rstrip("/")
    if v and "://" not in v:
        v = "https://" + v
    return v


def _supabase_base(value: str) -> str:
    """Лише https://<ref>.supabase.co — без /rest/v1 чи інших шляхів, які часто копіюють разом з URL."""
    v = value.strip().strip("\"'")
    if not v:
        return ""
    if "://" not in v:
        v = "https://" + v
    from urllib.parse import urlparse

    p = urlparse(v)
    return f"{p.scheme}://{p.netloc}"


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_mode: str = "demo"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    storage_bucket: str = "attachments"
    ai_provider: str = "anthropic"
    ai_model: str = "claude-opus-5-5"
    anthropic_api_key: str = ""
    ai_timeout_seconds: int = 120
    ai_rate_limit_per_minute: int = 10
    max_upload_mb: int = 25
    file_link_secret: str = "change-me"
    news_sync_interval_seconds: int = 600
    bots_count: int = 8
    bots_interval_seconds: int = 300
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    demo_upload_dir: Path = Path(__file__).resolve().parents[2] / ".demo_uploads"
    # Оплата: mock — тестова сторінка оплати без грошей; monobank — інтернет-еквайринг monobank
    ai_chat_enabled: bool = False  # AI-чат окремо від регенерації: поки false — сторінка AI під «SOON»
    mock_payments_for_all: bool = False  # тестова оплата на продакшні лише для модерації/адміністраторів
    payment_provider: str = "mock"
    monobank_token: str = ""
    public_api_url: str = ""      # зовнішня адреса backend для webhook monobank
    frontend_url: str = "http://localhost:5173"  # куди повертати після оплати
    price_single_kop: int = 4700        # одна генерація — 47 ₴
    price_subscription_kop: int = 35000  # підписка — 350 ₴ / 30 днів
    subscription_credits: int = 15
    price_topup_kop: int = 1800          # докупівля понад підписку — 18 ₴ за генерацію
    free_generations: int = 3            # бета: безкоштовні генерації кожному користувачу (один раз); 0 — вимкнено
    # Реквізити продавця для публічної оферти (/offer). Без назви й коду справжня оплата не приймається.
    legal_name: str = ""        # напр. «ФОП Прізвище Ім'я По батькові»
    legal_tax_id: str = ""      # РНОКПП (ІПН) ФОП або код ЄДРПОУ
    legal_address: str = ""     # адреса реєстрації
    legal_iban: str = ""        # необов'язково
    legal_phone: str = ""       # необов'язково
    support_email: str = ""     # пошта для звернень і повернень

    @property
    def legal_ready(self) -> bool:
        return bool(self.legal_name and self.legal_tax_id and self.legal_address and self.support_email)

    @property
    def is_demo(self) -> bool:
        return self.app_mode == "demo"

    @property
    def chat_enabled(self) -> bool:
        """AI-чат доступний, лише коли є ключ і його явно ввімкнено (AI_CHAT_ENABLED=1); у демо — як раніше."""
        return self.ai_enabled and (self.ai_chat_enabled or self.is_demo)

    @property
    def ai_enabled(self) -> bool:
        if self.ai_provider == "anthropic":
            return bool(self.anthropic_api_key)
        return False


@lru_cache
def get_settings() -> Settings:
    _load_dotenv()
    e = os.environ.get
    return Settings(
        app_mode=e("APP_MODE", "demo"),
        supabase_url=_supabase_base(e("SUPABASE_URL", "")),
        supabase_service_role_key=e("SUPABASE_SERVICE_ROLE_KEY", ""),
        supabase_jwt_secret=e("SUPABASE_JWT_SECRET", ""),
        storage_bucket=e("STORAGE_BUCKET", "attachments"),
        ai_provider=e("AI_PROVIDER", "anthropic"),
        ai_model=e("AI_MODEL", "claude-opus-5-5"),
        anthropic_api_key=e("ANTHROPIC_API_KEY", ""),
        ai_timeout_seconds=_int("AI_TIMEOUT_SECONDS", 120),
        ai_rate_limit_per_minute=_int("AI_RATE_LIMIT_PER_MINUTE", 10),
        max_upload_mb=_int("MAX_UPLOAD_MB", 25),
        file_link_secret=e("FILE_LINK_SECRET", "change-me"),
        news_sync_interval_seconds=_int("NEWS_SYNC_INTERVAL_SECONDS", 600),
        bots_count=_int("BOTS_COUNT", 8),
        bots_interval_seconds=max(60, _int("BOTS_INTERVAL_SECONDS", 300)),
        # Браузер надсилає Origin без «/» у кінці — нормалізуємо, щоб не було помилок CORS
        cors_origins=[_origin(o) for o in e("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
        ai_chat_enabled=e("AI_CHAT_ENABLED", "").strip().lower() in ("1", "true", "yes"),
        mock_payments_for_all=e("MOCK_PAYMENTS_FOR_ALL", "").strip().lower() in ("1", "true", "yes"),
        payment_provider=e("PAYMENT_PROVIDER", "mock").strip().lower(),
        monobank_token=e("MONOBANK_TOKEN", "").strip(),
        public_api_url=e("PUBLIC_API_URL", "").strip().rstrip("/"),
        frontend_url=(e("FRONTEND_URL", "") or "http://localhost:5173").strip().rstrip("/"),
        price_single_kop=_int("PRICE_SINGLE_KOP", 4700),
        price_subscription_kop=_int("PRICE_SUBSCRIPTION_KOP", 35000),
        subscription_credits=_int("SUBSCRIPTION_CREDITS", 15),
        price_topup_kop=_int("PRICE_TOPUP_KOP", 1800),
        free_generations=_int("FREE_GENERATIONS", 3),
        legal_name=e("LEGAL_NAME", "").strip(),
        legal_tax_id=e("LEGAL_TAX_ID", "").strip(),
        legal_address=e("LEGAL_ADDRESS", "").strip(),
        legal_iban=e("LEGAL_IBAN", "").strip(),
        legal_phone=e("LEGAL_PHONE", "").strip(),
        support_email=e("SUPPORT_EMAIL", "").strip(),
    )
