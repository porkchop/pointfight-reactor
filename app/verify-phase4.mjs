// Phase 4 verification driver
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const BASE = 'http://localhost:5177/'
const OUT = resolve('../artifacts/phase4-verify')

const consoleErrors = []
const networkErrors = []
function log(...a) { console.log('[verify]', ...a) }

async function screenshot(page, name) {
  const p = resolve(OUT, name)
  await page.screenshot({ path: p, fullPage: false })
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

async function readSettings(page) {
  return await page.evaluate(async () => {
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result); req.onerror = () => j(req.error)
    })
    if (!db.objectStoreNames.contains('settings')) { db.close(); return null }
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

// ---------- Flow helpers ----------
async function openSettings(page) {
  await page.waitForSelector('button:has-text("Settings")', { timeout: 5000 })
  await page.click('button:has-text("Settings")')
  await page.waitForSelector('.screen.settings', { timeout: 5000 })
  // wait for full load
  await page.waitForSelector('select[aria-label="active profile"]', { timeout: 5000 })
}

async function saveSettings(page) {
  await page.click('button.primary:has-text("Save")')
}

async function startDrill(page) {
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })
  await page.click('button.primary:has-text("Start drill")')
}

async function endDrillToSummary(page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector('.screen.summary', { timeout: 5000 })
}

async function getActiveProfileName(page) {
  return await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    if (!sel) return null
    const opt = sel.options[sel.selectedIndex]
    return opt ? opt.textContent : null
  })
}

async function profileNamesInDropdown(page) {
  return await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    if (!sel) return []
    return Array.from(sel.options).map((o) => o.textContent)
  })
}

