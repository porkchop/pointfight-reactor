// Phase 2b.6 verification driver — laptop answer-QR scan actually starts.
//
// Regression target: in 2b.2 the "I scanned the QR — turn on camera" handler
// read videoRef.current while still in the 'showing-offer' state, where the
// <video> is not yet mounted. videoRef.current was null, so the handler
// early-returned BEFORE setting 'scanning-answer' or starting the jsQR loop:
// the camera turned on but nothing scanned and there was no feedback.
//
// Gate-grade automated check (uses Chromium's fake camera so getUserMedia
// resolves without a physical device; the fake stream is a synthetic pattern,
// not a real QR, so decode→connected stays a manual gate):
//   C1. From the laptop Pair screen, clicking "start scan" transitions the
//       pair state to 'scanning-answer', mounts the <video>, and the scan
//       loop runs (scan-status reports frames being checked). This FAILS
//       before the fix (state never leaves 'showing-offer').
//
// Manual real-device QA (the authoritative gate for real webcam decode):
//   M1. Point the phone's answer QR at the laptop webcam; within ~5s the
//       laptop decodes it and PairScreen reaches 'connected'.
//   M2. Higher-resolution capture: the dense answer QR decodes reliably at
//       a normal arm's-length distance (not only when pressed to the lens).
//   M3. Manual-pairing fallback (paste the answer SDP) still completes a
//       connection when the webcam can't decode.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-2b6-verify')
const consoleErrors = []

function log(...a) {
  console.log('[verify]', ...a)
}

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(OUT, name), fullPage: false })
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  })
  const results = {
    phase: 'phase-2b.6',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Point the phone answer QR at the laptop webcam; within ~5s the laptop decodes it and PairScreen reaches connected.',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Dense answer QR decodes reliably at arm’s length (higher-resolution capture), not only pressed to the lens.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Manual-pairing fallback (paste answer SDP) still completes a connection when the webcam cannot decode.',
        signed_off: null,
      },
    ],
  }

  try {
    const ctx = await browser.newContext({ permissions: ['camera'] })
    const page = await ctx.newPage()
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`[C1] ${m.text()}`)
    })
    await page.goto(BASE)
    await page.locator('button', { hasText: /Settings/i }).first().click()
    await page.locator('[aria-label="laptop LAN IP"]').fill('192.168.1.42')
    await page.locator('[aria-label="open pair phone"]').click()

    // Wait for the offer QR (proves createOffer completed and we are in
    // 'showing-offer' — the state in which the old bug bailed out).
    await page.waitForSelector('[data-testid="offer-qr"]', { timeout: 15000 })
    await page.waitForFunction(
      () => {
        const c = document.querySelector('[data-testid="offer-qr"]')
        return c && c.width > 0
      },
      { timeout: 10000 },
    )

    await page.locator('[aria-label="start scan"]').click()

    // The fix: this transition + video mount + scan loop now happen. Before
    // the fix, the click no-ops and the state stays 'showing-offer'.
    let reachedScanning = false
    let videoMounted = false
    let framesText = ''
    try {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="pair-state"]')?.textContent ===
          'scanning-answer',
        { timeout: 8000 },
      )
      reachedScanning = true
      videoMounted =
        (await page.locator('[data-testid="answer-video"]').count()) > 0
      // The scan loop increments a frame counter; wait for it to tick past 0.
      await page.waitForFunction(
        () => {
          const t =
            document.querySelector('[data-testid="scan-status"]')
              ?.textContent ?? ''
          const m = t.match(/(\d+)\s+frame/)
          return m && Number(m[1]) > 0
        },
        { timeout: 8000 },
      )
      framesText =
        (await page.locator('[data-testid="scan-status"]').textContent()) ?? ''
    } catch (e) {
      results.automated.C1_error = String(e)
    }

    results.automated.C1 = {
      pass: reachedScanning && videoMounted && /[1-9]\d*\s+frame/.test(framesText),
      observed: { reachedScanning, videoMounted, framesText: framesText.trim() },
    }
    await screenshot(page, 'C1-scan-started.png')
    await ctx.close()

    results.console_errors = consoleErrors
    results.finishedAt = new Date().toISOString()
    results.summary = {
      gate_checks_pass: results.automated.C1?.pass === true,
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
