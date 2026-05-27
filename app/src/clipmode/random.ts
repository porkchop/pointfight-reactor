import type { RNG } from '../engine/rng'

/**
 * Picks the next clip id uniformly at random from `clipIds` with the
 * "no repeat immediately previous" constraint. If `previousId` is
 * passed AND there is at least one other clip available, the picker
 * draws uniformly from the (n-1) clips that are not the previous one;
 * otherwise it draws uniformly from all n.
 *
 * Phase 6.3 acceptance criterion — "clipmode/runner.ts selects clips by
 * uniform random with replacement, no repeat-immediately-previous.
 * Untagged clips are excluded. Distribution test: 200 draws from 5
 * clips, each appears 32–48 times. No-repeat-prev test: 100 draws
 * from ≥2 clips, no consecutive duplicates."
 *
 * `clipIds` is the caller's responsibility — for clip-mode drill that
 * means the *tagged* subset (`clip.cueId !== undefined`).
 */
export function pickNextClip(
  rng: RNG,
  clipIds: readonly string[],
  previousId: string | null,
): string {
  if (clipIds.length === 0) {
    throw new Error('pickNextClip: clipIds is empty')
  }
  if (clipIds.length === 1) {
    return clipIds[0]
  }
  if (previousId === null) {
    return clipIds[Math.floor(rng() * clipIds.length)]
  }
  const pool = clipIds.filter((id) => id !== previousId)
  if (pool.length === 0) {
    // Pathological: previousId not in the list, but all entries equal each
    // other (duplicates). Fall back to a plain uniform draw.
    return clipIds[Math.floor(rng() * clipIds.length)]
  }
  return pool[Math.floor(rng() * pool.length)]
}
