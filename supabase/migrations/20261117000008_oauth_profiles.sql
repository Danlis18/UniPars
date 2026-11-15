-- Вхід через Google: ім'я та фото профілю беруться з даних Google (full_name / name / picture),
-- для звичайної реєстрації — з display_name, як і раніше.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  name text := nullif(btrim(coalesce(meta ->> 'display_name', meta ->> 'full_name', meta ->> 'name', '')), '');
  pic text := coalesce(meta ->> 'avatar_url', meta ->> 'picture');
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(name, split_part(new.email, '@', 1)), 60),
    case when pic ~ '^https://[a-z0-9.-]+\.googleusercontent\.com/' then pic end
  );
  return new;
end $$;
