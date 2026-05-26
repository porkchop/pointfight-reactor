// Phase 2 acceptance verification via Playwright (headless Chromium).
// Single session; clears IndexedDB up front so the run is deterministic.
import { chromium } from '/home/aaron/dev/projects/aaron/pointfight-reactor/app/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = '/home/aaron/dev/projects/aaron/pointfight-reactor/artifacts/phase2-verify'
const URL = 'http://localhost:5175/'

const results = {}
function record(name, pass, reason) {
  results[name] = { pass, reason }
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} — ${reason}`)
}

async function snap(page, label) {
  const p = join(OUT, `${label}.png`)
  await page.screenshot({ path: p, fullPage: true })
  return p
}

async function getState(page) {
  return await page.evaluate(() => {
    const s = window.__sessionStore?.getState?.()
    if (!s) return null
    return {
      phase: s.phase,
      reps: s.reps.length,
      roundIndex: s.roundIndex,
      inputSource: s.inputSource,
      cleared: s.cleared,
      workEndAt: s.workEndAt,
      restEndAt: s.restEndAt,
      configRounds: s.config.rounds,
      configWorkMs: s.config.workMs,
      configRestMs: s.config.restMs,
      penaltyEnabled: s.config.penaltyCounterEnabled,
      lastRepResult: s.reps.length ? s.reps[s.reps.length - 1].result : null,
    }
  })
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const page = await ctx.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })

// Wipe IndexedDB so test starts from defaults.
await page.evaluate(async () => {
  const dbs = await indexedDB.databases()
  await Promise.all(
    dbs.map(
      (d) =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(d.name)
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        }),
    ),
  )
})
await page.reload({ waitUntil: 'networkidle' })

// Inject a hook so we can read the zustand store from page.evaluate.
// We can't easily expose the store without code mods, so we'll rely on DOM.
// To get state, we install a small bridge in the module by querying via DOM only.

// Helper: wait briefly. Most React state lands within one frame.
const tick = (ms) => page.waitForTimeout(ms)

// ---------- Criterion 1: Rebind commit key ----------
try {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.waitForSelector('h1:has-text("Settings")')
  await snap(page, '02-settings-open')
  await page.getByRole('button', { name: /Rebind commit key/i }).click()
  await page.waitForSelector('text=Press a key…')
  await page.keyboard.press('KeyF')
  // Button should now show F (KeyF)
  await page.waitForSelector('button:has-text("F (KeyF)")', { timeout: 2000 })
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('h1:has-text("PointFight Reactor")')
  const hint = await page.locator('p.hint').first().innerText()
  const pass = /Press\s+F\s+to commit/i.test(hint)
  record('C1_commit_key_rebind', pass, `idle hint = "${hint.trim()}"`)
  await snap(page, '01-idle-after-rebind')
} catch (e) {
  record('C1_commit_key_rebind', false, `exception: ${e.message}`)
}

// ---------- Criterion 2a: Keyboard banner visible on idle ----------
{
  const banner = await page.locator('.banner.info').first().innerText().catch(() => '')
  const pass = /Keyboard mode/i.test(banner)
  record('C2a_keyboard_banner', pass, `banner = "${banner.trim()}"`)
}

// ---------- Pre-configure for criteria 3, 6 (rounds=2, work=3, rest=2 then rest=8) ----------
// For C3, set rounds=2, work=3, rest=2. Keep commit key F.
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForSelector('h1:has-text("Settings")')

async function setNumber(labelText, value) {
  // Match exact span text (case-insensitive) inside a label, get its sibling input.
  const label = page.locator(`label:has(span:text-is("${labelText}"))`).first()
  const input = label.locator('input[type="number"]')
  await input.fill('')
  await input.fill(String(value))
}

await setNumber('Round count', 2)
await setNumber('Work duration (seconds)', 3)
await setNumber('Rest duration (seconds)', 2)

// ---------- Criterion 5: Pre-cue delay accepts up to 8000, rejects 9000 ----------
await setNumber('Min (ms)', 2000)
await setNumber('Max (ms)', 8000)

await page.getByRole('button', { name: 'Save' }).click()
// If save succeeded we should be back on idle
try {
  await page.waitForSelector('h1:has-text("PointFight Reactor")', { timeout: 2000 })
  record('C5a_precue_8000_accepted', true, 'min=2000 max=8000 saved without validation error')
} catch (e) {
  const errText = await page.locator('.banner.warn').innerText().catch(() => '')
  record('C5a_precue_8000_accepted', false, `did not return to idle; error banner = "${errText}"`)
}

// Now test reject of 9000
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForSelector('h1:has-text("Settings")')
await setNumber('Max (ms)', 9000)
await page.getByRole('button', { name: 'Save' }).click()
// Expect to stay on settings with error banner
await tick(300)
const stillOnSettings = await page.locator('h1:has-text("Settings")').isVisible()
const errText = await page.locator('.banner.warn').innerText().catch(() => '')
const c5bPass = stillOnSettings && errText.length > 0
record('C5b_precue_9000_rejected', c5bPass, `stillOnSettings=${stillOnSettings}, error="${errText.trim().replace(/\n/g, ' ')}"`)

// Revert max to 8000 so we can continue
await setNumber('Max (ms)', 8000)
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForSelector('h1:has-text("PointFight Reactor")')

// ---------- Criterion 3: Round structure (rounds=2, work=3, rest=2) ----------
// Start drill.
await page.getByRole('button', { name: 'Start drill' }).click()
await page.waitForSelector('.screen.trainer', { timeout: 3000 })
await tick(100)

// HUD shows "Round 1/2"
const hud1 = await page.locator('.hud').first().innerText()
const c3aPass = /Round\s+1\/2/.test(hud1)
record('C3a_round_1_of_2', c3aPass, `HUD = "${hud1.replace(/\n/g, ' | ')}"`)

// Work clock visible m:ss
const clockTxt = await page.locator('.hud-clock').first().innerText().catch(() => '')
const c3bPass = /^\d+:\d{2}$/.test(clockTxt.trim())
record('C3b_work_clock_mss', c3bPass, `clock = "${clockTxt.trim()}"`)

// ---------- Criterion 4: motion-pulse visible during waiting ----------
// Take snapshot during 'waiting' phase; pre-cue delay min=2000 so we have time.
await page.waitForSelector('.motion-pulse', { timeout: 3000 })
const pulseVisible = await page.locator('.motion-pulse').isVisible()
await snap(page, '03-trainer-ready-pulse')
record('C4_motion_pulse', pulseVisible, `.motion-pulse visible during READY`)

// Fire a rep: press F to commit. This may be a false start (during waiting) or a normal press.
// We want to fire several reps within the 3s work window. Repeatedly press F until work expires.
async function pressF() {
  await page.keyboard.press('KeyF')
}

// Fire a quick sequence: press F to either false-start (waiting) or commit (showing).
// We'll loop pressing F every ~400ms until rest screen appears or 6s pass.
const startMs = Date.now()
let restAppeared = false
while (Date.now() - startMs < 7000) {
  // If rest screen visible, break
  if (await page.locator('.screen.rest').isVisible().catch(() => false)) {
    restAppeared = true
    break
  }
  if (await page.locator('.screen.summary').isVisible().catch(() => false)) break
  await pressF()
  await tick(450)
}

// If we got to rest screen, good. If not, we may already be on summary (rounds completed).
const onRest = await page.locator('.screen.rest').isVisible().catch(() => false)
const onSummary = await page.locator('.screen.summary').isVisible().catch(() => false)
record('C3c_rest_transition', onRest || onSummary, `restVisible=${onRest}, summaryVisible=${onSummary}`)

if (onRest) {
  await snap(page, '04-rest-screen')
  // Rest clock m:ss visible
  const restClock = await page.locator('.rest-clock').innerText().catch(() => '')
  const c3dPass = /^\d+:\d{2}$/.test(restClock.trim())
  record('C3d_rest_clock_mss', c3dPass, `rest clock = "${restClock.trim()}"`)

  // Click "Skip rest → next round"
  await page.getByRole('button', { name: /Skip rest/ }).click()
  await page.waitForSelector('.screen.trainer', { timeout: 2000 })
  const hud2 = await page.locator('.hud').first().innerText()
  const c3ePass = /Round\s+2\/2/.test(hud2)
  record('C3e_round_2_of_2', c3ePass, `HUD round 2 = "${hud2.replace(/\n/g, ' | ')}"`)

  // Fire reps until summary
  const startMs2 = Date.now()
  while (Date.now() - startMs2 < 7000) {
    if (await page.locator('.screen.summary').isVisible().catch(() => false)) break
    await pressF()
    await tick(450)
  }
}

const onSummaryFinal = await page.locator('.screen.summary').isVisible().catch(() => false)
record('C3f_summary_after_round_2', onSummaryFinal, `summary visible = ${onSummaryFinal}`)
if (onSummaryFinal) await snap(page, '05-summary-keyboard')

// ---------- Criterion 2b: Summary shows "Input source: keyboard" ----------
if (onSummaryFinal) {
  const meta = await page.locator('.summary-meta').innerText().catch(() => '')
  const pass = /Input source:\s*keyboard/i.test(meta)
  record('C2b_summary_input_keyboard', pass, `summary meta = "${meta.replace(/\n/g, ' ')}"`)
}

// ---------- Now switch to pedal & run another session for C2c ----------
await page.getByRole('button', { name: /Back to start/ }).click()
await page.waitForSelector('h1:has-text("PointFight Reactor")')
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForSelector('h1:has-text("Settings")')
await page.selectOption('select', 'pedal')
// Save
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForSelector('h1:has-text("PointFight Reactor")')
// IdleScreen loads settings asynchronously; wait a moment for state to land.
await tick(500)

// Now banner should NOT be visible
const bannerAfter = await page.locator('.banner.info').isVisible().catch(() => false)
record('C2c_banner_hidden_when_pedal', !bannerAfter, `banner visible when pedal = ${bannerAfter}`)

// Start drill, fire reps, get to summary
await page.getByRole('button', { name: 'Start drill' }).click()
await page.waitForSelector('.screen.trainer', { timeout: 3000 })
{
  const startMs3 = Date.now()
  while (Date.now() - startMs3 < 16000) {
    if (await page.locator('.screen.summary').isVisible().catch(() => false)) break
    if (await page.locator('.screen.rest').isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /Skip rest/ }).click()
      await page.waitForSelector('.screen.trainer', { timeout: 2000 })
    }
    await pressF()
    await tick(450)
  }
}
const onSummary2 = await page.locator('.screen.summary').isVisible().catch(() => false)
if (onSummary2) {
  const meta = await page.locator('.summary-meta').innerText().catch(() => '')
  const pass = /Input source:\s*pedal/i.test(meta)
  record('C2d_summary_input_pedal', pass, `summary meta = "${meta.replace(/\n/g, ' ')}"`)
  await snap(page, '06-summary-pedal')
} else {
  record('C2d_summary_input_pedal', false, 'did not reach summary')
}

await page.getByRole('button', { name: /Back to start/ }).click()
await page.waitForSelector('h1:has-text("PointFight Reactor")')

// ---------- Criterion 6: Penalty counter ----------
// Enable penalty, perFS=1, perHes=1. rounds=2, work=3s, rest=8s.
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForSelector('h1:has-text("Settings")')
// Switch back to keyboard for the test
await page.selectOption('select', 'keyboard')
// Enable penalty
const penaltyCb = page.locator('input[type=checkbox]').first()
const isChecked = await penaltyCb.isChecked()
if (!isChecked) await penaltyCb.check()
await setNumber('Round count', 2)
await setNumber('Work duration (seconds)', 3)
await setNumber('Rest duration (seconds)', 8)
// Use a longer pre-cue delay so it's easier to fire a false-start.
await setNumber('Min (ms)', 3000)
await setNumber('Max (ms)', 4000)
// Per FS / per hes default to 1; ensure
await setNumber('Reps per false start', 1)
await setNumber('Reps per hesitation', 1)
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForSelector('h1:has-text("PointFight Reactor")')

// Start drill, immediately press F during pre-cue (waiting) -> false_start
await page.getByRole('button', { name: 'Start drill' }).click()
await page.waitForSelector('.screen.trainer', { timeout: 3000 })
// Press F right away (pre-cue is 3000-4000ms; this will be 'waiting' → false_start)
await tick(300)
await pressF()
// Now do NOTHING for the rest of the work window. The single false_start above
// gives 1 penalty rep. After feedback auto-acks, the next rep enters waiting
// but its pre-cue is 3-4s, longer than the remaining work window (~3s), so
// the work timer expires and on next ack we transition to rest.
// To force the ack, wait until past work end and then nothing — but ack only
// fires from feedback. The current rep stays in waiting. We need to drive ONE
// more event to flip into feedback past the work boundary, OR we just wait
// for work expiry then press once to finalize that rep.
// Simpler: wait long enough that the in-flight pre-cue elapses naturally,
// cue shows, response window (1200ms default) lapses → automatic 'late' rep
// (not a penalty), then feedback auto-acks past work expiry → rest screen.
{
  const startMs4 = Date.now()
  while (Date.now() - startMs4 < 12000) {
    if (await page.locator('.screen.rest').isVisible().catch(() => false)) break
    if (await page.locator('.screen.summary').isVisible().catch(() => false)) break
    await tick(300)
  }
}
const onRest6 = await page.locator('.screen.rest').isVisible().catch(() => false)
if (onRest6) {
  await snap(page, '07-rest-with-penalty')
  const panel = await page.locator('.penalty-panel').innerText().catch(() => '')
  const c6aPass = /penalty rep.*to clear/i.test(panel) && /Clear one/i.test(panel) && !/^0 penalty/.test(panel.trim())
  record('C6a_penalty_panel_shown', c6aPass, `panel = "${panel.replace(/\n/g, ' ')}"`)

  // Click "Clear one"
  const clearBtn = page.getByRole('button', { name: /^Clear one$/ })
  if (await clearBtn.isVisible()) {
    await clearBtn.click()
    await tick(300)
    const panel2 = await page.locator('.penalty-panel').innerText().catch(() => '')
    const c6bPass = /0 penalty rep/i.test(panel2) && /All clear/i.test(panel2)
    record('C6b_penalty_clear_one', c6bPass, `panel after clear = "${panel2.replace(/\n/g, ' ')}"`)
    await snap(page, '08-rest-after-clear')
  } else {
    record('C6b_penalty_clear_one', false, 'Clear one button not visible')
  }

  // Continue
  await page.getByRole('button', { name: /Skip rest/ }).click()
  await tick(300)
} else {
  record('C6a_penalty_panel_shown', false, 'never reached rest screen during penalty test')
  record('C6b_penalty_clear_one', false, 'never reached rest screen during penalty test')
}

// Drive through to summary so the run is clean
{
  const startMs5 = Date.now()
  while (Date.now() - startMs5 < 12000) {
    if (await page.locator('.screen.summary').isVisible().catch(() => false)) break
    if (await page.locator('.screen.rest').isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /Skip rest/ }).click()
      await tick(300)
      continue
    }
    await pressF()
    await tick(450)
  }
}

await page.locator('.screen.summary').isVisible().catch(() => false)
await page.getByRole('button', { name: /Back to start/ }).click().catch(() => {})
await page.waitForSelector('h1:has-text("PointFight Reactor")').catch(() => {})

// ---------- Phase 1 regression: default-ish settings + Esc stop ----------
// Reset to defaults: rounds=5, work=120s, rest=60s, penalty off.
await page.getByRole('button', { name: 'Settings' }).click()
await page.waitForSelector('h1:has-text("Settings")')
const cb = page.locator('input[type=checkbox]').first()
if (await cb.isChecked()) await cb.uncheck()
await setNumber('Round count', 5)
await setNumber('Work duration (seconds)', 120)
await setNumber('Rest duration (seconds)', 60)
await setNumber('Min (ms)', 1500)
await setNumber('Max (ms)', 4000)
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForSelector('h1:has-text("PointFight Reactor")')

await page.getByRole('button', { name: 'Start drill' }).click()
await page.waitForSelector('.screen.trainer', { timeout: 3000 })
// Fire a few reps
for (let i = 0; i < 4; i++) {
  await pressF()
  await tick(700)
}
// Stop with Escape
await page.keyboard.press('Escape')
await tick(500)
const onSummary3 = await page.locator('.screen.summary').isVisible().catch(() => false)
record('R1_summary_after_esc', onSummary3, `summary visible after Esc = ${onSummary3}`)
if (onSummary3) await snap(page, '09-summary-regression')

await page.getByRole('button', { name: /Back to start/ }).click().catch(() => {})
await page.waitForSelector('h1:has-text("PointFight Reactor")').catch(() => {})
// IdleScreen mount fires async IndexedDB query — wait for it to land.
await page.waitForSelector('.recent', { timeout: 5000 }).catch(() => {})
await tick(500)
const recent = await page.locator('.recent').isVisible().catch(() => false)
const recentCount = await page.locator('.recent li').count().catch(() => 0)
record('R2_recent_sessions_list', recent && recentCount > 0, `recent visible=${recent}, items=${recentCount}`)
await snap(page, '10-idle-with-recent')

// ---------- Output ----------
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors }, null, 2))
console.log('\n=== Console errors ===')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)')
console.log('\n=== Summary ===')
for (const [k, v] of Object.entries(results)) {
  console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${k} — ${v.reason}`)
}

await browser.close()
