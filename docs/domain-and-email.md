# Власний домен і пошта

Домен проєкту — `unipars.com.ua`.

| Адреса | Що там | Де налаштовується |
|---|---|---|
| `unipars.com.ua` (+ `www`) | Сайт (frontend) | Railway → сервіс frontend |
| `api.unipars.com.ua` | Backend | Railway → сервіс backend |
| `noreply@unipars.com.ua` | Листи підтвердження й відновлення пароля | Resend → Supabase SMTP |
| `hello@` / `support@unipars.com.ua` | Вхідна пошта, пересилається на ваш Gmail | Cloudflare Email Routing |

## 1. Купити домен і перенести DNS у Cloudflare

`.com.ua` продають лише українські реєстратори. Cloudflare Registrar цю зону не обслуговує, тому домен купуємо в реєстратора, а DNS переносимо в Cloudflare.

1. Купіть `unipars.com.ua` у акредитованого реєстратора: imena.ua, hostiq.ua, ukraine.com.ua, nic.ua тощо. Ціна — приблизно 200–400 грн на рік.
   - Увімкніть **автопродовження**. Домен, який забули продовжити, — найпоширеніша причина «падіння» стартапів.
   - Власником указуйте себе (або ФОП/ТОВ, якщо вже є), а не реєстратора.
   - Платні послуги реєстратора — хостинг, пошта, SSL — не потрібні, усе це дадуть Railway, Cloudflare і Resend.
2. Додайте домен у Cloudflare: **Add a domain** → `unipars.com.ua`, тариф **Free**. Cloudflare покаже два NS-сервери, наприклад `xxx.ns.cloudflare.com` і `yyy.ns.cloudflare.com`.
3. У панелі реєстратора замініть NS-сервери домену на ці два.
   - Оновлення займає від кількох хвилин до 24 годин.
   - Коли Cloudflare напише «Active», переходьте далі.
4. Cloudflare → **SSL/TLS → Overview**: режим **Full (strict)**.
5. **SSL/TLS → Edge Certificates**: увімкніть **Always Use HTTPS**.

Чому DNS у Cloudflare: Railway дає не IP-адресу, а CNAME. Кореневий домен (`unipars.com.ua` без `www`) потребує CNAME flattening, а Cloudflare підтримує його безкоштовно. DNS українських реєстраторів зазвичай так не вміє.

## 2. Підключити домен до Railway

**Frontend:**
1. Railway → **frontend → Settings → Networking → Custom Domain** → `unipars.com.ua`.
2. Railway покаже два записи:
   - **CNAME** — ціль на кшталт `xxxx.up.railway.app`;
   - **TXT** — для підтвердження.
3. Внесіть їх у Cloudflare → **DNS → Records**:
   - `CNAME  @  →  xxxx.up.railway.app` (Proxy status — Proxied);
   - TXT-запис — точно як показав Railway.
4. Повторіть те саме для `www.unipars.com.ua`. Railway дасть для нього окрему ціль, бо це окремий домен.

**Backend:**
1. Railway → **backend → Custom Domain** → `api.unipars.com.ua`.
2. У Cloudflare: `CNAME api → yyyy.up.railway.app` + TXT.

Коли статус у Railway стане зеленим (зазвичай за 5–30 хвилин), оновіть змінні.

**Backend → Variables:**
```
CORS_ORIGINS=https://unipars.com.ua,https://www.unipars.com.ua
```

**Frontend → Variables** (після зміни — Redeploy):
```
VITE_API_URL=https://api.unipars.com.ua
```

**Supabase → Authentication → URL Configuration:**
- Site URL: `https://unipars.com.ua`
- Redirect URLs: `https://unipars.com.ua/**`, `https://www.unipars.com.ua/**`

Старі адреси `*.up.railway.app` можна залишити як запасні. Якщо хочете, щоб вони працювали, додайте їх у `CORS_ORIGINS` і Redirect URLs.

## 3. Пошта для листів: Resend

Чому не особистий Gmail: ліміти, листи потрапляють у спам, Google може заблокувати акаунт за масову розсилку. До того ж користувачі бачать адресу приватної особи, а не продукту.

1. Зареєструйтесь на resend.com. Безкоштовний тариф: 3000 листів на місяць, 100 на день.
2. **Domains → Add Domain** → `unipars.com.ua`, регіон **eu-west-1 (Ireland)**, найближчий до користувачів.
3. Resend покаже DNS-записи:
   - **TXT `resend._domainkey`** — DKIM, цифровий підпис листів;
   - **MX `send`** і **TXT `send`** — SPF для адреси повернень (bounce).

   Внесіть їх у Cloudflare точно як показано. Для MX і TXT проксі не застосовується.
4. Додайте DMARC. Без нього Gmail і Yahoo гірше довіряють листам:
   ```
   TXT  _dmarc  "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc@unipars.com.ua"
   ```
5. Натисніть **Verify DNS Records** і дочекайтеся статусу **Verified**.
6. **API Keys → Create API Key**: назва `supabase-auth`, доступ **Sending access**, домен `unipars.com.ua`. Скопіюйте ключ одразу, Resend покаже його лише один раз.

## 4. Підключити Resend до Supabase

Supabase → **Authentication → Emails → SMTP Settings** (або кнопка **Set up SMTP**):

| Поле | Значення |
|---|---|
| Enable custom SMTP | увімкнено |
| Sender email | `noreply@unipars.com.ua` |
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

Щоб на `hello@unipars.com.ua` та `support@unipars.com.ua` можна було писати, а листи надходили на ваш Gmail:

1. Cloudflare → **Email → Email Routing → Get started**. Cloudflare сам додасть потрібні MX- і SPF-записи для кореневого домену. Вони не конфліктують із записами Resend, бо ті на піддомені `send`.
2. **Routing rules**:
   - `hello@` → ваш Gmail;
   - `support@` → ваш Gmail;
   - `dmarc@` → ваш Gmail (сюди приходитимуть звіти DMARC).
3. Підтвердіть Gmail за листом від Cloudflare.

## 6. Перевірка

- `https://unipars.com.ua` відкриває сайт, `https://api.unipars.com.ua/api/health?deep=1` повертає `"ok":true`.
- Реєстрація з новою поштою: лист приходить від **UniPars <noreply@unipars.com.ua>**, у фірмовому дизайні, у вкладку «Вхідні», а не в спам.
- Перевірте репутацію відправлення на mail-tester.com. Ціль — 9/10 або вище.
- Лист на `support@unipars.com.ua` доходить у ваш Gmail.
