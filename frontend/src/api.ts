import type { Detection, ImageMetadata, Job, RiskGrid, ThresholdConfig, ThresholdProfile } from './types'

export type UploadOptions = {
  manifest?: File
  sourceImageId?: string
  gsdXMPerPx?: string
  gsdYMPerPx?: string
  coverage?: '' | 'valid' | 'partial' | 'missing'
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`)
  return body as T
}

export const api = {
  listImages: () => request<{ images: ImageMetadata[] }>('/api/v1/images'),
  upload: (image: File, options?: UploadOptions) => {
    const body = new FormData()
    body.append('file', image)
    if (options?.manifest) body.append('manifest', options.manifest)
    if (options?.sourceImageId?.trim()) body.append('source_image_id', options.sourceImageId.trim())
    if (options?.gsdXMPerPx?.trim()) body.append('gsd_x_m_per_px', options.gsdXMPerPx.trim())
    if (options?.gsdYMPerPx?.trim()) body.append('gsd_y_m_per_px', options.gsdYMPerPx.trim())
    if (options?.coverage) body.append('coverage', options.coverage)
    return request<{ image_id: string; metadata: ImageMetadata; preview_url: string; has_elevation_data?: boolean }>('/api/v1/images', { method: 'POST', body })
  },
  profiles: () => request<Record<ThresholdProfile, ThresholdConfig>>('/api/v1/profiles'),
  start: (imageId: string, profile: ThresholdProfile, thresholds: ThresholdConfig) => {
    return request<Job>('/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_id: imageId, threshold_profile: profile, thresholds }) })
  },
  job: (jobId: string) => request<Job>(`/api/v1/jobs/${jobId}`),
  results: (jobId: string) => request<{ detections: Detection[]; risk_grid: RiskGrid }>(`/api/v1/jobs/${jobId}/results`),
  thresholds: (jobId: string, profile: ThresholdProfile, value: ThresholdConfig) => request<{ threshold_profile: ThresholdProfile; thresholds: ThresholdConfig; rerun_detection: false; risk_grid: RiskGrid }>(`/api/v1/jobs/${jobId}/thresholds`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threshold_profile: profile, thresholds: value }),
  }),
}

