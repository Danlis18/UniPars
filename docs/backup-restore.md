# Бекапи й відновлення

## Що робиться щодня
Workflow `.github/workflows/backup.yml` щодня о 03:17 за Києвом (взимку) виконує таке:
1. рахує рядки в кожній таблиці `public` і `auth` (`scripts/backup/db_check.py counts`);
2. робить дамп бази `pg_dump --format=custom` (схеми `public` і `auth`, тобто дані сайту й облікові записи);
3. **відновлює дамп у порожній Postgres 17** і перевіряє копію (`db_check.py verify`):
   - кількість рядків збігається з джерелом (допуск 1 % або 5 рядків — сайт живий);
   - жодна таблиця з даними не стала порожньою;
   - баланс генерацій збігається з журналом (`billing_reconciliation` порожня);
4. копіює файли Storage (`attachments`, `avatars`) разом із `manifest.json`;
5. шифрує все (gpg, AES-256) і зберігає артефакт `unipars-backup-<дата>` на **14 днів**; якщо задано S3-секрети — ще й у S3-сумісне сховище (Cloudflare R2, Backblaze B2, AWS).

Якщо будь-який крок упав, GitHub надсилає лист власнику репозиторію. Отже, бекап, який не відновлюється, вважається невдалим уже того ж дня.

На кожному PR, що змінює бекап, запускається самоперевірка `selftest`: той самий ланцюжок на синтетичній базі, без продакшну й секретів.

> Репозиторій публічний: артефакти можуть завантажити інші користувачі GitHub. Тому все, що виходить за межі runner-а, зашифроване, а `BACKUP_PASSPHRASE` має бути довгою випадковою фразою.

## Налаштування (один раз)
GitHub → Settings → Secrets and variables → Actions → New repository secret:

| Секрет | Де взяти |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Connect → **Session pooler** (порт 5432) → URI з паролем бази. Direct connection не підходить: він лише через IPv6, а runner-и GitHub його не мають. |
| `BACKUP_PASSPHRASE` | Згенеруйте ≥ 24 символи (напр. `openssl rand -base64 32`). **Збережіть також у менеджері паролів**: без фрази бекап не розшифрувати. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Ті самі, що в backend на Railway. Потрібні лише для читання файлів Storage. |
| необов'язково `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Окреме сховище з довшим зберіганням (рекомендовано: 14 днів у GitHub — це мінімум). |

Перший запуск: Actions → **Daily backup** → Run workflow. Він має завершитися зеленим, а в артефакті має бути три файли `.gpg`.

Додатково: на тарифі Supabase Pro є власні щоденні бекапи (7 днів) і PITR. Вони доповнюють цей бекап, але не замінюють його, бо лежать у тому ж провайдері.

## Відновлення після аварії
Ціль: сайт знову працює за ≤ 2 години; втрата даних — не більше доби.

### 1. Завантажити й розшифрувати
```bash
gh run download --name unipars-backup-<дата> --dir backup   # або з S3
cd backup
for f in *.gpg; do gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d -o "${f%.gpg}" "$f"; done
```

### 2. База в новому (або очищеному) проєкті Supabase
1. Створіть проєкт і застосуйте міграції з `supabase/migrations/` по черзі (SQL Editor). Так схема, RLS і функції будуть точно як у репозиторії.
2. Відновіть дані: спершу облікові записи, потім дані сайту без тригерів. `<url>` — Session pooler нового проєкту.
   ```bash
   pg_restore --data-only --no-owner --no-privileges -d "<url>" --schema=auth --table=users db-<дата>.pgcustom
   PGOPTIONS='-c session_replication_role=replica' \
     pg_restore --data-only --no-owner --no-privileges -d "<url>" --schema=public db-<дата>.pgcustom
   ```
3. Перевірте:
   ```bash
   python scripts/backup/db_check.py verify "<url>" counts.json
   ```

### 3. Файли
```bash
tar -xzf storage-<дата>.tar.gz
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/backup/storage_restore.py storage
```
Бакети `attachments` і `avatars` створює міграція 9 і налаштування з `docs/deploy.md`.

### 4. Перемкнути сайт
На Railway (backend) оновіть `SUPABASE_URL` і `SUPABASE_SERVICE_ROLE_KEY` (`SUPABASE_JWT_SECRET` — лише для legacy-проєктів, див. `docs/deploy.md`). На frontend оновіть `VITE_SUPABASE_URL` і `VITE_SUPABASE_ANON_KEY`. Потім перевірте `python scripts/smoke_prod.py`.

## Навчальне відновлення в Supabase — раз на квартал
Щоденна перевірка відновлює дамп у звичайний Postgres. Повний шлях у новий проєкт Supabase (кроки 2–4 вище, на тимчасовому безкоштовному проєкті) проходьте раз на квартал. Записуйте дату й час, які це зайняло, а знайдені неточності виправляйте в цьому документі.

| Дата | Хто | Час відновлення | Нотатки |
|---|---|---|---|
| — | — | — | перше навчальне відновлення ще попереду |
