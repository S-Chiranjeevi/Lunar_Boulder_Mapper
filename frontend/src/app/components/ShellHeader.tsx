import { AlertTriangle, CheckCircle2, Compass, Layers, PlugZap, UploadCloud, WifiOff } from 'lucide-react';
import type { ImageMetadata, JobStatusResponse } from '../types/contracts';

export type ShellRoute = 'workspace' | 'analysis';

interface ShellHeaderProps {
  activeRoute: ShellRoute;
  onNavigate: (route: ShellRoute) => void;
  selectedImage: ImageMetadata | null;
  activeJob: JobStatusResponse | null;
  apiConnected: boolean | null;
  onOpenApiModal: () => void;
}

export function ShellHeader({
  activeRoute,
  onNavigate,
  selectedImage,
  activeJob,
  apiConnected,
  onOpenApiModal,
}: ShellHeaderProps) {
  const step1Done = Boolean(selectedImage);
  const step2Done = activeJob?.status === 'completed';
  const step3Active = activeRoute === 'analysis' || step2Done;

  return (
    <header className="border-b border-slate-800/80 bg-[#080c14]/90 backdrop-blur-md sticky top-0 z-30">
      {/* Subtle honest screening-only strip */}
      <div className="bg-amber-950/40 border-b border-amber-500/20 px-4 py-1.5 text-[11px] sm:text-xs text-amber-200/95">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              <strong>Screening Aid Only:</strong> Thresholds &amp; model outputs are illustrative and
              unvalidated — not a landing or traverse safety guarantee.
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-amber-300/85 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25">
            LRO LROC NAC
          </span>
        </div>
      </div>

      {/* Main navigation bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-indigo-500/15 border border-sky-400/35 flex items-center justify-center text-sky-300 shadow-inner">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-slate-50">
                  MoonSafe
                </h1>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-400/25">
                  Lunar Hazard Screener
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Upload LROC NAC imagery, run boulder detection, and inspect risk cells
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenApiModal}
            className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-slate-700 bg-slate-900/90 text-slate-200"
          >
            {apiConnected === false ? (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <PlugZap className="w-3.5 h-3.5 text-sky-400" />
            )}
            <span>API</span>
          </button>
        </div>

        {/* Guided 3-step indicator (desktop) */}
        <div className="hidden xl:flex items-center gap-2 text-[11px] font-medium text-slate-400 bg-slate-900/60 border border-slate-800/80 rounded-full px-3 py-1.5">
          <span className={`inline-flex items-center gap-1.5 ${step1Done ? 'text-emerald-300' : 'text-sky-300'}`}>
            {step1Done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className="w-4 h-4 rounded-full bg-sky-500/20 border border-sky-400/40 text-[10px] flex items-center justify-center">1</span>}
            Select NAC
          </span>
          <span className="text-slate-600">→</span>
          <span className={`inline-flex items-center gap-1.5 ${step2Done ? 'text-emerald-300' : step1Done ? 'text-sky-300' : 'text-slate-500'}`}>
            {step2Done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className="w-4 h-4 rounded-full bg-slate-800 border border-slate-700 text-[10px] flex items-center justify-center">2</span>}
            Detect Boulders
          </span>
          <span className="text-slate-600">→</span>
          <span className={`inline-flex items-center gap-1.5 ${step3Active ? 'text-sky-300' : 'text-slate-500'}`}>
            <span className="w-4 h-4 rounded-full bg-slate-800 border border-slate-700 text-[10px] flex items-center justify-center">3</span>
            Screen Risk Map
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenApiModal}
            className={`hidden lg:inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition cursor-pointer ${
              apiConnected === true
                ? 'bg-emerald-950/40 border-emerald-500/35 text-emerald-200 hover:bg-emerald-950/60'
                : apiConnected === false
                  ? 'bg-amber-950/50 border-amber-500/45 text-amber-200 hover:bg-amber-950/70'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
            title="Configure or test the FastAPI backend URL"
          >
            {apiConnected === true ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
            ) : apiConnected === false ? (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <PlugZap className="w-3.5 h-3.5 text-sky-400" />
            )}
            <span>
              {apiConnected === true
                ? 'API Connected'
                : apiConnected === false
                  ? 'Connect API'
                  : 'API Setup'}
            </span>
          </button>

          <nav aria-label="Workspace views" className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition cursor-pointer ${
                activeRoute === 'workspace'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <UploadCloud className="w-4 h-4" />
              <span>Workspace</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('analysis')}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition cursor-pointer ${
                activeRoute === 'analysis'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Screening Map</span>
              {(selectedImage || activeJob) && (
                <span className="w-2 h-2 rounded-full bg-sky-300" aria-hidden="true" />
              )}
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}
