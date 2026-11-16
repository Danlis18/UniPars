-- Відновлення прав доступу (RLS) з міграції 2 у безпечному для повторного запуску вигляді.
-- Потрібна, якщо міграцію 20261111000002_rls.sql на проєкті не було застосовано:
-- функції створюються через create or replace, кожна політика спершу видаляється (drop policy if exists).
-- Дані не змінюються.

-- UniPars: політики доступу (RLS) і приватне сховище.
-- Backend працює з service-role ключем і сам перевіряє права (services/access.py).
-- Ці політики — другий рубіж: вони захищають дані, якщо хтось звертається
-- до PostgREST напряму з anon-ключем і JWT користувача.

-- ---------- Допоміжні функції ----------
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

-- ---------- Увімкнення RLS ----------
alter table profiles enable row level security;
alter table universities enable row level security;
alter table faculties enable row level security;
alter table programs enable row level security;
alter table study_groups enable row level security;
alter table university_memberships enable row level security;
alter table subjects enable row level security;
alter table subject_programs enable row level security;
alter table topics enable row level security;
alter table subject_subscriptions enable row level security;
alter table posts enable row level security;
alter table material_details enable row level security;
alter table question_details enable row level security;
alter table attachments enable row level security;
alter table comments enable row level security;
alter table reactions enable row level security;
alter table bookmarks enable row level security;
alter table notifications enable row level security;
alter table news_sources enable row level security;
alter table news_items enable row level security;
alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;
alter table reports enable row level security;

-- ---------- Профілі ----------
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- is_platform_admin захищено тригером protect_profile_privileges.

-- ---------- Каталог університету (читають усі авторизовані: потрібно для онбордингу) ----------
drop policy if exists universities_read on universities;
create policy universities_read on universities for select to authenticated using (true);
drop policy if exists universities_admin on universities;
create policy universities_admin on universities for update to authenticated
  using (public.has_role(id, array['admin']::membership_role[]));

drop policy if exists faculties_read on faculties;
create policy faculties_read on faculties for select to authenticated using (true);
drop policy if exists programs_read on programs;
create policy programs_read on programs for select to authenticated using (true);
drop policy if exists groups_read on study_groups;
create policy groups_read on study_groups for select to authenticated using (true);
drop policy if exists subjects_read on subjects;
create policy subjects_read on subjects for select to authenticated using (public.is_member(university_id) or public.is_platform_admin());
drop policy if exists subject_programs_read on subject_programs;
create policy subject_programs_read on subject_programs for select to authenticated using (public.is_member(university_id) or public.is_platform_admin());
drop policy if exists topics_read on topics;
create policy topics_read on topics for select to authenticated using (public.is_member(university_id) or public.is_platform_admin());

drop policy if exists faculties_admin on faculties;
create policy faculties_admin on faculties for all to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]))
  with check (public.has_role(university_id, array['admin']::membership_role[]));
drop policy if exists programs_admin on programs;
create policy programs_admin on programs for all to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]))
  with check (public.has_role(university_id, array['admin']::membership_role[]));
drop policy if exists groups_admin on study_groups;
create policy groups_admin on study_groups for all to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]))
  with check (public.has_role(university_id, array['admin']::membership_role[]));
drop policy if exists subjects_admin on subjects;
create policy subjects_admin on subjects for all to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]))
  with check (public.has_role(university_id, array['admin']::membership_role[]));
drop policy if exists subject_programs_admin on subject_programs;
create policy subject_programs_admin on subject_programs for all to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]))
  with check (public.has_role(university_id, array['admin']::membership_role[]));
drop policy if exists topics_admin on topics;
create policy topics_admin on topics for all to authenticated
  using (public.has_role(university_id, array['admin','moderator']::membership_role[]))
  with check (public.has_role(university_id, array['admin','moderator']::membership_role[]));

-- ---------- Членства ----------
drop policy if exists memberships_read on university_memberships;
create policy memberships_read on university_memberships for select to authenticated
  using (user_id = auth.uid() or public.has_role(university_id, array['admin','moderator']::membership_role[]));
-- Вступ лише з роллю student.
drop policy if exists memberships_join on university_memberships;
create policy memberships_join on university_memberships for insert to authenticated
  with check (user_id = auth.uid() and role = 'student');
-- Оновлення власного навчального контексту без зміни ролі.
drop policy if exists memberships_update_own on university_memberships;
create policy memberships_update_own on university_memberships for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and role = (select m.role from university_memberships m
                                               where m.user_id = auth.uid() and m.university_id = university_memberships.university_id));
