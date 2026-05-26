import { create } from 'zustand'
import type { PeerHandle, PeerState } from '../phone/peer'
import type { PhoneMessage } from '../phone/wire'

export type PhonePeerStatus = PeerState

export interface PhoneCommit {
  /** Phone-clock timestamp the peer reported with the commit message. */
  t: number
  /** Local monotonic time at which the laptop received the commit. */
  receivedAt: number
}

interface PhonePeerSlice {
  status: PhonePeerStatus
  lastCommit: PhoneCommit | null
  /**
   * Subscribe to incoming commit messages. Returns an unsubscribe function.
   * Used by TrainerScreen to route phone commits through `recordPress(at)`
   * on the same path as keyboard/pedal input. Subscribers are global to the
   * slice — they survive detach/re-attach across peer lifetimes, so callers
   * are responsible for holding the unsubscribe across their own component
   * lifetime.
   */
  onCommit(handler: (c: PhoneCommit) => void): () => void
}

// The PeerHandle itself lives outside Zustand state to avoid object-identity
// re-renders for components that only care about projected status. Per
// decision-memo §"Sub-phase 2b.4 / Singleton peer lifecycle (N5 resolved)":
// the slice owns the peer's lifetime; components see only the mirrored state.
let activeHandle: PeerHandle | null = null
let unsubState: (() => void) | null = null
let unsubMsg: (() => void) | null = null
const commitHandlers = new Set<(c: PhoneCommit) => void>()

export const usePhonePeer = create<PhonePeerSlice>(() => ({
  status: 'idle',
  lastCommit: null,
  onCommit(handler) {
    commitHandlers.add(handler)
    return () => {
      commitHandlers.delete(handler)
    }
  },
}))

function unwireActive(): void {
  unsubState?.()
  unsubMsg?.()
  unsubState = null
  unsubMsg = null
}

/**
 * Register a peer as the canonical phone-peer. If a different peer was
 * already attached, it is closed first. Attaching the same peer twice is a
 * no-op (the slice mirror was already in sync).
 */
export function attachPhonePeer(handle: PeerHandle): void {
  if (activeHandle === handle) return
  if (activeHandle && activeHandle !== handle) {
    // Unwire BEFORE close so the prior peer's synchronous 'closed' state
    // event doesn't fan out a spurious closed-status broadcast to every
    // IdleScreen / TrainerScreen subscriber between the close() and the
    // setState for the new handle.
    unwireActive()
    try {
      activeHandle.close()
    } catch {
      /* ignore */
    }
  }
  activeHandle = handle
  usePhonePeer.setState({ status: handle.state })
  unsubState = handle.onStateChange((s) => {
    usePhonePeer.setState({ status: s })
  })
  unsubMsg = handle.onMessage((m: PhoneMessage) => {
    if (m.type !== 'commit') return
    const commit: PhoneCommit = { t: m.t, receivedAt: performance.now() }
    usePhonePeer.setState({ lastCommit: commit })
    for (const h of commitHandlers) h(commit)
  })
}

/**
 * Tear down the active phone-peer. Idempotent — safe to call when no peer
 * is attached. Notifies subscribers that status moved to 'closed'.
 */
export function detachPhonePeer(): void {
  unwireActive()
  if (activeHandle) {
    try {
      activeHandle.close()
    } catch {
      /* ignore */
    }
  }
  activeHandle = null
  usePhonePeer.setState({ status: 'closed', lastCommit: null })
}

/** Procedural getter for callers that need to send messages on the peer. */
export function getActivePhonePeer(): PeerHandle | null {
  return activeHandle
}
