import { resolveCueAtDistance, summarize, type ClassifyOutput } from './drill'
import { saveRep, saveSession } from '../store/db'
import type {
  CueDef,
  CueDistanceEntry,
  Distance,
  DrillConfig,
  InputSource,
  RepRecord,
  SessionRecord,
} from './types'

/**
 * Pure rep-minting + persistence boundary shared by `src/store/session.ts`
 * (live drill) and `src/clipmode/runner.ts` (Phase 6.3 clip-mode drill).
 *
 * Phase 6.3 acceptance criterion #1 — "engine/persistence.ts exposes
 * commitRep(...) containing the invariants currently inlined in
 * src/store/session.ts:107-139 (rep-id minting, resolveCueAtDistance,
 * roundIndex + inputSource fan-out, persistSession(null) boundary,
 * feedback hand-off)."
 *
 * The DRY gate (`docs/QUALITY_GATES.md` §"DRY and reuse gate") requires
 * that "if the same logic appears in more than one layer, extract it to
 * a shared module or justify the duplication in a decision memo".
 * `artifacts/decision-memo.md` §"Resolved red-team blockers — Phase 6"
 * concern 1 explicitly mandates this extraction in 6.3.
 */

function newRepId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `rep-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Mints a session id. Single source of truth shared by the live drill
 * (`store/session.ts:start`) and the clip-mode runner
 * (`clipmode/runner.ts:start`) so the id format is consistent across
 * modes — the DRY gate concern that closed code-reviewer B3.
 */
export function mintSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export interface BuildSessionRecordInput {
  sessionId: string
  startedAt: number
  endedAt: number | null
  reps: RepRecord[]
  inputSource: InputSource
  config: DrillConfig
  cleared: number
  penaltyCounterEnabled: boolean
  /** Phase 6.3 — 'live' (default) for live drills; 'clip' for clip-mode. */
  mode?: 'live' | 'clip'
}

/**
 * Builds a `SessionRecord` from session-scoped state. Used by both the
 * live drill and the clip-mode runner so the on-disk session shape stays
 * consistent across both modes; closes code-reviewer B3 (the prior
 * duplicated `persistSession` closures).
 */
export function buildSessionRecord(
  input: BuildSessionRecordInput,
): SessionRecord {
  return {
    id: input.sessionId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    drillType: 'first_beat_go_no_go',
    repCount: input.reps.length,
    summary: summarize(input.reps),
    inputSource: input.inputSource,
    rounds: input.config.rounds,
    workMs: input.config.workMs,
    restMs: input.config.restMs,
    cleared: input.cleared,
    penaltyCounterEnabled: input.penaltyCounterEnabled,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
  }
}

/**
 * Builds a `SessionRecord` and persists it via `saveSession`, swallowing
 * errors into the optional `onError` callback. Both stores route session
 * progress through this single function so future SessionRecord schema
 * changes only land in one place.
 */
export function persistSessionRecord(
  input: BuildSessionRecordInput,
  onError?: (err: Error) => void,
): void {
  const record = buildSessionRecord(input)
  void saveSession(record).catch((err: unknown) => {
    if (onError) onError(err instanceof Error ? err : new Error(String(err)))
  })
}

export interface CommitRepInput {
  cue: CueDef
  distance: Distance | null
  cueShownAt: number
  pressedAt: number | null
  classification: ClassifyOutput
  sessionId: string
  roundIndex: number
  inputSource: InputSource
  /** Phase 6.3 — set when this rep was recorded against a video clip. */
  clipId?: string
}

export interface CommitRepResult {
  rep: RepRecord
  feedback: { rep: RepRecord; cue: CueDef }
  effective: CueDistanceEntry
}

/**
 * Builds a `RepRecord` from a classification result + the session-level
 * context (sessionId, roundIndex, inputSource, optional clipId) and
 * fires off `saveRep` as a side effect. Returns the built rep + the
 * feedback payload synchronously so callers can update their UI store
 * without awaiting Dexie — preserving the synchronous press → feedback
 * transition the live drill has relied on since Phase 1.
 *
 * The caller (live or clip) is responsible for updating its own store
 * with `result.rep` / `result.feedback` AND for re-saving the session
 * record afterward (session-progress persistence is owned by the caller
 * because the SessionRecord schema differs between live and clip modes —
 * clip mode adds `mode: 'clip'` and may carry per-clip metadata).
 */
export function commitRep(input: CommitRepInput): CommitRepResult {
  const effective = resolveCueAtDistance(input.cue, input.distance)
  const rep: RepRecord = {
    id: newRepId(),
    sessionId: input.sessionId,
    cueId: input.cue.id,
    isGo: effective.isGo,
    result: input.classification.result,
    reactionMs: input.classification.reactionMs,
    score: input.classification.score,
    cueShownAt: input.cueShownAt,
    pressedAt: input.pressedAt,
    roundIndex: input.roundIndex,
    inputSource: input.inputSource,
    ...(input.distance !== null ? { distance: input.distance } : {}),
    ...(input.clipId !== undefined ? { clipId: input.clipId } : {}),
  }
  void saveRep(rep)
  return { rep, feedback: { rep, cue: input.cue }, effective }
}
