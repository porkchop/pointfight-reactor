import { describe, expect, it } from 'vitest'
import {
  classifyPreCuePress,
  classifyRep,
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

const goCue = {
  id: 'steps_in' as const,
  label: 'STEPS IN',
  description: 'go cue under test',
  isGo: true,
  expectedResponse: 'blitz' as const,
}

const noGoCue = {
  id: 'fake_steps' as const,
  label: 'FAKE',
  description: 'no-go cue under test',
  isGo: false,
  expectedResponse: 'do_nothing' as const,
}

const config = DEFAULT_DRILL_CONFIG

describe('classifyRep', () => {
  it('press before cue is a false start regardless of cue type', () => {
    expect(
      classifyRep({
        isGo: goCue.isGo,
        cueShownAt: 1000,
        pressedAt: 900,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
      }),
    ).toEqual({ result: 'false_start', reactionMs: null, score: -1 })

    expect(
      classifyRep({
        isGo: noGoCue.isGo,
        cueShownAt: 1000,
        pressedAt: 900,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
      }),
    ).toEqual({ result: 'false_start', reactionMs: null, score: -1 })
  })

  it('fast press on a go cue is correct_go with reaction time', () => {
    const out = classifyRep({
      isGo: goCue.isGo,
      cueShownAt: 1000,
      pressedAt: 1280,
      responseWindowMs: config.responseWindowMs,
      hesitationThresholdMs: config.hesitationThresholdMs,
    })
    expect(out.result).toBe('correct_go')
    expect(out.reactionMs).toBe(280)
    expect(out.score).toBe(1)
  })

  it('slow but in-window press on a go cue is hesitation', () => {
    const out = classifyRep({
      isGo: goCue.isGo,
      cueShownAt: 1000,
      pressedAt: 1000 + config.hesitationThresholdMs + 50,
      responseWindowMs: config.responseWindowMs,
      hesitationThresholdMs: config.hesitationThresholdMs,
    })
    expect(out.result).toBe('hesitation')
    expect(out.reactionMs).toBe(config.hesitationThresholdMs + 50)
    expect(out.score).toBe(-2)
  })

  it('press exactly at hesitation threshold is hesitation (boundary)', () => {
    const out = classifyRep({
      isGo: goCue.isGo,
      cueShownAt: 0,
      pressedAt: config.hesitationThresholdMs,
      responseWindowMs: config.responseWindowMs,
      hesitationThresholdMs: config.hesitationThresholdMs,
    })
    expect(out.result).toBe('hesitation')
  })

  it('no press on a go cue is late', () => {
    expect(
      classifyRep({
        isGo: goCue.isGo,
        cueShownAt: 1000,
        pressedAt: null,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
      }),
    ).toEqual({ result: 'late', reactionMs: null, score: 0 })
  })

  it('press exactly at the response window boundary still counts (go cue)', () => {
    const out = classifyRep({
      isGo: goCue.isGo,
      cueShownAt: 0,
      pressedAt: config.responseWindowMs,
      responseWindowMs: config.responseWindowMs,
      hesitationThresholdMs: config.hesitationThresholdMs,
    })
    expect(out.result).toBe('hesitation')
    expect(out.reactionMs).toBe(config.responseWindowMs)
  })

  it('press past the response window on a go cue is late', () => {
    const out = classifyRep({
      isGo: goCue.isGo,
      cueShownAt: 0,
      pressedAt: config.responseWindowMs + 100,
      responseWindowMs: config.responseWindowMs,
      hesitationThresholdMs: config.hesitationThresholdMs,
    })
    expect(out.result).toBe('late')
    expect(out.reactionMs).toBeNull()
  })

  it('press on a no-go cue inside the window is a false start', () => {
    const out = classifyRep({
      isGo: noGoCue.isGo,
      cueShownAt: 1000,
      pressedAt: 1300,
      responseWindowMs: config.responseWindowMs,
      hesitationThresholdMs: config.hesitationThresholdMs,
    })
    expect(out.result).toBe('false_start')
    expect(out.reactionMs).toBe(300)
    expect(out.score).toBe(-1)
  })

  it('no press on a no-go cue is correct_no_go', () => {
    expect(
      classifyRep({
        isGo: noGoCue.isGo,
        cueShownAt: 1000,
        pressedAt: null,
        responseWindowMs: config.responseWindowMs,
        hesitationThresholdMs: config.hesitationThresholdMs,
      }),
    ).toEqual({ result: 'correct_no_go', reactionMs: null, score: 1 })
  })
})

describe('classifyPreCuePress', () => {
  it('always returns false_start with no reaction time', () => {
    expect(classifyPreCuePress()).toEqual({
      result: 'false_start',
      reactionMs: null,
      score: -1,
    })
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
