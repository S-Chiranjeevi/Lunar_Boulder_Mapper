/**
 * Tabular list of detections with confidence, size, and position.
 */
import type { Detection } from '../../types/api'

interface Props {
  detections: Detection[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'text-green-400'
  if (c >= 0.5) return 'text-yellow-400'
  return 'text-red-400'
}

export function DetectionList({ detections, selectedId, onSelect }: Props) {
  if (detections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-moon-600 text-sm gap-2">
        <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" strokeWidth={1.5}/>
          <path strokeLinecap="round" strokeWidth={1.5} d="M21 21l-4.35-4.35"/>
        </svg>
        No boulders detected.
        {/* Model in stub mode → clarify */}
        <p className="text-xs text-moon-700 text-center max-w-xs">
          If running in stub mode (no model loaded), zero detections are
          expected. Load a trained YOLOv8 weight file to run real inference.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-moon-500 border-b border-moon-800">
            <th className="text-left py-1.5 px-2 font-medium">#</th>
            <th className="text-right py-1.5 px-2 font-medium">Conf.</th>
            <th className="text-right py-1.5 px-2 font-medium">Size</th>
            <th className="text-right py-1.5 px-2 font-medium">X</th>
            <th className="text-right py-1.5 px-2 font-medium">Y</th>
            <th className="text-left py-1.5 px-2 font-medium">Frame</th>
          </tr>
        </thead>
        <tbody>
          {detections.map((d, i) => (
            <tr
              key={d.detection_id}
              onClick={() => onSelect(d.detection_id)}
              className={[
                'cursor-pointer border-b border-moon-900 transition-colors',
                selectedId === d.detection_id
                  ? 'bg-moon-700/60'
                  : 'hover:bg-moon-800/40',
              ].join(' ')}
            >
              <td className="py-1.5 px-2 text-moon-500">{i + 1}</td>
              <td className={`py-1.5 px-2 text-right ${confidenceColor(d.confidence)}`}>
                {(d.confidence * 100).toFixed(1)}%
              </td>
              <td className="py-1.5 px-2 text-right text-moon-300">
                {d.estimated_size_m != null
                  ? `${d.estimated_size_m.toFixed(2)} m`
                  : '—'}
              </td>
              <td className="py-1.5 px-2 text-right text-moon-400">
                {d.position.x.toFixed(1)}
              </td>
              <td className="py-1.5 px-2 text-right text-moon-400">
                {d.position.y.toFixed(1)}
              </td>
              <td className="py-1.5 px-2 text-moon-600">
                {d.position.frame === 'lunar_local_m' ? 'm' : 'px'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
