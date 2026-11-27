/**
 * Expandable detail card for a single detection.
 */
import type { Detection } from '../../types/api'

interface Props {
  detection: Detection | null
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline py-0.5">
      <span className="text-moon-500 text-xs">{label}</span>
      <span className="text-moon-200 text-xs font-mono">{value}</span>
    </div>
  )
}

export function DetectionDetail({ detection }: Props) {
  if (!detection) {
    return (
      <p className="text-xs text-moon-600 py-4 text-center">
        Select a detection to inspect.
      </p>
    )
  }

  const { position: pos } = detection

  return (
    <div className="flex flex-col gap-1 text-sm">
      <Row label="ID" value={<span className="text-moon-500 text-[10px]">{detection.detection_id.slice(0, 16)}…</span>} />
      <Row label="Confidence" value={`${(detection.confidence * 100).toFixed(1)}%`} />
      <Row
        label="Est. size (2D)"
        value={
          detection.estimated_size_m != null
            ? `${detection.estimated_size_m.toFixed(3)} m`
            : 'unknown (no GSD)'
        }
      />
      <Row
        label="Size uncertainty"
        value={
          detection.size_uncertainty_m != null
            ? `±${detection.size_uncertainty_m.toFixed(3)} m`
            : '—'
        }
      />
      <Row label="Bbox" value={`[${detection.bbox_px.map((v) => v.toFixed(0)).join(', ')}]`} />
      <Row label="Position X" value={`${pos.x.toFixed(2)}`} />
      <Row label="Position Y" value={`${pos.y.toFixed(2)}`} />
      <Row label="Frame" value={pos.frame} />
      <Row
        label="Pos. uncertainty"
        value={pos.uncertainty_m != null ? `±${pos.uncertainty_m.toFixed(2)} m` : '—'}
      />
      <Row label="Model version" value={detection.model_version} />

      {detection.model_version.includes('stub') && (
        <p className="mt-2 text-xs text-amber-500 bg-amber-950/40 border border-amber-800 rounded px-2 py-1">
          This detection came from a stub/unvalidated model. Results are
          illustrative only.
        </p>
      )}

      <p className="mt-2 text-[10px] text-moon-700 leading-relaxed">
        Estimated size is a 2D projected measurement from bounding-box extents
        and GSD. True 3D boulder height is not inferred from 2D imagery.
      </p>
    </div>
  )
}
