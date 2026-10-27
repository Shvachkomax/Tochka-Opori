import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5187;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready);
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", err => errors.push(err.message));
  let mode = "ok";
  let releaseSlow;
  await page.route("**/api/specialist", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "me") return route.fulfill({ json: { ok: true,
      expert: { id: "synthetic-expert", name: "Тестовый специалист", allowed_modules: ["support", "body"] }, memberships: [],
    } });
    if (body.action === "getPartnerProgram") {
      if (mode === "missing") return route.fulfill({ status: 503, json: { ok: false, error: "Партнёрская программа ещё не включена." } });
      if (mode === "slow" && body.module === "support") await new Promise(resolve => { releaseSlow = resolve; });
      return route.fulfill({ json: { ok: true,
        summary: { base_credits: body.module === "body" ? 400 : 22000, earned_credits: body.module === "body" ? 100 : 5500, contributing_patients: 1 },
        history: mode === "empty" ? [] : [{ id: "synthetic-entry", created_at: "2026-10-27T08:00:00Z", base_delta: 400, credit_delta: 100 }],
      } });
    }
    return route.fulfill({ json: { ok: true, clients: [], requests: [], invitations: [] } });
  });
  await page.goto(`http://127.0.0.1:${port}/specialist`);
  const section = page.getByTestId("partner-program");
  await section.getByRole("button", { name: /Партнёрская программа/ }).click();
  await section.getByText(/5\s500 ед\./).waitFor();
  await page.screenshot({ path: "/tmp/partner-program-desktop.png", fullPage: true });
  mode = "slow";
  await section.getByRole("button", { name: "Обновить начисления" }).click();
  await section.getByRole("status").waitFor();
  await page.getByTestId("module-body").click();
  await section.getByRole("button", { name: /Партнёрская программа/ }).click();
  await section.getByText("400 ед.", { exact: true }).waitFor();
  releaseSlow?.();
  assert.equal(await section.getByText(/5\s500 ед\./).count(), 0, "old module response never leaks into new context");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/partner-program-mobile.png", fullPage: true });
  const dimensions = await section.evaluate(el => ({ scroll: el.scrollWidth, width: el.clientWidth }));
  assert(dimensions.scroll <= dimensions.width + 1, "partner section fits mobile width");
  mode = "missing";
  await section.getByRole("button", { name: "Обновить начисления" }).click();
  await section.getByRole("alert").waitFor();
  assert.equal(await section.getByText("400 ед.", { exact: true }).count(), 0);
  mode = "empty";
  await section.getByRole("button", { name: "Повторить" }).click();
  await section.getByText(/Начислений пока нет/).waitFor();
  assert.deepEqual(errors, []);
  console.log("Partner browser tests passed: desktop/mobile, module switch, stale response, retry and empty history (mock API).");
} finally { await browser?.close(); server.kill(); }
