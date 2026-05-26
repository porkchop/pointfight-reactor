import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  attachPhonePeer,
  detachPhonePeer,
  getActivePhonePeer,
  usePhonePeer,
} from './phone-peer'
import type { PeerHandle, PeerState } from '../phone/peer'
import type { PhoneMessage } from '../phone/wire'

class FakePeerHandle implements PeerHandle {
  private _state: PeerState = 'idle'
  private stateHandlers = new Set<(s: PeerState) => void>()
  private messageHandlers = new Set<(m: PhoneMessage) => void>()
  closed = false
  sent: PhoneMessage[] = []

  get state(): PeerState {
    return this._state
  }
  // Stub these — they're not exercised by the slice's own behavior.
  async createOffer(): Promise<string> {
    return ''
  }
  async acceptOffer(): Promise<string> {
    return ''
  }
  async acceptAnswer(): Promise<void> {}
  send(msg: PhoneMessage): void {
    if (this.closed) throw new Error('closed')
    this.sent.push(msg)
  }
  onMessage(h: (m: PhoneMessage) => void): () => void {
    this.messageHandlers.add(h)
    return () => this.messageHandlers.delete(h)
  }
  onStateChange(h: (s: PeerState) => void): () => void {
    this.stateHandlers.add(h)
    return () => this.stateHandlers.delete(h)
  }
  close(): void {
    this.closed = true
    this._state = 'closed'
    for (const h of this.stateHandlers) h('closed')
  }
  // Test helpers
  emitState(s: PeerState): void {
    this._state = s
    for (const h of this.stateHandlers) h(s)
  }
  emitMessage(m: PhoneMessage): void {
    for (const h of this.messageHandlers) h(m)
  }
}

function resetSlice(): void {
  detachPhonePeer()
  usePhonePeer.setState({ status: 'idle', lastCommit: null })
}

describe('phone-peer slice', () => {
  beforeEach(() => {
    resetSlice()
  })
  afterEach(() => {
    resetSlice()
  })

  it('starts in idle status with no active peer', () => {
    expect(usePhonePeer.getState().status).toBe<PeerState>('idle')
    expect(usePhonePeer.getState().lastCommit).toBeNull()
    expect(getActivePhonePeer()).toBeNull()
  })

  it('mirrors the peer state when a handle is attached', () => {
    const peer = new FakePeerHandle()
    attachPhonePeer(peer)
    expect(getActivePhonePeer()).toBe(peer)
    peer.emitState('connecting')
    expect(usePhonePeer.getState().status).toBe('connecting')
    peer.emitState('connected')
    expect(usePhonePeer.getState().status).toBe('connected')
  })

  it('records a lastCommit when the peer emits a commit message', () => {
    const peer = new FakePeerHandle()
    attachPhonePeer(peer)
    peer.emitMessage({ type: 'commit', t: 12345 })
    const lc = usePhonePeer.getState().lastCommit
    expect(lc?.t).toBe(12345)
    expect(typeof lc?.receivedAt).toBe('number')
  })

  it('ignores non-commit messages for the lastCommit mirror', () => {
    const peer = new FakePeerHandle()
    attachPhonePeer(peer)
    peer.emitMessage({ type: 'sample', t: 1, peakG: 1.4 })
    peer.emitMessage({
      type: 'config',
      thresholdG: 1.5,
      debounceMs: 300,
      mode: 'armed',
    })
    expect(usePhonePeer.getState().lastCommit).toBeNull()
  })

  it('fans out commit messages to onCommit subscribers', () => {
    const peer = new FakePeerHandle()
    attachPhonePeer(peer)
    const received: number[] = []
    const off = usePhonePeer.getState().onCommit((c) => received.push(c.t))
    peer.emitMessage({ type: 'commit', t: 7 })
    peer.emitMessage({ type: 'commit', t: 11 })
    expect(received).toEqual([7, 11])
    off()
    peer.emitMessage({ type: 'commit', t: 99 })
    expect(received).toEqual([7, 11])
  })

  it('attaching a new peer closes the prior one', () => {
    const a = new FakePeerHandle()
    const b = new FakePeerHandle()
    attachPhonePeer(a)
    attachPhonePeer(b)
    expect(a.closed).toBe(true)
    expect(getActivePhonePeer()).toBe(b)
  })

  it('detach closes the active peer and resets the slice', () => {
    const peer = new FakePeerHandle()
    attachPhonePeer(peer)
    peer.emitState('connected')
    peer.emitMessage({ type: 'commit', t: 1 })
    expect(usePhonePeer.getState().lastCommit?.t).toBe(1)
    detachPhonePeer()
    expect(peer.closed).toBe(true)
    expect(getActivePhonePeer()).toBeNull()
    expect(usePhonePeer.getState().status).toBe('closed')
    expect(usePhonePeer.getState().lastCommit).toBeNull()
  })

  it('does not duplicate commit deliveries when a peer is re-attached to itself', () => {
    const peer = new FakePeerHandle()
    attachPhonePeer(peer)
    attachPhonePeer(peer)
    const received: number[] = []
    usePhonePeer.getState().onCommit((c) => received.push(c.t))
    peer.emitMessage({ type: 'commit', t: 42 })
    expect(received).toEqual([42])
  })

  it('does not broadcast a spurious closed status when swapping peers', () => {
    // Regression for code-reviewer nit #8: closing the prior peer used to
    // run while its onStateChange listener was still registered, so the
    // slice briefly broadcast status='closed' to subscribers between the
    // close() and the new setState({status: handle.state}).
    const a = new FakePeerHandle()
    a.emitState('connected')
    attachPhonePeer(a)
    expect(usePhonePeer.getState().status).toBe('connected')

    const observed: PeerState[] = []
    const unsub = usePhonePeer.subscribe((s) => observed.push(s.status))

    const b = new FakePeerHandle()
    b.emitState('connecting')
    attachPhonePeer(b)

    unsub()
    // We only care that 'closed' never appeared in the broadcast trail;
    // the new peer's initial state ('connecting') should be the only
    // status the swap propagates.
    expect(observed).not.toContain('closed')
  })
})
