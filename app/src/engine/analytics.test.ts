import { describe, expect, it } from 'vitest'
import {
  buildTaperProfileBlueprint,
  compareSessions,
  cueAggregate,
  cueTrend,
  pickTaperCues,
  sessionTrend,
} from './analytics'
import { DEFAULT_DRILL_CONFIG } from './types'
import type { CueId, RepRecord, RepResult, SessionRecord } from './types'

let nextRepId = 0
function rep(
  sessionId: string,
  cueId: CueId,
  result: RepResult,
  reactionMs: number | null,
  isGo: boolean,
  score = 0,
): RepRecord {
  return {
    id: `r-${++nextRepId}`,
    sessionId,
    cueId,
    isGo,
    result,
    reactionMs,
    score,
    cueShownAt: 0,
    pressedAt: null,
    roundIndex: 0,
    inputSource: 'keyboard',
  }
}

function session(
  id: string,
  startedAt: number,
  reps: RepRecord[],
  scoreWeights?: SessionRecord['summary']['score'],
): { rec: SessionRecord; reps: RepRecord[] } {
  const correct = reps.filter(
    (r) => r.result === 'correct_go' || r.result === 'correct_no_go',
  ).length
  const fs = reps.filter((r) => r.result === 'false_start').length
  const hes = reps.filter((r) => r.result === 'hesitation').length
  const lateMisses = reps.filter((r) => r.result === 'late').length
  const goTimes = reps
    .filter((r) => r.result === 'correct_go' && r.reactionMs !== null)
    .map((r) => r.reactionMs as number)
  const avg =
    goTimes.length === 0
      ? null
      : Math.round(goTimes.reduce((a, b) => a + b, 0) / goTimes.length)
  return {
    rec: {
      id,
      startedAt,
      endedAt: startedAt + 60_000,
      drillType: 'first_beat_go_no_go',
      repCount: reps.length,
      summary: {
        reps: reps.length,
        correct,
        falseStarts: fs,
        lateMisses,
        hesitations: hes,
        score: reps.reduce((a, r) => a + r.score, 0) + (scoreWeights ?? 0),
        avgReactionMs: avg,
      },
    },
    reps,
  }
}

// ----- sessionTrend -----

describe('sessionTrend', () => {
  it('returns one trend point per session ordered by startedAt ascending', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 300, true),
      rep('A', 'steps_in', 'correct_go', 400, true),
      rep('A', 'no_go_bait', 'correct_no_go', null, false),
    ])
    const b = session('B', 2000, [
      rep('B', 'steps_in', 'hesitation', 500, true),
      rep('B', 'steps_in', 'false_start', null, true),
    ])
    const map = new Map([
      [a.rec.id, a.reps],
      [b.rec.id, b.reps],
    ])
    // Pass sessions in reverse order — helper should sort ascending.
    const trend = sessionTrend([b.rec, a.rec], map)
    expect(trend.map((t) => t.sessionId)).toEqual(['A', 'B'])
    expect(trend[0].avgRtMs).toBe(350)
    expect(trend[0].best10AvgRtMs).toBe(350)
    expect(trend[0].falseStartRate).toBe(0)
    expect(trend[0].hesitationRate).toBe(0)
    expect(trend[1].falseStartRate).toBeCloseTo(0.5, 5)
    expect(trend[1].hesitationRate).toBeCloseTo(0.5, 5)
    expect(trend[1].avgRtMs).toBeNull()
  })

  it('filters out sessions with zero reps from the trend', () => {
    const empty = session('E', 1000, [])
    const real = session('R', 2000, [
      rep('R', 'steps_in', 'correct_go', 250, true),
    ])
    const map = new Map([
      [empty.rec.id, empty.reps],
      [real.rec.id, real.reps],
    ])
    const trend = sessionTrend([empty.rec, real.rec], map)
    expect(trend.map((t) => t.sessionId)).toEqual(['R'])
  })
})

