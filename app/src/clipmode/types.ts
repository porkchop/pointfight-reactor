import type { CueId } from '../engine/types'

/**
 * A locally imported video clip persisted in Dexie at schema version(4).
 * The `blob` field stores the raw .mp4 bytes; playback resolves it via
 * `URL.createObjectURL(blob)` at render time and `revokeObjectURL` on
 * unmount.
 *
 * `cueId` + `cueAtMs` are written by Phase 6.2's tag screen; clips with
 * neither field set are "needs tag" and excluded from Phase 6.3 playback.
 */
export interface ClipRecord {
  id: string
  name: string
  mimeType: string
  durationMs: number
  sizeBytes: number
  importedAt: number
  blob: Blob
  cueId?: CueId
  cueAtMs?: number
}

export type AddClipResult =
  | { ok: true; clip: ClipRecord }
  | {
      ok: false
      reason: 'quota' | 'too-large' | 'unsupported-type' | 'storage-error'
      message: string
    }

/** Per-clip hard cap. Blobs above this size are rejected with `too-large`. */
export const CLIP_HARD_CAP_BYTES = 200 * 1024 * 1024
/** Soft warning cap. Blobs above this size import but the UI warns about quota burn. */
export const CLIP_SOFT_WARN_BYTES = 100 * 1024 * 1024

export const SUPPORTED_CLIP_MIME_TYPES: readonly string[] = ['video/mp4']
