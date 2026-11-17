import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const host = "127.0.0.1";
const port = 5187;
const base = `http://${host}:${port}/scripts/fixtures/patient-tour.html`;
const server = await createServer({ logLevel: "error", server: { host, port, strictPort: true } });
await server.listen();
let browser;

function url({ profile = "support", scope, specialists = 1, services = 1, unavailable = false }) {
  const target = new URL(base);
  target.searchParams.set("profile", profile);
  target.searchParams.set("scope", scope);
  target.searchParams.set("specialists", String(specialists));
  target.searchParams.set("services", String(services));
  if (unavailable) target.searchParams.set("unavailable", "true");
  return target.toString();
}

async function cleanVisit(page, options) {
  await page.goto(url(options));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function start(page, profile) {
  await page.getByTestId(`patient-tour-start-${profile}`).click();
  await page.getByTestId(`patient-tour-dialog-${profile}`).waitFor();
}

async function advanceTo(page, profile, zeroBasedStep) {
  for (let index = 0; index < zeroBasedStep; index += 1) {
    await page.getByTestId(`patient-tour-next-${profile}`).click();
  }
  await page.getByText(`Экскурсия · шаг ${zeroBasedStep + 1} из 7`, { exact: true }).waitFor();
}

async function assertNoControlOverlap(page, target) {
  await page.waitForTimeout(250);
  const result = await page.evaluate((selector) => {
    const dialog = document.querySelector('[data-testid^="patient-tour-dialog-"]')?.getBoundingClientRect();
    const controls = [...document.querySelectorAll(`${selector} button,${selector} input,${selector} select,${selector} textarea`)]
      .map((element) => ({ label: element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight);
    if (!dialog) return { ok: false, reason: "dialog missing" };
    const overlapping = controls.filter(({ rect }) => Math.min(dialog.right, rect.right) > Math.max(dialog.left, rect.left)
      && Math.min(dialog.bottom, rect.bottom) > Math.max(dialog.top, rect.top));
    return {
      ok: overlapping.length === 0,
      dialog: { left: dialog.left, right: dialog.right, top: dialog.top, bottom: dialog.bottom },
      overlaps: overlapping.map(({ label, rect }) => ({ label, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
    };
  }, target);
  assert.equal(result.ok, true, `tour dialog overlaps controls for ${target}: ${JSON.stringify(result)}`);
}

async function runProfile(page, profile, scope) {
  await cleanVisit(page, { profile, scope });
  await start(page, profile);
  const titles = profile === "health"
    ? ["Знакомство с кабинетом", "Дневник здоровья", "Общение с AI-компаньоном", "Мой специалист", "Запись на приём", "Сведения о здоровье", "Знакомство завершено"]
    : ["Знакомство с кабинетом", "Дневник состояния", "Общение с Точкой Опоры", "Мой специалист", "Запись на приём", "Сведения о здоровье", "Знакомство завершено"];
  for (let index = 0; index < titles.length; index += 1) {
    const dialog = page.getByTestId(`patient-tour-dialog-${profile}`);
    await dialog.getByRole("heading", { name: titles[index], exact: true }).waitFor();
    if (index < titles.length - 1) await page.getByTestId(`patient-tour-next-${profile}`).click();
  }
  await page.getByRole("button", { name: "Завершить обучение", exact: true }).click();
  await assert.equal(await page.getByTestId(`patient-tour-dialog-${profile}`).count(), 0);
}

try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let apiRequests = 0;
  const browserErrors = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests += 1; });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });

  await cleanVisit(page, { profile: "support", scope: "first-entry" });
  await page.getByText("Начните здесь", { exact: true }).waitFor();
  assert.match(await page.getByTestId("patient-tour-start-support").getAttribute("class"), /patient-tour-entry-pulse/);
  await page.getByText("Покажем, как пользоваться кабинетом, общаться со специалистом и записываться на приём.", { exact: true }).waitFor({ timeout: 3000 });
  console.log("PASS 1/10 первый вход пациента показывает мягкое приглашение");

  await page.getByRole("button", { name: "Скрыть приглашение к знакомству" }).click();
  await page.reload();
  assert.equal(await page.getByText("Начните здесь", { exact: true }).count(), 0);
  assert.equal(await page.getByTestId("patient-tour-start-support").count(), 1);
  console.log("PASS 2/10 повторный вход сохраняет закрытие приглашения, но оставляет запуск");

  await runProfile(page, "support", "support-all-steps");
  console.log("PASS 3/10 все семь шагов Support пройдены");

  await runProfile(page, "health", "health-all-steps");
  console.log("PASS 4/10 все семь шагов Health пройдены");

  await page.setViewportSize({ width: 390, height: 844 });
  await cleanVisit(page, { profile: "support", scope: "mobile-overlap" });
  await start(page, "support");
  const targets = ["patient-overview", "patient-diary", "patient-ai", "patient-specialist", "patient-booking", "patient-health"];
  for (let index = 0; index < targets.length; index += 1) {
    if (index > 0) await page.getByTestId("patient-tour-next-support").click();
    await assertNoControlOverlap(page, `[data-tour-target="${targets[index]}"]`);
  }
  console.log("PASS 5/10 окно не перекрывает видимые поля и основные кнопки на телефоне");

  await cleanVisit(page, { profile: "support", scope: "empty-specialists", specialists: 0, services: 0 });
  await start(page, "support");
  await advanceTo(page, "support", 3);
  assert.match(await page.getByTestId("patient-tour-dialog-support").textContent(), /Прикреплённых специалистов пока нет/);
  console.log("PASS 6/10 пустой список специалистов объяснён без создания связи");

  await cleanVisit(page, { profile: "support", scope: "attached-no-services", specialists: 1, services: 0 });
  await start(page, "support");
  await advanceTo(page, "support", 4);
  const noServicesText = await page.getByTestId("patient-tour-dialog-support").textContent();
  assert.match(noServicesText, /Специалист прикреплён, но активных серверных услуг пока нет/);
  assert.doesNotMatch(noServicesText, /специалист.*отсутствует/i);
  console.log("PASS 7/10 прикреплённый специалист без услуг не выдан за отсутствующего врача");

  await cleanVisit(page, { profile: "support", scope: "resume-tour" });
  await start(page, "support");
  await advanceTo(page, "support", 2);
  await page.getByRole("button", { name: "Закрыть обучение" }).click();
  await start(page, "support");
  await page.getByText("Экскурсия · шаг 3 из 7", { exact: true }).waitFor();
  console.log("PASS 8/10 отмена и повторный запуск продолжают с сохранённого шага");

  await page.goto(url({ profile: "support", scope: "separate-patient-b" }));
  await start(page, "support");
  await page.getByText("Экскурсия · шаг 1 из 7", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Закрыть обучение" }).click();
  await page.goto(url({ profile: "health", scope: "resume-tour" }));
  await start(page, "health");
  await page.getByText("Экскурсия · шаг 1 из 7", { exact: true }).waitFor();
  console.log("PASS 9/10 прогресс разделён между пациентами и профилями Support/Health");

  const effects = await page.evaluate(() => ({ ...window.__patientTourEffects }));
  assert.deepEqual(effects, { medical: 0, payment: 0, voice: 0, api: 0 });
  assert.equal(apiRequests, 0);
  assert.equal(await page.getByTestId("fixture-medication").inputValue(), "Назначение не меняется");
  assert.deepEqual(browserErrors, []);
  console.log("PASS 10/10 экскурсия не вызвала медицинских изменений, оплат, API или голоса");

  await context.close();
  console.log("A3.7 patient tour browser suite: PASS (10/10)");
} finally {
  await browser?.close();
  await server.close();
}
