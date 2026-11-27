/**
 * Canonical data shapes — mirrors the Python Pydantic models in
 * backend/moonsafe/schemas.py exactly.  Keep these in sync when the backend
 * contract changes.
 */

export type CoverageStatus = 'valid' | 'partial' | 'missing'
export type CoordinateFrame = 'image_px' | 'lunar_local_m'
export type ThresholdProfile = 'lander' | 'rover' | 'custom'
export type RiskClass = 'safe' | 'caution' | 'unsafe' | 'uncertain'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed'

// ── ImageMetadata ────────────────────────────────────────────────────────────

export interface ImageMetadata {
  image_id: string
  source_image_id: string
  width_px: number
  height_px: number
  gsd_x_m_per_px: number | null
  gsd_y_m_per_px: number | null
  coverage: CoverageStatus
  coordinate_frame: CoordinateFrame
  image_to_lunar: unknown | null
}

// ── Detection ────────────────────────────────────────────────────────────────

export interface DetectionPosition {
  x: number
  y: number
  frame: CoordinateFrame
  uncertainty_m: number | null
}

export interface Detection {
  detection_id: string
  image_id: string
  /** [x_min, y_min, x_max, y_max] in pixels */
  bbox_px: [number, number, number, number]
  confidence: number
  model_version: string
  estimated_size_m: number | null
  size_uncertainty_m: number | null
  position: DetectionPosition
}

// ── RiskGrid ─────────────────────────────────────────────────────────────────

export interface RiskCell {
  cell_id: string
  x: number
  y: number
  /** JSON key is "class" (Python alias) */
  class: RiskClass
  boulder_count: number
  max_size_m: number | null
  coverage: number
  reason_codes: string[]
}

export interface RiskGrid {
  image_id: string
  cell_size_m: number
  coordinate_frame: CoordinateFrame
  threshold_profile: ThresholdProfile
  cells: RiskCell[]
  screening_only: boolean
}

// ── API request / response ───────────────────────────────────────────────────

export interface ImageUploadResponse {
  image_id: string
  metadata: ImageMetadata
}

export interface ImageListItem {
  image_id: string
  filename: string
  width_px: number
  height_px: number
  gsd_x_m_per_px: number | null
  gsd_y_m_per_px: number | null
  coverage: CoverageStatus
}

export interface JobCreateRequest {
  image_id: string
  threshold_profile: ThresholdProfile
  confidence_threshold: number
  cell_size_px: number
}

export interface JobCreateResponse {
  job_id: string
  image_id: string
  status: JobStatus
}

export interface JobStatusResponse {
  job_id: string
  image_id: string
  status: JobStatus
  error_message: string | null
  progress_pct: number | null
}

export interface JobResults {
  job_id: string
  image_id: string
  detections: Detection[]
  risk_grid: RiskGrid | null
}

export interface ThresholdPatchRequest {
  threshold_profile?: ThresholdProfile
  safe_max_size_m?: number
  caution_max_size_m?: number
  min_confidence?: number
  cell_size_px?: number
}

export interface HealthResponse {
  status: string
  model_available: boolean
  stub_mode: boolean
  note: string
}
