// Наскрізні (E2E) тести: робот-браузер проходить сценарії як справжній користувач.
// Піднімає окремі тестові сервери (backend у демо-режимі + Vite), не чіпаючи dev-сервери.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "../backend");

const API_PORT = 8010;
const WEB_PORT = 5180;
const python = process.env.PYTHON || (process.platform === "win32" ? `"${path.join(backendDir, ".venv/Scripts/python.exe")}"` : "python");

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // демо-база одна на всі тести
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "uk-UA",
    reducedMotion: "reduce", // коротка заставка
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --app-dir "${backendDir}" --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { APP_MODE: "demo", ANTHROPIC_API_KEY: "", CORS_ORIGINS: `http://localhost:${WEB_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Тестуємо продакшн-збірку, як на бойовому сайті (vite preview успадковує проксі /api)
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
