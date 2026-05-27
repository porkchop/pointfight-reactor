import { useEffect, useRef, useState } from 'react'
import {
  addClip,
  deleteClip,
  getQuotaEstimate,
  isSoftWarnSize,
  listClips,
  quotaBanner,
  type QuotaEstimate,
} from '../clipmode/library'
import { extractDurationMs } from '../clipmode/metadata'
import type { AddClipResult, ClipRecord } from '../clipmode/types'

interface ClipLibraryScreenProps {
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const totalSec = Math.round(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

async function fetchLibraryState(): Promise<
  [ClipRecord[], QuotaEstimate | null]
> {
  return Promise.all([listClips(), getQuotaEstimate()])
}

export function ClipLibraryScreen({ onClose }: ClipLibraryScreenProps) {
  const [clips, setClips] = useState<ClipRecord[]>([])
  const [estimate, setEstimate] = useState<QuotaEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [softWarn, setSoftWarn] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void fetchLibraryState().then(([c, e]) => {
      setClips(c)
      setEstimate(e)
    })
  }, [])

  async function refresh() {
    const [c, e] = await fetchLibraryState()
    setClips(c)
    setEstimate(e)
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    setSoftWarn(null)
    try {
      for (const file of Array.from(files)) {
        if (isSoftWarnSize(file.size)) {
          setSoftWarn(
            `Heads up: ${file.name} is ${formatBytes(file.size)}, larger than the 100 MB soft cap. It will eat browser storage faster.`,
          )
        }
        const durationMs = await extractDurationMs(file)
        const res: AddClipResult = await addClip(file, { durationMs })
        if (!res.ok) {
          setError(`${file.name}: ${res.message}`)
          break
        }
      }
      await refresh()
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleDelete(clip: ClipRecord) {
    if (!window.confirm(`Delete ${clip.name}? This cannot be undone.`)) return
    await deleteClip(clip.id)
    await refresh()
  }

  const banner = quotaBanner(estimate)

  return (
    <div className="screen clip-library">
      <div className="clip-library-header">
        <h1>Clips</h1>
        <button
          type="button"
          className="link"
          onClick={onClose}
          data-testid="clip-library-close"
        >
          Close
        </button>
      </div>

      {banner === 'cap' && estimate && (
        <div
          className="banner warn"
          role="status"
          data-testid="clip-quota-cap"
        >
          Storage is at {(estimate.percent * 100).toFixed(0)} % of quota. Delete a clip
          before importing more.
        </div>
      )}
      {banner === 'warn' && estimate && (
        <div
          className="banner warn"
          role="status"
          data-testid="clip-quota-warn"
        >
          Storage is at {(estimate.percent * 100).toFixed(0)} % of quota.
        </div>
      )}

      {error && (
        <div className="banner warn" role="alert" data-testid="clip-error">
          {error}
        </div>
      )}
      {softWarn && (
        <div className="banner info" role="status" data-testid="clip-soft-warn">
          {softWarn}
        </div>
      )}

      <div className="clip-import">
        <label
          className="link"
          htmlFor="clip-input"
          aria-disabled={busy || banner === 'cap'}
        >
          {busy ? 'Importing…' : 'Import .mp4'}
        </label>
        <input
          id="clip-input"
          ref={inputRef}
          type="file"
          accept="video/mp4"
          multiple
          onChange={(e) => void handleFiles(e.target.files)}
          disabled={busy || banner === 'cap'}
          data-testid="clip-import-input"
          style={{ display: 'none' }}
        />
        {estimate && (
          <span className="clip-quota" data-testid="clip-quota-text">
            {formatBytes(estimate.usageBytes)} used
            {estimate.quotaBytes > 0 &&
              ` / ${formatBytes(estimate.quotaBytes)} quota`}
          </span>
        )}
      </div>

      {clips.length === 0 ? (
        <p className="hint" data-testid="clip-empty">
          No clips yet. Import a .mp4 to get started.
        </p>
      ) : (
        <ul className="clip-list" data-testid="clip-list">
          {clips.map((clip) => (
            <li key={clip.id} data-testid="clip-row">
              <div className="clip-row-main">
                <span className="clip-name">{clip.name}</span>
                <span className="clip-meta">
                  {formatDuration(clip.durationMs)} ·{' '}
                  {formatBytes(clip.sizeBytes)}
                  {clip.cueId === undefined && (
                    <span
                      className="clip-needs-tag"
                      data-testid="clip-needs-tag"
                    >
                      {' '}
                      · needs tag
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="link"
                onClick={() => void handleDelete(clip)}
                data-testid="clip-delete"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
