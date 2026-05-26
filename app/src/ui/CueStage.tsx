import { CUE_PALETTE } from '../cues/palette'
import type { CueDef, Distance } from '../engine/types'

interface CueStageProps {
  cue: CueDef
  distance: Distance | null
  textOverlayEnabled: boolean
  keyHint: string
}

const DISTANCE_SCALE: Record<Distance, number> = {
  far: 0.45,
  mid: 0.7,
  in_range: 1.0,
}

export function CueStage({
  cue,
  distance,
  textOverlayEnabled,
  keyHint,
}: CueStageProps) {
  const entry = CUE_PALETTE[cue.id]
  if (!entry) {
    return (
      <div className="cue">
        <span className="cue-label">{cue.label}</span>
      </div>
    )
  }
  const Pictograph = entry.Pictograph
  const scale = distance === null ? 0.85 : DISTANCE_SCALE[distance]

  return (
    <div className="cue cue-stage">
      <div
        className={`cue-pictograph-wrap ${entry.accentClass}`}
        data-distance={distance ?? 'none'}
        style={{ transform: `scale(${scale})` }}
      >
        <Pictograph
          key={`${cue.id}-${distance ?? 'none'}`}
          className={`cue-pictograph ${entry.animationClass}`}
        />
      </div>
      {textOverlayEnabled && (
        <div className="cue-overlay">
          <span className="cue-label">{cue.label}</span>
          {distance && (
            <span className="cue-distance-label">
              {distance === 'in_range' ? 'IN RANGE' : distance.toUpperCase()}
            </span>
          )}
          <span className="cue-sub">
            {cue.isGo ? `Commit (${keyHint})` : 'Hold position'}
          </span>
        </div>
      )}
    </div>
  )
}
