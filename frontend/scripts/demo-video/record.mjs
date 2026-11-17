// Запис демовідео UniPars з реального інтерфейсу (демосередовище: python scripts/demo_env.py up).
// node scripts/demo-video/record.mjs <вихідна папка>
// Результат: <сесія>.webm і events.json (мітки сцен і кліки, секунди від початку кожного запису).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, renameSync } from "fs";
import { join, resolve } from "path";

const BASE = "http://localhost:5190";
const API = "http://127.0.0.1:8020/api";
const OUT = resolve(process.argv[2] || "demo-video-raw");
const ASSETS = resolve("../backend/.demo_uploads/showcase_assets");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = {};

// Підсвічений курсор і «хвиля» на клік: у безголовому браузері системного курсора на відео немає
const CURSOR = () => {
  const style = document.createElement("style");
  style.textContent = `
    #__cur{position:fixed;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;pointer-events:none;z-index:2147483647;
      background:rgba(255,255,255,.96);box-shadow:0 0 0 7px rgba(95,245,220,.38),0 3px 12px rgba(0,0,0,.55);transition:transform .08s linear, scale .15s}
    #__cur.down{scale:.78}
    .__rip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #5ff5dc;pointer-events:none;z-index:2147483647;
      animation:__rip .55s ease-out forwards}
    @keyframes __rip{to{transform:scale(4.2);opacity:0}}
    ::-webkit-scrollbar{display:none}`;
  const c = document.createElement("div");
  c.id = "__cur";
  c.style.transform = "translate(-200px,-200px)";
  const host = () => document.querySelector("dialog[open]") || document.documentElement; // діалоги — у верхньому шарі
  const attach = () => { if (!document.head.contains(style)) document.head.appendChild(style); const h = host(); if (c.parentNode !== h) h.appendChild(c); };
  new MutationObserver(attach).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  addEventListener("mousemove", (e) => { c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
  addEventListener("mousedown", (e) => {
    c.classList.add("down");
    const r = document.createElement("div"); r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
    host().appendChild(r); setTimeout(() => r.remove(), 600);
  }, true);
  addEventListener("mouseup", () => c.classList.remove("down"), true);
  document.addEventListener("DOMContentLoaded", attach);
};

const browser = await chromium.launch({ channel: "chromium" });
const users = await (await (await browser.newContext()).request.get(`${API}/demo/users`)).json();
const user = (name) => users.find((u) => u.display_name === name);

async function session(name, { mobile = false } = {}) {
  // Десктоп 1536×864: при монтажі ×1.25 до 1920×1080 — інтерфейс у кадрі крупніший і читабельніший
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1536, height: 864 };
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: false, colorScheme: "dark", locale: "uk-UA",
    recordVideo: { dir: OUT, size: viewport }, // Playwright пише в CSS-пікселях; до 1920×1080 масштабуємо при монтажі
  });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const log = (events[name] = { marks: [], clicks: [] });
  const s = {
    page, ctx, name,
    mark: (label) => { log.marks.push({ label, t: (Date.now() - t0) / 1000 }); },
    async login(who, path = "/") {
      await page.goto(BASE + "/");
      await page.evaluate((id) => localStorage.setItem("unipars.demoUser", JSON.stringify(id)), user(who).id);
      await page.goto(BASE + path);
      await s.ready();
    },
    async ready() {
      await page.getByRole("status", { name: "Завантаження UniPars" }).waitFor({ state: "detached", timeout: 30000 });
      await sleep(600);
    },
    async move(locator, { steps = 28, dx = 0.5, dy = 0.5 } = {}) {
      await locator.scrollIntoViewIfNeeded();
      const b = await locator.boundingBox();
      await page.mouse.move(b.x + b.width * dx, b.y + b.height * dy, { steps });
      await sleep(250);
    },
    async click(locator, opts) {
      await s.move(locator, opts);
      log.clicks.push((Date.now() - t0) / 1000);
      await page.mouse.down(); await sleep(70); await page.mouse.up();
      await sleep(450);
    },
    async type(locator, text, delay = 38) {
      await s.click(locator);
      await locator.pressSequentially(text, { delay });
      await sleep(300);
    },
    // Плавний зум на елемент (сторінка перемальовується, текст лишається чітким)
    async zoom(locator, scale = 1.5, ms = 1000) {
      await locator.scrollIntoViewIfNeeded();
      const b = await locator.boundingBox();
      await page.evaluate(([x, y, w, h, scale, ms]) => {
        const inDialog = document.querySelector("dialog[open]");
        const el = inDialog || document.getElementById("root");
        const r = el.getBoundingClientRect();
        const cx = x + w / 2, cy = y + h / 2;
        el.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`;
        el.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`;
        el.style.transform = `translate(${innerWidth / 2 - cx}px, ${innerHeight / 2 - cy}px) scale(${scale})`;
      }, [b.x, b.y, b.width, b.height, scale, ms]);
      await sleep(ms + 100);
    },
    async unzoom(ms = 800) {
      await page.evaluate((ms) => {
        for (const el of [document.getElementById("root"), document.querySelector("dialog[open]")]) {
          if (!el) continue;
          el.style.transition = `transform ${ms}ms cubic-bezier(.45,0,.2,1)`;
          el.style.transform = "none";
        }
      }, ms);
      await sleep(ms + 100);
    },
    async scrollTo(y, ms = 900) {
      await page.evaluate(([y, ms]) => new Promise((done) => {
        const from = scrollY, t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          scrollTo(0, from + (y - from) * e); k < 1 ? requestAnimationFrame(step) : done(); };
        requestAnimationFrame(step);
      }), [y, ms]);
      await sleep(200);
    },
    async close() {
      const v = page.video();
      await ctx.close();
      renameSync(await v.path(), join(OUT, `${name}.webm`));
    },
  };
  return s;
}

