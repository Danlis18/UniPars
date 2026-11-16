import { expect, test } from "@playwright/test";
import { api, loginAs } from "./helpers.js";

const PDF = (label) => ({ name: `${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${label}\n`) });

// Ідентифікатор завдання за предметом і номером (через API, щоб тест не залежав від порядку карток)
async function taskId(request, user, slug, kind, number) {
  const r = await api(request, user, "GET", `/subjects/${slug}/tasks?kind=${kind}`);
  return (await r.json()).items.find((t) => t.number === number).id;
}

test.describe("Навчальний посібник: завдання, подання, модерація", () => {
  test("від предмета до завдання → подання → схвалення → приклад на сторінці завдання", async ({ page, request }) => {
    const file = `e2e-approve-${Date.now()}`;
    await loginAs(page, request, "Олена", "/subjects");
    await page.locator("#main").getByRole("link", { name: /Бази даних/ }).click();
    await expect(page.getByRole("tab", { name: /Лабораторні/ })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("link", { name: /Нормалізація до 3НФ/ }).click();
    await expect(page.getByRole("heading", { name: "Нормалізація до 3НФ", level: 1 })).toBeVisible();
    // Порядок блоків: умова → приклади → подання → «Купити звіт»
    const order = await page.locator("#main h2, #main button").evaluateAll((els) => els.map((e) => e.textContent.trim()));
    const idx = (re) => order.findIndex((t) => re.test(t));
    expect(idx(/^Умова завдання/)).toBeLessThan(idx(/^Приклади виконання/));
    expect(idx(/^Приклади виконання/)).toBeLessThan(idx(/Купити звіт/));

    await page.getByRole("button", { name: "Подати свій варіант" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Подати свій варіант" });
    await expect(dialog.getByText("Бази даних")).toBeVisible(); // предмет і завдання підставлено
    await dialog.locator("input[type=file]").setInputFiles(PDF(file));
    await dialog.getByLabel(/Коментар для модератора/).fill("Варіант 3");
    await dialog.getByRole("button", { name: "Надіслати на розгляд" }).click();
    await expect(page.getByText("Роботу надіслано на розгляд")).toBeVisible();
    await expect(page.getByText(`${file}.pdf`)).toBeVisible();
    await expect(page.getByText("На розгляді").first()).toBeVisible();
    const taskUrl = new URL(page.url()).pathname;

    await page.goto("/submissions");
    await expect(page.locator("#main li", { hasText: `${file}.pdf` }).getByText("На розгляді")).toBeVisible();

    // Інший студент поки не бачить роботу
    await loginAs(page, request, "Максим", taskUrl);
    await expect(page.getByText(`${file}.pdf`)).toHaveCount(0);

    // Модераторка відкриває файл і схвалює
    await loginAs(page, request, "Ірина", "/admin");
    const card = page.locator("#main li", { hasText: `${file}.pdf` });
    // Перегляд PDF прямо на сайті: вікно з iframe, файл віддається inline
    await card.getByRole("button", { name: `Переглянути ${file}.pdf` }).click();
    const viewer = page.getByRole("dialog", { name: `${file}.pdf` });
    const frame = viewer.locator("iframe");
    await expect(frame).toBeVisible();
    const res = await request.get(await frame.getAttribute("src"));
    expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
    expect(res.headers()["content-disposition"]).toMatch(/^inline/);
    // «Завантажити» справді завантажує файл
    const [download] = await Promise.all([page.waitForEvent("download"), viewer.getByRole("button", { name: "Завантажити" }).click()]);
    expect(download.suggestedFilename()).toContain(file);
    await viewer.getByRole("button", { name: "Закрити" }).click();
    await card.getByRole("button", { name: "Схвалити й опублікувати" }).click();
    await expect(page.getByText("Роботу опубліковано біля завдання")).toBeVisible();

    // Тепер приклад видно всім біля завдання
    await loginAs(page, request, "Максим", taskUrl);
    await expect(page.locator("section", { has: page.getByRole("heading", { name: /Приклади виконання/ }) }).getByText(`${file}.pdf`)).toBeVisible();
    await loginAs(page, request, "Олена", "/submissions");
    await expect(page.locator("#main li", { hasText: `${file}.pdf` }).getByText("Опубліковано")).toBeVisible();
  });

  test("відхилення з причиною: автор бачить причину, інші не бачать роботу", async ({ page, request }) => {
    const file = `e2e-reject-${Date.now()}`;
    const maksym = await loginAs(page, request, "Максим");
    const id = await taskId(request, maksym, "db", "lab", 3);
    await page.goto(`/tasks/${id}`);
    await page.getByRole("button", { name: "Подати свій варіант" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Подати свій варіант" });
    await dialog.locator("input[type=file]").setInputFiles(PDF(file));
    await dialog.getByRole("button", { name: "Надіслати на розгляд" }).click();
    await expect(page.getByText("Роботу надіслано на розгляд")).toBeVisible();

    await loginAs(page, request, "Ірина", "/admin");
    const card = page.locator("#main li", { hasText: `${file}.pdf` });
    await card.getByRole("button", { name: "Відхилити" }).click();
    await expect(card.getByRole("button", { name: "Відхилити" })).toBeDisabled(); // без причини не можна
    await card.getByLabel(/Причина відхилення/).fill("Бракує висновків");
    await card.getByRole("button", { name: "Відхилити" }).click();
    await expect(page.getByText("Роботу відхилено")).toBeVisible();

    await loginAs(page, request, "Максим", "/submissions");
    const mine = page.locator("#main li", { hasText: `${file}.pdf` });
    await expect(mine.getByText("Відхилено")).toBeVisible();
    await expect(mine.getByText("Бракує висновків")).toBeVisible();
    await loginAs(page, request, "Олена", `/tasks/${id}`);
    await expect(page.getByText(`${file}.pdf`)).toHaveCount(0);
  });

  test("звичайний студент не має доступу до модерації", async ({ page, request }) => {
    await loginAs(page, request, "Олена", "/admin");
    await expect(page.getByText("Немає доступу")).toBeVisible();
    const olena = await loginAs(page, request, "Олена");
    const r = await api(request, olena, "GET", "/moderation/submissions");
    expect(r.status()).toBe(403);
  });

  test("непідтримуваний файл: зрозуміла помилка в діалозі подання", async ({ page, request }) => {
    const olena = await loginAs(page, request, "Олена");
    await page.goto(`/tasks/${await taskId(request, olena, "db", "lab", 1)}`);
    await page.getByRole("button", { name: "Подати свій варіант" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Подати свій варіант" });
    await dialog.locator("input[type=file]").setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await dialog.getByRole("button", { name: "Надіслати на розгляд" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Непідтримуваний тип файлу");
  });

  test("«Купити звіт» — анонс із позначкою «Скоро»", async ({ page, request }) => {
    const olena = await loginAs(page, request, "Олена");
    await page.goto(`/tasks/${await taskId(request, olena, "db", "lab", 1)}`);
    await expect(page.getByText(/Скоро тут можна буде замовити окремий варіант звіту/).first()).toBeVisible();
    await page.getByRole("button", { name: /Купити звіт/ }).click();
    const dialog = page.getByRole("dialog", { name: "Купити звіт" });
    await expect(dialog.getByText("Скоро", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/ШІ адаптуватиме структуру/)).toBeVisible();
    await expect(dialog.getByText(/грн|₴|\$/)).toHaveCount(0); // без цін
  });
});

test.describe("Форум предмета", () => {
  test("питання з прив'язкою до лабораторної, відповідь і прийняття", async ({ page, request }) => {
    const title = `E2E: як оформити SQL-запити ${Date.now()}`;
    await loginAs(page, request, "Олена", "/subjects/db?tab=questions");
    await page.getByRole("button", { name: "Поставити питання" }).click();
    const dialog = page.getByRole("dialog", { name: "Нове питання" });
    await dialog.getByLabel("Питання").fill(title);
    await dialog.getByLabel(/Подробиці/).fill("Чи треба коментувати кожен запит?");
    await dialog.getByLabel("Стосується завдання").selectOption({ label: "№3 · SQL-запити: вибірка та з'єднання" });
    await dialog.getByRole("button", { name: "Опублікувати" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Шлях" }).getByRole("link", { name: /№3/ })).toBeVisible();
    const url = new URL(page.url()).pathname;

    // У списку тем предмета: заголовок, дата, кількість відповідей
    await page.goto("/subjects/db?tab=questions");
    await expect(page.locator("#main li", { hasText: title }).getByText("відп.")).toBeVisible();

    await loginAs(page, request, "Максим", url);
    await page.getByPlaceholder(/Поясни хід розв'язання|Напишіть коментар/).fill("Так, коротко: **що** робить запит.");
    await page.getByRole("button", { name: "Коментувати" }).click();
    await expect(page.getByText("що робить запит")).toBeVisible();

    await loginAs(page, request, "Олена", url);
    await page.getByRole("button", { name: "Прийняти відповідь" }).click();
    await expect(page.getByText("Прийнята відповідь")).toBeVisible();

    // Питання не потрапляють на головну
    await page.goto("/");
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("відповідь на коментар з'являється гілкою і надсилає сповіщення", async ({ page, request }) => {
    await loginAs(page, request, "Максим", "/subjects/linalg?tab=questions");
    await page.locator("#main li a").first().click();
    await page.getByPlaceholder(/Поясни хід|Напишіть коментар/).fill("Корінний коментар E2E");
    await page.getByRole("button", { name: "Коментувати" }).click();
    const root = page.locator("[id^='c-']", { hasText: "Корінний коментар E2E" }).first();
    await expect(root).toBeVisible();
    const url = new URL(page.url()).pathname;

    await loginAs(page, request, "Олена", url);
    const rootAgain = page.locator("[id^='c-']", { hasText: "Корінний коментар E2E" }).first();
    await rootAgain.getByRole("button", { name: "Відповісти" }).first().click();
    await page.getByLabel("Відповідь на коментар").fill("Відповідь у гілці E2E");
    await page.getByRole("button", { name: "Відповісти", exact: true }).last().click();
    await expect(rootAgain.getByText("Відповідь у гілці E2E")).toBeVisible();

    await loginAs(page, request, "Максим", "/notifications");
    await expect(page.getByText("відповів(ла) на ваш коментар").first()).toBeVisible();
  });
});

test.describe("Соцфункції та повідомлення", () => {
  test("підписка, профіль і листування з тим, хто підписаний на тебе", async ({ page, request }) => {
    const maksym = await loginAs(page, request, "Максим");
    const text = `Привіт з E2E ${Date.now()}`;

    // Максим підписаний на Олену → Олена може йому написати
    await loginAs(page, request, "Олена", `/u/${maksym.id}`);
    await expect(page.getByText("Читає вас")).toBeVisible();
    await page.getByRole("button", { name: "Написати" }).click();
    await expect(page).toHaveURL(/\/messages\//);
    await page.locator("#dm-input").fill(text);
    await page.getByRole("button", { name: "Надіслати" }).click();
    await expect(page.locator("[aria-live=polite]").getByText(text)).toBeVisible();

    // Максим бачить непрочитане і відповідає
    await loginAs(page, request, "Максим", "/messages");
    await expect(page.getByRole("link", { name: /Олена Коваль/ })).toContainText(text.slice(0, 20));
    await page.getByRole("link", { name: /Олена Коваль/ }).click();
    await expect(page.locator("[aria-live=polite]").getByText(text)).toBeVisible();
    await page.locator("#dm-input").fill("Привіт! Отримав 👋");
    await page.keyboard.press("Enter");
    await expect(page.locator("[aria-live=polite]").getByText("Привіт! Отримав 👋")).toBeVisible();
  });

  test("не можна написати тому, хто на тебе не підписаний", async ({ page, request }) => {
    const iryna = await loginAs(page, request, "Ірина");
    // Олена читає Ірину, але Ірина не читає Олену
    await loginAs(page, request, "Олена", `/u/${iryna.id}`);
    await expect(page.getByRole("button", { name: "Написати" })).toBeDisabled();
  });

  test("підписка оновлює лічильник і з'являється в списку читачів", async ({ page, request }) => {
    const andrii = await loginAs(page, request, "Андрій");
    await loginAs(page, request, "Олена", `/u/${andrii.id}`);
    const main = page.locator("#main");
    const before = Number(await main.getByRole("button", { name: /читач/ }).locator("span").first().innerText());
    await main.getByRole("button", { name: "Читати", exact: true }).click();
    await expect(main.getByRole("button", { name: "Ви читаєте" })).toBeVisible();
    await expect(main.getByRole("button", { name: /читач/ }).locator("span").first()).toHaveText(String(before + 1));
    await main.getByRole("button", { name: /читач/ }).click();
    await expect(page.getByRole("dialog").getByText("Олена Коваль")).toBeVisible();
  });

  test("Telegram у профілі: збереження і посилання", async ({ page, request }) => {
    await loginAs(page, request, "Олена", "/u/me");
    await page.getByRole("button", { name: "Редагувати" }).click();
    await page.getByLabel("Telegram (необов'язково)").fill("t.me/olena_e2e");
    await page.getByRole("dialog").getByRole("button", { name: "Зберегти" }).click();
    await expect(page.getByRole("link", { name: "@olena_e2e" })).toHaveAttribute("href", "https://t.me/olena_e2e");
  });

  test("агент Парс відкриває скляну панель поверх сайту, підказки клікабельні", async ({ page, request }) => {
    await loginAs(page, request, "Олена");
    await page.getByRole("button", { name: /Агент підтримки UniPars/ }).first().click();
    const panel = page.getByRole("dialog", { name: "Допомога UniPars" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Відкриється незабаром")).toBeVisible(); // AI — SOON
    await panel.getByRole("button", { name: /Знайти приклад/ }).click();
    await expect(page).toHaveURL(/\/subjects/);
  });
});

test.describe("Профіль: аватар, читачі, предмети курсу", () => {
  test("зміна фото профілю: завантаження, стиснення, показ", async ({ page, request }) => {
    await loginAs(page, request, "Максим", "/u/me");
    await page.getByRole("button", { name: "Редагувати" }).click();
    // мінімальний валідний PNG 1×1
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await page.getByRole("dialog").locator("input[type=file][accept^='image']").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Фото профілю оновлено")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Змінити фото" })).toBeVisible();
    const src = await page.getByRole("dialog").locator("img").first().getAttribute("src");
    expect(src).toContain("/api/public/");
    expect((await request.get(src)).headers()["content-type"]).toBe("image/webp");
  });

  test("вкладки «Читачі» і «Читає» у профілі", async ({ page, request }) => {
    const iryna = await loginAs(page, request, "Ірина");
    await loginAs(page, request, "Максим", `/u/${iryna.id}?tab=followers`);
    await expect(page.getByRole("tab", { name: /Читачі/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#main").getByRole("link", { name: /Олена Коваль/ })).toBeVisible();
    await page.getByRole("tab", { name: /Читає/ }).click();
    await expect(page.locator("#main").getByRole("link", { name: /Андрій Мельник/ })).toBeVisible();
  });

  test("каталог показує предмети мого курсу, а «Усі» — повний перелік", async ({ page, request }) => {
    await loginAs(page, request, "Олена", "/subjects");
    await expect(page.getByRole("tab", { name: "Мій курс" })).toHaveAttribute("aria-selected", "true");
    const mine = await page.locator("#main ul > li").count();
    await page.getByRole("tab", { name: "Усі" }).click();
    await expect.poll(() => page.locator("#main ul > li").count()).toBeGreaterThan(mine);
  });
});
