// Phase 5 verification driver
// Verifies analytics screen, taper mode profile builder, and compare view.
// Also confirms Phase 4 regression: profile CRUD + per-cue summary + rhythm.
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5173/'
const OUT = resolve('../artifacts/phase5-verify')

const consoleErrors = []
const networkErrors = []
function log(...a) { console.log('[verify]', ...a) }

async function screenshot(page, name) {
  const p = resolve(OUT, name)
  await page.screenshot({ path: p, fullPage: false })
  return p
}

async function fullScreenshot(page, name) {
  const p = resolve(OUT, name)
  await page.screenshot({ path: p, fullPage: true })
  return p
}

// ---------- IDB helpers ----------
async function clearAllIDB(page) {
  await page.evaluate(async () => {
    return new Promise((res) => {
      const req = indexedDB.deleteDatabase('pointfight-reactor')
      req.onsuccess = () => res()
      req.onerror = () => res()
      req.onblocked = () => res()
    })
  })
}

async function readProfiles(page) {
  return await page.evaluate(async () => {
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result); req.onerror = () => j(req.error)
    })
    if (!db.objectStoreNames.contains('profiles')) { db.close(); return [] }
    const tx = db.transaction('profiles', 'readonly')
    const store = tx.objectStore('profiles')
    const all = await new Promise((r) => {
      const g = store.getAll()
      g.onsuccess = () => r(g.result || [])
      g.onerror = () => r([])
    })
    db.close()
    return all
  })
}

async function readSessions(page) {
  return await page.evaluate(async () => {
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result); req.onerror = () => j(req.error)
    })
    if (!db.objectStoreNames.contains('sessions')) { db.close(); return [] }
    const tx = db.transaction('sessions', 'readonly')
    const store = tx.objectStore('sessions')
    const all = await new Promise((r) => {
      const g = store.getAll()
      g.onsuccess = () => r(g.result || [])
      g.onerror = () => r([])
    })
    db.close()
    return all
  })
}

// ---------- Flow helpers ----------
async function openSettings(page) {
  await page.waitForSelector('button:has-text("Settings")', { timeout: 5000 })
  await page.click('button:has-text("Settings")')
  await page.waitForSelector('.screen.settings', { timeout: 5000 })
  await page.waitForSelector('select[aria-label="active profile"]', { timeout: 5000 })
}

async function openAnalytics(page) {
  await page.waitForSelector('button:has-text("Analytics")', { timeout: 5000 })
  await page.click('button:has-text("Analytics")')
  await page.waitForSelector('.screen.analytics', { timeout: 5000 })
}

async function saveSettings(page) {
  await page.click('button.primary:has-text("Save")')
}

async function startDrill(page) {
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })
  await page.click('button.primary:has-text("Start drill")')
}

async function setNumericByLabel(page, text, value) {
  const handle = await page.evaluateHandle((t) => {
    const labels = Array.from(document.querySelectorAll('label'))
    const l = labels.find((lab) => lab.querySelector('span')?.textContent?.includes(t))
    return l ? l.querySelector('input') : null
  }, text)
  const el = handle.asElement()
  if (!el) throw new Error(`no input for ${text}`)
  await el.click({ clickCount: 3 })
  await el.fill(String(value))
}

async function configureDefaultForFastSession(page) {
  await openSettings(page)
  // Default profile: rounds=1, work=10s, rest=0s
  await setNumericByLabel(page, 'Round count', 1)
  await setNumericByLabel(page, 'Work duration (seconds)', 10)
  await setNumericByLabel(page, 'Rest duration (seconds)', 0)
  await setNumericByLabel(page, 'Min (ms)', 500)
  await setNumericByLabel(page, 'Max (ms)', 600)
  await saveSettings(page)
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 8000 })
}

