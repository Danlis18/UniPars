import { expect } from "@playwright/test";

let usersCache = null;

// Демо-користувачі: Олена, Максим (Політех, студенти), Ірина (модераторка),
// Андрій (адміністратор), Софія (інший університет).
export async function demoUser(request, namePrefix) {
  if (!usersCache) usersCache = await (await request.get("/api/demo/users")).json();
  const u = usersCache.find((x) => x.display_name.startsWith(namePrefix));
  if (!u) throw new Error(`Немає демо-користувача ${namePrefix}`);
  return u;
}

export async function loginAs(page, request, namePrefix, path = "/") {
  const u = await demoUser(request, namePrefix);
  await page.goto("/");
  await page.evaluate((id) => localStorage.setItem("unipars.demoUser", JSON.stringify(id)), u.id);
  await page.goto(path);
  await waitForApp(page);
  return u;
}

export async function waitForApp(page) {
  // заставка зникла, інтерфейс готовий
  await expect(page.getByRole("status", { name: "Завантаження UniPars" })).toHaveCount(0, { timeout: 15_000 });
}

export async function api(request, user, method, path, body) {
  const res = await request.fetch(`/api${path}`, {
    method,
    headers: { Authorization: `Bearer demo:${user.id}`, "X-University-Id": user.university_id || "", "Content-Type": "application/json" },
    data: body ? JSON.stringify(body) : undefined,
  });
  return res;
}
