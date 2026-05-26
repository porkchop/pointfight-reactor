import { describe, expect, it } from 'vitest'
import {
  antiRhythmSignal,
  best10AvgOf,
  classifyPreCuePress,
  classifyRep,
  cueBreakdown,
  pendingPenalties,
  pickDistance,
  pickNextCue,
  pickPreCueDelayMs,
  resolveCueAtDistance,
  summarize,
  validateDrillConfig,
} from './drill'
import { mulberry32 } from './rng'
import {
  DEFAULT_DRILL_CONFIG,
  DISTANCES,
  type CueDef,
  type RepRecord,
} from './types'

const config = DEFAULT_DRILL_CONFIG

const cls = (input: {
  isGo: boolean
  cueShownAt: number
  pressedAt: number | null
}) =>
  ({
    ...input,
    responseWindowMs: config.responseWindowMs,
    hesitationThresholdMs: config.hesitationThresholdMs,
    lateThresholdMs: config.lateThresholdMs,
    scoreWeights: config.scoreWeights,
  })

describe('classifyRep', () => {
  it('press before cue is a false start regardless of cue type', () => {
    expect(
      classifyRep(cls({ isGo: true, cueShownAt: 1000, pressedAt: 900 })),
    ).toEqual({ result: 'false_start', reactionMs: null, score: -1 })

    expect(
      classifyRep(cls({ isGo: false, cueShownAt: 1000, pressedAt: 900 })),
    ).toEqual({ result: 'false_start', reactionMs: null, score: -1 })
  })

  it('fast press on a go cue is correct_go with reaction time', () => {
    const out = classifyRep(
      cls({ isGo: true, cueShownAt: 1000, pressedAt: 1280 }),
    )
    expect(out.result).toBe('correct_go')
    expect(out.reactionMs).toBe(280)
    expect(out.score).toBe(1)
  })

  it('slow but in-band press on a go cue is hesitation', () => {
    const out = classifyRep(
      cls({
        isGo: true,
        cueShownAt: 1000,
        pressedAt: 1000 + config.hesitationThresholdMs + 50,
      }),
    )
    expect(out.result).toBe('hesitation')
    expect(out.reactionMs).toBe(config.hesitationThresholdMs + 50)
    expect(out.score).toBe(-2)
  })

  it('press exactly at hesitation threshold is hesitation (lower boundary)', () => {
    const out = classifyRep(
      cls({
        isGo: true,
        cueShownAt: 0,
        pressedAt: config.hesitationThresholdMs,
      }),
    )
    expect(out.result).toBe('hesitation')
  })

  it('press just under the late threshold is still hesitation', () => {
    const out = classifyRep(
      cls({
        isGo: true,
        cueShownAt: 0,
        pressedAt: config.lateThresholdMs - 1,
      }),
    )
    expect(out.result).toBe('hesitation')
  })

  it('press at the late threshold is late', () => {
    const out = classifyRep(
      cls({ isGo: true, cueShownAt: 0, pressedAt: config.lateThresholdMs }),
    )
    expect(out.result).toBe('late')
    expect(out.reactionMs).toBe(config.lateThresholdMs)
  })

  it('no press on a go cue is late', () => {
    expect(
      classifyRep(cls({ isGo: true, cueShownAt: 1000, pressedAt: null })),
    ).toEqual({ result: 'late', reactionMs: null, score: 0 })
  })

  it('press past the response window on a go cue is late (no rt)', () => {
    const out = classifyRep(
      cls({
        isGo: true,
        cueShownAt: 0,
        pressedAt: config.responseWindowMs + 100,
      }),
    )
    expect(out.result).toBe('late')
    expect(out.reactionMs).toBeNull()
  })

  it('press on a no-go cue inside the window is a false start', () => {
    const out = classifyRep(
      cls({ isGo: false, cueShownAt: 1000, pressedAt: 1300 }),
    )
    expect(out.result).toBe('false_start')
    expect(out.reactionMs).toBe(300)
    expect(out.score).toBe(-1)
  })

  it('no press on a no-go cue is correct_no_go', () => {
    expect(
      classifyRep(cls({ isGo: false, cueShownAt: 1000, pressedAt: null })),
    ).toEqual({ result: 'correct_no_go', reactionMs: null, score: 1 })
  })

  it('uses configured scoreWeights when scoring the rep', () => {
    const customWeights = {
      ...config.scoreWeights,
      correct_go: 5,
      hesitation: -10,
    }
    const out = classifyRep({
      ...cls({ isGo: true, cueShownAt: 0, pressedAt: 200 }),
      scoreWeights: customWeights,
    })
    expect(out.score).toBe(5)
    const slow = classifyRep({
      ...cls({ isGo: true, cueShownAt: 0, pressedAt: 500 }),
      scoreWeights: customWeights,
    })
    expect(slow.score).toBe(-10)
  })
})

