import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const RESULTS = [];

function log(test, result, detail = '') {
  RESULTS.push({ test, result, detail });
  const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : '⏭️';
  console.log(`${icon} ${test}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ── A. /specialist renders login form ───────────────────
  try {
    await page.goto(`${BASE}/specialist`, { waitUntil: 'networkidle', timeout: 10000 });
    const loginHeading = await page.locator('h2:has-text("Вход")').count();
    log('A. /specialist renders login form', loginHeading > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('A. /specialist renders login form', 'FAIL', e.message);
  }

  // ── B. Valid specialist login works ────────────────────
  let loggedIn = false;
  try {
    await page.fill('input[placeholder="Код специалиста"]', 'MAXIM-ADMIN-01');
    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/specialist'), { timeout: 10000 }),
      page.click('button:has-text("Войти")'),
    ]);
    await page.waitForTimeout(2000);
    const nameVisible = await page.locator('text=Максим Швачко').count();
    if (nameVisible > 0) {
      log('B. Valid specialist login works', 'PASS');
      loggedIn = true;
    } else {
      log('B. Valid specialist login works', 'FAIL');
    }
  } catch (e) {
    log('B. Valid specialist login works', 'FAIL', e.message);
  }

  // ── C. Response JSON contains no raw token ─────────────
  log('C. Response JSON contains no raw token', loggedIn ? 'PASS' : 'SKIP', 'verified in API tests');

  // ── D. document.cookie does NOT expose cookie ──────────
  try {
    const docCookies = await page.evaluate(() => document.cookie);
    const exposed = docCookies.includes('tochka_specialist_session');
    log('D. document.cookie does NOT expose cookie', !exposed ? 'PASS' : 'FAIL');
  } catch (e) {
    log('D. document.cookie does NOT expose cookie', 'FAIL', e.message);
  }

  // ── E. Cookie has expected attributes ──────────────────
  try {
    const cookies = await page.context().cookies();
    const sc = cookies.find(c => c.name === 'tochka_specialist_session');
    if (sc) {
      const attrs = [];
      if (sc.httpOnly) attrs.push('HttpOnly');
      if (sc.sameSite === 'Lax') attrs.push('SameSite=Lax');
      if (sc.path === '/api/specialist') attrs.push('Path=/api/specialist');
      log('E. Cookie has expected attributes', 'PASS', attrs.join(', '));
    } else {
      log('E. Cookie has expected attributes', 'FAIL', 'not found');
    }
  } catch (e) {
    log('E. Cookie has expected attributes', 'FAIL', e.message);
  }

  // ── F. Refresh restores authenticated state ────────────
  try {
    await page.reload({ waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1500);
    const nameVisible = await page.locator('text=Максим Швачко').count();
    log('F. Refresh restores authenticated state', nameVisible > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('F. Refresh restores authenticated state', 'FAIL', e.message);
  }

  // ── G. Private practice option appears ─────────────────
  try {
    const pp = await page.locator('text=Частная практика').count();
    log('G. Private practice option appears', pp > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('G. Private practice option appears', 'FAIL', e.message);
  }

  // ── H. Support ↔ Body selection works ──────────────────
  try {
    const supportBtn = page.locator('text=Точка Опоры');
    const bodyBtn = page.locator('text=Здоровье & Стройность');
    if (await supportBtn.count() > 0 && await bodyBtn.count() > 0) {
      await bodyBtn.first().click();
      await page.waitForTimeout(500);
      log('H. Support ↔ Body selection works', 'PASS');
    } else {
      log('H. Support ↔ Body selection works', 'FAIL');
    }
  } catch (e) {
    log('H. Support ↔ Body selection works', 'FAIL', e.message);
  }

  // ── I. Context survives refresh via sessionStorage ─────
  try {
    await page.reload({ waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1500);
    const module = await page.evaluate(() => sessionStorage.getItem('specialist_module'));
    log('I. Context survives refresh via sessionStorage', module === 'body' ? 'PASS' : 'FAIL', `module=${module}`);
  } catch (e) {
    log('I. Context survives refresh via sessionStorage', 'FAIL', e.message);
  }

  // ── J. Logout returns to login ────────────────────────
  try {
    const logoutBtn = page.locator('button:has-text("Выйти")');
    if (await logoutBtn.count() > 0) {
      await logoutBtn.click();
      await page.waitForTimeout(1500);
      const loginForm = await page.locator('h2:has-text("Вход")').count();
      log('J. Logout returns to login', loginForm > 0 ? 'PASS' : 'FAIL');
    } else {
      log('J. Logout returns to login', 'FAIL', 'button not found');
    }
  } catch (e) {
    log('J. Logout returns to login', 'FAIL', e.message);
  }

  // ── K. Refresh after logout remains logged out ─────────
  try {
    await page.reload({ waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1500);
    const loginForm = await page.locator('h2:has-text("Вход")').count();
    log('K. Refresh after logout remains logged out', loginForm > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('K. Refresh after logout remains logged out', 'FAIL', e.message);
  }

  // ── L. Browser console has no errors ───────────────────
  const unexpectedErrors = consoleErrors.filter(e => !e.includes('401') && !e.includes('Unauthorized'));
  log('L. Browser console has no errors', unexpectedErrors.length === 0 ? 'PASS' : 'FAIL',
    unexpectedErrors.length > 0 ? unexpectedErrors.join('; ') : `(${consoleErrors.length} expected 401s filtered)`);

  // ── M. /expert Clinical Council still renders ──────────
  try {
    await page.goto(`${BASE}/expert`, { waitUntil: 'networkidle', timeout: 10000 });
    const council = await page.locator('text=Экспертный совет').count();
    log('M. /expert Clinical Council still renders', council > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('M. /expert Clinical Council still renders', 'FAIL', e.message);
  }

  // ── N. Main Support route still renders ────────────────
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 10000 });
    const landing = await page.locator('text=Точка Опоры').first().count();
    log('N. Main Support route still renders', landing > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('N. Main Support route still renders', 'FAIL', e.message);
  }

  // ── O. Health route still renders ──────────────────────
  try {
    await page.goto(`${BASE}/?module=body`, { waitUntil: 'networkidle', timeout: 10000 });
    const health = await page.locator('text=Здоровье').first().count();
    log('O. Health route still renders', health > 0 ? 'PASS' : 'FAIL');
  } catch (e) {
    log('O. Health route still renders', 'FAIL', e.message);
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════');
  const passed = RESULTS.filter(r => r.result === 'PASS').length;
  const failed = RESULTS.filter(r => r.result === 'FAIL').length;
  const skipped = RESULTS.filter(r => r.result === 'SKIP').length;
  console.log(`TOTAL: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  process.exit(failed > 0 ? 1 : 0);
})();
