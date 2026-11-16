-- Анонімна публікація роботи: інші студенти не бачать автора, модерація й сам автор — бачать.
alter table submissions add column if not exists is_anonymous boolean not null default false;
