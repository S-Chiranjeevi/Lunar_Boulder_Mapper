import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Compass,
  Info,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
} from 'lucide-react';
import { AnalysisMapViewer } from '../../features/map';
import { getApiBaseUrl, getImagePreviewUrl } from '../api/client';
import type { ImageMetadata, JobResultsResponse, JobStatusResponse, RiskGrid } from '../types/contracts';

interface AnalysisViewProps {
  selectedImage: ImageMetadata | null;
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
        <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-400/25 flex items-center justify-center text-sky-400">
          <MapIcon className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-slate-100">No Image Selected for Screening</h2>
        <p className="text-sm text-slate-400 max-w-lg">
          Upload or select an LRO LROC NAC image in the Workspace tab first. MoonSafe never displays
          fabricated detections or synthetic RiskGrid results before running a job.
        </p>
        <button type="button" onClick={onBackToWorkspace} className="ms-btn-primary mt-2">
          <ArrowLeft className="w-4 h-4" />
          <span>Go to Workspace</span>
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
            <span>Workspace</span>
          </button>
          <div>
            <h2 className="text-base font-semibold text-slate-50">
              {selectedImage?.source_image_id ?? imageId}
            </h2>
            <p className="text-xs font-mono text-slate-400">
              {selectedImage
                ? `${selectedImage.width_px.toLocaleString()} × ${selectedImage.height_px.toLocaleString()} px`
                : 'Image details unavailable'}
              {job ? ` · job ${job.job_id}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span
            className={`px-2.5 py-1 rounded-full border ${
              hasLunarTransform
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/35'
                : 'bg-purple-950/60 text-purple-200 border-purple-500/35'
            }`}
          >
            {hasLunarTransform ? 'frame: lunar_local_m' : 'frame: image_px (location uncertain)'}
          </span>
          <span className="px-2.5 py-1 rounded-full border bg-slate-900/90 text-slate-300 border-slate-700">
            screening_only: true
          </span>
        </div>
      </div>

      {/* KPI summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="ms-panel p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center text-sky-300 shrink-0">
            <ScanSearch className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Candidates</div>
            <div className="text-lg font-semibold text-slate-50 font-mono">
              {results ? results.detections.length : '—'}
            </div>
          </div>
        </div>

        <div className="ms-panel p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-400/25 flex items-center justify-center text-red-300 shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Unsafe Cells</div>
            <div className="text-lg font-semibold text-red-300 font-mono">
              {riskCounts ? riskCounts.unsafe : '—'}
            </div>
          </div>
        </div>

        <div className="ms-panel p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/25 flex items-center justify-center text-amber-300 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Caution Cells</div>
            <div className="text-lg font-semibold text-amber-300 font-mono">
              {riskCounts ? riskCounts.caution : '—'}
            </div>
          </div>
        </div>

        <div className="ms-panel p-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center text-emerald-300 shrink-0">
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Safe / Uncertain</div>
            <div className="text-sm font-semibold text-slate-100 font-mono truncate">
              {riskCounts ? `${riskCounts.safe} / ${riskCounts.uncertain}` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Coordinate & model honesty notices */}
      {!hasLunarTransform && selectedImage && (
        <div className="bg-purple-950/30 border border-purple-500/35 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-purple-100">
          <AlertTriangle className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
          <div>
            <strong>Lunar location not verified.</strong> No trusted{' '}
            <code>image_to_lunar</code> transform was supplied, so positions remain strictly in{' '}
            <code>image_px</code> (never Earth longitude/latitude or standard GeoJSON).
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5">
        <section className="ms-panel p-4 sm:p-5 flex flex-col gap-4" aria-labelledby="map-slot-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="map-slot-heading" className="text-sm font-semibold text-slate-50">
                Interactive 2D Screening Map
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Pan and zoom across the NAC image. Click any boulder box or RiskGrid cell to inspect
                size, confidence, coordinates, and reason codes.
              </p>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-sky-950/70 text-sky-200 border border-sky-500/30">
              Leaflet 2D · Authoritative
            </span>
          </div>

          {selectedImage ? (
            <AnalysisMapViewer
              imageMetadata={selectedImage}
              job={job}
              results={results}
              previewUrl={getImagePreviewUrl(imageId)}
              apiBaseUrl={getApiBaseUrl()}
              onRiskGridUpdated={onRiskGridUpdated}
            />
          ) : (
            <div className="ms-panel-elevated p-8 text-center text-sm text-slate-300">
              This image is no longer in the library. Return to the workspace and select an image to
              continue.
            </div>
          )}
        </section>

        <aside className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {selectedImage && (
            <section className="ms-panel p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-100">Image Details</h3>
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
                    : 'Not provided'}
                </dd>

                <dt className="text-slate-400">Coverage</dt>
                <dd className="font-mono text-slate-100 text-right capitalize">
                  {selectedImage.coverage}
                </dd>

                <dt className="text-slate-400">Coordinate Frame</dt>
                <dd className="font-mono text-slate-100 text-right">
                  {hasLunarTransform ? 'lunar_local_m' : 'image_px'}
                </dd>
              </dl>
            </section>
          )}

          {/* Job / Results status card */}
          <section className="ms-panel p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-slate-100">Screening Run Summary</h3>

            {!job && (
              <div className="text-xs text-slate-300 bg-[#0b101a] border border-slate-800 rounded-xl p-3 flex items-start gap-2">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>
                  No screening job has run for this image yet. Return to the Workspace tab to launch
                  detection.
                </span>
              </div>
            )}

            {job && (job.status === 'queued' || job.status === 'running') && (
              <div className="text-xs text-sky-200 bg-sky-950/40 border border-sky-500/30 rounded-xl p-3 flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>
                  Screening is {job.status === 'queued' ? 'waiting to start' : 'in progress'}…
                </span>
              </div>
            )}

            {job && job.status === 'failed' && (
              <div
                role="alert"
                className="text-xs text-red-200 bg-red-950/50 border border-red-500/40 rounded-xl p-3"
              >
                <strong>Job Failed:</strong> {job.error ?? 'Unknown failure during screening.'}
              </div>
            )}

            {job && job.status === 'completed' && isLoadingResults && (
              <div className="text-xs text-slate-300 bg-[#0b101a] border border-slate-800 rounded-xl p-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                <span>Loading screening results…</span>
              </div>
            )}

            {resultsError && (
              <div
                role="alert"
                className="text-xs text-red-200 bg-red-950/50 border border-red-500/40 rounded-xl p-3 flex flex-col gap-2"
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
                <div className="bg-[#0b101a] border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5">
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
                  <p className="text-[11px] text-amber-200/90 bg-amber-950/35 border border-amber-500/30 rounded-xl p-2.5">
                    {results.status_message}
                  </p>
                )}

                {results.detections.length === 0 && (
                  <p className="text-[11px] text-slate-400">
                    Zero boulder detections returned. No synthetic or placeholder detections are
                    fabricated.
                  </p>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
