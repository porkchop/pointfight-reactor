import type { CueDef } from '../engine/types'

export const CUE_LIBRARY: readonly CueDef[] = Object.freeze([
  {
    id: 'steps_in',
    label: 'STEPS IN',
    description: 'Opponent closes distance with a deliberate step',
    isGo: true,
    expectedResponse: 'blitz',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: true, expectedResponse: 'blitz' },
      in_range: { isGo: true, expectedResponse: 'stop_kick' },
    },
  },
  {
    id: 'blitzes',
    label: 'BLITZES',
    description: 'Opponent launches a full-commit blitz',
    isGo: true,
    expectedResponse: 'jam_entry',
    byDistance: {
      far: { isGo: true, expectedResponse: 'jam_entry' },
      mid: { isGo: true, expectedResponse: 'jam_entry' },
      in_range: { isGo: true, expectedResponse: 'stop_kick' },
    },
  },
  {
    id: 'lifts_lead_leg',
    label: 'LIFTS LEAD LEG',
    description: 'Opponent loads the front leg — kick incoming',
    isGo: true,
    expectedResponse: 'stop_kick',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: true, expectedResponse: 'stop_kick' },
      in_range: { isGo: true, expectedResponse: 'stop_kick' },
    },
  },
  {
    id: 'drops_lead_hand',
    label: 'DROPS LEAD HAND',
    description: 'Opponent drops the lead hand — opening',
    isGo: true,
    expectedResponse: 'blitz',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: true, expectedResponse: 'blitz' },
      in_range: { isGo: true, expectedResponse: 'jam_entry' },
    },
  },
  {
    id: 'retreats',
    label: 'RETREATS',
    description: 'Opponent backs out — chase the gap',
    isGo: true,
    expectedResponse: 'blitz',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: true, expectedResponse: 'blitz' },
      in_range: { isGo: true, expectedResponse: 'blitz' },
    },
  },
  {
    id: 'freezes',
    label: 'FREEZES',
    description: 'Opponent stops moving — break their rhythm',
    isGo: true,
    expectedResponse: 'angle_counter',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: true, expectedResponse: 'angle_counter' },
      in_range: { isGo: true, expectedResponse: 'angle_counter' },
    },
  },
  {
    id: 'fake_steps',
    label: 'FAKE STEP',
    description: 'Half-step bait — do NOT commit',
    isGo: false,
    expectedResponse: 'do_nothing',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: false, expectedResponse: 'do_nothing' },
      in_range: { isGo: false, expectedResponse: 'do_nothing' },
    },
  },
  {
    id: 'no_go_bait',
    label: 'BAIT',
    description: 'Obvious bait — hold position',
    isGo: false,
    expectedResponse: 'do_nothing',
    byDistance: {
      far: { isGo: false, expectedResponse: 'do_nothing' },
      mid: { isGo: false, expectedResponse: 'do_nothing' },
      in_range: { isGo: false, expectedResponse: 'do_nothing' },
    },
  },
])

export const GO_CUES = CUE_LIBRARY.filter((c) => c.isGo)
export const NO_GO_CUES = CUE_LIBRARY.filter((c) => !c.isGo)