// ----- cueTrend -----

describe('cueTrend', () => {
  it('produces one row per (session, observed cue) pair with error rate and avg RT', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 300, true),
      rep('A', 'steps_in', 'correct_go', 400, true),
      rep('A', 'steps_in', 'hesitation', 700, true),
      rep('A', 'no_go_bait', 'correct_no_go', null, false),
    ])
    const map = new Map([[a.rec.id, a.reps]])
    const trend = cueTrend([a.rec], map)
    const steps = trend.find((r) => r.cueId === 'steps_in')
    const bait = trend.find((r) => r.cueId === 'no_go_bait')
    expect(steps?.reps).toBe(3)
    expect(steps?.avgRtMs).toBe(350)
    expect(steps?.errorRate).toBeCloseTo(1 / 3, 5)
    expect(bait?.errorRate).toBe(0)
    expect(bait?.avgRtMs).toBeNull()
  })
})

// ----- cueAggregate -----

describe('cueAggregate', () => {
  it('rolls up reps across sessions, counting distinct sessions per cue', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 300, true),
      rep('A', 'steps_in', 'correct_go', 400, true),
    ])
    const b = session('B', 2000, [
      rep('B', 'steps_in', 'correct_go', 500, true),
      rep('B', 'no_go_bait', 'false_start', null, false),
      rep('B', 'no_go_bait', 'correct_no_go', null, false),
    ])
    const map = new Map([
      [a.rec.id, a.reps],
      [b.rec.id, b.reps],
    ])
    const agg = cueAggregate([a.rec, b.rec], map)
    const steps = agg.find((r) => r.cueId === 'steps_in')
    const bait = agg.find((r) => r.cueId === 'no_go_bait')
    expect(steps?.reps).toBe(3)
    expect(steps?.sessions).toBe(2)
    expect(steps?.avgRtMs).toBe(400)
    expect(steps?.best10AvgRtMs).toBe(400)
    expect(steps?.goWeakness).not.toBeNull()
    expect(steps?.noGoWeakness).toBeNull()
    expect(bait?.reps).toBe(2)
    expect(bait?.sessions).toBe(1)
    expect(bait?.errorRate).toBe(0.5)
    expect(bait?.goWeakness).toBeNull()
    expect(bait?.noGoWeakness).toBe(0.5)
  })
})

// ----- pickTaperCues -----

