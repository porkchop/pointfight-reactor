import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPeer, type PeerHandle, type PeerState } from './peer'
import type { PhoneMessage } from './wire'

// ---------------------------------------------------------------------------
// Minimal RTCPeerConnection stub. jsdom does not provide WebRTC, so we model
// just enough of the API surface to drive peer.ts through its state machine.
// The full transport handshake is gated by manual real-device QA per the
// Phase 2b decision memo §B2.
// ---------------------------------------------------------------------------

class FakeDataChannel {
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  sent: string[] = []
  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('channel not open')
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 'closed'
    this.onclose?.()
  }
  open(): void {
    this.readyState = 'open'
    this.onopen?.()
  }
  deliver(data: string): void {
    this.onmessage?.({ data })
  }
}

class FakePeerConnection {
  iceGatheringState: 'new' | 'gathering' | 'complete' = 'new'
  connectionState: 'new' | 'connecting' | 'connected' | 'failed' | 'closed' = 'new'
  onicegatheringstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((ev: { channel: FakeDataChannel }) => void) | null = null
  localDescription: { sdp: string; type: 'offer' | 'answer' } | null = null
  remoteDescription: { sdp: string; type: 'offer' | 'answer' } | null = null
  channel: FakeDataChannel | null = null
  config?: RTCConfiguration
  constructor(config?: RTCConfiguration) {
    this.config = config
  }

  createDataChannel(label: string): FakeDataChannel {
    this.lastLabel = label
    this.channel = new FakeDataChannel()
    return this.channel
  }
  lastLabel: string | null = null
  async createOffer(): Promise<{ sdp: string; type: 'offer' }> {
    return { sdp: 'v=0\r\no=- 0 0 IN IP4 0\r\n', type: 'offer' }
  }
  async createAnswer(): Promise<{ sdp: string; type: 'answer' }> {
    return { sdp: 'v=0\r\no=- 1 1 IN IP4 0\r\n', type: 'answer' }
  }
  async setLocalDescription(d: {
    sdp: string
    type: 'offer' | 'answer'
  }): Promise<void> {
    this.localDescription = d
  }
  async setRemoteDescription(d: {
    sdp: string
    type: 'offer' | 'answer'
  }): Promise<void> {
    this.remoteDescription = d
  }
  close(): void {
    this.connectionState = 'closed'
    this.onconnectionstatechange?.()
  }
  // ---- test helpers ----
  finishIceGathering(): void {
    this.iceGatheringState = 'complete'
    this.onicegatheringstatechange?.()
  }
  setConnectionState(s: FakePeerConnection['connectionState']): void {
    this.connectionState = s
    this.onconnectionstatechange?.()
  }
  receiveRemoteChannel(): FakeDataChannel {
    const ch = new FakeDataChannel()
    this.channel = ch
    this.ondatachannel?.({ channel: ch })
    return ch
  }
}

let lastFake: FakePeerConnection | null = null
function fakeFactory(config?: RTCConfiguration): RTCPeerConnection {
  lastFake = new FakePeerConnection(config)
  return lastFake as unknown as RTCPeerConnection
}

beforeEach(() => {
  lastFake = null
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createPeer — offerer (laptop) flow', () => {
  it('starts in idle state', () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    expect(peer.state).toBe<PeerState>('idle')
  })

  it('createOffer creates a DataChannel, generates an offer, and waits for ICE gathering', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const offerPromise = peer.createOffer()
    expect(peer.state).toBe<PeerState>('gathering_offer')
    // Drive ICE gathering to completion via the stub
    lastFake!.finishIceGathering()
    const sdp = await offerPromise
    expect(sdp).toContain('v=0')
    expect(peer.state).toBe<PeerState>('awaiting_answer')
    expect(lastFake!.channel).not.toBeNull()
    expect(lastFake!.localDescription?.type).toBe('offer')
  })

  it('acceptAnswer sets the remote description and moves to connecting', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const offerPromise = peer.createOffer()
    lastFake!.finishIceGathering()
    await offerPromise
    await peer.acceptAnswer('v=0\r\nfake-answer\r\n')
    expect(lastFake!.remoteDescription?.type).toBe('answer')
    // connecting until the underlying conn fires 'connected'
    expect(peer.state).toBe<PeerState>('connecting')
  })

  it('transitions to connected when the DataChannel opens', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const states: PeerState[] = []
    peer.onStateChange((s) => states.push(s))
    const offerPromise = peer.createOffer()
    lastFake!.finishIceGathering()
    await offerPromise
    await peer.acceptAnswer('fake')
    // Channel opens after the answer is set
    lastFake!.channel!.open()
    expect(peer.state).toBe<PeerState>('connected')
    expect(states).toContain('connected')
  })

  it('send() encodes a PhoneMessage and writes it to the open channel', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const offerPromise = peer.createOffer()
    lastFake!.finishIceGathering()
    await offerPromise
    await peer.acceptAnswer('fake')
    lastFake!.channel!.open()
    const msg: PhoneMessage = { type: 'commit', t: 12345 }
    peer.send(msg)
    expect(lastFake!.channel!.sent).toEqual(['{"type":"commit","t":12345}'])
  })

  it('send() throws if the channel is not open', () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    expect(() => peer.send({ type: 'commit', t: 1 })).toThrow()
  })

  it('onMessage receives decoded PhoneMessages from the channel', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const got: PhoneMessage[] = []
    peer.onMessage((m) => got.push(m))
    const offerPromise = peer.createOffer()
    lastFake!.finishIceGathering()
    await offerPromise
    await peer.acceptAnswer('fake')
    lastFake!.channel!.open()
    lastFake!.channel!.deliver('{"type":"commit","t":42}')
    expect(got).toEqual([{ type: 'commit', t: 42 }])
  })

  it('onMessage silently drops invalid JSON / unknown shapes', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const got: PhoneMessage[] = []
    peer.onMessage((m) => got.push(m))
    const offerPromise = peer.createOffer()
    lastFake!.finishIceGathering()
    await offerPromise
    await peer.acceptAnswer('fake')
    lastFake!.channel!.open()
    lastFake!.channel!.deliver('not json')
    lastFake!.channel!.deliver('{"type":"unknown","t":1}')
    expect(got).toEqual([])
  })

  it('close() tears down the underlying connection and moves to closed', () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    peer.close()
    expect(peer.state).toBe<PeerState>('closed')
    expect(lastFake!.connectionState).toBe('closed')
  })
})