describe('classifyPreCuePress', () => {
  it('returns false_start using configured weights', () => {
    expect(classifyPreCuePress(config.scoreWeights)).toEqual({
      result: 'false_start',
      reactionMs: null,
      score: -1,
    })
    expect(classifyPreCuePress({ ...config.scoreWeights, false_start: -3 }))
      .toEqual({ result: 'false_start', reactionMs: null, score: -3 })
  })
})

describe('pickPreCueDelayMs', () => {
  it('produces a value within [min, max] inclusive', () => {
    const rng = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = pickPreCueDelayMs(rng, config)
      expect(v).toBeGreaterThanOrEqual(config.preCueMinMs)
      expect(v).toBeLessThanOrEqual(config.preCueMaxMs)
    }
  })

  it('is deterministic for a seeded rng', () => {
    const a = pickPreCueDelayMs(mulberry32(7), config)
    const b = pickPreCueDelayMs(mulberry32(7), config)
    expect(a).toBe(b)
  })
})

describe('pickNextCue', () => {
  it('respects goCueProbability roughly across many draws', () => {
    const rng = mulberry32(99)
    let goes = 0
    const n = 2000
    for (let i = 0; i < n; i++) {
      if (pickNextCue(rng, { ...config, goCueProbability: 0.7 }).isGo) goes++
    }
    const ratio = goes / n
    expect(ratio).toBeGreaterThan(0.65)
    expect(ratio).toBeLessThan(0.75)
  })

  it('returns only go cues when probability is 1', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 50; i++) {
      expect(pickNextCue(rng, { ...config, goCueProbability: 1 }).isGo).toBe(
        true,
      )
    }
  })

  it('returns only no-go cues when probability is 0', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 50; i++) {
      expect(pickNextCue(rng, { ...config, goCueProbability: 0 }).isGo).toBe(
        false,
      )
    }
  })
})

describe('summarize', () => {
  const makeRep = (
    result: RepRecord['result'],
    reactionMs: number | null,
    score: number,
  ): RepRecord => ({
    id: 'r' + Math.random(),
    sessionId: 's',
    cueId: 'steps_in',
    isGo: result === 'correct_go' || result === 'late' || result === 'hesitation',
    result,
    reactionMs,
    score,
    cueShownAt: 0,
    pressedAt: reactionMs,
    roundIndex: 0,
    inputSource: 'keyboard',
  })

  it('aggregates rep counts and average reaction time', () => {
    const reps: RepRecord[] = [
      makeRep('correct_go', 200, 1),
      makeRep('correct_go', 300, 1),
      makeRep('correct_no_go', null, 1),
      makeRep('hesitation', 600, -2),
      makeRep('false_start', null, -1),
      makeRep('late', null, 0),
    ]
    const s = summarize(reps)
    expect(s.reps).toBe(6)
    expect(s.correct).toBe(3)
    expect(s.falseStarts).toBe(1)
    expect(s.lateMisses).toBe(1)
    expect(s.hesitations).toBe(1)
    expect(s.score).toBe(0)
    expect(s.avgReactionMs).toBe(250)
  })

  it('returns null avgReactionMs when no correct_go reps exist', () => {
    expect(summarize([]).avgReactionMs).toBeNull()
    expect(
      summarize([makeRep('correct_no_go', null, 1)]).avgReactionMs,
    ).toBeNull()
  })
})

describe('validateDrillConfig', () => {
  it('accepts the default config', () => {
    expect(validateDrillConfig(DEFAULT_DRILL_CONFIG)).toEqual([])
  })

  it('rejects preCueMinMs below the floor', () => {
    const errs = validateDrillConfig({
      ...DEFAULT_DRILL_CONFIG,
      preCueMinMs: 100,
    })
    expect(errs.map((e) => e.field)).toContain('preCueMinMs')
  })

  it('rejects preCueMaxMs above the 8s ceiling', () => {
    const errs = validateDrillConfig({
      ...DEFAULT_DRILL_CONFIG,
      preCueMaxMs: 9000,
    })
    expect(errs.map((e) => e.field)).toContain('preCueMaxMs')
  })

  it('accepts preCueMaxMs at the 8s ceiling', () => {
    expect(
      validateDrillConfig({ ...DEFAULT_DRILL_CONFIG, preCueMaxMs: 8000 }),
    ).toEqual([])
  })

  it('rejects min > max', () => {
    const errs = validateDrillConfig({
      ...DEFAULT_DRILL_CONFIG,
      preCueMinMs: 5000,
      preCueMaxMs: 2000,
    })
    expect(errs.map((e) => e.field)).toContain('preCueMaxMs')
  })

  it('rejects zero rounds', () => {
    const errs = validateDrillConfig({ ...DEFAULT_DRILL_CONFIG, rounds: 0 })
    expect(errs.map((e) => e.field)).toContain('rounds')
  })

  it('rejects sub-1s work duration', () => {
    const errs = validateDrillConfig({ ...DEFAULT_DRILL_CONFIG, workMs: 500 })
    expect(errs.map((e) => e.field)).toContain('workMs')
  })

  it('rejects negative rest duration', () => {
    const errs = validateDrillConfig({ ...DEFAULT_DRILL_CONFIG, restMs: -1 })
    expect(errs.map((e) => e.field)).toContain('restMs')
  })
})

