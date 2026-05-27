// Phase 6.3 verification driver — clip-mode drill + RT measurement + per-clip results.
//
// Gate-grade automated checks (run against `npm run dev` on http://localhost:5173):
//   C1. IdleScreen renders the segmented mode control with `data-testid='mode-segmented'`,
//       `data-testid='mode-live'`, and `data-testid='mode-clip'` options; "Live" is the
//       default and Start is enabled with a profile present.
//   C2. Selecting "Clip" with zero tagged clips disables Start with the
//       `data-testid='clip-mode-no-clips'` banner pointing to the library.
//   C3. With chromium (which uniformly ships requestVideoFrameCallback), the
//       `clip-mode-unsupported` banner is NOT shown when Clip is selected.
//   C4. Seeding one tagged clip into Dexie + selecting Clip mode + clicking Start
//       transitions into the ClipDrillScreen (`data-testid='clip-drill'`) and renders
//       the `<video>` element with `data-testid='clip-drill-video'`. Console errors = 0.
//
// Manual real-device QA — per QUALITY_GATES.md §"Browser-API limitations
// (Phase 2b + Phase 6)" §B5: real `<video>` + requestVideoFrameCallback against
// a clip on disk. The ±33 ms cue-shown precision criterion is MANUAL.
//   M1. Tag a real .mp4 clip with cueId='blitzes' and a cueAtMs of ~1500.
//   M2. Start Clip mode. The clip auto-plays; "WATCH" overlay is visible until ~cueAtMs.
//   M3. Press the commit key just after the cue moment. The feedback shows
//       a 3-digit reactionMs that, eyeballing against the source video, lands within
//       ~33 ms of the tagged frame.
//   M4. Stop the drill. SummaryScreen shows the per-clip breakdown table
//       (`data-testid='per-clip-breakdown'`) with the cue + RT for the clip.
//   M5. Re-opening Manage clips: the tagged clip is unchanged (clip-mode does not
//       mutate the clip record).
//   M6. The saved SessionRecord (Dexie via DevTools) has `mode === 'clip'`
//       and each RepRecord carries the correct `clipId`.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-6-3-verify')

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

