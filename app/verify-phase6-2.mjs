// Phase 6.2 verification driver — clip tagging UI.
//
// Gate-grade automated checks (run against `npm run dev` on http://localhost:5173):
//   C1. From the empty library, the "Tag" button is not shown (no clips yet)
//       but the import label is present — sanity check that the row-actions
//       toolbar only renders for real rows.
//   C2. After seeding one clip directly into Dexie (the headless context
//       cannot reliably drive `<input type=file>`-then-`extractDurationMs`
//       on synthetic blobs), the clip row exposes a "Tag" button and a
//       "needs tag" marker.
//   C3. Clicking "Tag" opens ClipTagScreen with the cue-type select
//       populated with all 8 CUE_LIBRARY entries, the scrub bar, the +/-1
//       frame buttons, the Save button, and the Close button all visible.
//   C4. Selecting a cue type ("blitzes") and clicking Save persists; the
//       Save indicator appears. Closing back to the library shows the
//       "needs tag" marker gone (the clip is now tagged) and re-opening
//       the tag screen prefills the cue-select with "blitzes".
//
// Manual real-device QA — per QUALITY_GATES.md §"Browser-API limitations
// (Phase 2b + Phase 6)" §B5: scrub-to-1-frame precision requires real
// <video> + a real .mp4 file. Headless chromium does not decode synthesized
// blobs reliably.
//   M1. Import 2–3 real .mp4 clips via Manage clips.
//   M2. Open Tag on one of them. Scrub the native video controls; the
//       custom range slider tracks the video's currentTime within one
//       frame of resolution.
//   M3. Step ±1 frame with the buttons. The video frame visibly advances
//       or retreats by approximately 1/30 s.
//   M4. Pick a cue type and Save. Reload the page; re-open Tag on the
//       same clip. The cue-select is prefilled with the saved cue and
//       the scrub bar is parked at the saved cueAtMs.
//   M5. Library: the tagged clip no longer shows the "needs tag" marker;
//       untagged siblings still do.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-6-2-verify')

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