describe('pickTaperCues', () => {
  it('returns the worst go cues and worst no-go cues with the default 70/30 split (k=3 → 2 go + 1 no-go)', () => {
    const sessions: SessionRecord[] = []
    const reps: RepRecord[] = []
    function addSession(id: string, startedAt: number, perCue: [CueId, number | null, boolean, RepResult][]) {
      const sReps: RepRecord[] = []
      for (const [cueId, rt, isGo, result] of perCue) {
        sReps.push(rep(id, cueId, result, rt, isGo))
      }
      sessions.push({
        id,
        startedAt,
        endedAt: startedAt + 60_000,
        drillType: 'first_beat_go_no_go',
        repCount: sReps.length,
        summary: {
          reps: sReps.length,
          correct: sReps.filter(
            (r) => r.result === 'correct_go' || r.result === 'correct_no_go',
          ).length,
          falseStarts: 0,
          lateMisses: 0,
          hesitations: 0,
          score: 0,
          avgReactionMs: null,
        },
      })
      reps.push(...sReps)
    }
    // Each cue must appear in ≥2 sessions with ≥5 total reps to be eligible.
    // steps_in: fast and clean (200ms avg) → should NOT be picked.
    // retreats: slow (500ms avg) — picked first from go pool.
    // freezes: medium (400ms avg) with errors — second pick from go pool.
    // drops_lead_hand: borderline (350ms, clean) — fills if go-pool empties.
    // no_go_bait: high false-start rate (0.4) — picked from no-go pool.
    // fake_steps: low false-start rate (0.1) — not picked.
    addSession('s1', 1000, [
      ['steps_in', 200, true, 'correct_go'],
      ['steps_in', 200, true, 'correct_go'],
      ['steps_in', 200, true, 'correct_go'],
      ['retreats', 500, true, 'correct_go'],
      ['retreats', 500, true, 'correct_go'],
      ['retreats', 500, true, 'correct_go'],
      ['freezes', 400, true, 'correct_go'],
      ['freezes', 400, true, 'correct_go'],
      ['freezes', null, true, 'late'],
      ['drops_lead_hand', 350, true, 'correct_go'],
      ['drops_lead_hand', 350, true, 'correct_go'],
      ['drops_lead_hand', 350, true, 'correct_go'],
      ['no_go_bait', null, false, 'false_start'],
      ['no_go_bait', null, false, 'false_start'],
      ['no_go_bait', null, false, 'correct_no_go'],
      ['no_go_bait', null, false, 'correct_no_go'],
      ['no_go_bait', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
    ])
    // Same shape in session 2 to satisfy ≥2 sessions per cue.
    addSession('s2', 2000, [
      ['steps_in', 200, true, 'correct_go'],
      ['steps_in', 200, true, 'correct_go'],
      ['steps_in', 200, true, 'correct_go'],
      ['retreats', 500, true, 'correct_go'],
      ['retreats', 500, true, 'correct_go'],
      ['freezes', 400, true, 'correct_go'],
      ['freezes', 400, true, 'correct_go'],
      ['drops_lead_hand', 350, true, 'correct_go'],
      ['drops_lead_hand', 350, true, 'correct_go'],
      ['no_go_bait', null, false, 'false_start'],
      ['no_go_bait', null, false, 'correct_no_go'],
      ['no_go_bait', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
      ['fake_steps', null, false, 'correct_no_go'],
    ])
    const map = new Map<string, RepRecord[]>()
    for (const r of reps) {
      const list = map.get(r.sessionId) ?? []
      list.push(r)
      map.set(r.sessionId, list)
    }
    const agg = cueAggregate(sessions, map)
    const rec = pickTaperCues(agg, 3)
    expect(rec.cueIds).toHaveLength(3)
    // top-2 weakest go cues by weakness desc:
    //   freezes  (0.4 RT + 1/5 errors = 0.6)
    //   retreats (0.5 RT + 0 errors  = 0.5)
    expect(rec.cueIds).toContain('freezes')
    expect(rec.cueIds).toContain('retreats')
    // top-1 weakest no-go cue: no_go_bait (errorRate 0.375 ≈ 3/8) > fake_steps (0)
    expect(rec.cueIds).toContain('no_go_bait')
    expect(rec.cueIds).not.toContain('fake_steps')
    expect(rec.cueIds).not.toContain('steps_in')
    expect(rec.reason).toMatch(/slowest|weakest/i)
  })

  it('drops cues with fewer than 5 reps across the window', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 500, true),
      rep('A', 'steps_in', 'correct_go', 500, true),
      rep('A', 'steps_in', 'correct_go', 500, true),
      rep('A', 'steps_in', 'correct_go', 500, true),
    ])
    const map = new Map([[a.rec.id, a.reps]])
    const agg = cueAggregate([a.rec], map)
    const rec = pickTaperCues(agg, 3)
    expect(rec.cueIds).toEqual([])
    expect(rec.reason).toMatch(/not enough data/i)
  })

  it('drops cues seen in fewer than 2 sessions', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 500, true),
      rep('A', 'steps_in', 'correct_go', 500, true),
      rep('A', 'steps_in', 'correct_go', 500, true),
      rep('A', 'steps_in', 'correct_go', 500, true),
      rep('A', 'steps_in', 'correct_go', 500, true),
    ])
    const map = new Map([[a.rec.id, a.reps]])
    const agg = cueAggregate([a.rec], map)
    const rec = pickTaperCues(agg, 3)
    expect(rec.cueIds).toEqual([])
  })

  it('falls back to the other pool when one pool is empty', () => {
    // All eligible cues are no-go — picker fills all 3 from no-go pool.
    const buildSession = (id: string, t: number) => {
      const sReps: RepRecord[] = []
      for (const cue of ['no_go_bait', 'fake_steps'] as CueId[]) {
        for (let i = 0; i < 5; i++) {
          sReps.push(rep(id, cue, 'false_start', null, false))
        }
      }
      return session(id, t, sReps)
    }
    const a = buildSession('A', 1000)
    const b = buildSession('B', 2000)
    const map = new Map([
      [a.rec.id, a.reps],
      [b.rec.id, b.reps],
    ])
    const agg = cueAggregate([a.rec, b.rec], map)
    const rec = pickTaperCues(agg, 3)
    expect(rec.cueIds).toContain('no_go_bait')
    expect(rec.cueIds).toContain('fake_steps')
    expect(rec.cueIds.length).toBeLessThanOrEqual(2) // only two no-go cues exist
  })

  it('ties on weakness break by cueId ascending for determinism', () => {
    // Two go cues with identical weakness — picker returns the one with the
    // lexicographically smaller cueId first.
    const buildSession = (id: string, t: number) => {
      const sReps: RepRecord[] = []
      for (const cue of ['retreats', 'freezes'] as CueId[]) {
        for (let i = 0; i < 5; i++) {
          sReps.push(rep(id, cue, 'correct_go', 400, true))
        }
      }
      return session(id, t, sReps)
    }
    const a = buildSession('A', 1000)
    const b = buildSession('B', 2000)
    const map = new Map([
      [a.rec.id, a.reps],
      [b.rec.id, b.reps],
    ])
    const agg = cueAggregate([a.rec, b.rec], map)
    const rec = pickTaperCues(agg, 1)
    expect(rec.cueIds).toEqual(['freezes'])
  })
})

