import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  Layers,
  Plug,
  UploadCloud,
  WifiOff,
} from 'lucide-react';
import type { ImageMetadata } from '../types/contracts';

export type ShellRoute = 'workspace' | 'analysis';

interface ShellHeaderProps {
  activeRoute: ShellRoute;
  onNavigate: (route: ShellRoute) => void;
  selectedImage: ImageMetadata | null;
  hasActiveJob: boolean;
  hasCompletedResults: boolean;
  apiConnected: boolean | null;
  apiBaseUrl: string;
  onSaveApiBaseUrl: (url: string) => void;
}

export function ShellHeader({
  activeRoute,
  onNavigate,
  selectedImage,
  hasActiveJob,
  hasCompletedResults,
  apiConnected,
  apiBaseUrl,
  onSaveApiBaseUrl,
}: ShellHeaderProps) {
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [draftUrl, setDraftUrl] = useState(apiBaseUrl);

  const step1Done = Boolean(selectedImage);
  const step2Done = hasActiveJob || hasCompletedResults;
  const step3Active = activeRoute === 'analysis' && Boolean(selectedImage);

  function handleSaveUrl(e: React.FormEvent) {
    e.preventDefault();
    onSaveApiBaseUrl(draftUrl);
    setShowApiConfig(false);
  }

  return (
    <header className="border-b border-slate-800/80 bg-[#0d111a]/95 backdrop-blur sticky top-0 z-30">
      {/* Honest prototype / screening-only strip */}
      <div className="bg-amber-950/50 border-b border-amber-500/25 px-4 py-1.5 text-xs text-amber-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate sm:whitespace-normal">
            <strong>Screening Prototype:</strong> Boulder detections &amp; hazard thresholds are
            illustrative screening aids only — not mission-certified landing or traverse guidance.
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-900/50 border border-amber-500/30 text-amber-200 shrink-0 whitespace-nowrap">
          LRO NAC MVP
        </span>
      </div>

      {/* Main navigation bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/35 flex items-center justify-center text-sky-300 shrink-0">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-slate-100">
                  MoonSafe
                </h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-950/70 text-sky-300 border border-sky-500/30">
                  Lunar Boulder Hazard Mapper
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Detect surface boulders, convert pixel scale to metres, and screen lander/rover risk
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraftUrl(apiBaseUrl);
                setShowApiConfig((prev) => !prev);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                apiConnected === true
                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/35 hover:bg-emerald-950/80'
                  : apiConnected === false
                    ? 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
                    : 'bg-slate-900 text-slate-400 border-slate-700'
              }`}
              title="Configure backend FastAPI URL"
            >
              {apiConnected === true ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : apiConnected === false ? (
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Plug className="w-3.5 h-3.5" />
              )}
              <span>
                {apiConnected === true
                  ? 'API Connected'
                  : apiConnected === false
                    ? 'Static Preview Mode'
                    : 'Checking API…'}
              </span>
            </button>

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
                <span>Workspace</span>
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
                <span>2D Hazard Map</span>
                {(selectedImage || hasActiveJob) && (
                  <span className="ml-0.5 w-2 h-2 rounded-full bg-sky-300" aria-hidden="true" />
                )}
              </button>
            </nav>
          </div>
        </div>

        {/* Guided 3-step progress bar */}
        <ol
          aria-label="Workflow progress"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-2 border-t border-slate-800/70"
        >
          <li
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
              step1Done
                ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                : activeRoute === 'workspace'
                  ? 'bg-sky-950/35 border-sky-500/35 text-sky-100'
                  : 'bg-slate-900/50 border-slate-800 text-slate-400'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center font-mono text-[11px] shrink-0">
              1
            </span>
            <span className="truncate">Upload or Select NAC Image</span>
          </li>
          <li
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
              step2Done
                ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                : step1Done
                  ? 'bg-sky-950/35 border-sky-500/35 text-sky-100'
                  : 'bg-slate-900/50 border-slate-800 text-slate-400'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center font-mono text-[11px] shrink-0">
              2
            </span>
            <span className="truncate">Choose Lander / Rover &amp; Run</span>
          </li>
          <li
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
              step3Active
                ? 'bg-sky-950/35 border-sky-500/35 text-sky-100'
                : hasCompletedResults
                  ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                  : 'bg-slate-900/50 border-slate-800 text-slate-400'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center font-mono text-[11px] shrink-0">
              3
            </span>
            <span className="truncate">Inspect Interactive 2D Hazard Map</span>
          </li>
        </ol>

        {showApiConfig && (
          <form
            onSubmit={handleSaveUrl}
            className="ms-panel-elevated p-3 flex flex-col sm:flex-row sm:items-center gap-2 text-xs"
          >
            <label className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-slate-300 font-medium shrink-0">FastAPI Backend URL:</span>
              <input
                type="url"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="Leave blank for same-origin /api, or enter https://your-api.example.com"
                className="ms-input text-xs font-mono py-1.5"
              />
            </label>
            <div className="flex items-center gap-2 shrink-0">
              <button type="submit" className="ms-btn-primary text-xs py-1.5 px-3">
                Save &amp; Connect
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftUrl('');
                  onSaveApiBaseUrl('');
                  setShowApiConfig(false);
                }}
                className="ms-btn-secondary text-xs py-1.5 px-3"
              >
                Reset
              </button>
            </div>
          </form>
        )}
      </div>
    </header>
  );
}
