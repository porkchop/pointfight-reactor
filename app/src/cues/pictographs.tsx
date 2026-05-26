export interface PictographProps {
  className?: string
}

const VIEWBOX = '0 0 120 160'
const BODY_STROKE = 'var(--gym-fg)'
const ACCENT = 'var(--gym-accent)'
const DANGER = 'var(--gym-bad)'
const WARN = 'var(--gym-warn)'

function BaseFigure({
  bodyTransform,
  legTransform,
  armTransform,
  className,
  children,
}: {
  bodyTransform?: string
  legTransform?: string
  armTransform?: string
  className?: string
  children?: React.ReactNode
}) {
  return (
    <svg
      className={className}
      viewBox={VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g
        stroke={BODY_STROKE}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      >
        <g transform={bodyTransform}>
          <circle cx="60" cy="22" r="14" />
          <line x1="60" y1="36" x2="60" y2="86" />
          <g transform={armTransform}>
            <line x1="60" y1="50" x2="36" y2="74" />
            <line x1="60" y1="50" x2="84" y2="74" />
          </g>
          <g transform={legTransform}>
            <line x1="60" y1="86" x2="42" y2="132" />
            <line x1="60" y1="86" x2="78" y2="132" />
          </g>
        </g>
      </g>
      {children}
    </svg>
  )
}

export function StepsInPictograph({ className }: PictographProps) {
  return (
    <BaseFigure className={`${className ?? ''} cue-steps-in`}>
      <path
        d="M 86 132 L 110 132 M 102 124 L 110 132 L 102 140"
        stroke={ACCENT}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
    </BaseFigure>
  )
}

export function BlitzesPictograph({ className }: PictographProps) {
  return (
    <BaseFigure className={`${className ?? ''} cue-blitzes`}>
      <g stroke={DANGER} strokeWidth="5" strokeLinecap="round">
        <line x1="14" y1="58" x2="40" y2="58" />
        <line x1="10" y1="80" x2="38" y2="80" />
        <line x1="14" y1="102" x2="40" y2="102" />
      </g>
    </BaseFigure>
  )
}

export function LiftsLegPictograph({ className }: PictographProps) {
  return (
    <svg
      className={`${className ?? ''} cue-lifts-leg`}
      viewBox={VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g
        stroke={BODY_STROKE}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      >
        <circle cx="60" cy="22" r="14" />
        <line x1="60" y1="36" x2="60" y2="86" />
        <line x1="60" y1="50" x2="36" y2="74" />
        <line x1="60" y1="50" x2="84" y2="74" />
        <line x1="60" y1="86" x2="78" y2="132" />
      </g>
      <g
        className="cue-leg-lift"
        stroke={WARN}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      >
        <line x1="60" y1="86" x2="42" y2="110" />
        <line x1="42" y1="110" x2="32" y2="92" />
      </g>
    </svg>
  )
}

export function DropsHandPictograph({ className }: PictographProps) {
  return (
    <svg
      className={`${className ?? ''} cue-drops-hand`}
      viewBox={VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g
        stroke={BODY_STROKE}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      >
        <circle cx="60" cy="22" r="14" />
        <line x1="60" y1="36" x2="60" y2="86" />
        <line x1="60" y1="50" x2="84" y2="74" />
        <line x1="60" y1="86" x2="42" y2="132" />
        <line x1="60" y1="86" x2="78" y2="132" />
      </g>
      <g
        className="cue-arm-drop"
        stroke={ACCENT}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      >
        <line x1="60" y1="50" x2="36" y2="78" />
      </g>
    </svg>
  )
}

export function RetreatsPictograph({ className }: PictographProps) {
  return (
    <BaseFigure className={`${className ?? ''} cue-retreats`}>
      <path
        d="M 34 132 L 10 132 M 18 124 L 10 132 L 18 140"
        stroke={ACCENT}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
    </BaseFigure>
  )
}

export function FreezesPictograph({ className }: PictographProps) {
  return (
    <BaseFigure className={`${className ?? ''} cue-freezes`}>
      <g fill={WARN}>
        <rect x="6" y="60" width="10" height="40" rx="2" />
        <rect x="104" y="60" width="10" height="40" rx="2" />
      </g>
    </BaseFigure>
  )
}

export function FakeStepsPictograph({ className }: PictographProps) {
  return (
    <BaseFigure className={`${className ?? ''} cue-fake-steps`}>
      <path
        d="M 24 132 L 96 132 M 32 124 L 24 132 L 32 140 M 88 124 L 96 132 L 88 140"
        stroke={DANGER}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </BaseFigure>
  )
}

export function NoGoBaitPictograph({ className }: PictographProps) {
  return (
    <svg
      className={`${className ?? ''} cue-no-go-bait`}
      viewBox={VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g
        stroke={BODY_STROKE}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      >
        <circle cx="60" cy="22" r="14" />
        <line x1="60" y1="36" x2="60" y2="86" />
        <line x1="60" y1="50" x2="36" y2="74" />
        <line x1="60" y1="50" x2="84" y2="74" />
        <line x1="60" y1="86" x2="42" y2="132" />
        <line x1="60" y1="86" x2="78" y2="132" />
      </g>
      <g stroke={DANGER} strokeWidth="7" fill="none">
        <circle cx="60" cy="78" r="56" />
        <line x1="22" y1="40" x2="98" y2="116" />
      </g>
    </svg>
  )
}
