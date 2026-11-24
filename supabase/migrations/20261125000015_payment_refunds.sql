-- Повернення коштів за оплати (оферта, розділ 5). Міграцію можна запускати повторно.
--
-- Правила (без позначки «примусово»):
--   * не пізніше 14 днів від оплати;
--   * разові генерації й докупівля — лише невикористані: не більше, ніж куплено цим платежем
--     і ще не повернено, і не більше поточного балансу разових генерацій;
--   * підписка — лише повністю й лише якщо з цієї підписки не використано жодної генерації.
-- «Примусово» (подвійна оплата, результат не відповідає опису) — без цих обмежень; генерації
-- забираються в межах того, що лишилося на балансі.
--
-- Порядок: billing_refund_start в одній транзакції забирає генерації (запис у журналі) і створює
-- повернення зі статусом pending → backend просить банк повернути гроші → billing_refund_finish
-- ставить success або, якщо банк відмовив, failure і повертає генерації та підписку як було.

alter table credit_ledger drop constraint if exists credit_ledger_source_check;
alter table credit_ledger add constraint credit_ledger_source_check
  check (source in ('single', 'topup', 'subscription', 'generation', 'refund', 'adjustment',
                    'payment_refund', 'payment_refund_reversal'));

-- Повернена підписка скасовується (canceled_at) і більше не вважається активною.
-- Функції з міграції 14 оновлено: активна підписка — ще й не скасована.
alter table subscriptions add column if not exists canceled_at timestamptz;

create or replace function billing_balance(p_user uuid) returns jsonb
language plpgsql stable as $$
declare
  v_credits int;
  v_sub record;
  v_left int;
begin
  select coalesce(sum(delta), 0) into v_credits from credit_ledger where user_id = p_user and pool = 'credits';
  select * into v_sub from subscriptions
    where user_id = p_user and period_start <= now() and period_end >= now() and canceled_at is null order by period_end desc limit 1;
  if found then
    select coalesce(sum(delta), 0) into v_left from credit_ledger where subscription_id = v_sub.id;
    return jsonb_build_object('credits', v_credits, 'subscription', jsonb_build_object(
      'id', v_sub.id, 'period_end', v_sub.period_end, 'credits_left', v_left, 'credits_included', v_sub.credits_included));
  end if;
  return jsonb_build_object('credits', v_credits, 'subscription', null);
end $$;

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
    where s.user_id = p_user and s.period_start <= now() and s.period_end >= now() and s.canceled_at is null
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
        where user_id = v_pay.user_id and period_start <= now() and period_end >= now() and canceled_at is null order by period_end desc limit 1;
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

create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  amount_kop int not null check (amount_kop > 0),
  generations int not null check (generations > 0),       -- за скільки генерацій повертаємо гроші
  credits_removed int not null default 0 check (credits_removed >= 0),  -- скільки генерацій забрали з балансу
  status text not null default 'pending' check (status in ('pending', 'success', 'failure')),
  reason text not null check (length(reason) between 3 and 500),
  forced boolean not null default false,
  created_by uuid references profiles (id) on delete set null,
  failure_reason text,
  prev_period_end timestamptz,        -- для відкату підписки, якщо банк відмовив
  prev_credits_included int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refunds_payment_idx on refunds (payment_id);
create index if not exists refunds_user_idx on refunds (user_id, created_at desc);
create unique index if not exists refunds_one_pending on refunds (payment_id) where status = 'pending';

alter table credit_ledger add column if not exists refund_id uuid references refunds (id) on delete set null;
create unique index if not exists credit_ledger_payment_refund_once on credit_ledger (refund_id) where source = 'payment_refund';
create unique index if not exists credit_ledger_refund_reversal_once on credit_ledger (refund_id) where source = 'payment_refund_reversal';

alter table refunds enable row level security;
drop policy if exists refunds_own on refunds;
create policy refunds_own on refunds for select to authenticated using (user_id = auth.uid());

