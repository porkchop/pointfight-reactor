// Phase 2b.4 verification driver — wire inputSource='phone' through Settings,
// Idle pre-flight, TrainerScreen subscription, SessionRecord metadata.
//
// Gate-grade automated checks:
//   C1. Settings input-source select includes a "Phone (motion)" option.
//   C2. With inputSource='phone' and no peer connected, IdleScreen renders
//       the "Phone not paired — pair now" banner and Start drill is disabled.
//   C3. Idle banner's "pair now" button navigates to PairScreen.
//   C4. With keyboard inputSource (default), no phone-not-paired banner
//       is rendered and Start is enabled.
//
// Best-effort:
//   C5. Pair → Disconnect button is rendered when peer reaches 'connected'.
//       Headless chromium without UDP typically cannot reach 'connected',
//       so this is best-effort.
//
// Manual real-device QA — recorded into results.json for human sign-off
// per QUALITY_GATES.md §"Browser-API limitations (Phase 2b)":
//   M1. Pair phone → laptop reaches 'connected' → close PairScreen →
//       phone-peer slice still reports 'connected' (peer outlives the view).
//   M2. With inputSource='phone' and peer connected, Idle's Start drill
//       button becomes enabled. Click Start.
//   M3. Drill runs. Throwing a forward-snap impulse on the phone fires
//       a commit that registers as a rep in the trainer (visible in the
//       feedback overlay + the rep count).
//   M4. After the drill ends, the SummaryScreen shows inputSource='phone'
//       on the saved SessionRecord (also visible in the IdleScreen
//       "Recent sessions" list as "… · phone").
//   M5. Disconnecting the phone mid-drill (turn off Wi-Fi, lock screen)
//       surfaces the "Phone disconnected — reconnect to continue" banner
//       in the TrainerScreen and stops new commits from registering.
//   M6. From IdleScreen, "Phone not paired — pair now" button opens
//       PairScreen; on close, the user lands back in Idle (not Settings).
//   M7. From Settings → "Pair phone", on close the user lands back in
//       Settings.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase-2b4-verify')

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

async function pickInputSource(page, value) {
  await page.locator('[data-testid="input-source-select"]').selectOption(value)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const results = {
    phase: 'phase-2b.4',
    startedAt: new Date().toISOString(),
    automated: {},
    manual_qa_checklist: [
      {
        id: 'M1',
        description:
          'Pair phone → connected → close PairScreen → phone-peer slice still reports connected (peer outlives view).',
        signed_off: null,
      },
      {
        id: 'M2',
        description:
          "With inputSource='phone' and peer connected, Idle's Start drill is enabled; click Start.",
        signed_off: null,
      },
      {
        id: 'M3',
        description:
          'Drill runs. Forward-snap impulses on phone register as reps in the trainer.',
        signed_off: null,
      },
      {
        id: 'M4',
        description:
          "Saved SessionRecord.inputSource === 'phone'; visible in SummaryScreen + IdleScreen 'Recent sessions' list.",
        signed_off: null,
      },
      {
        id: 'M5',
        description:
          'Disconnect phone mid-drill → TrainerScreen shows "Phone disconnected" banner; no new commits register.',
        signed_off: null,
      },
      {
        id: 'M6',
        description:
          'IdleScreen "pair now" → PairScreen → close returns to Idle (not Settings).',
        signed_off: null,
      },
      {
        id: 'M7',
        description:
          'Settings "Pair phone" → PairScreen → close returns to Settings.',
        signed_off: null,
      },
    ],
  }

  try {
    // ---------- C1. Settings has a "Phone (motion)" option ----------
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
      const phoneOption = await page.locator('option[value="phone"]').count()
      const phoneOptionText = await page
        .locator('option[value="phone"]')
        .textContent()
      results.automated.C1 = {
        pass: phoneOption > 0 && /phone/i.test(phoneOptionText ?? ''),
        option_count: phoneOption,
        option_text: phoneOptionText,
      }
      await screenshot(page, 'C1-settings-phone-option.png')
      await ctx.close()
    }

    // ---------- C2. inputSource='phone' + no peer → banner + Start disabled ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`[idle-phone] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('button', { hasText: /Settings/i }).first().click()
      await pickInputSource(page, 'phone')
      // Persist the change. SettingsScreen saves on its "Save & close" or
      // similar action; if no save button exists, the field is saved on
      // close. Close via the link button at the top.
      await page.locator('[data-testid="settings-save"]').click()
      // Wait for IdleScreen to remount.
      await page.waitForSelector('button', { hasText: /Start drill/i })
      const startBtn = page.locator('button', { hasText: /Start drill/i })
      const banner = await page.locator('[data-testid="phone-not-paired"]').count()
      const startDisabled = await startBtn.isDisabled()
      results.automated.C2 = {
        pass: banner > 0 && startDisabled,
        banner_count: banner,
        start_disabled: startDisabled,
      }
      await screenshot(page, 'C2-idle-phone-no-peer.png')
      await ctx.close()
    }

    // ---------- C3. Banner "pair now" button opens PairScreen ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[idle-pair-now] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('button', { hasText: /Settings/i }).first().click()
      await pickInputSource(page, 'phone')
      await page.locator('[data-testid="settings-save"]').click()
      await page.waitForSelector('[aria-label="pair phone now"]')
      await page.locator('[aria-label="pair phone now"]').click()
      // PairScreen mounts when the URL doesn't change but the view does;
      // we look for its testid.
      let pairMounted = false
      try {
        await page.waitForSelector('[data-testid="pair-state"]', {
          timeout: 8000,
        })
        pairMounted = true
      } catch {
        pairMounted = false
      }
      results.automated.C3 = { pass: pairMounted }
      await screenshot(page, 'C3-pair-from-idle.png')
      await ctx.close()
    }

    // ---------- C4. Keyboard mode → no phone banner, Start enabled ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[idle-keyboard] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.waitForSelector('button', { hasText: /Start drill/i })
      const banner = await page.locator('[data-testid="phone-not-paired"]').count()
      const startEnabled = await page
        .locator('button', { hasText: /Start drill/i })
        .isEnabled()
      results.automated.C4 = {
        pass: banner === 0 && startEnabled,
        banner_count: banner,
        start_enabled: startEnabled,
      }
      await screenshot(page, 'C4-idle-keyboard-default.png')
      await ctx.close()
    }

    // ---------- C5. Disconnect button when peer connected (best-effort) ----------
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      page.on('console', (m) => {
        if (m.type() === 'error')
          consoleErrors.push(`[disconnect] ${m.text()}`)
      })
      await page.goto(BASE)
      await clearIDB(page)
      await page.reload()
      await page.locator('button', { hasText: /Settings/i }).first().click()
      await page.locator('[aria-label="laptop LAN IP"]').fill('192.168.1.42')
      await page.locator('[aria-label="open pair phone"]').click()
      await page.waitForSelector('[data-testid="pair-state"]')
      let disconnectBtn = 0
      try {
        await page.waitForSelector('[aria-label="disconnect phone"]', {
          timeout: 6000,
        })
        disconnectBtn = await page
          .locator('[aria-label="disconnect phone"]')
          .count()
      } catch {
        /* never reached connected — covered by manual M1 */
      }
      results.automated.C5 = {
        pass: disconnectBtn > 0,
        best_effort: true,
        note:
          'Disconnect button only renders when peerState === connected; headless chromium without UDP cannot reach it. Manual M1 covers the real-device path.',
      }
      await screenshot(page, 'C5-disconnect-button.png')
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
