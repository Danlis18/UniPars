#!/usr/bin/env bash
# Навчальне відновлення дампу в порожній Postgres (щодня в .github/workflows/backup.yml).
#   scripts/backup/restore_rehearsal.sh <dump.pgcustom> <target_db_url>
# Створює ролі й схему extensions, які є в Supabase, відновлює дамп і показує помилки pg_restore.
# Про успіх вирішує не pg_restore (частина об'єктів Supabase у звичайному Postgres не потрібна),
# а scripts/backup/db_check.py verify — кількість рядків і узгодженість балансу.
set -euo pipefail
dump="$1"
target="$2"

psql "$target" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin',
                           'supabase_auth_admin', 'supabase_storage_admin', 'dashboard_user', 'pgbouncer'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
SQL

set +e
pg_restore --no-owner --no-privileges --no-comments -d "$target" "$dump" 2> restore-errors.log
code=$?
set -e
errors=$(grep -c "error:" restore-errors.log || true)
echo "pg_restore завершився з кодом $code, повідомлень про помилки: $errors (специфічні для Supabase об'єкти очікувано пропускаються)"
grep "error:" restore-errors.log | sed 's/^/  /' | head -40 || true