-- ---------- Скільки можна повернути за платіж ----------
create or replace function billing_refund_quote(p_payment uuid) returns jsonb
language plpgsql stable as $$
declare
  v_pay payments;
  v_done_gen int;
  v_done_kop int;
  v_left_gen int;
  v_unit int;
  v_balance int;
  v_sub uuid;
  v_used int;
  v_can int := 0;
  v_blocked text;
begin
  select * into v_pay from payments where id = p_payment;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0404';
  end if;
  select coalesce(sum(generations), 0), coalesce(sum(amount_kop), 0) into v_done_gen, v_done_kop
    from refunds where payment_id = p_payment and status in ('pending', 'success');
  if v_pay.status <> 'success' or v_pay.applied_at is null then
    v_blocked := 'not_paid';
  elsif exists (select 1 from refunds where payment_id = p_payment and status = 'pending') then
    v_blocked := 'pending';
  end if;
  if v_pay.kind in ('single', 'topup') then
    v_left_gen := v_pay.quantity - v_done_gen;
    v_unit := v_pay.amount_kop / v_pay.quantity;
    select coalesce(sum(delta), 0) into v_balance from credit_ledger where user_id = v_pay.user_id and pool = 'credits';
    v_can := greatest(least(v_left_gen, v_balance), 0);
  else
    select subscription_id, delta into v_sub, v_left_gen from credit_ledger
      where payment_id = p_payment and source = 'subscription' limit 1;
    v_left_gen := case when v_done_gen > 0 then 0 else coalesce(v_left_gen, 0) end;
    v_unit := v_pay.amount_kop;  -- підписка повертається лише повністю
    select coalesce(sum(delta), 0) into v_balance from credit_ledger where subscription_id = v_sub;
    select coalesce(-sum(delta), 0) into v_used from credit_ledger
      where subscription_id = v_sub and source in ('generation', 'refund');
    v_can := case when v_used = 0 then v_left_gen else 0 end;
    if v_used > 0 and v_blocked is null then v_blocked := 'subscription_used'; end if;
  end if;
  if v_blocked is null and v_pay.created_at < now() - interval '14 days' then
    v_blocked := 'expired';
  end if;
  if v_blocked is null and v_can = 0 then
    v_blocked := case when v_left_gen <= 0 then 'already_refunded' else 'used' end;
  end if;
  return jsonb_build_object(
    'kind', v_pay.kind, 'quantity', v_pay.quantity, 'amount_kop', v_pay.amount_kop,
    'refunded_generations', v_done_gen, 'refunded_kop', v_done_kop,
    'max_generations', greatest(coalesce(v_left_gen, 0), 0),   -- межа для примусового повернення
    'refundable_generations', case when v_blocked is null then v_can else 0 end,
    'unit_kop', v_unit, 'balance', v_balance, 'blocked', v_blocked);
end $$;

-- ---------- Початок повернення: забрати генерації й зафіксувати суму ----------
create or replace function billing_refund_start(p_payment uuid, p_generations int, p_reason text,
                                                p_admin uuid, p_force boolean default false) returns jsonb
language plpgsql as $$
declare
  v_pay payments;
  v_q jsonb;
  v_n int;
  v_amount int;
  v_take int;
  v_sub subscriptions;
  v_refund refunds;
