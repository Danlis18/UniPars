-- Оплата (monobank / тестовий режим), підписки, баланс генерацій і перегенеровані приклади оформлення.
-- Усі зміни балансу й статусів робить лише backend (service role) після перевірки платежу.

do $$ begin
  create type payment_kind as enum ('single', 'subscription', 'topup');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payment_status as enum ('created', 'processing', 'success', 'failure', 'expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type regeneration_status as enum ('running', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- Разові генерації (покупка 47 ₴ або докупівля 18 ₴) — без терміну дії
create table if not exists billing_accounts (
  user_id uuid primary key references profiles (id) on delete cascade,
  credits int not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);

-- Підписка: 15 генерацій на 30 днів
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  credits_included int not null check (credits_included > 0),
  credits_left int not null check (credits_left >= 0),
  payment_id uuid,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);
create index if not exists subscriptions_user_idx on subscriptions (user_id, period_end desc);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  kind payment_kind not null,
  quantity int not null default 1 check (quantity between 1 and 100),
  amount_kop int not null check (amount_kop > 0),
  currency text not null default 'UAH',
  status payment_status not null default 'created',
  provider text not null check (provider in ('mock', 'monobank')),
  invoice_id text unique,
  page_url text,
  failure_reason text,
  applied_at timestamptz,          -- генерації зараховано (захист від подвійного зарахування)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_idx on payments (user_id, created_at desc);

-- Журнал змін балансу (аудит)
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  delta int not null,
  source text not null check (source in ('single', 'topup', 'subscription', 'generation', 'refund')),
  payment_id uuid references payments (id) on delete set null,
  regeneration_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on credit_ledger (user_id, created_at desc);

-- Перегенерований приклад оформлення: лише перегляд власником, без файлу для завантаження
create table if not exists regenerations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  university_id uuid not null references universities (id) on delete cascade,
  submission_id uuid not null references submissions (id) on delete cascade,
  task_id uuid not null references tasks (id) on delete cascade,
  options jsonb not null default '{}'::jsonb,
  status regeneration_status not null default 'running',
  result jsonb,
  error text,
  charged_from text check (charged_from in ('subscription', 'credits')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists regenerations_user_idx on regenerations (user_id, created_at desc);

-- ---------- RLS: користувач бачить лише своє, змінює все лише backend ----------
alter table billing_accounts enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;
alter table credit_ledger enable row level security;
alter table regenerations enable row level security;

drop policy if exists billing_own on billing_accounts;
create policy billing_own on billing_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists subscriptions_own on subscriptions;
create policy subscriptions_own on subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists payments_own on payments;
create policy payments_own on payments for select to authenticated using (user_id = auth.uid());
drop policy if exists ledger_own on credit_ledger;
create policy ledger_own on credit_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists regenerations_own on regenerations;
create policy regenerations_own on regenerations for select to authenticated using (user_id = auth.uid());
-- Політик insert/update/delete немає навмисно: баланс і результат змінює лише backend.