// Seed a clip directly into Dexie so the Tag flow can be exercised without
// driving the headless file-picker (which cannot meaningfully decode a
// synthesized .mp4 anyway — see §B5 manual QA).
async function seedClip(page, { name = 'verify.mp4', durationMs = 5000 } = {}) {
  // Open without specifying a version so we attach to whatever Dexie set up
  // (Dexie internally multiplies its version by 10 — v4 → IDB v40 — so a
  // hardcoded version mismatches). The app must have loaded once for the
  // `clips` object store to exist.
  await page.evaluate(
    async ({ name, durationMs }) => {
      const dbReq = indexedDB.open('pointfight-reactor')
      const db = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result)
        dbReq.onerror = () => reject(dbReq.error)
      })
      const tx = db.transaction(['clips'], 'readwrite')
      const store = tx.objectStore('clips')
      const blob = new Blob([new Uint8Array(1024)], { type: 'video/mp4' })
      const id = `clip-verify-${Date.now()}`
      await new Promise((resolve, reject) => {
        const req = store.put({
          id,
          name,
          mimeType: 'video/mp4',
          durationMs,
          sizeBytes: blob.size,
          importedAt: Date.now(),
          blob,
        })
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
      await new Promise((r) => (tx.oncomplete = r))
      db.close()
      return id
    },
    { name, durationMs },
  )
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const results = {
    phase: 'phase-6.2',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Import 2–3 real .mp4 clips via Manage clips.',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Open Tag on one. The custom scrub bar tracks <video> currentTime within one frame.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Step ±1 frame with the buttons. Video advances/retreats by ~1/30 s.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          'Pick a cue + Save. Reload; re-open Tag; cue-select prefilled, scrub at saved cueAtMs.',
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'Library: tagged clip lacks "needs tag" marker; untagged siblings retain it.',
        signed_off: null,
      },
    ],
  }

  try {
    // ---------- C1. Empty library shows no Tag button (no clips) ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[empty-no-tag] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-library-close"]')
      const tagButtons = await page
        .locator('[data-testid="clip-tag-open"]')
        .count()
      const importLabel = await page.locator('label[for="clip-input"]').count()
      results.automated.C1 = {
        pass: tagButtons === 0 && importLabel > 0,
        tag_buttons_when_empty: tagButtons,
        import_label: importLabel,
      }
      await screenshot(page, 'C1-empty-no-tag-button.png')
      await ctx.close()
    }

    // ---------- C2. Seeded clip shows Tag button + "needs tag" marker ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[seeded-tag-row] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      // The app needs to open Dexie at version(4) before we seed.
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-library-close"]')
      await seedClip(page)
      // Re-open the library so the row is fetched.
      await page.locator('[data-testid="clip-library-close"]').click()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-tag-open"]')
      const tagButtons = await page
        .locator('[data-testid="clip-tag-open"]')
        .count()
      const needsTag = await page
        .locator('[data-testid="clip-needs-tag"]')
        .count()
      results.automated.C2 = {
        pass: tagButtons > 0 && needsTag > 0,
        tag_buttons: tagButtons,
        needs_tag_markers: needsTag,
      }
      await screenshot(page, 'C2-seeded-tag-row.png')
      await ctx.close()
    }

    // ---------- C3. Tag screen renders cue-select with 8 entries + scrub + frame +/- + save ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[tag-screen-open] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-library-close"]')
      await seedClip(page)
      await page.locator('[data-testid="clip-library-close"]').click()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-tag-open"]')
      await page.locator('[data-testid="clip-tag-open"]').first().click()
      await page.waitForSelector('[data-testid="clip-tag-cue-select"]')
      const optionCount = await page
        .locator('[data-testid="clip-tag-cue-select"] option')
        .count()
      const scrub = await page.locator('[data-testid="clip-tag-scrub"]').count()
      const back = await page
        .locator('[data-testid="clip-tag-frame-back"]')
        .count()
      const fwd = await page
        .locator('[data-testid="clip-tag-frame-forward"]')
        .count()
      const save = await page.locator('[data-testid="clip-tag-save"]').count()
      const close = await page
        .locator('[data-testid="clip-tag-close"]')
        .count()
      results.automated.C3 = {
        pass:
          optionCount === 8 &&
          scrub > 0 &&
          back > 0 &&
          fwd > 0 &&
          save > 0 &&
          close > 0,
        cue_option_count: optionCount,
        scrub,
        frame_back: back,
        frame_forward: fwd,
        save,
        close,
      }
      await screenshot(page, 'C3-tag-screen.png')
      await ctx.close()
    }

    // ---------- C4. Save persists; reopening prefills the cue-select ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[tag-save-persist] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-library-close"]')
      await seedClip(page)
      await page.locator('[data-testid="clip-library-close"]').click()
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-tag-open"]')
      await page.locator('[data-testid="clip-tag-open"]').first().click()
      await page.waitForSelector('[data-testid="clip-tag-cue-select"]')
      await page
        .locator('[data-testid="clip-tag-cue-select"]')
        .selectOption('blitzes')
      await page.locator('[data-testid="clip-tag-save"]').click()
      await page.waitForSelector('[data-testid="clip-tag-saved"]')
      await page.locator('[data-testid="clip-tag-close"]').click()
      await page.waitForSelector('[data-testid="clip-list"]')
      const needsTagAfter = await page
        .locator('[data-testid="clip-needs-tag"]')
        .count()
      await page.locator('[data-testid="clip-tag-open"]').first().click()
      await page.waitForSelector('[data-testid="clip-tag-cue-select"]')
      const prefillVal = await page
        .locator('[data-testid="clip-tag-cue-select"]')
        .inputValue()
      results.automated.C4 = {
        pass: needsTagAfter === 0 && prefillVal === 'blitzes',
        needs_tag_after_save: needsTagAfter,
        prefilled_cue: prefillVal,
      }
      await screenshot(page, 'C4-prefilled-after-reopen.png')
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
