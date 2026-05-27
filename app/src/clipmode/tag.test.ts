import { describe, expect, it } from 'vitest'
import { FRAME_STEP_MS, clampCueAtMs, stepFrame } from './tag'

describe('FRAME_STEP_MS', () => {
  it('is 1/30 of a second', () => {
    expect(FRAME_STEP_MS).toBeCloseTo(33.333, 2)
  })
})

describe('stepFrame', () => {
  it('advances by one frame on delta=+1', () => {
    expect(stepFrame(1000, 1, 5000)).toBe(Math.round(1000 + FRAME_STEP_MS))
  })

  it('retreats by one frame on delta=-1', () => {
    expect(stepFrame(1000, -1, 5000)).toBe(Math.round(1000 - FRAME_STEP_MS))
  })

  it('clamps to 0 when stepping below zero', () => {
    expect(stepFrame(10, -5, 5000)).toBe(0)
  })

  it('clamps to durationMs when stepping past the end', () => {
    expect(stepFrame(4990, 5, 5000)).toBe(5000)
  })

  it('treats a zero-duration clip as a single position at 0', () => {
    expect(stepFrame(0, 1, 0)).toBe(0)
    expect(stepFrame(0, -1, 0)).toBe(0)
  })

  it('returns 0 when both currentMs and durationMs are 0', () => {
    expect(stepFrame(0, 0, 0)).toBe(0)
  })
})

describe('clampCueAtMs', () => {
  it('returns the input rounded when in-range', () => {
    expect(clampCueAtMs(1234.4, 5000)).toBe(1234)
    expect(clampCueAtMs(1234.6, 5000)).toBe(1235)
  })
  it('clamps negative input to 0', () => {
    expect(clampCueAtMs(-50, 5000)).toBe(0)
  })
  it('clamps above-duration input to durationMs', () => {
    expect(clampCueAtMs(9999, 5000)).toBe(5000)
  })
  it('returns 0 for NaN / Infinity (e.g. uninitialized <video>.currentTime)', () => {
    expect(clampCueAtMs(NaN, 5000)).toBe(0)
    expect(clampCueAtMs(Infinity, 5000)).toBe(0)
    expect(clampCueAtMs(-Infinity, 5000)).toBe(0)
  })
})
