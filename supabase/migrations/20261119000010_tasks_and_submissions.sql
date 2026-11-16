-- Навчальний посібник: завдання предметів (лабораторні, практичні, модулі, екзамени),
-- файли до завдань і подання студентів через модерацію.
-- Наявні дані не змінюються: дописи, вкладення й коментарі залишаються як є.
-- Матеріали без прив'язки адміністратор розподіляє до завдань (submissions.source_attachment_id).

-- Допоміжні функції прав (ті самі, що в міграції 2; create or replace — безпечно, якщо вони вже є)
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public.is_member(uni uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from university_memberships where user_id = auth.uid() and university_id = uni)
$$;

create or replace function public.has_role(uni uuid, roles membership_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from university_memberships
    where user_id = auth.uid() and university_id = uni and role = any (roles)
  )
$$;

create or replace function public.can_view_post(p posts) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
    or p.author_id = auth.uid()
    or (
      public.is_member(p.university_id)
      and (not p.is_hidden or public.has_role(p.university_id, array['moderator','admin']::membership_role[]))
      and (
        p.visibility = 'university'
        or exists (select 1 from university_memberships m
                   where m.user_id = auth.uid() and m.university_id = p.university_id and m.group_id = p.group_id)
      )
    )
$$;

create or replace function public.can_view_post_id(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_view_post(p) from posts p where p.id = pid), false)
$$;


do $$ begin
  create type task_kind as enum ('lab', 'practical', 'module', 'exam');
exception when duplicate_object then null; end $$;

do $$ begin
  create type submission_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------- Завдання ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references universities (id) on delete cascade,
  subject_id uuid not null,
  kind task_kind not null,
  number smallint not null check (number between 1 and 99),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 20000),
  deadline_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, kind, number),
  unique (id, university_id),
  foreign key (subject_id, university_id) references subjects (id, university_id) on delete cascade
);
create index if not exists tasks_subject_idx on tasks (subject_id, kind, number);
create index if not exists tasks_deadline_idx on tasks (university_id, deadline_at) where deadline_at is not null;

-- Файли умови від викладача / адміністратора
create table if not exists task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  university_id uuid not null,
  uploader_id uuid references profiles (id) on delete set null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  foreign key (task_id, university_id) references tasks (id, university_id) on delete cascade
);
create index if not exists task_files_task_idx on task_files (task_id);

-- ---------- Подання студентів ----------
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  university_id uuid not null,
  author_id uuid not null references profiles (id) on delete cascade,
  comment text not null default '' check (char_length(comment) <= 2000),
  status submission_status not null default 'pending',
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  reviewed_by uuid references profiles (id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  -- матеріал, перенесений адміністратором зі старого допису (не більше одного разу)
  source_attachment_id uuid unique references attachments (id) on delete set null,
  download_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, university_id) references tasks (id, university_id) on delete cascade,
  check (status <> 'rejected' or coalesce(char_length(btrim(review_note)), 0) > 0),
  check ((status = 'approved') = (published_at is not null))
);
create index if not exists submissions_task_idx on submissions (task_id, status, published_at desc);
create index if not exists submissions_author_idx on submissions (author_id, created_at desc);
create index if not exists submissions_queue_idx on submissions (university_id, status, created_at);

-- ---------- Питання форуму прив'язуються до завдання свого предмета ----------
alter table posts add column if not exists task_id uuid references tasks (id) on delete set null;
create index if not exists posts_task_idx on posts (task_id) where task_id is not null;

-- ---------- RLS (дзеркало перевірок backend; backend працює з service role) ----------
alter table tasks enable row level security;
alter table task_files enable row level security;
alter table submissions enable row level security;

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select to authenticated
  using (public.is_member(university_id) or public.is_platform_admin());
drop policy if exists tasks_write on tasks;
create policy tasks_write on tasks for all to authenticated
  using (public.has_role(university_id, array['moderator','admin']::membership_role[]))
  with check (public.has_role(university_id, array['moderator','admin']::membership_role[]));

drop policy if exists task_files_read on task_files;
create policy task_files_read on task_files for select to authenticated
  using (public.is_member(university_id) or public.is_platform_admin());
drop policy if exists task_files_write on task_files;
create policy task_files_write on task_files for all to authenticated
  using (public.has_role(university_id, array['moderator','admin']::membership_role[]))
  with check (public.has_role(university_id, array['moderator','admin']::membership_role[]));

-- Опубліковані бачать учасники університету; на розгляді й відхилені — лише автор і модерація
drop policy if exists submissions_read on submissions;
create policy submissions_read on submissions for select to authenticated
  using (
    (status = 'approved' and public.is_member(university_id))
    or author_id = auth.uid()
    or public.has_role(university_id, array['moderator','admin']::membership_role[])
    or public.is_platform_admin()
  );
-- Студент створює лише власне подання зі статусом «На розгляді»
drop policy if exists submissions_insert on submissions;
create policy submissions_insert on submissions for insert to authenticated
  with check (
    author_id = auth.uid() and public.is_member(university_id) and status = 'pending'
    and reviewed_by is null and reviewed_at is null and published_at is null
    and source_attachment_id is null and download_count = 0
  );
-- Змінювати статус може лише модерація
drop policy if exists submissions_review on submissions;
create policy submissions_review on submissions for update to authenticated
  using (public.has_role(university_id, array['moderator','admin']::membership_role[]))
  with check (public.has_role(university_id, array['moderator','admin']::membership_role[]));
-- Автор може відкликати подання, поки воно на розгляді
drop policy if exists submissions_delete on submissions;
create policy submissions_delete on submissions for delete to authenticated
  using (
    (author_id = auth.uid() and status = 'pending')
    or public.has_role(university_id, array['moderator','admin']::membership_role[])
  );

-- Файли (бакет attachments) лишаються без політик storage.objects:
-- їх завантажує й видає лише backend після перевірки прав.
