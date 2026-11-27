import { useRef, useState } from 'react';
import {
  ChevronRight,
  Download,
  FileJson,
  ImagePlus,
  Loader2,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  InspectionPanel,
  SAMPLE_LUNAR_TILES,
  generateSampleLunarTile,
  type SampleTileSpec,
  type SelectedMapFeature,
} from '../../features/map';
import { ApiError, uploadImage } from '../api/client';
import type {
  CoverageState,
  ImageMetadata,
  ImageUploadResponse,
  JobStatusResponse,
  ThresholdConfig,
  ThresholdProfile,
} from '../types/contracts';

interface TacticalDrawerProps {
  images: ImageMetadata[];
  selectedImage: ImageMetadata | null;
  onSelectImage: (imageId: string) => void;
  onRefreshImages: () => void;
  imagesLoading: boolean;
  apiConnected: boolean | null;
  onUploaded: (response: ImageUploadResponse) => void;
  onLocalRasterLoaded: (metadata: ImageMetadata, previewUrl: string, file?: File) => void;

  selectedProfile: ThresholdProfile;
  thresholds: ThresholdConfig;
  onChangeThresholds: (next: ThresholdConfig) => void;
  confidenceCutoff: number;
  onChangeConfidenceCutoff: (conf: number) => void;

  activeJob: JobStatusResponse | null;
  isStartingJob: boolean;
  jobStartError: string | null;
  onStartJob: () => void;

  hasCompletedResults: boolean;
  isRecalculating: boolean;
  recalcError: string | null;
  onRecalculateRiskGrid: () => void;

  selectedFeature: SelectedMapFeature;
  onClearFeature: () => void;
  onCollapse: () => void;
}

const ACCEPTED_IMAGE_TYPES = '.png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff';

const SAMPLE_MANIFEST = {
  image_id: 'nac_sample_001',
  source_image_id: 'M1234567890L',
  gsd_x_m_per_px: 0.5,
  gsd_y_m_per_px: 0.5,
  coverage: 'valid',
  coordinate_frame: 'image_px',
  image_to_lunar: null,
};

