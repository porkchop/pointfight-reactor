import type { CueId } from '../engine/types'
import {
  BlitzesPictograph,
  DropsHandPictograph,
  FakeStepsPictograph,
  FreezesPictograph,
  LiftsLegPictograph,
  NoGoBaitPictograph,
  RetreatsPictograph,
  StepsInPictograph,
  type PictographProps,
} from './pictographs'

export interface PaletteEntry {
  id: CueId
  Pictograph: (props: PictographProps) => React.ReactElement
  accentClass: string
  animationClass: string
}

export const CUE_PALETTE: Record<CueId, PaletteEntry> = {
  steps_in: {
    id: 'steps_in',
    Pictograph: StepsInPictograph,
    accentClass: 'accent-accent',
    animationClass: 'anim-step-in',
  },
  blitzes: {
    id: 'blitzes',
    Pictograph: BlitzesPictograph,
    accentClass: 'accent-danger',
    animationClass: 'anim-blitz',
  },
  lifts_lead_leg: {
    id: 'lifts_lead_leg',
    Pictograph: LiftsLegPictograph,
    accentClass: 'accent-warn',
    animationClass: 'anim-leg-lift',
  },
  drops_lead_hand: {
    id: 'drops_lead_hand',
    Pictograph: DropsHandPictograph,
    accentClass: 'accent-accent',
    animationClass: 'anim-hand-drop',
  },
  retreats: {
    id: 'retreats',
    Pictograph: RetreatsPictograph,
    accentClass: 'accent-accent',
    animationClass: 'anim-retreat',
  },
  freezes: {
    id: 'freezes',
    Pictograph: FreezesPictograph,
    accentClass: 'accent-warn',
    animationClass: 'anim-freeze',
  },
  fake_steps: {
    id: 'fake_steps',
    Pictograph: FakeStepsPictograph,
    accentClass: 'accent-danger',
    animationClass: 'anim-fake-step',
  },
  no_go_bait: {
    id: 'no_go_bait',
    Pictograph: NoGoBaitPictograph,
    accentClass: 'accent-danger',
    animationClass: 'anim-bait',
  },
}
