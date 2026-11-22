import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5194;
const baseUrl = `http://127.0.0.1:${port}`;
const organizationId = "00000000-0000-4000-8000-000000000039";
const state = { bodyOverviewCalls: 0, aggregateCalendarCalls: 0 };
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

const clients = [
  { client_ref: "assignment:support-a39", module: "support", display_name: "A39 Support Patient", relationship: "primary", status: "active", next_appointment_at: "2099-01-02T09:00:00.000Z" },
  { client_ref: "assignment:health-a39", module: "body", display_name: "A39 Health Patient", relationship: "primary", status: "active", next_appointment_at: "2099-01-02T10:00:00.000Z" },
];
const bookings = [
  { id: "a39-support-booking", starts_at: "2099-01-02T09:00:00.000Z", status: "confirmed", module: "support", organization_name: "A39 Clinic", place_name: "A39 Room", client_ref: clients[0].client_ref, practice_services: { name: "A39 Support service" } },
  { id: "a39-health-booking", starts_at: "2099-01-02T10:00:00.000Z", status: "confirmed", module: "body", organization_name: "A39 Clinic", place_name: "A39 Room", client_ref: clients[1].client_ref, practice_services: { name: "A39 Health service" } },
];

const ok = (route, json = {}) => route.fulfill({ json: { ok: true, ...json } });

async function installMocks(context) {
  await context.addInitScript((org) => sessionStorage.setItem("specialist_org_id", org), organizationId);
  await context.route("**/api/specialist", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "me") return route.fulfill({ status: 401, json: { ok: false } });
    if (body.action === "login") return ok(route, {
      expert: { id: "a39-doctor", name: "A39 Synthetic Specialist", specialty: "Synthetic", allowed_modules: ["support", "body"] },
      memberships: [{ membership_id: "a39-membership", organization_id: organizationId, organization_name: "A39 Clinic", status: "active" }],
    });
    if (body.action === "listClients") return ok(route, { clients: body.module === "all" ? clients : clients.filter((client) => client.module === body.module) });
    if (body.action === "getBodyClientOverview") {
      state.bodyOverviewCalls += 1;
      return ok(route, { client: { display_name: "A39 Health Patient" }, overview: {}, recent_days: [], plate_summary: { recent_plates: [] }, weekly_summaries: [], insights: [], service_requests: [] });
    }
    if (body.action === "getClientOverview") return ok(route, { client: { display_name: "A39 Support Patient" }, overview: {}, sessions: [], diary: [], analyses: [] });
    if (body.action === "listMedicalEncounters") return ok(route, { records: [], next_before: null, can_prescribe: false, author_name: "" });
    if (body.action === "listPatientReportedMedicationOrders") return ok(route, { orders: [], intake_logs: [] });
    if (["listInvitations", "listServiceRequests"].includes(body.action)) return ok(route, { [body.action === "listInvitations" ? "invitations" : "requests"]: [] });
    return ok(route);
  });
  await context.route("**/api/practice-booking", async (route) => {
    const body = route.request().postDataJSON();
    assert.equal(body.organization_id, organizationId, `${body.action} retains the selected organization context`);
    if (body.action === "listPracticeBookings") {
      if (body.organization_scope === "all") state.aggregateCalendarCalls += 1;
      return ok(route, { bookings: body.module === "all" ? bookings : bookings.filter((booking) => booking.module === body.module) });
    }
    if (body.action === "listPracticePlaces") return ok(route, { places: [] });
    if (body.action === "listPracticeServices") return ok(route, { services: [] });
    if (body.action === "listPracticeAvailability") return ok(route, { availability: Array.from({ length: 7 }, (_, index) => ({ id: `day-${index}`, weekday: index + 1, start_time: "09:00", end_time: "18:00", is_active: true })) });
    if (body.action === "getPracticeFinance") return ok(route, { transactions: [], breakdown: [] });
    return ok(route);
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error("A3.9 Vite server exited before startup");
    try { if ((await fetch(baseUrl)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "A3.9 Vite server starts");
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMocks(context);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/specialist`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Код специалиста").fill("A39-SYNTHETIC");
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByTestId("specialist-workspace-nav").waitFor();

  await page.getByTestId("module-all").click();
  await page.getByTestId("specialist-nav-patients").click();
  await page.getByText("A39 Support Patient").waitFor();
  await page.getByText("A39 Health Patient").waitFor();
  assert.equal(await page.getByText("Ближайшая запись:").count(), 2, "patient rows include only their own next appointment metadata");
  assert.equal(await page.getByText(/Support · A39 Clinic/).count(), 1);
  assert.equal(await page.getByText(/Health · A39 Clinic/).count(), 1);

  await page.getByTestId("specialist-nav-calendar").click();
  await page.getByRole("button", { name: "День" }).waitFor();
  await page.getByText("A39 Support service").waitFor();
  await page.getByText("A39 Health service").waitFor();
  assert(state.aggregateCalendarCalls > 0, "calendar requested the server-side aggregate scope");
  await page.getByTestId("a2-booking-row").filter({ hasText: "A39 Health service" }).getByRole("button", { name: "Открыть карту" }).click();
  await page.getByText("Рабочее пространство: Здоровье & Стройность").waitFor();
  await page.getByTestId("health-client-name").waitFor();
  assert(state.bodyOverviewCalls > 0, "opening a calendar item loads only the Health profile endpoint");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("specialist-nav-patients").click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, "unified workspace has no horizontal overflow on a phone");
  console.log("A3.9 browser PASS: all-directions patients, aggregate calendar, module-specific card and mobile layout.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
