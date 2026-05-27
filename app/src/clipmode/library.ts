import { getDb } from '../store/db'
import {
  CLIP_HARD_CAP_BYTES,
  CLIP_SOFT_WARN_BYTES,
  SUPPORTED_CLIP_MIME_TYPES,
  type AddClipResult,
  type ClipRecord,
} from './types'

function mintClipId(now: number): string {
  return `clip-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' || err.code === 22)
  )
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export async function addClip(
  file: File,
  opts: { durationMs: number },
): Promise<AddClipResult> {
  const db = getDb()
  if (!db) {
    return {
      ok: false,
      reason: 'storage-error',
      message: 'Database is unavailable.',
    }
  }

  if (!SUPPORTED_CLIP_MIME_TYPES.includes(file.type)) {
    return {
      ok: false,
      reason: 'unsupported-type',
      message: `File type ${file.type || '(unknown)'} is not supported. Use .mp4.`,
    }
  }

  if (file.size > CLIP_HARD_CAP_BYTES) {
    const mb = Math.round(file.size / 1024 / 1024)
    return {
      ok: false,
      reason: 'too-large',
      message: `Clip is ${mb} MB; the per-clip limit is ${CLIP_HARD_CAP_BYTES / 1024 / 1024} MB.`,
    }
  }

  const clip: ClipRecord = {
    id: mintClipId(Date.now()),
    name: file.name,
    mimeType: file.type,
    durationMs: Math.max(0, Math.round(opts.durationMs)),
    sizeBytes: file.size,
    importedAt: Date.now(),
    blob: file,
  }

  try {
    await db.clips.put(clip)
  } catch (err) {
    if (isQuotaError(err)) {
      return {
        ok: false,
        reason: 'quota',
        message:
          'Browser storage quota exceeded. Delete a clip before importing more.',
      }
    }
    return { ok: false, reason: 'storage-error', message: errorMessage(err) }
  }

  return { ok: true, clip }
}

export async function listClips(): Promise<ClipRecord[]> {
  const db = getDb()
  if (!db) return []
  try {
    return await db.clips.orderBy('importedAt').reverse().toArray()
  } catch {
    return []
  }
}

export async function deleteClip(id: string): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    await db.clips.delete(id)
  } catch {
    /* leave the row in place; UI can retry */
  }
}

export interface QuotaEstimate {
  usageBytes: number
  quotaBytes: number
  /** 0..1; quotaBytes can be 0 on browsers that decline to report. */
  percent: number
}

export async function getQuotaEstimate(): Promise<QuotaEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null
  }
  try {
    const est = await navigator.storage.estimate()
    const usage = est.usage ?? 0
    const quota = est.quota ?? 0
    return {
      usageBytes: usage,
      quotaBytes: quota,
      percent: quota > 0 ? usage / quota : 0,
    }
  } catch {
    return null
  }
}

export function isSoftWarnSize(bytes: number): boolean {
  return bytes > CLIP_SOFT_WARN_BYTES && bytes <= CLIP_HARD_CAP_BYTES
}

export function quotaBanner(estimate: QuotaEstimate | null): 'none' | 'warn' | 'cap' {
  if (!estimate) return 'none'
  if (estimate.percent > 0.95) return 'cap'
  if (estimate.percent > 0.8) return 'warn'
  return 'none'
}
