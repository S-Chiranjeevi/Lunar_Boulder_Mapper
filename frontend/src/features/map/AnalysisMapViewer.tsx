import { lazy, Suspense, useState } from 'react';
import { AlertTriangle, Box, Crosshair, Map as MapIcon } from 'lucide-react';
import { getImagePreviewUrl } from '../../app/api/client';
import type {
  ImageMetadata,
  JobResultsResponse,
  JobStatusResponse,
  RiskGrid,
  ThresholdProfile,
} from '../../app/types/contracts';
import { updateJobThresholds } from './api';
import { InspectionPanel } from './InspectionPanel';
import { LayerControls } from './LayerControls';
import { LeafletMapCanvas } from './LeafletMapCanvas';
import { ThresholdControlsPanel } from './ThresholdControlsPanel';
import type {
  DetectionWithGeo,
  ElevationGridData,
  MapLayerState,
  SelectedMapFeature,
  ThresholdRecalcPayload,
} from './types';

const TerrainContext3D = lazy(() =>
  import('./TerrainContext3D').then((module) => ({ default: module.TerrainContext3D })),
);

export interface AnalysisMapViewerProps {
  imageMetadata: ImageMetadata;
  job?: JobStatusResponse | null;
  results: JobResultsResponse | null;
  previewUrl?: string;
  apiBaseUrl?: string;
  elevationData?: ElevationGridData | null;
  onRiskGridUpdated?: (riskGrid: RiskGrid) => void;
}

export function AnalysisMapViewer({
  imageMetadata,
  job,
  results,
  previewUrl,
  apiBaseUrl = '/api',
  elevationData = null,
  onRiskGridUpdated,
}: AnalysisMapViewerProps) {
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [selected, setSelected] = useState<SelectedMapFeature>(null);
  const [overrideGrid, setOverrideGrid] = useState<RiskGrid | null>(null);
  const [isUpdatingThresholds, setIsUpdatingThresholds] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [thresholdSuccess, setThresholdSuccess] = useState(false);

  const [layers, setLayers] = useState<MapLayerState>({
    showImage: true,
    imageOpacity: 1,
    showDetections: true,
    minDetectionConfidence: 0,
    showRiskGrid: true,
    riskOpacity: 0.4,
    visibleRiskClasses: {
      safe: true,
      caution: true,
      unsafe: true,
      uncertain: true,
    },
  });

  const detections = (results?.detections ?? []) as DetectionWithGeo[];
  const activeGrid = overrideGrid ?? results?.risk_grid ?? null;
  const activeProfile: ThresholdProfile =
    activeGrid?.threshold_profile ?? job?.threshold_profile ?? 'lander';
  const resolvedPreviewUrl = previewUrl ?? getImagePreviewUrl(imageMetadata.image_id);

  async function handleApplyThresholds(payload: ThresholdRecalcPayload) {
    const jobId = results?.job_id ?? job?.job_id;
    if (!jobId) return;

    setIsUpdatingThresholds(true);
    setThresholdError(null);
    setThresholdSuccess(false);
    try {
      const updated = await updateJobThresholds(jobId, payload, apiBaseUrl);
      setOverrideGrid(updated.risk_grid);
      setSelected(null);
      setThresholdSuccess(true);
      onRiskGridUpdated?.(updated.risk_grid);
    } catch (err) {
      setThresholdError(err instanceof Error ? err.message : 'Failed to recalculate thresholds.');
    } finally {
      setIsUpdatingThresholds(false);
    }
  }

  const hasLunarTransform =
    imageMetadata.coordinate_frame === 'lunar_local_m' && imageMetadata.image_to_lunar !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('2d')}
            className={viewMode === '2d' ? 'ms-btn-primary text-xs' : 'ms-btn-secondary text-xs'}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>2D Map · Primary</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('3d')}
            disabled={!elevationData}
            title={
              elevationData
                ? 'View terrain using real elevation data'
                : '3D is unavailable because no terrain elevation data is attached'
            }
            className={`${viewMode === '3d' ? 'ms-btn-primary text-xs' : 'ms-btn-secondary text-xs'} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Box className="w-3.5 h-3.5" />
            <span>{elevationData ? '3D Terrain' : '3D Unavailable (No DEM)'}</span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-slate-400">
          {hasLunarTransform ? 'Lunar map coordinates' : 'Image coordinates only'}
          {' · '}
          screening aid only
        </div>
      </div>

      {!hasLunarTransform && (
        <div className="bg-purple-950/30 border border-purple-500/35 rounded-xl p-3 flex items-start gap-2 text-xs text-purple-100">
          <AlertTriangle className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
          <span>
            No verified lunar map transform is available. Positions stay in image pixels and are
            marked uncertain.
          </span>
        </div>
      )}

      {!results && (
        <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-3 text-xs text-slate-300">
          Image preview only. Run screening in the Workspace tab to overlay detections and risk
          cells.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
        <div className="xl:col-span-3 flex flex-col gap-4">
          {viewMode === '2d' ? (
            <LeafletMapCanvas
              imageMetadata={imageMetadata}
              previewUrl={resolvedPreviewUrl}
              detections={detections}
              riskGrid={activeGrid}
              layers={layers}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <Suspense
              fallback={
                <div className="ms-panel-elevated p-6 text-center text-sm text-slate-300">
                  Loading terrain view…
                </div>
              }
            >
              <TerrainContext3D
                imageMetadata={imageMetadata}
                detections={detections}
                elevationData={elevationData}
              />
            </Suspense>
          )}

          {detections.length > 0 && (
            <section className="ms-panel p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-sky-400" />
                  <h4 className="text-sm font-semibold text-slate-100">
                    Candidate Boulder Detections ({detections.length})
                  </h4>
                </div>
                <span className="text-[11px] text-slate-400">
                  Click any boulder to focus on map
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                {detections.map((det) => {
                  const isSelected =
                    selected?.kind === 'detection' &&
                    selected.detection.detection_id === det.detection_id;
                  return (
                    <button
                      key={det.detection_id}
                      type="button"
                      onClick={() => setSelected({ kind: 'detection', detection: det })}
                      className={`text-left p-2.5 rounded-xl border text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-sky-950/50 border-sky-400/75 text-slate-50'
                          : 'bg-[#0b101a]/90 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-sky-300 truncate">
                          {det.detection_id}
                        </span>
                        <span className="font-mono font-semibold text-slate-100">
                          {(det.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span>
                          {det.estimated_size_m !== null
                            ? `~${det.estimated_size_m.toFixed(2)} m`
                            : 'Size N/A'}
                        </span>
                        <span>
                          ({det.position.x.toFixed(0)}, {det.position.y.toFixed(0)}){' '}
                          {det.position.frame === 'lunar_local_m' ? 'm' : 'px'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <LayerControls
            layers={layers}
            onChange={setLayers}
            detectionCount={detections.length}
            cellCount={activeGrid?.cells.length ?? 0}
          />
          <ThresholdControlsPanel
            activeProfile={activeProfile}
            disabled={!results || !(results.job_id ?? job?.job_id)}
            isUpdating={isUpdatingThresholds}
            updateError={thresholdError}
            updateSuccess={thresholdSuccess}
            onApply={(payload) => void handleApplyThresholds(payload)}
          />
          <InspectionPanel selected={selected} onClear={() => setSelected(null)} />
        </div>
      </div>
    </div>
  );
}
