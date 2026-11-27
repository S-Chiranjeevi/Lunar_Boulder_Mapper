import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Plug,
  Radar,
  WifiOff,
} from 'lucide-react';
import type { ImageMetadata, ThresholdProfile } from '../types/contracts';

export type ShellRoute = 'workspace' | 'analysis';

interface ShellHeaderProps {
  selectedImage: ImageMetadata | null;
  selectedProfile: ThresholdProfile;
  onSelectProfile: (profile: ThresholdProfile) => void;
  totalBoulders: number;
  safeTerrainPct: number | null;
  onExportReport: () => void;
  apiConnected: boolean | null;
  apiBaseUrl: string;
  onSaveApiBaseUrl: (url: string) => void;
}

const PRESET_PILLS: Array<{ key: ThresholdProfile; label: string }> = [
  { key: 'lander', label: 'VIKRAM-CLASS LANDER' },
  { key: 'rover', label: 'PRAGYAN-CLASS ROVER' },
  { key: 'custom', label: 'CUSTOM' },
];

export function ShellHeader({
  selectedImage,
  selectedProfile,
  onSelectProfile,
  totalBoulders,
  safeTerrainPct,
  onExportReport,
  apiConnected,
  apiBaseUrl,
  onSaveApiBaseUrl,
}: ShellHeaderProps) {
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [draftUrl, setDraftUrl] = useState(apiBaseUrl);

  const resText =
    selectedImage &&
    selectedImage.gsd_x_m_per_px !== null &&
    selectedImage.gsd_y_m_per_px !== null
      ? `RES: ${selectedImage.gsd_x_m_per_px.toFixed(2)} m/px`
      : 'RES: UNSCALED';

  function handleSaveUrl(e: React.FormEvent) {
    e.preventDefault();
    onSaveApiBaseUrl(draftUrl);
    setShowApiConfig(false);
  }

  return (
    <header className="relative z-40 border-b border-sky-400/20 bg-[#07090e]/95 backdrop-blur-md shrink-0">
      <div className="min-h-[56px] lg:h-[56px] px-3 sm:px-4 py-2 lg:py-0 flex flex-wrap lg:flex-nowrap items-center justify-between gap-2">
        {/* Left: Mission Badge, Active Lunar Dataset, Live Resolution */}
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-400/35 shrink-0">
            <Radar className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-mono text-[10px] xl:text-[11px] font-semibold tracking-wider text-sky-200 whitespace-nowrap">
              SW-1 // LUNAR BOULDER HAZARD MAPPER
            </span>
          </div>

          <div className="hidden 2xl:flex items-center gap-1.5 text-xs font-mono min-w-0">
            <span className="text-slate-400">SCENE:</span>
            <span className="text-slate-100 truncate max-w-[140px]">
              {selectedImage?.source_image_id ?? 'STANDBY'}
            </span>
          </div>

          <span className="px-2 py-0.5 rounded bg-slate-900 border border-sky-400/20 font-mono text-[10px] text-sky-300 whitespace-nowrap shrink-0">
            {resText}
          </span>

          <button
            type="button"
            onClick={() => {
              setDraftUrl(apiBaseUrl);
              setShowApiConfig((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] border transition cursor-pointer whitespace-nowrap shrink-0 ${
              apiConnected === true
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : apiConnected === false
                  ? 'bg-slate-900 border-amber-500/35 text-amber-200'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
            title="Configure FastAPI Backend URL"
          >
            {apiConnected === true ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : apiConnected === false ? (
              <WifiOff className="w-3 h-3 text-amber-400" />
            ) : (
              <Plug className="w-3 h-3" />
            )}
            <span>
              {apiConnected === true
                ? 'API LIVE'
                : apiConnected === false
                  ? 'STATIC HUD'
                  : 'CHECKING'}
            </span>
          </button>
        </div>

        {/* Center: Mission Preset Switcher Pills */}
        <div
          role="group"
          aria-label="Mission vehicle class preset"
          className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900/90 border border-sky-400/20 shrink-0"
        >
          {PRESET_PILLS.map((pill) => {
            const active = selectedProfile === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                onClick={() => onSelectProfile(pill.key)}
                className={`px-2 py-1 rounded-md font-mono text-[10px] font-medium tracking-wide transition cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/25 text-sky-200 border border-sky-400/60 shadow-[0_0_12px_rgba(56,189,248,0.28)]'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        {/* Right: Telemetry Counters & Export CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden xl:flex items-center gap-1.5 font-mono text-[10px] whitespace-nowrap">
            <div className="px-2 py-1 rounded-md bg-slate-900/90 border border-slate-700/80 whitespace-nowrap">
              <span className="text-slate-400 mr-1">BOULDERS</span>
              <span className="text-sky-300 font-semibold">{totalBoulders}</span>
            </div>
            <div className="px-2 py-1 rounded-md bg-slate-900/90 border border-slate-700/80 whitespace-nowrap">
              <span className="text-slate-400 mr-1">SAFE</span>
              <span className="text-emerald-300 font-semibold">
                {safeTerrainPct !== null ? `${safeTerrainPct.toFixed(1)}%` : '--%'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onExportReport}
            disabled={!selectedImage}
            className="ms-btn-primary text-[10px] font-mono tracking-wide py-1.5 px-2.5 whitespace-nowrap"
            title="Export screening report JSON (image_px or lunar_local_m, non-Earth)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>EXPORT GEOJSON / REPORT</span>
          </button>
        </div>
      </div>

      {showApiConfig && (
        <form
          onSubmit={handleSaveUrl}
          className="px-4 py-2.5 bg-slate-950/95 border-t border-sky-400/20 flex flex-col sm:flex-row sm:items-center gap-2 text-xs"
        >
          <label className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="font-mono text-[11px] text-sky-300 shrink-0">
              FASTAPI ENDPOINT:
            </span>
            <input
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="Leave blank for same-origin /api, or enter https://your-api.example.com"
              className="ms-input text-xs font-mono py-1"
            />
          </label>
          <div className="flex items-center gap-2 shrink-0">
            <button type="submit" className="ms-btn-primary text-xs py-1 px-3">
              Connect
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftUrl('');
                onSaveApiBaseUrl('');
                setShowApiConfig(false);
              }}
              className="ms-btn-secondary text-xs py-1 px-3"
            >
              Reset
            </button>
          </div>
        </form>
      )}
    </header>
  );
}
