import { expect, test } from "@playwright/test";
import { api, loginAs, waitForApp } from "./helpers.js";

async function firstTaskId(request, user) {
  const r = await api(request, user, "GET", "/subjects/db/tasks?kind=lab");
  return (await r.json()).items[0].id;
}

test.describe("Вхід і навігація", () => {
  test("після входу — головна з дедлайнами, у меню один пункт «Предмети»", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByRole("heading", { name: "Демо-режим" })).toBeVisible();
    await page.getByText("Олена Коваль").click();
    await expect(page.getByRole("heading", { name: /Найближчі дедлайни/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Нещодавно опубліковані|Популярні матеріали/ })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Основна навігація" });
    for (const item of ["Головна", "Предмети", "Мої подання", "AI", "Збережене", "Повідомлення", "Сповіщення", "Профіль"]) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${item}(,|$)`) })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: /^Матеріали/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^Запитання/ })).toHaveCount(0);
    // Довільних публічних дописів більше немає
    await expect(page.getByRole("button", { name: /Створити/ })).toHaveCount(0);
  });

  test("основні сторінки відкриваються без помилок, старі маршрути ведуть до предметів", async ({ page, request }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const olena = await loginAs(page, request, "Олена");
    const pages = [
      ["/subjects", "Предмети"], ["/submissions", "Мої подання"], ["/saved", "Збережене"],
      ["/notifications", "Сповіщення"], ["/messages", "Повідомлення"], ["/settings", "Налаштування"], ["/ai", "SOON"],
      [`/tasks/${await firstTaskId(request, olena)}`, "Проєктування ER-моделі"],
    ];
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    }
    for (const old of ["/materials", "/questions"]) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/subjects$/);
    }
    expect(errors).toEqual([]);
  });

  test("вкладка розділу предмета зберігається в URL і переживає повернення назад", async ({ page, request }) => {
    await loginAs(page, request, "Олена", "/subjects/db");
    await page.getByRole("tab", { name: /Практичні/ }).click();
    await expect(page).toHaveURL(/tab=practical/);
    await page.getByRole("link", { name: /Реляційна алгебра/ }).click();
    await expect(page).toHaveURL(/\/tasks\//);
    await page.goBack();
    await expect(page.getByRole("tab", { name: /Практичні/ })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Юридичні сторінки", () => {
  test("публічна оферта доступна без входу: ціни, повернення, реквізити", async ({ page }) => {
    await page.goto("/offer");
    await expect(page.getByRole("heading", { name: "Публічна оферта" })).toBeVisible();
    await expect(page.getByText(/Одна генерація — 47/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "5. Повернення коштів" })).toBeVisible();
    // реквізитів у тестовому оточенні немає — замість них чесне повідомлення
    await expect(page.getByText(/Реквізити продавця буде опубліковано/)).toBeVisible();
    await expect(page).toHaveTitle(/Публічна оферта/);
    await page.getByRole("link", { name: "Конфіденційність" }).click();
    await expect(page.getByText(/monobank/).first()).toBeVisible();
  });
});

test.describe("Права доступу", () => {
  test("студент іншого університету не бачить завдання й питання", async ({ page, request }) => {
    const olena = await loginAs(page, request, "Олена");
    const id = await firstTaskId(request, olena);
    await loginAs(page, request, "Софія", `/tasks/${id}`);
    await expect(page.getByText(/не є учасником|не знайдено/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Подати свій варіант" })).toHaveCount(0);
  });

  test("пункт «Керування» бачить лише адміністрація, черга подань відкривається першою", async ({ page, request }) => {
    await loginAs(page, request, "Олена");
    await expect(page.getByRole("link", { name: /^Керування/ })).toHaveCount(0);
    await loginAs(page, request, "Андрій");
    await page.getByRole("link", { name: /^Керування/ }).first().click();
    await expect(page.getByRole("heading", { name: "Керування університетом" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Подання" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Розподіл" }).click();
    await expect(page.getByText("normalization-3nf.pdf")).toBeVisible();
    await page.getByRole("tab", { name: "Учасники" }).click();
    await expect(page.locator("#main").getByText("Олена Коваль")).toBeVisible();
  });

  test("поки AI не запущено — сторінка під склом із SOON, кнопки AI заблоковані", async ({ page, request }) => {
    await loginAs(page, request, "Олена", "/ai");
    await expect(page.getByText("SOON", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Чим допомогти з навчанням?" })).toHaveCount(0);
    await page.goto("/subjects/algo?tab=questions");
    await page.locator("#main li a").first().click();
    await expect(page.getByLabel("AI — незабаром").first()).toBeVisible();
  });
});

test.describe("Новини", () => {
  test("без новин блок «Новини» лишається з повідомленням «Наразі новин немає»", async ({ page, request }) => {
    await page.route("**/api/news**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await loginAs(page, request, "Олена");
    const rail = page.getByRole("complementary", { name: "Допоміжна панель" });
    await expect(rail.getByRole("heading", { name: "Новини" })).toBeVisible();
    await expect(rail.getByText("Наразі новин немає")).toBeVisible();
  });

  test("на вузькому екрані новини стоять між дедлайнами й добіркою матеріалів", async ({ page, request }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await loginAs(page, request, "Олена");
    const headings = await page.locator("#main h2").allTextContents();
    const i = (re) => headings.findIndex((h) => re.test(h));
    expect(i(/Найближчі дедлайни/)).toBeGreaterThanOrEqual(0);
    expect(i(/Найближчі дедлайни/)).toBeLessThan(i(/^Новини$/));
    expect(i(/^Новини$/)).toBeLessThan(i(/Нещодавно опубліковані|Популярні матеріали/));
  });
});

test.describe("Адаптивність", () => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    test(`ширина ${width}px: без горизонтальної прокрутки на ключових сторінках`, async ({ page, request }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      const andrii = await loginAs(page, request, "Андрій");
      const task = await firstTaskId(request, andrii);
      for (const path of ["/", "/subjects", "/subjects/db", "/subjects/db?tab=questions", `/tasks/${task}`, "/submissions", "/admin", "/admin?tab=assign"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `горизонтальна прокрутка на ${path} (${width}px)`).toBeLessThanOrEqual(0);
      }
      await page.goto(`/tasks/${task}`);
      await page.getByRole("button", { name: "Подати свій варіант" }).first().click();
      const box = await page.getByRole("dialog", { name: "Подати свій варіант" }).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (width < 768) await expect(page.getByRole("navigation", { name: "Нижня навігація" })).toBeVisible();
    });
  }
});
