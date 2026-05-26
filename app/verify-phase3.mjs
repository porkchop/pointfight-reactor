// Phase 3 verification driver
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5176/'
const OUT = resolve('artifacts/phase3-verify')

const consoleErrors = []
const networkErrors = []

function log(...args) { console.log('[verify]', ...args) }

async function screenshot(page, name) {
  const p = resolve(OUT, name)
  await page.screenshot({ path: p, fullPage: false })
  return p
}

async function setSettingsViaIDB(page, overrides) {
  // Open a Dexie connection to the same DB and write singleton row, then reload
  await page.evaluate(async (ov) => {
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    // try to find settings store
    if (!db.objectStoreNames.contains('settings')) {
      db.close()
      return
    }
    const tx = db.transaction('settings', 'readwrite')
    const store = tx.objectStore('settings')
    const getReq = store.get('singleton')
    const existing = await new Promise((res) => {
      getReq.onsuccess = () => res(getReq.result || null)
      getReq.onerror = () => res(null)
    })
    const base = existing || {
      id: 'singleton',
      commitKeyCode: 'Space',
      commitKeyLabel: 'Space',
      inputSource: 'keyboard',
      rounds: 5,
      workMs: 120_000,
      restMs: 60_000,
      preCueMinMs: 1500,
      preCueMaxMs: 4000,
      penaltyCounterEnabled: false,
      perFalseStartPenalty: 1,
      perHesitationPenalty: 1,
      distanceAxisEnabled: false,
      audioToneEnabled: false,
      textOverlayEnabled: false,
    }
    const merged = { ...base, ...ov }
    await new Promise((res, rej) => {
      const r = store.put(merged)
      r.onsuccess = () => res()
      r.onerror = () => rej(r.error)
    })
    db.close()
  }, overrides)
}

async function waitForPhase(page, phaseClass, timeout = 15000) {
  await page.waitForSelector(`.trainer-${phaseClass}`, { timeout })
}

async function startDrillFromIdle(page) {
  await page.waitForSelector('button.primary:has-text("Start drill")')
  await page.click('button.primary:has-text("Start drill")')
}

async function stopDrill(page) {
  // Press Escape
  await page.keyboard.press('Escape')
  // Summary or idle
  await page.waitForTimeout(300)
  // Return to idle: click "Back" if on summary
  const back = await page.$('button:has-text("Back")')
  if (back) await back.click()
  const newSes = await page.$('button:has-text("New session")')
  if (newSes) await newSes.click()
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 }).catch(() => {})
}

async function captureCue(page, label) {
  // wait until trainer-showing then ensure pictograph visible
  await waitForPhase(page, 'showing', 20000)
  await page.waitForSelector('svg.cue-pictograph', { timeout: 5000 })
  const info = await page.evaluate(() => {
    const svg = document.querySelector('svg.cue-pictograph')
    const wrap = document.querySelector('.cue-pictograph-wrap')
    const overlay = document.querySelector('.cue-overlay')
    const cueLabel = overlay?.querySelector('.cue-label')?.textContent || null
    const distLabel = overlay?.querySelector('.cue-distance-label')?.textContent || null
    const transform = wrap ? wrap.getAttribute('style') : null
    const distance = wrap ? wrap.getAttribute('data-distance') : null
    // SVG class list contains animation class like anim-step-in; cue id mapping is via animation class
    const classList = svg ? Array.from(svg.classList) : []
    return { classList, cueLabel, distLabel, transform, distance, hasOverlay: !!overlay }
  })
  return info
}

async function runReps(page, repCount, onCue) {
  let observed = 0
  while (observed < repCount) {
    try {
      const info = await captureCue(page, observed)
      observed++
      if (onCue) await onCue(info, observed)
      // wait for feedback then next showing
      await page.waitForSelector('.feedback', { timeout: 8000 }).catch(() => {})
      // press space briefly to dismiss feedback if needed? Not necessary: auto-advance
      // Wait for next waiting or showing phase
      await page.waitForFunction(() => {
        return !!document.querySelector('.trainer-waiting, .trainer-showing')
      }, { timeout: 10000 }).catch(() => {})
    } catch (err) {
      log('rep loop error', err.message)
      break
    }
  }
  return observed
}