// ----- compareSessions -----

describe('compareSessions', () => {
  it('classifies a cue measured in both sessions as both_measured with delta-RT', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 400, true),
      rep('A', 'steps_in', 'correct_go', 400, true),
    ])
    const b = session('B', 2000, [
      rep('B', 'steps_in', 'correct_go', 300, true),
      rep('B', 'steps_in', 'correct_go', 300, true),
    ])
    const delta = compareSessions(a.rec, b.rec, a.reps, b.reps)
    const row = delta.perCue.find((r) => r.cueId === 'steps_in')
    expect(row?.classification).toBe('both_measured')
    expect(row?.deltaAvgRtMs).toBe(-100)
    expect(row?.deltaErrorRate).toBe(0)
  })

  it('flags both_error_only when one side has reps but zero correct_go', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 400, true),
      rep('A', 'steps_in', 'correct_go', 400, true),
    ])
    const b = session('B', 2000, [
      rep('B', 'steps_in', 'false_start', null, true),
      rep('B', 'steps_in', 'late', null, true),
    ])
    const delta = compareSessions(a.rec, b.rec, a.reps, b.reps)
    const row = delta.perCue.find((r) => r.cueId === 'steps_in')
    expect(row?.classification).toBe('both_error_only')
    expect(row?.deltaAvgRtMs).toBeNull()
    expect(row?.deltaErrorRate).toBe(1) // 1.0 errors - 0 errors
  })

  it('marks cues present only in candidate as candidate_only', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 300, true),
    ])
    const b = session('B', 2000, [
      rep('B', 'steps_in', 'correct_go', 300, true),
      rep('B', 'retreats', 'correct_go', 500, true),
    ])
    const delta = compareSessions(a.rec, b.rec, a.reps, b.reps)
    const row = delta.perCue.find((r) => r.cueId === 'retreats')
    expect(row?.classification).toBe('candidate_only')
  })

  it('marks cues present only in baseline as baseline_only', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 300, true),
      rep('A', 'retreats', 'correct_go', 500, true),
    ])
    const b = session('B', 2000, [
      rep('B', 'steps_in', 'correct_go', 300, true),
    ])
    const delta = compareSessions(a.rec, b.rec, a.reps, b.reps)
    const row = delta.perCue.find((r) => r.cueId === 'retreats')
    expect(row?.classification).toBe('baseline_only')
  })

  it('suppresses deltaScore (returns null) when the two summary scoreWeights differ', () => {
    // Forge two sessions whose per-rep `score` was computed under different
    // weights: A's correct_go = +1, B's correct_go = +2.
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 300, true, 1),
      rep('A', 'steps_in', 'correct_go', 300, true, 1),
    ])
    const b = session('B', 2000, [
      rep('B', 'steps_in', 'correct_go', 300, true, 2),
      rep('B', 'steps_in', 'correct_go', 300, true, 2),
    ])
    const delta = compareSessions(a.rec, b.rec, a.reps, b.reps)
    expect(delta.weightsDiffer).toBe(true)
    expect(delta.deltaScore).toBeNull()
  })
})