describe('pickDistance', () => {
  it('returns one of the three distances', () => {
    const rng = mulberry32(1)
    for (let i = 0; i < 50; i++) {
      const d = pickDistance(rng)
      expect(DISTANCES).toContain(d)
    }
  })

  it('approximates a uniform distribution over many draws', () => {
    const rng = mulberry32(7)
    const counts: Record<string, number> = { far: 0, mid: 0, in_range: 0 }
    const n = 3000
    for (let i = 0; i < n; i++) {
      counts[pickDistance(rng)]++
    }
    for (const d of DISTANCES) {
      const ratio = counts[d] / n
      expect(ratio).toBeGreaterThan(0.27)
      expect(ratio).toBeLessThan(0.39)
    }
  })
})

describe('resolveCueAtDistance', () => {
  const baseCue: CueDef = {
    id: 'steps_in',
    label: 'STEPS IN',
    description: 'test',
    isGo: true,
    expectedResponse: 'blitz',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: true, expectedResponse: 'blitz' },
      in_range: { isGo: true, expectedResponse: 'stop_kick' },
    },
  }
  const flatCue: CueDef = {
    id: 'freezes',
    label: 'FREEZES',
    description: 'test',
    isGo: true,
    expectedResponse: 'angle_counter',
  }

  it('returns the by-distance entry when distance + table both present', () => {
    expect(resolveCueAtDistance(baseCue, 'far')).toEqual({
      isGo: false,
      expectedResponse: 'do_nothing',
    })
    expect(resolveCueAtDistance(baseCue, 'in_range')).toEqual({
      isGo: true,
      expectedResponse: 'stop_kick',
    })
  })

  it('falls back to base when distance is null (axis disabled)', () => {
    expect(resolveCueAtDistance(baseCue, null)).toEqual({
      isGo: true,
      expectedResponse: 'blitz',
    })
  })

  it('falls back to base when cue has no distance table', () => {
    expect(resolveCueAtDistance(flatCue, 'far')).toEqual({
      isGo: true,
      expectedResponse: 'angle_counter',
    })
  })
})

describe('pickNextCue with distance axis', () => {
  it('selects from the full library uniformly when distance axis is enabled', () => {
    const rng = mulberry32(42)
    const ids = new Set<string>()
    for (let i = 0; i < 200; i++) {
      ids.add(
        pickNextCue(rng, { ...DEFAULT_DRILL_CONFIG, distanceAxisEnabled: true })
          .id,
      )
    }
    // Should see all 8 cues across 200 draws.
    expect(ids.size).toBe(8)
  })

  it('ignores goCueProbability when distance axis is enabled (still produces no-go cues even with prob=1)', () => {
    const rng = mulberry32(11)
    let noGoSeen = 0
    for (let i = 0; i < 200; i++) {
      const cue = pickNextCue(rng, {
        ...DEFAULT_DRILL_CONFIG,
        distanceAxisEnabled: true,
        goCueProbability: 1,
      })
      if (!cue.isGo) noGoSeen++
    }
    expect(noGoSeen).toBeGreaterThan(20)
  })
})

describe('pickNextCue with allowedCueIds subset', () => {
  it('only returns cues in the subset', () => {
    const rng = mulberry32(8)
    for (let i = 0; i < 50; i++) {
      const cue = pickNextCue(rng, {
        ...DEFAULT_DRILL_CONFIG,
        allowedCueIds: ['steps_in', 'fake_steps'],
        goCueProbability: 0.5,
      })
      expect(['steps_in', 'fake_steps']).toContain(cue.id)
    }
  })

  it('falls back to the available pool when the configured prob has no candidates', () => {
    const rng = mulberry32(8)
    // only no-go cue in the subset; goCueProbability=1 would normally pick from GO_CUES
    for (let i = 0; i < 20; i++) {
      const cue = pickNextCue(rng, {
        ...DEFAULT_DRILL_CONFIG,
        allowedCueIds: ['fake_steps'],
        goCueProbability: 1,
      })
      expect(cue.id).toBe('fake_steps')
    }
  })
})

