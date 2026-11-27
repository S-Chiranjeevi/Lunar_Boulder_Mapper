import { getConfiguredApiOrigin } from '../../app/api/client';
import type { ThresholdRecalcPayload, ThresholdRecalcResponse } from './types';

/**
 * Recalculate RiskGrid thresholds without rerunning YOLO detection.
 * Tries `/api/v1/jobs/{id}/thresholds` and `/api/jobs/{id}/thresholds`
 * so both versioned and root FastAPI deployments work seamlessly.
 */
export async function updateJobThresholds(
  jobId: string,
  payload: ThresholdRecalcPayload,
  apiBase?: string,
  signal?: AbortSignal,
): Promise<ThresholdRecalcResponse> {
  const origin = getConfiguredApiOrigin();
  const baseFromArg = apiBase ? apiBase.replace(/\/+$/, '') : '';
  const candidates = [
    baseFromArg ? `${baseFromArg}/jobs/${encodeURIComponent(jobId)}/thresholds` : null,
    `${origin}/api/v1/jobs/${encodeURIComponent(jobId)}/thresholds`,
    `${origin}/api/jobs/${encodeURIComponent(jobId)}/thresholds`,
  ].filter((url, idx, arr): url is string => Boolean(url) && arr.indexOf(url) === idx);

  let lastMessage = 'Threshold update failed';
  for (let i = 0; i < candidates.length; i += 1) {
    const response = await fetch(candidates[i], {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    const body = await response.json().catch(() => null);
    if (response.status === 404 && i < candidates.length - 1) {
      continue;
    }
    if (!response.ok) {
      lastMessage =
        body?.error?.message ||
        body?.detail ||
        `Threshold update failed (${response.status} ${response.statusText})`;
      throw new Error(lastMessage);
    }
    return body as ThresholdRecalcResponse;
  }

  throw new Error(lastMessage);
}
