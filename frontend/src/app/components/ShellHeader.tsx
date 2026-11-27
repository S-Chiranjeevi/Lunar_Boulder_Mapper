import { AlertTriangle, Compass, Layers, UploadCloud } from 'lucide-react';
import type { ImageMetadata } from '../types/contracts';

export type ShellRoute = 'workspace' | 'analysis';

interface ShellHeaderProps {
  activeRoute: ShellRoute;
  onNavigate: (route: ShellRoute) => void;
  selectedImage: ImageMetadata | null;
  hasActiveJob: boolean;
}

export function ShellHeader({
  activeRoute,
  onNavigate,
  selectedImage,
  hasActiveJob,
}: ShellHeaderProps) {
  return (
    <header className="border-b border-slate-800/80 bg-[#0d111a]/95 backdrop-blur sticky top-0 z-30">
      {/* Honest prototype / screening-only strip */}
      <div className="bg-amber-950/50 border-b border-amber-500/25 px-4 py-1.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            <strong>Screening Prototype:</strong> YOLO boulder model &amp; risk thresholds are
            illustrative/unvalidated until trained and measured. Screening aid only — not a landing
            or traverse safety guarantee.
          </span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wider text-amber-300/90">
          LRO LROC NAC MVP
        </span>
      </div>

      {/* Main navigation bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-slate-100">
                MoonSafe
              </h1>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                v0.1 shell
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Lunar Boulder Detection &amp; Risk-Screening Workspace
            </p>
          </div>
        </div>

        <nav aria-label="Workspace views" className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              activeRoute === 'workspace'
                ? 'bg-sky-600 text-white border border-sky-400/50'
                : 'bg-slate-900 text-slate-300 border border-slate-700/80 hover:bg-slate-800'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Workspace &amp; Ingest</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('analysis')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              activeRoute === 'analysis'
                ? 'bg-sky-600 text-white border border-sky-400/50'
                : 'bg-slate-900 text-slate-300 border border-slate-700/80 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Analysis View</span>
            {(selectedImage || hasActiveJob) && (
              <span className="ml-1 w-2 h-2 rounded-full bg-sky-300" aria-hidden="true" />
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