describe('validateDrillConfig late threshold + cue subset', () => {
  it('rejects hesitation threshold above late threshold', () => {
    const errs = validateDrillConfig({
      ...DEFAULT_DRILL_CONFIG,
      hesitationThresholdMs: 800,
      lateThresholdMs: 600,
    })
    expect(errs.map((e) => e.field)).toContain('lateThresholdMs')
  })

  it('rejects late threshold above response window', () => {
    const errs = validateDrillConfig({
      ...DEFAULT_DRILL_CONFIG,
      lateThresholdMs: 1500,
      responseWindowMs: 1200,
    })
    expect(errs.map((e) => e.field)).toContain('responseWindowMs')
  })

  it('rejects empty allowedCueIds array', () => {
    const errs = validateDrillConfig({
      ...DEFAULT_DRILL_CONFIG,
      allowedCueIds: [],
    })
    expect(errs.map((e) => e.field)).toContain('allowedCueIds')
  })

  it('rejects allowedCueIds with no go cues when distance axis is off', () => {
    const errs = validateDrillConfig({
      ...DEFAULT_DRILL_CONFIG,
      allowedCueIds: ['fake_steps', 'no_go_bait'],
      distanceAxisEnabled: false,
    })
    expect(errs.map((e) => e.field)).toContain('allowedCueIds')
  })
})

describe('cueBreakdown', () => {
  const make = (
    cueId: CueDef['id'],
    result: RepRecord['result'],
    rt: number | null,
  ): RepRecord => ({
    id: `r-${Math.random()}`,
    sessionId: 's',
    cueId,
    isGo: result === 'correct_go' || result === 'late' || result === 'hesitation',
    result,
    reactionMs: rt,
    score: 0,
    cueShownAt: 0,
    pressedAt: rt,
    roundIndex: 0,
    inputSource: 'keyboard',
  })

  it('produces one row per cue id with correct counts and avg RT', () => {
    const reps = [
      make('steps_in', 'correct_go', 250),
      make('steps_in', 'correct_go', 350),
      make('steps_in', 'hesitation', 500),
      make('steps_in', 'false_start', null),
      make('fake_steps', 'correct_no_go', null),
      make('fake_steps', 'false_start', 200),
    ]
    const rows = cueBreakdown(reps)
    const steps = rows.find((r) => r.cueId === 'steps_in')
    const fake = rows.find((r) => r.cueId === 'fake_steps')
    expect(steps).toBeDefined()
    expect(fake).toBeDefined()
    expect(steps!.reps).toBe(4)
    expect(steps!.correct).toBe(2)
    expect(steps!.hesitations).toBe(1)
    expect(steps!.falseStarts).toBe(1)
    expect(steps!.avgRtMs).toBe(300)
    expect(fake!.reps).toBe(2)
    expect(fake!.correct).toBe(1)
    expect(fake!.falseStarts).toBe(1)
    expect(fake!.avgRtMs).toBeNull()
  })

  it('best10AvgRtMs averages the 10 fastest correct_go rts', () => {
    const reps: RepRecord[] = []
    for (let i = 1; i <= 15; i++) {
      reps.push(make('steps_in', 'correct_go', i * 30))
    }
    const row = cueBreakdown(reps).find((r) => r.cueId === 'steps_in')!
    // fastest 10 = 30, 60, 90, ..., 300 → mean = 165
    expect(row.best10AvgRtMs).toBe(165)
  })
})

