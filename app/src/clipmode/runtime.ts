/**
 * Feature-detect support for the clip-mode drill.
 *
 * Phase 6.3 acceptance criterion — "isClipModeSupported() returns false
 * when requestVideoFrameCallback is absent. IdleScreen renders a
 * data-testid='clip-mode-unsupported' banner ('Clip mode requires
 * Chrome 83+, Edge, or Safari 15.4+') and disables Start in that case."
 *
 * Rationale (decision-memo §"Resolved red-team blockers — Phase 6"
 * concern 5): the spec's hesitation threshold is 450 ms and the late
 * threshold is 600 ms. `<video>`'s `timeupdate` fires at ~250 ms
 * resolution; a press that classifies as "correct" on Chrome could
 * classify as "hesitation" on a Safari < 15.4 build of the same clip.
 * That is measurement-system incoherence, so clip-mode is gated to
 * browsers that ship `requestVideoFrameCallback` (Chrome 83+, Edge,
 * Safari 15.4+).
 */
export function isClipModeSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof HTMLVideoElement === 'undefined') return false
  return 'requestVideoFrameCallback' in HTMLVideoElement.prototype
}

export const CLIP_MODE_UNSUPPORTED_MESSAGE =
  'Clip mode requires Chrome 83+, Edge, or Safari 15.4+.'
