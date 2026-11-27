import {
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  ILLUSTRATIVE_PROFILES,
  type ImageMetadata,
  type ThresholdConfig,
  type ThresholdProfile,
} from '../types/contracts';

interface ImageLibraryPanelProps {
  images: ImageMetadata[];
  isLoading: boolean;
  error: string | null;
  errorStatus: number | null;
  errorCode?: string;
  selectedImageId: string | null;
  selectedProfile: ThresholdProfile;
  customThresholds: ThresholdConfig;
  onChangeCustomThresholds: (next: ThresholdConfig) => void;
  isStartingJob: boolean;
  jobStartError: string | null;
  onRefresh: () => void;
  onSelectImage: (imageId: string) => void;
  onSelectProfile: (profile: ThresholdProfile) => void;
  onStartJob: () => void;
}

const COVERAGE_BADGE_CLASSES: Record<ImageMetadata['coverage'], string> = {
  valid: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/30',
  partial: 'bg-amber-950/70 text-amber-300 border-amber-500/30',
  missing: 'bg-slate-800 text-slate-300 border-slate-600/50',
};

export function ImageLibraryPanel({
  images,
  isLoading,
  error,
  errorStatus,
  errorCode,
  selectedImageId,
  selectedProfile,
  customThresholds,
  onChangeCustomThresholds,
  isStartingJob,
  jobStartError,
  onRefresh,
  onSelectImage,
  onSelectProfile,
  onStartJob,
}: ImageLibraryPanelProps) {
  const selectedImage = images.find((img) => img.image_id === selectedImageId) ?? null;
  const isStaticNoBackend =
    !errorCode &&
    (errorStatus === 404 ||
      errorStatus === 0 ||
      errorStatus === 500 ||
      errorStatus === 502 ||
      errorStatus === 503 ||
      errorStatus === 504);

  return (
    <section className="ms-panel p-5 flex flex-col gap-4" aria-labelledby="library-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="library-heading" className="text-base font-semibold text-slate-100">
            2. Select Image &amp; Launch Screening
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Pick an ingested NAC scene and tune Lander or Rover screening thresholds.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="ms-btn-secondary text-xs shrink-0"
          title="Refresh available images"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Loading state */}
      {isLoading && images.length === 0 && (
        <div className="ms-panel-elevated p-6 flex flex-col items-center justify-center gap-2 text-center">
          <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
          <p className="text-sm text-slate-200">Connecting to MoonSafe image library…</p>
        </div>
      )}

      {/* Calm offline/static-host notice vs real server error */}
      {!isLoading && error && isStaticNoBackend && (
        <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-amber-200 text-sm font-medium">
            <Plug className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Backend API Not Connected on This Host</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            This static web preview does not host the FastAPI/YOLO server. To run boulder detection,
            click <strong>Static Preview Mode</strong> in the header to point to your running
            FastAPI URL, or drop a PNG/JPEG on the left and click{' '}
            <strong>Preview in 2D Map</strong> to inspect it locally.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onRefresh} className="ms-btn-secondary text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry API Connection</span>
            </button>
          </div>
        </div>
      )}

      {!isLoading && error && !isStaticNoBackend && (
        <div
          role="alert"
          className="bg-red-950/50 border border-red-500/40 rounded-xl p-4 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2 text-red-200 text-sm font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Failed to load image library</span>
          </div>
          <p className="text-xs text-red-200/90">{error}</p>
          <div>
            <button type="button" onClick={onRefresh} className="ms-btn-secondary text-xs mt-1">
              Retry Request
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && images.length === 0 && (
        <div className="ms-panel-elevated p-5 text-center flex flex-col items-center gap-2">
          <ImageIcon className="w-7 h-7 text-slate-500" />
          <p className="text-sm font-medium text-slate-200">No LRO NAC images uploaded yet</p>
          <p className="text-xs text-slate-400 max-w-md">
            Upload a PNG, JPEG, or TIFF image in Step 1 to inspect its metadata and launch a
            screening job.
          </p>
        </div>
      )}

      {/* Image list */}
      {images.length > 0 && (
        <div
          className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1"
          role="listbox"
          aria-label="Available LRO NAC images"
        >
          {images.map((img) => {
            const isSelected = img.image_id === selectedImageId;
            const gsdLabel =
              img.gsd_x_m_per_px !== null && img.gsd_y_m_per_px !== null
                ? `${img.gsd_x_m_per_px} × ${img.gsd_y_m_per_px} m/px`
                : 'GSD unknown';

            return (
              <button
                key={img.image_id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelectImage(img.image_id)}
                className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-sky-950/40 border-sky-400/70'
                    : 'bg-[#0e131d] border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium text-slate-100 truncate">
                        {img.source_image_id}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                      id: {img.image_id}
                    </p>
                  </div>

                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded border shrink-0 ${
                      COVERAGE_BADGE_CLASSES[img.coverage]
                    }`}
                  >
                    coverage: {img.coverage}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 font-mono">
                  <span>
                    {img.width_px}×{img.height_px} px
                  </span>
                  <span>{gsdLabel}</span>
                  <span>
                    {img.coordinate_frame === 'lunar_local_m'
                      ? 'lunar_local_m'
                      : 'image_px (unreferenced)'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Screening Profile & Launch */}
      <div className="border-t border-slate-800 pt-4 flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-200">
              Screening Profile (Lander / Rover / Custom)
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-200">
              unvalidated defaults
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(['lander', 'rover', 'custom'] as ThresholdProfile[]).map((profileKey) => {
              const profile = ILLUSTRATIVE_PROFILES[profileKey];
              const active = selectedProfile === profileKey;
              return (
                <button
                  key={profileKey}
                  type="button"
                  onClick={() => onSelectProfile(profileKey)}
                  className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-sky-950/45 border-sky-400/75 text-slate-100'
                      : 'bg-[#0e131d] border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-semibold capitalize flex items-center justify-between">
                    <span>{profileKey}</span>
                    {profileKey === 'custom' && (
                      <SlidersHorizontal className="w-3 h-3 text-sky-400" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {profileKey === 'custom'
                      ? `${customThresholds.cell_size_m} m cell · ≥${customThresholds.unsafe_boulder_size_m} m`
                      : `${profile.defaults.cell_size_m} m cell · ≥${profile.defaults.unsafe_boulder_size_m} m`}
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-400 mt-1.5">
            {ILLUSTRATIVE_PROFILES[selectedProfile].illustrativeNote}
          </p>

          {/* Editable Custom Threshold Controls */}
          {selectedProfile === 'custom' && (
            <div className="mt-3 ms-panel-elevated p-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Cell size (m)</span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={customThresholds.cell_size_m}
                  onChange={(e) =>
                    onChangeCustomThresholds({
                      ...customThresholds,
                      cell_size_m: Number(e.target.value),
                    })
                  }
                  className="ms-input py-1 px-2 text-xs font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Caution size (m)</span>
                <input
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={customThresholds.caution_boulder_size_m}
                  onChange={(e) =>
                    onChangeCustomThresholds({
                      ...customThresholds,
                      caution_boulder_size_m: Number(e.target.value),
                    })
                  }
                  className="ms-input py-1 px-2 text-xs font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Unsafe size (m)</span>
                <input
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={customThresholds.unsafe_boulder_size_m}
                  onChange={(e) =>
                    onChangeCustomThresholds({
                      ...customThresholds,
                      unsafe_boulder_size_m: Number(e.target.value),
                    })
                  }
                  className="ms-input py-1 px-2 text-xs font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Caution count</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={customThresholds.caution_boulder_count}
                  onChange={(e) =>
                    onChangeCustomThresholds({
                      ...customThresholds,
                      caution_boulder_count: Number(e.target.value),
                    })
                  }
                  className="ms-input py-1 px-2 text-xs font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Unsafe count</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={customThresholds.unsafe_boulder_count}
                  onChange={(e) =>
                    onChangeCustomThresholds({
                      ...customThresholds,
                      unsafe_boulder_count: Number(e.target.value),
                    })
                  }
                  className="ms-input py-1 px-2 text-xs font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Min coverage</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={customThresholds.min_cell_coverage}
                  onChange={(e) =>
                    onChangeCustomThresholds({
                      ...customThresholds,
                      min_cell_coverage: Number(e.target.value),
                    })
                  }
                  className="ms-input py-1 px-2 text-xs font-mono"
                />
              </label>
            </div>
          )}
        </div>

        {/* Visual hazard color legend */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-950/30 border border-emerald-500/25 text-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Safe</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-950/30 border border-amber-500/25 text-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>Caution</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-950/30 border border-red-500/25 text-red-200">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>Unsafe</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-950/30 border border-purple-500/25 text-purple-200">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            <span>Uncertain</span>
          </div>
        </div>

        {jobStartError && (
          <div
            role="alert"
            className="text-xs text-red-200 bg-red-950/60 border border-red-500/40 rounded-lg p-3"
          >
            {jobStartError}
          </div>
        )}

        <button
          type="button"
          onClick={onStartJob}
          disabled={!selectedImage || isStartingJob}
          className="ms-btn-primary w-full"
        >
          {isStartingJob ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Starting Boulder Screening…</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>
                {selectedImage
                  ? `Run Boulder Screening on ${selectedImage.source_image_id}`
                  : 'Run Boulder Screening'}
              </span>
            </>
          )}
        </button>

        {!selectedImage && (
          <p className="text-[11px] text-slate-400 text-center">
            Upload or select an ingested image above to enable screening.
          </p>
        )}
      </div>
    </section>
  );
}
