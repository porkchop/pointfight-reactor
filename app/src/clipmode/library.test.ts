import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../store/db'
import {
  addClip,
  deleteClip,
  getClip,
  getQuotaEstimate,
  isSoftWarnSize,
  listClips,
  quotaBanner,
  updateClipTag,
} from './library'
import { CLIP_HARD_CAP_BYTES, CLIP_SOFT_WARN_BYTES } from './types'

function makeFile({
  name = 'clip.mp4',
  type = 'video/mp4',
  size = 5 * 1024 * 1024,
  content = 'abc',
}: {
  name?: string
  type?: string
  size?: number
  content?: string
} = {}): File {
  const file = new File([content], name, { type })
  if (size !== content.length) {
    Object.defineProperty(file, 'size', { value: size, configurable: true })
  }
  return file
}

async function clearClips() {
  const db = getDb()
  if (db) await db.clips.clear()
}

describe('addClip', () => {
  beforeEach(async () => {
    await clearClips()
  })

  it('persists a valid mp4 and returns { ok: true, clip }', async () => {
    const res = await addClip(makeFile({ name: 'demo.mp4', size: 2 * 1024 * 1024 }), {
      durationMs: 4500,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.clip.name).toBe('demo.mp4')
    expect(res.clip.mimeType).toBe('video/mp4')
    expect(res.clip.durationMs).toBe(4500)
    expect(res.clip.sizeBytes).toBe(2 * 1024 * 1024)
    expect(res.clip.id).toMatch(/^clip-/)

    const db = getDb()
    const stored = await db?.clips.get(res.clip.id)
    expect(stored?.name).toBe('demo.mp4')
  })

  it('rejects an unsupported MIME type with reason: "unsupported-type"', async () => {
    const res = await addClip(makeFile({ type: 'text/plain', size: 1024 }), {
      durationMs: 0,
    })
    expect(res).toEqual({
      ok: false,
      reason: 'unsupported-type',
      message: expect.stringContaining('text/plain'),
    })
  })

  it('rejects a 250 MB blob with reason: "too-large"', async () => {
    const res = await addClip(makeFile({ size: 250 * 1024 * 1024 }), {
      durationMs: 10000,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.reason).toBe('too-large')
    expect(res.message).toContain('250 MB')
    expect(res.message).toContain('200 MB')
  })

  it('returns reason: "quota" when Dexie throws QuotaExceededError', async () => {
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    const quotaErr = new DOMException('Quota exceeded', 'QuotaExceededError')
    const spy = vi.spyOn(db.clips, 'put').mockRejectedValueOnce(quotaErr)
    const res = await addClip(makeFile({ size: 1024 }), { durationMs: 100 })
    expect(res).toEqual({
      ok: false,
      reason: 'quota',
      message: expect.stringContaining('quota'),
    })
    spy.mockRestore()
  })

  it('returns reason: "storage-error" for a generic Dexie failure', async () => {
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    const spy = vi
      .spyOn(db.clips, 'put')
      .mockRejectedValueOnce(new Error('disk i/o failed'))
    const res = await addClip(makeFile({ size: 1024 }), { durationMs: 100 })
    expect(res).toEqual({
      ok: false,
      reason: 'storage-error',
      message: 'disk i/o failed',
    })
    spy.mockRestore()
  })

  it('clamps a negative durationMs to 0', async () => {
    const res = await addClip(makeFile(), { durationMs: -50 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.clip.durationMs).toBe(0)
  })
})

describe('listClips', () => {
  beforeEach(async () => {
    await clearClips()
  })

  it('returns clips in descending importedAt order', async () => {
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    const baseBlob = new Blob(['x'], { type: 'video/mp4' })
    await db.clips.put({
      id: 'a',
      name: 'a.mp4',
      mimeType: 'video/mp4',
      durationMs: 1000,
      sizeBytes: 1,
      importedAt: 1000,
      blob: baseBlob,
    })
    await db.clips.put({
      id: 'b',
      name: 'b.mp4',
      mimeType: 'video/mp4',
      durationMs: 1000,
      sizeBytes: 1,
      importedAt: 3000,
      blob: baseBlob,
    })
    await db.clips.put({
      id: 'c',
      name: 'c.mp4',
      mimeType: 'video/mp4',
      durationMs: 1000,
      sizeBytes: 1,
      importedAt: 2000,
      blob: baseBlob,
    })

    const out = await listClips()
    expect(out.map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns an empty array on an empty table', async () => {
    expect(await listClips()).toEqual([])
  })
})

describe('getClip', () => {
  beforeEach(async () => {
    await clearClips()
  })

  it('returns the stored clip by id', async () => {
    const added = await addClip(makeFile({ name: 'one.mp4' }), {
      durationMs: 1234,
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const fetched = await getClip(added.clip.id)
    expect(fetched?.name).toBe('one.mp4')
    expect(fetched?.durationMs).toBe(1234)
  })

  it('returns null for an unknown id', async () => {
    expect(await getClip('missing-id')).toBeNull()
  })
})

describe('updateClipTag', () => {
  beforeEach(async () => {
    await clearClips()
  })

  it('writes cueId + cueAtMs onto an existing clip and returns the updated row', async () => {
    const added = await addClip(makeFile({ name: 'tag.mp4' }), {
      durationMs: 5000,
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const updated = await updateClipTag(added.clip.id, {
      cueId: 'steps_in',
      cueAtMs: 1234,
    })
    expect(updated?.cueId).toBe('steps_in')
    expect(updated?.cueAtMs).toBe(1234)

    const reloaded = await getClip(added.clip.id)
    expect(reloaded?.cueId).toBe('steps_in')
    expect(reloaded?.cueAtMs).toBe(1234)
  })

  it('overwrites a prior tag in place (no version history)', async () => {
    const added = await addClip(makeFile({ name: 'tag.mp4' }), {
      durationMs: 5000,
    })
    if (!added.ok) throw new Error('seed failed')
    await updateClipTag(added.clip.id, { cueId: 'steps_in', cueAtMs: 100 })
    await updateClipTag(added.clip.id, { cueId: 'blitzes', cueAtMs: 250 })
    const reloaded = await getClip(added.clip.id)
    expect(reloaded?.cueId).toBe('blitzes')
    expect(reloaded?.cueAtMs).toBe(250)
  })

  it('clamps a negative cueAtMs to 0', async () => {
    const added = await addClip(makeFile(), { durationMs: 1000 })
    if (!added.ok) throw new Error('seed failed')
    await updateClipTag(added.clip.id, { cueId: 'blitzes', cueAtMs: -50 })
    const reloaded = await getClip(added.clip.id)
    expect(reloaded?.cueAtMs).toBe(0)
  })

  it('clamps cueAtMs to durationMs when over (avoids tagging past end of clip)', async () => {
    const added = await addClip(makeFile(), { durationMs: 2000 })
    if (!added.ok) throw new Error('seed failed')
    await updateClipTag(added.clip.id, { cueId: 'blitzes', cueAtMs: 9999 })
    const reloaded = await getClip(added.clip.id)
    expect(reloaded?.cueAtMs).toBe(2000)
  })

  it('returns null when the clip id does not exist', async () => {
    const out = await updateClipTag('not-real', {
      cueId: 'steps_in',
      cueAtMs: 100,
    })
    expect(out).toBeNull()
  })
})

describe('deleteClip', () => {
  beforeEach(async () => {
    await clearClips()
  })

  it('removes the row by id', async () => {
    const added = await addClip(makeFile({ name: 'doomed.mp4' }), {
      durationMs: 1000,
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    await deleteClip(added.clip.id)
    const db = getDb()
    expect(await db?.clips.get(added.clip.id)).toBeUndefined()
  })

  it('is a no-op when the id does not exist', async () => {
    await expect(deleteClip('does-not-exist')).resolves.toBeUndefined()
  })
})

describe('getQuotaEstimate', () => {
  let originalStorage: unknown
  beforeEach(() => {
    originalStorage = (navigator as { storage?: unknown }).storage
  })
  afterEach(() => {
    Object.defineProperty(navigator, 'storage', {
      value: originalStorage,
      configurable: true,
    })
  })

  it('returns null when navigator.storage.estimate is unavailable', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: undefined,
      configurable: true,
    })
    expect(await getQuotaEstimate()).toBeNull()
  })

  it('computes percent = usage / quota', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: () => Promise.resolve({ usage: 250, quota: 1000 }) },
      configurable: true,
    })
    const est = await getQuotaEstimate()
    expect(est).toEqual({ usageBytes: 250, quotaBytes: 1000, percent: 0.25 })
  })

  it('returns percent 0 when quota is 0 (browser declined to report)', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: () => Promise.resolve({ usage: 100, quota: 0 }) },
      configurable: true,
    })
    const est = await getQuotaEstimate()
    expect(est?.percent).toBe(0)
  })

  it('returns null if estimate() rejects', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: () => Promise.reject(new Error('denied')) },
      configurable: true,
    })
    expect(await getQuotaEstimate()).toBeNull()
  })
})

