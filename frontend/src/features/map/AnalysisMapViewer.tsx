import { useState } from 'react';
import { AlertTriangle, Box, Map as MapIcon } from 'lucide-react';
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
import { TerrainContext3D } from './TerrainContext3D';
import { ThresholdControlsPanel } from './ThresholdControlsPanel';
import type {
  DetectionWithGeo,
  ElevationGridData,
  MapLayerState,
  SelectedMapFeature,
  ThresholdRecalcPayload,
} from './types';

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
    try {
      const updated = await updateJobThresholds(jobId, payload, apiBaseUrl);
      setOverrideGrid(updated.risk_grid);
      setSelected(null);
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
            <span>2D Authoritative Map</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('3d')}
            className={viewMode === '3d' ? 'ms-btn-primary text-xs' : 'ms-btn-secondary text-xs'}
          >
            <Box className="w-3.5 h-3.5" />
            <span>{elevationData ? '3D DEM Context' : 'Flat Context (No DEM)'}</span>
          </button>
        </div>

        <div className="text-[11px] font-mono text-slate-400">
          {hasLunarTransform ? 'frame: lunar_local_m' : 'frame: image_px (georeferencing uncertain)'}
          {' · '}
          screening_only: true
        </div>
      </div>

      {!hasLunarTransform && (
        <div className="bg-purple-950/35 border border-purple-500/35 rounded-xl p-3 flex items-start gap-2 text-xs text-purple-100">
          <AlertTriangle className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
          <span>
            Lunar transform unavailable: coordinates remain in <code>image_px</code> and positions
            are marked uncertain. Earth longitude/latitude is not used.
          </span>
        </div>
      )}

      {!results && (
        <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-3 text-xs text-slate-300">
          Showing raw NAC preview only. Run a screening job to overlay real detections and RiskGrid
          cells; no synthetic mock detections are displayed.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
        <div className="xl:col-span-3">
          {viewMode === '2d' ? (
            <LeafletMapCanvas
              imageMetadata={imageMetadata}
              previewUrl={resolvedPreviewUrl}
              detections={detections}
              riskGrid={activeGrid}
              layers={layers}
              onChangeLayers={setLayers}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <TerrainContext3D
              imageMetadata={imageMetadata}
              detections={detections}
              elevationData={elevationData}
            />
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
            onApply={(payload) => void handleApplyThresholds(payload)}
          />
          <InspectionPanel selected={selected} onClear={() => setSelected(null)} />
        </div>
      </div>
    </div>
  );
}