describe('createPeer — answerer (phone) flow', () => {
  it('acceptOffer sets the remote description, creates an answer, and waits for ICE', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const answerPromise = peer.acceptOffer('v=0\r\nfake-offer\r\n')
    expect(peer.state).toBe<PeerState>('gathering_answer')
    lastFake!.finishIceGathering()
    const sdp = await answerPromise
    expect(sdp).toContain('v=0')
    expect(lastFake!.remoteDescription?.type).toBe('offer')
    expect(lastFake!.localDescription?.type).toBe('answer')
  })

  it('routes the incoming DataChannel through ondatachannel', async () => {
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const answerPromise = peer.acceptOffer('fake-offer')
    lastFake!.finishIceGathering()
    await answerPromise
    // The remote side delivers the DataChannel
    const remoteCh = lastFake!.receiveRemoteChannel()
    remoteCh.open()
    expect(peer.state).toBe<PeerState>('connected')
    peer.send({ type: 'commit', t: 7 })
    expect(remoteCh.sent).toEqual(['{"type":"commit","t":7}'])
  })

  it('does not regress state to connecting if the channel opens during ICE gathering', async () => {
    // Race-fix regression: ondatachannel + onopen firing before acceptOffer
    // resolves must not overwrite the resulting 'connected' state.
    const peer = createPeer({ peerConnectionFactory: fakeFactory })
    const answerPromise = peer.acceptOffer('fake-offer')
    // Simulate the remote DataChannel arriving and opening *before* ICE
    // gathering finishes (the offerer's channel is created up front).
    const remoteCh = lastFake!.receiveRemoteChannel()
    remoteCh.open()
    expect(peer.state).toBe<PeerState>('connected')
    // Now ICE completes — acceptOffer resolves but must not regress.
    lastFake!.finishIceGathering()
    await answerPromise
    expect(peer.state).toBe<PeerState>('connected')
  })
})

describe('createPeer — STUN configuration', () => {
  it('passes the default STUN server to RTCPeerConnection', () => {
    const seen: RTCConfiguration[] = []
    const factory = (config?: RTCConfiguration): RTCPeerConnection => {
      if (config) seen.push(config)
      return new FakePeerConnection(config) as unknown as RTCPeerConnection
    }
    createPeer({ peerConnectionFactory: factory })
    expect(seen[0]?.iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ])
  })

  it('respects a caller-supplied iceServers override', () => {
    const seen: RTCConfiguration[] = []
    const factory = (config?: RTCConfiguration): RTCPeerConnection => {
      if (config) seen.push(config)
      return new FakePeerConnection(config) as unknown as RTCPeerConnection
    }
    createPeer({
      peerConnectionFactory: factory,
      iceServers: [{ urls: 'stun:custom.example:3478' }],
    })
    expect(seen[0]?.iceServers).toEqual([
      { urls: 'stun:custom.example:3478' },
    ])
  })
})

describe('createPeer — invariants', () => {
  it('treats a peer as a single-use handle for offerer and answerer roles', async () => {
    const peer: PeerHandle = createPeer({ peerConnectionFactory: fakeFactory })
    const offerPromise = peer.createOffer()
    lastFake!.finishIceGathering()
    await offerPromise
    await expect(peer.acceptOffer('x')).rejects.toThrow(/cannot accept offer/i)
  })
})
