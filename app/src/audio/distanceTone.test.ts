import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDistanceTone, stopDistanceTone } from './distanceTone'

interface WindowAudio {
  AudioContext?: unknown
  webkitAudioContext?: unknown
}

const originalAC = (window as unknown as WindowAudio).AudioContext
const originalWebkitAC = (window as unknown as WindowAudio).webkitAudioContext

afterEach(() => {
  ;(window as unknown as WindowAudio).AudioContext = originalAC
  ;(window as unknown as WindowAudio).webkitAudioContext = originalWebkitAC
  stopDistanceTone()
})

describe('distanceTone graceful degradation', () => {
  it('start + stop are no-ops when AudioContext is unavailable', () => {
    ;(window as unknown as WindowAudio).AudioContext = undefined
    ;(window as unknown as WindowAudio).webkitAudioContext = undefined
    expect(() => startDistanceTone('mid')).not.toThrow()
    expect(() => stopDistanceTone()).not.toThrow()
  })

  it('start + stop are safe when AudioContext throws on construction', () => {
    const Ctor = vi.fn(() => {
      throw new Error('not allowed')
    })
    ;(window as unknown as WindowAudio).AudioContext = Ctor
    expect(() => startDistanceTone('far')).not.toThrow()
    expect(() => stopDistanceTone()).not.toThrow()
  })
})