const main = (p) => p.locator("#main");
const nav = (p) => p.getByRole("navigation", { name: "Основна навігація" });

// ---------- Данило: вхід паролем, налаштування акаунта ----------
const D = await session("danylo");
const S = await session("sofiia");
const A = await session("admin");
await Promise.all([S.login("Софія"), A.login("Адміністратор", "/admin")]);

await D.page.goto(BASE + "/");
D.mark("intro");
await D.ready();
D.mark("login");
await sleep(500);
await D.type(D.page.getByLabel("Email"), "danylo@unipars.test", 30);
await D.type(D.page.locator("#l-pass"), "UniPars-demo-2026", 30); // поле пароля — лише крапки
await D.click(D.page.getByRole("button", { name: "Увійти" }));
await D.page.getByRole("heading", { name: "Оберіть університет" }).waitFor();
D.mark("onboarding");
await sleep(500);
await D.click(D.page.getByRole("radio").first());
await D.click(D.page.getByRole("button", { name: "Далі" }));
await D.page.locator("#o-fac").waitFor();
D.mark("context");
for (const [id, opt] of [["#o-fac", { index: 1 }], ["#o-prog", { index: 1 }], ["#o-course", { value: "1" }], ["#o-group", { label: "ФЕП-11" }]]) {
  await D.click(D.page.locator(id));
  await D.page.locator(id).selectOption(opt);
  await sleep(350);
}
await D.click(D.page.getByRole("button", { name: "Далі" }));
await D.page.getByRole("heading", { name: "Підпишіться на предмети" }).waitFor();
D.mark("subjects-pick");
await sleep(900);
await D.click(D.page.getByRole("button", { name: "Зняти всі" }));
await D.click(D.page.getByRole("button", { name: "Обрати всі" }));
await sleep(700);
await D.click(D.page.getByRole("button", { name: "Перейти до стрічки" }));
await D.page.getByRole("heading", { name: /Найближчі дедлайни/ }).waitFor();
await sleep(600);
D.mark("home");

