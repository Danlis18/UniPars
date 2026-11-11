# Розгортання: GitHub → Supabase → Railway

Порядок має значення: спочатку код на GitHub, потім база в Supabase, потім два сервіси на Railway (backend і frontend), і наостанок перший адміністратор.

## 1. GitHub

1. Створіть порожній репозиторій на github.com (кнопка **New**). README, .gitignore і ліцензію не додавайте, бо вони вже є в проєкті.
2. Підключіть його і відправте код:
   ```bash
   git remote add origin https://github.com/<логін>/unipars.git
   git push -u origin main
   ```
   Під час першого push Git відкриє вікно входу в GitHub.

Секрети в репозиторій не потрапляють: `.env` вказано в `.gitignore`.

## 2. Supabase

1. На supabase.com натисніть **New project**. Оберіть регіон (наприклад, Frankfurt) і збережіть пароль бази.
2. Відкрийте **SQL Editor**. Вставте вміст `supabase/migrations/20261111000001_schema.sql` і натисніть **Run**. Потім так само `20261111000002_rls.sql`.
   - Ці файли створюють таблиці, політики доступу та приватний бакет `attachments` для файлів.
3. **Project Settings → API Keys**: скопіюйте
   - **Project URL** (`https://<ref>.supabase.co`);
   - **publishable / anon** ключ — для frontend;
   - **secret / service_role** ключ — тільки для backend. Його не можна вставляти у frontend.
   - Якщо новий `sb_secret_…` ключ не спрацює з бібліотекою, візьміть `service_role` на вкладці **Legacy API keys**.
4. **Authentication → Sign In / Providers**: має бути увімкнений вхід через Email.
5. Додайте університет. Варіант А — власний, через SQL Editor:
   ```sql
   insert into universities (slug, name, short_name)
   values ('my-uni', 'Повна назва університету', 'Коротка назва');
   ```
   Факультети, спеціальності, групи й предмети потім додасте на сторінці **Керування**.

   Варіант Б — демо-каталог, запускається локально:
   ```bash
   cd backend
   # у backend/.env: APP_MODE=supabase, SUPABASE_URL=..., SUPABASE_SERVICE_ROLE_KEY=...
   .venv/Scripts/python scripts/seed_supabase.py
   ```

## 3. Railway

Створіть проєкт: **New Project → Deploy from GitHub repo → unipars**. Знадобляться два сервіси з того самого репозиторію.

### 3.1 Backend

У налаштуваннях сервісу (**Settings**):

- **Root Directory**: `/backend`
- **Config file path**: `/backend/railway.json`. Він задає команду запуску `uvicorn app.main:app --host 0.0.0.0 --port $PORT` і перевірку `/api/health`.
- **Networking → Generate Domain**. Вийде адреса на кшталт `unipars-api.up.railway.app`.

Змінні (**Variables**):

```
APP_MODE=supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret / service_role ключ>
SUPABASE_JWT_SECRET=
STORAGE_BUCKET=attachments
AI_PROVIDER=anthropic
AI_MODEL=claude-opus-5-5
ANTHROPIC_API_KEY=<ключ, можна додати пізніше>
MAX_UPLOAD_MB=25
CORS_ORIGINS=https://<домен-frontend>.up.railway.app
```

- `SUPABASE_JWT_SECRET` залиште порожнім для нових проєктів Supabase: токени перевіряються через JWKS. Заповнюйте лише для старого проєкту з legacy JWT secret.
- `CORS_ORIGINS` заповніть після кроку 3.2, коли frontend отримає домен.

### 3.2 Frontend

Додайте другий сервіс: **+ New → GitHub Repo → unipars**.

- **Root Directory**: `/frontend`
- **Config file path**: `/frontend/railway.json`. Збірка — `npm run build`, запуск — `npm start` (статичний сервер `serve`).
- **Networking → Generate Domain**

