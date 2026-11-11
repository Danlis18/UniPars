-- UniPars: базова схема
-- Увесь університетський контент несе university_id; узгодженість гарантують
-- складені зовнішні ключі (id, university_id).

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------- Довідники ----------
create type membership_role as enum ('student', 'moderator', 'admin');
create type post_type as enum ('material', 'question', 'explanation');
create type material_kind as enum ('notes', 'lab_example', 'practical', 'exam_prep', 'link');
create type post_visibility as enum ('university', 'group');
create type question_status as enum ('open', 'solved');
create type news_source_kind as enum ('json_api', 'rss', 'manual');
create type report_status as enum ('open', 'resolved', 'dismissed');

-- ---------- Профілі та університети ----------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  bio text default '',
  locale text not null default 'uk',
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  active_university_id uuid,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table universities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text not null,
  is_demo boolean not null default false,
  -- {"cross_university_sharing": false, "max_upload_mb": 25}
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table profiles
  add constraint profiles_active_university_fk
  foreign key (active_university_id) references universities (id) on delete set null;

create table faculties (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  name text not null,
  unique (id, university_id)
);

create table programs (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  faculty_id uuid not null,
  name text not null,
  code text,
  unique (id, university_id),
  foreign key (faculty_id, university_id) references faculties (id, university_id) on delete cascade
);

create table study_groups (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  program_id uuid not null,
  name text not null,
  course smallint check (course between 1 and 6),
  unique (id, university_id),
  foreign key (program_id, university_id) references programs (id, university_id) on delete cascade
);

create table university_memberships (
  user_id uuid not null references profiles (id) on delete cascade,
  university_id uuid not null references universities (id) on delete cascade,
  role membership_role not null default 'student',
  faculty_id uuid,
  program_id uuid,
  group_id uuid,
  course smallint check (course between 1 and 6),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, university_id),
  foreign key (faculty_id, university_id) references faculties (id, university_id),
  foreign key (program_id, university_id) references programs (id, university_id),
  foreign key (group_id, university_id) references study_groups (id, university_id)
);

-- ---------- Дисципліни ----------
create table subjects (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  slug text not null,
  name text not null,
  description text default '',
  created_at timestamptz not null default now(),
  unique (university_id, slug),
  unique (id, university_id)
);

-- Один предмет — кілька спеціальностей, без копій предмета.
create table subject_programs (
  subject_id uuid not null,
  program_id uuid not null,
  university_id uuid not null,
  course smallint,
  semester smallint check (semester between 1 and 12),
  primary key (subject_id, program_id),
  foreign key (subject_id, university_id) references subjects (id, university_id) on delete cascade,
  foreign key (program_id, university_id) references programs (id, university_id) on delete cascade
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null,
  subject_id uuid not null,
  name text not null,
  position int not null default 0,
  unique (id, university_id),
  unique (id, subject_id),
  foreign key (subject_id, university_id) references subjects (id, university_id) on delete cascade
);

create table subject_subscriptions (
  user_id uuid not null references profiles (id) on delete cascade,
  subject_id uuid not null references subjects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, subject_id)
);

-- ---------- Дописи ----------
create table posts (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete cascade,
  type post_type not null,
  subject_id uuid not null,
  topic_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 20000),
  visibility post_visibility not null default 'university',
  group_id uuid,
  status question_status,               -- лише для запитань
  accepted_comment_id uuid,
  is_hidden boolean not null default false,  -- модерація
  is_demo boolean not null default false,
  useful_count int not null default 0,
  comment_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  unique (id, university_id),
  foreign key (subject_id, university_id) references subjects (id, university_id),
  foreign key (topic_id, subject_id) references topics (id, subject_id),
  foreign key (group_id, university_id) references study_groups (id, university_id),
  check ((type = 'question') = (status is not null)),
  check ((visibility = 'group') = (group_id is not null))
);
create index posts_feed_idx on posts (university_id, created_at desc);
create index posts_subject_idx on posts (subject_id, created_at desc);
create index posts_search_idx on posts using gin (search);

create table material_details (
  post_id uuid primary key,
  university_id uuid not null,
  kind material_kind not null,
  link_url text,
  course smallint,
  semester smallint,
  program_id uuid,
  foreign key (post_id, university_id) references posts (id, university_id) on delete cascade,
  foreign key (program_id, university_id) references programs (id, university_id)
);

create table question_details (
  post_id uuid primary key,
  university_id uuid not null,
  tried text default '',
  unclear_step text default '',
  foreign key (post_id, university_id) references posts (id, university_id) on delete cascade
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  university_id uuid not null,
  uploader_id uuid not null references profiles (id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  foreign key (post_id, university_id) references posts (id, university_id) on delete cascade
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  university_id uuid not null,
  author_id uuid not null references profiles (id) on delete cascade,
  parent_id uuid references comments (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  is_accepted boolean not null default false,
  useful_count int not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (post_id, university_id) references posts (id, university_id) on delete cascade
);
create index comments_post_idx on comments (post_id, created_at);

alter table posts
  add constraint posts_accepted_comment_fk
  foreign key (accepted_comment_id) references comments (id) on delete set null;

create table reactions (
  user_id uuid not null references profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  kind text not null default 'useful' check (kind in ('useful')),
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id, kind)
);

create table bookmarks (
  user_id uuid not null references profiles (id) on delete cascade,
  post_id uuid not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  university_id uuid references universities (id) on delete cascade,
  kind text not null,      -- comment | answer_accepted | announcement | report_resolved
  title text not null,
  body text default '',
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- ---------- Новини ----------
create table news_sources (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  kind news_source_kind not null,
  name text not null,
  url text,                       -- для json_api та rss; null для manual
  config jsonb not null default '{}'::jsonb,  -- мапінг полів для json_api
  is_enabled boolean not null default true,
  refresh_minutes int not null default 30 check (refresh_minutes >= 5),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (id, university_id),
  check (kind = 'manual' or url is not null)
);

create table news_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  university_id uuid not null,
  external_id text not null,
  title text not null,
  summary text default '',
  url text,
  published_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),
  is_demo boolean not null default false,
  unique (source_id, external_id),
  foreign key (source_id, university_id) references news_sources (id, university_id) on delete cascade
);
create index news_items_uni_idx on news_items (university_id, published_at desc);

-- ---------- AI ----------
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  university_id uuid references universities (id) on delete set null,
  title text not null default 'Новий діалог',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user_idx on ai_conversations (user_id, updated_at desc);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  context_post_id uuid references posts (id) on delete set null,
  status text not null default 'complete' check (status in ('complete', 'partial', 'error')),
  created_at timestamptz not null default now()
);

-- ---------- Модерація ----------
create table reports (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  reporter_id uuid not null references profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  status report_status not null default 'open',
  resolved_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- ---------- Тригери ----------
-- Автоматичне створення профілю після реєстрації в Supabase Auth.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Користувач не може сам зробити себе адміністратором платформи.
create or replace function public.protect_profile_privileges() returns trigger
language plpgsql as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'is_platform_admin can only be changed by the service role';
  end if;
  return new;
end $$;

create trigger profiles_protect_privileges
  before update on profiles for each row execute function public.protect_profile_privileges();
