# Вхід і реєстрація: налаштування Supabase

Сайт уже вміє:
- перевіряти email і пароль ще до відправлення форми;
- підтверджувати пошту кодом із листа;
- відновлювати пароль кодом;
- входити через Google.

Щоб усе це запрацювало на продакшні, потрібні налаштування в дашборді Supabase нижче.

## 1. Вимоги до пароля на сервері

Сайт перевіряє пароль сам, але сервер має відхиляти слабкі паролі й тоді, коли запит іде в обхід сайту.

**Authentication → Providers → Email** (або **Authentication → Sign In / Providers**):
- **Minimum password length**: `8`.
- **Password requirements**: `Letters and digits`.
- **Confirm email**: увімкнено.
- **Email OTP Length**: `6`. Має збігатися з `VITE_OTP_LENGTH` на фронтенді (за замовчуванням 6).
- **Email OTP Expiration**: `3600` (1 година, як написано в листі).

## 2. Код замість посилання в листі

Код (`{{ .Token }}`) з'являється в листі, лише якщо він є в шаблоні. Редагувати шаблони Supabase дозволяє тільки з власним SMTP, тож спершу налаштуйте Brevo за [email-brevo.md](email-brevo.md).

Далі **Authentication → Emails → Templates**:

| Шаблон | Тема | Тіло |
|---|---|---|
| Confirm signup | `Код підтвердження UniPars` | вміст `supabase/templates/confirmation.html` |
| Reset password | `Код для зміни пароля UniPars` | вміст `supabase/templates/recovery.html` |

Без власного SMTP Supabase надсилає листи **лише на адреси учасників команди проєкту** і не більше кількох на годину. Тому студенти коду не отримають, доки не налаштовано Brevo.

Шаблони генеруються скриптом `python scripts/gen_email_templates.py`: у листі є логотип, аватар Парса й ім'я користувача. Картинки лежать на сайті в `frontend/public/email/`. Якщо зміниться адреса сайту, оновіть `SITE` у скрипті й перегенеруйте шаблони.

Поки SMTP не налаштовано, Supabase надсилає стандартний лист із посиланням. Посилання теж працює: воно підтверджує пошту, після чого можна просто увійти.

## 3. Вхід через Google

### 3.1. Google Cloud

1. Відкрийте https://console.cloud.google.com, створіть проєкт `UniPars`.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - App name `UniPars`, support email — ваш.
   - Scopes: `openid`, `email`, `profile` (вони базові й не потребують перевірки Google).
   - **Branding**:
     - App home page: `https://unipars-frontend-production.up.railway.app`;
     - Privacy policy: `https://unipars-frontend-production.up.railway.app/privacy`;
     - Terms of service: `https://unipars-frontend-production.up.railway.app/terms`;
     - Authorized domains: `up.railway.app` і `supabase.co`.
   - Publishing status: **In production**. Інакше увійти зможуть лише додані тестові користувачі.
   - На Railway у сервісі frontend додайте змінну `VITE_SUPPORT_EMAIL` (та сама адреса, що й support email у Google). Вона з'явиться на сторінках `/privacy` і `/terms` як контакт.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: `https://unipars-frontend-production.up.railway.app`.
   - Authorized redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`. Точну адресу показує Supabase на кроці 3.2.
4. Скопіюйте **Client ID** і **Client secret**.

### 3.2. Supabase

1. **Authentication → Providers → Google**: увімкніть і вставте Client ID та Client secret. Тут же видно **Callback URL** для кроку 3.1.
2. **Authentication → URL Configuration**:
   - Site URL: `https://unipars-frontend-production.up.railway.app`.
   - Redirect URLs: та сама адреса (без шляху).

Після першого входу через Google ім'я й фото профілю беруться з Google-акаунта (міграція `20261117000008_oauth_profiles.sql`). Далі, як і після звичайної реєстрації, людина обирає факультет, спеціальність і курс.

## 4. Перевірка

- Реєстрація з паролем `12345678` не проходить: сайт показує, які вимоги не виконано.
- Після «Створити акаунт» одразу з'являється поле для коду. Код приходить листом, а після введення відкривається вибір факультету.
- «Забули пароль?» надсилає код, і на тому ж екрані задається новий пароль.
- «Продовжити з Google» веде на вибір Google-акаунта й повертає на сайт уже з входом.
