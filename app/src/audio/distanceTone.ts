import type { Distance } from '../engine/types'

const DISTANCE_HZ: Record<Distance, number> = {
  far: 220,
  mid: 440,
  in_range: 660,
}

let ctx: AudioContext | null = null
let osc: OscillatorNode | null = null
let gain: GainNode | null = null

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  const W = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const Ctor = W.AudioContext ?? W.webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

export function startDistanceTone(distance: Distance): void {
  const c = ensureContext()
  if (!c) return
  stopDistanceTone()
  try {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.value = DISTANCE_HZ[distance]
    g.gain.value = 0
    o.connect(g).connect(c.destination)
    const t0 = c.currentTime
    g.gain.linearRampToValueAtTime(0.06, t0 + 0.03)
    o.start()
    osc = o
    gain = g
  } catch {
    osc = null
    gain = null
  }
}

export function stopDistanceTone(): void {
  if (!ctx || !osc || !gain) {
    osc = null
    gain = null
    return
  }
  try {
    const t0 = ctx.currentTime
    gain.gain.cancelScheduledValues(t0)
    gain.gain.setValueAtTime(gain.gain.value, t0)
    gain.gain.linearRampToValueAtTime(0, t0 + 0.03)
    osc.stop(t0 + 0.04)
  } catch {
    /* ignore */
  }
  osc = null
  gain = null
}
