// Phase 2b.5 verification driver — static-host QR pairing.
//
// Gate-grade automated checks (no live WebRTC handshake required):
//   C1. Base URL with `#role=phone` and NO offer renders the phone
//       companion in manual mode (offer-SDP textarea present) — proves the
//       hash role marker mounts PhoneApp without a `/phone` path.
//   C2. Base URL with NO role marker renders the laptop app (IdleScreen),
//       not the phone companion — proves the marker is required.
//   C3. Legacy `/phone` path still renders the phone companion (backward
//       compatible with 2b.1–2b.4 / hand-typed dev URLs).
//   C4. After loading the base URL with `#role=phone&offer=<valid>`, the
//       phone strips `offer=` from the address bar but keeps `#role=phone`
//       (privacy + reload-safety; runs synchronously, no WebRTC needed).
//
// Best-effort automated check (depends on RTCPeerConnection completing ICE
// gathering, which headless chromium without UDP/STUN may not do — same
// documented §B2 concession as 2b.1/2b.2):
//   C5. Laptop "Pair phone" with a LAN IP set renders the offer QR whose
//       phone-url is the loopback-substituted LAN IP + `#role=phone&offer=`.
//
// Manual real-device QA checklist (the authoritative gate for the Pages
// flow + the WebRTC handshake, written into results.json for sign-off):
//   M1. Open the PUBLIC deployment (GitHub Pages URL) on the laptop; tap
//       Pair phone → offer QR appears within 5s. The phone-url under it is
//       the Pages origin (NOT a LAN IP) with `#role=phone&offer=`.
//   M2. Scan with the phone (same Wi-Fi). The phone opens the SAME Pages
//       URL and auto-renders an answer QR within 3s — no blank/hanging page.
//   M3. Laptop scans the phone's answer QR; PairScreen reaches `connected`.
//   M4. Phone "Send commit" → laptop shows "Last commit received at +Xms".
//   M5. iOS only: on the Pages origin, "Enable motion sensor" prompts and
//       is granted WITHOUT any mkcert setup (origin is trusted HTTPS).
//   M6. Negative path: put the phone on mobile data (different network).
//       Pairing does not connect; after ~20s the laptop shows the
//       `connect-timeout` same-Wi-Fi diagnostic banner.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-2b5-verify')

const consoleErrors = []

function log(...a) {
  console.log('[verify]', ...a)
}

async function screenshot(page, name) {
  const p = resolve(OUT, name)
  await page.screenshot({ path: p, fullPage: false })
  return p
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
    const { width: w, height: h } = c
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
    phase: 'phase-2b.5',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Public Pages deployment: Pair phone → offer QR appears within 5s; phone-url is the Pages origin (not a LAN IP) with #role=phone&offer=.',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Phone (same Wi-Fi) scans the offer QR, opens the SAME Pages URL, auto-renders an answer QR within 3s — no blank/hanging page.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Laptop scans the phone answer QR; PairScreen reaches `connected`.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          'Phone "Send commit" → laptop shows "Last commit received at +Xms".',
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'iOS on the Pages origin: "Enable motion sensor" prompts and is granted with NO mkcert setup (trusted HTTPS).',
        signed_off: null,
      },
      {
        id: 'M6',
        description:
          'Negative: phone on mobile data / different network does not connect; after ~20s laptop shows the `connect-timeout` same-Wi-Fi diagnostic.',
        signed_off: null,
      },
    ],
  }

  const sampleSdp = `v=0\no=- 4611731400430051336 2 IN IP4 127.0.0.1\ns=-\nt=0 0\na=group:BUNDLE 0\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\nc=IN IP4 0.0.0.0\na=ice-ufrag:abcd\na=ice-pwd:0123456789abcdef0123456789abcdef\na=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF\na=setup:actpass\na=mid:0\na=sctp-port:5000\n`
  const samplePayload = makeOfferPayload(sampleSdp)

  try {
    // ---------- C1. base#role=phone (no offer) → phone manual UI ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[C1] ${m.text()}`)
      })
      await page.goto(`${BASE}#role=phone`)
      await page.waitForSelector('[aria-label="offer SDP"]', { timeout: 10000 })
      const phoneHeader = await page
        .locator('text=PointFight Phone Sensor')
        .count()
      results.automated.C1 = {
        pass: phoneHeader > 0,
        observed: { phoneHeader },
      }
      await screenshot(page, 'C1-hash-role-manual.png')
      await ctx.close()
    }

    // ---------- C2. base (no role marker) → laptop app, not phone ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[C2] ${m.text()}`)
      })
      await page.goto(BASE)
      await page.waitForLoadState('networkidle')
      const phoneHeader = await page
        .locator('text=PointFight Phone Sensor')
        .count()
      const startButton = await page
        .locator('button', { hasText: /Start/i })
        .count()
      results.automated.C2 = {
        pass: phoneHeader === 0 && startButton > 0,
        observed: { phoneHeader, startButton },
      }
      await screenshot(page, 'C2-base-laptop-app.png')
      await ctx.close()
    }

    // ---------- C3. legacy /phone path → phone companion ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[C3] ${m.text()}`)
      })
      await page.goto(`${BASE}phone`)
      await page.waitForSelector('[aria-label="offer SDP"]', { timeout: 10000 })
      const phoneHeader = await page
        .locator('text=PointFight Phone Sensor')
        .count()
      results.automated.C3 = { pass: phoneHeader > 0, observed: { phoneHeader } }
      await screenshot(page, 'C3-legacy-phone-path.png')
      await ctx.close()
    }

    // ---------- C4. offer stripped from URL, role marker kept ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[C4] ${m.text()}`)
      })
      await page.goto(`${BASE}#role=phone&offer=${samplePayload}`)
      // The strip runs synchronously in the offer-consume effect; give the
      // microtask/effect a tick to flush.
      await page.waitForFunction(
        () => !window.location.hash.includes('offer='),
        { timeout: 10000 },
      )
      const hash = await page.evaluate(() => window.location.hash)
      results.automated.C4 = {
        pass: hash === '#role=phone',
        observed: { hash },
      }
      await screenshot(page, 'C4-offer-stripped.png')
      await ctx.close()
    }

    // ---------- C5. laptop pair → loopback-substituted phone-url ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[C5] ${m.text()}`)
      })
      await page.goto(BASE)
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
          (await page.locator('[data-testid="phone-url"]').textContent()) ?? ''
      } catch (e) {
        results.automated.C5_error = String(e)
      }
      results.automated.C5 = {
        pass:
          qrCanvasNonEmpty &&
          phoneUrl.includes('192.168.1.42') &&
          phoneUrl.includes('#role=phone&offer='),
        qr_canvas_non_empty: qrCanvasNonEmpty,
        phone_url_starts_with: phoneUrl.slice(0, 90),
      }
      await screenshot(page, 'C5-pair-loopback-url.png')
      await ctx.close()
    }

    results.console_errors = consoleErrors
    results.finishedAt = new Date().toISOString()
    const gateChecks = ['C1', 'C2', 'C3', 'C4']
    const bestEffortChecks = ['C5']
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
