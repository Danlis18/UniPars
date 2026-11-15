"""Генерує фірмові шаблони листів Supabase Auth (supabase/templates/*.html).

Картинки — PNG на frontend (поштові клієнти не показують SVG). Якщо зміниться адреса сайту,
змініть SITE і перегенеруйте: python scripts/gen_email_templates.py
"""
from pathlib import Path

SITE = "https://unipars-frontend-production.up.railway.app"
OUT = Path(__file__).resolve().parent.parent / "supabase" / "templates"

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif"
MONO = "'SF Mono',Menlo,Consolas,'Roboto Mono','Courier New',monospace"
HELLO = "Привіт{{ if .Data.display_name }}, {{ .Data.display_name }}{{ end }}!"


def page(*, title, preheader, eyebrow, heading, bubble, lead, code_label, after_code, footer_note):
    return f"""<!doctype html>
<html lang="uk" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#eef2ec;font-family:{FONT};color:#16241c;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">{preheader}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2ec;">
    <tr>
      <td align="center" style="padding:32px 12px 40px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">

          <!-- Логотип -->
          <tr>
            <td align="center" style="padding:0 0 20px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                <td style="vertical-align:middle;"><img src="{SITE}/email/logo.png" width="44" height="44" alt="" style="display:block;border:0;border-radius:12px;"></td>
                <td style="vertical-align:middle;padding-left:10px;font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#16241c;">Uni<span style="color:#0db29c;">Pars</span></td>
              </tr></table>
            </td>
          </tr>

          <!-- Картка -->
          <tr>
            <td style="background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #dfe7dc;box-shadow:0 24px 60px -28px rgba(16,86,62,0.45);">

              <!-- Шапка -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background:#0f2a20;background-image:linear-gradient(135deg,#0f2a20 0%,#10563e 55%,#139f86 100%);padding:34px 32px 30px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
                      <td width="96" style="vertical-align:middle;width:96px;">
                        <img src="{SITE}/email/pars.png" width="88" height="88" alt="Парс — помічник UniPars" style="display:block;border:0;border-radius:50%;">
                      </td>
                      <td style="vertical-align:middle;padding-left:16px;">
                        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#bef248;font-weight:700;">{eyebrow}</div>
                        <div style="margin-top:6px;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff;">{heading}</div>
                        <div style="margin-top:8px;display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);border-radius:14px 14px 14px 4px;padding:8px 12px;font-size:14px;line-height:1.45;color:#e6fbf4;">{bubble}</div>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>

              <!-- Тіло -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding:30px 32px 6px;font-size:15px;line-height:1.65;color:#33443a;">
                    <div style="font-size:18px;font-weight:700;color:#16241c;margin-bottom:6px;">{HELLO}</div>
                    {lead}
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:20px 32px 4px;">
                    <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6c7c72;font-weight:700;margin-bottom:10px;">{code_label}</div>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background:#f0fbf8;border:2px dashed #7fe3cf;border-radius:20px;">
                      <tr><td align="center" style="padding:18px 30px 18px 40px;font-family:{MONO};font-size:40px;line-height:1;font-weight:800;letter-spacing:12px;color:#0b2a1f;">{{{{ .Token }}}}</td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:14px 32px 28px;font-size:13px;line-height:1.6;color:#6c7c72;">
                    Код діє <b style="color:#33443a;">1 годину</b> і спрацює лише один раз.
                  </td>
                </tr>
                {after_code}
                <tr>
                  <td style="padding:0 32px 30px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff8e6;border-radius:14px;">
                      <tr><td style="padding:14px 16px;font-size:13px;line-height:1.55;color:#6b5512;">
                        🔒 Нікому не повідомляйте цей код. Команда UniPars ніколи не просить його — ні в листах, ні в повідомленнях.
                      </td></tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Футер -->
          <tr>
            <td align="center" style="padding:22px 20px 0;font-size:12px;line-height:1.7;color:#7d8b82;">
              {footer_note}<br>
              Лист надіслано на {{{{ .Email }}}}<br>
              <span style="color:#10563e;font-weight:700;">UniPars</span> · платформа взаємодопомоги студентів ·
              <a href="{SITE}/privacy" style="color:#7d8b82;">Конфіденційність</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


FEATURES = """<tr>
                  <td style="padding:0 32px 22px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f8f3;border-radius:16px;">
                      <tr><td style="padding:16px 18px 4px;font-size:12px;font-weight:800;color:#10563e;letter-spacing:1px;">ЩО ВАС ЧЕКАЄ</td></tr>
                      <tr><td style="padding:4px 18px;font-size:14px;line-height:1.5;color:#33443a;">📚&nbsp; Конспекти й лабораторні за предметами вашого курсу</td></tr>
                      <tr><td style="padding:4px 18px;font-size:14px;line-height:1.5;color:#33443a;">💬&nbsp; Запитання та відповіді однокурсників</td></tr>
                      <tr><td style="padding:4px 18px 16px;font-size:14px;line-height:1.5;color:#33443a;">📰&nbsp; Новини університету й факультету в одній стрічці</td></tr>
                    </table>
                  </td>
                </tr>"""

TEMPLATES = {
    "confirmation.html": dict(
        title="Код підтвердження — UniPars",
        preheader="Ваш код підтвердження UniPars: {{ .Token }}",
        eyebrow="Ласкаво просимо",
        heading="Залишився один крок",
        bubble="Я Парс, помічник UniPars. Введіть код — і я все покажу 👋",
        lead="Ви реєструєтеся в UniPars. Щоб підтвердити пошту, введіть цей код на сторінці реєстрації:",
        code_label="Код підтвердження",
        after_code=FEATURES,
        footer_note="Не реєструвалися в UniPars? Просто проігноруйте цей лист — акаунт не буде активовано.",
    ),
    "recovery.html": dict(
        title="Зміна пароля — UniPars",
        preheader="Код для зміни пароля UniPars: {{ .Token }}",
        eyebrow="Безпека акаунта",
        heading="Зміна пароля",
        bubble="Трапляється з кожним 🙂 Зараз усе відновимо.",
        lead="Ми отримали запит на зміну пароля. Введіть цей код на сторінці відновлення — і одразу задасте новий пароль:",
        code_label="Код для зміни пароля",
        after_code="",
        footer_note="Не просили змінити пароль? Проігноруйте цей лист — пароль залишиться попереднім.",
    ),
}

if __name__ == "__main__":
    for name, kw in TEMPLATES.items():
        (OUT / name).write_text(page(**kw), encoding="utf-8")
        print("written", OUT / name)
