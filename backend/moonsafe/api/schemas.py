"""Request/response schemas and illustrative threshold configuration helpers."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal, Mapping

from pydantic import BaseModel, Field

from .errors import InvalidThresholdConfigError

# Unvalidated hackathon screening defaults; always explicitly labeled illustrative_default=True.
ILLUSTRATIVE_THRESHOLD_PROFILES: dict[str, dict[str, Any]] = {
    "lander": {
        "threshold_profile": "lander",
        "cell_size_m": 10.0,
        "cell_size_units": "m",
        "caution_boulder_size_m": 0.5,
        "unsafe_boulder_size_m": 1.0,
        "caution_boulder_count": 1,
        "unsafe_boulder_count": 3,
        "min_valid_coverage": 0.8,
        "validated": False,
        "illustrative_default": True,
        "notes": "Illustrative unvalidated lander screening defaults only; not flight-certified.",
    },
    "rover": {
        "threshold_profile": "rover",
        "cell_size_m": 5.0,
        "cell_size_units": "m",
        "caution_boulder_size_m": 0.3,
        "unsafe_boulder_size_m": 0.6,
        "caution_boulder_count": 2,
        "unsafe_boulder_count": 5,
        "min_valid_coverage": 0.8,
        "validated": False,
        "illustrative_default": True,
        "notes": "Illustrative unvalidated rover screening defaults only; not flight-certified.",
    },
}


class ThresholdOverrides(BaseModel):
    """Configurable boulder-risk screening thresholds (all physical sizes in metres)."""

    cell_size_m: float | None = Field(default=None, gt=0)
    caution_boulder_size_m: float | None = Field(default=None, gt=0)
    unsafe_boulder_size_m: float | None = Field(default=None, gt=0)
    caution_boulder_count: int | None = Field(default=None, ge=0)
    unsafe_boulder_count: int | None = Field(default=None, ge=0)
    min_valid_coverage: float | None = Field(default=None, ge=0.0, le=1.0)


class CreateJobRequest(BaseModel):
    """Payload for starting a background detection/geospatial/risk-grid job."""

    image_id: str = Field(min_length=1)
    threshold_profile: Literal["lander", "rover", "custom"] = "lander"
    thresholds: ThresholdOverrides | None = None
    size_method: Literal[
        "max_bbox_extent",
        "mean_bbox_extent",
        "geometric_mean_bbox_extent",
        "bbox_diagonal",
    ] = "max_bbox_extent"
    model_localization_error_px: float | tuple[float, float] | None = None
    require_georeferencing: bool = False
    detection_options: dict[str, Any] = Field(default_factory=dict)


class ThresholdUpdateRequest(BaseModel):
    """Payload for recalculating RiskGrid without rerunning detection."""

    threshold_profile: Literal["lander", "rover", "custom"] = "custom"
    thresholds: ThresholdOverrides | None = None


def resolve_threshold_config(
    profile: str,
    overrides: ThresholdOverrides | Mapping[str, Any] | None = None,
    *,
    base_config: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a complete, explicitly labeled threshold configuration."""
    if profile in ILLUSTRATIVE_THRESHOLD_PROFILES:
        config = deepcopy(ILLUSTRATIVE_THRESHOLD_PROFILES[profile])
        is_illustrative_default = True
    elif profile == "custom":
        seed = base_config if base_config is not None else ILLUSTRATIVE_THRESHOLD_PROFILES["lander"]
        config = deepcopy(dict(seed))
        config["threshold_profile"] = "custom"
        is_illustrative_default = False
    else:
        raise InvalidThresholdConfigError(
            f"Unsupported threshold_profile {profile!r}; expected lander, rover, or custom"
        )

    override_dict = (
        overrides.model_dump(exclude_none=True)
        if isinstance(overrides, BaseModel)
        else {k: v for k, v in (overrides or {}).items() if v is not None}
    )

    if override_dict:
        config.update(override_dict)
        if profile in ILLUSTRATIVE_THRESHOLD_PROFILES:
            config["threshold_profile"] = "custom"
        is_illustrative_default = False

    if config["caution_boulder_size_m"] > config["unsafe_boulder_size_m"]:
        raise InvalidThresholdConfigError(
            "caution_boulder_size_m cannot exceed unsafe_boulder_size_m"
        )
    if config["caution_boulder_count"] > config["unsafe_boulder_count"]:
        raise InvalidThresholdConfigError(
            "caution_boulder_count cannot exceed unsafe_boulder_count"
        )

    config["cell_size_units"] = "m"
    config["validated"] = False
    config["illustrative_default"] = is_illustrative_default
    config["notes"] = (
        "Illustrative unvalidated screening defaults only; not flight-certified."
        if is_illustrative_default
        else "User-configured unvalidated screening thresholds; screening only."
    )
    return config


def build_units_summary(coordinate_frame: str) -> dict[str, str]:
    """Return explicit unit labels matching the active coordinate frame."""
    return {
        "dimensions": "px",
        "gsd": "m/px",
        "boulder_size": "m",
        "position": "m" if coordinate_frame == "lunar_local_m" else "px",
        "cell_size": "m",
    }


def format_image_response(image_metadata: Mapping[str, Any], *, created_at: str | None = None) -> dict[str, Any]:
    """Attach explicit units, preview link, and georef status to ImageMetadata."""
    coord_frame = image_metadata.get("coordinate_frame", "image_px")
    has_georef = coord_frame == "lunar_local_m" and image_metadata.get("image_to_lunar") is not None
    payload = dict(image_metadata)
    payload.update(
        {
            "dimensions_units": "px",
            "gsd_units": "m/px",
            "georeferencing_available": has_georef,
            "preview_url": f"/api/images/{image_metadata['image_id']}/preview",
        }
    )
    if created_at is not None:
        payload["created_at"] = created_at
    return payload
