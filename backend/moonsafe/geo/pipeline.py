"""End-to-end geospatial enrichment for raw boulder detections."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

from ._validation import (
    GeoTransformError,
    finite_float,
    non_negative_optional_number,
    parse_xy_error_px,
    validate_bbox_px,
    validate_image_metadata,
)
from .coordinates import transform_pixel_to_lunar, validate_lunar_transform
from .size import SUPPORTED_SIZE_METHODS, estimate_projected_size


@dataclass(frozen=True)
class GeoConfig:
    """Configuration for MoonSafe image-to-size and image-to-coordinate mapping.

    All error and threshold defaults are explicit; ``model_localization_error_px``
    defaults to ``None`` so a fixed 1-pixel model error is never assumed.
    """

    size_method: str = "max_bbox_extent"
    model_localization_error_px: float | tuple[float, float] | None = None
    georeferencing_uncertainty_m: float | None = None
    require_valid_coverage: bool = False
    require_known_georeferencing_uncertainty: bool = False
    max_georeferencing_uncertainty_m: float | None = None
    max_gsd_transform_mismatch_ratio: float = 0.25
    min_determinant: float = 1e-12
    allow_transform_derived_gsd: bool = True

    def __post_init__(self) -> None:
        if self.size_method not in SUPPORTED_SIZE_METHODS:
            raise GeoTransformError(
                f"Unsupported size_method {self.size_method!r}; expected one of {SUPPORTED_SIZE_METHODS}"
            )
        parse_xy_error_px(self.model_localization_error_px, "model_localization_error_px")
        non_negative_optional_number(self.georeferencing_uncertainty_m, "georeferencing_uncertainty_m")
        non_negative_optional_number(self.max_georeferencing_uncertainty_m, "max_georeferencing_uncertainty_m")


def _extract_raw_detection(raw_detection: Mapping[str, Any], expected_image_id: str, width_px: int, height_px: int) -> dict[str, Any]:
    if not isinstance(raw_detection, Mapping):
        raise GeoTransformError("raw_detection must be a mapping")

    detection_id = raw_detection.get("detection_id")
    if not isinstance(detection_id, str) or not detection_id.strip():
        raise GeoTransformError("raw_detection.detection_id must be a non-empty string")

    det_image_id = raw_detection.get("image_id")
    if det_image_id is not None:
        if not isinstance(det_image_id, str) or not det_image_id.strip():
            raise GeoTransformError("raw_detection.image_id must be a non-empty string when provided")
        if det_image_id != expected_image_id:
            raise GeoTransformError(
                f"raw_detection.image_id ({det_image_id!r}) does not match image_metadata.image_id ({expected_image_id!r})"
            )

    bbox = validate_bbox_px(raw_detection.get("bbox_px"), width_px=width_px, height_px=height_px)

    confidence = finite_float(raw_detection.get("confidence"), "confidence")
    if confidence < 0.0 or confidence > 1.0:
        raise GeoTransformError("raw_detection.confidence must be in [0.0, 1.0]")

    model_version = raw_detection.get("model_version")
    if not isinstance(model_version, str) or not model_version.strip():
        raise GeoTransformError("raw_detection.model_version must be a non-empty string")

    return {
        "detection_id": detection_id,
        "image_id": expected_image_id,
        "bbox_px": list(bbox),
        "confidence": confidence,
        "model_version": model_version,
        "localization_error_px": raw_detection.get("localization_error_px"),
        "bbox_size_error_px": raw_detection.get("bbox_size_error_px"),
    }


def _resolve_gsd(
    meta: Mapping[str, Any],
    image_metadata: Mapping[str, Any],
    transform: Mapping[str, Any] | None,
    cfg: GeoConfig,
) -> tuple[float | None, float | None, str]:
    gsd_x = meta["gsd_x_m_per_px"]
    gsd_y = meta["gsd_y_m_per_px"]
    if gsd_x is not None and gsd_y is not None:
        return (gsd_x, gsd_y, "image_metadata")

    if not cfg.allow_transform_derived_gsd:
        return (gsd_x, gsd_y, "image_metadata")

    candidate = transform if transform is not None else meta["image_to_lunar"]
    validated, _ = validate_lunar_transform(
        candidate,
        image_metadata,
        is_explicit_transform=transform is not None,
        explicit_georef_uncertainty_m=cfg.georeferencing_uncertainty_m,
        require_valid_coverage=cfg.require_valid_coverage,
        require_known_georeferencing_uncertainty=cfg.require_known_georeferencing_uncertainty,
        max_georeferencing_uncertainty_m=cfg.max_georeferencing_uncertainty_m,
        max_gsd_transform_mismatch_ratio=cfg.max_gsd_transform_mismatch_ratio,
        min_determinant=cfg.min_determinant,
    )
    if validated is None:
        return (gsd_x, gsd_y, "image_metadata")

    resolved_x = gsd_x if gsd_x is not None else validated.affine_gsd_x_m_per_px
    resolved_y = gsd_y if gsd_y is not None else validated.affine_gsd_y_m_per_px
    source = (
        "image_to_lunar_affine"
        if (gsd_x is None and gsd_y is None)
        else "image_metadata_and_affine"
    )
    return (resolved_x, resolved_y, source)


def process_detection(
    image_metadata: Mapping[str, Any],
    raw_detection: Mapping[str, Any],
    *,
    transform: Mapping[str, Any] | None = None,
    config: GeoConfig | None = None,
) -> dict[str, Any]:
    """Convert one raw pixel detection and ImageMetadata into the shared Detection shape."""
    cfg = config or GeoConfig()
    meta = validate_image_metadata(image_metadata)
    det = _extract_raw_detection(raw_detection, meta["image_id"], meta["width_px"], meta["height_px"])

    loc_err_px = (
        det["localization_error_px"]
        if det["localization_error_px"] is not None
        else cfg.model_localization_error_px
    )

    gsd_x, gsd_y, gsd_source = _resolve_gsd(meta, image_metadata, transform, cfg)

    size_info = estimate_projected_size(
        det["bbox_px"],
        gsd_x,
        gsd_y,
        method=cfg.size_method,
        localization_error_px=loc_err_px,
        bbox_size_error_px=det["bbox_size_error_px"],
        gsd_x_uncertainty_m_per_px=meta["gsd_x_uncertainty_m_per_px"],
        gsd_y_uncertainty_m_per_px=meta["gsd_y_uncertainty_m_per_px"],
        gsd_source=gsd_source,
    )

    x_min, y_min, x_max, y_max = det["bbox_px"]
    center_px = (0.5 * (x_min + x_max), 0.5 * (y_min + y_max))

    position = transform_pixel_to_lunar(
        center_px,
        image_metadata,
        explicit_transform=transform,
        localization_error_px=loc_err_px,
        georeferencing_uncertainty_m=cfg.georeferencing_uncertainty_m,
        require_valid_coverage=cfg.require_valid_coverage,
        require_known_georeferencing_uncertainty=cfg.require_known_georeferencing_uncertainty,
        max_georeferencing_uncertainty_m=cfg.max_georeferencing_uncertainty_m,
        max_gsd_transform_mismatch_ratio=cfg.max_gsd_transform_mismatch_ratio,
        min_determinant=cfg.min_determinant,
    )

    return {
        "detection_id": det["detection_id"],
        "image_id": det["image_id"],
        "bbox_px": det["bbox_px"],
        "confidence": det["confidence"],
        "model_version": det["model_version"],
        "estimated_size_m": size_info["estimated_size_m"],
        "size_uncertainty_m": size_info["size_uncertainty_m"],
        "size_estimation": size_info["size_estimation"],
        "position": position,
    }


def process_detections(
    image_metadata: Mapping[str, Any],
    raw_detections: Iterable[Mapping[str, Any]],
    *,
    transform: Mapping[str, Any] | None = None,
    config: GeoConfig | None = None,
) -> list[dict[str, Any]]:
    """Batch-convert raw detections for an image into the shared Detection shape."""
    return [
        process_detection(image_metadata, detection, transform=transform, config=config)
        for detection in raw_detections
    ]
