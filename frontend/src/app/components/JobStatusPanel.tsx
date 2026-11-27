import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2, ShieldAlert } from 'lucide-react';
import type { JobStatus, JobStatusResponse } from '../types/contracts';

interface JobStatusPanelProps {
  job: JobStatusResponse | null;
  pollingError: string | null;
  isPolling: boolean;
  onOpenAnalysis: () => void;
  onRetryPoll: () => void;
}

const STATUS_BADGES: Record<JobStatus, { label: string; classes: string }> = {
  queued: {
    label: 'Queued',
    classes: 'bg-slate-800 text-slate-200 border-slate-600/60',
  },
  running: {
    label: 'Running',
    classes: 'bg-sky-950/70 text-sky-300 border-sky-500/40',
  },
  completed: {
    label: 'Completed',
    classes: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-950/70 text-red-300 border-red-500/40',
  },
};

export function JobStatusPanel({
  job,
  pollingError,
  isPolling,
  onOpenAnalysis,
  onRetryPoll,
}: JobStatusPanelProps) {
  return (
    <section className="ms-panel p-5 flex flex-col gap-4" aria-labelledby="job-status-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="job-status-heading" className="text-base font-semibold text-slate-100">
            3. Processing Status &amp; Hazard Map Handoff
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Tracks background boulder detection, pixel-to-metre sizing, and RiskGrid generation.
          </p>
        </div>

        {job && (
          <span
            className={`text-xs font-mono px-2.5 py-1 rounded-md border inline-flex items-center gap-1.5 ${
              STATUS_BADGES[job.status].classes
            }`}
          >
            {(job.status === 'queued' || job.status === 'running') && (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            )}
            {job.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5" />}
            {job.status === 'failed' && <AlertCircle className="w-3.5 h-3.5" />}
            {job.status === 'queued' && <Clock className="w-3.5 h-3.5" />}
            <span>{STATUS_BADGES[job.status].label}</span>
          </span>
        )}
      </div>

      {/* Empty pre-job state */}
      {!job && !pollingError && (
        <div className="ms-panel-elevated p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-200">
                No screening job started in this session
              </p>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                Select an uploaded image and click <strong>Run Boulder Screening</strong>. If YOLO
                model weights are not configured on the backend, MoonSafe reports that state clearly
                without fabricating detections.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAnalysis}
            className="ms-btn-secondary text-xs shrink-0"
          >
            <span>Open 2D Hazard Map</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Polling error state */}
      {pollingError && (
        <div
          role="alert"
          className="bg-red-950/50 border border-red-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div>
            <p className="text-sm font-medium text-red-200">Could not refresh job status</p>
            <p className="text-xs text-red-200/90 mt-0.5">{pollingError}</p>
          </div>
          <button type="button" onClick={onRetryPoll} className="ms-btn-secondary text-xs shrink-0">
            Retry Status Check
          </button>
        </div>
      )}

      {/* Active / Completed / Failed job details */}
      {job && (
        <div className="ms-panel-elevated p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-slate-400">Job ID</div>
              <div className="font-mono text-slate-100 truncate mt-0.5">{job.job_id}</div>
            </div>
            <div>
              <div className="text-slate-400">Image ID</div>
              <div className="font-mono text-slate-100 truncate mt-0.5">{job.image_id}</div>
            </div>
            <div>
              <div className="text-slate-400">Profile</div>
              <div className="font-mono text-slate-100 capitalize mt-0.5">
                {job.threshold_profile ?? 'custom'}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Pipeline Status</div>
              <div className="font-mono text-slate-100 truncate mt-0.5">
                {job.model_status ?? (isPolling ? 'polling…' : job.status)}
              </div>
            </div>
          </div>

          {job.status_message && (
            <div className="text-xs text-slate-300 bg-[#0e131d] border border-slate-800 rounded-lg p-3">
              {job.status_message}
            </div>
          )}

          {job.error && (
            <div
              role="alert"
              className="text-xs text-red-200 bg-red-950/60 border border-red-500/40 rounded-lg p-3"
            >
              <strong>Job Error:</strong>{' '}
              {typeof job.error === 'string'
                ? job.error
                : ((job.error as unknown as { message?: string } | null)?.message ??
                  'Screening job failed.')}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-[11px] font-mono text-slate-400">
              {job.model_version
                ? `model_version: ${job.model_version}`
                : 'Model metadata will appear once inference completes'}
            </span>

            <button type="button" onClick={onOpenAnalysis} className="ms-btn-primary text-xs">
              <span>Open 2D Hazard Map</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
