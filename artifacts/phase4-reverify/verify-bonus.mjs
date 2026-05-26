// Just run the bonus regression: configure drill short, run it, verify Summary "Rhythm pattern" renders, 0 console errors.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('/home/aaron/dev/projects/aaron/pointfight-reactor/artifacts/phase4-reverify');
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const allConsole = [];
function attachConsole(page) {
  page.on('console', (msg) => {
    const t = `${msg.type()}: ${msg.text()}`;
    allConsole.push(t);
    if (msg.type() === 'error') consoleErrors.push(t);
  });
  page.on('pageerror', (err) => {
    const t = `pageerror: ${err.message}`;
    allConsole.push(t);
    consoleErrors.push(t);
  });
}

async function clearIDB(page) {
  await page.evaluate(async () => {
    await new Promise((res) => {
      const req = indexedDB.deleteDatabase('pointfight-reactor');
      req.onsuccess = () => res();
      req.onerror = () => res();
      req.onblocked = () => res();
    });
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  attachConsole(page);

  await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
  await clearIDB(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // Open Settings
  await page.getByRole('button', { name: /settings/i }).first().click();
  await page.waitForTimeout(400);

  const results = {};
  results.settingsOpensWithoutErrors = consoleErrors.length === 0;

  // Verify "New profile" works (create one) - bonus check
  page.once('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept('TinyDrill');
    else await d.accept();
  });
  await page.getByRole('button', { name: /new profile/i }).click();
  await page.waitForTimeout(700);
  const sel = page.getByLabel('active profile');
  const opts = await sel.locator('option').allTextContents();
  results.newProfileCreated = opts.includes('TinyDrill');

  // Configure short drill: rounds=1, workMs=3s, restMs=0
  const roundsInput = page.locator('input[type="number"]').nth(0);
  await roundsInput.fill('1');
  const workInput = page.locator('input[type="number"]').nth(1);
  await workInput.fill('3');
  const restInput = page.locator('input[type="number"]').nth(2);
  await restInput.fill('0');
  await page.screenshot({ path: `${OUT}/bonus-01-config.png`, fullPage: true });

  // Save
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.waitForTimeout(800);

  // Start drill
  await page.getByRole('button', { name: /^start/i }).first().click();
  await page.waitForTimeout(300);

  // Mash space during the drill
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
  }
  // Wait through end of drill + summary
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/bonus-02-summary.png`, fullPage: true });

  const finalText = await page.locator('body').innerText();
  results.summaryText = finalText.slice(0, 1500);
  results.rhythmPanelRendered = /rhythm pattern/i.test(finalText);
  results.consoleErrors = consoleErrors;
  results.consoleErrorCount = consoleErrors.length;
  results.consoleAllTail = allConsole.slice(-50);

  await browser.close();
  writeFileSync(`${OUT}/results-bonus.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