begin
  select * into v_pay from payments where id = p_payment for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0404';
  end if;
  perform billing_lock(v_pay.user_id);
  v_q := billing_refund_quote(p_payment);
  if v_q->>'blocked' in ('not_paid', 'pending') then
    raise exception 'refund_%', v_q->>'blocked' using errcode = 'P0409';
  end if;
  if v_pay.kind = 'subscription' then
    v_n := (v_q->>'max_generations')::int;  -- підписка — лише повністю
  else
    v_n := coalesce(p_generations, 0);
  end if;
  if v_n <= 0 or v_n > (v_q->>'max_generations')::int then
    raise exception 'refund_bad_amount' using errcode = 'P0422';
  end if;
  if not p_force and (v_q->>'blocked' is not null or v_n > (v_q->>'refundable_generations')::int) then
    raise exception 'refund_%', coalesce(v_q->>'blocked', 'used') using errcode = 'P0409';
  end if;
  v_amount := case when v_pay.kind = 'subscription' then v_pay.amount_kop else v_n * (v_q->>'unit_kop')::int end;
  v_take := least(v_n, greatest((v_q->>'balance')::int, 0));

  insert into refunds (payment_id, user_id, amount_kop, generations, credits_removed, reason, forced, created_by)
  values (p_payment, v_pay.user_id, v_amount, v_n, v_take, p_reason, coalesce(p_force, false), p_admin)
  returning * into v_refund;

  if v_pay.kind = 'subscription' then
    select s.* into v_sub from subscriptions s
      join credit_ledger l on l.subscription_id = s.id and l.payment_id = p_payment and l.source = 'subscription' limit 1;
    update refunds set prev_period_end = v_sub.period_end, prev_credits_included = v_sub.credits_included
      where id = v_refund.id returning * into v_refund;
    -- забираємо оплачені 30 днів; якщо від підписки нічого не лишається — скасовуємо її зараз
    if v_sub.period_end - interval '30 days' <= now() then
      update subscriptions set canceled_at = now() where id = v_sub.id;
    else
      update subscriptions set period_end = period_end - interval '30 days',
        credits_included = greatest(credits_included - v_n, 1) where id = v_sub.id;
    end if;
    if v_take > 0 then
      insert into credit_ledger (user_id, delta, source, pool, subscription_id, payment_id, refund_id)
      values (v_pay.user_id, -v_take, 'payment_refund', 'subscription', v_sub.id, p_payment, v_refund.id);
    end if;
  elsif v_take > 0 then
    insert into credit_ledger (user_id, delta, source, pool, payment_id, refund_id)
    values (v_pay.user_id, -v_take, 'payment_refund', 'credits', p_payment, v_refund.id);
  end if;
  perform billing_sync_cache(v_pay.user_id);
  return to_jsonb(v_refund);
end $$;

-- ---------- Завершення: банк повернув гроші або відмовив ----------
create or replace function billing_refund_finish(p_refund uuid, p_success boolean, p_failure text default null) returns jsonb
language plpgsql as $$
declare
  v_refund refunds;
  v_take credit_ledger;
begin
  select * into v_refund from refunds where id = p_refund for update;
  if not found then
    raise exception 'refund_not_found' using errcode = 'P0404';
  end if;
  if v_refund.status <> 'pending' then
    return to_jsonb(v_refund);  -- повторний виклик нічого не змінює
  end if;
  perform billing_lock(v_refund.user_id);
  if p_success then
    update refunds set status = 'success', updated_at = now() where id = p_refund returning * into v_refund;
    return to_jsonb(v_refund);
  end if;
  -- банк відмовив: повертаємо генерації й підписку як було
  select * into v_take from credit_ledger where refund_id = p_refund and source = 'payment_refund';
  if found then
    insert into credit_ledger (user_id, delta, source, pool, subscription_id, payment_id, refund_id)
    values (v_take.user_id, -v_take.delta, 'payment_refund_reversal', v_take.pool, v_take.subscription_id, v_take.payment_id, p_refund);
  end if;
  if v_refund.prev_period_end is not null then
    update subscriptions s set period_end = v_refund.prev_period_end, credits_included = v_refund.prev_credits_included,
      canceled_at = null
    from credit_ledger l
    where l.payment_id = v_refund.payment_id and l.source = 'subscription' and s.id = l.subscription_id;
  end if;
  update refunds set status = 'failure', failure_reason = left(coalesce(p_failure, 'Банк відхилив повернення'), 500),
    updated_at = now() where id = p_refund returning * into v_refund;
  perform billing_sync_cache(v_refund.user_id);
  return to_jsonb(v_refund);
end $$;

-- Викликає лише backend (service role)
do $$
declare f text;
begin
  foreach f in array array['billing_refund_quote(uuid)', 'billing_refund_start(uuid, int, text, uuid, boolean)',
                           'billing_refund_finish(uuid, boolean, text)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