drop policy if exists memberships_admin on university_memberships;
create policy memberships_admin on university_memberships for update to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]));

-- ---------- Підписки ----------
drop policy if exists subs_own on subject_subscriptions;
create policy subs_own on subject_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Дописи ----------
drop policy if exists posts_read on posts;
create policy posts_read on posts for select to authenticated using (public.can_view_post(posts));
drop policy if exists posts_insert on posts;
create policy posts_insert on posts for insert to authenticated
  with check (author_id = auth.uid() and public.is_member(university_id) and not is_hidden);
drop policy if exists posts_update_own on posts;
create policy posts_update_own on posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists posts_moderate on posts;
create policy posts_moderate on posts for update to authenticated
  using (public.has_role(university_id, array['moderator','admin']::membership_role[]));
drop policy if exists posts_delete on posts;
create policy posts_delete on posts for delete to authenticated
  using (author_id = auth.uid() or public.has_role(university_id, array['moderator','admin']::membership_role[]));

drop policy if exists material_read on material_details;
create policy material_read on material_details for select to authenticated using (public.can_view_post_id(post_id));
drop policy if exists material_write on material_details;
create policy material_write on material_details for all to authenticated
  using (exists (select 1 from posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists question_read on question_details;
create policy question_read on question_details for select to authenticated using (public.can_view_post_id(post_id));
drop policy if exists question_write on question_details;
create policy question_write on question_details for all to authenticated
  using (exists (select 1 from posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from posts p where p.id = post_id and p.author_id = auth.uid()));

drop policy if exists attachments_read on attachments;
create policy attachments_read on attachments for select to authenticated using (public.can_view_post_id(post_id));
drop policy if exists attachments_insert on attachments;
create policy attachments_insert on attachments for insert to authenticated
  with check (uploader_id = auth.uid() and exists (select 1 from posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists attachments_delete on attachments;
create policy attachments_delete on attachments for delete to authenticated using (uploader_id = auth.uid());

-- ---------- Коментарі ----------
drop policy if exists comments_read on comments;
create policy comments_read on comments for select to authenticated using (public.can_view_post_id(post_id));
drop policy if exists comments_insert on comments;
create policy comments_insert on comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_view_post_id(post_id) and not is_accepted);
drop policy if exists comments_update_own on comments;
create policy comments_update_own on comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists comments_delete on comments;
create policy comments_delete on comments for delete to authenticated
  using (author_id = auth.uid() or public.has_role(university_id, array['moderator','admin']::membership_role[]));

-- ---------- Особисте ----------
drop policy if exists reactions_own on reactions;
create policy reactions_own on reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists bookmarks_own on bookmarks;
create policy bookmarks_own on bookmarks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_view_post_id(post_id));
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_mark_read on notifications;
create policy notifications_mark_read on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Новини ----------
drop policy if exists news_sources_read on news_sources;
create policy news_sources_read on news_sources for select to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]));
drop policy if exists news_sources_admin on news_sources;
create policy news_sources_admin on news_sources for all to authenticated
  using (public.has_role(university_id, array['admin']::membership_role[]))
  with check (public.has_role(university_id, array['admin']::membership_role[]));
drop policy if exists news_items_read on news_items;
create policy news_items_read on news_items for select to authenticated
  using (public.is_member(university_id) or public.is_platform_admin());

-- ---------- AI: діалоги приватні ----------
drop policy if exists ai_conv_own on ai_conversations;
create policy ai_conv_own on ai_conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists ai_msg_own on ai_messages;
create policy ai_msg_own on ai_messages for all to authenticated
  using (exists (select 1 from ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- ---------- Скарги ----------
drop policy if exists reports_insert on reports;
create policy reports_insert on reports for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_member(university_id) and status = 'open');
drop policy if exists reports_read on reports;
create policy reports_read on reports for select to authenticated
  using (reporter_id = auth.uid() or public.has_role(university_id, array['moderator','admin']::membership_role[]));
drop policy if exists reports_resolve on reports;
create policy reports_resolve on reports for update to authenticated
  using (public.has_role(university_id, array['moderator','admin']::membership_role[]));

-- ---------- Storage: приватний бакет для вкладень ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)
on conflict (id) do nothing;
-- Політик для storage.objects навмисно не створюємо: прямий доступ клієнтів заборонено.
-- Завантаження та signed URL видає лише backend (service role) після перевірки доступу.
