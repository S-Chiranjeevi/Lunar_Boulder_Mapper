import type {
  ImageListResponse,
  ImageMetadata,
  ImageUploadResponse,
  JobCreateRequest,
  JobCreateResponse,
  JobResultsResponse,
  JobStatusResponse,
} from '../types/contracts';

const STORAGE_KEY = 'moonsafe_api_origin';
const ENV_API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';

let detectedApiPrefix: '/api/v1' | '/api' | null = null;

function sanitizeOrigin(raw: string): string {
  return raw.trim().replace(/\/+(api(\/v1)?)?\/?$/i, '').replace(/\/+$/, '');
}

export function getConfiguredApiOrigin(): string {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null && stored.trim() !== '') {
      return sanitizeOrigin(stored);
    }
  }
  return sanitizeOrigin(ENV_API_BASE_URL);
}

export function setConfiguredApiOrigin(origin: string): string {
  const cleaned = sanitizeOrigin(origin);
  detectedApiPrefix = null;
  if (typeof window !== 'undefined') {
    if (cleaned) {
      window.localStorage.setItem(STORAGE_KEY, cleaned);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }
  return getConfiguredApiOrigin();
}

export function hasCustomApiOriginOverride(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored !== null && stored.trim() !== '';
}

export function getEnvApiOrigin(): string {
  return sanitizeOrigin(ENV_API_BASE_URL);
}

export function getApiBaseUrl(): string {
  const origin = getConfiguredApiOrigin();
  const prefix = detectedApiPrefix ?? '/api/v1';
  return `${origin}${prefix}`;
}

function buildUrl(prefix: '/api/v1' | '/api', path: string): string {
  return `${getConfiguredApiOrigin()}${prefix}${path}`;
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

export interface ApiHealthStatus {
  ok: boolean;
  origin: string;
  prefix: '/api/v1' | '/api';
  message: string;
}

function extractErrorMessage(body: unknown, response: Response): string {
  if (body && typeof body === 'object') {
    if ('detail' in body && typeof body.detail === 'string') {
      return body.detail;
    }
    if (
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'message' in body.error &&
      typeof body.error.message === 'string'
    ) {
      return body.error.message;
    }
    if ('message' in body && typeof body.message === 'string') {
      return body.message;
    }
  }
  return `API request failed (${response.status} ${response.statusText})`;
}

async function requestJsonWithFallback<T>(path: string, init?: RequestInit): Promise<T> {
  const order: Array<'/api/v1' | '/api'> =
    detectedApiPrefix === '/api' ? ['/api', '/api/v1'] : ['/api/v1', '/api'];

  let lastError: ApiError | null = null;

  for (let i = 0; i < order.length; i += 1) {
    const prefix = order[i];
    const url = buildUrl(prefix, path);

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Network error';
      const origin = getConfiguredApiOrigin();
      const targetHint = origin || 'same-origin (/api/v1)';
      throw new ApiError(
        `Unable to reach MoonSafe API at ${targetHint} (${detail}). Connect a FastAPI backend URL in "API Setup" or set VITE_API_BASE_URL.`,
        0,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (response.ok && !contentType.toLowerCase().includes('application/json')) {
      lastError = new ApiError(
        `MoonSafe API route ${prefix}${path} returned ${contentType || 'a non-JSON response'}. The configured host may serve the website without a FastAPI backend.`,
        502,
      );
      if (i < order.length - 1) continue;
      throw lastError;
    }
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;

    if (response.status === 404 && i < order.length - 1) {
      lastError = new ApiError(extractErrorMessage(body, response), response.status);
      continue;
    }

    if (!response.ok) {
      throw new ApiError(extractErrorMessage(body, response), response.status);
    }

    if (body === null) {
      lastError = new ApiError(`MoonSafe API route ${prefix}${path} returned invalid JSON.`, 502);
      if (i < order.length - 1) continue;
      throw lastError;
    }

    detectedApiPrefix = prefix;
    return body as T;
  }

  throw lastError ?? new ApiError('MoonSafe API endpoint not found (404)', 404);
}

export async function testApiConnection(signal?: AbortSignal): Promise<ApiHealthStatus> {
  const origin = getConfiguredApiOrigin();
  const candidates: Array<{ url: string; prefix: '/api/v1' | '/api' }> = [
    { url: `${origin}/api/v1/images`, prefix: '/api/v1' },
    { url: `${origin}/api/images`, prefix: '/api' },
  ];

  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url, { method: 'GET', signal });
      const contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType.toLowerCase().includes('application/json')) {
        const payload: unknown = await res.json().catch(() => null);
        const isImageList =
          Array.isArray(payload) ||
          (payload !== null &&
            typeof payload === 'object' &&
            'images' in payload &&
            Array.isArray((payload as { images?: unknown }).images));
        if (!isImageList) continue;
        detectedApiPrefix = candidate.prefix;
        return {
          ok: true,
          origin: origin || window.location.origin,
          prefix: candidate.prefix,
          message: `Connected (${candidate.prefix})`,
        };
      }
    } catch {
      return {
        ok: false,
        origin: origin || window.location.origin,
        prefix: '/api/v1',
        message: 'Could not reach backend (check URL, HTTPS, or MOONSAFE_CORS_ORIGINS).',
      };
    }
  }

  return {
    ok: false,
    origin: origin || window.location.origin,
    prefix: '/api/v1',
    message: origin
      ? 'No MoonSafe FastAPI image endpoint was found at this origin.'
      : 'This Vercel deployment serves the website only. Deploy the FastAPI backend separately, then enter its URL here or set VITE_API_BASE_URL.',
  };
}

