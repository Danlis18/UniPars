-- Баланс = сума записів credit_ledger. Усі зміни балансу — атомарні функції з блокуванням на користувача.
--
-- Було: backend читав лічильник (billing_accounts.credits / subscriptions.credits_left), рахував нове значення
-- і записував його окремим запитом — два одночасні запити могли загубити списання чи поповнення,
-- а журнал не знав, з якого «гаманця» (разові чи підписка) списано генерацію.
-- Стало: у журналі кожен запис має гаманець (pool) і, для підписки, subscription_id;
-- баланс рахується як сума журналу; лічильники лишаються лише кешем, який оновлюють ці ж функції.
-- Міграцію можна запускати повторно.

-- ---------- 1. Гаманець у журналі ----------
alter table credit_ledger add column if not exists pool text;
alter table credit_ledger add column if not exists subscription_id uuid references subscriptions (id) on delete cascade;

alter table credit_ledger drop constraint if exists credit_ledger_source_check;
alter table credit_ledger add constraint credit_ledger_source_check
  check (source in ('single', 'topup', 'subscription', 'generation', 'refund', 'adjustment'));

-- ---------- 2. Заповнення гаманців для наявних записів (лише там, де pool ще порожній) ----------
-- оплати разових генерацій і докупівлі — разовий гаманець
update credit_ledger set pool = 'credits' where pool is null and source in ('single', 'topup');
-- оплата підписки — гаманець тієї підписки, яку створила або продовжила ця оплата
update credit_ledger l set pool = 'subscription',
  subscription_id = coalesce(
    (select s.id from subscriptions s where s.payment_id = l.payment_id limit 1),
    (select s.id from subscriptions s where s.user_id = l.user_id and s.period_start <= l.created_at
       order by s.period_end desc limit 1))
where l.pool is null and l.source = 'subscription';
-- списання й повернення — гаманець, з якого списала генерація (regenerations.charged_from)
update credit_ledger l set pool = case when r.charged_from = 'subscription' then 'subscription' else 'credits' end,
  subscription_id = case when r.charged_from = 'subscription' then
    (select s.id from subscriptions s where s.user_id = l.user_id and s.period_start <= l.created_at
       and s.period_end >= l.created_at order by s.period_end desc limit 1) end
from regenerations r
where l.pool is null and l.source in ('generation', 'refund') and r.id = l.regeneration_id;
-- те, що не вдалося зіставити, — у разовий гаманець (вирівнюється на кроці 3)
update credit_ledger set pool = 'credits', subscription_id = null
where pool is null or (pool = 'subscription' and subscription_id is null);

-- ---------- 3. Вирівнювання: журнал має збігатися з лічильниками, які досі були джерелом правди ----------
insert into credit_ledger (user_id, delta, source, pool)
select a.user_id, a.credits - coalesce(sum(l.delta), 0), 'adjustment', 'credits'
from billing_accounts a
left join credit_ledger l on l.user_id = a.user_id and l.pool = 'credits'
group by a.user_id, a.credits
having a.credits <> coalesce(sum(l.delta), 0);

insert into credit_ledger (user_id, delta, source, pool, subscription_id)
select s.user_id, s.credits_left - coalesce(sum(l.delta), 0), 'adjustment', 'subscription', s.id
from subscriptions s
left join credit_ledger l on l.subscription_id = s.id and l.pool = 'subscription'
group by s.id, s.user_id, s.credits_left
having s.credits_left <> coalesce(sum(l.delta), 0);

alter table credit_ledger alter column pool set not null;
alter table credit_ledger drop constraint if exists credit_ledger_pool_check;
alter table credit_ledger add constraint credit_ledger_pool_check check (
  (pool = 'credits' and subscription_id is null) or (pool = 'subscription' and subscription_id is not null));

-- ---------- 4. Захист від подвійного проведення ----------
create unique index if not exists credit_ledger_payment_once on credit_ledger (payment_id)
  where source in ('single', 'topup', 'subscription') and payment_id is not null;
