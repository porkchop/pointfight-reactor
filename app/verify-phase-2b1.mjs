// Phase 2b.1 verification driver
//
// Automated UI checks:
//   C1. /phone route renders the PhoneApp (offer textarea + Send commit button).
//   C2. /  route renders the main App.
//   C3. Settings → Phone sensor section shows the LAN-IP field; value
//       persists across a page reload.
//   C4. Pair view (laptop) loads and exposes the offer / answer textareas
//       and a status display.
//   C5. (Best-effort) two Playwright contexts drive a full WebRTC
//       offer/answer handshake on loopback and exchange one commit message.
//       If the handshake does not complete inside 15s (e.g. headless
//       chromium without UDP), this leg is marked "covered by manual QA"
//       — that is the documented escape hatch per QUALITY_GATES.md
//       "Browser-API limitations (Phase 2b)".
//
// Manual real-device QA checklist (written into results.json so a human
// can sign off on the parts Playwright cannot reliably exercise):
//   M1. On laptop + phone on same LAN: phone loads `http://<ip>:5173/phone`
//       and renders PhoneApp.
//   M2. Laptop "Generate offer" → offer textarea populates within 5s.
//   M3. Paste offer into the phone → "Generate answer" → answer textarea
//       populates within 5s.
//   M4. Paste answer back to laptop → "Connect" → both screens reach
//       state="connected" within 5s.
//   M5. Phone "Send commit" → laptop shows "Last commit received at
//       +Xms" with X < 200.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-2b1-verify')

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

