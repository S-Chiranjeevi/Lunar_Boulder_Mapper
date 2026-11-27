"""Shared validation helpers for MoonSafe geospatial conversions."""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence


class GeoTransformError(ValueError):
    """Raised when detection, metadata, or transform inputs are malformed."""


def is_finite_number(value: Any) -> bool:
    """Return True for finite int/float values (excluding bool)."""
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(float(value))


def finite_float(value: Any, name: str) -> float:
    """Validate and convert a finite numeric value to float."""
    if not is_finite_number(value):
        raise GeoTransformError(f"{name} must be a finite number")
    return float(value)


def positive_optional_number(value: Any, name: str) -> float | None:
    """Validate an optional strictly positive finite float."""
    if value is None:
        return None
    result = finite_float(value, name)
    if result <= 0:
        raise GeoTransformError(f"{name} must be a positive finite number or null")
    return result


def non_negative_optional_number(value: Any, name: str) -> float | None:
    """Validate an optional non-negative finite float."""
    if value is None:
        return None
    result = finite_float(value, name)
    if result < 0:
        raise GeoTransformError(f"{name} must be a non-negative finite number or null")
    return result


def parse_xy_error_px(value: Any, name: str) -> tuple[float, float] | None:
    """Parse an optional pixel error as (err_x_px, err_y_px), or None when absent.

    Accepts None, a non-negative scalar, a 2-element sequence [ex, ey],
    or a mapping with x/y (or x_px/y_px) keys. Never invents a default error.
    """
    if value is None:
        return None
    if is_finite_number(value):
        scalar = float(value)
        if scalar < 0:
            raise GeoTransformError(f"{name} must be non-negative")
        return (scalar, scalar)
    if isinstance(value, (list, tuple)) and len(value) == 2:
        ex = finite_float(value[0], f"{name}[0]")
        ey = finite_float(value[1], f"{name}[1]")
        if ex < 0 or ey < 0:
            raise GeoTransformError(f"{name} components must be non-negative")
        return (ex, ey)
    if isinstance(value, Mapping):
        raw_x = value.get("x_px", value.get("x"))
        raw_y = value.get("y_px", value.get("y"))
        if raw_x is None or raw_y is None:
            raise GeoTransformError(f"{name} mapping must contain x_px/y_px or x/y")
        ex = finite_float(raw_x, f"{name}.x")
        ey = finite_float(raw_y, f"{name}.y")
        if ex < 0 or ey < 0:
            raise GeoTransformError(f"{name} components must be non-negative")
        return (ex, ey)
    raise GeoTransformError(f"{name} must be null, a number, a 2-element sequence, or an x/y mapping")


def validate_bbox_px(
    bbox_px: Sequence[Any],
    *,
    width_px: int | None = None,
    height_px: int | None = None,
) -> tuple[float, float, float, float]:
    """Validate an axis-aligned [x_min, y_min, x_max, y_max] pixel bounding box."""
    if not isinstance(bbox_px, (list, tuple)) or len(bbox_px) != 4:
        raise GeoTransformError("bbox_px must be a 4-element [x_min, y_min, x_max, y_max] sequence")
    x_min = finite_float(bbox_px[0], "bbox_px[0]")
    y_min = finite_float(bbox_px[1], "bbox_px[1]")
    x_max = finite_float(bbox_px[2], "bbox_px[2]")
    y_max = finite_float(bbox_px[3], "bbox_px[3]")
    if x_max <= x_min or y_max <= y_min:
        raise GeoTransformError("bbox_px must satisfy x_max > x_min and y_max > y_min")
    if width_px is not None and (x_min < 0 or x_max > width_px):
        raise GeoTransformError(f"bbox_px x coordinates [{x_min}, {x_max}] exceed image width [0, {width_px}]")
    if height_px is not None and (y_min < 0 or y_max > height_px):
        raise GeoTransformError(f"bbox_px y coordinates [{y_min}, {y_max}] exceed image height [0, {height_px}]")
    return (x_min, y_min, x_max, y_max)


def validate_image_metadata(image_metadata: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the shared ImageMetadata shape and return normalized fields."""
    if not isinstance(image_metadata, Mapping):
        raise GeoTransformError("image_metadata must be a mapping")

    image_id = image_metadata.get("image_id")
    if not isinstance(image_id, str) or not image_id.strip():
        raise GeoTransformError("image_metadata.image_id must be a non-empty string")

    width_px = image_metadata.get("width_px")
    height_px = image_metadata.get("height_px")
    if isinstance(width_px, bool) or not isinstance(width_px, int) or width_px <= 0:
        raise GeoTransformError("image_metadata.width_px must be a positive integer")
    if isinstance(height_px, bool) or not isinstance(height_px, int) or height_px <= 0:
        raise GeoTransformError("image_metadata.height_px must be a positive integer")

    coverage = image_metadata.get("coverage", "missing")
    if coverage not in {"valid", "partial", "missing"}:
        raise GeoTransformError("image_metadata.coverage must be valid, partial, or missing")

    coordinate_frame = image_metadata.get("coordinate_frame", "image_px")
    if coordinate_frame not in {"image_px", "lunar_local_m"}:
        raise GeoTransformError("image_metadata.coordinate_frame must be image_px or lunar_local_m")

    gsd_x = positive_optional_number(image_metadata.get("gsd_x_m_per_px"), "gsd_x_m_per_px")
    gsd_y = positive_optional_number(image_metadata.get("gsd_y_m_per_px"), "gsd_y_m_per_px")
    gsd_x_unc = non_negative_optional_number(
        image_metadata.get("gsd_x_uncertainty_m_per_px"), "gsd_x_uncertainty_m_per_px"
    )
    gsd_y_unc = non_negative_optional_number(
        image_metadata.get("gsd_y_uncertainty_m_per_px"), "gsd_y_uncertainty_m_per_px"
    )

    return {
        "image_id": image_id,
        "width_px": width_px,
        "height_px": height_px,
        "gsd_x_m_per_px": gsd_x,
        "gsd_y_m_per_px": gsd_y,
        "gsd_x_uncertainty_m_per_px": gsd_x_unc,
        "gsd_y_uncertainty_m_per_px": gsd_y_unc,
        "coverage": coverage,
        "coordinate_frame": coordinate_frame,
        "image_to_lunar": image_metadata.get("image_to_lunar"),
    }
