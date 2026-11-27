import type { ThresholdRecalcPayload, ThresholdRecalcResponse } from './types';

/**
 * Recalculate RiskGrid thresholds without rerunning YOLO detection.
 * Supports both `/api/jobs/{id}/thresholds` (backend default) and `/api/v1/jobs/{id}/thresholds`
 * via the deployment reverse proxy or explicit base URL.
 */
export async function updateJobThresholds(
  jobId: string,
  payload: ThresholdRecalcPayload,
  apiBase = '/api',
  signal?: AbortSignal,
): Promise<ThresholdRecalcResponse> {
  const base = apiBase.replace(/\/+$/, '');
  const response = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}/thresholds`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const errMsg =
      body?.error?.message ||
      body?.detail ||
      `Threshold update failed (${response.status} ${response.statusText})`;
    throw new Error(errMsg);
  }
  return body as ThresholdRecalcResponse;
}
