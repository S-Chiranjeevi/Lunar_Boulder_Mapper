import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Compass,
  Image as ImageIcon,
  Loader2,
  Play,
  PlugZap,
  RefreshCw,
  Rocket,
  Search,
  Sliders,
} from 'lucide-react';
import { getImagePreviewUrl } from '../api/client';
import { ILLUSTRATIVE_PROFILES, type ImageMetadata, type ThresholdProfile } from '../types/contracts';

interface ImageLibraryPanelProps {
  images: ImageMetadata[];
  isLoading: boolean;
  error: string | null;
  selectedImageId: string | null;
  selectedProfile: ThresholdProfile;
  isStartingJob: boolean;
  jobStartError: string | null;
  onRefresh: () => void;
  onOpenApiModal: () => void;
  onSelectImage: (imageId: string) => void;
  onSelectProfile: (profile: ThresholdProfile) => void;
  onStartJob: () => void;
}

const COVERAGE_BADGE_CLASSES: Record<ImageMetadata['coverage'], string> = {
  valid: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/35',
  partial: 'bg-amber-950/70 text-amber-300 border-amber-500/35',
  missing: 'bg-slate-800/90 text-slate-300 border-slate-600/50',
};

const PROFILE_ICON: Record<ThresholdProfile, typeof Rocket> = {
  lander: Rocket,
  rover: Compass,
  custom: Sliders,
};

function ImageThumb({ imageId, alt }: { imageId: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 shrink-0">
        <ImageIcon className="w-5 h-5" />
      </div>
    );
  }

  return (
    <img
      src={getImagePreviewUrl(imageId)}
      alt={alt}
      onError={() => setFailed(true)}
      className="w-12 h-12 rounded-lg object-cover border border-slate-700/80 bg-black shrink-0"
    />
  );
}

export function ImageLibraryPanel({
  images,
  isLoading,
  error,
  selectedImageId,
  selectedProfile,
  isStartingJob,
  jobStartError,
  onRefresh,
  onOpenApiModal,
  onSelectImage,
  onSelectProfile,
  onStartJob,
}: ImageLibraryPanelProps) {
  const [query, setQuery] = useState('');
  const selectedImage = images.find((img) => img.image_id === selectedImageId) ?? null;

  const filteredImages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return images;
    return images.filter(
      (img) =>
        img.source_image_id.toLowerCase().includes(q) ||
        img.image_id.toLowerCase().includes(q),
    );
  }, [images, query]);

  return (
    <section className="ms-panel p-5 flex flex-col gap-4" aria-labelledby="library-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-sky-400">
            Step 2 · Scene &amp; Profile
          </div>
          <h2 id="library-heading" className="text-base font-semibold text-slate-50 mt-0.5">
            Select Image &amp; Launch Screening
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Pick an uploaded NAC scene, choose vehicle risk thresholds, and run detection.
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
          <p className="text-sm text-slate-200">Loading available LRO NAC images…</p>
          <p className="text-xs text-slate-400">Querying FastAPI scene registry…</p>
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div
          role="alert"
          className="bg-red-950/40 border border-red-500/35 rounded-xl p-4 flex flex-col gap-2.5"
        >
          <div className="flex items-center gap-2 text-red-200 text-sm font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>API Connection Required</span>
          </div>
          <p className="text-xs text-red-200/90 leading-relaxed">{error}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={onOpenApiModal} className="ms-btn-primary text-xs">
              <PlugZap className="w-3.5 h-3.5" />
              <span>Configure API URL</span>
            </button>
            <button type="button" onClick={onRefresh} className="ms-btn-secondary text-xs">
              Retry Request
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && images.length === 0 && (
        <div className="ms-panel-elevated p-6 text-center flex flex-col items-center gap-2">
          <div className="w-11 h-11 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
            <ImageIcon className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-slate-200">No LRO NAC images uploaded yet</p>
          <p className="text-xs text-slate-400 max-w-md">
            Upload a local PNG, JPEG, or TIFF image on the left to inspect its metadata and run
            boulder-risk screening. No placeholder detections are invented.
          </p>
        </div>
      )}

      {/* Search & Image list */}
      {images.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {images.length > 3 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by product ID or image ID…"
                className="ms-input pl-8 py-1.5 text-xs"
              />
            </div>
          )}

          <div
            className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1"
            role="listbox"
            aria-label="Available LRO NAC images"
          >
            {filteredImages.map((img) => {
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
                  className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                    isSelected
                      ? 'bg-sky-950/45 border-sky-400/75 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]'
                      : 'bg-[#0b101a]/90 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <ImageThumb imageId={img.image_id} alt={img.source_image_id} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {isSelected && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          )}
                          <span className="text-sm font-medium text-slate-100 truncate">
                            {img.source_image_id}
                          </span>
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                          {img.image_id}
                        </p>
                      </div>

                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                          COVERAGE_BADGE_CLASSES[img.coverage]
                        }`}
                      >
                        {img.coverage}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 font-mono">
                      <span>
                        {img.width_px}×{img.height_px} px
                      </span>
                      <span>{gsdLabel}</span>
                      <span>
                        {img.coordinate_frame === 'lunar_local_m'
                          ? 'Lunar local (m)'
                          : 'Image pixels'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Screening Profile & Launch */}
      <div className="border-t border-slate-800/80 pt-4 flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-200">
              Vehicle Risk Profile
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300">
              Illustrative · Unvalidated
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(['lander', 'rover', 'custom'] as ThresholdProfile[]).map((profileKey) => {
              const profile = ILLUSTRATIVE_PROFILES[profileKey];
              const active = selectedProfile === profileKey;
              const Icon = PROFILE_ICON[profileKey];
              return (
                <button
                  key={profileKey}
                  type="button"
                  onClick={() => onSelectProfile(profileKey)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-sky-950/50 border-sky-400/75 text-slate-50 shadow-[0_0_0_1px_rgba(56,189,248,0.2)]'
                      : 'bg-[#0b101a]/90 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold capitalize">{profileKey}</span>
                    <Icon className={`w-3.5 h-3.5 ${active ? 'text-sky-400' : 'text-slate-500'}`} />
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 font-mono">
                    {profile.defaults.cell_size_m} m · ≥{profile.defaults.unsafe_boulder_size_m} m
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {ILLUSTRATIVE_PROFILES[selectedProfile].illustrativeNote}
          </p>
        </div>

        {jobStartError && (
          <div
            role="alert"
            className="text-xs text-red-200 bg-red-950/55 border border-red-500/40 rounded-xl p-3"
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
              <span>Submitting Screening Job…</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>
                {selectedImage
                  ? `Run Boulder Screening on ${selectedImage.source_image_id}`
                  : 'Select an Image to Run Screening'}
              </span>
            </>
          )}
        </button>
      </div>
    </section>
  );
}
