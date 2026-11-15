"""Генерує шаблони листів Supabase Auth (supabase/templates/*.html).

Мінімалістичний лист: назва, код і одне речення. Без картинок, емодзі й маркетингового
тексту — такі листи рідше потрапляють у «Спам» і читаються з першого погляду.
Запуск: python scripts/gen_email_templates.py
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "supabase" / "templates"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
MONO = "'SF Mono',Menlo,Consolas,'Roboto Mono','Courier New',monospace"


def page(*, title, preheader, heading, text, note):
    return f"""<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f3;font-family:{FONT};color:#16241c;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f3;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:440px;background:#ffffff;border-radius:20px;border:1px solid #e3e8e1;">
          <tr>
            <td style="padding:32px 32px 0;font-size:20px;font-weight:800;letter-spacing:-0.3px;color:#16241c;">Uni<span style="color:#0db29c;">Pars</span></td>
          </tr>
          <tr>
            <td style="padding:24px 32px 0;font-size:17px;font-weight:700;color:#16241c;">{heading}</td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;font-size:15px;line-height:1.55;color:#4a5a50;">{text}</td>
          </tr>
          <tr>
            <td style="padding:24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="background:#0f2a20;border-radius:14px;padding:20px 8px 20px 20px;font-family:{MONO};font-size:36px;line-height:1;font-weight:700;letter-spacing:12px;color:#5ff5dc;">{{{{ .Token }}}}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;font-size:13px;line-height:1.55;color:#7d8b82;">{note}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


TEMPLATES = {
    "confirmation.html": dict(
        title="Код підтвердження UniPars",
        preheader="Ваш код: {{ .Token }}",
        heading="Код підтвердження",
        text="Введіть його на сторінці реєстрації.",
        note="Код діє 1 годину. Якщо ви не реєструвалися в UniPars, просто проігноруйте цей лист.",
    ),
    "recovery.html": dict(
        title="Код для зміни пароля UniPars",
        preheader="Код для зміни пароля: {{ .Token }}",
        heading="Зміна пароля",
        text="Введіть цей код на сторінці відновлення й задайте новий пароль.",
        note="Код діє 1 годину. Якщо ви не просили змінити пароль, проігноруйте цей лист.",
    ),
}

if __name__ == "__main__":
    for name, kw in TEMPLATES.items():
        (OUT / name).write_text(page(**kw), encoding="utf-8")
        print("written", OUT / name)