create unique index if not exists credit_ledger_charge_once on credit_ledger (regeneration_id)
  where source = 'generation';
create unique index if not exists credit_ledger_refund_once on credit_ledger (regeneration_id)
  where source = 'refund';
create index if not exists credit_ledger_sub_idx on credit_ledger (subscription_id) where subscription_id is not null;

-- ---------- 5. Функції ----------
-- Блокування на користувача до кінця транзакції: усі зміни балансу одного користувача йдуть по черзі
create or replace function billing_lock(p_user uuid) returns void
language sql as $$ select pg_advisory_xact_lock(hashtextextended('billing:' || p_user::text, 0)) $$;

-- Кеш лічильників = сума журналу (для адмінки й старих запитів; джерело правди — журнал)
create or replace function billing_sync_cache(p_user uuid) returns void
language plpgsql as $$
begin
  insert into billing_accounts (user_id, credits, updated_at)
  values (p_user, (select coalesce(sum(delta), 0) from credit_ledger where user_id = p_user and pool = 'credits'), now())
  on conflict (user_id) do update set credits = excluded.credits, updated_at = now();
  update subscriptions s set credits_left = coalesce((select sum(delta) from credit_ledger l where l.subscription_id = s.id), 0)
  where s.user_id = p_user;
end $$;

-- Баланс: разові генерації + залишок активної підписки (усе — з журналу)
create or replace function billing_balance(p_user uuid) returns jsonb
language plpgsql stable as $$
declare
  v_credits int;
  v_sub record;
  v_left int;
begin
  select coalesce(sum(delta), 0) into v_credits from credit_ledger where user_id = p_user and pool = 'credits';
  select * into v_sub from subscriptions
    where user_id = p_user and period_start <= now() and period_end >= now() order by period_end desc limit 1;
  if found then
    select coalesce(sum(delta), 0) into v_left from credit_ledger where subscription_id = v_sub.id;
    return jsonb_build_object('credits', v_credits, 'subscription', jsonb_build_object(
      'id', v_sub.id, 'period_end', v_sub.period_end, 'credits_left', v_left, 'credits_included', v_sub.credits_included));
  end if;
  return jsonb_build_object('credits', v_credits, 'subscription', null);
end $$;

-- Списання однієї генерації: спершу з підписки, потім разові. Повторний виклик для тієї ж генерації нічого не списує.
-- Немає генерацій — помилка 'no_credits'. Повертає гаманець: 'subscription' або 'credits'.
create or replace function billing_consume(p_user uuid, p_regeneration uuid) returns text
language plpgsql as $$
declare
  v_pool text;
  v_sub uuid;
begin
  perform billing_lock(p_user);
  select pool into v_pool from credit_ledger where regeneration_id = p_regeneration and source = 'generation';
  if found then
    return v_pool;
  end if;
  select s.id into v_sub from subscriptions s
    where s.user_id = p_user and s.period_start <= now() and s.period_end >= now()
      and (select coalesce(sum(delta), 0) from credit_ledger l where l.subscription_id = s.id) > 0
    order by s.period_end limit 1;
  if v_sub is not null then
    v_pool := 'subscription';
  elsif (select coalesce(sum(delta), 0) from credit_ledger where user_id = p_user and pool = 'credits') > 0 then
    v_pool := 'credits';
  else
    raise exception 'no_credits' using errcode = 'P0402';
  end if;
  insert into credit_ledger (user_id, delta, source, pool, subscription_id, regeneration_id)
  values (p_user, -1, 'generation', v_pool, v_sub, p_regeneration);
  perform billing_sync_cache(p_user);
  return v_pool;
end $$;

-- Повернення генерації в той самий гаманець, з якого її списали. Рівно один раз; повертає, чи було повернення.
create or replace function billing_refund(p_regeneration uuid) returns boolean
language plpgsql as $$
declare
  v_charge record;
