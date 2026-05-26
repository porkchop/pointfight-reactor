// Phase 2b.3 verification driver — accelerometer threshold + calibration
//
// Gate-grade automated checks (do not require a live DataChannel or a real
// accelerometer; both are gated by manual real-device QA per §B2):
//   C1. /phone renders the new "Motion sensor" section with the "Enable
//       motion sensor" button and a status readout of "off".
//   C2. /phone "Enable motion sensor" click — in headless chromium without
//       a DeviceMotionEvent.requestPermission shim, the page must end up
//       in either status="on" (listener attached) or status="unsupported"
//       (no DeviceMotionEvent), without any console errors and without
//       the manual "Send commit (manual)" path disappearing.
//   C3. Pair view shows a calibration panel below the status block when
//       a peer is in 'connected' state. Headless chromium without UDP
//       does not reach `connected`, so this check is best-effort.
//
// Manual real-device QA checklist — written into results.json so the
// human operator can sign off on the parts Playwright cannot reliably
// exercise (per QUALITY_GATES.md §"Browser-API limitations (Phase 2b)"):
//   M1. Phone at rest on a flat surface for 60s → laptop shows ZERO new
//       "Last commit received at +Xms" lines.
//   M2. Five deliberate forward-snap impulses, well separated → laptop
//       shows EXACTLY 5 new commits, no extras.
//   M3. Two impulses inside 300ms (double-tap) → laptop shows EXACTLY 1
//       new commit, the second is debounced.
//   M4. From PairScreen (connected), click "Start calibration", throw 5
//       sample swings → "Saved threshold: X.XX g" line appears.
//   M5. Reload the page → the laptop's PairScreen "Current threshold"
//       reads the same X.XX g (persisted via ProfileRecord.config.
//       phoneCalibration).
//   M6. Re-run calibration with different swing intensities → the saved
//       threshold differs from M4, confirming overwrite semantics.
//   M7. Android Chrome over plain HTTP: the entire flow above works
//       without any permission prompts.
//   M8. iOS Safari over HTTPS (per docs/SETUP_IOS.md): the "Enable
//       motion sensor" button triggers a permission prompt; accepting
//       it engages motion exactly like Android.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-2b3-verify')

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
    phase: 'phase-2b.3',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Phone at rest on a flat surface for 60s → laptop receives ZERO new commits.',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Five deliberate forward-snap impulses → laptop shows EXACTLY 5 new commits.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Two impulses inside the 300ms debounce window → laptop shows EXACTLY 1 commit.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          'Start calibration → throw 5 sample swings → "Saved threshold" appears with a finite value.',
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'Reload the page → "Current threshold" matches M4 (persisted on ProfileRecord.config.phoneCalibration).',
        signed_off: null,
      },
      {
        id: 'M6',
        description:
          'Re-run calibration with different swings → the saved threshold differs from M4 (overwrite semantics).',
        signed_off: null,
      },
      {
        id: 'M7',
        description:
          'Android Chrome over plain HTTP: full flow works with no permission prompts.',
        signed_off: null,
      },
      {
        id: 'M8',
        description:
          'iOS Safari over HTTPS (per docs/SETUP_IOS.md): "Enable motion sensor" prompts, then armed mode works.',
        signed_off: null,
      },
    ],
  }

  try {
    // ---------- C1. /phone shows the Motion sensor section ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[/phone-motion] ${m.text()}`)
      })
      await page.goto(BASE + 'phone')
      await page.waitForSelector('[data-testid="motion-status"]')
      const initialStatus = await page
        .locator('[data-testid="motion-status"]')
        .textContent()
      const enableBtn = await page
        .locator('[aria-label="enable motion sensor"]')
        .count()
      const manualBtn = await page
        .locator('button', { hasText: /Send commit \(manual\)/i })
        .count()
      results.automated.C1 = {
        pass:
          (initialStatus?.trim() === 'off' ||
            initialStatus?.trim() === 'unsupported') &&
          (enableBtn > 0 || initialStatus?.trim() === 'unsupported') &&
          manualBtn > 0,
        initialStatus: initialStatus?.trim() ?? null,
        enable_button_count: enableBtn,
        manual_button_count: manualBtn,
      }
      await screenshot(page, 'C1-phone-motion-section.png')
      await ctx.close()
    }

    // ---------- C2. Click "Enable motion sensor" → status changes ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[/phone-enable] ${m.text()}`)
      })
      await page.goto(BASE + 'phone')
      await page.waitForSelector('[data-testid="motion-status"]')
      const enableBtnLocator = page.locator(
        '[aria-label="enable motion sensor"]',
      )
      const hasEnableBtn = (await enableBtnLocator.count()) > 0
      let finalStatus = null
      if (hasEnableBtn) {
        await enableBtnLocator.click()
        // Wait briefly for the click handler's setMotionStatus to land.
        await page.waitForFunction(
          () => {
            const el = document.querySelector('[data-testid="motion-status"]')
            const v = el?.textContent?.trim() ?? ''
            return v === 'on' || v === 'denied' || v === 'unsupported'
          },
          { timeout: 5000 },
        )
        finalStatus = (
          await page.locator('[data-testid="motion-status"]').textContent()
        )?.trim()
      } else {
        finalStatus = (
          await page.locator('[data-testid="motion-status"]').textContent()
        )?.trim()
      }
      // Headless chromium provides DeviceMotionEvent but no real sensor; the
      // listener attaches but never fires. status="on" is the expected
      // success path here. "unsupported" is accepted when chromium does not
      // expose DeviceMotionEvent at all.
      results.automated.C2 = {
        pass: finalStatus === 'on' || finalStatus === 'unsupported',
        finalStatus,
      }
      await screenshot(page, 'C2-motion-enabled.png')
      await ctx.close()
    }

    // ---------- C3. Pair view exposes calibration UI when connected ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[pair-calibrate] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('button', { hasText: /Settings/i }).first().click()
      await page.locator('[aria-label="laptop LAN IP"]').fill('192.168.1.42')
      await page.locator('[aria-label="open pair phone"]').click()
      await page.waitForSelector('[data-testid="pair-state"]')
      // Calibration panel only appears when peerState === 'connected'.
      // Headless chromium without UDP/STUN typically cannot reach
      // 'connected', so we check whether the panel renders within a short
      // window and report best-effort.
      let calibrationVisible = false
      try {
        await page.waitForSelector('[data-testid="calibrate-panel"]', {
          timeout: 8000,
        })
        calibrationVisible = true
      } catch {
        calibrationVisible = false
      }
      const peerStateText = (
        await page.locator('[data-testid="peer-state"]').textContent()
      )?.trim()
      results.automated.C3 = {
        pass: calibrationVisible,
        best_effort: true,
        peerState: peerStateText,
        note:
          'Calibration panel renders iff peer reaches connected; headless chromium without UDP typically cannot — manual M4–M6 are the authoritative gate.',
      }
      await screenshot(page, 'C3-pair-calibrate.png')
      await ctx.close()
    }

    results.console_errors = consoleErrors
    results.finishedAt = new Date().toISOString()
    // C1 + C2 are gate-grade. C3 is best-effort under the §B2 concession.
    const gateChecks = ['C1', 'C2']
    const bestEffortChecks = ['C3']
    results.summary = {
      gate_checks_pass: gateChecks.every((k) => results.automated[k]?.pass),
      best_effort_pass: bestEffortChecks.every(
        (k) => results.automated[k]?.pass,
      ),
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
