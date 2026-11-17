import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5193;
const baseUrl = `http://127.0.0.1:${port}`;
const organizationId = "00000000-0000-4000-8000-000000000038";
const state = { places: [], services: [], availability: [], bookings: [] };
let serverServiceWrites = 0;
let browser;
const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: "ignore",
  env: {
    ...process.env,
    BROWSER: "none",
    VERCEL_ENV: "preview",
    DEPLOYMENT_PURPOSE: "test",
    VITE_ENABLE_MY_PRACTICE_PILOT: "true",
    VITE_ENABLE_MY_PRACTICE_SERVER_UI: "true",
  },
});

const ok = (route, json = {}) => route.fulfill({ json: { ok: true, ...json } });

async function installMocks(context) {
  await context.addInitScript((org) => sessionStorage.setItem("specialist_org_id", org), organizationId);
  await context.route("**/api/specialist", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "me") return route.fulfill({ status: 401, json: { ok: false, error: "Требуется авторизация" } });
    if (body.action === "login") return ok(route, {
      expert: { id: "synthetic-a38-doctor", name: "A38 Synthetic Specialist", specialty: "Synthetic", allowed_modules: ["support"] },
      memberships: [{ membership_id: "a38-membership", organization_id: organizationId, organization_name: "A38 Synthetic Organization", status: "active" }],
    });
    if (body.action === "listClients") return ok(route, { clients: [] });
    if (body.action === "listInvitations") return ok(route, { invitations: [] });
    if (body.action === "listServiceRequests") return ok(route, { requests: [] });
    if (body.action === "getPartnerProgram") return ok(route, { account: null, entries: [] });
    return ok(route);
  });
  await context.route("**/api/practice-booking", async (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.organization_id ?? null, organizationId, `${body.action} keeps organization context`);
    if (body.action === "listPracticePlaces") return ok(route, { places: state.places });
    if (body.action === "listPracticeServices") return ok(route, { services: state.services });
    if (body.action === "listPracticeAvailability") return ok(route, { availability: state.availability });
    if (body.action === "listPracticeBookings") return ok(route, { bookings: state.bookings });
    if (body.action === "getPracticeFinance") return ok(route, { specialist_credits: 0, service_fee_credits: 0, cancellation_fee_credits: 0 });
    if (body.action === "savePracticePlace") {
      const row = { id: body.id || "a38-place", name: body.name, address: body.address || null };
      state.places = [row]; return ok(route, { place: row });
    }
    if (body.action === "savePracticeService") {
      serverServiceWrites++;
      const row = {
        id: body.id || "a38-service", expert_id: "synthetic-a38-doctor", organization_id: organizationId,
        place_id: body.place_id, name: body.name, format: body.format, price_kop: body.price_kop,
        price_credits: body.price_kop / 10, duration_min: body.duration_min, is_active: body.is_active,
      };
      state.services = [row]; return ok(route, { service: row });
    }
    if (body.action === "savePracticeAvailability") {
      const row = { id: body.id || "a38-availability", weekday: body.weekday, start_time: body.start_time, end_time: body.end_time, is_active: true };
      state.availability = [row]; return ok(route, { entry: row });
    }
    if (["deletePracticePlace", "deactivatePracticeService", "deletePracticeAvailability", "completePracticeBooking"].includes(body.action)) return ok(route);
    return route.fulfill({ status: 400, json: { ok: false, error: `Unexpected ${body.action}` } });
  });
}

async function login(page) {
  await page.goto(`${baseUrl}/specialist`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Код специалиста").fill("A38-SYNTHETIC");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByTestId("a2-booking-panel").waitFor();
}

async function overlappingControls(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="mp-tour-dialog"]');
    if (!dialog) return ["missing-dialog"];
    const box = dialog.getBoundingClientRect();
    return [...document.querySelectorAll("input,select,textarea,button")].filter((element) => {
      if (dialog.contains(element)) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      return box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      return `${element.tagName}:${element.getAttribute("data-testid") || element.textContent?.trim().slice(0, 50) || element.getAttribute("aria-label") || "control"}@${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)} dialog=${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}`;
    });
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("A3.8 Vite server exited before startup");
    try { if ((await fetch(baseUrl)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "A3.8 Vite server starts");
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await installMocks(context);
  const page = await context.newPage();
  await login(page);
  assert.equal(await page.getByTestId("my-practice-pilot").count(), 0, "authenticated cabinet has no browser-only pilot");

  await page.getByTestId("a2-place-name").fill("A38 Synthetic Place");
  await page.getByTestId("a2-place-save").click();
  await page.getByTestId("a2-place-row").waitFor();
  await page.getByTestId("a2-service-name").fill("A38 Synthetic Service");
  await page.getByTestId("a2-service-price").fill("0");
  await page.getByTestId("a2-service-place").selectOption("a38-place");
  await page.getByTestId("a2-service-published").check();
  await page.getByTestId("a2-service-save").click();
  await page.getByText("Опубликована").waitFor();
  assert.equal(serverServiceWrites, 1, "service was persisted through the server action");
  await page.getByTestId("a2-availability-save").click();
  await page.getByTestId("a2-availability-row").waitFor();

  const serviceRow = page.getByTestId("a2-service-row");
  await serviceRow.getByRole("button", { name: "Редактировать" }).click();
  await page.getByTestId("a2-service-price").fill("100");
  await page.getByTestId("a2-service-save").click();
  await page.getByText("1 000 кредитов").waitFor();
  assert.equal(serverServiceWrites, 2, "service edit was persisted through the server action");

  await page.getByTestId("mp-start-tour").click();
  for (let step = 1; step <= 3; step++) {
    await page.getByText(`Шаг ${step} из 3`).waitFor();
    assert.deepEqual(await overlappingControls(page), [], `tour step ${step} does not cover visible inputs or buttons`);
    await page.getByTestId("mp-tour-next").click();
  }
  assert.equal(await page.getByTestId("mp-tour-dialog").count(), 0, "doctor tour finishes");
  await login(page);
  assert.equal(await page.getByTestId("mp-tour-dialog").count(), 0, "doctor tour does not auto-start on repeat entry");
  console.log("A3.8 server practice UI PASS: authenticated server source, publish/edit, three-step tour, no field/button overlap, repeat entry.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
