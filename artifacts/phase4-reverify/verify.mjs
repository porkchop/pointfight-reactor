import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('/home/aaron/dev/projects/aaron/pointfight-reactor/artifacts/phase4-reverify');
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const allConsole = [];

function attachConsole(page) {
  page.on('console', (msg) => {
    const text = `${msg.type()}: ${msg.text()}`;
    allConsole.push(text);
    if (msg.type() === 'error') consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    const text = `pageerror: ${err.message}`;
    allConsole.push(text);
    consoleErrors.push(text);
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
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  attachConsole(page);

  const results = {};

  // ---------- Defect 1 ----------
  await page.goto('http://localhost:5177/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await clearIDB(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  await page.screenshot({ path: `${OUT}/01-idle-after-clear.png`, fullPage: true });

  // Open Settings
  await page.getByRole('button', { name: /settings/i }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-settings-open.png`, fullPage: true });

  const activeProfileSelect = page.getByLabel('active profile');
  const opts = await activeProfileSelect.locator('option').allTextContents();
  const defaultCount = opts.filter((t) => t.trim() === 'Default').length;
  results.defect1 = {
    options: opts,
    defaultCount,
    pass: defaultCount === 1,
  };

  // ---------- Defect 2 ----------
  // Handle prompt() dialog for new profile name
  page.once('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') {
      await dialog.accept('Sparring');
    } else {
      await dialog.accept();
    }
  });

  await page.getByRole('button', { name: /new profile/i }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/03-after-create-sparring.png`, fullPage: true });

  // Verify Sparring now appears in select and is selected
  const optsAfter = await activeProfileSelect.locator('option').allTextContents();
  const selectedAfter = await activeProfileSelect.inputValue();
  const selectedTextAfter = await activeProfileSelect.locator(`option[value="${selectedAfter}"]`).textContent();
  results.defect2_after_create = {
    options: optsAfter,
    selectedText: selectedTextAfter,
  };

  // Click Save to commit Sparring as active and close settings
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-after-save-sparring.png`, fullPage: true });

  const idleAfterSparring = await page.locator('body').innerText();
  results.defect2_step2_showsSparring = /Profile:\s*Sparring/i.test(idleAfterSparring);
  results.defect2_step2_idleSample = idleAfterSparring.slice(0, 400);

  // Open Settings again
  await page.getByRole('button', { name: /settings/i }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-settings-reopened.png`, fullPage: true });

  // Switch dropdown to "Default"
  await activeProfileSelect.selectOption({ label: 'Default' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/06-selected-default.png`, fullPage: true });

  // Click Save
  await page.getByRole('button', { name: /^save$/i }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/07-after-save-default.png`, fullPage: true });

  const idleAfterSwitch = await page.locator('body').innerText();
  const showsDefault = /Profile:\s*Default/i.test(idleAfterSwitch);
  const stillSparring = /Profile:\s*Sparring/i.test(idleAfterSwitch);
  results.defect2 = {
    showsDefault,
    stillSparring,
    idleSample: idleAfterSwitch.slice(0, 600),
    pass: showsDefault && !stillSparring,
  };

  // ---------- Bonus regression ----------
  // Settings opens without errors - already confirmed. New profile created OK.
  // Run a tiny drill -> Summary "Rhythm pattern" should render.
  await page.screenshot({ path: `${OUT}/08-before-drill.png`, fullPage: true });

  // Find a Start button on idle
  const startBtn = page.getByRole('button', { name: /^start/i });
  const startCount = await startBtn.count();
  results.bonus_startButtonFound = startCount;
  if (startCount > 0) {
    await startBtn.first().click();
    await page.waitForTimeout(500);
    // Mash space to react to whatever cue appears; drill is short
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(120);
    }
    // Wait for summary to render
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/09-summary.png`, fullPage: true });
    const finalText = await page.locator('body').innerText();
    results.bonus_rhythmPanel = /rhythm pattern/i.test(finalText);
    results.bonus_finalSample = finalText.slice(0, 1200);
  }

  results.consoleErrors = consoleErrors;
  results.consoleErrorCount = consoleErrors.length;
  results.consoleAllTail = allConsole.slice(-80);

  await browser.close();

  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