// ---------- Головна ----------
await D.page.mouse.move(600, 260, { steps: 16 });
await D.zoom(D.page.locator("section[aria-labelledby=dl-h]"), 1.4, 900);
D.mark("deadlines-zoomed");
await sleep(2200);
await D.unzoom(700);
const rail = D.page.getByRole("complementary", { name: "Допоміжна панель" });
await D.click(rail.getByRole("button", { name: /Зимова школа DevOps/ }));
D.mark("news-open");
await D.zoom(D.page.getByRole("dialog").locator("h3"), 1.3, 700);
await sleep(1800);
await D.unzoom(400);
await D.click(D.page.getByRole("dialog").getByRole("button", { name: "Закрити" }));
D.mark("news-closed");

// ---------- Предмет і лабораторна ----------
await D.click(nav(D.page).getByRole("link", { name: /^Предмети/ }));
await sleep(700);
await D.click(main(D.page).getByRole("link", { name: /Комп'ютерні інформаційні мережі/ }));
await D.page.getByRole("tab", { name: /Лабораторні/ }).waitFor();
D.mark("subject");
for (const t of [/Практичні/, /Модулі/, /Екзамени/, /Питання/]) await D.move(D.page.getByRole("tab", { name: t }), { steps: 10 });
await D.scrollTo(560, 900);
await D.click(main(D.page).getByRole("link", { name: /Маршрутизація: ping і traceroute/ }));
await D.page.getByRole("heading", { name: "Умова завдання" }).waitFor();
D.mark("task");
await sleep(600);
await D.scrollTo(380, 1000);
await sleep(1200);
const examples = D.page.locator("section", { has: D.page.getByRole("heading", { name: /Приклади виконання/ }) });
await examples.scrollIntoViewIfNeeded();
await D.click(examples.getByRole("button", { name: /^Переглянути ЛР9/ }));
D.mark("preview");
await sleep(2800);
await D.click(D.page.getByRole("dialog").getByRole("button", { name: "Закрити" }));
D.mark("preview-closed");

// ---------- Форум: Данило питає, Софія відповідає ----------
await D.scrollTo(0, 500);
await D.click(D.page.getByRole("link", { name: "Комп'ютерні інформаційні мережі та системи" }).first());
await D.page.getByRole("tab", { name: /Питання/ }).waitFor();
await D.click(D.page.getByRole("tab", { name: /Питання/ }));
D.mark("forum");
await D.click(D.page.getByRole("button", { name: "Поставити питання" }));
const ask = D.page.getByRole("dialog", { name: "Нове питання" });
await ask.waitFor();
D.mark("ask");
await D.type(ask.getByLabel("Питання"), "Лабораторна №9 — як читати traceroute?", 22);
await D.type(ask.getByLabel(/Подробиці/), "У мене в traceroute на другому переході три зірочки, але далі маршрут іде. Як це пояснити у звіті?", 14);
await D.click(ask.getByLabel("Стосується завдання"));
await ask.getByLabel("Стосується завдання").selectOption({ label: "№9 · Маршрутизація: ping і traceroute" });
await sleep(400);
await D.click(ask.getByRole("button", { name: "Опублікувати" }));
await D.page.getByRole("heading", { name: "Лабораторна №9 — як читати traceroute?" }).waitFor();
D.mark("asked");
await sleep(1500);

await S.page.goto(BASE + "/subjects/net?tab=questions");
await S.ready();
S.mark("forum");
await S.click(main(S.page).getByRole("link", { name: /Лабораторна №9 — як читати traceroute/ }));
await S.page.getByRole("heading", { name: "Лабораторна №9 — як читати traceroute?" }).waitFor();
S.mark("thread");
await sleep(800);
await S.type(S.page.getByPlaceholder(/Поясни хід розв'язання|Напишіть коментар/), "Цей вузол не відповів на пробні пакети. Якщо наступні переходи видно, маршрут на ньому не обірвався.", 14);
await S.click(S.page.getByRole("button", { name: "Коментувати" }));
await S.page.locator("[id^='c-']", { hasText: "Цей вузол не відповів" }).waitFor();
S.mark("answered");
await sleep(1500);

D.mark("reload");
await D.page.reload();
await D.ready();
D.mark("reloaded");
await D.move(D.page.locator("[id^='c-']", { hasText: "Цей вузол не відповів" }).first());
await D.type(D.page.getByPlaceholder(/Поясни хід розв'язання|Напишіть коментар/), "Зрозумів, тоді вкажу це під скріном маршруту. Дякую!", 16);
await D.click(D.page.getByRole("button", { name: "Коментувати" }));
await D.page.locator("[id^='c-']", { hasText: "Зрозумів, тоді вкажу" }).waitFor();
await D.page.mouse.move(1250, 760, { steps: 16 });
await D.scrollTo(0, 400);
await D.zoom(D.page.locator("#main"), 1.12, 900);
D.mark("dialog-final");
await sleep(3200);
await D.unzoom(600);

// ---------- Подання роботи → модерація ----------
await D.click(D.page.getByRole("navigation", { name: "Шлях" }).getByRole("link", { name: /№9/ }));
await D.page.getByRole("heading", { name: "Умова завдання" }).waitFor();
D.mark("task2");
await D.click(D.page.getByRole("button", { name: "Подати свій варіант" }).last());
const dlg = D.page.getByRole("dialog", { name: "Подати свій варіант" });
await dlg.waitFor();
D.mark("submit-dialog");
await D.move(dlg.locator("label[for=file-input]"));
await dlg.locator("input[type=file]").setInputFiles({ name: "ЛР9_Данило_ФЕП-11.pdf", mimeType: "application/pdf",
  buffer: (await import("fs")).readFileSync(join(ASSETS, "danylo-lr9.pdf")) });
await sleep(600);
await D.type(dlg.getByLabel(/Коментар для модератора/), "Варіант 4", 30);
await D.move(dlg.getByText("Опублікувати анонімно"));
D.mark("anon-option");
await sleep(900);
await D.click(dlg.getByRole("button", { name: "Надіслати на розгляд" }));
await D.page.getByText("Роботу надіслано на розгляд").waitFor();
await sleep(300);
await D.zoom(D.page.getByText("Ваші подання до цього завдання").locator(".."), 1.6, 800);
D.mark("pending");
await sleep(2000);
await D.unzoom(600);

A.mark("queue-start");
await A.page.reload();
await A.ready();
A.mark("queue");
const card = main(A.page).locator("li", { hasText: "ЛР9_Данило_ФЕП-11.pdf" });
await A.move(card);
await A.click(card.getByRole("button", { name: /^Переглянути ЛР9_Данило/ }));
A.mark("review-preview");
await sleep(2400);
await A.click(A.page.getByRole("dialog").getByRole("button", { name: "Закрити" }));
await A.click(card.getByRole("button", { name: "Схвалити й опублікувати" }));
await A.page.getByText("Роботу опубліковано біля завдання").waitFor();
A.mark("approved");
await sleep(1500);

// ---------- Опубліковано + сповіщення ----------
D.mark("back-start");
await D.page.reload();
await D.ready();
D.mark("published");
const ex = D.page.locator("section", { has: D.page.getByRole("heading", { name: /Приклади виконання/ }) });
await ex.scrollIntoViewIfNeeded();
await D.zoom(ex.locator("li", { hasText: "ЛР9_Данило_ФЕП-11.pdf" }), 1.5, 800);
await sleep(1800);
await D.unzoom(500);
await D.move(nav(D.page).getByRole("link", { name: /^Сповіщення/ }));
D.mark("bell");
await sleep(700);
await D.click(nav(D.page).getByRole("link", { name: /^Сповіщення/ }));
await D.page.getByRole("heading", { name: "Сповіщення" }).waitFor();
D.mark("notifications");
await D.zoom(main(D.page).locator("ul").first(), 1.3, 800);
await sleep(2400);
await D.unzoom(500);

// ---------- Особисті повідомлення ----------
await D.page.goto(BASE + `/u/${user("Софія").id}`);
await D.ready();
D.mark("profile");
await sleep(500);
await D.click(main(D.page).getByRole("button", { name: "Написати" }));
await D.page.locator("#dm-input").waitFor();
D.mark("dm");
await D.type(D.page.locator("#dm-input"), "Дякую за пояснення! Скинеш, як оформила таблицю переходів?", 16);
await D.click(D.page.getByRole("button", { name: "Надіслати" }));
D.mark("dm-sent");
await sleep(1200);

await S.page.goto(BASE + "/messages");
await S.ready();
S.mark("inbox");
await sleep(600);
await S.click(main(S.page).getByRole("link", { name: /Данило/ }));
await S.page.locator("#dm-input").waitFor();
S.mark("dm-open");
await sleep(500);
await S.type(S.page.locator("#dm-input"), "Звісно! Таблиця є в моєму звіті до ЛР9, розділ 2 🙂", 16);
await S.click(S.page.getByRole("button", { name: "Надіслати" }));
S.mark("dm-replied");
await sleep(1000);

D.mark("dm-wait");
await D.page.locator("[aria-live=polite]").getByText("Таблиця є в моєму звіті").waitFor({ timeout: 15000 });
D.mark("dm-received");
await sleep(2200);

// ---------- «Купити звіт» ----------
await D.page.goto(BASE + `/tasks/${(await (await D.page.request.get(`${API}/subjects/net/tasks?kind=lab`, { headers: { Authorization: `Bearer demo:${user("Данило").id}`, "X-University-Id": user("Данило").university_id } })).json()).items[8].id}`);
await D.ready();
const buy = D.page.getByRole("button", { name: /Купити звіт/ });
await buy.scrollIntoViewIfNeeded();
D.mark("buy");
await D.click(buy);
const buyDlg = D.page.getByRole("dialog", { name: "Купити звіт" });
await buyDlg.waitFor();
await D.zoom(buyDlg.locator("p"), 1.35, 700);
D.mark("buy-open");
await sleep(2800);
D.mark("end");
await Promise.all([D.close(), S.close(), A.close()]);

// ---------- Мобільна версія ----------
const M = await session("mobile", { mobile: true });
await M.login("Данило", "/");
M.mark("home");
await sleep(1600);
await M.scrollTo(700, 1800);
await sleep(1200);
await M.scrollTo(0, 900);
await M.click(M.page.getByRole("navigation", { name: "Нижня навігація" }).getByRole("link", { name: "Предмети" }));
await sleep(1100);
await M.click(main(M.page).getByRole("link", { name: /Комп'ютерні інформаційні мережі/ }));
await M.page.getByRole("tab", { name: /Лабораторні/ }).waitFor();
M.mark("subject");
await sleep(1600);
await M.scrollTo(500, 1200);
await sleep(800);
await M.page.getByRole("tab", { name: /Питання/ }).scrollIntoViewIfNeeded();
await M.click(M.page.getByRole("tab", { name: /Питання/ }));
M.mark("forum");
await sleep(1500);
await M.click(main(M.page).getByRole("link", { name: /Лабораторна №9 — як читати traceroute/ }));
await M.page.getByRole("heading", { name: /як читати traceroute/ }).waitFor();
M.mark("thread");
await sleep(1400);
await M.scrollTo(600, 1600);
await sleep(1500);
M.mark("end");
await M.close();

// ---------- Заставка: анімація логотипа ----------
const L = await session("logo");
await L.page.goto(BASE + "/");
L.mark("start");
await sleep(4300);
L.mark("end");
await L.close();

await browser.close();
writeFileSync(join(OUT, "events.json"), JSON.stringify(events, null, 1));
console.log("recorded:", Object.keys(events).join(", "));

function log(msg) { /* мітка для налагодження */ void msg; }
