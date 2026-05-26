// Phase 2b.2 verification driver
//
// Gate-grade automated checks (do not depend on a live WebRTC handshake):
//   C1. /phone with no URL fragment renders the manual paste UI (the 2b.1
//       fallback path that survived 2b.2).
//   C3. /phone#offer=!!! (malformed) renders the manual paste UI with the
//       "QR payload could not be read" banner.
//   C5. Pair view "Show manual pairing" toggle flips to the 2b.1 manual
//       textareas.
//
// Best-effort automated checks (depend on RTCPeerConnection completing ICE
// gathering, which headless chromium without UDP/STUN may not do — same
// documented concession as 2b.1's C5; manual real-device QA covers these):
//   C2. /phone#offer=<base64url-gzipped-sdp> renders the answer QR
//       (auto-apply path). The QR canvas is non-empty.
//   C4. Pair view (laptop) defaults to QR mode and renders the offer QR
//       canvas with a phoneUrl that contains `#offer=`.
//
// Manual real-device QA checklist (written into results.json so a human
// can sign off on the parts Playwright cannot reliably exercise):
//   M1. Laptop "Pair phone" → offer QR appears within 5s and is sharp
//       enough that a phone camera can decode it from 30 cm.
//   M2. Phone scans the offer QR, opens the URL, auto-renders the answer
//       QR within 3s of page load.
//   M3. Laptop clicks "I scanned the QR — turn on camera"; camera-permission
//       prompt accepted; webcam preview appears.
//   M4. Laptop webcam decodes the phone's answer QR within 5s when pointed
//       at the phone screen; PairScreen state reaches `connected`.
//   M5. Phone "Send commit" → laptop shows "Last commit received at +Xms"
//       with X < 200.
//   M6. Camera-deny path: deny camera permission; PairScreen auto-flips to
//       manual mode with a "Camera blocked" banner.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-2b2-verify')

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

