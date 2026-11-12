# Власний домен і пошта

У прикладах домен — `unipars.app`. Замініть його своїм.

| Адреса | Що там | Де налаштовується |
|---|---|---|
| `unipars.app` (+ `www`) | Сайт (frontend) | Railway → сервіс frontend |
| `api.unipars.app` | Backend | Railway → сервіс backend |
| `noreply@unipars.app` | Листи підтвердження й відновлення пароля | Resend → Supabase SMTP |
| `hello@` / `support@unipars.app` | Вхідна пошта, пересилається на ваш Gmail | Cloudflare Email Routing |

## 1. Купити домен і перенести DNS у Cloudflare

1. Купіть домен:
   - `.app`, `.com`, `.io` — у **Cloudflare Registrar**. Ціна без націнки, DNS одразу в Cloudflare.
   - `.com.ua` / `.ua` — лише в українського реєстратора (наприклад, imena.ua або hostiq.ua). Потім змініть у реєстратора NS-сервери на ті, які покаже Cloudflare.
2. Додайте домен у Cloudflare (**Add a domain**, тариф **Free**).
3. **SSL/TLS → Overview**: режим **Full (strict)**.
4. **SSL/TLS → Edge Certificates**: увімкніть **Always Use HTTPS**.

Чому DNS у Cloudflare: Railway дає не IP-адресу, а CNAME. Кореневий домен (`unipars.app` без `www`) потребує CNAME flattening, а Cloudflare підтримує його безкоштовно.

## 2. Підключити домен до Railway

**Frontend:**
1. Railway → **frontend → Settings → Networking → Custom Domain** → `unipars.app`.
2. Railway покаже два записи:
   - **CNAME** — ціль на кшталт `xxxx.up.railway.app`;
   - **TXT** — для підтвердження.
3. Внесіть їх у Cloudflare → **DNS → Records**:
   - `CNAME  @  →  xxxx.up.railway.app` (Proxy status — Proxied);
   - TXT-запис — точно як показав Railway.
4. Повторіть те саме для `www.unipars.app`. Railway дасть для нього окрему ціль, бо це окремий домен.

**Backend:**
1. Railway → **backend → Custom Domain** → `api.unipars.app`.
2. У Cloudflare: `CNAME api → yyyy.up.railway.app` + TXT.

Коли статус у Railway стане зеленим (зазвичай за 5–30 хвилин), оновіть змінні.

**Backend → Variables:**
```
CORS_ORIGINS=https://unipars.app,https://www.unipars.app
```

**Frontend → Variables** (після зміни — Redeploy):
```
VITE_API_URL=https://api.unipars.app
```

**Supabase → Authentication → URL Configuration:**
- Site URL: `https://unipars.app`
- Redirect URLs: `https://unipars.app/**`, `https://www.unipars.app/**`

Старі адреси `*.up.railway.app` можна залишити як запасні. Якщо хочете, щоб вони працювали, додайте їх у `CORS_ORIGINS` і Redirect URLs.

## 3. Пошта для листів: Resend

Чому не особистий Gmail: ліміти, листи потрапляють у спам, Google може заблокувати акаунт за масову розсилку. До того ж користувачі бачать адресу приватної особи, а не продукту.

1. Зареєструйтесь на resend.com. Безкоштовний тариф: 3000 листів на місяць, 100 на день.
2. **Domains → Add Domain** → `unipars.app`, регіон **eu-west-1 (Ireland)**, найближчий до користувачів.
3. Resend покаже DNS-записи:
   - **TXT `resend._domainkey`** — DKIM, цифровий підпис листів;
   - **MX `send`** і **TXT `send`** — SPF для адреси повернень (bounce).

   Внесіть їх у Cloudflare точно як показано. Для MX і TXT проксі не застосовується.
4. Додайте DMARC. Без нього Gmail і Yahoo гірше довіряють листам:
   ```
   TXT  _dmarc  "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc@unipars.app"
   ```
5. Натисніть **Verify DNS Records** і дочекайтеся статусу **Verified**.
6. **API Keys → Create API Key**: назва `supabase-auth`, доступ **Sending access**, домен `unipars.app`. Скопіюйте ключ одразу, Resend покаже його лише один раз.

## 4. Підключити Resend до Supabase

Supabase → **Authentication → Emails → SMTP Settings** (або кнопка **Set up SMTP**):

| Поле | Значення |
|---|---|
| Enable custom SMTP | увімкнено |
| Sender email | `noreply@unipars.app` |
| Sender name | `UniPars` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | API-ключ із кроку 3.6 |

Потім:
- **Authentication → Rate Limits → Emails sent per hour**: поставте 100. Після підключення SMTP Supabase ставить лише 30.
- **Authentication → Emails → Templates**: тепер поля доступні для редагування. Вставте шаблони:
  - **Confirm signup** ← `supabase/templates/confirmation.html`, тема `Підтвердіть пошту в UniPars ✨`;
  - **Reset password** ← `supabase/templates/recovery.html`, тема `Новий пароль для UniPars`.

## 5. Вхідна пошта: Cloudflare Email Routing

Щоб на `hello@unipars.app` та `support@unipars.app` можна було писати, а листи надходили на ваш Gmail:

1. Cloudflare → **Email → Email Routing → Get started**. Cloudflare сам додасть потрібні MX- і SPF-записи для кореневого домену. Вони не конфліктують із записами Resend, бо ті на піддомені `send`.
2. **Routing rules**:
   - `hello@` → ваш Gmail;
   - `support@` → ваш Gmail;
   - `dmarc@` → ваш Gmail (сюди приходитимуть звіти DMARC).
3. Підтвердіть Gmail за листом від Cloudflare.

## 6. Перевірка

- `https://unipars.app` відкриває сайт, `https://api.unipars.app/api/health?deep=1` повертає `"ok":true`.
- Реєстрація з новою поштою: лист приходить від **UniPars <noreply@unipars.app>**, у фірмовому дизайні, у вкладку «Вхідні», а не в спам.
- Перевірте репутацію відправлення на mail-tester.com. Ціль — 9/10 або вище.
- Лист на `support@unipars.app` доходить у ваш Gmail.
