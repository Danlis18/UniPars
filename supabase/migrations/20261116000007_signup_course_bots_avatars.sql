-- UniPars: обмеження реєстрації, автоматичний курс, боти, аватари.
-- Безпечно запускати повторно.

-- ---------- Реєстрація: лише відкриті університети та факультети ----------
alter table faculties add column if not exists registration_open boolean not null default false;

update universities
   set settings = coalesce(settings, '{}'::jsonb) || '{"registration_open": true}'::jsonb
 where slug = 'lnu';
update universities
   set settings = coalesce(settings, '{}'::jsonb) || '{"registration_open": false}'::jsonb
 where slug <> 'lnu' and not (settings ? 'registration_open');

update faculties f set registration_open = true
  from universities u
 where f.university_id = u.id and u.slug = 'lnu'
   and f.name = 'Факультет електроніки та комп''ютерних технологій';

-- ---------- Курс рахується від року вступу і сам переходить 1 вересня ----------
alter table university_memberships add column if not exists entry_year smallint
  check (entry_year is null or entry_year between 2000 and 2100);

-- Заповнюємо рік вступу з уже вказаного курсу (навчальний рік починається 1 вересня)
update university_memberships
   set entry_year = (extract(year from now())::int - case when extract(month from now()) >= 9 then 0 else 1 end) - course + 1
 where entry_year is null and course is not null;

-- ---------- Боти (позначені в інтерфейсі як «Бот») ----------
alter table profiles add column if not exists is_bot boolean not null default false;

-- Звичайний користувач не може зробити себе ботом чи прибрати позначку
create or replace function public.protect_profile_privileges() returns trigger
language plpgsql as $$
begin
  if (new.is_platform_admin is distinct from old.is_platform_admin or new.is_bot is distinct from old.is_bot)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'is_platform_admin / is_bot can only be changed by the service role';
  end if;
  return new;
end $$;

-- ---------- Аватари: публічний бакет (фото профілю бачать усі) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp'];
-- Завантажує лише backend (service role) після перевірки та стиснення зображення.
