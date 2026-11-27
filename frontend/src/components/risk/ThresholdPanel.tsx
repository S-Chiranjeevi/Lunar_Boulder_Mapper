/**
 * Controls for threshold profile, size limits, confidence, and cell size.
 * "Apply" calls PATCH /jobs/{job_id}/thresholds to recalculate risk without
 * re-running detection.
 */
import { useState } from 'react'
import { patchThresholds } from '../../api/client'
import type { ThresholdProfile } from '../../types/api'

interface Props {
  jobId: string | null
  profile: ThresholdProfile
  onUpdated: () => void
}

const PROFILES: ThresholdProfile[] = ['lander', 'rover', 'custom']

const DEFAULT_THRESHOLDS: Record<
  ThresholdProfile,
  { safe: number; caution: number }
> = {
  lander:  { safe: 0.3,  caution: 1.0 },
  rover:   { safe: 0.15, caution: 0.4 },
  custom:  { safe: 0.3,  caution: 1.0 },
}

export function ThresholdPanel({ jobId, profile: initProfile, onUpdated }: Props) {
  const [profile, setProfile] = useState<ThresholdProfile>(initProfile)
  const [safeMax, setSafeMax]       = useState(DEFAULT_THRESHOLDS[initProfile].safe)
  const [cautionMax, setCautionMax] = useState(DEFAULT_THRESHOLDS[initProfile].caution)
  const [minConf, setMinConf]       = useState(0.5)
  const [cellPx, setCellPx]         = useState(64)
  const [applying, setApplying]     = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const onProfileChange = (p: ThresholdProfile) => {
    setProfile(p)
    setSafeMax(DEFAULT_THRESHOLDS[p].safe)
    setCautionMax(DEFAULT_THRESHOLDS[p].caution)
  }

  const apply = async () => {
    if (!jobId) return
    setError(null)
    setApplying(true)
    try {
      await patchThresholds(jobId, {
        threshold_profile: profile,
        safe_max_size_m:   safeMax,
        caution_max_size_m: cautionMax,
        min_confidence:    minConf,
        cell_size_px:      cellPx,
      })
      onUpdated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to apply thresholds')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-moon-400 uppercase tracking-wider">
          Profile
        </label>
        <div className="flex gap-2">
          {PROFILES.map((p) => (
            <button
              key={p}
              onClick={() => onProfileChange(p)}
              className={[
                'px-3 py-1 rounded text-xs capitalize transition-colors border',
                profile === p
                  ? 'bg-moon-700 border-moon-500 text-moon-100'
                  : 'bg-moon-900 border-moon-700 text-moon-400 hover:border-moon-500',
              ].join(' ')}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Slider
          label="Safe max (m)"
          hint="illustrative"
          value={safeMax}
          min={0.05} max={2} step={0.05}
          onChange={setSafeMax}
        />
        <Slider
          label="Caution max (m)"
          hint="illustrative"
          value={cautionMax}
          min={0.1} max={5} step={0.1}
          onChange={setCautionMax}
        />
        <Slider
          label="Min confidence"
          value={minConf}
          min={0} max={1} step={0.05}
          onChange={setMinConf}
        />
        <Slider
          label="Cell size (px)"
          value={cellPx}
          min={16} max={256} step={16}
          onChange={setCellPx}
          format={(v) => `${v}px`}
        />
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <button
        onClick={apply}
        disabled={!jobId || applying}
        className="mt-1 w-full py-2 rounded bg-moon-700 hover:bg-moon-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
      >
        {applying ? 'Applying…' : 'Recalculate Risk'}
      </button>

      <p className="text-xs text-moon-600 leading-relaxed">
        Thresholds are illustrative defaults, not validated against ground
        truth. Recalculating updates the risk map without re-running detection.
      </p>
    </div>
  )
}

// ── Slider helper ─────────────────────────────────────────────────────────────

interface SliderProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}

function Slider({ label, hint, value, min, max, step, onChange, format }: SliderProps) {
  const display = format ? format(value) : value.toFixed(2)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-baseline">
        <label className="text-xs text-moon-400">
          {label}{hint && <span className="text-moon-600 ml-1">({hint})</span>}
        </label>
        <span className="text-xs font-mono text-moon-200">{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-moon-400 h-1"
      />
    </div>
  )
}
