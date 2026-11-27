export type ImageMetadata = {
  image_id: string
  source_image_id: string
  width_px: number
  height_px: number
  gsd_x_m_per_px: number | null
  gsd_y_m_per_px: number | null
  coverage: 'valid' | 'partial' | 'missing'
  coordinate_frame: 'image_px' | 'lunar_local_m'
  image_to_lunar: Record<string, unknown> | null
}

export type Detection = {
  detection_id: string
  image_id: string
  bbox_px: [number, number, number, number]
  confidence: number
  model_version: string
  estimated_size_m: number | null
  size_uncertainty_m: number | null
  position: { x: number; y: number; frame: 'image_px' | 'lunar_local_m'; uncertainty_m: number | null }
}

export type RiskCell = {
  cell_id: string
  x: number
  y: number
  class: 'safe' | 'caution' | 'unsafe' | 'uncertain'
  boulder_count: number
  max_size_m: number | null
  coverage: number
  reason_codes: string[]
}

export type RiskGrid = {
  image_id: string
  cell_size_m: number
  coordinate_frame: 'image_px' | 'lunar_local_m'
  threshold_profile: 'lander' | 'rover' | 'custom'
  cells: RiskCell[]
  screening_only: true
}

export type ThresholdProfile = 'lander' | 'rover' | 'custom'
export type ThresholdConfig = {
  cell_size_m: number
  caution_boulder_size_m: number
  unsafe_boulder_size_m: number
  caution_boulder_count: number
  unsafe_boulder_count: number
  min_confidence: number
  min_cell_coverage: number
  require_lunar_transform_for_safe: boolean
  illustrative_only: boolean
  note: string
}
export type Job = {
  job_id: string
  image_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  threshold_profile: ThresholdProfile
  thresholds?: ThresholdConfig
  model_status?: string
  model_version?: string
  status_message?: string
  error?: string | null
}
export type ThresholdSettings = { profile: ThresholdProfile; thresholds: ThresholdConfig }

export const ILLUSTRATIVE_PROFILE_DEFAULTS: Record<ThresholdProfile, ThresholdConfig> = {
  lander: {
    cell_size_m: 25.0,
    caution_boulder_size_m: 0.5,
    unsafe_boulder_size_m: 1.0,
    caution_boulder_count: 3,
    unsafe_boulder_count: 8,
    min_confidence: 0.25,
    min_cell_coverage: 0.8,
    require_lunar_transform_for_safe: false,
    illustrative_only: true,
    note: 'Illustrative unvalidated Lander profile. Do not treat as a flight landing certification or hazard-avoidance guarantee.',
  },
  rover: {
    cell_size_m: 10.0,
    caution_boulder_size_m: 0.3,
    unsafe_boulder_size_m: 0.6,
    caution_boulder_count: 2,
    unsafe_boulder_count: 5,
    min_confidence: 0.25,
    min_cell_coverage: 0.8,
    require_lunar_transform_for_safe: false,
    illustrative_only: true,
    note: 'Illustrative unvalidated Rover profile. Do not treat as a traverse clearance or mobility guarantee.',
  },
  custom: {
    cell_size_m: 20.0,
    caution_boulder_size_m: 0.5,
    unsafe_boulder_size_m: 1.0,
    caution_boulder_count: 3,
    unsafe_boulder_count: 8,
    min_confidence: 0.25,
    min_cell_coverage: 0.8,
    require_lunar_transform_for_safe: false,
    illustrative_only: true,
    note: 'Custom screening thresholds (unvalidated unless calibrated against mission-specific NAC imagery and terrain requirements).',
  },
}

