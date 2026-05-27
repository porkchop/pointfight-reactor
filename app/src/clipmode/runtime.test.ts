import { afterEach, describe, expect, it } from 'vitest'
import { isClipModeSupported } from './runtime'

describe('isClipModeSupported', () => {
  const proto = HTMLVideoElement.prototype as unknown as Record<
    string,
    unknown
  >
  const originalDesc = Object.getOwnPropertyDescriptor(
    proto,
    'requestVideoFrameCallback',
  )

  afterEach(() => {
    if (originalDesc) {
      Object.defineProperty(proto, 'requestVideoFrameCallback', originalDesc)
    } else {
      delete proto.requestVideoFrameCallback
    }
  })

  it('returns true when HTMLVideoElement.prototype.requestVideoFrameCallback exists', () => {
    Object.defineProperty(proto, 'requestVideoFrameCallback', {
      value: () => 0,
      configurable: true,
      writable: true,
    })
    expect(isClipModeSupported()).toBe(true)
  })

  it('returns false when requestVideoFrameCallback is missing (Safari < 15.4 / older browsers)', () => {
    delete proto.requestVideoFrameCallback
    expect(isClipModeSupported()).toBe(false)
  })
})
