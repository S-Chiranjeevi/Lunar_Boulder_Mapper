/**
 * Shows job status with an animated progress bar while running/queued.
 */
import type { JobStatusResponse } from '../../types/api'

interface Props {
  status: JobStatusResponse | null
  error: string | null
}

const STATUS_LABEL: Record<string, string> = {
  queued:    'Queued…',
  running:   'Detecting boulders…',
  completed: 'Complete',
  failed:    'Failed',
}

export function JobProgress({ status, error }: Props) {
  if (!status && !error) return null

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-400">
        Polling error: {error}
      </div>
    )
  }

  if (!status) return null

  const pct = status.progress_pct ?? 0
  const isTerminal = status.status === 'completed' || status.status === 'failed'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs font-mono">
        <span
          className={
            status.status === 'failed'
              ? 'text-red-400'
              : status.status === 'completed'
              ? 'text-green-400'
              : 'text-moon-300'
          }
        >
          {STATUS_LABEL[status.status] ?? status.status}
        </span>
        {!isTerminal && (
          <span className="text-moon-500">{Math.round(pct)}%</span>
        )}
      </div>

      {!isTerminal && (
        <div className="h-1.5 w-full rounded bg-moon-800 overflow-hidden">
          <div
            className="h-full rounded bg-moon-400 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {status.status === 'failed' && status.error_message && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded px-2 py-1 mt-1">
          {status.error_message}
        </p>
      )}
    </div>
  )
}
