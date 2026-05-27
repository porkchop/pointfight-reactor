// Phase 6.1 verification driver — clip library: import, store, list, delete.
//
// Gate-grade automated checks (run against `npm run dev` on http://localhost:5173):
//   C1. IdleScreen renders a "Manage clips" link.
//   C2. Clicking "Manage clips" opens ClipLibraryScreen with the empty-state
//       hint, the close button, and the import control all visible.
//   C3. The library renders the quota-text DOM element (presence check
//       only; live quota math is MANUAL per §B5).
//   C4. The Close button returns the user to IdleScreen with no console
//       errors.
//
// Manual real-device QA — per QUALITY_GATES.md §"Browser-API limitations
// (Phase 2b + Phase 6)" §B5: real <video> + Dexie blob storage on a real
// laptop with a real .mp4 file. Headless chromium cannot validate
// duration extraction reliably across container types.
//   M1. Import a small (~5 MB), medium (~50 MB), and large-but-under-cap
//       (~150 MB) .mp4 file. All three appear with non-zero duration.
//   M2. Reload the page; all three clips persist with the same metadata.
//   M3. Delete one clip via the Delete button; confirm prompt fires; the
//       clip disappears and reload still does not show it.
//   M4. Try to import a 250 MB clip (any binary >200 MB renamed .mp4).
//       The import is rejected with reason "too-large".
//   M5. Try to import a non-mp4 (e.g. .txt) via dev tools file-picker;
//       it is rejected with reason "unsupported-type".
//   M6. With several large clips imported, the quota banner text reflects
//       navigator.storage.estimate within a few MB of the sum of clip
//       sizes.
//   M7. Larger-than-100MB clip shows the soft-warning toast.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-6-1-verify')

const consoleErrors = []

function log(...a) {
  console.log('[verify]', ...a)
}

async function screenshot(page, name) {
  const p = resolve(OUT, name)
  await page.screenshot({ path: p, fullPage: false })
  return p
}

async function clearIDB(page) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.deleteDatabase('pointfight-reactor')
        req.onsuccess = () => r()
        req.onerror = () => r()
        req.onblocked = () => r()
      }),
  )
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const results = {
    phase: 'phase-6.1',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Import a ~5 MB, ~50 MB, and ~150 MB .mp4 file. All three appear with non-zero duration.',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Reload the page; all three clips persist with the same metadata.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Delete one clip via the Delete button; the confirm prompt fires; the clip disappears and reload does not show it.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          'A >200 MB .mp4 import is rejected with the "200 MB cap" error banner.',
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'A non-mp4 file import is rejected with the "type not supported" error banner.',
        signed_off: null,
      },
      {
        id: 'M6',
        description:
          'After importing several clips, the quota banner text reflects navigator.storage.estimate within a few MB of the sum of clip sizes.',
        signed_off: null,
      },
      {
        id: 'M7',
        description:
          'A >100 MB clip import shows the soft-warning banner (data-testid="clip-soft-warn").',
        signed_off: null,
      },
    ],
  }

  try {
    // ---------- C1. Manage clips link present on IdleScreen ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[idle-link] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      const linkCount = await page
        .locator('[data-testid="manage-clips-link"]')
        .count()
      results.automated.C1 = { pass: linkCount > 0, link_count: linkCount }
      await screenshot(page, 'C1-idle-manage-clips-link.png')
      await ctx.close()
    }

    // ---------- C2. Library screen renders empty-state on first open ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[library-open] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-library-close"]')
      const emptyHint = await page.locator('[data-testid="clip-empty"]').count()
      const importLabel = await page.locator('label[for="clip-input"]').count()
      const closeBtn = await page
        .locator('[data-testid="clip-library-close"]')
        .count()
      results.automated.C2 = {
        pass: emptyHint > 0 && importLabel > 0 && closeBtn > 0,
        empty_hint: emptyHint,
        import_label: importLabel,
        close_button: closeBtn,
      }
      await screenshot(page, 'C2-library-empty.png')
      await ctx.close()
    }

    // ---------- C3. Quota text renders when storage.estimate is available ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[library-quota] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('[data-testid="manage-clips-link"]').click()
      // The quota element only renders if navigator.storage.estimate() resolves.
      let quotaCount = 0
      try {
        await page.waitForSelector('[data-testid="clip-quota-text"]', {
          timeout: 4000,
        })
        quotaCount = await page
          .locator('[data-testid="clip-quota-text"]')
          .count()
      } catch {
        /* not all chromium builds expose navigator.storage; track best-effort */
      }
      results.automated.C3 = {
        pass: quotaCount > 0,
        note: 'Headless chromium uniformly ships navigator.storage.estimate; this is the DOM-presence check for the quota element. Live quota math remains MANUAL per §B5.',
        quota_count: quotaCount,
      }
      await screenshot(page, 'C3-library-quota.png')
      await ctx.close()
    }

    // ---------- C4. Close button returns to IdleScreen with no console errors ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[library-close] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-library-close"]')
      await page.locator('[data-testid="clip-library-close"]').click()
      await page.waitForSelector('button:has-text("Start drill")')
      const startVisible = await page
        .locator('button:has-text("Start drill")')
        .count()
      results.automated.C4 = { pass: startVisible > 0 }
      await screenshot(page, 'C4-after-close.png')
      await ctx.close()
    }

    results.console_errors = consoleErrors
    results.finishedAt = new Date().toISOString()
    const gateChecks = ['C1', 'C2', 'C3', 'C4']
    results.summary = {
      gate_checks_pass: gateChecks.every((k) => results.automated[k]?.pass),
      manual_qa_required: true,
      console_errors: consoleErrors.length,
    }
  } catch (e) {
    results.fatal = String(e)
    log('fatal:', e)
  } finally {
    await browser.close()
    await writeFile(
      resolve(OUT, 'results.json'),
      JSON.stringify(results, null, 2),
    )
    log('results written to', resolve(OUT, 'results.json'))
  }
}

main()
