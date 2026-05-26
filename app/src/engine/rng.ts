export type RNG = () => number

export const defaultRng: RNG = () => Math.random()

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randInt(
  rng: RNG,
  minInclusive: number,
  maxInclusive: number,
): number {
  if (maxInclusive < minInclusive) {
    throw new Error('randInt: max < min')
  }
  const span = maxInclusive - minInclusive + 1
  return minInclusive + Math.floor(rng() * span)
}