const ANIM_TO_CUE_ID = {
  'anim-step-in': 'steps_in',
  'anim-blitz': 'blitzes',
  'anim-leg-lift': 'lifts_lead_leg',
  'anim-hand-drop': 'drops_lead_hand',
  'anim-retreat': 'retreats',
  'anim-freeze': 'freezes',
  'anim-fake-step': 'fake_steps',
  'anim-bait': 'no_go_bait',
}

function cueIdFromClassList(list) {
  for (const c of list) {
    if (ANIM_TO_CUE_ID[c]) return ANIM_TO_CUE_ID[c]
  }
  return null
}

async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ at: new Date().toISOString(), text: msg.text() })
    }
  })
  page.on('pageerror', (err) => {
    consoleErrors.push({ at: new Date().toISOString(), text: `pageerror: ${err.message}` })
  })
  page.on('requestfailed', (req) => {
    networkErrors.push({ url: req.url(), reason: req.failure()?.errorText })
  })

  const results = {}

  await page.goto(BASE, { waitUntil: 'networkidle' })

  // Fast settings via IDB: short preCue and short work
  await setSettingsViaIDB(page, {
    preCueMinMs: 300,
    preCueMaxMs: 500,
    workMs: 600_000,
    rounds: 1,
    textOverlayEnabled: false,
    distanceAxisEnabled: false,
    audioToneEnabled: false,
  })
  await page.reload({ waitUntil: 'networkidle' })

  // ---------- C1: SVG pictograph default ----------
  log('C1 start')
  await startDrillFromIdle(page)
  const c1Seen = []
  const c1Shot = new Set()
  await runReps(page, 12, async (info, n) => {
    const cueId = cueIdFromClassList(info.classList)
    c1Seen.push({ cueId, hasOverlay: info.hasOverlay })
    if (cueId && !c1Shot.has(cueId) && c1Shot.size < 2) {
      await screenshot(page, `c1-pictograph-${n}-${cueId}.png`)
      c1Shot.add(cueId)
    }
  })
  const c1Shots = c1Shot.size
  const c1NoOverlayDefault = c1Seen.every((c) => c.hasOverlay === false)
  const c1AtLeast3SVG = c1Seen.filter((c) => c.cueId).length >= 3
  results.C1 = {
    pass: c1NoOverlayDefault && c1AtLeast3SVG && c1Shots >= 2,
    detail: { seen: c1Seen, screenshots: c1Shots },
  }
  log('C1', results.C1)
  await stopDrill(page)

  // ---------- C2: Text overlay toggle ----------
  log('C2 start')
  await setSettingsViaIDB(page, { textOverlayEnabled: true })
  await page.reload({ waitUntil: 'networkidle' })
  await startDrillFromIdle(page)
  let c2OnSeen = false
  let c2OnShot = null
  await runReps(page, 3, async (info, n) => {
    if (!c2OnSeen && info.hasOverlay && info.cueLabel) {
      c2OnSeen = true
      c2OnShot = await screenshot(page, `c2-overlay-on-${n}.png`)
    }
  })
  await stopDrill(page)

  await setSettingsViaIDB(page, { textOverlayEnabled: false })
  await page.reload({ waitUntil: 'networkidle' })
  await startDrillFromIdle(page)
  let c2OffSeen = false
  let c2OffShot = null
  await runReps(page, 3, async (info, n) => {
    if (!c2OffSeen && info.hasOverlay === false) {
      c2OffSeen = true
      c2OffShot = await screenshot(page, `c2-overlay-off-${n}.png`)
    }
  })
  results.C2 = {
    pass: c2OnSeen && c2OffSeen,
    detail: { overlayOn: c2OnSeen, overlayOff: c2OffSeen, on: c2OnShot, off: c2OffShot },
  }
  log('C2', results.C2)
  await stopDrill(page)

  // ---------- C3: distance sizes ----------
  log('C3 start')
  await setSettingsViaIDB(page, { distanceAxisEnabled: true, textOverlayEnabled: true })
  await page.reload({ waitUntil: 'networkidle' })
  await startDrillFromIdle(page)
  const distanceShots = {}
  const distanceScales = {}
  await runReps(page, 30, async (info) => {
    const d = info.distance
    if (!d || d === 'none') return
    if (!distanceShots[d]) {
      const m = /scale\(([\d.]+)\)/.exec(info.transform || '')
      const scale = m ? parseFloat(m[1]) : null
      distanceScales[d] = { scale, label: info.distLabel }
      distanceShots[d] = await screenshot(page, `c3-distance-${d}.png`)
    }
    return Object.keys(distanceShots).length >= 3
  })
  function near(a, b) { return a !== null && Math.abs(a - b) < 0.02 }
  const c3Pass =
    near(distanceScales.far?.scale, 0.45) &&
    near(distanceScales.mid?.scale, 0.7) &&
    near(distanceScales.in_range?.scale, 1.0) &&
    distanceScales.far?.label === 'FAR' &&
    distanceScales.mid?.label === 'MID' &&
    distanceScales.in_range?.label === 'IN RANGE'
  results.C3 = { pass: !!c3Pass, detail: { distanceScales, distanceShots } }
  log('C3', results.C3)
  await stopDrill(page)

  // ---------- C4: distance changes correct response ----------
  log('C4 start')
  // Already distance enabled. Do not press the commit key.
  // Use a fresh start so reps array is empty.
  await setSettingsViaIDB(page, { distanceAxisEnabled: true, textOverlayEnabled: true, workMs: 600_000, rounds: 1 })
  await page.reload({ waitUntil: 'networkidle' })
  await startDrillFromIdle(page)

  // For each rep, wait through showing and feedback without pressing space.
  // After ~30 reps inspect feedback labels via observation.
  const c4Observations = []
  for (let i = 0; i < 35; i++) {
    try {
      await waitForPhase(page, 'showing', 15000)
      const info = await captureCue(page, i)
      // Wait for feedback to appear
      await page.waitForSelector('.trainer-correct_no_go, .trainer-correct_go, .trainer-late, .trainer-false_start, .trainer-hesitation', { timeout: 6000 })
      const feedback = await page.evaluate(() => {
        const root = document.querySelector('.trainer')
        const fbLabel = document.querySelector('.feedback-label')?.textContent || null
        const cls = root ? Array.from(root.classList) : []
        return { fbLabel, cls }
      })
      c4Observations.push({
        cueId: cueIdFromClassList(info.classList),
        distance: info.distance,
        feedbackLabel: feedback.fbLabel,
        cls: feedback.cls,
      })
      // wait for next phase
      await page.waitForFunction(() => !!document.querySelector('.trainer-waiting, .trainer-showing'), { timeout: 10000 }).catch(() => {})
    } catch (err) {
      log('c4 rep error', err.message)
      break
    }
  }
  // Find a 'far' rep ending in correct_no_go where same cue at mid would be go
  const farGoMidCues = new Set(['steps_in', 'lifts_lead_leg', 'drops_lead_hand', 'retreats', 'freezes'])
  const c4Hits = c4Observations.filter((o) =>
    o.distance === 'far' && farGoMidCues.has(o.cueId) && o.feedbackLabel === 'HOLD ✓'
  )
  results.C4 = {
    pass: c4Hits.length >= 1,
    detail: { totalObs: c4Observations.length, hits: c4Hits.length, samples: c4Observations.slice(0, 8) },
  }
  log('C4', results.C4)
  await stopDrill(page)

  // ---------- C5: audio tone enabled ----------
  log('C5 start')
  await setSettingsViaIDB(page, { audioToneEnabled: true, distanceAxisEnabled: true })
  await page.reload({ waitUntil: 'networkidle' })
  await startDrillFromIdle(page)
  // run a few reps
  await runReps(page, 4)
  const hasAudioContext = await page.evaluate(() => {
    return typeof window.AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined'
  })
  // Sample console errors during this section will be inspected at end
  results.C5 = {
    pass: hasAudioContext && consoleErrors.filter((e) => /audio|tone/i.test(e.text)).length === 0,
    detail: { hasAudioContext, audioErrors: consoleErrors.filter((e) => /audio|tone/i.test(e.text)) },
  }
  log('C5', results.C5)
  await stopDrill(page)

  // ---------- C6: data-driven palette: at least 6 of 8 cues across runs ----------
  log('C6 start')
  await setSettingsViaIDB(page, { audioToneEnabled: false, distanceAxisEnabled: false, textOverlayEnabled: false, workMs: 600_000, rounds: 1 })
  await page.reload({ waitUntil: 'networkidle' })
  await startDrillFromIdle(page)
  const seenCueIds = new Set()
  await runReps(page, 40, async (info) => {
    const id = cueIdFromClassList(info.classList)
    if (id) seenCueIds.add(id)
  })
  results.C6 = {
    pass: seenCueIds.size >= 6,
    detail: { uniqueCues: [...seenCueIds], count: seenCueIds.size },
  }
  log('C6', results.C6)
  await stopDrill(page)

  // ---------- Phase 2 regression ----------
  log('Phase2 regression start')
  await setSettingsViaIDB(page, {
    preCueMinMs: 300,
    preCueMaxMs: 500,
    workMs: 4000, // short work so we hit rest quickly
    restMs: 3000,
    rounds: 2,
    textOverlayEnabled: false,
    distanceAxisEnabled: false,
    audioToneEnabled: false,
    penaltyCounterEnabled: false,
  })
  await page.reload({ waitUntil: 'networkidle' })
  await startDrillFromIdle(page)
  // Verify HUD shows "Round 1/2"
  const hudText = await page.locator('.hud').first().textContent()
  // Wait for rest screen
  let sawRest = false
  try {
    await page.waitForSelector('.screen.rest, .rest', { timeout: 20000 })
    sawRest = true
  } catch {}
  await screenshot(page, 'p2-rest.png')
  // Let work finish out -> summary
  let sawSummary = false
  try {
    await page.waitForSelector('.summary, .screen.summary', { timeout: 30000 })
    sawSummary = true
  } catch {}
  await screenshot(page, 'p2-summary.png')
  // Recent sessions list on idle — click "Back to start" then wait
  const backBtn = await page.$('button:has-text("Back to start")')
  if (backBtn) await backBtn.click()
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 }).catch(() => {})
  // Give listRecentSessions time
  await page.waitForTimeout(800)
  const recentCount = await page.locator('.recent ul li').count().catch(() => 0)
  await screenshot(page, 'p2-idle-recent.png')
  results.Phase2 = {
    pass: !!hudText && /Round 1\/2/.test(hudText) && sawRest && sawSummary && recentCount > 0,
    detail: { hudText, sawRest, sawSummary, recentCount },
  }
  log('Phase2', results.Phase2)

  // Save artifacts
  await writeFile(resolve(OUT, 'results.json'), JSON.stringify({
    results, consoleErrors, networkErrors,
  }, null, 2))

  await browser.close()

  console.log('\n=== SUMMARY ===')
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'}`)
  }
  console.log(`consoleErrors=${consoleErrors.length} networkErrors=${networkErrors.length}`)
  if (consoleErrors.length) console.log(JSON.stringify(consoleErrors.slice(0, 6), null, 2))
}

main().catch((err) => {
  console.error('FATAL', err)
  process.exit(2)
})
