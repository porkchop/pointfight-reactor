import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { ClipTagScreen } from './ClipTagScreen'
import { addClip, getClip } from '../clipmode/library'
import { getDb } from '../store/db'

// `URL.createObjectURL` and `revokeObjectURL` are not implemented by jsdom; stub
// them so the component does not throw on blob URL creation. The stubbed
// `<video>` does not actually decode the blob — `<video>` semantics are MANUAL
// per `docs/QUALITY_GATES.md` §B5.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:stub-url')
  URL.revokeObjectURL = vi.fn()
})

async function clearClips() {
  const db = getDb()
  if (db) await db.clips.clear()
}

async function seed(name = 'spar.mp4', durationMs = 5000) {
  const file = new File(['video-bytes'], name, { type: 'video/mp4' })
  Object.defineProperty(file, 'size', { value: 1024 * 1024 })
  const res = await addClip(file, { durationMs })
  if (!res.ok) throw new Error(`seed failed: ${res.reason}`)
  return res.clip.id
}

describe('ClipTagScreen', () => {
  beforeEach(async () => {
    await clearClips()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('persists the selected cueId + current cueAtMs through Save', async () => {
    const clipId = await seed()
    const onClose = vi.fn()
    render(<ClipTagScreen clipId={clipId} onClose={onClose} />)

    // Wait for the clip to load (loading hint goes away).
    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-loading')).toBeNull(),
    )

    // Change cue selection to BLITZES.
    const select = screen.getByTestId(
      'clip-tag-cue-select',
    ) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'blitzes' } })
    expect(select.value).toBe('blitzes')

    // Scrub to 1500 ms via the range input.
    const scrub = screen.getByTestId('clip-tag-scrub') as HTMLInputElement
    fireEvent.change(scrub, { target: { value: '1500' } })

    // Save.
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-tag-save'))
    })

    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-saved')).not.toBeNull(),
    )

    const reloaded = await getClip(clipId)
    expect(reloaded?.cueId).toBe('blitzes')
    expect(reloaded?.cueAtMs).toBe(1500)
  })

  it('prefills cueId + cueAtMs when a prior tag exists', async () => {
    const clipId = await seed('prior.mp4', 5000)
    // Stage a prior tag directly via the persistence layer.
    const db = getDb()
    if (!db) throw new Error('db unavailable')
    const existing = await db.clips.get(clipId)
    if (!existing) throw new Error('seeded clip missing')
    await db.clips.put({ ...existing, cueId: 'freezes', cueAtMs: 2200 })

    render(<ClipTagScreen clipId={clipId} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-loading')).toBeNull(),
    )

    const select = screen.getByTestId(
      'clip-tag-cue-select',
    ) as HTMLSelectElement
    expect(select.value).toBe('freezes')
    const scrub = screen.getByTestId('clip-tag-scrub') as HTMLInputElement
    expect(scrub.value).toBe('2200')
  })

  it('renders all 8 CUE_LIBRARY entries in the select', async () => {
    const clipId = await seed()
    render(<ClipTagScreen clipId={clipId} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-loading')).toBeNull(),
    )

    const select = screen.getByTestId(
      'clip-tag-cue-select',
    ) as HTMLSelectElement
    expect(select.querySelectorAll('option').length).toBe(8)
  })

  it('frame-forward / frame-back buttons adjust cueAtMs by ±33 ms (clamped)', async () => {
    const clipId = await seed('step.mp4', 5000)
    render(<ClipTagScreen clipId={clipId} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-loading')).toBeNull(),
    )

    const scrub = screen.getByTestId('clip-tag-scrub') as HTMLInputElement

    fireEvent.click(screen.getByTestId('clip-tag-frame-forward'))
    expect(scrub.value).toBe('33') // round(0 + 33.333)

    fireEvent.click(screen.getByTestId('clip-tag-frame-forward'))
    expect(scrub.value).toBe('66') // round(33 + 33.333)

    fireEvent.click(screen.getByTestId('clip-tag-frame-back'))
    expect(scrub.value).toBe('33') // round(66 - 33.333)

    // Clamp to 0 on repeated back-step.
    fireEvent.click(screen.getByTestId('clip-tag-frame-back'))
    fireEvent.click(screen.getByTestId('clip-tag-frame-back'))
    expect(scrub.value).toBe('0')
  })

  it('closes (via onClose) when the clipId cannot be found', async () => {
    const onClose = vi.fn()
    render(<ClipTagScreen clipId="does-not-exist" onClose={onClose} />)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('creates exactly one blob URL per clipId, even after Save (no <video> churn)', async () => {
    const createSpy = vi.mocked(URL.createObjectURL)
    const revokeSpy = vi.mocked(URL.revokeObjectURL)
    const clipId = await seed('stable.mp4', 5000)
    render(<ClipTagScreen clipId={clipId} onClose={vi.fn()} />)

    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-loading')).toBeNull(),
    )
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).not.toHaveBeenCalled()

    // Save would previously re-fire setClip(updated) → effect → revoke/create.
    fireEvent.change(
      screen.getByTestId('clip-tag-cue-select') as HTMLSelectElement,
      { target: { value: 'blitzes' } },
    )
    await act(async () => {
      fireEvent.click(screen.getByTestId('clip-tag-save'))
    })
    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-saved')).not.toBeNull(),
    )

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(revokeSpy).not.toHaveBeenCalled()
  })

  it('does not refetch the clip when only the onClose prop identity changes', async () => {
    const clipId = await seed('refresh.mp4', 5000)
    const { rerender } = render(
      <ClipTagScreen clipId={clipId} onClose={vi.fn()} />,
    )
    await waitFor(() =>
      expect(screen.queryByTestId('clip-tag-loading')).toBeNull(),
    )

    // User scrubs to 1500 ms — unsaved local state.
    fireEvent.change(screen.getByTestId('clip-tag-scrub') as HTMLInputElement, {
      target: { value: '1500' },
    })
    expect(
      (screen.getByTestId('clip-tag-scrub') as HTMLInputElement).value,
    ).toBe('1500')

    // Parent re-renders with a brand-new onClose arrow. Local edits must
    // survive — load effect should not refire.
    rerender(<ClipTagScreen clipId={clipId} onClose={vi.fn()} />)
    expect(
      (screen.getByTestId('clip-tag-scrub') as HTMLInputElement).value,
    ).toBe('1500')
  })
})
