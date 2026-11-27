import type {
  CoordinateFrame,
  Detection,
  RiskCell,
  RiskClass,
  RiskGrid,
  ThresholdProfile,
} from '../../app/types/contracts';

export interface DetectionWithGeo extends Detection {
  size_estimation?: {
    method?: string;
    projected_2d_only?: boolean;
    height_3d_inferred?: boolean;
    uncertainty_method?: string;
  };
  position: Detection['position'] & {
    uncertain?: boolean;
    reason_codes?: string[];
    uncertainty_breakdown?: {
      model_localization_px?: { x: number; y: number; radial: number } | null;
      model_localization_m?: number | null;
      georeferencing_m?: number | null;
      combined_m?: number | null;
      combination_rule?: string;
    };
  };
}

export interface RiskCellWithBounds extends RiskCell {
  bounds?: [number, number, number, number];
  size_risk?: RiskClass;
  density_risk?: RiskClass;
  density_per_100m2?: number | null;
}

export interface ElevationGridData {
  width: number;
  height: number;
  heights_m: number[];
  source: string;
  units: 'm';
  vertical_datum?: string;
}

export interface MapLayerState {
  showImage: boolean;
  imageOpacity: number;
  showDetections: boolean;
  minDetectionConfidence: number;
  showRiskGrid: boolean;
  riskOpacity: number;
  visibleRiskClasses: Record<RiskClass, boolean>;
}

export interface ThresholdRecalcPayload {
  threshold_profile: ThresholdProfile;
  thresholds: {
    cell_size_m: number;
    caution_boulder_size_m: number;
    unsafe_boulder_size_m: number;
    caution_boulder_count: number;
    unsafe_boulder_count: number;
    min_valid_coverage: number;
  };
}

export interface ThresholdRecalcResponse {
  job_id: string;
  image_id: string;
  coordinate_frame: CoordinateFrame;
  risk_grid: RiskGrid;
  recalculated_without_detection?: boolean;
}

export type SelectedMapFeature =
  | { kind: 'detection'; detection: DetectionWithGeo }
  | { kind: 'risk_cell'; cell: RiskCellWithBounds }
  | null;
