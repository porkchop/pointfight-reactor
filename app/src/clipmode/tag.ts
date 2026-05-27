/**
 * Pure helpers for ClipTagScreen — frame-step math and clamping.
 *
 * Per the Phase 6 decision memo §2 "Tagging UX": the −1 frame / +1 frame
 * buttons step by `1/30 s` (≈33.33 ms). We do not know the source clip's
 * FPS, but this is "good enough for tagging at human reaction-time
 * resolution" — the ±33 ms cue-shown precision criterion lives in Phase
 * 6.3 (drill mode), not here.
 *
 * Scrub-to-1-frame precision is a MANUAL gate per `docs/QUALITY_GATES.md`
 * §"Browser-API limitations (Phase 2b + Phase 6)" §B5; the pure helpers
 * below are the unit-testable surface.
 */

/** Frame step in milliseconds: 1/30 s ≈ 33.33 ms. */
export const FRAME_STEP_MS = 1000 / 30

/**
 * Returns the new tag position after stepping by `delta` frames, clamped
 * to `[0, durationMs]`. `delta` is in units of frames (typically ±1).
 * Result is rounded to the nearest millisecond.
 */
export function stepFrame(
  currentMs: number,
  delta: number,
  durationMs: number,
): number {
  const next = currentMs + delta * FRAME_STEP_MS
  return Math.max(0, Math.min(Math.round(next), Math.max(0, durationMs)))
}

/**
 * Clamps a free-form cueAtMs (e.g. from a range-input slider or
 * `<video>.currentTime`) to `[0, durationMs]`. Mirrors the clamp used by
 * `library.updateClipTag()` so callers can apply the same rule in the UI
 * before the persistence layer ever sees the value.
 */
export function clampCueAtMs(cueAtMs: number, durationMs: number): number {
  if (!Number.isFinite(cueAtMs)) return 0
  return Math.max(0, Math.min(Math.round(cueAtMs), Math.max(0, durationMs)))
}
