import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Box, ChevronLeft, Map as MapIcon, Radar, Sparkles } from 'lucide-react';
import {
  LeafletMapCanvas,
  SAMPLE_LUNAR_TILES,
  TerrainContext3D,
  downloadScreeningReport,
  generateSampleLunarTile,
  updateJobThresholds,
  type DetectionWithGeo,
  type MapLayerState,
  type SampleTileSpec,
  type SelectedMapFeature,
} from '../features/map';
import {
  ApiError,
  buildApiEndpoint,
  getApiBaseUrl,
  getImagePreviewUrl,
  getJobResults,
  getJobStatus,
  listImages,
  setApiBaseUrl,
  startProcessingJob,
} from './api/client';
import { ShellHeader } from './components/ShellHeader';
import { TacticalDrawer } from './components/TacticalDrawer';
import {
  ILLUSTRATIVE_PROFILES,
  type ImageMetadata,
  type ImageUploadResponse,
  type JobResultsResponse,
  type JobStatusResponse,
  type ThresholdConfig,
  type ThresholdProfile,
} from './types/contracts';

export function App() {
  const [apiBaseUrl, setApiBaseUrlState] = useState<string>(() => getApiBaseUrl());
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);

  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);

  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ThresholdProfile>('lander');
  const [thresholds, setThresholds] = useState<ThresholdConfig>(
    () => ILLUSTRATIVE_PROFILES.lander.defaults,
  );

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [selectedFeature, setSelectedFeature] = useState<SelectedMapFeature>(null);
  const [layers, setLayers] = useState<MapLayerState>({
    showImage: true,
    imageOpacity: 1,
    showDetections: true,
    minDetectionConfidence: 0.25,
    showRiskGrid: true,
    riskOpacity: 0.42,
    visibleRiskClasses: {
      safe: true,
      caution: true,
      unsafe: true,
      uncertain: true,
    },
  });

  const [isStartingJob, setIsStartingJob] = useState(false);
  const [jobStartError, setJobStartError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobStatusResponse | null>(null);

  const [results, setResults] = useState<JobResultsResponse | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  const refreshImages = useCallback(async () => {
    setImagesLoading(true);
    try {
      const loaded = await listImages();
      setApiConnected(true);
      setImages((prev) => {
        const localOnly = prev.filter((item) => item.image_id.endsWith('_local') || item.image_id.endsWith('_sample'));
        const merged = [...loaded];
        for (const loc of localOnly) {
          if (!merged.some((m) => m.image_id === loc.image_id)) {
            merged.push(loc);
          }
        }
        return merged;
      });
      setSelectedImageId((prev) => {
        if (prev) return prev;
        return loaded[0]?.image_id ?? null;
      });
    } catch {
      setApiConnected(false);
    } finally {
      setImagesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshImages();
  }, [refreshImages]);

  function handleSaveApiBaseUrl(url: string) {
    const updated = setApiBaseUrl(url);
    setApiBaseUrlState(updated);
    void refreshImages();
  }

  function handleSelectProfile(profile: ThresholdProfile) {
    setSelectedProfile(profile);
    if (profile !== 'custom') {
      setThresholds(ILLUSTRATIVE_PROFILES[profile].defaults);
    }
  }

  function handleChangeThresholds(next: ThresholdConfig) {
    setSelectedProfile('custom');
    setThresholds(next);
  }

  const fetchResults = useCallback(async (jobId: string) => {
    try {
      const payload = await getJobResults(jobId);
      setResults(payload);
    } catch (err) {
      setJobStartError(
        err instanceof ApiError ? err.message : 'Failed to fetch screening results.',
      );
    }
  }, []);

  const pollJobOnce = useCallback(
    async (jobId: string) => {
      try {
        const status = await getJobStatus(jobId);
        setActiveJob(status);
        if (status.status === 'completed') {
          void fetchResults(jobId);
          return false;
        }
        if (status.status === 'failed') {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    [fetchResults],
  );

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === 'completed' || activeJob.status === 'failed') {
      return;
    }

    let cancelled = false;
    const scheduleNext = () => {
      pollTimerRef.current = window.setTimeout(async () => {
        if (cancelled) return;
        const shouldContinue = await pollJobOnce(activeJob.job_id);
        if (!cancelled && shouldContinue) {
          scheduleNext();
        }
      }, 1000);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, [activeJob?.job_id, activeJob?.status, pollJobOnce]);

  function handleUploaded(response: ImageUploadResponse) {
    setApiConnected(true);
    setImages((prev) => {
      const filtered = prev.filter((item) => item.image_id !== response.metadata.image_id);
      return [response.metadata, ...filtered];
    });
    setSelectedImageId(response.metadata.image_id);
    setActiveJob(null);
    setResults(null);
    setJobStartError(null);
    setSelectedFeature(null);
  }

  function handleLocalRasterLoaded(metadata: ImageMetadata, previewUrl: string) {
    setLocalPreviews((prev) => ({ ...prev, [metadata.image_id]: previewUrl }));
    setImages((prev) => {
      const filtered = prev.filter((item) => item.image_id !== metadata.image_id);
      return [metadata, ...filtered];
    });
    setSelectedImageId(metadata.image_id);
    setActiveJob(null);
    setResults(null);
    setJobStartError(null);
    setSelectedFeature(null);
  }

  async function handleStandbySampleLoad(spec: SampleTileSpec) {
    const sample = await generateSampleLunarTile(spec);
    handleLocalRasterLoaded(sample.metadata, sample.previewUrl);
  }

  async function handleStartJob() {
    if (!selectedImageId) return;
    setIsStartingJob(true);
    setJobStartError(null);
    setResults(null);
    setSelectedFeature(null);

    try {
      const created = await startProcessingJob({
        image_id: selectedImageId,
        threshold_profile: selectedProfile,
        thresholds: selectedProfile === 'custom' ? thresholds : undefined,
        confidence_threshold: layers.minDetectionConfidence,
      });
      setActiveJob({
        job_id: created.job_id,
        image_id: created.image_id,
        status: created.status,
        threshold_profile: created.threshold_profile ?? selectedProfile,
      });
      void pollJobOnce(created.job_id);
    } catch (err) {
      setJobStartError(
        err instanceof ApiError
          ? err.status === 404 || err.status === 0 || err.status >= 500
            ? 'Backend API not reachable — connect FastAPI to run YOLO detection.'
            : err.message
          : 'Failed to submit screening job.',
      );
    } finally {
      setIsStartingJob(false);
    }
  }

  async function handleRecalculateRiskGrid() {
    const jobId = results?.job_id ?? activeJob?.job_id;
    if (!jobId) return;

    setIsRecalculating(true);
    setRecalcError(null);
    try {
      const updated = await updateJobThresholds(
        jobId,
        {
          threshold_profile: selectedProfile,
          thresholds: {
            cell_size_m: thresholds.cell_size_m,
            caution_boulder_size_m: thresholds.caution_boulder_size_m,
            unsafe_boulder_size_m: thresholds.unsafe_boulder_size_m,
            caution_boulder_count: thresholds.caution_boulder_count,
            unsafe_boulder_count: thresholds.unsafe_boulder_count,
            min_valid_coverage: thresholds.min_cell_coverage,
          },
        },
        buildApiEndpoint('/api'),
      );
      setResults((prev) => (prev ? { ...prev, risk_grid: updated.risk_grid } : prev));
      setSelectedFeature(null);
    } catch (err) {
      setRecalcError(err instanceof Error ? err.message : 'Threshold recalculation failed.');
    } finally {
      setIsRecalculating(false);
    }
  }

  const selectedImage = images.find((img) => img.image_id === selectedImageId) ?? null;
  const detections = (results?.detections ?? []) as DetectionWithGeo[];
  const visibleDetectionsCount = detections.filter(
    (d) => d.confidence >= layers.minDetectionConfidence,
  ).length;

  const safeTerrainPct =
    results && results.risk_grid.cells.length > 0
      ? (results.risk_grid.cells.filter((c) => c.class === 'safe').length /
          results.risk_grid.cells.length) *
        100
      : null;

  const previewUrl = selectedImage
    ? (localPreviews[selectedImage.image_id] ?? getImagePreviewUrl(selectedImage.image_id))
    : '';

  const isInferring =
    isStartingJob || activeJob?.status === 'queued' || activeJob?.status === 'running';

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col bg-[#07090e] text-slate-100">
      <ShellHeader
        selectedImage={selectedImage}
        selectedProfile={selectedProfile}
        onSelectProfile={handleSelectProfile}
        totalBoulders={visibleDetectionsCount}
        safeTerrainPct={safeTerrainPct}
        onExportReport={() => downloadScreeningReport(selectedImage, results)}
        apiConnected={apiConnected}
        apiBaseUrl={apiBaseUrl}
        onSaveApiBaseUrl={handleSaveApiBaseUrl}
      />

      {/* Full-Viewport Mission Console: 70% Map Canvas + 30% Collapsible Right Drawer */}
      <main
        className={`flex-1 min-h-0 p-3 grid grid-cols-1 gap-3 transition-all duration-200 ${
          drawerOpen
            ? 'lg:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]'
            : 'lg:grid-cols-[minmax(0,1fr)]'
        }`}
      >
        {/* Main Canvas (70% desktop / full-width when drawer collapsed) */}
        <section className="relative flex flex-col min-h-[500px] lg:min-h-0 gap-2">
          {/* Compact Top Status / View Mode Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 shrink-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setViewMode('2d')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition cursor-pointer ${
                  viewMode === '2d'
                    ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                    : 'bg-slate-900/70 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>2D AUTHORITATIVE HUD</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('3d')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition cursor-pointer ${
                  viewMode === '3d'
                    ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                    : 'bg-slate-900/70 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>FLAT 3D CONTEXT (NO DEM)</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {selectedImage && selectedImage.coordinate_frame !== 'lunar_local_m' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-950/60 border border-violet-500/35 font-mono text-[10px] text-violet-200">
                  <AlertTriangle className="w-3 h-3" />
                  <span>FRAME: image_px (UNCERTAIN)</span>
                </span>
              )}
              <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-amber-950/50 border border-amber-500/30 font-mono text-[10px] text-amber-200">
                SCREENING ONLY · UNVALIDATED
              </span>
              {!drawerOpen && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-500/15 border border-sky-400/40 font-mono text-[11px] text-sky-200 hover:bg-sky-500/25 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>OPEN HUD DRAWER</span>
                </button>
              )}
            </div>
          </div>

          {/* Primary Map Viewport or Standby Console */}
          <div className="flex-1 min-h-0">
            {selectedImage ? (
              viewMode === '2d' ? (
                <LeafletMapCanvas
                  imageMetadata={selectedImage}
                  previewUrl={previewUrl}
                  detections={detections}
                  riskGrid={results?.risk_grid ?? null}
                  layers={layers}
                  onChangeLayers={setLayers}
                  activeThresholds={thresholds}
                  selected={selectedFeature}
                  onSelect={setSelectedFeature}
                  isInferring={isInferring}
                />
              ) : (
                <TerrainContext3D imageMetadata={selectedImage} detections={detections} />
              )
            ) : (
              <div className="h-full min-h-[460px] rounded-xl ms-panel hud-reticle flex flex-col items-center justify-center p-8 text-center gap-4 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.08)_0%,rgba(7,9,14,0.98)_70%)]">
                <div className="hud-reticle-tr-bl absolute inset-0 pointer-events-none" />
                <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-400/35 flex items-center justify-center text-sky-300 shadow-[0_0_25px_rgba(56,189,248,0.2)]">
                  <Radar className="w-7 h-7" />
                </div>
                <div className="max-w-lg flex flex-col gap-1.5">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-sky-400">
                    SW-1 Reconnaissance Console // Standby
                  </p>
                  <h2 className="text-xl font-semibold text-slate-100">
                    Load an LRO LROC NAC Orbiter Tile to Begin
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Drop a PNG, JPEG, or TIFF raster in the Tactical Drawer on the right, or launch
                    a sample lunar surface tile below to explore the 2D HUD, metric scale bar, and
                    split-compare controls. No synthetic detections are fabricated.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5 mt-1">
                  {SAMPLE_LUNAR_TILES.map((spec) => (
                    <button
                      key={spec.id}
                      type="button"
                      onClick={() => void handleStandbySampleLoad(spec)}
                      className="ms-btn-primary text-xs"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Load {spec.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Tactical Control Drawer (30% width, collapsible) */}
        {drawerOpen && (
          <div className="min-h-0 lg:h-full">
            <TacticalDrawer
              images={images}
              selectedImage={selectedImage}
              onSelectImage={(id) => {
                setSelectedImageId(id);
                setJobStartError(null);
                setSelectedFeature(null);
              }}
              onRefreshImages={() => void refreshImages()}
              imagesLoading={imagesLoading}
              apiConnected={apiConnected}
              onUploaded={handleUploaded}
              onLocalRasterLoaded={handleLocalRasterLoaded}
              selectedProfile={selectedProfile}
              thresholds={thresholds}
              onChangeThresholds={handleChangeThresholds}
              confidenceCutoff={layers.minDetectionConfidence}
              onChangeConfidenceCutoff={(conf) =>
                setLayers((prev) => ({ ...prev, minDetectionConfidence: conf }))
              }
              activeJob={activeJob}
              isStartingJob={isStartingJob}
              jobStartError={jobStartError}
              onStartJob={() => void handleStartJob()}
              hasCompletedResults={Boolean(results)}
              isRecalculating={isRecalculating}
              recalcError={recalcError}
              onRecalculateRiskGrid={() => void handleRecalculateRiskGrid()}
              selectedFeature={selectedFeature}
              onClearFeature={() => setSelectedFeature(null)}
              onCollapse={() => setDrawerOpen(false)}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
