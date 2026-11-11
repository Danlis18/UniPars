-- UniPars: підписки між користувачами, Telegram у профілі та каталог ЛНУ ім. Івана Франка.
-- Безпечно запускати повторно.

-- ---------- Профіль: Telegram ----------
alter table profiles add column if not exists telegram text
  check (telegram is null or telegram ~ '^[A-Za-z0-9_]{5,32}$');

-- ---------- Підписки (як в Instagram) ----------
create table if not exists follows (
  follower_id uuid not null references profiles (id) on delete cascade,
  following_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on follows (following_id);

alter table follows enable row level security;
drop policy if exists follows_read on follows;
create policy follows_read on follows for select to authenticated using (true);
drop policy if exists follows_own on follows;
create policy follows_own on follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists follows_delete_own on follows;
create policy follows_delete_own on follows for delete to authenticated using (follower_id = auth.uid());

-- ---------- Каталог ЛНУ ----------
-- Джерела (відкриті дані факультету):
--   спеціальності — «Вартість навчання 2025-26», electronics.lnu.edu.ua;
--   групи та дисципліни — розклад заліків II семестру 2025/2026 н.р., там само.
-- Відповідність шифрів груп: ФЕП — F2, ФЕІ — F3, ФЕС — F6, ФЕЛ — G5, ФЕМ — G7.
do $$
declare
  uni uuid;
  fac uuid;
  p_f2 uuid; p_f3 uuid; p_f6 uuid; p_g5 uuid; p_g7 uuid;
  g text;
  s record;
  sid uuid;
  t text;
  i int;
begin
  select id into uni from universities where slug = 'lnu';
  if uni is null then
    -- Якщо раніше створено університет-заглушку з інструкції — перетворюємо його на ЛНУ (членства зберігаються)
    select id into uni from universities where slug = 'my-uni';
    if uni is not null then
      update universities set slug = 'lnu' where id = uni;
    else
      insert into universities (slug, name, short_name) values ('lnu', '', '') returning id into uni;
    end if;
  end if;
  update universities
     set name = 'Львівський національний університет імені Івана Франка',
         short_name = 'ЛНУ ім. Франка',
         is_demo = false
   where id = uni;

  select id into fac from faculties where university_id = uni and name = 'Факультет електроніки та комп''ютерних технологій';
  if fac is null then
    insert into faculties (university_id, name) values (uni, 'Факультет електроніки та комп''ютерних технологій') returning id into fac;
  end if;

  -- Спеціальності (нові шифри з 2025 року)
  for s in select * from (values
      ('F2', 'Інженерія програмного забезпечення'),
      ('F3', 'Комп''ютерні науки'),
      ('F6', 'Інформаційні системи та технології'),
      ('G5', 'Електроніка, електронні комунікації, приладобудування та радіотехніка'),
      ('G7', 'Автоматизація, комп''ютерно-інтегровані технології та робототехніка')
    ) as v(code, name)
  loop
    if not exists (select 1 from programs where university_id = uni and code = s.code) then
      insert into programs (university_id, faculty_id, code, name) values (uni, fac, s.code, s.name);
    end if;
  end loop;
  select id into p_f2 from programs where university_id = uni and code = 'F2';
  select id into p_f3 from programs where university_id = uni and code = 'F3';
  select id into p_f6 from programs where university_id = uni and code = 'F6';
  select id into p_g5 from programs where university_id = uni and code = 'G5';
  select id into p_g7 from programs where university_id = uni and code = 'G7';

  -- Академічні групи бакалаврату (2025/2026 н.р.)
  foreach g in array array[
    'ФЕІ-11','ФЕІ-12','ФЕІ-13','ФЕІ-14','ФЕІ-15',
    'ФЕІ-21','ФЕІ-22','ФЕІ-23','ФЕІ-24','ФЕІ-25','ФЕІ-26','ФЕІ-27',
    'ФЕІ-31','ФЕІ-32','ФЕІ-33','ФЕІ-34','ФЕІ-35','ФЕІ-36',
    'ФЕІ-41','ФЕІ-42','ФЕІ-43','ФЕІ-44','ФЕІ-45',
    'ФЕП-11','ФЕП-12','ФЕП-13','ФЕП-21','ФЕП-22','ФЕП-23','ФЕП-24',
    'ФЕП-31','ФЕП-32','ФЕП-33','ФЕП-41','ФЕП-42','ФЕП-43',
    'ФЕС-11','ФЕС-21','ФЕС-31','ФЕС-41','ФЕС-42',
    'ФЕЛ-11','ФЕЛ-21','ФЕЛ-31','ФЕЛ-41',
    'ФЕМ-11','ФЕМ-12','ФЕМ-21','ФЕМ-31','ФЕМ-41','ФЕМ-42']
  loop
    if not exists (select 1 from study_groups where university_id = uni and name = g) then
      insert into study_groups (university_id, program_id, name, course)
      values (uni,
              case substr(g, 1, 3) when 'ФЕП' then p_f2 when 'ФЕІ' then p_f3 when 'ФЕС' then p_f6
                                   when 'ФЕЛ' then p_g5 else p_g7 end,
              g, substr(g, 5, 1)::smallint);
    end if;
  end loop;

  -- Дисципліни (з розкладу заліків факультету) і стартові теми
  for s in select * from (values
    ('arch', 'Архітектура обчислювальних систем та комп''ютерна схемотехніка', 'Логічні елементи, тригери, процесори та пам''ять.', 'F3', 1, 2, array['Логічні елементи','Тригери та регістри','Процесор','Пам''ять']),
    ('os', 'Операційні системи, системне програмування', 'Процеси, потоки, пам''ять, файлові системи, shell.', 'F2', 1, 2, array['Процеси та потоки','Керування пам''яттю','Файлові системи','Bash і shell']),
    ('web', 'Веб-технології та програмування', 'HTML, CSS, JavaScript, клієнт-серверні застосунки.', 'F2,F6', 1, 2, array['HTML і CSS','JavaScript','Backend і REST API','Бази даних у вебі']),
    ('se-team', 'Інженерія програмного забезпечення (командна робота)', 'Git, вимоги, Agile/Scrum, тестування.', 'F6,F2', 1, 2, array['Git','Agile і Scrum','Вимоги','Тестування']),
    ('numerical', 'Чисельні методи', 'Наближені методи розв''язання математичних задач.', 'G7,F3', 1, 2, array['Системи рівнянь','Інтерполяція','Чисельне інтегрування','Диференціальні рівняння']),
    ('phys-lab', 'Фізичний практикум', 'Лабораторні роботи з фізики.', 'G7,G5', 1, 2, array['Механіка','Електрика','Оптика','Обробка результатів']),
    ('materials', 'Матеріали та компоненти сучасної електроніки', 'Напівпровідники, пасивні та активні компоненти.', 'G5', 1, 2, array['Напівпровідники','Пасивні компоненти','Діоди і транзистори']),
    ('ops-research', 'Математичні методи дослідження операцій', 'Оптимізація, лінійне програмування, задачі прийняття рішень.', 'F3', 2, 4, array['Лінійне програмування','Симплекс-метод','Транспортна задача','Теорія ігор']),
    ('parallel', 'Паралельні та розподілені обчислення', 'Потоки, MPI, OpenMP, GPU.', 'F2', 2, 4, array['Потоки і синхронізація','OpenMP','MPI','GPU і CUDA']),
    ('embedded', 'Проєктування вбудованих систем', 'Мікроконтролери, інтерфейси, RTOS.', 'G5,F6', 3, 6, array['Мікроконтролери','Інтерфейси UART/SPI/I2C','RTOS']),
    ('iot', 'Концепції побудови ІоТ', 'Архітектура Інтернету речей, протоколи, хмарні платформи.', 'F6', 3, 6, array['Протоколи MQTT і CoAP','Сенсори','Хмарні платформи ІоТ']),
    ('data-analysis', 'Аналіз даних', 'Статистика, візуалізація, Python для даних.', 'F3', 3, 6, array['Pandas','Візуалізація','Статистичні методи']),
    ('dsp', 'Цифрова обробка сигналів', 'Дискретні сигнали, перетворення Фур''є, фільтри.', 'G5', 3, 6, array['Дискретизація','Перетворення Фур''є','Цифрові фільтри']),
    ('pattern', 'Розпізнавання образів', 'Класифікація, нейронні мережі, комп''ютерний зір.', 'F3', 4, 7, array['Класифікація','Нейронні мережі','Комп''ютерний зір']),
    ('nlp', 'Аналіз текстової інформації', 'Обробка природної мови.', 'F3', 4, 7, array['Токенізація','Векторні представлення','Класифікація текстів']),
    ('data-eng', 'Інженерія даних', 'ETL, сховища даних, обробка великих даних.', 'F3,F6', 4, 7, array['ETL','Сховища даних','Великі дані']),
    ('edge-fog', 'Edge/Fog технології та обчислення', 'Обчислення на межі мережі.', 'F2', 4, 7, array['Edge-архітектури','Fog-вузли','Розгортання']),
    ('sensors', 'Сучасні сенсори фізичних величин', 'Принципи роботи та застосування сенсорів.', 'G7', 4, 7, array['Типи сенсорів','Калібрування','Інтерфейси сенсорів']),
    ('thin-films', 'Тонкоплівкові структури в електроніці', 'Технології та властивості тонких плівок.', 'G7,G5', 4, 7, array['Технології нанесення','Властивості плівок']),
    ('philosophy', 'Філософія', 'Загальна дисципліна.', 'F2,F3,F6,G5,G7', 1, 2, array['Антична філософія','Філософія Нового часу','Сучасна філософія']),
    ('ukr-prof', 'Українська мова (за професійним спрямуванням)', 'Ділове та наукове мовлення.', 'F2,F3,F6,G5,G7', 1, 2, array['Ділові документи','Науковий стиль']),
    ('foreign-lang', 'Іноземна мова', 'Англійська для ІТ та інженерії.', 'F2,F3,F6,G5,G7', 1, 2, array['Граматика','Технічна лексика']),
    ('safety', 'Безпека життєдіяльності та охорона праці', 'Загальна дисципліна старших курсів.', 'F2,F3,F6,G5,G7', 4, 7, array['Охорона праці','Цивільний захист'])
  ) as v(slug, name, descr, codes, course, sem, topics)
  loop
    select id into sid from subjects where university_id = uni and slug = s.slug;
    if sid is null then
      insert into subjects (university_id, slug, name, description) values (uni, s.slug, s.name, s.descr) returning id into sid;
    end if;
    insert into subject_programs (subject_id, program_id, university_id, course, semester)
    select sid, p.id, uni, s.course, s.sem from programs p
     where p.university_id = uni and p.code = any (string_to_array(s.codes, ','))
    on conflict (subject_id, program_id) do nothing;
    i := 0;
    foreach t in array s.topics loop
      if not exists (select 1 from topics where subject_id = sid and name = t) then
        insert into topics (university_id, subject_id, name, position) values (uni, sid, t, i);
      end if;
      i := i + 1;
    end loop;
  end loop;

  -- Офіційні RSS-стрічки (перевірено: обидві відповідають application/rss+xml)
  if not exists (select 1 from news_sources where university_id = uni and url = 'https://lnu.edu.ua/feed/') then
    insert into news_sources (university_id, kind, name, url, refresh_minutes)
    values (uni, 'rss', 'Новини ЛНУ', 'https://lnu.edu.ua/feed/', 30);
  end if;
  if not exists (select 1 from news_sources where university_id = uni and url = 'https://electronics.lnu.edu.ua/feed/') then
    insert into news_sources (university_id, kind, name, url, refresh_minutes)
    values (uni, 'rss', 'Факультет електроніки', 'https://electronics.lnu.edu.ua/feed/', 30);
  end if;
end $$;
