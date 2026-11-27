import type {
  ImageListResponse,
  ImageMetadata,
  ImageUploadResponse,
  JobCreateRequest,
  JobCreateResponse,
  JobResultsResponse,
  JobStatusResponse,
} from '../types/contracts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface UploadImagePayload {
  file: File;
  manifest?: File | null;
  sourceImageId?: string;
  gsdXMPerPx?: string;
  gsdYMPerPx?: string;
  coverage?: 'valid' | 'partial' | 'missing' | '';
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(`Unable to reach MoonSafe API (${detail})`, 0);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const detail =
      (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
        ? body.detail
        : null) || `API request failed (${response.status} ${response.statusText})`;
    throw new ApiError(detail, response.status);
  }

  return body as T;
}

export function getImagePreviewUrl(imageId: string): string {
  return apiUrl(`/api/v1/images/${encodeURIComponent(imageId)}/preview`);
}

export async function listImages(signal?: AbortSignal): Promise<ImageMetadata[]> {
  const payload = await requestJson<ImageListResponse | ImageMetadata[]>(apiUrl('/api/v1/images'), {
    method: 'GET',
    signal,
  });
  if (Array.isArray(payload)) {
    return payload;
  }
  return Array.isArray(payload?.images) ? payload.images : [];
}

export async function uploadImage(
  payload: UploadImagePayload,
  signal?: AbortSignal,
): Promise<ImageUploadResponse> {
  const form = new FormData();
  form.append('file', payload.file);
  if (payload.manifest) {
    form.append('manifest', payload.manifest);
  }
  if (payload.sourceImageId?.trim()) {
    form.append('source_image_id', payload.sourceImageId.trim());
  }
  if (payload.gsdXMPerPx?.trim()) {
    form.append('gsd_x_m_per_px', payload.gsdXMPerPx.trim());
  }
  if (payload.gsdYMPerPx?.trim()) {
    form.append('gsd_y_m_per_px', payload.gsdYMPerPx.trim());
  }
  if (payload.coverage) {
    form.append('coverage', payload.coverage);
  }

  return requestJson<ImageUploadResponse>(apiUrl('/api/v1/images'), {
    method: 'POST',
    body: form,
    signal,
  });
}

export async function startProcessingJob(
  payload: JobCreateRequest,
  signal?: AbortSignal,
): Promise<JobCreateResponse> {
  return requestJson<JobCreateResponse>(apiUrl('/api/v1/jobs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function getJobStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobStatusResponse> {
  return requestJson<JobStatusResponse>(apiUrl(`/api/v1/jobs/${encodeURIComponent(jobId)}`), {
    method: 'GET',
    signal,
  });
}

export async function getJobResults(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobResultsResponse> {
  return requestJson<JobResultsResponse>(apiUrl(`/api/v1/jobs/${encodeURIComponent(jobId)}/results`), {
    method: 'GET',
    signal,
  });
}
