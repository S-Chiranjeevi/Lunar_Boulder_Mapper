import type {
  ImageListResponse,
  ImageMetadata,
  ImageUploadResponse,
  JobCreateRequest,
  JobCreateResponse,
  JobResultsResponse,
  JobStatusResponse,
} from '../types/contracts';

const API_URL_STORAGE_KEY = 'moonsafe_api_base_url';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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

function normalizeBaseUrl(raw: string | undefined | null): string {
  return (raw ?? '').trim().replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  try {
    const stored = window.localStorage.getItem(API_URL_STORAGE_KEY);
    if (stored !== null && stored.trim()) {
      return normalizeBaseUrl(stored);
    }
  } catch {
    // Ignore storage access restrictions.
  }
  const envBase = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL;
  return normalizeBaseUrl(envBase);
}

export function setApiBaseUrl(url: string): string {
  const normalized = normalizeBaseUrl(url);
  try {
    if (normalized) {
      window.localStorage.setItem(API_URL_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(API_URL_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
  return normalized;
}

export function buildApiEndpoint(path: string): string {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const url = buildApiEndpoint(path);
  try {
    response = await fetch(url, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(`Unable to reach MoonSafe API (${detail})`, 0, 'network_error');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const structuredMessage =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'message' in body.error &&
      typeof body.error.message === 'string'
        ? body.error.message
        : null;
    const structuredCode =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'code' in body.error &&
      typeof body.error.code === 'string'
        ? body.error.code
        : undefined;
    const detailField =
      body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
        ? body.detail
        : null;
    const statusLabel = response.statusText
      ? `${response.status} ${response.statusText}`
      : `HTTP ${response.status}`;

    throw new ApiError(
      structuredMessage || detailField || `API request failed (${statusLabel})`,
      response.status,
      structuredCode,
    );
  }

  return body as T;
}

export function getImagePreviewUrl(imageId: string): string {
  return buildApiEndpoint(`/api/images/${encodeURIComponent(imageId)}/preview`);
}

export async function listImages(signal?: AbortSignal): Promise<ImageMetadata[]> {
  const payload = await requestJson<ImageListResponse | ImageMetadata[]>('/api/images', {
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

  const inlineMeta: Record<string, unknown> = {};
  if (payload.sourceImageId?.trim()) {
    inlineMeta.source_image_id = payload.sourceImageId.trim();
  }
  if (payload.gsdXMPerPx?.trim()) {
    inlineMeta.gsd_x_m_per_px = Number(payload.gsdXMPerPx.trim());
  }
  if (payload.gsdYMPerPx?.trim()) {
    inlineMeta.gsd_y_m_per_px = Number(payload.gsdYMPerPx.trim());
  }
  if (payload.coverage) {
    inlineMeta.coverage = payload.coverage;
  }
  if (Object.keys(inlineMeta).length > 0) {
    form.append('metadata_json', JSON.stringify(inlineMeta));
  }

  const raw = await requestJson<ImageUploadResponse | ImageMetadata>('/api/images', {
    method: 'POST',
    body: form,
    signal,
  });

  if ('metadata' in raw && raw.metadata) {
    return raw;
  }

  const meta = raw as ImageMetadata;
  return {
    image_id: meta.image_id,
    metadata: meta,
    preview_url: getImagePreviewUrl(meta.image_id),
  };
}

export async function startProcessingJob(
  payload: JobCreateRequest,
  signal?: AbortSignal,
): Promise<JobCreateResponse> {
  return requestJson<JobCreateResponse>('/api/jobs', {
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
  return requestJson<JobStatusResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    signal,
  });
}

export async function getJobResults(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobResultsResponse> {
  return requestJson<JobResultsResponse>(`/api/jobs/${encodeURIComponent(jobId)}/results`, {
    method: 'GET',
    signal,
  });
}
