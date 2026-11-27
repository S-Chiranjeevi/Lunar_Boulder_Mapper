export type CoverageState = 'valid' | 'partial' | 'missing';
export type CoordinateFrame = 'image_px' | 'lunar_local_m';
export type ThresholdProfile = 'lander' | 'rover' | 'custom';
export type RiskClass = 'safe' | 'caution' | 'unsafe' | 'uncertain';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ImageMetadata {
  image_id: string;
  source_image_id: string;
  width_px: number;
  height_px: number;
  gsd_x_m_per_px: number | null;
  gsd_y_m_per_px: number | null;
  coverage: CoverageState;
  coordinate_frame: CoordinateFrame;
  image_to_lunar: Record<string, unknown> | null;
}

export interface DetectionPosition {
  x: number;
  y: number;
  frame: CoordinateFrame;
  uncertainty_m: number | null;
}

export interface Detection {
  detection_id: string;
  image_id: string;
  bbox_px: [number, number, number, number];
  confidence: number;
  model_version: string;
  estimated_size_m: number | null;
  size_uncertainty_m: number | null;
  position: DetectionPosition;
}

export interface RiskCell {
  cell_id: string;
  x: number;
  y: number;
  class: RiskClass;
  boulder_count: number;
  max_size_m: number | null;
  coverage: number;
  reason_codes: string[];
}

export interface RiskGrid {
  image_id: string;
  cell_size_m: number;
  coordinate_frame: CoordinateFrame;
  threshold_profile: ThresholdProfile;
  cells: RiskCell[];
  screening_only: true;
}

export interface ThresholdConfig {
  cell_size_m: number;
  caution_boulder_size_m: number;
  unsafe_boulder_size_m: number;
  caution_boulder_count: number;
  unsafe_boulder_count: number;
  min_confidence: number;
  min_cell_coverage: number;
  require_lunar_transform_for_safe: boolean;
  illustrative_only: boolean;
  note: string;
}

export interface ImageUploadResponse {
  image_id: string;
  metadata: ImageMetadata;
  has_elevation_data?: boolean;
  preview_url?: string;
}

export interface ImageListResponse {
  images: ImageMetadata[];
}

export interface JobCreateRequest {
  image_id: string;
  threshold_profile: ThresholdProfile;
  thresholds?: ThresholdConfig;
  confidence_threshold?: number;
}

export interface JobCreateResponse {
  job_id: string;
  image_id: string;
  status: JobStatus;
  threshold_profile?: ThresholdProfile;
}

export interface JobStatusResponse {
  job_id: string;
  image_id: string;
  status: JobStatus;
  threshold_profile?: ThresholdProfile;
  thresholds?: ThresholdConfig;
  model_status?: string;
  model_version?: string;
  status_message?: string;
  created_at?: string;
  updated_at?: string;
  error?: string | null;
}

export interface JobResultsResponse {
  job_id?: string;
  image_id?: string;
  status?: 'completed';
  model_status?: string;
  model_version?: string;
  status_message?: string;
  thresholds?: ThresholdConfig;
  screening_only?: true;
  detections: Detection[];
  risk_grid: RiskGrid;
}

export interface ThresholdProfileSummary {
  profile: ThresholdProfile;
  label: string;
  description: string;
  illustrativeNote: string;
  defaults: ThresholdConfig;
}

/**
 * Unvalidated, illustrative defaults shown during workspace setup.
 * Screening-only aid; never a landing or traverse safety guarantee.
 */
export const ILLUSTRATIVE_PROFILES: Record<ThresholdProfile, ThresholdProfileSummary> = {
  lander: {
    profile: 'lander',
    label: 'Lander (Illustrative)',
    description: 'Coarser 10 m screening cells with illustrative boulder-size caution/unsafe cutoffs.',
    illustrativeNote: 'Unvalidated illustrative defaults — not flight landing certification.',
    defaults: {
      cell_size_m: 10.0,
      caution_boulder_size_m: 0.5,
      unsafe_boulder_size_m: 1.0,
      caution_boulder_count: 3,
      unsafe_boulder_count: 8,
      min_confidence: 0.25,
      min_cell_coverage: 0.8,
      require_lunar_transform_for_safe: false,
      illustrative_only: true,
      note: 'Illustrative unvalidated Lander profile; screening aid only.',
    },
  },
  rover: {
    profile: 'rover',
    label: 'Rover (Illustrative)',
    description: 'Finer 5 m screening cells for illustrative surface-mobility hazard screening.',
    illustrativeNote: 'Unvalidated illustrative defaults — not traverse clearance certification.',
    defaults: {
      cell_size_m: 5.0,
      caution_boulder_size_m: 0.3,
      unsafe_boulder_size_m: 0.6,
      caution_boulder_count: 2,
      unsafe_boulder_count: 5,
      min_confidence: 0.25,
      min_cell_coverage: 0.8,
      require_lunar_transform_for_safe: false,
      illustrative_only: true,
      note: 'Illustrative unvalidated Rover profile; screening aid only.',
    },
  },
  custom: {
    profile: 'custom',
    label: 'Custom Profile',
    description: 'User-configured screening thresholds starting from illustrative baseline values.',
    illustrativeNote: 'Unvalidated unless calibrated against mission-specific NAC imagery.',
    defaults: {
      cell_size_m: 20.0,
      caution_boulder_size_m: 0.5,
      unsafe_boulder_size_m: 1.0,
      caution_boulder_count: 3,
      unsafe_boulder_count: 8,
      min_confidence: 0.25,
      min_cell_coverage: 0.8,
      require_lunar_transform_for_safe: false,
      illustrative_only: true,
      note: 'Custom unvalidated screening thresholds; screening aid only.',
    },
  },
};
