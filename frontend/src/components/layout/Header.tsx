import type { HealthResponse } from '../../types/api'

interface Props {
  health: HealthResponse | null
}

export function Header({ health }: Props) {
  return (
    <header className="flex items-center justify-between px-6 py-3 bg-moon-900 border-b border-moon-700 select-none">
      <div className="flex items-center gap-3">
        <img src="/moon.svg" alt="Moon" className="w-7 h-7" />
        <span className="text-lg font-semibold tracking-tight text-moon-100">
          MoonSafe
        </span>
        <span className="hidden sm:inline text-xs text-moon-400 ml-1">
          Lunar Boulder Risk Screening
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs font-mono">
        {health == null ? (
          <span className="text-moon-500">connecting…</span>
        ) : health.stub_mode ? (
          <span
            className="px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-700"
            title={health.note}
          >
            stub mode — no model loaded
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded bg-green-900/60 text-green-300 border border-green-700">
            model ready
          </span>
        )}
      </div>
    </header>
  )
}