function base64UrlEncode(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return Buffer.from(bin, 'binary')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function makeOfferPayload(sdp) {
  return base64UrlEncode(gzipSync(Buffer.from(sdp, 'utf-8')))
}

async function isCanvasNonEmpty(page, selector) {
  return await page.evaluate((sel) => {
    const c = document.querySelector(sel)
    if (!c) return false
    const ctx = c.getContext('2d')
    if (!ctx) return false
    const w = c.width
    const h = c.height
    if (!w || !h) return false
    const data = ctx.getImageData(0, 0, w, h).data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
        return true
      }
    }
    return false
  }, selector)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const results = {
    phase: 'phase-2b.2',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Laptop "Pair phone" renders an offer QR within 5s, sharp enough for phone camera decode at ~30 cm.',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Phone scans the offer QR, opens the URL, auto-renders the answer QR within 3s of page load.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Laptop "I scanned the QR — turn on camera" → permission prompt accepted, webcam preview visible.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          'Laptop webcam decodes phone answer QR within 5s; PairScreen state reaches `connected`.',
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'Phone "Send commit" → laptop renders "Last commit received at +Xms" with X < 200.',
        signed_off: null,
      },
      {
        id: 'M6',
        description:
          'Camera-deny path: deny prompt; PairScreen auto-flips to manual mode with a "Camera blocked" banner.',
        signed_off: null,
      },
    ],
  }

  const sampleSdp = `v=0\no=- 4611731400430051336 2 IN IP4 127.0.0.1\ns=-\nt=0 0\na=group:BUNDLE 0\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\nc=IN IP4 0.0.0.0\na=ice-ufrag:abcd\na=ice-pwd:0123456789abcdef0123456789abcdef\na=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF\na=setup:actpass\na=mid:0\na=sctp-port:5000\n`
  const samplePayload = makeOfferPayload(sampleSdp)

  try {
    // ---------- C1. /phone without fragment → manual paste UI ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[/phone-no-frag] ${m.text()}`)
      })
      await page.goto(BASE + 'phone')
      await page.waitForSelector('[aria-label="offer SDP"]')
      const offerTextarea = await page
        .locator('[aria-label="offer SDP"]')
        .count()
      results.automated.C1 = {
        pass: offerTextarea > 0,
        observed: { offerTextarea },
      }
      await screenshot(page, 'C1-no-fragment-manual.png')
      await ctx.close()
    }

    // ---------- C2. /phone#offer=<valid> → answer QR appears ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[/phone-frag] ${m.text()}`)
      })
      await page.goto(`${BASE}phone#offer=${samplePayload}`)
      let qrAppeared = false
      try {
        await page.waitForSelector('[data-testid="answer-qr"]', {
          timeout: 15000,
        })
        // Allow QR to render onto the canvas after acceptOffer/encode.
        await page.waitForFunction(
          () => {
            const c = document.querySelector('[data-testid="answer-qr"]')
            return c && c.width > 0
          },
          { timeout: 5000 },
        )
        qrAppeared = await isCanvasNonEmpty(page, '[data-testid="answer-qr"]')
      } catch (e) {
        results.automated.C2_error = String(e)
      }
      results.automated.C2 = { pass: qrAppeared }
      await screenshot(page, 'C2-fragment-answer-qr.png')
      await ctx.close()
    }

    // ---------- C3. /phone#offer=<bad> → manual fallback + banner ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[/phone-bad-frag] ${m.text()}`)
      })
      await page.goto(`${BASE}phone#offer=%21%21%21bad%21%21%21`)
      await page.waitForSelector('[data-testid="phone-fallback"]', {
        timeout: 10000,
      })
      const banner = await page
        .locator('[data-testid="phone-fallback"]')
        .textContent()
      const offerTextarea = await page
        .locator('[aria-label="offer SDP"]')
        .count()
      results.automated.C3 = {
        pass:
          offerTextarea > 0 && !!banner && /paste the offer manually/i.test(banner),
        banner,
      }
      await screenshot(page, 'C3-malformed-fragment.png')
      await ctx.close()
    }

    // ---------- C4. Pair view → QR mode default, QR canvas non-empty ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[pair-qr] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('button', { hasText: /Settings/i }).first().click()
      await page.locator('[aria-label="laptop LAN IP"]').fill('192.168.1.42')
      await page.locator('[aria-label="open pair phone"]').click()
      let qrCanvasNonEmpty = false
      let phoneUrl = ''
      try {
        await page.waitForSelector('[data-testid="offer-qr"]', {
          timeout: 15000,
        })
        await page.waitForFunction(
          () => {
            const c = document.querySelector('[data-testid="offer-qr"]')
            return c && c.width > 0
          },
          { timeout: 10000 },
        )
        qrCanvasNonEmpty = await isCanvasNonEmpty(
          page,
          '[data-testid="offer-qr"]',
        )
        phoneUrl =
          (await page
            .locator('[data-testid="phone-url"]')
            .textContent()) ?? ''
      } catch (e) {
        results.automated.C4_error = String(e)
      }
      results.automated.C4 = {
        pass:
          qrCanvasNonEmpty &&
          phoneUrl.includes('192.168.1.42') &&
          phoneUrl.includes('#offer='),
        qr_canvas_non_empty: qrCanvasNonEmpty,
        phone_url_starts_with: phoneUrl.slice(0, 80),
      }
      await screenshot(page, 'C4-pair-qr-mode.png')
      await ctx.close()
    }

    // ---------- C5. "Show manual pairing" toggle → manual textareas ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[pair-toggle] ${m.text()}`)
      })
      await page.goto(BASE)
      await page.locator('button', { hasText: /Settings/i }).first().click()
      await page.locator('[aria-label="laptop LAN IP"]').fill('192.168.1.42')
      await page.locator('[aria-label="open pair phone"]').click()
      await page.waitForSelector('[aria-label="toggle pair mode"]')
      await page.locator('[aria-label="toggle pair mode"]').click()
      await page.waitForSelector('[aria-label="offer SDP"]')
      const manualTextareaVisible =
        (await page.locator('[aria-label="answer SDP"]').count()) > 0
      results.automated.C5 = { pass: manualTextareaVisible }
      await screenshot(page, 'C5-pair-manual-toggle.png')
      await ctx.close()
    }

    results.console_errors = consoleErrors
    results.finishedAt = new Date().toISOString()
    // C1, C3, C5 are gate-grade (run without a live WebRTC handshake).
    // C2 and C4 are best-effort: they require the in-browser peer to
    // complete ICE gathering, which headless chromium often cannot do on
    // loopback. The manual real-device QA checklist (M1–M6) is the
    // authoritative gate for the QR + WebRTC paths.
    const gateChecks = ['C1', 'C3', 'C5']
    const bestEffortChecks = ['C2', 'C4']
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
