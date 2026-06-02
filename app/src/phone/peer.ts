import {
  decodePhoneMessage,
  encodePhoneMessage,
  type PhoneMessage,
} from './wire'

export type PeerState =
  | 'idle'
  | 'gathering_offer'
  | 'awaiting_answer'
  | 'gathering_answer'
  | 'connecting'
  | 'connected'
  | 'closed'
  | 'error'

export type PeerConnectionFactory = (
  config?: RTCConfiguration,
) => RTCPeerConnection

export interface CreatePeerOptions {
  /** Override RTCPeerConnection construction for tests. */
  peerConnectionFactory?: PeerConnectionFactory
  /** Custom ICE servers; defaults to a single public Google STUN. */
  iceServers?: RTCIceServer[]
  /** DataChannel label; both ends must agree. */
  channelLabel?: string
}

export interface PeerHandle {
  readonly state: PeerState
  createOffer(): Promise<string>
  acceptOffer(offerSdp: string): Promise<string>
  acceptAnswer(answerSdp: string): Promise<void>
  send(msg: PhoneMessage): void
  onMessage(handler: (msg: PhoneMessage) => void): () => void
  onStateChange(handler: (state: PeerState) => void): () => void
  close(): void
}

const DEFAULT_STUN: RTCIceServer = {
  urls: 'stun:stun.l.google.com:19302',
}
const DEFAULT_LABEL = 'pointfight-phone'

// Some Chromium builds gather host+srflx candidates within tens of ms and
// then never transition `iceGatheringState` to 'complete' nor fire the null
// end-of-candidates marker — leaving `createOffer` hung indefinitely. Once
// any candidate has arrived we have enough to dial on the LAN, so fall back
// to whatever has been gathered after this grace window.
const WAIT_FOR_FIRST_CANDIDATE_FALLBACK_MS = 1500

export function createPeer(opts: CreatePeerOptions = {}): PeerHandle {
  const factory: PeerConnectionFactory =
    opts.peerConnectionFactory ??
    ((config) => new RTCPeerConnection(config))

  const pc = factory({
    iceServers: opts.iceServers ?? [DEFAULT_STUN],
  })

  const channelLabel = opts.channelLabel ?? DEFAULT_LABEL
  let state: PeerState = 'idle'
  let role: 'offerer' | 'answerer' | null = null
  let channel: RTCDataChannel | null = null
  const messageHandlers = new Set<(msg: PhoneMessage) => void>()
  const stateHandlers = new Set<(state: PeerState) => void>()

  function setState(next: PeerState): void {
    if (state === next) return
    state = next
    for (const h of stateHandlers) h(next)
  }

  function bindChannel(ch: RTCDataChannel): void {
    channel = ch
    ch.onopen = () => {
      if (state !== 'closed' && state !== 'error') setState('connected')
    }
    ch.onclose = () => {
      if (state !== 'error') setState('closed')
    }
    ch.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return
      const msg = decodePhoneMessage(ev.data)
      if (!msg) return
      for (const h of messageHandlers) h(msg)
    }
  }

  pc.onconnectionstatechange = () => {
    const cs = pc.connectionState
    if (cs === 'connected' && state !== 'connected') setState('connecting')
    else if (cs === 'failed') setState('error')
    else if (cs === 'closed' && state !== 'closed') setState('closed')
  }

  pc.ondatachannel = (ev: RTCDataChannelEvent) => {
    bindChannel(ev.channel)
  }

  async function waitForIceComplete(): Promise<void> {
    if (pc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      let settled = false
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (settled) return
        settled = true
        pc.onicegatheringstatechange = null
        pc.onicecandidate = null
        if (fallbackTimer !== null) clearTimeout(fallbackTimer)
        resolve()
      }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') finish()
      }
      pc.onicecandidate = (ev: RTCPeerConnectionIceEvent) => {
        if (ev.candidate === null) {
          finish()
          return
        }
        if (fallbackTimer === null) {
          fallbackTimer = setTimeout(finish, WAIT_FOR_FIRST_CANDIDATE_FALLBACK_MS)
        }
      }
    })
  }

  async function createOffer(): Promise<string> {
    if (role !== null) throw new Error('peer already in use')
    role = 'offerer'
    channel = pc.createDataChannel(channelLabel)
    bindChannel(channel)
    setState('gathering_offer')
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await waitForIceComplete()
    setState('awaiting_answer')
    return pc.localDescription?.sdp ?? offer.sdp ?? ''
  }

  async function acceptOffer(offerSdp: string): Promise<string> {
    if (role !== null) throw new Error('cannot accept offer: peer already in use')
    role = 'answerer'
    setState('gathering_answer')
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await waitForIceComplete()
    // Guard against the ondatachannel + onopen race: if the remote channel
    // already opened during ICE gathering, state is already 'connected' and
    // must not regress to 'connecting'.
    if (state === 'gathering_answer') setState('connecting')
    return pc.localDescription?.sdp ?? answer.sdp ?? ''
  }

  async function acceptAnswer(answerSdp: string): Promise<void> {
    if (role !== 'offerer') throw new Error('only the offerer can accept an answer')
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    setState('connecting')
  }

  function send(msg: PhoneMessage): void {
    if (!channel || channel.readyState !== 'open') {
      throw new Error('phone DataChannel is not open')
    }
    channel.send(encodePhoneMessage(msg))
  }

  function onMessage(handler: (msg: PhoneMessage) => void): () => void {
    messageHandlers.add(handler)
    return () => messageHandlers.delete(handler)
  }

  function onStateChange(handler: (state: PeerState) => void): () => void {
    stateHandlers.add(handler)
    return () => stateHandlers.delete(handler)
  }

  function close(): void {
    try {
      channel?.close()
    } catch {
      /* ignore */
    }
    try {
      pc.close()
    } catch {
      /* ignore */
    }
    setState('closed')
  }

  return {
    get state() {
      return state
    },
    createOffer,
    acceptOffer,
    acceptAnswer,
    send,
    onMessage,
    onStateChange,
    close,
  }
}