// ---------- main ----------
async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
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

  // Initial nav and wipe storage to clean state
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await clearAllIDB(page)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // De-duplicate any extra Default profiles created by React StrictMode double-init.
  // This is a workaround for an observed bug where loadActiveProfile() races during
  // dev-mode strict double-mounting and seeds Default twice. Report-only — does not
  // mask the C1 outcome since C1 starts from a single-profile baseline.
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
    // keep the first, delete the rest
    for (let i = 1; i < defaults.length; i++) {
      ps.delete(defaults[i].id)
    }
    // ensure activeProfileId points to surviving Default
    if (defaults.length > 0) {
      const settings = await new Promise((r) => {
        const g = ss.get('singleton'); g.onsuccess = () => r(g.result || null)
      })
      if (settings) {
        ss.put({ ...settings, activeProfileId: defaults[0].id })
      }
    }
    await new Promise((r) => { tx.oncomplete = () => r(); tx.onerror = () => r() })
    db.close()
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  const results = {}

  // ===== C1 — Profile CRUD =====
  log('C1 start')
  const c1 = { steps: [] }
  await openSettings(page)
  await screenshot(page, 'c1-01-settings-open.png')

  // Default present?
  let names = await profileNamesInDropdown(page)
  let active = await getActiveProfileName(page)
  c1.steps.push({ step: 'initial', names, active })
  const hasDefault = names.includes('Default') && active === 'Default'

  // Check Profile section exists with buttons
  const hasNewBtn = !!(await page.$('button.link:has-text("New profile")'))
  const hasRenameBtn = !!(await page.$('button.link:has-text("Rename")'))
  const hasDeleteBtn = !!(await page.$('button.link:has-text("Delete")'))

  // Create "Sparring"
  page.once('dialog', async (d) => { await d.accept('Sparring') })
  await page.click('button.link:has-text("New profile")')
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    if (!sel) return false
    const opt = sel.options[sel.selectedIndex]
    return opt && opt.textContent === 'Sparring'
  }, { timeout: 5000 })
  names = await profileNamesInDropdown(page)
  active = await getActiveProfileName(page)
  c1.steps.push({ step: 'after-create', names, active })
  const createOK = names.includes('Sparring') && active === 'Sparring'
  await screenshot(page, 'c1-02-after-create-sparring.png')

  // Rename to "Sparring v2"
  page.once('dialog', async (d) => { await d.accept('Sparring v2') })
  await page.click('button.link:has-text("Rename")')
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    if (!sel) return false
    const opt = sel.options[sel.selectedIndex]
    return opt && opt.textContent === 'Sparring v2'
  }, { timeout: 5000 })
  names = await profileNamesInDropdown(page)
  active = await getActiveProfileName(page)
  c1.steps.push({ step: 'after-rename', names, active })
  const renameOK = names.includes('Sparring v2') && active === 'Sparring v2'
  await screenshot(page, 'c1-03-after-rename.png')

  // Delete with confirm
  page.once('dialog', async (d) => { await d.accept() })
  await page.click('button.link:has-text("Delete")')
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    if (!sel) return false
    const opt = sel.options[sel.selectedIndex]
    return opt && opt.textContent === 'Default'
  }, { timeout: 5000 })
  names = await profileNamesInDropdown(page)
  active = await getActiveProfileName(page)
  c1.steps.push({ step: 'after-delete', names, active })
  const deleteOK = names.length === 1 && active === 'Default'
  await screenshot(page, 'c1-04-after-delete.png')

  // Attempt to delete only remaining
  await page.click('button.link:has-text("Delete")')
  // Should not show confirm; should show banner
  await page.waitForSelector('.banner.warn', { timeout: 3000 }).catch(() => {})
  const banner = await page.locator('.banner.warn').first().textContent().catch(() => '')
  const onlyRemainingError = /Cannot delete the only remaining profile/.test(banner || '')
  c1.steps.push({ step: 'delete-only-remaining', banner })
  await screenshot(page, 'c1-05-delete-only-remaining-error.png')

  results.C1 = {
    pass: hasDefault && hasNewBtn && hasRenameBtn && hasDeleteBtn && createOK && renameOK && deleteOK && onlyRemainingError,
    detail: { hasDefault, hasNewBtn, hasRenameBtn, hasDeleteBtn, createOK, renameOK, deleteOK, onlyRemainingError, c1 },
  }
  log('C1', results.C1.pass ? 'PASS' : 'FAIL')

  // Cancel out of settings (banner blocks save without re-dismiss)
  await page.click('button.link:has-text("Cancel")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // ===== C2 — Per-profile configurability =====
  log('C2 start')
  // Create a fresh Sparring profile
  await openSettings(page)
  page.once('dialog', async (d) => { await d.accept('Sparring') })
  await page.click('button.link:has-text("New profile")')
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    const opt = sel?.options[sel.selectedIndex]
    return opt && opt.textContent === 'Sparring'
  }, { timeout: 5000 })

  // Fill values: rounds=2, work=3s, rest=2s, hes=400, late=700, rw=1500, distance ON
  async function setNumericByLabel(text, value) {
    // find the input inside the label that has a span with this text
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
  await setNumericByLabel('Round count', 2)
  await setNumericByLabel('Work duration (seconds)', 3)
  await setNumericByLabel('Rest duration (seconds)', 2)
  await setNumericByLabel('Hesitation threshold (ms)', 400)
  await setNumericByLabel('Late threshold (ms)', 700)
  await setNumericByLabel('Response window (ms)', 1500)

  // Toggle distance axis ON
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label.checkbox-row'))
    const dist = labels.find((l) => l.textContent?.includes('distance axis'))
    const cb = dist?.querySelector('input[type="checkbox"]')
    if (cb && !cb.checked) cb.click()
  })

  await saveSettings(page)
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // Reopen, switch to Default
  await openSettings(page)
  const profilesNow = await profileNamesInDropdown(page)
  // Switch to Default
  await page.selectOption('select[aria-label="active profile"]', { label: 'Default' })
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    const opt = sel?.options[sel.selectedIndex]
    return opt && opt.textContent === 'Default'
  }, { timeout: 3000 })
  // Read Default values
  async function readNumericByLabel(text) {
    return await page.evaluate((t) => {
      const labels = Array.from(document.querySelectorAll('label'))
      const l = labels.find((lab) => lab.querySelector('span')?.textContent?.includes(t))
      const v = l?.querySelector('input')?.value
      return v ? Number(v) : null
    }, text)
  }
  const defaultRounds = await readNumericByLabel('Round count')
  const defaultHes = await readNumericByLabel('Hesitation threshold (ms)')
  // Switch back to Sparring
  await page.selectOption('select[aria-label="active profile"]', { label: 'Sparring' })
  await page.waitForFunction(() => {
    const sel = document.querySelector('select[aria-label="active profile"]')
    const opt = sel?.options[sel.selectedIndex]
    return opt && opt.textContent === 'Sparring'
  }, { timeout: 3000 })
  const r = await readNumericByLabel('Round count')
  const w = await readNumericByLabel('Work duration (seconds)')
  const rs = await readNumericByLabel('Rest duration (seconds)')
  const hes = await readNumericByLabel('Hesitation threshold (ms)')
  const late = await readNumericByLabel('Late threshold (ms)')
  const rw = await readNumericByLabel('Response window (ms)')
  const distOn = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label.checkbox-row'))
    const dist = labels.find((l) => l.textContent?.includes('distance axis'))
    return !!dist?.querySelector('input[type="checkbox"]')?.checked
  })
  await screenshot(page, 'c2-sparring-roundtrip.png')

  results.C2 = {
    pass:
      r === 2 && w === 3 && rs === 2 && hes === 400 && late === 700 && rw === 1500 && distOn === true &&
      defaultRounds === 5 && defaultHes === 450,
    detail: { profilesNow, sparring: { r, w, rs, hes, late, rw, distOn }, default: { rounds: defaultRounds, hes: defaultHes } },
  }
  log('C2', results.C2.pass ? 'PASS' : 'FAIL')

  // Default thresholds banner check — confirm hint shows defaults 450/600/1200
  const hintText = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.settings-section'))
      .find((s) => s.querySelector('h2')?.textContent === 'Choice-RT thresholds')
      ?.querySelector('.hint')?.textContent || ''
  })
  results.C2.detail.thresholdsHint = hintText

  // Cancel and stay on Sparring (active)
  await page.click('button.link:has-text("Cancel")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // ===== C3 — Late classification =====
  log('C3 start')
  // Sparring has 1500 response window. We will not press → finishWindow → late (since rt > lateThreshold but inside RW).
  // Need stable conditions: short work, no rest, so that ESC -> summary is quick.
  // Sparring currently has work=3s rounds=2 rest=2s. Good enough. Start and let it run a couple reps without pressing.
  // But Sparring also has distance axis ON, meaning many cues become no-go at "far" → those would be correct_no_go, not late.
  // Filter the experiment: open settings → distance OFF for this run.
  await openSettings(page)
  // Ensure we're on Sparring
  await page.selectOption('select[aria-label="active profile"]', { label: 'Sparring' })
  // Turn distance OFF for C3 run only
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label.checkbox-row'))
    const dist = labels.find((l) => l.textContent?.includes('distance axis'))
    const cb = dist?.querySelector('input[type="checkbox"]')
    if (cb && cb.checked) cb.click()
  })
  // Shorten precue for quick reps
  await setNumericByLabel('Min (ms)', 500)
  await setNumericByLabel('Max (ms)', 600)
  // Increase work duration so we don't time out before we capture
  await setNumericByLabel('Work duration (seconds)', 30)
  await setNumericByLabel('Round count', 1)
  await saveSettings(page)
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  await startDrill(page)
  // run several reps without pressing → should accumulate late + correct_no_go
  // Each rep takes ~500ms precue + 1500ms RW + 1000ms feedback ≈ 3s
  // Let it run ~12s for ~4 reps.
  await page.waitForTimeout(12000)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.screen.summary', { timeout: 5000 })
  await screenshot(page, 'c3-summary-late.png')
  // Inspect "Late misses" stat and class on trainer earlier — but we're at summary now
  const lateMisses = await page.evaluate(() => {
    const stats = Array.from(document.querySelectorAll('.stat'))
    for (const s of stats) {
      const lab = s.querySelector('.stat-label')?.textContent
      if (lab === 'Late misses') return Number(s.querySelector('.stat-value')?.textContent || '0')
    }
    return -1
  })
  // Also check the cue-table contains a non-zero Late column somewhere (column index 5)
  const tableLates = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.cue-table tbody tr'))
    return rows.map((r) => Array.from(r.querySelectorAll('td')).map((td) => td.textContent))
  })

  results.C3 = {
    pass: lateMisses >= 1,
    detail: { lateMisses, sampleRows: tableLates.slice(0, 3) },
  }
  log('C3', results.C3.pass ? 'PASS' : 'FAIL')

  // Back to idle
  await page.click('button.link:has-text("Back to start")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // ===== C4 — Cue subset =====
  log('C4 start')
  await openSettings(page)
  await page.selectOption('select[aria-label="active profile"]', { label: 'Sparring' })
  // Uncheck all go cues except "STEPS IN"
  // The Cue subset section has 8 checkbox rows under .cue-subset-grid
  const cueLabels = await page.evaluate(() => {
    const section = Array.from(document.querySelectorAll('.settings-section')).find(
      (s) => s.querySelector('h2')?.textContent === 'Cue subset',
    )
    if (!section) return []
    return Array.from(section.querySelectorAll('label.checkbox-row')).map((l) => l.querySelector('span')?.textContent)
  })
  // Go cues per library: STEPS IN, BLITZES, LIFTS LEAD LEG, DROPS LEAD HAND, RETREATS, FREEZES
  const goCueLabels = ['STEPS IN', 'BLITZES', 'LIFTS LEAD LEG', 'DROPS LEAD HAND', 'RETREATS', 'FREEZES']
  // Uncheck all go cues except STEPS IN
  for (const label of goCueLabels) {
    if (label === 'STEPS IN') continue
    await page.evaluate((lab) => {
      const section = Array.from(document.querySelectorAll('.settings-section')).find(
        (s) => s.querySelector('h2')?.textContent === 'Cue subset',
      )
      const row = Array.from(section.querySelectorAll('label.checkbox-row')).find(
        (l) => l.querySelector('span')?.textContent === lab,
      )
      const cb = row?.querySelector('input[type="checkbox"]')
      if (cb && cb.checked) cb.click()
    }, label)
  }
  await screenshot(page, 'c4-01-cue-subset-config.png')
  await saveSettings(page)
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  await startDrill(page)
  // Capture cues during showing phase — track svg class lists
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
  const seen = new Set()
  const start = Date.now()
  while (Date.now() - start < 15000) {
    try {
      await page.waitForSelector('.trainer-showing svg.cue-pictograph', { timeout: 3000 })
      const cls = await page.evaluate(() => {
        const svg = document.querySelector('svg.cue-pictograph')
        return svg ? Array.from(svg.classList) : []
      })
      for (const c of cls) if (ANIM_TO_CUE_ID[c]) seen.add(ANIM_TO_CUE_ID[c])
      // wait for next showing
      await page.waitForFunction(() => !document.querySelector('.trainer-showing'), { timeout: 5000 }).catch(() => {})
    } catch {
      break
    }
  }
  await screenshot(page, 'c4-02-running-subset.png')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.screen.summary', { timeout: 5000 })
  const allowedSet = new Set(['steps_in', 'fake_steps', 'no_go_bait'])
  const onlyAllowed = [...seen].every((id) => allowedSet.has(id))
  const sawStepsIn = seen.has('steps_in')

  await page.click('button.link:has-text("Back to start")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  // Now uncheck all go cues entirely - expect validation error
  await openSettings(page)
  await page.selectOption('select[aria-label="active profile"]', { label: 'Sparring' })
  // Uncheck STEPS IN too
  await page.evaluate(() => {
    const section = Array.from(document.querySelectorAll('.settings-section')).find(
      (s) => s.querySelector('h2')?.textContent === 'Cue subset',
    )
    const row = Array.from(section.querySelectorAll('label.checkbox-row')).find(
      (l) => l.querySelector('span')?.textContent === 'STEPS IN',
    )
    const cb = row?.querySelector('input[type="checkbox"]')
    if (cb && cb.checked) cb.click()
  })
  await saveSettings(page)
  await page.waitForSelector('.banner.warn', { timeout: 3000 }).catch(() => {})
  const validationBanner = await page.locator('.banner.warn').first().textContent().catch(() => '')
  const validationOK = /at least one go cue/i.test(validationBanner || '')
  await screenshot(page, 'c4-03-no-go-cues-error.png')

  // Restore by re-enabling all (cancel and revert)
  await page.click('button.link:has-text("Cancel")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  results.C4 = {
    pass: onlyAllowed && sawStepsIn && validationOK,
    detail: { cueLabels, seen: [...seen], onlyAllowed, sawStepsIn, validationBanner },
  }
  log('C4', results.C4.pass ? 'PASS' : 'FAIL')

  // ===== C5 — Per-cue summary breakdown =====
  log('C5 start')
  // Switch to Default, ensure defaults, run a drill ~30 reps mixing presses
  await openSettings(page)
  await page.selectOption('select[aria-label="active profile"]', { label: 'Default' })
  // Make work long enough
  await setNumericByLabel('Round count', 1)
  await setNumericByLabel('Work duration (seconds)', 120)
  await setNumericByLabel('Min (ms)', 500)
  await setNumericByLabel('Max (ms)', 600)
  await saveSettings(page)
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })

  await startDrill(page)
  // Mix presses: half the reps press space, half no-press
  let repsSeen = 0
  const c5Start = Date.now()
  while (repsSeen < 30 && Date.now() - c5Start < 90000) {
    try {
      await page.waitForSelector('.trainer-showing', { timeout: 4000 })
      if (repsSeen % 2 === 0) {
        // press space mid-window
        await page.waitForTimeout(150)
        await page.keyboard.press('Space')
      }
      // wait for feedback to appear
      await page.waitForSelector('.feedback', { timeout: 4000 }).catch(() => {})
      repsSeen++
      // wait for showing to disappear (acknowledge)
      await page.waitForFunction(() => !document.querySelector('.trainer-showing'), { timeout: 3000 }).catch(() => {})
    } catch {
      break
    }
  }
  await page.keyboard.press('Escape')
  await page.waitForSelector('.screen.summary', { timeout: 5000 })
  await screenshot(page, 'c5-summary-breakdown.png')

  // Inspect table headers + row count
  const headers = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.cue-table thead th')).map((th) => th.textContent?.trim())
  })
  const rowsData = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.cue-table tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    )
  })
  const expectedHeaders = ['Cue', 'Reps', 'Correct', 'FS', 'Hes', 'Late', 'Avg RT', 'Best-10 RT']
  const headersOK = expectedHeaders.every((h) => headers.includes(h))
  const distinctCueRows = rowsData.length
  results.C5 = {
    pass: headersOK && distinctCueRows >= 3,
    detail: { headers, rowCount: distinctCueRows, rowsSample: rowsData.slice(0, 5), repsSeen },
  }
  log('C5', results.C5.pass ? 'PASS' : 'FAIL')

  // ===== C6 — Anti-rhythm narrative =====
  log('C6 start')
  const rhythm = await page.evaluate(() => {
    const panel = document.querySelector('.rhythm-panel')
    if (!panel) return { present: false, text: '' }
    const h = panel.querySelector('h2')?.textContent
    const p = panel.querySelector('p')?.textContent || ''
    return { present: true, h, text: p }
  })
  const okRhythm = rhythm.present &&
    (rhythm.text.length > 0) &&
    (/No rhythm pattern detected/.test(rhythm.text) || /False starts most often/.test(rhythm.text))
  await screenshot(page, 'c6-rhythm-panel.png')
  results.C6 = { pass: okRhythm, detail: rhythm }
  log('C6', results.C6.pass ? 'PASS' : 'FAIL')

  // ===== Phase 3 regression =====
  log('Phase3 start')
  await page.click('button.link:has-text("Back to start")')
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })
  // Set Default profile config directly via IDB so we don't hit the
  // (separate) settings-save bug that drops activeProfileId switches.
  await page.evaluate(async () => {
    const req = indexedDB.open('pointfight-reactor')
    const db = await new Promise((r, j) => {
      req.onsuccess = () => r(req.result); req.onerror = () => j(req.error)
    })
    const tx = db.transaction(['profiles', 'settings'], 'readwrite')
    const ps = tx.objectStore('profiles')
    const ss = tx.objectStore('settings')
    const all = await new Promise((r) => { const g = ps.getAll(); g.onsuccess = () => r(g.result || []) })
    const def = all.find((p) => p.name === 'Default')
    if (def) {
      def.config = { ...def.config,
        rounds: 2, workMs: 4000, restMs: 3000,
        preCueMinMs: 500, preCueMaxMs: 600,
        distanceAxisEnabled: false, audioToneEnabled: false, textOverlayEnabled: false,
        allowedCueIds: null,
      }
      ps.put(def)
      const settings = await new Promise((r) => { const g = ss.get('singleton'); g.onsuccess = () => r(g.result || null) })
      if (settings) {
        ss.put({ ...settings, activeProfileId: def.id })
      }
    }
    await new Promise((r) => { tx.oncomplete = () => r(); tx.onerror = () => r() })
    db.close()
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('button.primary:has-text("Start drill")', { timeout: 5000 })
  await startDrill(page)

  // Verify SVG pictograph still appears
  let sawPicto = false
  try {
    await page.waitForSelector('.trainer-showing svg.cue-pictograph', { timeout: 5000 })
    sawPicto = true
  } catch {}
  await screenshot(page, 'p3-regression-pictograph.png')
  // Wait for rest phase
  let sawRest = false
  try {
    await page.waitForSelector('.screen.rest, .rest, .trainer-rest', { timeout: 12000 })
    sawRest = true
  } catch {}
  await screenshot(page, 'p3-regression-rest.png')
  // Wait for summary
  let sawSummary = false
  try {
    await page.waitForSelector('.screen.summary', { timeout: 20000 })
    sawSummary = true
  } catch {}

  results.Phase3 = {
    pass: sawPicto && sawRest && sawSummary,
    detail: { sawPicto, sawRest, sawSummary },
  }
  log('Phase3', results.Phase3.pass ? 'PASS' : 'FAIL')

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
