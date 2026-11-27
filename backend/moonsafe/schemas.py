"""Shared Pydantic models matching the project's canonical data shapes.

ImageMetadata, Detection, RiskGrid and their sub-types are defined here and
used by both the API layer and the detection/risk engines.  Values that cannot
be reliably computed are always represented as None; illustrative / unvalidated
estimates are labelled explicitly in the screening_only flag.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class CoverageStatus(str, Enum):
    valid = "valid"
    partial = "partial"
    missing = "missing"


class CoordinateFrame(str, Enum):
    image_px = "image_px"
    lunar_local_m = "lunar_local_m"


class ThresholdProfile(str, Enum):
    lander = "lander"
    rover = "rover"
    custom = "custom"


class RiskClass(str, Enum):
    safe = "safe"
    caution = "caution"
    unsafe = "unsafe"
    uncertain = "uncertain"


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


# ---------------------------------------------------------------------------
# ImageMetadata
# ---------------------------------------------------------------------------

class ImageMetadata(BaseModel):
    image_id: str
    source_image_id: str
    width_px: int
    height_px: int
    gsd_x_m_per_px: Optional[float] = None
    gsd_y_m_per_px: Optional[float] = None
    coverage: CoverageStatus = CoverageStatus.missing
    coordinate_frame: CoordinateFrame = CoordinateFrame.image_px
    image_to_lunar: Optional[Any] = None


# ---------------------------------------------------------------------------
# Detection position
# ---------------------------------------------------------------------------

class DetectionPosition(BaseModel):
    x: float
    y: float
    frame: CoordinateFrame = CoordinateFrame.image_px
    uncertainty_m: Optional[float] = None


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

class Detection(BaseModel):
    detection_id: str
    image_id: str
    bbox_px: List[float] = Field(..., min_length=4, max_length=4)
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    estimated_size_m: Optional[float] = None
    size_uncertainty_m: Optional[float] = None
    position: DetectionPosition


# ---------------------------------------------------------------------------
# RiskGrid cell
# ---------------------------------------------------------------------------

class RiskCell(BaseModel):
    cell_id: str
    x: float
    y: float
    risk_class: RiskClass = Field(..., alias="class")
    boulder_count: int = 0
    max_size_m: Optional[float] = None
    coverage: float = Field(0.0, ge=0.0, le=1.0)
    reason_codes: List[str] = []

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# RiskGrid
# ---------------------------------------------------------------------------

class RiskGrid(BaseModel):
    image_id: str
    cell_size_m: float
    coordinate_frame: CoordinateFrame = CoordinateFrame.image_px
    threshold_profile: ThresholdProfile = ThresholdProfile.lander
    cells: List[RiskCell] = []
    screening_only: bool = True


# ---------------------------------------------------------------------------
# API request / response shapes
# ---------------------------------------------------------------------------

class ImageUploadResponse(BaseModel):
    image_id: str
    metadata: ImageMetadata


class ImageListItem(BaseModel):
    image_id: str
    filename: str
    width_px: int
    height_px: int
    gsd_x_m_per_px: Optional[float] = None
    gsd_y_m_per_px: Optional[float] = None
    coverage: CoverageStatus = CoverageStatus.missing


class JobCreateRequest(BaseModel):
    image_id: str
    threshold_profile: ThresholdProfile = ThresholdProfile.lander
    confidence_threshold: float = Field(0.5, ge=0.0, le=1.0)
    cell_size_px: int = Field(64, ge=8)


class JobCreateResponse(BaseModel):
    job_id: str
    image_id: str
    status: JobStatus = JobStatus.queued


class JobStatusResponse(BaseModel):
    job_id: str
    image_id: str
    status: JobStatus
    error_message: Optional[str] = None
    progress_pct: Optional[float] = None


class JobResults(BaseModel):
    job_id: str
    image_id: str
    detections: List[Detection] = []
    risk_grid: Optional[RiskGrid] = None


class ThresholdPatchRequest(BaseModel):
    threshold_profile: Optional[ThresholdProfile] = None
    # Safe / caution / unsafe upper bounds for max boulder size in metres.
    # None means the threshold is not changed from its current value.
    safe_max_size_m: Optional[float] = Field(None, gt=0)
    caution_max_size_m: Optional[float] = Field(None, gt=0)
    min_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    cell_size_px: Optional[int] = Field(None, ge=8)
