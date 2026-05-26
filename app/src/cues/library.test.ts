import { describe, expect, it } from 'vitest'
import { CUE_LIBRARY, GO_CUES, NO_GO_CUES } from './library'

describe('cue library', () => {
  it('contains both go and no-go cues', () => {
    expect(GO_CUES.length).toBeGreaterThan(0)
    expect(NO_GO_CUES.length).toBeGreaterThan(0)
  })

  it('has unique ids', () => {
    const ids = CUE_LIBRARY.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no-go cues all map to do_nothing', () => {
    for (const cue of NO_GO_CUES) {
      expect(cue.expectedResponse).toBe('do_nothing')
    }
  })
})