Змінні:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable / anon ключ>
VITE_API_URL=https://<домен-backend>.up.railway.app
```

Змінні `VITE_*` вбудовуються в код під час збірки. Після кожної їх зміни натисніть **Redeploy**.

### 3.3 Зв'язати сервіси

1. У backend встановіть `CORS_ORIGINS` на домен frontend і зробіть redeploy.
2. У Supabase відкрийте **Authentication → URL Configuration**:
   - **Site URL** = домен frontend;
   - той самий домен додайте в **Redirect URLs**.

   Тоді посилання з листа підтвердження вестимуть на ваш сайт.

## 4. Перший адміністратор

1. Відкрийте сайт, зареєструйтесь і підтвердіть email.
2. Пройдіть онбординг: оберіть університет.
3. У Supabase SQL Editor виконайте:
   ```sql
   update profiles set is_platform_admin = true
   where id = (select id from auth.users where email = 'ваш@email');

   update university_memberships set role = 'admin'
   where user_id = (select id from auth.users where email = 'ваш@email');
   ```
4. Оновіть сторінку: у меню з'явиться **Керування**.

## 5. Перевірка

- `https://<backend>/api/health` повертає `{"ok": true}`.
- На сайті немає позначки «Демо-режим», працюють реєстрація та вхід.
- Новий допис із PDF зберігається, а файл відкривається за тимчасовим посиланням.
- Сторінка AI: без ключа показує «AI ще не підключено», з `ANTHROPIC_API_KEY` відповідає.

## Типові проблеми

| Симптом | Причина |
|---|---|
| «Сервер UniPars недоступний» | Неправильний `VITE_API_URL` або backend не запустився (дивіться **Deploy Logs**) |
| Помилка CORS у консолі браузера | `CORS_ORIGINS` не збігається з доменом frontend (з `https://`, без `/` у кінці) |
| 401 «Сесія недійсна» | Backend і frontend вказують на різні проєкти Supabase, або для legacy-проєкту не задано `SUPABASE_JWT_SECRET` |
| Зміни `VITE_*` не діють | Потрібен redeploy frontend |

## 6. Каталог ЛНУ, підписки та Telegram (міграція 3)

У **SQL Editor** виконайте `supabase/migrations/20261112000003_social_and_lnu.sql`. Скрипт можна запускати повторно. Він додає:

- таблицю `follows` (підписки між користувачами) і поле `telegram` у профілі;
- **ЛНУ ім. Івана Франка**: факультет електроніки та комп'ютерних технологій, 5 спеціальностей, 51 академічну групу, 23 дисципліни з темами;
- RSS-новини університету та факультету.

Спеціальності факультету та групи, що до них належать:

| Шифр | Спеціальність | Групи |
|---|---|---|
| F2 | Інженерія програмного забезпечення | ФЕП |
| F3 | Комп'ютерні науки | ФЕІ |
| F6 | Інформаційні системи та технології | ФЕС |
| G5 | Електроніка, електронні комунікації, приладобудування та радіотехніка | ФЕЛ |
| G7 | Автоматизація, комп'ютерно-інтегровані технології та робототехніка | ФЕМ |

Якщо раніше ви створили університет-заглушку з `slug = 'my-uni'`, скрипт перейменує його на ЛНУ, і ваше членство збережеться.

## 7. Фірмові листи (підтвердження пошти, відновлення пароля)

1. Supabase → **Authentication → Emails → Templates**.
2. **Confirm signup**:
   - Subject: `Підтвердіть пошту в UniPars ✨`
   - Body: вміст `supabase/templates/confirmation.html`.
3. **Reset password**:
   - Subject: `Новий пароль для UniPars`
   - Body: вміст `supabase/templates/recovery.html`.
4. Натисніть **Save**.

Вбудована пошта Supabase надсилає лише кілька листів на годину. Для реальних користувачів підключіть власний SMTP: **Authentication → Emails → SMTP Settings** (наприклад, Resend, Brevo або Gmail SMTP).