export function getImagePreviewUrl(imageId: string): string {
  const prefix = detectedApiPrefix ?? '/api/v1';
  return buildUrl(prefix, `/images/${encodeURIComponent(imageId)}/preview`);
}

function normalizeImageMetadata(raw: Record<string, unknown>): ImageMetadata {
  return {
    image_id: String(raw.image_id ?? ''),
    source_image_id: String(raw.source_image_id ?? raw.image_id ?? ''),
    width_px: Number(raw.width_px ?? 0),
    height_px: Number(raw.height_px ?? 0),
    gsd_x_m_per_px:
      typeof raw.gsd_x_m_per_px === 'number' ? raw.gsd_x_m_per_px : null,
    gsd_y_m_per_px:
      typeof raw.gsd_y_m_per_px === 'number' ? raw.gsd_y_m_per_px : null,
    coverage: (raw.coverage as ImageMetadata['coverage']) ?? 'missing',
    coordinate_frame:
      (raw.coordinate_frame as ImageMetadata['coordinate_frame']) ?? 'image_px',
    image_to_lunar:
      raw.image_to_lunar && typeof raw.image_to_lunar === 'object'
        ? (raw.image_to_lunar as Record<string, unknown>)
        : null,
  };
}

export async function listImages(signal?: AbortSignal): Promise<ImageMetadata[]> {
  const payload = await requestJsonWithFallback<ImageListResponse | Record<string, unknown>[]>(
    '/images',
    {
      method: 'GET',
      signal,
    },
  );
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeImageMetadata(item));
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.images)) {
    throw new ApiError('MoonSafe API returned an invalid image library response.', 502);
  }
  const list = Array.isArray(payload?.images) ? payload.images : [];
  return list.map((item) => normalizeImageMetadata(item as unknown as Record<string, unknown>));
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
    form.append('source_image_id', payload.sourceImageId.trim());
    inlineMeta.source_image_id = payload.sourceImageId.trim();
  }
  if (payload.gsdXMPerPx?.trim()) {
    form.append('gsd_x_m_per_px', payload.gsdXMPerPx.trim());
    inlineMeta.gsd_x_m_per_px = Number(payload.gsdXMPerPx.trim());
  }
  if (payload.gsdYMPerPx?.trim()) {
    form.append('gsd_y_m_per_px', payload.gsdYMPerPx.trim());
    inlineMeta.gsd_y_m_per_px = Number(payload.gsdYMPerPx.trim());
  }
  if (payload.coverage) {
    form.append('coverage', payload.coverage);
    inlineMeta.coverage = payload.coverage;
  }
  if (Object.keys(inlineMeta).length > 0) {
    form.append('metadata_json', JSON.stringify(inlineMeta));
  }

  const raw = await requestJsonWithFallback<Record<string, unknown>>('/images', {
    method: 'POST',
    body: form,
    signal,
  });

  if (raw && typeof raw === 'object' && 'metadata' in raw && raw.metadata && typeof raw.metadata === 'object') {
    const metadata = normalizeImageMetadata(raw.metadata as Record<string, unknown>);
    return {
      image_id: String(raw.image_id ?? metadata.image_id),
      metadata,
      has_elevation_data: Boolean(raw.has_elevation_data),
      preview_url: typeof raw.preview_url === 'string' ? raw.preview_url : getImagePreviewUrl(metadata.image_id),
    };
  }

  const metadata = normalizeImageMetadata(raw);
  return {
    image_id: metadata.image_id,
    metadata,
    has_elevation_data: Boolean(raw.has_elevation_data),
    preview_url: typeof raw.preview_url === 'string' ? raw.preview_url : getImagePreviewUrl(metadata.image_id),
  };
}

export async function startProcessingJob(
  payload: JobCreateRequest,
  signal?: AbortSignal,
): Promise<JobCreateResponse> {
  return requestJsonWithFallback<JobCreateResponse>('/jobs', {
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
  const raw = await requestJsonWithFallback<Record<string, unknown>>(
    `/jobs/${encodeURIComponent(jobId)}`,
    {
      method: 'GET',
      signal,
    },
  );
  const rawErr = raw.error;
  const normalizedError =
    typeof rawErr === 'string'
      ? rawErr
      : rawErr && typeof rawErr === 'object' && 'message' in rawErr && typeof rawErr.message === 'string'
        ? rawErr.message
        : null;

  const thresholdCfg =
    (raw.thresholds as JobStatusResponse['thresholds']) ??
    (raw.threshold_config as JobStatusResponse['thresholds']);
  const cfgProfile =
    raw.threshold_config && typeof raw.threshold_config === 'object' && 'threshold_profile' in raw.threshold_config
      ? (raw.threshold_config.threshold_profile as JobStatusResponse['threshold_profile'])
      : undefined;

  return {
    job_id: String(raw.job_id ?? jobId),
    image_id: String(raw.image_id ?? ''),
    status: (raw.status as JobStatusResponse['status']) ?? 'queued',
    threshold_profile:
      (raw.threshold_profile as JobStatusResponse['threshold_profile']) ?? cfgProfile,
    thresholds: thresholdCfg,
    model_status: typeof raw.model_status === 'string' ? raw.model_status : undefined,
    model_version: typeof raw.model_version === 'string' ? raw.model_version : undefined,
    status_message: typeof raw.status_message === 'string' ? raw.status_message : undefined,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
    error: normalizedError,
  };
}

export async function getJobResults(
  jobId: string,
  signal?: AbortSignal,
): Promise<JobResultsResponse> {
  return requestJsonWithFallback<JobResultsResponse>(
    `/jobs/${encodeURIComponent(jobId)}/results`,
    {
      method: 'GET',
      signal,
    },
  );
}