// Seed a clip directly into Dexie. Open without a version so we attach to
// whatever Dexie set up (Dexie internally multiplies its version by 10 —
// v4 → IDB v40). Optionally writes a (cueId, cueAtMs) tag.
async function seedClip(
  page,
  { name = 'verify.mp4', durationMs = 5000, cueId, cueAtMs } = {},
) {
  await page.evaluate(
    async ({ name, durationMs, cueId, cueAtMs }) => {
      const dbReq = indexedDB.open('pointfight-reactor')
      const db = await new Promise((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result)
        dbReq.onerror = () => reject(dbReq.error)
      })
      const tx = db.transaction(['clips'], 'readwrite')
      const store = tx.objectStore('clips')
      const blob = new Blob([new Uint8Array(1024)], { type: 'video/mp4' })
      const record = {
        id: `clip-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        mimeType: 'video/mp4',
        durationMs,
        sizeBytes: blob.size,
        importedAt: Date.now(),
        blob,
      }
      if (cueId !== undefined) record.cueId = cueId
      if (cueAtMs !== undefined) record.cueAtMs = cueAtMs
      await new Promise((resolve, reject) => {
        const req = store.put(record)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
      await new Promise((r) => (tx.oncomplete = r))
      db.close()
      return record.id
    },
    { name, durationMs, cueId, cueAtMs },
  )
}

async function bootstrapApp(page) {
  await page.goto(BASE)
  await clearIDB(page)
  await page.reload()
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const results = {
    phase: 'phase-6.3',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          "Tag a real .mp4 clip (cueId='blitzes', cueAtMs ≈ 1500).",
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Start Clip mode. The clip auto-plays; WATCH overlay visible until cueAtMs.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Press commit after cue. Feedback shows reactionMs within ±33 ms of the tagged frame.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          "Stop the drill. SummaryScreen shows the per-clip breakdown (data-testid='per-clip-breakdown').",
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'Re-open Manage clips: the tagged clip is unchanged (clip-mode does not mutate the clip record).',
        signed_off: null,
      },
      {
        id: 'M6',
        description:
          "Saved SessionRecord.mode === 'clip' and each RepRecord carries clipId (inspect via DevTools).",
        signed_off: null,
      },
    ],
  }

  try {
    // ---------- C1. Segmented control rendered, Live default ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[mode-seg] ${m.text()}`)
      })
      await bootstrapApp(page)
      const seg = await page
        .locator('[data-testid="mode-segmented"]')
        .count()
      const live = await page.locator('[data-testid="mode-live"]').count()
      const clip = await page.locator('[data-testid="mode-clip"]').count()
      const liveChecked = await page
        .locator('[data-testid="mode-live"] input')
        .isChecked()
      results.automated.C1 = {
        pass: seg > 0 && live > 0 && clip > 0 && liveChecked,
        segmented: seg,
        live_option: live,
        clip_option: clip,
        live_default_checked: liveChecked,
      }
      await screenshot(page, 'C1-segmented-control.png')
      await ctx.close()
    }

    // ---------- C2. Clip mode with no tagged clips → no-clips banner + Start disabled ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[no-clips] ${m.text()}`)
      })
      await bootstrapApp(page)
      await page.locator('[data-testid="mode-clip"]').click()
      const banner = await page
        .locator('[data-testid="clip-mode-no-clips"]')
        .count()
      const startBtn = page.locator('button.primary', { hasText: /Start/ })
      const startDisabled = await startBtn.isDisabled()
      results.automated.C2 = {
        pass: banner > 0 && startDisabled,
        banner_count: banner,
        start_disabled: startDisabled,
      }
      await screenshot(page, 'C2-no-clips-banner.png')
      await ctx.close()
    }

    // ---------- C3. requestVideoFrameCallback is present on headless chromium → unsupported banner not shown ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[supported] ${m.text()}`)
      })
      await bootstrapApp(page)
      await page.locator('[data-testid="mode-clip"]').click()
      const unsupportedBanner = await page
        .locator('[data-testid="clip-mode-unsupported"]')
        .count()
      const rvfcPresent = await page.evaluate(() =>
        'requestVideoFrameCallback' in HTMLVideoElement.prototype,
      )
      results.automated.C3 = {
        pass: unsupportedBanner === 0 && rvfcPresent === true,
        unsupported_banner: unsupportedBanner,
        rvfc_present_on_chromium: rvfcPresent,
      }
      await screenshot(page, 'C3-rvfc-supported.png')
      await ctx.close()
    }

    // ---------- C4. With a tagged clip seeded, Start enters ClipDrillScreen ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[clip-drill] ${m.text()}`)
      })
      await bootstrapApp(page)
      // Seed via the library screen first to ensure Dexie is opened.
      await page.locator('[data-testid="manage-clips-link"]').click()
      await page.waitForSelector('[data-testid="clip-library-close"]')
      await seedClip(page, { cueId: 'blitzes', cueAtMs: 500 })
      await page.locator('[data-testid="clip-library-close"]').click()
      // Wait for the IdleScreen to re-render with the seeded clip in state.
      await page.waitForSelector('[data-testid="mode-segmented"]')
      await page.locator('[data-testid="mode-clip"]').click()
      // The no-clips banner should now be gone.
      const noClips = await page
        .locator('[data-testid="clip-mode-no-clips"]')
        .count()
      // Click Start.
      await page.locator('button.primary', { hasText: /Start/ }).click()
      await page.waitForSelector('[data-testid="clip-drill"]', {
        timeout: 5000,
      })
      const drill = await page.locator('[data-testid="clip-drill"]').count()
      const video = await page
        .locator('[data-testid="clip-drill-video"]')
        .count()
      results.automated.C4 = {
        pass: drill > 0 && video > 0 && noClips === 0,
        clip_drill: drill,
        video_element: video,
        no_clips_banner_after_seed: noClips,
      }
      await screenshot(page, 'C4-clip-drill-mounted.png')
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
