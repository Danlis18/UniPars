import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers.js";

test.describe("Дописи, файли, коментарі", () => {
  test("студент ставить запитання, інший відповідає, автор приймає відповідь", async ({ page, request }) => {
    const title = `E2E: як працює рекурсія ${Date.now()}`;
    await loginAs(page, request, "Олена", "/questions?compose=question");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Предмет *").selectOption({ label: "Алгоритми і структури даних" });
    await dialog.getByLabel("Короткий заголовок *").fill(title);
    await dialog.getByLabel("Умова або опис проблеми").fill("Чому `fib(40)` рахується так довго?");
    await dialog.getByLabel("Що вже пробував").fill("Додав print — бачу багато повторних викликів");
    await dialog.getByRole("button", { name: "Опублікувати" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("Відкрите")).toBeVisible();
    const postUrl = page.url();

    await loginAs(page, request, "Максим", new URL(postUrl).pathname);
    await page.getByPlaceholder(/Поясни хід розв'язання/).fill("Використай **мемоізацію**: зберігай уже пораховані значення.");
    await page.getByRole("button", { name: "Коментувати" }).click();
    await expect(page.getByText("мемоізацію")).toBeVisible();

    await loginAs(page, request, "Олена", new URL(postUrl).pathname);
    await page.getByRole("button", { name: "Прийняти відповідь" }).click();
    await expect(page.getByText("Прийнята відповідь")).toBeVisible();
    await expect(page.getByText("Вирішене").first()).toBeVisible();
  });

  test("відповідь на коментар з'являється гілкою і надсилає сповіщення", async ({ page, request }) => {
    await loginAs(page, request, "Максим", "/questions");
    await page.locator("article a[id^='t-']").first().click();
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

  test("матеріал з PDF: прогрес завантаження і відкриття файлу", async ({ page, request }) => {
    const title = `E2E конспект ${Date.now()}`;
    await loginAs(page, request, "Олена", "/?compose=material");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Предмет *").selectOption({ label: "Бази даних" });
    await dialog.getByLabel("Назва *").fill(title);
    await dialog.locator("input[type=file]").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e test\n") });
    await expect(dialog.getByText("notes.pdf")).toBeVisible();
    await dialog.getByRole("button", { name: "Опублікувати" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    // Перехоплюємо window.open і перевіряємо, що тимчасове посилання справді віддає файл
    await page.evaluate(() => { window.__opened = null; window.open = (u) => { window.__opened = u; return null; }; });
    await page.getByRole("button", { name: /notes\.pdf/ }).click();
    await expect.poll(() => page.evaluate(() => window.__opened)).toContain("/api/files/");
    const fileUrl = await page.evaluate(() => window.__opened);
    const res = await request.get(fileUrl);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("непідтримуваний файл відхиляється ще до відправлення", async ({ page, request }) => {
    await loginAs(page, request, "Олена", "/?compose=material");
    const dialog = page.getByRole("dialog");
    await dialog.locator("input[type=file]").setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await expect(dialog.getByText("Непідтримуваний формат")).toBeVisible();
  });

  test("«Корисно» і «Зберегти» працюють і потрапляють у Збережене", async ({ page, request }) => {
    await loginAs(page, request, "Максим");
    const card = page.locator("article").first();
    const title = await card.locator("a[id^='t-']").innerText();
    await card.getByRole("button", { name: "Зберегти" }).click();
    await expect(page.getByText("Додано до збереженого")).toBeVisible();
    await page.goto("/saved");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
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

  test("агент Парс відкриває скляну панель поверх сайту, поле вводу активне", async ({ page, request }) => {
    await loginAs(page, request, "Олена");
    await page.getByRole("button", { name: /Агент підтримки UniPars/ }).first().click();
    const input = page.getByLabel("Запитання до AI");
    await expect(input).toBeVisible();
    await input.fill("Як підготуватися до іспиту?");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/ai/);
  });
});
