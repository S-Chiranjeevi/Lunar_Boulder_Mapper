import {
  ArrowLeft,
  Compass,
  Info,
  Loader2,
  Map as MapIcon,
  RefreshCw,
} from 'lucide-react';
import { AnalysisMapViewer } from '../../features/map';
import { buildApiEndpoint, getImagePreviewUrl } from '../api/client';
import type {
  ImageMetadata,
  JobResultsResponse,
  JobStatusResponse,
  RiskGrid,
} from '../types/contracts';

interface AnalysisViewProps {
  selectedImage: ImageMetadata | null;
  localPreviewUrl: string | null;
  job: JobStatusResponse | null;
  results: JobResultsResponse | null;
  isLoadingResults: boolean;
  resultsError: string | null;
  onBackToWorkspace: () => void;
  onRetryResults: () => void;
  onRiskGridUpdated: (riskGrid: RiskGrid) => void;
}

export function AnalysisView({
  selectedImage,
  localPreviewUrl,
  job,
  results,
  isLoadingResults,
  resultsError,
  onBackToWorkspace,
  onRetryResults,
  onRiskGridUpdated,
}: AnalysisViewProps) {
  if (!selectedImage && !job) {
    return (
      <section className="ms-panel p-10 text-center flex flex-col items-center gap-3">
        <MapIcon className="w-10 h-10 text-sky-400/80" />
        <h2 className="text-lg font-semibold text-slate-100">No Image Selected for 2D Map</h2>
        <p className="text-sm text-slate-400 max-w-lg leading-relaxed">
          Upload or select an LRO LROC NAC image in the Workspace tab first. You can inspect a
          local PNG/JPEG immediately in the 2D Leaflet map or run full boulder screening against the
          FastAPI backend.
        </p>
        <button type="button" onClick={onBackToWorkspace} className="ms-btn-primary mt-2">
          <ArrowLeft className="w-4 h-4" />
          <span>Go to Workspace</span>
        </button>
      </section>
    );
  }

  const imageId = selectedImage?.image_id ?? job?.image_id ?? '';
  const activeMetadata: ImageMetadata = selectedImage ?? {
    image_id: imageId,
    source_image_id: imageId,
    width_px: 1000,
    height_px: 1000,
    gsd_x_m_per_px: null,
    gsd_y_m_per_px: null,
    coverage: 'missing',
    coordinate_frame: results?.risk_grid.coordinate_frame ?? 'image_px',
    image_to_lunar: null,
  };

  const previewUrl = localPreviewUrl ?? getImagePreviewUrl(imageId);
  const apiBaseUrl = buildApiEndpoint('/api');

  const riskCounts = results
    ? results.risk_grid.cells.reduce(
        (acc, cell) => {
          acc[cell.class] = (acc[cell.class] ?? 0) + 1;
          return acc;
        },
        { safe: 0, caution: 0, unsafe: 0, uncertain: 0 } as Record<string, number>,
      )
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header action bar */}
      <div className="ms-panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBackToWorkspace} className="ms-btn-secondary text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Workspace</span>
          </button>
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              {activeMetadata.source_image_id}
            </h2>
            <p className="text-xs font-mono text-slate-400">
              {activeMetadata.width_px} × {activeMetadata.height_px} px
              {activeMetadata.gsd_x_m_per_px !== null
                ? ` · ${activeMetadata.gsd_x_m_per_px} m/px`
                : ' · GSD unscaled'}
              {job ? ` · job: ${job.job_id}` : localPreviewUrl ? ' · local preview' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {results && riskCounts && (
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
              <span className="px-2 py-1 rounded bg-sky-950/60 border border-sky-500/30 text-sky-200">
                {results.detections.length} detections
              </span>
              <span className="px-2 py-1 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-200">
                safe {riskCounts.safe}
              </span>
              <span className="px-2 py-1 rounded bg-amber-950/60 border border-amber-500/30 text-amber-200">
                caution {riskCounts.caution}
              </span>
              <span className="px-2 py-1 rounded bg-red-950/60 border border-red-500/30 text-red-200">
                unsafe {riskCounts.unsafe}
              </span>
              <span className="px-2 py-1 rounded bg-purple-950/60 border border-purple-500/30 text-purple-200">
                uncertain {riskCounts.uncertain}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Job progress / failure banners above the map */}
      {job && (job.status === 'queued' || job.status === 'running') && (
        <div className="text-xs text-sky-200 bg-sky-950/40 border border-sky-500/30 rounded-xl p-3 flex items-center gap-2.5">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>
            Screening job <code>{job.job_id}</code> is currently <strong>{job.status}</strong>.
            Detections and RiskGrid layers will appear automatically when complete.
          </span>
        </div>
      )}

      {job && job.status === 'failed' && (
        <div
          role="alert"
          className="text-xs text-red-200 bg-red-950/50 border border-red-500/40 rounded-xl p-3"
        >
          <strong>Screening Job Failed:</strong>{' '}
          {typeof job.error === 'string'
            ? job.error
            : ((job.error as unknown as { message?: string } | null)?.message ??
              'Unknown failure during screening.')}
        </div>
      )}

      {job && job.status === 'completed' && isLoadingResults && (
        <div className="text-xs text-slate-300 bg-[#0e131d] border border-slate-800 rounded-xl p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          <span>Loading detections and RiskGrid results…</span>
        </div>
      )}

      {resultsError && (
        <div
          role="alert"
          className="text-xs text-red-200 bg-red-950/50 border border-red-500/40 rounded-xl p-3 flex items-center justify-between gap-2"
        >
          <span>{resultsError}</span>
          <button type="button" onClick={onRetryResults} className="ms-btn-secondary text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Primary Interactive 2D Leaflet Map + Layer/Threshold/Inspector Sidebar */}
      <AnalysisMapViewer
        imageMetadata={activeMetadata}
        job={job}
        results={results}
        previewUrl={previewUrl}
        apiBaseUrl={apiBaseUrl}
        onRiskGridUpdated={onRiskGridUpdated}
      />

      {/* Compact ImageMetadata & Provenance Footer */}
      {selectedImage && (
        <section className="ms-panel p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-slate-200 font-medium">
            <Compass className="w-4 h-4 text-sky-400" />
            <span>Scene Metadata</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-slate-300">
            <span>id: {selectedImage.image_id}</span>
            <span>coverage: {selectedImage.coverage}</span>
            <span>frame: {selectedImage.coordinate_frame}</span>
            <span>
              GSD:{' '}
              {selectedImage.gsd_x_m_per_px !== null && selectedImage.gsd_y_m_per_px !== null
                ? `${selectedImage.gsd_x_m_per_px} × ${selectedImage.gsd_y_m_per_px} m/px`
                : 'null'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Info className="w-3.5 h-3.5 text-sky-400" />
            <span>Screening aid only; thresholds are unvalidated illustrative defaults.</span>
          </div>
        </section>
      )}
    </div>
  );
}