async function runFastSession(page, { pressRatio = 0.5, durationMs = 12000 } = {}) {
  await startDrill(page)
  let repsSeen = 0
  const start = Date.now()
  while (Date.now() - start < durationMs) {
    try {
      const showing = await page.waitForSelector('.trainer-showing', { timeout: 3000 }).catch(() => null)
      if (!showing) break
      if (Math.random() < pressRatio) {
        await page.waitForTimeout(120)
        await page.keyboard.press('Space')
      }
      await page.waitForSelector('.feedback', { timeout: 3000 }).catch(() => {})
      repsSeen++
      await page.waitForFunction(() => !document.querySelector('.trainer-showing'), { timeout: 3000 }).catch(() => {})
    } catch {
      break
    }
  }
  // Try to wait for natural end (summary appears when work elapses)
  const sawSummary = await page.waitForSelector('.screen.summary', { timeout: 8000 }).catch(() => null)
  if (!sawSummary) {
    await page.keyboard.press('Escape')
    await page.waitForSelector('.screen.summary', { timeout: 5000 })
  }
  // Back to start
  await page.click('button.link:has-text("Back to start")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })
  return repsSeen
}

// ---------- main ----------
async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
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

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await clearAllIDB(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // De-duplicate any extra Default profiles created by React StrictMode double-init.
  await page.evaluate(async () => {
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result); req.onerror = () => j(req.error)
    })
    if (!db.objectStoreNames.contains('profiles')) { db.close(); return }
    const tx = db.transaction(['profiles', 'settings'], 'readwrite')
    const ps = tx.objectStore('profiles')
    const ss = tx.objectStore('settings')
    const all = await new Promise((r) => { const g = ps.getAll(); g.onsuccess = () => r(g.result || []) })
    const defaults = all.filter((p) => p.name === 'Default').sort((a, b) => a.createdAt - b.createdAt)
    for (let i = 1; i < defaults.length; i++) ps.delete(defaults[i].id)
    if (defaults.length > 0) {
      const settings = await new Promise((r) => { const g = ss.get('singleton'); g.onsuccess = () => r(g.result || null) })
      if (settings) ss.put({ ...settings, activeProfileId: defaults[0].id })
    }
    await new Promise((r) => { tx.oncomplete = () => r(); tx.onerror = () => r() })
    db.close()
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  const results = {}

  // ===== Prep: run two sessions =====
  log('Configuring Default for fast sessions')
  await configureDefaultForFastSession(page)

  log('Running session 1')
  const reps1 = await runFastSession(page, { pressRatio: 0.4, durationMs: 14000 })
  log(`Session 1 reps observed: ${reps1}`)

  log('Running session 2')
  const reps2 = await runFastSession(page, { pressRatio: 0.7, durationMs: 14000 })
  log(`Session 2 reps observed: ${reps2}`)

  // Verify sessions exist in IDB
  const dbSessions = await readSessions(page)
  log(`Sessions in DB: ${dbSessions.length}`)

  // ===== Open Analytics =====
  log('Opening Analytics screen')
  await openAnalytics(page)
  await fullScreenshot(page, 'analytics-overview.png')

  // ===== C1 — RT by cue type =====
  log('C1 start')
  const c1Detail = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('.analytics-section'))
    const section = sections.find((s) => s.querySelector('h2')?.textContent === 'Reaction time by cue type')
    if (!section) return { sectionFound: false }
    const headers = Array.from(section.querySelectorAll('table thead th')).map((th) => th.textContent?.trim())
    const rows = Array.from(section.querySelectorAll('table tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    )
    const sparkCount = section.querySelectorAll('svg.spark').length
    return { sectionFound: true, headers, rowCount: rows.length, sampleRows: rows.slice(0, 5), sparkCount }
  })
  const expectedC1Headers = ['Cue', 'Reps', 'Avg RT', 'Best-10', 'Error rate', 'RT trend']
  const headersOK = c1Detail.sectionFound && expectedC1Headers.every((h) => c1Detail.headers.includes(h))
  results.C1 = {
    pass: c1Detail.sectionFound && headersOK && c1Detail.rowCount >= 1,
    detail: c1Detail,
  }
  log('C1', results.C1.pass ? 'PASS' : 'FAIL')

  // ===== C2 — false-start rate over time =====
  log('C2 start')
  const trendDetail = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('.analytics-section'))
    const section = sections.find((s) => s.querySelector('h2')?.textContent?.startsWith('Trend'))
    if (!section) return { sectionFound: false }
    const sparkLabels = Array.from(section.querySelectorAll('.spark-row .spark-label')).map((l) => l.textContent?.trim())
    const headers = Array.from(section.querySelectorAll('table thead th')).map((th) => th.textContent?.trim())
    const rows = Array.from(section.querySelectorAll('table tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    )
    return { sectionFound: true, sparkLabels, headers, rowCount: rows.length, sampleRows: rows }
  })
  const fsRow = trendDetail.sparkLabels?.includes('False-start rate')
  const fsCol = trendDetail.headers?.includes('FS rate')
  results.C2 = {
    pass: !!(trendDetail.sectionFound && fsRow && fsCol && trendDetail.rowCount >= 2),
    detail: trendDetail,
  }
  log('C2', results.C2.pass ? 'PASS' : 'FAIL')

  // ===== C3 — hesitation rate over time =====
  log('C3 start')
  const hesRow = trendDetail.sparkLabels?.includes('Hesitation rate')
  const hesCol = trendDetail.headers?.includes('Hes rate')
  results.C3 = {
    pass: !!(trendDetail.sectionFound && hesRow && hesCol && trendDetail.rowCount >= 2),
    detail: { hesRow, hesCol, rowCount: trendDetail.rowCount },
  }
  log('C3', results.C3.pass ? 'PASS' : 'FAIL')

  // ===== C4 — best-10 trend =====
  log('C4 start')
  const best10Row = trendDetail.sparkLabels?.includes('Best-10 RT (ms)')
  const best10Col = trendDetail.headers?.includes('Best-10')
  // Check column has at least one non-dash value
  const best10NonEmpty = trendDetail.sampleRows?.some((row) => {
    const idx = trendDetail.headers.indexOf('Best-10')
    return idx >= 0 && row[idx] && row[idx] !== '—'
  }) ?? false
  results.C4 = {
    pass: !!(best10Row && best10Col && best10NonEmpty),
    detail: { best10Row, best10Col, best10NonEmpty },
  }
  log('C4', results.C4.pass ? 'PASS' : 'FAIL')

  await fullScreenshot(page, 'analytics-trend-and-cue.png')

  // ===== C6 — Compare sessions =====
  log('C6 start')
  const compareDetail = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('.analytics-section'))
    const section = sections.find((s) => s.querySelector('h2')?.textContent === 'Compare sessions')
    if (!section) return { sectionFound: false }
    const baselineSel = section.querySelector('select[aria-label="baseline session"]')
    const candidateSel = section.querySelector('select[aria-label="candidate session"]')
    const baselineCount = baselineSel?.options?.length ?? 0
    const candidateCount = candidateSel?.options?.length ?? 0
    const baselineVal = baselineSel?.value
    const candidateVal = candidateSel?.value
    const deltaStats = Array.from(section.querySelectorAll('.compare-stats .stat')).map((s) => ({
      label: s.querySelector('.stat-label')?.textContent?.trim(),
      value: s.querySelector('.stat-value')?.textContent?.trim(),
    }))
    const compareTable = section.querySelector('table.compare-table')
    const compareHeaders = compareTable
      ? Array.from(compareTable.querySelectorAll('thead th')).map((th) => th.textContent?.trim())
      : []
    const compareRows = compareTable
      ? Array.from(compareTable.querySelectorAll('tbody tr')).map((tr) => ({
          cls: tr.className,
          cells: Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
        }))
      : []
    return {
      sectionFound: true,
      baselineCount,
      candidateCount,
      baselineVal,
      candidateVal,
      deltaStats,
      compareHeaders,
      compareRowCount: compareRows.length,
      sampleCompareRows: compareRows.slice(0, 5),
    }
  })
  const expectedDeltas = ['Δ Avg RT', 'Δ Score', 'Δ FS rate', 'Δ Hes rate']
  const haveDeltas = expectedDeltas.every((lab) =>
    compareDetail.deltaStats?.some((d) => d.label === lab),
  )
  const expectedCompareHeaders = ['Cue', 'Status', 'Δ RT', 'Δ Error rate']
  const haveCompareHeaders = expectedCompareHeaders.every((h) => compareDetail.compareHeaders?.includes(h))
  const defaultsDiffer = compareDetail.baselineVal !== compareDetail.candidateVal
  results.C6 = {
    pass: !!(
      compareDetail.sectionFound &&
      compareDetail.baselineCount >= 2 &&
      compareDetail.candidateCount >= 2 &&
      defaultsDiffer &&
      haveDeltas &&
      haveCompareHeaders &&
      compareDetail.compareRowCount >= 1
    ),
    detail: { ...compareDetail, haveDeltas, haveCompareHeaders, defaultsDiffer },
  }
  log('C6', results.C6.pass ? 'PASS' : 'FAIL')
  await fullScreenshot(page, 'analytics-compare.png')

  // Back to idle
  await page.click('.screen.analytics button.link:has-text("Back")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // ===== C5 — Taper mode profile =====
  log('C5 start')

  // The natural drill runs above produce only ~4-5 reps per session — not
  // enough to clear the taper eligibility bar (≥5 reps per cue across ≥2
  // sessions). To exercise the actual taper builder, seed two synthetic
  // sessions with rich rep history directly into IndexedDB, then click
  // "Build taper profile". This validates the same code path the user hits
  // after a real week of drilling. Existing sessions stay; new ones get
  // added.
  log('Seeding synthetic sessions to satisfy taper eligibility (5 reps × 2 sessions per cue)')
  await page.evaluate(async () => {
    const CUE_IDS = ['steps_in', 'blitzes', 'lifts_lead_leg', 'drops_lead_hand', 'retreats', 'freezes', 'fake_steps', 'no_go_bait']
    const GO_SET = new Set(['steps_in', 'blitzes', 'lifts_lead_leg', 'drops_lead_hand', 'retreats', 'freezes'])
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result); req.onerror = () => j(req.error)
    })
    const tx = db.transaction(['sessions', 'reps'], 'readwrite')
    const ss = tx.objectStore('sessions')
    const rs = tx.objectStore('reps')
    const now = Date.now()
    function rep(id, sessionId, cueId, result, rtMs, idx) {
      const isGo = GO_SET.has(cueId)
      return {
        id, sessionId, cueId, isGo, result,
        reactionMs: rtMs, score: result === 'correct_go' || result === 'correct_no_go' ? 10 : -5,
        cueShownAt: now + idx * 1000,
        pressedAt: rtMs === null ? null : now + idx * 1000 + rtMs,
        roundIndex: 0,
        inputSource: 'keyboard',
      }
    }
    for (let sIdx = 0; sIdx < 2; sIdx++) {
      const sid = `seed-session-${sIdx}-${now}`
      const session = {
        id: sid,
        startedAt: now - (10 + sIdx) * 86400_000, // distinct, earlier than real sessions
        endedAt: now - (10 + sIdx) * 86400_000 + 60_000,
        drillType: 'first_beat_go_no_go',
        repCount: 0, // filled below
        summary: { reps: 0, correct: 0, falseStarts: 0, lateMisses: 0, hesitations: 0, score: 0, avgReactionMs: null },
        inputSource: 'keyboard',
        rounds: 1,
        workMs: 60_000,
        restMs: 0,
        cleared: 0,
        penaltyCounterEnabled: false,
      }
      let repIdx = 0
      let repCount = 0
      for (const cueId of CUE_IDS) {
        // 5 reps per cue per session, mostly successes with one error each
        for (let i = 0; i < 5; i++) {
          const isGo = GO_SET.has(cueId)
          let result, rt
          if (isGo) {
            if (i === 0) { result = 'hesitation'; rt = 500 + sIdx * 50 }
            else { result = 'correct_go'; rt = 300 + i * 20 + (cueId === 'lifts_lead_leg' ? 100 : 0) }
          } else {
            if (i === 0) { result = 'false_start'; rt = null }
            else { result = 'correct_no_go'; rt = null }
          }
          const id = `seed-rep-${sIdx}-${cueId}-${i}-${now}`
          rs.put(rep(id, sid, cueId, result, rt, repIdx++))
          repCount++
        }
      }
      session.repCount = repCount
      ss.put(session)
    }
    await new Promise((r) => { tx.oncomplete = () => r(); tx.onerror = () => r() })
    db.close()
  })

  await openSettings(page)
  // Count profiles before
  const profilesBefore = await readProfiles(page)
  await screenshot(page, 'c5-01-before-taper.png')

  // Click "Build taper profile"
  await page.click('button.link:has-text("Build taper profile")')
  // Wait for status banner (info) OR error banner
  await page.waitForTimeout(800)
  await page.waitForSelector('.banner', { timeout: 4000 }).catch(() => {})
  const taperStatus = await page.evaluate(() => {
    const info = document.querySelector('.banner.info')
    const warn = document.querySelector('.banner.warn')
    return {
      info: info?.textContent?.trim() ?? null,
      warn: warn?.textContent?.trim() ?? null,
    }
  })
  log('Taper status', JSON.stringify(taperStatus))

  // Active profile should now be a Taper profile
  const activeNameAfter = await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    return sel?.options[sel.selectedIndex]?.textContent ?? null
  })
  log('Active profile after taper build:', activeNameAfter)

  // Read settings fields driven by active profile
  const taperFields = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'))
    function num(text) {
      const l = labels.find((lab) => lab.querySelector('span')?.textContent?.includes(text))
      const v = l?.querySelector('input')?.value
      return v ? Number(v) : null
    }
    const rounds = num('Round count')
    const workSec = num('Work duration (seconds)')
    const restSec = num('Rest duration (seconds)')
    // Cue subset checkboxes
    const cueSection = Array.from(document.querySelectorAll('.settings-section')).find(
      (s) => s.querySelector('h2')?.textContent === 'Cue subset',
    )
    const cueRows = cueSection
      ? Array.from(cueSection.querySelectorAll('label.checkbox-row')).map((l) => ({
          label: l.querySelector('span')?.textContent,
          checked: !!l.querySelector('input[type="checkbox"]')?.checked,
        }))
      : []
    const checkedCount = cueRows.filter((r) => r.checked).length
    const uncheckedCount = cueRows.filter((r) => !r.checked).length
    return { rounds, workSec, restSec, cueRows, checkedCount, uncheckedCount }
  })
  log('Taper fields:', JSON.stringify(taperFields))
  await fullScreenshot(page, 'c5-02-after-taper.png')

  const profilesAfter = await readProfiles(page)
  const newProfile = profilesAfter.find((p) => !profilesBefore.some((pb) => pb.id === p.id))

  const taperRoundsOK = taperFields.rounds === 3
  const taperWorkOK = taperFields.workSec === 60
  const taperRestOK = taperFields.restSec === 30
  const taperSubsetOK = taperFields.uncheckedCount > 0 && taperFields.checkedCount > 0
  const taperProfileCreated = !!newProfile && /Taper/i.test(newProfile.name)

  results.C5 = {
    pass: taperProfileCreated && taperRoundsOK && taperWorkOK && taperRestOK && taperSubsetOK,
    detail: {
      taperStatus,
      activeNameAfter,
      taperFields,
      profilesBefore: profilesBefore.map((p) => p.name),
      profilesAfter: profilesAfter.map((p) => p.name),
      newProfileName: newProfile?.name,
      newProfileConfig: newProfile?.config,
      taperRoundsOK,
      taperWorkOK,
      taperRestOK,
      taperSubsetOK,
      taperProfileCreated,
    },
  }
  log('C5', results.C5.pass ? 'PASS' : 'FAIL')

  // Cancel settings (we don't need to save the active switch)
  await page.click('button.link:has-text("Cancel")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // ===== Phase 4 regression: profile CRUD + SummaryScreen =====
  log('Phase4 regression start')
  // Switch back to Default
  await openSettings(page)
  await page.selectOption('select[aria-label="active profile"]', { label: 'Default' })
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    return sel?.options[sel.selectedIndex]?.textContent === 'Default'
  }, { timeout: 3000 })
  // New profile
  page.once('dialog', async (d) => { await d.accept('RegressTest') })
  await page.click('button.link:has-text("New profile")')
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    return sel?.options[sel.selectedIndex]?.textContent === 'RegressTest'
  }, { timeout: 5000 })
  // Rename
  page.once('dialog', async (d) => { await d.accept('RegressTest v2') })
  await page.click('button.link:has-text("Rename")')
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    return sel?.options[sel.selectedIndex]?.textContent === 'RegressTest v2'
  }, { timeout: 5000 })
  // Delete
  page.once('dialog', async (d) => { await d.accept() })
  await page.click('button.link:has-text("Delete")')
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    return sel?.options[sel.selectedIndex]?.textContent !== 'RegressTest v2'
  }, { timeout: 5000 })
  const crudOK = await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    return sel ? !Array.from(sel.options).some((o) => o.textContent === 'RegressTest v2') : false
  })
  await screenshot(page, 'p4-regression-crud.png')

  // Make sure we're on Default for the session run
  await page.selectOption('select[aria-label="active profile"]', { label: 'Default' })
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    return sel?.options[sel.selectedIndex]?.textContent === 'Default'
  }, { timeout: 3000 })
  await page.click('button.link:has-text("Cancel")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // Run a session, then check SummaryScreen for per-cue table + rhythm panel
  await startDrill(page)
  const start = Date.now()
  while (Date.now() - start < 11000) {
    try {
      const showing = await page.waitForSelector('.trainer-showing', { timeout: 3000 }).catch(() => null)
      if (!showing) break
      if (Math.random() < 0.5) {
        await page.waitForTimeout(100)
        await page.keyboard.press('Space')
      }
      await page.waitForFunction(() => !document.querySelector('.trainer-showing'), { timeout: 3000 }).catch(() => {})
    } catch { break }
  }
  const sawSummary = await page.waitForSelector('.screen.summary', { timeout: 8000 }).catch(() => null)
  if (!sawSummary) {
    await page.keyboard.press('Escape')
    await page.waitForSelector('.screen.summary', { timeout: 5000 }).catch(() => {})
  }
  await fullScreenshot(page, 'p4-regression-summary.png')

  const summaryDetail = await page.evaluate(() => {
    const screen = document.querySelector('.screen.summary')
    if (!screen) return { found: false }
    const cueTable = screen.querySelector('.cue-table')
    const cueHeaders = cueTable
      ? Array.from(cueTable.querySelectorAll('thead th')).map((th) => th.textContent?.trim())
      : []
    const cueRowCount = cueTable ? cueTable.querySelectorAll('tbody tr').length : 0
    const rhythm = screen.querySelector('.rhythm-panel')
    const rhythmText = rhythm?.querySelector('p')?.textContent ?? ''
    return {
      found: true,
      cueHeaders,
      cueRowCount,
      rhythmPresent: !!rhythm,
      rhythmText,
    }
  })
  log('Summary detail', JSON.stringify(summaryDetail))

  const summaryExpectedHeaders = ['Cue', 'Reps', 'Correct', 'FS', 'Hes', 'Late', 'Avg RT', 'Best-10 RT']
  const summaryHeadersOK = summaryExpectedHeaders.every((h) => summaryDetail.cueHeaders?.includes(h))
  const summaryRhythmOK = summaryDetail.rhythmPresent && (summaryDetail.rhythmText?.length ?? 0) > 0

  results.Phase4Regression = {
    pass: !!(crudOK && summaryDetail.found && summaryHeadersOK && summaryDetail.cueRowCount >= 1 && summaryRhythmOK),
    detail: { crudOK, summaryDetail, summaryHeadersOK, summaryRhythmOK },
  }
  log('Phase4Regression', results.Phase4Regression.pass ? 'PASS' : 'FAIL')

  // ===== Done =====
  await writeFile(resolve(OUT, 'results.json'), JSON.stringify({
    results, consoleErrors, networkErrors,
  }, null, 2))

  await browser.close()

  console.log('\n=== SUMMARY ===')
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'}`)
  }
  console.log(`consoleErrors=${consoleErrors.length} networkErrors=${networkErrors.length}`)
  if (consoleErrors.length) console.log(JSON.stringify(consoleErrors.slice(0, 10), null, 2))
}

main().catch((err) => {
  console.error('FATAL', err)
  process.exit(2)
})
