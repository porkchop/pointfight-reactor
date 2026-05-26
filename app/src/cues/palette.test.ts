import { describe, expect, it } from 'vitest'
import { CUE_LIBRARY } from './library'
import { CUE_PALETTE } from './palette'

describe('cue palette', () => {
  it('has a palette entry for every library cue', () => {
    for (const cue of CUE_LIBRARY) {
      const entry = CUE_PALETTE[cue.id]
      expect(entry, `missing palette entry for ${cue.id}`).toBeTruthy()
      expect(entry.id).toBe(cue.id)
      expect(typeof entry.Pictograph).toBe('function')
      expect(entry.accentClass).toMatch(/^accent-/)
      expect(entry.animationClass).toMatch(/^anim-/)
    }
  })

  it('has byDistance tables for every library cue (distance axis ready)', () => {
    for (const cue of CUE_LIBRARY) {
      expect(cue.byDistance, `${cue.id} missing byDistance`).toBeTruthy()
      const t = cue.byDistance!
      expect(t.far).toBeDefined()
      expect(t.mid).toBeDefined()
      expect(t.in_range).toBeDefined()
    }
  })
})
