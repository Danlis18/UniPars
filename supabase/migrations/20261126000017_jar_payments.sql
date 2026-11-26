-- Оплата через monobank «Банку» з кодом у коментарі (PAYMENT_PROVIDER=jar). Міграцію можна запускати повторно.
--
-- Студент отримує код (напр. UP-7K3QX), переказує суму на Банку з цим кодом у коментарі.
-- Backend сам читає виписку Банки через особистий API monobank (webhook — лише сигнал «перевір виписку»,
-- його тілу не довіряємо), зберігає кожне надходження в jar_transfers і зараховує оплату з таким кодом.
-- Надходження без коду чи з меншою сумою чекають ручного зіставлення адміністратором.

alter table payments drop constraint if exists payments_provider_check;
alter table payments add constraint payments_provider_check check (provider in ('mock', 'monobank', 'jar'));
-- id транзакції банку, якою оплачено (одна транзакція — один платіж)
alter table payments add column if not exists provider_ref text;
create unique index if not exists payments_provider_ref_once on payments (provider_ref) where provider_ref is not null;

create table if not exists jar_transfers (
  id text primary key,                 -- id операції у виписці monobank
  amount_kop int not null,
  comment text,
  counter_name text,                   -- ім'я відправника з виписки
  received_at timestamptz not null,
  payment_id uuid references payments (id) on delete set null,
  matched_by uuid references profiles (id) on delete set null,  -- null — зіставлено автоматично за кодом
  matched_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists jar_transfers_unmatched on jar_transfers (received_at desc) where payment_id is null;
create unique index if not exists jar_transfers_payment_once on jar_transfers (payment_id) where payment_id is not null;

-- Лише backend (service role): політик для користувачів немає навмисно
alter table jar_transfers enable row level security;
