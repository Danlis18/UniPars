import { expect, test } from "@playwright/test";
import { loginAs, waitForApp } from "./helpers.js";

test.describe("Вхід і навігація", () => {
  test("сторінка входу показує демо-користувачів, після входу відкривається стрічка", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await expect(page.getByRole("heading", { name: "Демо-режим" })).toBeVisible();
    await page.getByText("Олена Коваль").click();
    await expect(page.getByRole("tab", { name: "Для мене" })).toBeVisible();
    await expect(page.locator("article").first()).toBeVisible();
    for (const item of ["Головна", "Предмети", "Матеріали", "Запитання", "AI", "Збережене", "Повідомлення", "Сповіщення", "Профіль"]) {
      await expect(page.getByRole("navigation", { name: "Основна навігація" }).getByRole("link", { name: new RegExp(`^${item}(,|$)`) })).toBeVisible();
    }
  });

  test("усі основні сторінки відкриваються без помилок", async ({ page, request }) => {
    test.setTimeout(120_000); // 8 повних завантажень сторінки
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await loginAs(page, request, "Олена");
    const pages = [
      ["/subjects", "Предмети"], ["/materials", "Матеріали"], ["/questions", "Запитання"], ["/saved", "Збережене"],
      ["/notifications", "Сповіщення"], ["/messages", "Повідомлення"], ["/settings", "Налаштування"], ["/ai", "AI"],
    ];
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("фільтри стрічки зберігаються в URL і переживають повернення назад", async ({ page, request }) => {
    await loginAs(page, request, "Олена");
    await page.getByRole("tab", { name: "Університет" }).click();
    await page.getByRole("button", { name: "Запитання", exact: true }).click();
    await expect(page).toHaveURL(/tab=university/);
    await expect(page).toHaveURL(/type=question/);
    await page.locator("article a[id^='t-']").first().click();
    await expect(page).toHaveURL(/\/p\//);
    await page.goBack();
    await expect(page).toHaveURL(/type=question/);
    await expect(page.getByRole("button", { name: "Запитання", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("Права доступу", () => {
  test("студент іншого університету не бачить приватний матеріал", async ({ page, request }) => {
    await loginAs(page, request, "Олена");
    await page.goto("/");
    const link = page.locator("article a[id^='t-']").first();
    const href = await link.getAttribute("href");
    await loginAs(page, request, "Софія", href);
    await expect(page.getByText("Допис не знайдено")).toBeVisible();
  });

  test("пункт «Керування» бачить лише адміністрація", async ({ page, request }) => {
    await loginAs(page, request, "Олена");
    await expect(page.getByRole("link", { name: "Керування" })).toHaveCount(0);
    await loginAs(page, request, "Андрій");
    await page.getByRole("link", { name: "Керування" }).first().click();
    await expect(page.getByRole("heading", { name: "Керування університетом" })).toBeVisible();
    await page.getByRole("tab", { name: "Учасники" }).click();
    await expect(page.locator("#main").getByText("Олена Коваль")).toBeVisible();
  });

  test("без ключа AI сторінка чесно показує, що AI не підключено", async ({ page, request }) => {
    await loginAs(page, request, "Олена", "/ai");
    await expect(page.getByText("AI ще не підключено").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Надіслати" })).toBeDisabled();
  });
});

test.describe("Адаптивність", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("на телефоні немає горизонтальної прокрутки й є нижня навігація", async ({ page, request }) => {
    await loginAs(page, request, "Олена");
    for (const path of ["/", "/subjects", "/materials", "/messages", "/u/me"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `горизонтальна прокрутка на ${path}`).toBeLessThanOrEqual(0);
    }
    await expect(page.getByRole("navigation", { name: "Нижня навігація" })).toBeVisible();
  });
});
