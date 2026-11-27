"""Pixel-to-lunar-local coordinate transformation and uncertainty separation.

Transforms pixel centers to ``lunar_local_m`` only when supported by real,
consistent, and reliable image metadata or an explicit 2D affine transform in
metres. Earth geographic/lat-long frames are explicitly rejected. When the
transform is missing or unreliable, ``image_px`` coordinates are preserved and
marked uncertain. Model localization error is always tracked separately from
georeferencing uncertainty.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from ._validation import (
    GeoTransformError,
    is_finite_number,
    parse_xy_error_px,
    validate_image_metadata,
)

_EARTH_CRS_TOKENS = frozenset(
    {
        "epsg:4326",
        "wgs84",
        "wgs_84",
        "latlon",
        "lonlat",
        "latlong",
        "lon_lat",
        "lat_lon",
        "geographic",
        "earth",
    }
)

_UNRELIABLE_STATUS_TOKENS = frozenset({"unreliable", "invalid", "unverified", "failed", "missing", "poor"})


@dataclass(frozen=True)
class ValidatedLunarAffine:
    """Validated 2D pixel-to-lunar-local-metre affine transform."""

    a: float
    b: float
    tx: float
    c: float
    d: float
    ty: float
    affine_gsd_x_m_per_px: float
    affine_gsd_y_m_per_px: float
    georeferencing_uncertainty_m: float | None
    warnings: tuple[str, ...] = ()

    def apply(self, x_px: float, y_px: float) -> tuple[float, float]:
        """Transform a pixel coordinate into lunar_local_m."""
        return (
            self.a * x_px + self.b * y_px + self.tx,
            self.c * x_px + self.d * y_px + self.ty,
        )

    def propagate_pixel_error_m(self, err_x_px: float, err_y_px: float) -> float:
        """Propagate independent pixel center localization errors to radial metres."""
        var_x = (self.a * err_x_px) ** 2 + (self.b * err_y_px) ** 2
        var_y = (self.c * err_x_px) ** 2 + (self.d * err_y_px) ** 2
        return math.sqrt(var_x + var_y)


def _extract_georef_uncertainty(
    transform: Mapping[str, Any],
    image_metadata: Mapping[str, Any],
    explicit_georef_uncertainty_m: float | None,
) -> tuple[float | None, bool]:
    """Extract optional georeferencing uncertainty in metres; return (value, is_valid)."""
    if explicit_georef_uncertainty_m is not None:
        if not is_finite_number(explicit_georef_uncertainty_m) or float(explicit_georef_uncertainty_m) < 0:
            return (None, False)
        return (float(explicit_georef_uncertainty_m), True)

    for candidate in (
        transform.get("uncertainty_m"),
        transform.get("georeferencing_uncertainty_m"),
        transform.get("rmse_m"),
        image_metadata.get("georeferencing_uncertainty_m"),
    ):
        if candidate is not None:
            if not is_finite_number(candidate) or float(candidate) < 0:
                return (None, False)
            return (float(candidate), True)

    return (None, True)


def _has_earth_crs(transform: Mapping[str, Any]) -> bool:
    for key in ("crs", "srs", "target_frame", "coordinate_frame"):
        val = transform.get(key)
        if isinstance(val, str):
            normalized = val.strip().lower().replace("-", "_")
            if normalized in _EARTH_CRS_TOKENS or "4326" in normalized or "wgs" in normalized:
                return True
    return False


def validate_lunar_transform(
    transform: Any,
    image_metadata: Mapping[str, Any],
    *,
    is_explicit_transform: bool = False,
    explicit_georef_uncertainty_m: float | None = None,
    require_valid_coverage: bool = False,
    require_known_georeferencing_uncertainty: bool = False,
    max_georeferencing_uncertainty_m: float | None = None,
    max_gsd_transform_mismatch_ratio: float = 0.25,
    min_determinant: float = 1e-12,
) -> tuple[ValidatedLunarAffine | None, list[str]]:
    """Inspect a candidate transform and metadata for lunar-local reliability.

    Returns ``(ValidatedLunarAffine, warnings)`` if reliable, or
    ``(None, failure_reason_codes)`` if missing or unreliable.
    """
    meta = validate_image_metadata(image_metadata)
    reasons: list[str] = []
    warnings: list[str] = []

    if transform is None:
        reasons.append("missing_image_to_lunar_transform")
        return (None, reasons)

    if not is_explicit_transform and meta["coordinate_frame"] != "lunar_local_m":
        reasons.append("coordinate_frame_not_lunar_local_m")
        return (None, reasons)

    if not isinstance(transform, Mapping):
        reasons.append("invalid_transform_structure")
        return (None, reasons)

    if _has_earth_crs(transform):
        reasons.append("rejected_earth_crs")

    units = transform.get("units")
    if units != "m":
        reasons.append("unsupported_transform_units_must_be_meters")

    if transform.get("type") != "affine_2d":
        reasons.append("unsupported_transform_type")

    if transform.get("reliable") is False or transform.get("is_reliable") is False:
        reasons.append("transform_marked_unreliable")
    if image_metadata.get("georeferencing_reliable") is False:
        reasons.append("metadata_georeferencing_marked_unreliable")

    for status_key in ("status", "quality"):
        status_val = transform.get(status_key)
        if isinstance(status_val, str) and status_val.strip().lower() in _UNRELIABLE_STATUS_TOKENS:
            reasons.append("transform_status_unreliable")
            break

    coverage = meta["coverage"]
    if coverage == "missing":
        if not is_explicit_transform or require_valid_coverage:
            reasons.append("missing_image_coverage")
        else:
            warnings.append("missing_image_coverage")
    elif coverage == "partial":
        if require_valid_coverage:
            reasons.append("partial_image_coverage")
        else:
            warnings.append("partial_image_coverage")

    geo_unc, geo_unc_valid = _extract_georef_uncertainty(transform, image_metadata, explicit_georef_uncertainty_m)
    if not geo_unc_valid:
        reasons.append("invalid_georeferencing_uncertainty")
    elif geo_unc is None:
        if require_known_georeferencing_uncertainty:
            reasons.append("missing_georeferencing_uncertainty")
        else:
            warnings.append("georeferencing_uncertainty_unknown")
    elif max_georeferencing_uncertainty_m is not None and geo_unc > max_georeferencing_uncertainty_m:
        reasons.append("georeferencing_uncertainty_exceeds_threshold")

    matrix = transform.get("matrix")
    if (
        not isinstance(matrix, (list, tuple))
        or len(matrix) != 3
        or any(not isinstance(row, (list, tuple)) or len(row) != 3 for row in matrix)
    ):
        reasons.append("invalid_affine_matrix_shape")
        return (None, list(dict.fromkeys(reasons)))

    flat = [row[col] for row in matrix for col in range(3)]
    if not all(is_finite_number(item) for item in flat):
        reasons.append("non_finite_affine_matrix")
        return (None, list(dict.fromkeys(reasons)))

    a, b, tx, c, d, ty, r20, r21, r22 = (float(item) for item in flat)
    if [r20, r21, r22] != [0.0, 0.0, 1.0]:
        reasons.append("invalid_affine_bottom_row")

    det = a * d - b * c
    if abs(det) <= min_determinant:
        reasons.append("singular_or_collapsed_affine_matrix")

    aff_gsd_x = math.hypot(a, c)
    aff_gsd_y = math.hypot(b, d)
    if aff_gsd_x <= 0 or aff_gsd_y <= 0:
        reasons.append("zero_scale_affine_matrix")

    if meta["gsd_x_m_per_px"] is not None and aff_gsd_x > 0:
        mismatch_x = abs(aff_gsd_x - meta["gsd_x_m_per_px"]) / max(aff_gsd_x, meta["gsd_x_m_per_px"])
        if mismatch_x > max_gsd_transform_mismatch_ratio:
            reasons.append("gsd_x_transform_scale_mismatch")
    if meta["gsd_y_m_per_px"] is not None and aff_gsd_y > 0:
        mismatch_y = abs(aff_gsd_y - meta["gsd_y_m_per_px"]) / max(aff_gsd_y, meta["gsd_y_m_per_px"])
        if mismatch_y > max_gsd_transform_mismatch_ratio:
            reasons.append("gsd_y_transform_scale_mismatch")

    if reasons:
        return (None, list(dict.fromkeys(reasons)))

    return (
        ValidatedLunarAffine(
            a=a,
            b=b,
            tx=tx,
            c=c,
            d=d,
            ty=ty,
            affine_gsd_x_m_per_px=aff_gsd_x,
            affine_gsd_y_m_per_px=aff_gsd_y,
            georeferencing_uncertainty_m=geo_unc,
            warnings=tuple(dict.fromkeys(warnings)),
        ),
        [],
    )


def _model_localization_breakdown(
    loc_err_px: tuple[float, float] | None,
    gsd_x: float | None,
    gsd_y: float | None,
    validated_affine: ValidatedLunarAffine | None,
) -> tuple[dict[str, float] | None, float | None]:
    if loc_err_px is None:
        return (None, None)

    ex_px, ey_px = loc_err_px
    px_breakdown = {
        "x": ex_px,
        "y": ey_px,
        "radial": math.hypot(ex_px, ey_px),
    }

    if validated_affine is not None:
        return (px_breakdown, validated_affine.propagate_pixel_error_m(ex_px, ey_px))
    if gsd_x is not None and gsd_y is not None:
        return (px_breakdown, math.hypot(ex_px * gsd_x, ey_px * gsd_y))
    return (px_breakdown, None)


def transform_pixel_to_lunar(
    center_px: Sequence[Any],
    image_metadata: Mapping[str, Any],
    *,
    explicit_transform: Mapping[str, Any] | None = None,
    localization_error_px: float | Sequence[float] | Mapping[str, Any] | None = None,
    georeferencing_uncertainty_m: float | None = None,
    require_valid_coverage: bool = False,
    require_known_georeferencing_uncertainty: bool = False,
    max_georeferencing_uncertainty_m: float | None = None,
    max_gsd_transform_mismatch_ratio: float = 0.25,
    min_determinant: float = 1e-12,
) -> dict[str, Any]:
    """Transform a pixel center to lunar_local_m if supported and reliable.

    When no valid/reliable lunar transform is available, preserves ``image_px``
    coordinates, marks ``uncertain=True``, and keeps model localization error
    separate from georeferencing uncertainty.
    """
    if not isinstance(center_px, (list, tuple)) or len(center_px) != 2:
        raise GeoTransformError("center_px must be a 2-element (x_px, y_px) sequence")
    if not is_finite_number(center_px[0]) or not is_finite_number(center_px[1]):
        raise GeoTransformError("center_px coordinates must be finite numbers")

    cx_px = float(center_px[0])
    cy_px = float(center_px[1])
    meta = validate_image_metadata(image_metadata)
    loc_err_px = parse_xy_error_px(localization_error_px, "localization_error_px")

    if explicit_transform is not None:
        candidate = explicit_transform
        transform_source = "explicit_transform"
        is_explicit = True
    else:
        candidate = meta["image_to_lunar"]
        transform_source = "image_metadata" if candidate is not None else "none"
        is_explicit = False

    validated, failure_reasons = validate_lunar_transform(
        candidate,
        image_metadata,
        is_explicit_transform=is_explicit,
        explicit_georef_uncertainty_m=georeferencing_uncertainty_m,
        require_valid_coverage=require_valid_coverage,
        require_known_georeferencing_uncertainty=require_known_georeferencing_uncertainty,
        max_georeferencing_uncertainty_m=max_georeferencing_uncertainty_m,
        max_gsd_transform_mismatch_ratio=max_gsd_transform_mismatch_ratio,
        min_determinant=min_determinant,
    )

    px_breakdown, model_loc_m = _model_localization_breakdown(
        loc_err_px,
        meta["gsd_x_m_per_px"],
        meta["gsd_y_m_per_px"],
        validated,
    )

    if validated is None:
        reason_codes = list(failure_reasons)
        if loc_err_px is None:
            reason_codes.append("model_localization_error_unknown")
        return {
            "x": cx_px,
            "y": cy_px,
            "frame": "image_px",
            "uncertainty_m": None,
            "uncertain": True,
            "transform_source": transform_source,
            "reason_codes": list(dict.fromkeys(reason_codes)),
            "uncertainty_breakdown": {
                "model_localization_px": px_breakdown,
                "model_localization_m": model_loc_m,
                "georeferencing_m": None,
                "combined_m": None,
                "combination_rule": "unavailable_image_px_frame",
            },
        }

    x_m, y_m = validated.apply(cx_px, cy_px)
    geo_m = validated.georeferencing_uncertainty_m
    reason_codes = list(validated.warnings)

    if model_loc_m is None:
        reason_codes.append("model_localization_error_unknown")

    if model_loc_m is not None and geo_m is not None:
        combined_m: float | None = math.hypot(model_loc_m, geo_m)
        combination_rule = "rss_independent"
    elif geo_m is not None:
        combined_m = geo_m
        combination_rule = "georeferencing_only_model_error_unknown"
    else:
        combined_m = None
        combination_rule = "unavailable_georeferencing_uncertainty_unknown"

    return {
        "x": x_m,
        "y": y_m,
        "frame": "lunar_local_m",
        "uncertainty_m": combined_m,
        "uncertain": False,
        "transform_source": transform_source,
        "reason_codes": list(dict.fromkeys(reason_codes)),
        "uncertainty_breakdown": {
            "model_localization_px": px_breakdown,
            "model_localization_m": model_loc_m,
            "georeferencing_m": geo_m,
            "combined_m": combined_m,
            "combination_rule": combination_rule,
        },
    }
