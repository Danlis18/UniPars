-- Push-сповіщення в браузері (Web Push) і нагадування про кінець підписки за 3 дні.
-- Міграцію можна запускати повторно.

-- Браузери/пристрої, що дозволили push. endpoint — унікальна адреса push-сервісу браузера.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- Лише backend (service role): ключі шифрування push не віддаються клієнтам
alter table push_subscriptions enable row level security;

-- Для якого кінця періоду вже нагадали: продовження змінює period_end — і нагадування прийде знову
alter table subscriptions add column if not exists reminded_period_end timestamptz;
