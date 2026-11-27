"""Shared MoonSafe Pydantic schemas matching the cross-team JSON contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


CoverageState = Literal["valid", "partial", "missing"]
CoordinateFrame = Literal["image_px", "lunar_local_m"]
ThresholdProfile = Literal["lander", "rover", "custom"]
RiskClass = Literal["safe", "caution", "unsafe", "uncertain"]
JobStatus = Literal["queued", "running", "completed", "failed"]


class ImageMetadata(BaseModel):
    """Shared ImageMetadata contract."""

    image_id: str = Field(..., min_length=1)
    source_image_id: str = Field(..., min_length=1)
    width_px: int = Field(..., gt=0)
    height_px: int = Field(..., gt=0)
    gsd_x_m_per_px: float | None = Field(default=None, gt=0)
    gsd_y_m_per_px: float | None = Field(default=None, gt=0)
    coverage: CoverageState = "missing"
    coordinate_frame: CoordinateFrame = "image_px"
    image_to_lunar: dict[str, Any] | None = None


class DetectionPosition(BaseModel):
    """Detection centroid position in image pixels or lunar local meters."""

    x: float
    y: float
    frame: CoordinateFrame
    uncertainty_m: float | None = Field(default=None, ge=0)


class Detection(BaseModel):
    """Shared Detection contract."""

    detection_id: str = Field(..., min_length=1)
    image_id: str = Field(..., min_length=1)
    bbox_px: list[float] = Field(..., min_length=4, max_length=4)
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str = Field(..., min_length=1)
    estimated_size_m: float | None = Field(default=None, ge=0)
    size_uncertainty_m: float | None = Field(default=None, ge=0)
    position: DetectionPosition

    @field_validator("bbox_px")
    @classmethod
    def _validate_bbox(cls, value: list[float]) -> list[float]:
        x_min, y_min, x_max, y_max = value
        if x_max < x_min or y_max < y_min:
            raise ValueError("bbox_px must satisfy x_max >= x_min and y_max >= y_min")
        return [float(v) for v in value]


class RiskCell(BaseModel):
    """Single cell inside RiskGrid."""

    model_config = ConfigDict(populate_by_name=True)

    cell_id: str = Field(..., min_length=1)
    x: float
    y: float
    risk_class: RiskClass = Field(..., alias="class")
    boulder_count: int = Field(..., ge=0)
    max_size_m: float | None = Field(default=None, ge=0)
    coverage: float = Field(..., ge=0.0, le=1.0)
    reason_codes: list[str] = Field(default_factory=list)


class RiskGrid(BaseModel):
    """Shared RiskGrid contract."""

    model_config = ConfigDict(populate_by_name=True)

    image_id: str = Field(..., min_length=1)
    cell_size_m: float = Field(..., ge=0)
    coordinate_frame: CoordinateFrame
    threshold_profile: ThresholdProfile
    cells: list[RiskCell]
    screening_only: Literal[True] = True


class ThresholdConfig(BaseModel):
    """Configurable screening thresholds (illustrative unless formally validated)."""

    cell_size_m: float = Field(default=25.0, gt=0)
    caution_boulder_size_m: float = Field(default=0.5, gt=0)
    unsafe_boulder_size_m: float = Field(default=1.0, gt=0)
    caution_boulder_count: int = Field(default=3, ge=1)
    unsafe_boulder_count: int = Field(default=8, ge=1)
    min_confidence: float = Field(default=0.25, ge=0.0, le=1.0)
    min_cell_coverage: float = Field(default=0.8, ge=0.0, le=1.0)
    require_lunar_transform_for_safe: bool = False
    illustrative_only: bool = True
    note: str = (
        "Illustrative unvalidated thresholds for boulder-risk screening only; "
        "not a landing or traverse safety guarantee."
    )

    @model_validator(mode="after")
    def _validate_monotonic_thresholds(self) -> "ThresholdConfig":
        if self.unsafe_boulder_size_m < self.caution_boulder_size_m:
            raise ValueError("unsafe_boulder_size_m must be >= caution_boulder_size_m")
        if self.unsafe_boulder_count < self.caution_boulder_count:
            raise ValueError("unsafe_boulder_count must be >= caution_boulder_count")
        return self


class ImageUploadResponse(BaseModel):
    image_id: str
    metadata: ImageMetadata
    has_elevation_data: bool = False
    preview_url: str


class ImageListResponse(BaseModel):
    images: list[ImageMetadata]


class ImageDetailResponse(BaseModel):
    image_id: str
    metadata: ImageMetadata
    has_elevation_data: bool = False
    preview_url: str


class JobCreateRequest(BaseModel):
    image_id: str = Field(..., min_length=1)
    threshold_profile: ThresholdProfile = "lander"
    thresholds: ThresholdConfig | None = None
    confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    model_weights_path: str | None = None


class JobCreateResponse(BaseModel):
    job_id: str
    image_id: str
    status: JobStatus
    threshold_profile: ThresholdProfile


class JobStatusResponse(BaseModel):
    job_id: str
    image_id: str
    status: JobStatus
    threshold_profile: ThresholdProfile
    thresholds: ThresholdConfig
    model_status: str
    model_version: str
    status_message: str
    created_at: str
    updated_at: str
    error: str | None = None


class JobResultsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    job_id: str
    image_id: str
    status: Literal["completed"]
    model_status: str
    model_version: str
    status_message: str
    thresholds: ThresholdConfig
    screening_only: Literal[True] = True
    detections: list[Detection]
    risk_grid: RiskGrid


class ThresholdPatchRequest(BaseModel):
    threshold_profile: ThresholdProfile | None = None
    thresholds: ThresholdConfig | None = None


class ThresholdPatchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    job_id: str
    image_id: str
    threshold_profile: ThresholdProfile
    thresholds: ThresholdConfig
    rerun_detection: Literal[False] = False
    risk_grid: RiskGrid
