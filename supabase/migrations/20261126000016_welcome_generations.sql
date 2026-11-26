-- Безкоштовні генерації на старт (бета): кожен користувач отримує їх рівно один раз.
-- Кількість задає backend (FREE_GENERATIONS); нарахування — запис 'welcome' у журналі разових генерацій.
-- Застосовувати після міграції 15. Міграцію можна запускати повторно.

alter table credit_ledger drop constraint if exists credit_ledger_source_check;
alter table credit_ledger add constraint credit_ledger_source_check
  check (source in ('single', 'topup', 'subscription', 'generation', 'refund', 'adjustment',
                    'payment_refund', 'payment_refund_reversal', 'welcome'));

create unique index if not exists credit_ledger_welcome_once on credit_ledger (user_id) where source = 'welcome';

-- Нараховує p_amount генерацій, якщо користувач їх ще не отримував. Повертає, чи було нарахування.
create or replace function billing_grant_welcome(p_user uuid, p_amount int) returns boolean
language plpgsql as $$
begin
  if coalesce(p_amount, 0) <= 0 then
    return false;
  end if;
  perform billing_lock(p_user);
  if exists (select 1 from credit_ledger where user_id = p_user and source = 'welcome') then
    return false;
  end if;
  insert into credit_ledger (user_id, delta, source, pool) values (p_user, p_amount, 'welcome', 'credits');
  perform billing_sync_cache(p_user);
  return true;
end $$;

-- Викликає лише backend (service role)
revoke all on function billing_grant_welcome(uuid, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function billing_grant_welcome(uuid, int) from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on function billing_grant_welcome(uuid, int) from authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function billing_grant_welcome(uuid, int) to service_role; end if;
end $$;
