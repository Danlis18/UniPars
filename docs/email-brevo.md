# Пошта без власного домену: Brevo (тимчасово)

Поки немає домену `unipars.com.ua`, листи підтвердження й відновлення пароля надсилаємо через **Brevo**. У нього є офіційна інтеграція з Supabase.

- **Безкоштовно**: 300 листів на день.
- **Домен не потрібен**: достатньо підтвердити одну адресу відправника.

Коли з'явиться домен, перейдемо на Resend ([domain-and-email.md](domain-and-email.md)). Для цього потрібно лише змінити налаштування SMTP у Supabase, у коді нічого міняти не доведеться.

## 1. Акаунт і відправник

1. Зареєструйтесь на brevo.com, тариф **Free**.
2. **Settings → Senders, Domains & Dedicated IPs → Senders → Add a sender**:
   - From name: `UniPars`;
   - From email: адреса, з якої йтимуть листи. Краще окрема пошта проєкту, наприклад `unipars.team@gmail.com`, а не особиста.
3. Підтвердіть адресу кодом із листа від Brevo.

## 2. SMTP-ключ

**Settings → SMTP & API → SMTP** → **Generate a new SMTP key**, назва `supabase-auth`. Скопіюйте:
- **Login**: виглядає як `xxxxxx@smtp-brevo.com`;
- **SMTP key**: показується лише один раз.

Потрібен саме **SMTP key**, а не API key: SMTP-сервер приймає лише його.

## 3. Підключити до Supabase

Supabase → **Authentication → Emails → SMTP Settings** → **Enable custom SMTP**:

| Поле | Значення |
|---|---|
| Sender email | адреса, підтверджена в Brevo (крок 1) — має збігатися точно |
| Sender name | `UniPars` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | Login із кроку 2 |
| Password | SMTP key із кроку 2 |

Далі:
- **Authentication → Rate Limits → Emails sent per hour**: поставте `100`.
- **Authentication → Emails → Templates**: тепер поля доступні для редагування. Вставте фірмові шаблони:
  - **Confirm signup** ← `supabase/templates/confirmation.html`, тема `Код підтвердження UniPars`;
  - **Reset password** ← `supabase/templates/recovery.html`, тема `Код для зміни пароля UniPars`.
- Решта налаштувань входу (код у листі, вимоги до пароля, Google): [auth.md](auth.md).

## 4. Перевірка

- Зареєструйте тестовий акаунт: лист має прийти від **UniPars** у фірмовому дизайні.
- Brevo → **Transactional → Logs** показує статус кожного листа: delivered, bounced, spam.

## Обмеження цього варіанта

- Відправка з адреси `@gmail.com` через сторонній сервіс не проходить перевірку DMARC Gmail. Частина листів може потрапити в «Спам» або «Промоакції», а Brevo може переписати відправника. Для тестів і перших користувачів цього вистачить. Для публічного запуску потрібен свій домен.
- Ліміт — 300 листів на день.