async function readSettings(page) {
  return await page.evaluate(async () => {
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result)
      req.onerror = () => j(req.error)
    })
    if (!db.objectStoreNames.contains('settings')) {
      db.close()
      return null
    }
    const tx = db.transaction('settings', 'readonly')
    const store = tx.objectStore('settings')
    const row = await new Promise((r) => {
      const g = store.get('singleton')
      g.onsuccess = () => r(g.result || null)
      g.onerror = () => r(null)
    })
    db.close()
    return row
  })
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const results = {
    phase: 'phase-2b.1',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Phone on same LAN reaches http://<laptopLanIp>:5173/phone and renders PhoneApp.',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          'Laptop "Generate offer" button populates the offer textarea within 5s.',
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Phone "Generate answer" populates the answer textarea within 5s after pasting the offer.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          'After pasting the answer back to the laptop and clicking Connect, both screens reach state="connected" within 5s.',
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'Phone "Send commit" causes the laptop to render "Last commit received at +Xms" with X < 200.',
        signed_off: null,
      },
    ],
  }

  try {
    // ---------- C1. /phone route renders PhoneApp ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[/phone] ${m.text()}`)
      })
      await page.goto(BASE + 'phone')
      await page.waitForSelector('[aria-label="offer SDP"]')
      await page.waitForSelector('[aria-label="answer SDP"]')
      await page.waitForSelector('[data-testid="phone-state"]')
      const state = await page.locator('[data-testid="phone-state"]').textContent()
      results.automated.C1 = {
        pass: state === 'idle',
        observed_state: state,
      }
      await screenshot(page, 'C1-phone-route.png')
      await ctx.close()
    }

    // ---------- C2. / route renders main App ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[/] ${m.text()}`)
      })
      await page.goto(BASE)
      // Idle screen has a Start button per the IdleScreen component.
      const hasStart = (await page.locator('button', { hasText: /Start/i }).count()) > 0
      results.automated.C2 = { pass: hasStart }
      await screenshot(page, 'C2-root-route.png')
      await ctx.close()
    }

    // ---------- C3. Settings → LAN IP field round-trips ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[settings] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('button', { hasText: /Settings/i }).first().click()
      const input = page.locator('[aria-label="laptop LAN IP"]')
      await input.waitFor()
      await input.fill('192.168.1.42')
      await page.locator('button', { hasText: /^Save$/i }).click()
      await page.waitForTimeout(250)
      const saved = await readSettings(page)
      results.automated.C3 = {
        pass: saved?.laptopLanIp === '192.168.1.42',
        observed: saved,
      }
      await ctx.close()
    }

    // ---------- C4. Pair view exposes form ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[pair] ${m.text()}`)
      })
      await page.goto(BASE)
      await page.locator('button', { hasText: /Settings/i }).first().click()
      await page.locator('[aria-label="laptop LAN IP"]').fill('192.168.1.42')
      await page.locator('[aria-label="open pair phone"]').click()
      await page.waitForSelector('[aria-label="offer SDP"]')
      await page.waitForSelector('[aria-label="answer SDP"]')
      await page.waitForSelector('[data-testid="pair-state"]')
      const phoneUrl = await page
        .locator('[data-testid="phone-url"]')
        .textContent()
      results.automated.C4 = {
        pass: phoneUrl === 'http://192.168.1.42:5173/phone',
        phone_url_shown: phoneUrl,
      }
      await screenshot(page, 'C4-pair-view.png')
      await ctx.close()
    }

    // ---------- C5. Best-effort two-context WebRTC handshake ----------
    {
      const out = { pass: false, reason: 'pending' }
      const ctxA = await browser.newContext()
      const ctxB = await browser.newContext()
      const pageA = await ctxA.newPage()
      const pageB = await ctxB.newPage()
      pageA.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[laptop] ${m.text()}`)
      })
      pageB.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[phone] ${m.text()}`)
      })
      try {
        await pageA.goto(BASE)
        await pageA
          .locator('button', { hasText: /Settings/i })
          .first()
          .click()
        await pageA.locator('[aria-label="laptop LAN IP"]').fill('127.0.0.1')
        await pageA.locator('[aria-label="open pair phone"]').click()
        await pageA.locator('button', { hasText: /Generate offer/ }).click()

        // Wait for the offer textarea to populate (laptop ICE gather).
        await pageA.waitForFunction(
          () => {
            const el = document.querySelector('textarea[aria-label="offer SDP"]')
            return el && el.value && el.value.length > 100
          },
          { timeout: 15000 },
        )
        const offer = await pageA
          .locator('[aria-label="offer SDP"]')
          .inputValue()

        await pageB.goto(BASE + 'phone')
        await pageB.locator('[aria-label="offer SDP"]').fill(offer)
        await pageB.locator('button', { hasText: /Generate answer/ }).click()
        await pageB.waitForFunction(
          () => {
            const el = document.querySelector(
              'textarea[aria-label="answer SDP"]',
            )
            return el && el.value && el.value.length > 100
          },
          { timeout: 15000 },
        )
        const answer = await pageB
          .locator('[aria-label="answer SDP"]')
          .inputValue()

        await pageA.locator('[aria-label="answer SDP"]').fill(answer)
        await pageA.locator('button', { hasText: /^Connect$/ }).click()

        // Wait for both states to reach connected.
        await pageA.waitForFunction(
          () =>
            document.querySelector('[data-testid="pair-state"]')?.textContent ===
            'connected',
          { timeout: 15000 },
        )
        await pageB.waitForFunction(
          () =>
            document.querySelector('[data-testid="phone-state"]')?.textContent ===
            'connected',
          { timeout: 5000 },
        )

        await pageB.locator('button', { hasText: /Send commit/ }).click()
        await pageA.waitForSelector('[data-testid="last-commit"]', {
          timeout: 5000,
        })

        out.pass = true
        out.reason = 'two-context WebRTC handshake + commit echo succeeded'
        await screenshot(pageA, 'C5-laptop-connected.png')
        await screenshot(pageB, 'C5-phone-connected.png')
      } catch (e) {
        out.pass = false
        out.reason = `WebRTC handshake did not complete in automated run — covered by manual QA. Underlying error: ${e.message}`
      } finally {
        await ctxA.close()
        await ctxB.close()
      }
      results.automated.C5 = out
    }

    results.console_errors = consoleErrors
    results.finishedAt = new Date().toISOString()
    // C1–C4 are gate-grade UI assertions; C5 is best-effort (headless
    // chromium WebRTC may not complete on loopback). The manual QA
    // checklist M1–M5 is the authoritative gate for the WebRTC handshake.
    const gateChecks = ['C1', 'C2', 'C3', 'C4']
    results.summary = {
      gate_checks_pass: gateChecks.every((k) => results.automated[k]?.pass),
      c5_best_effort_pass: results.automated.C5?.pass ?? false,
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
