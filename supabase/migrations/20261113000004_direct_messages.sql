-- UniPars: особисті повідомлення (діалоги 1:1).
-- Правило: написати можна лише тому, хто на вас підписаний (захист від спаму).
-- Безпечно запускати повторно.

create table if not exists dm_conversations (
  id uuid primary key default gen_random_uuid(),
  -- впорядкована пара учасників «меньший_id:більший_id» — один діалог на пару
  pair_key text not null unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists dm_members (
  conversation_id uuid not null references dm_conversations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists dm_members_user_idx on dm_members (user_id);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references dm_conversations (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists dm_messages_conv_idx on dm_messages (conversation_id, created_at desc);

-- ---------- RLS: лише учасники діалогу ----------
create or replace function public.is_dm_member(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dm_members where conversation_id = conv and user_id = auth.uid())
$$;

alter table dm_conversations enable row level security;
alter table dm_members enable row level security;
alter table dm_messages enable row level security;

drop policy if exists dm_conv_read on dm_conversations;
create policy dm_conv_read on dm_conversations for select to authenticated using (public.is_dm_member(id));

drop policy if exists dm_members_read on dm_members;
create policy dm_members_read on dm_members for select to authenticated using (public.is_dm_member(conversation_id));
drop policy if exists dm_members_mark_read on dm_members;
create policy dm_members_mark_read on dm_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists dm_messages_read on dm_messages;
create policy dm_messages_read on dm_messages for select to authenticated using (public.is_dm_member(conversation_id));
drop policy if exists dm_messages_send on dm_messages;
create policy dm_messages_send on dm_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_dm_member(conversation_id));
-- Створення діалогів і перевірку «хто кому може писати» виконує backend (service role).