begin
  select * into v_charge from credit_ledger where regeneration_id = p_regeneration and source = 'generation';
  if not found then
    return false;
  end if;
  perform billing_lock(v_charge.user_id);
  if exists (select 1 from credit_ledger where regeneration_id = p_regeneration and source = 'refund') then
    return false;
  end if;
  insert into credit_ledger (user_id, delta, source, pool, subscription_id, regeneration_id)
  values (v_charge.user_id, 1, 'refund', v_charge.pool, v_charge.subscription_id, p_regeneration);
  perform billing_sync_cache(v_charge.user_id);
  return true;
end $$;

-- Новий статус платежу; успішний платіж ніколи не понижується; зарахування — рівно один раз.
-- Повертає рядок платежу після зміни.
-- p_sub_credits — скільки генерацій дає підписка (налаштування backend, SUBSCRIPTION_CREDITS)
create or replace function billing_set_status(p_payment uuid, p_status text, p_reason text default null, p_sub_credits int default 15) returns jsonb
language plpgsql as $$
declare
  v_pay payments;
  v_sub uuid;
  v_credits int := greatest(coalesce(p_sub_credits, 15), 1);
begin
  select * into v_pay from payments where id = p_payment for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0404';
  end if;
  if v_pay.status <> 'success' and v_pay.status::text <> p_status then
    update payments set status = p_status::payment_status, failure_reason = p_reason, updated_at = now()
      where id = p_payment returning * into v_pay;
  end if;
  if v_pay.status = 'success' and v_pay.applied_at is null then
    perform billing_lock(v_pay.user_id);
    update payments set applied_at = now() where id = p_payment returning * into v_pay;
    if v_pay.kind in ('single', 'topup') then
      insert into credit_ledger (user_id, delta, source, pool, payment_id)
      values (v_pay.user_id, v_pay.quantity, v_pay.kind::text, 'credits', v_pay.id);
    else
      select id into v_sub from subscriptions
        where user_id = v_pay.user_id and period_start <= now() and period_end >= now() order by period_end desc limit 1;
      if v_sub is not null then  -- продовження: +30 днів і +генерації
        update subscriptions set period_end = period_end + interval '30 days',
          credits_included = credits_included + v_credits where id = v_sub;
      else
        insert into subscriptions (user_id, period_start, period_end, credits_included, credits_left, payment_id)
        values (v_pay.user_id, now(), now() + interval '30 days', v_credits, 0, v_pay.id) returning id into v_sub;
      end if;
      insert into credit_ledger (user_id, delta, source, pool, subscription_id, payment_id)
      values (v_pay.user_id, v_credits, 'subscription', 'subscription', v_sub, v_pay.id);
    end if;
    perform billing_sync_cache(v_pay.user_id);
  end if;
  return to_jsonb(v_pay);
end $$;

-- Звірка для моніторингу: користувачі, в яких кеш розійшовся з журналом (має бути порожньо)
create or replace view billing_reconciliation as
select a.user_id, a.credits as cached, coalesce(sum(l.delta), 0) as ledger
from billing_accounts a
left join credit_ledger l on l.user_id = a.user_id and l.pool = 'credits'
group by a.user_id, a.credits
having a.credits <> coalesce(sum(l.delta), 0);

-- Викликає лише backend (service role); користувачі через API напряму — ні
do $$
declare f text;
begin
  foreach f in array array['billing_lock(uuid)', 'billing_sync_cache(uuid)', 'billing_balance(uuid)',
    'billing_consume(uuid, uuid)', 'billing_refund(uuid)', 'billing_set_status(uuid, text, text, int)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
-- view обходить RLS, тому закриваємо його від ролей API (Supabase видає їм права на нові об'єкти за замовчуванням)
revoke all on billing_reconciliation from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on billing_reconciliation from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on billing_reconciliation from authenticated; end if;
end $$;
