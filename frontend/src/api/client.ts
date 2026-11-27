/**
 * API client wrapping all MoonSafe backend endpoints.
 */

import axios from 'axios'
import type {
  HealthResponse,
  ImageListItem,
  ImageUploadResponse,
  JobCreateRequest,
  JobCreateResponse,
  JobResults,
  JobStatusResponse,
  ThresholdPatchRequest,
} from '../types/api'

const API_BASE = '/api/v1'

const client = axios.create({
  baseURL: API_BASE,
  timeout: 120_000, // 2 minutes for large uploads
})

// ── Health ───────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await client.get<HealthResponse>('/health')
  return data
}

// ── Images ───────────────────────────────────────────────────────────────────

export async function uploadImage(file: File): Promise<ImageUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await client.post<ImageUploadResponse>('/images', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function listImages(): Promise<ImageListItem[]> {
  const { data } = await client.get<ImageListItem[]>('/images')
  return data
}

export function getPreviewUrl(imageId: string): string {
  return `${API_BASE}/images/${imageId}/preview`
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export async function createJob(
  request: JobCreateRequest,
): Promise<JobCreateResponse> {
  const { data } = await client.post<JobCreateResponse>('/jobs', request)
  return data
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const { data } = await client.get<JobStatusResponse>(`/jobs/${jobId}`)
  return data
}

export async function getJobResults(jobId: string): Promise<JobResults> {
  const { data } = await client.get<JobResults>(`/jobs/${jobId}/results`)
  return data
}

export async function patchThresholds(
  jobId: string,
  request: ThresholdPatchRequest,
): Promise<JobStatusResponse> {
  const { data } = await client.patch<JobStatusResponse>(
    `/jobs/${jobId}/thresholds`,
    request,
  )
  return data
}
