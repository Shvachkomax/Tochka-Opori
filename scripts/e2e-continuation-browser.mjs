import { chromium } from "playwright";

const BASE_URL = process.env.E2E_BASE_URL || "https://tochka-opori-test.vercel.app";
const CONTINUATION_CODE = process.env.E2E_CONTINUATION_CODE;

if (!CONTINUATION_CODE) throw new Error("Set E2E_CONTINUATION_CODE for TEST continuation E2E.");
if (!BASE_URL.includes("tochka-opori-test.vercel.app")) {
  throw new Error("Refusing to run continuation E2E outside TEST.");
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const validContext = await browser.newContext();
  const validPage = await validContext.newPage();
  await validPage.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await validPage.click('button:has-text("Продолжить разговор")');
  await validPage.fill('input[placeholder="Код продолжения"]', CONTINUATION_CODE);
  await validPage.click('button:has-text("Продолжить по коду")');
  await validPage.waitForSelector("text=Личный кабинет", { timeout: 20000 });
  console.log("PASS canonical TEST continuation code opens patient cabinet");
  await validContext.close();

  const malformedContext = await browser.newContext();
  const malformedPage = await malformedContext.newPage();
  await malformedPage.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await malformedPage.click('button:has-text("Продолжить разговор")');
  await malformedPage.fill('input[placeholder="Код продолжения"]', "TEST-PATIENT-2024");
  await malformedPage.click('button:has-text("Продолжить по коду")');
  await malformedPage.waitForSelector("text=Проверьте код продолжения.", { timeout: 20000 });
  console.log("PASS malformed TEST-PATIENT-2024-style code remains rejected");
  await malformedContext.close();
} finally {
  await browser.close();
}
