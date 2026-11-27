import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Compass,
  Info,
  Loader2,
  Map as MapIcon,
  RefreshCw,
} from 'lucide-react';
import { getImagePreviewUrl } from '../api/client';
import type { ImageMetadata, JobResultsResponse, JobStatusResponse } from '../types/contracts';

interface AnalysisViewProps {
  selectedImage: ImageMetadata | null;
  job: JobStatusResponse | null;
  results: JobResultsResponse | null;
  isLoadingResults: boolean;
  resultsError: string | null;
  onBackToWorkspace: () => void;
  onRetryResults: () => void;
}

export function AnalysisView({
  selectedImage,
  job,
  results,
  isLoadingResults,
  resultsError,
  onBackToWorkspace,
  onRetryResults,
}: AnalysisViewProps) {
  if (!selectedImage && !job) {
    return (
      <section className="ms-panel p-8 text-center flex flex-col items-center gap-3">
        <MapIcon className="w-9 h-9 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-100">No Image Selected for Analysis</h2>
        <p className="text-sm text-slate-400 max-w-lg">
          Upload or select an LRO LROC NAC image in the Workspace &amp; Ingest tab first. No fake
          detections or synthetic RiskGrid results are displayed prior to running a job.
        </p>
        <button type="button" onClick={onBackToWorkspace} className="ms-btn-primary mt-2">
          <ArrowLeft className="w-4 h-4" />
          <span>Go to Workspace &amp; Ingest</span>
        </button>
      </section>
    );
  }

  const imageId = selectedImage?.image_id ?? job?.image_id ?? '';
  const hasLunarTransform =
    selectedImage?.coordinate_frame === 'lunar_local_m' && selectedImage?.image_to_lunar !== null;

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
    <div className="flex flex-col gap-5">
      {/* Header action bar */}
      <div className="ms-panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBackToWorkspace} className="ms-btn-secondary text-xs">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Workspace</span>
          </button>
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Analysis View — {selectedImage?.source_image_id ?? imageId}
            </h2>
            <p className="text-xs font-mono text-slate-400">
              image_id: {imageId}
              {job ? ` · job_id: ${job.job_id}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span
            className={`px-2.5 py-1 rounded border ${
              hasLunarTransform
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30'
                : 'bg-purple-950/60 text-purple-200 border-purple-500/35'
            }`}
          >
            {hasLunarTransform
              ? 'frame: lunar_local_m'
              : 'frame: image_px (location uncertain)'}
          </span>
          <span className="px-2.5 py-1 rounded border bg-slate-900 text-slate-300 border-slate-700">
            screening_only: true
          </span>
        </div>
      </div>

      {/* Coordinate & model honesty notices */}
      {!hasLunarTransform && selectedImage && (
        <div className="bg-purple-950/35 border border-purple-500/35 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-purple-100">
          <AlertTriangle className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
          <div>
            <strong>Georeferencing Uncertain:</strong> No verified{' '}
            <code>image_to_lunar</code> transform was supplied for this image. Coordinates are
            retained strictly in <code>image_px</code>, not Earth longitude/latitude or standard
            GeoJSON.
          </div>
        </div>
      )}

      {/* Main layout: Primary 2D Map Slot + Sidebar Metadata/Results Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Authoritative 2D Viewer Handoff Slot (Map NOT implemented in this shell branch) */}
        <section
          className="lg:col-span-2 ms-panel p-5 flex flex-col gap-4"
          aria-labelledby="map-slot-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="map-slot-heading" className="text-sm font-semibold text-slate-100">
                Authoritative 2D Screening Map Slot
              </h3>
              <p className="text-xs text-slate-400">
                Reserved mount container for the Leaflet 2D map feature (not implemented in{' '}
                <code>feature/01-web-shell</code>).
              </p>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sky-950/70 text-sky-300 border border-sky-500/30">
              2D Primary Viewport
            </span>
          </div>

          <div
            data-testid="map-feature-slot"
            className="rounded-xl border border-dashed border-slate-700 bg-[#0b0f17] overflow-hidden flex flex-col"
          >
            {imageId ? (
              <div className="relative flex flex-col items-center justify-center p-4 gap-3">
                <img
                  src={getImagePreviewUrl(imageId)}
                  alt={`Preview of LRO NAC image ${selectedImage?.source_image_id ?? imageId}`}
                  className="max-h-96 w-auto object-contain rounded border border-slate-800 bg-black"
                />
                <div className="w-full flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono border-t border-slate-800/80 pt-3">
                  <span>
                    Preview via GET /api/v1/images/{imageId}/preview
                  </span>
                  <span>
                    Interactive Leaflet CRS.Simple &amp; RiskGrid layers attach in map feature
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-xs text-slate-400">
                Select an image to preview it in the 2D workspace slot.
              </div>
            )}
          </div>

          {/* Optional 3D view honest availability notice */}
          <div className="ms-panel-elevated p-3.5 flex items-start gap-2.5 text-xs text-slate-300">
            <Box className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium text-slate-200">Optional 3D Terrain View:</span>{' '}
              Disabled — no real terrain elevation / DTM data is attached to this image. MoonSafe
              keeps the 2D map authoritative and does not invent terrain or boulder heights.
            </div>
          </div>
        </section>

        {/* Right column: Image metadata + honest job/results state */}
        <aside className="flex flex-col gap-4">
          {selectedImage && (
            <section className="ms-panel p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-100">ImageMetadata</h3>
              </div>

              <dl className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
                <dt className="text-slate-400">Dimensions</dt>
                <dd className="font-mono text-slate-100 text-right">
                  {selectedImage.width_px} × {selectedImage.height_px} px
                </dd>

                <dt className="text-slate-400">GSD X / Y</dt>
                <dd className="font-mono text-slate-100 text-right">
                  {selectedImage.gsd_x_m_per_px !== null && selectedImage.gsd_y_m_per_px !== null
                    ? `${selectedImage.gsd_x_m_per_px} / ${selectedImage.gsd_y_m_per_px} m/px`
                    : 'null (unscaled)'}
                </dd>

                <dt className="text-slate-400">Coverage</dt>
                <dd className="font-mono text-slate-100 text-right">{selectedImage.coverage}</dd>

                <dt className="text-slate-400">Frame</dt>
                <dd className="font-mono text-slate-100 text-right">
                  {selectedImage.coordinate_frame}
                </dd>
              </dl>
            </section>
          )}

          {/* Job / Results status card */}
          <section className="ms-panel p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-slate-100">Detection &amp; Risk Status</h3>

            {!job && (
              <div className="text-xs text-slate-300 bg-[#0e131d] border border-slate-800 rounded-lg p-3 flex items-start gap-2">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>
                  No processing job has been launched for this image yet. Return to Workspace &amp;
                  Ingest to start a job.
                </span>
              </div>
            )}

            {job && (job.status === 'queued' || job.status === 'running') && (
              <div className="text-xs text-sky-200 bg-sky-950/40 border border-sky-500/30 rounded-lg p-3 flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>
                  Job is currently <strong>{job.status}</strong>. Waiting for backend completion…
                </span>
              </div>
            )}

            {job && job.status === 'failed' && (
              <div
                role="alert"
                className="text-xs text-red-200 bg-red-950/50 border border-red-500/40 rounded-lg p-3"
              >
                <strong>Job Failed:</strong> {job.error ?? 'Unknown failure during screening.'}
              </div>
            )}

            {job && job.status === 'completed' && isLoadingResults && (
              <div className="text-xs text-slate-300 bg-[#0e131d] border border-slate-800 rounded-lg p-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                <span>Fetching results from /api/v1/jobs/{job.job_id}/results…</span>
              </div>
            )}

            {resultsError && (
              <div
                role="alert"
                className="text-xs text-red-200 bg-red-950/50 border border-red-500/40 rounded-lg p-3 flex flex-col gap-2"
              >
                <span>{resultsError}</span>
                <button
                  type="button"
                  onClick={onRetryResults}
                  className="ms-btn-secondary text-xs self-start"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Results</span>
                </button>
              </div>
            )}

            {results && (
              <div className="flex flex-col gap-3 text-xs">
                <div className="bg-[#0e131d] border border-slate-800 rounded-lg p-3 flex flex-col gap-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Model Status</span>
                    <span className="font-mono text-slate-100">
                      {results.model_status ?? 'reported'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Model Version</span>
                    <span className="font-mono text-slate-100">
                      {results.model_version ?? 'unconfigured'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Detections Returned</span>
                    <span className="font-mono text-slate-100">{results.detections.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">RiskGrid Cells</span>
                    <span className="font-mono text-slate-100">
                      {results.risk_grid.cells.length}
                    </span>
                  </div>
                </div>

                {results.status_message && (
                  <p className="text-[11px] text-amber-200/90 bg-amber-950/35 border border-amber-500/30 rounded-lg p-2.5">
                    {results.status_message}
                  </p>
                )}

                {results.detections.length === 0 && (
                  <p className="text-[11px] text-slate-400">
                    Zero boulder detections returned. No synthetic or placeholder detections are
                    fabricated.
                  </p>
                )}

                {riskCounts && (
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="p-2 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-200">
                      safe: {riskCounts.safe}
                    </div>
                    <div className="p-2 rounded bg-amber-950/40 border border-amber-500/30 text-amber-200">
                      caution: {riskCounts.caution}
                    </div>
                    <div className="p-2 rounded bg-red-950/40 border border-red-500/30 text-red-200">
                      unsafe: {riskCounts.unsafe}
                    </div>
                    <div className="p-2 rounded bg-purple-950/40 border border-purple-500/30 text-purple-200">
                      uncertain: {riskCounts.uncertain}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