export function TacticalDrawer({
  images,
  selectedImage,
  onSelectImage,
  onRefreshImages,
  imagesLoading,
  apiConnected,
  onUploaded,
  onLocalRasterLoaded,
  selectedProfile,
  thresholds,
  onChangeThresholds,
  confidenceCutoff,
  onChangeConfidenceCutoff,
  activeJob,
  isStartingJob,
  jobStartError,
  onStartJob,
  hasCompletedResults,
  isRecalculating,
  recalcError,
  onRecalculateRiskGrid,
  selectedFeature,
  onClearFeature,
  onCollapse,
}: TacticalDrawerProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const manifestInputRef = useRef<HTMLInputElement | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [showMetadataOverrides, setShowMetadataOverrides] = useState(false);
  const [sourceImageId, setSourceImageId] = useState('');
  const [gsdX, setGsdX] = useState('');
  const [gsdY, setGsdY] = useState('');
  const [coverage, setCoverage] = useState<CoverageState | ''>('');

  const [isUploading, setIsUploading] = useState(false);
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const isJobRunning =
    activeJob?.status === 'queued' || activeJob?.status === 'running' || isStartingJob;

  // Derived boulder density per 100 m² from caution count and cell area
  const cellAreaM2 = Math.max(1, thresholds.cell_size_m * thresholds.cell_size_m);
  const densityPer100m2 = Number(
    ((thresholds.caution_boulder_count / cellAreaM2) * 100).toFixed(2),
  );

  function handleDensitySliderChange(targetDensityPer100m2: number) {
    const cautionCount = Math.max(1, Math.round((targetDensityPer100m2 / 100) * cellAreaM2));
    const unsafeCount = Math.max(cautionCount + 1, cautionCount * 2);
    onChangeThresholds({
      ...thresholds,
      caution_boulder_count: cautionCount,
      unsafe_boulder_count: unsafeCount,
    });
  }

  async function handleFileSelected(file: File | null) {
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (!['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
      setUploadError(`Unsupported raster "${file.name}". Use PNG, JPEG, or TIFF.`);
      return;
    }
    setUploadError(null);
    setUploadNotice(null);
    setImageFile(file);

    // For PNG/JPEG, immediately show local raster preview in the 2D HUD
    if (['png', 'jpg', 'jpeg'].includes(ext)) {
      const objectUrl = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const stem = file.name.replace(/\.[^.]+$/, '') || 'local_nac';
        const gsdValX = gsdX.trim() ? Number(gsdX) : null;
        const gsdValY = gsdY.trim() ? Number(gsdY) : null;
        onLocalRasterLoaded(
          {
            image_id: `${stem}_local`,
            source_image_id: sourceImageId.trim() || stem,
            width_px: probe.naturalWidth,
            height_px: probe.naturalHeight,
            gsd_x_m_per_px: gsdValX,
            gsd_y_m_per_px: gsdValY,
            coverage: coverage || 'valid',
            coordinate_frame: 'image_px',
            image_to_lunar: null,
          },
          objectUrl,
          file,
        );
      };
      probe.src = objectUrl;
    }
  }

  async function handleQuickLoadSample(spec: SampleTileSpec) {
    setLoadingSampleId(spec.id);
    setUploadError(null);
    setUploadNotice(null);
    try {
      const sample = await generateSampleLunarTile(spec);
      setImageFile(sample.file);
      onLocalRasterLoaded(sample.metadata, sample.previewUrl, sample.file);

      if (apiConnected) {
        const uploaded = await uploadImage({
          file: sample.file,
          sourceImageId: sample.metadata.source_image_id,
          gsdXMPerPx: String(spec.gsdMPerPx),
          gsdYMPerPx: String(spec.gsdMPerPx),
          coverage: 'valid',
        });
        onUploaded(uploaded);
        setUploadNotice(`Loaded & synced sample "${spec.label}" to FastAPI backend.`);
      } else {
        setUploadNotice(
          `Loaded sample raster "${spec.label}" locally (0 detections — connect FastAPI for YOLO inference).`,
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not load sample lunar tile.');
    } finally {
      setLoadingSampleId(null);
    }
  }

  async function handleUploadToBackend(e: React.FormEvent) {
    e.preventDefault();
    if (!imageFile) {
      setUploadError('Select an image file or load a sample lunar tile first.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadNotice(null);
    try {
      const res = await uploadImage({
        file: imageFile,
        manifest: manifestFile,
        sourceImageId,
        gsdXMPerPx: gsdX,
        gsdYMPerPx: gsdY,
        coverage,
      });
      setUploadNotice(`Ingested "${res.metadata.source_image_id}" (${res.metadata.width_px}×${res.metadata.height_px} px).`);
      onUploaded(res);
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.status === 404 || err.status === 0 || err.status >= 500
            ? 'Backend API unavailable here — local raster preview remains active in the 2D HUD.'
            : err.message
          : 'Upload failed.',
      );
    } finally {
      setIsUploading(false);
    }
  }

  function handleDownloadManifest() {
    const blob = new Blob([JSON.stringify(SAMPLE_MANIFEST, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'example_manifest.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="relative h-full flex flex-col ms-panel hud-reticle overflow-hidden">
      {/* Drawer Header */}
      <div className="px-4 py-2.5 border-b border-sky-400/20 flex items-center justify-between gap-2 shrink-0 bg-slate-950/60">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-100">
            Tactical Control Drawer
          </span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-sky-300 cursor-pointer"
          title="Collapse Tactical Drawer"
        >
          <span>HIDE</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Sections */}
      <div className="flex-1 overflow-y-auto hud-scroll p-3.5 flex flex-col gap-4">
        {/* SECTION 1: Image & Analysis Input */}
        <section className="flex flex-col gap-2.5" aria-labelledby="drawer-input-heading">
          <div className="flex items-center justify-between">
            <h2
              id="drawer-input-heading"
              className="text-[11px] font-mono uppercase tracking-wider text-sky-300 font-semibold"
            >
              01 // Image &amp; Analysis Input
            </h2>
            <button
              type="button"
              onClick={onRefreshImages}
              disabled={imagesLoading}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 hover:text-sky-300 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${imagesLoading ? 'animate-spin' : ''}`} />
              <span>SYNC</span>
            </button>
          </div>

          {/* Sample Lunar Tile Quick-Load Buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            {SAMPLE_LUNAR_TILES.map((spec) => (
              <button
                key={spec.id}
                type="button"
                onClick={() => void handleQuickLoadSample(spec)}
                disabled={loadingSampleId !== null}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-sky-400/20 hover:border-sky-400/55 text-left text-[11px] text-slate-200 transition cursor-pointer"
              >
                {loadingSampleId === spec.id ? (
                  <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                )}
                <span className="truncate">{spec.label}</span>
              </button>
            ))}
          </div>

          {/* Drag-and-Drop Zone */}
          <form onSubmit={handleUploadToBackend} className="flex flex-col gap-2.5">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                void handleFileSelected(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`border border-dashed rounded-xl p-3.5 text-center transition cursor-pointer ${
                isDragging
                  ? 'border-sky-400 bg-sky-950/30'
                  : 'border-sky-400/25 bg-[#07090e]/70 hover:border-sky-400/50'
              } ${isUploading || isJobRunning ? 'hud-scanline-overlay' : ''}`}
              onClick={() => imageInputRef.current?.click()}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES}
                className="sr-only"
                onChange={(e) => void handleFileSelected(e.target.files?.[0] ?? null)}
              />
              <ImagePlus className="w-6 h-6 mx-auto text-sky-400 mb-1" />
              <p className="text-xs font-medium text-slate-200 truncate">
                {imageFile ? imageFile.name : 'Drop LRO NAC PNG / JPEG / TIFF'}
              </p>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                {imageFile
                  ? `${(imageFile.size / 1024).toFixed(0)} KB · Click to replace`
                  : 'Click to browse orbiter raster'}
              </p>
            </div>

            {/* Manifest & Optional Overrides Row */}
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <input
                ref={manifestInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(e) => setManifestFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => manifestInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-slate-300 hover:text-sky-300 cursor-pointer"
              >
                <FileJson className="w-3.5 h-3.5 text-sky-400" />
                <span>{manifestFile ? manifestFile.name : 'Attach Manifest'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadManifest}
                className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Sample JSON</span>
              </button>

              <button
                type="button"
                onClick={() => setShowMetadataOverrides((prev) => !prev)}
                className="text-sky-300 hover:text-sky-200 cursor-pointer"
              >
                {showMetadataOverrides ? 'Hide GSD' : '+ GSD'}
              </button>
            </div>

            {showMetadataOverrides && (
              <div className="ms-panel-elevated p-2.5 grid grid-cols-2 gap-2 text-[11px]">
                <input
                  type="text"
                  value={sourceImageId}
                  onChange={(e) => setSourceImageId(e.target.value)}
                  placeholder="NAC ID (M123456L)"
                  className="ms-input py-1 px-2 text-[11px] font-mono"
                />
                <select
                  value={coverage}
                  onChange={(e) => setCoverage(e.target.value as CoverageState | '')}
                  className="ms-input py-1 px-2 text-[11px]"
                >
                  <option value="">Coverage: Auto</option>
                  <option value="valid">valid</option>
                  <option value="partial">partial</option>
                  <option value="missing">missing</option>
                </select>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={gsdX}
                  onChange={(e) => setGsdX(e.target.value)}
                  placeholder="GSD X (0.5 m/px)"
                  className="ms-input py-1 px-2 text-[11px] font-mono"
                />
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={gsdY}
                  onChange={(e) => setGsdY(e.target.value)}
                  placeholder="GSD Y (0.5 m/px)"
                  className="ms-input py-1 px-2 text-[11px] font-mono"
                />
              </div>
            )}

            {/* Scene Selector when multiple images are ingested */}
            {images.length > 0 && (
              <label className="flex flex-col gap-1 text-[11px]">
                <span className="text-slate-400 font-mono">ACTIVE SCENE ({images.length})</span>
                <select
                  value={selectedImage?.image_id ?? ''}
                  onChange={(e) => onSelectImage(e.target.value)}
                  className="ms-input py-1.5 px-2 text-xs font-mono"
                >
                  {images.map((img) => (
                    <option key={img.image_id} value={img.image_id}>
                      {img.source_image_id} ({img.width_px}×{img.height_px} px)
                    </option>
                  ))}
                </select>
              </label>
            )}

            {uploadNotice && (
              <div className="text-[11px] text-sky-200 bg-sky-950/40 border border-sky-400/30 rounded-lg px-2.5 py-2">
                {uploadNotice}
              </div>
            )}
            {uploadError && (
              <div role="alert" className="text-[11px] text-amber-200 bg-amber-950/45 border border-amber-500/35 rounded-lg px-2.5 py-2">
                {uploadError}
              </div>
            )}
            {jobStartError && (
              <div role="alert" className="text-[11px] text-red-200 bg-red-950/50 border border-red-500/40 rounded-lg px-2.5 py-2">
                {jobStartError}
              </div>
            )}

            {/* Inference Scanline Bar when active */}
            {isJobRunning && (
              <div className="ms-panel-elevated p-2.5 hud-scanline-overlay border border-sky-400/40 text-[11px] font-mono text-sky-200 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                <span>
                  INFERENCE ACTIVE // {activeJob?.status?.toUpperCase() ?? 'SUBMITTING'}
                </span>
              </div>
            )}

            {activeJob?.status === 'failed' && activeJob.error && (
              <div role="alert" className="text-[11px] text-red-200 bg-red-950/50 border border-red-500/40 rounded-lg px-2.5 py-2">
                {typeof activeJob.error === 'string'
                  ? activeJob.error
                  : ((activeJob.error as unknown as { message?: string } | null)?.message ??
                    'Screening job failed.')}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="submit"
                disabled={!imageFile || isUploading}
                className="ms-btn-secondary text-[11px] py-2"
              >
                {isUploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>Upload Raster</span>
              </button>

              <button
                type="button"
                onClick={onStartJob}
                disabled={!selectedImage || isJobRunning}
                className="ms-btn-primary text-[11px] py-2"
              >
                {isJobRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span>Run Screening</span>
              </button>
            </div>
          </form>
        </section>

        <div className="border-t border-sky-400/15" />

        {/* SECTION 2: Live Threshold Sliders */}
        <section className="flex flex-col gap-3" aria-labelledby="drawer-thresholds-heading">
          <div className="flex items-center justify-between">
            <h2
              id="drawer-thresholds-heading"
              className="text-[11px] font-mono uppercase tracking-wider text-sky-300 font-semibold flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>02 // Live Thresholds</span>
            </h2>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-200 uppercase">
              {selectedProfile} · unvalidated
            </span>
          </div>

          <div className="ms-panel-elevated p-3 flex flex-col gap-3 text-[11px]">
            {/* Max Safe Boulder Size */}
            <label className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-slate-300">Max Safe Boulder Size</span>
                <span className="font-mono text-emerald-300 font-semibold">
                  {thresholds.caution_boulder_size_m.toFixed(2)} m
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={3.0}
                step={0.05}
                value={thresholds.caution_boulder_size_m}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onChangeThresholds({
                    ...thresholds,
                    caution_boulder_size_m: val,
                    unsafe_boulder_size_m: Math.max(thresholds.unsafe_boulder_size_m, val + 0.1),
                  });
                }}
                className="hud-slider"
              />
            </label>

            {/* Unsafe Boulder Size */}
            <label className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-slate-300">Unsafe Boulder Size</span>
                <span className="font-mono text-red-300 font-semibold">
                  {thresholds.unsafe_boulder_size_m.toFixed(2)} m
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={5.0}
                step={0.05}
                value={thresholds.unsafe_boulder_size_m}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onChangeThresholds({
                    ...thresholds,
                    unsafe_boulder_size_m: Math.max(val, thresholds.caution_boulder_size_m),
                  });
                }}
                className="hud-slider"
              />
            </label>

            {/* Max Boulder Density per 100 m2 */}
            <label className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-slate-300">Max Density (per 100 m²)</span>
                <span className="font-mono text-amber-300 font-semibold">
                  {densityPer100m2.toFixed(1)} / 100 m²
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={20.0}
                step={0.2}
                value={Math.min(20, densityPer100m2)}
                onChange={(e) => handleDensitySliderChange(Number(e.target.value))}
                className="hud-slider"
              />
            </label>

            {/* Confidence Cutoff */}
            <label className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span className="text-slate-300">Confidence Cutoff</span>
                <span className="font-mono text-sky-300 font-semibold">
                  {Math.round(confidenceCutoff * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.95}
                step={0.05}
                value={confidenceCutoff}
                onChange={(e) => onChangeConfidenceCutoff(Number(e.target.value))}
                className="hud-slider"
              />
            </label>

            {recalcError && (
              <p role="alert" className="text-[11px] text-red-200 bg-red-950/50 border border-red-500/40 rounded p-2">
                {recalcError}
              </p>
            )}

            <button
              type="button"
              onClick={onRecalculateRiskGrid}
              disabled={!hasCompletedResults || isRecalculating}
              className="ms-btn-secondary text-[11px] py-1.5 w-full"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
              <span>
                {hasCompletedResults
                  ? isRecalculating
                    ? 'Recalculating RiskGrid…'
                    : 'Recalculate RiskGrid (No Re-Inference)'
                  : 'Run Screening to Enable Grid Recalc'}
              </span>
            </button>
          </div>
        </section>

        <div className="border-t border-sky-400/15" />

        {/* SECTION 3: Selected Boulder / Cell Inspector Card */}
        <section className="flex flex-col gap-2" aria-labelledby="drawer-inspector-heading">
          <h2
            id="drawer-inspector-heading"
            className="text-[11px] font-mono uppercase tracking-wider text-sky-300 font-semibold"
          >
            03 // Selected Target Inspector
          </h2>
          <InspectionPanel selected={selectedFeature} onClear={onClearFeature} />
        </section>
      </div>
    </aside>
  );
}