describe('antiRhythmSignal', () => {
  const make = (
    cueId: CueDef['id'],
    isGo: boolean,
    result: RepRecord['result'],
  ): RepRecord => ({
    id: `r-${Math.random()}`,
    sessionId: 's',
    cueId,
    isGo,
    result,
    reactionMs: null,
    score: 0,
    cueShownAt: 0,
    pressedAt: null,
    roundIndex: 0,
    inputSource: 'keyboard',
  })

  it('returns no-pattern narrative for an empty or quiet stream', () => {
    expect(antiRhythmSignal([]).narrative).toBe('No rhythm pattern detected.')
    const calm = [
      make('steps_in', true, 'correct_go'),
      make('steps_in', true, 'correct_go'),
      make('steps_in', true, 'correct_go'),
    ]
    expect(antiRhythmSignal(calm).narrative).toBe('No rhythm pattern detected.')
  })

  it('buckets reps by the prior consecutive-go streak length', () => {
    // sequence: G, G, G, G(FS), N, G(FS), G, G, G(FS)
    const reps = [
      make('steps_in', true, 'correct_go'),       // streak before = 0
      make('steps_in', true, 'correct_go'),       // streak before = 1
      make('steps_in', true, 'correct_go'),       // streak before = 2
      make('steps_in', true, 'false_start'),      // streak before = 3+
      make('fake_steps', false, 'correct_no_go'), // resets streak
      make('steps_in', true, 'false_start'),      // streak before = 0
      make('steps_in', true, 'correct_go'),       // streak before = 1
      make('steps_in', true, 'correct_go'),       // streak before = 2
      make('steps_in', true, 'false_start'),      // streak before = 3+
    ]
    const stats = antiRhythmSignal(reps)
    expect(stats.buckets['0']).toEqual({ falseStarts: 1, total: 2 })
    expect(stats.buckets['1']).toEqual({ falseStarts: 0, total: 2 })
    expect(stats.buckets['2']).toEqual({ falseStarts: 0, total: 2 })
    expect(stats.buckets['3+']).toEqual({ falseStarts: 2, total: 2 })
  })

  it('emits a narrative when one bucket spikes above the global rate', () => {
    const reps: RepRecord[] = []
    // calm baseline: 9 go correct, then 3 in a row with one false_start
    for (let i = 0; i < 9; i++) reps.push(make('steps_in', true, 'correct_go'))
    reps.push(make('steps_in', true, 'false_start'))   // streak before = 9 → 3+
    // a non-go break + another 3 go runs ending in false_start
    reps.push(make('fake_steps', false, 'correct_no_go'))
    reps.push(make('steps_in', true, 'correct_go'))
    reps.push(make('steps_in', true, 'correct_go'))
    reps.push(make('steps_in', true, 'correct_go'))
    reps.push(make('steps_in', true, 'false_start'))   // streak before = 3 → 3+
    reps.push(make('fake_steps', false, 'correct_no_go'))
    reps.push(make('steps_in', true, 'correct_go'))
    reps.push(make('steps_in', true, 'correct_go'))
    reps.push(make('steps_in', true, 'correct_go'))
    reps.push(make('steps_in', true, 'false_start'))   // streak before = 3 → 3+
    const stats = antiRhythmSignal(reps)
    expect(stats.narrative).toMatch(/3\+ consecutive go cues/)
  })
})

describe('pendingPenalties', () => {
  const baseRep: Omit<RepRecord, 'result' | 'score'> = {
    id: 'x',
    sessionId: 's',
    cueId: 'steps_in',
    isGo: true,
    reactionMs: null,
    cueShownAt: 0,
    pressedAt: null,
    roundIndex: 0,
    inputSource: 'keyboard',
  }
  const rep = (result: RepRecord['result']): RepRecord => ({
    ...baseRep,
    result,
    score: 0,
  })

  it('returns 0 with no reps', () => {
    expect(pendingPenalties([], 1, 1, 0)).toBe(0)
  })

  it('counts false starts and hesitations with per-event weights', () => {
    const reps = [
      rep('false_start'),
      rep('false_start'),
      rep('hesitation'),
      rep('correct_go'),
      rep('late'),
      rep('correct_no_go'),
    ]
    expect(pendingPenalties(reps, 1, 1, 0)).toBe(3)
    expect(pendingPenalties(reps, 2, 1, 0)).toBe(5)
    expect(pendingPenalties(reps, 1, 3, 0)).toBe(5)
  })

  it('subtracts cleared and never returns below zero', () => {
    const reps = [rep('false_start'), rep('hesitation')]
    expect(pendingPenalties(reps, 1, 1, 1)).toBe(1)
    expect(pendingPenalties(reps, 1, 1, 5)).toBe(0)
  })
})

describe('best10AvgOf', () => {
  it('returns null for empty input', () => {
    expect(best10AvgOf([])).toBeNull()
  })

  it('returns the rounded mean when fewer than 10 values', () => {
    expect(best10AvgOf([200, 300, 400])).toBe(300)
  })

  it('averages only the 10 fastest when more than 10 values', () => {
    // 1..15 — fastest 10 are 1..10, mean = 5.5 → rounded 6
    const times = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    expect(best10AvgOf(times)).toBe(6)
  })

  it('does not mutate the input array', () => {
    const input = [400, 200, 300]
    const before = [...input]
    best10AvgOf(input)
    expect(input).toEqual(before)
  })
})