describe('buildTaperProfileBlueprint', () => {
  it('assembles a 3 × 60s / 30s config with the picked allowedCueIds', () => {
    // Reuse the same fixture pattern as pickTaperCues — two sessions, four
    // cues, eligibility met.
    const sessions: SessionRecord[] = []
    const reps: RepRecord[] = []
    function add(id: string, t: number, perCue: [CueId, number | null, boolean, RepResult][]) {
      const sReps: RepRecord[] = []
      for (const [cueId, rt, isGo, result] of perCue) {
        sReps.push(rep(id, cueId, result, rt, isGo))
      }
      sessions.push({
        id,
        startedAt: t,
        endedAt: t + 60_000,
        drillType: 'first_beat_go_no_go',
        repCount: sReps.length,
        summary: {
          reps: sReps.length,
          correct: 0,
          falseStarts: 0,
          lateMisses: 0,
          hesitations: 0,
          score: 0,
          avgReactionMs: null,
        },
      })
      reps.push(...sReps)
    }
    const slow: [CueId, number | null, boolean, RepResult][] = []
    for (let i = 0; i < 5; i++) slow.push(['retreats', 500, true, 'correct_go'])
    for (let i = 0; i < 5; i++) slow.push(['steps_in', 200, true, 'correct_go'])
    add('s1', 1000, slow)
    add('s2', 2000, slow)
    const map = new Map<string, RepRecord[]>()
    for (const r of reps) {
      const list = map.get(r.sessionId) ?? []
      list.push(r)
      map.set(r.sessionId, list)
    }
    const baseConfig = {
      ...DEFAULT_DRILL_CONFIG,
      hesitationThresholdMs: 400, // user customization carries forward
    }
    const blueprint = buildTaperProfileBlueprint(sessions, map, baseConfig, 1)
    expect(blueprint).not.toBeNull()
    expect(blueprint?.config.rounds).toBe(3)
    expect(blueprint?.config.workMs).toBe(60_000)
    expect(blueprint?.config.restMs).toBe(30_000)
    expect(blueprint?.config.maxReps).toBeNull()
    expect(blueprint?.config.allowedCueIds).toEqual(['retreats'])
    expect(blueprint?.config.hesitationThresholdMs).toBe(400)
    expect(blueprint?.reason).toMatch(/retreats/)
  })

  it('blueprint: returns null when there is not enough data', () => {
    const a = session('A', 1000, [
      rep('A', 'steps_in', 'correct_go', 500, true),
    ])
    const map = new Map([[a.rec.id, a.reps]])
    expect(buildTaperProfileBlueprint([a.rec], map)).toBeNull()
  })
})
