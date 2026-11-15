-- UniPars: обкладинка профілю — лише з бібліотеки (backend/app/core/covers.py).
-- Безпечно запускати повторно.
alter table profiles add column if not exists cover text;

alter table profiles drop constraint if exists profiles_cover_from_library;
alter table profiles add constraint profiles_cover_from_library check (
  cover is null or cover in (
    'lib-hall', 'lib-shelves', 'lib-study', 'lib-window',
    'lviv-roofs', 'lviv-street', 'lviv-tower', 'lviv-old',
    'code-python', 'code-html', 'code-editor', 'code-night',
    'aurora-valley', 'aurora-sky', 'aurora-lake', 'mountains',
    'mist', 'fluid-wave', 'fluid-cosmos', 'fluid-neon'
  )
);