describe('quotaBanner', () => {
  it('returns "cap" above 95 %', () => {
    expect(quotaBanner({ usageBytes: 96, quotaBytes: 100, percent: 0.96 })).toBe(
      'cap',
    )
  })
  it('returns "warn" between 80 % and 95 %', () => {
    expect(quotaBanner({ usageBytes: 85, quotaBytes: 100, percent: 0.85 })).toBe(
      'warn',
    )
  })
  it('returns "none" below 80 %', () => {
    expect(quotaBanner({ usageBytes: 50, quotaBytes: 100, percent: 0.5 })).toBe(
      'none',
    )
  })
  it('returns "none" when estimate is null', () => {
    expect(quotaBanner(null)).toBe('none')
  })
})

describe('isSoftWarnSize', () => {
  it('returns false at exactly the soft cap', () => {
    expect(isSoftWarnSize(CLIP_SOFT_WARN_BYTES)).toBe(false)
  })
  it('returns true just above the soft cap', () => {
    expect(isSoftWarnSize(CLIP_SOFT_WARN_BYTES + 1)).toBe(true)
  })
  it('returns false above the hard cap (those get rejected, not warned)', () => {
    expect(isSoftWarnSize(CLIP_HARD_CAP_BYTES + 1)).toBe(false)
  })
})
