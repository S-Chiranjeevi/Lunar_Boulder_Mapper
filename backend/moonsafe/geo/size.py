"""Projected 2D boulder size estimation from bounding box pixels and image GSD.

Size estimates are strictly 2D image-plane projections in metres. True 3D boulder
height is never inferred from a 2D monocular image, and pixel localization
uncertainty is never assumed to be a fixed constant (such as 1 pixel).
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence

from ._validation import (
    GeoTransformError,
    non_negative_optional_number,
    parse_xy_error_px,
    positive_optional_number,
    validate_bbox_px,
)

SUPPORTED_SIZE_METHODS: tuple[str, ...] = (
    "max_bbox_extent",
    "mean_bbox_extent",
    "geometric_mean_bbox_extent",
    "bbox_diagonal",
)


def _compute_projected_metric(width_m: float, height_m: float, method: str) -> float:
    if method == "max_bbox_extent":
        return max(width_m, height_m)
    if method == "mean_bbox_extent":
        return 0.5 * (width_m + height_m)
    if method == "geometric_mean_bbox_extent":
        return math.sqrt(width_m * height_m)
    if method == "bbox_diagonal":
        return math.hypot(width_m, height_m)
    raise GeoTransformError(f"Unsupported size estimation method: {method}")


def _propagate_size_uncertainty(
    width_m: float,
    height_m: float,
    sigma_w_m: float,
    sigma_h_m: float,
    estimated_size_m: float,
    method: str,
) -> float:
    if method == "max_bbox_extent":
        if width_m > height_m:
            return sigma_w_m
        if height_m > width_m:
            return sigma_h_m
        return max(sigma_w_m, sigma_h_m)
    if method == "mean_bbox_extent":
        return 0.5 * math.hypot(sigma_w_m, sigma_h_m)
    if method == "geometric_mean_bbox_extent":
        return 0.5 * math.hypot(
            (height_m / estimated_size_m) * sigma_w_m,
            (width_m / estimated_size_m) * sigma_h_m,
        )
    if method == "bbox_diagonal":
        return math.hypot(width_m * sigma_w_m, height_m * sigma_h_m) / estimated_size_m
    raise GeoTransformError(f"Unsupported size estimation method: {method}")


def estimate_projected_size(
    bbox_px: Sequence[Any],
    gsd_x_m_per_px: float | None,
    gsd_y_m_per_px: float | None,
    *,
    method: str = "max_bbox_extent",
    localization_error_px: float | Sequence[float] | Mapping[str, Any] | None = None,
    bbox_size_error_px: float | Sequence[float] | Mapping[str, Any] | None = None,
    gsd_x_uncertainty_m_per_px: float | None = None,
    gsd_y_uncertainty_m_per_px: float | None = None,
    gsd_source: str = "image_metadata",
) -> dict[str, Any]:
    """Estimate projected 2D boulder size in metres and record method/uncertainty.

    Args:
        bbox_px: Bounding box ``[x_min, y_min, x_max, y_max]`` in pixels.
        gsd_x_m_per_px: Ground sample distance along x in m/px, or None.
        gsd_y_m_per_px: Ground sample distance along y in m/px, or None.
        method: Aggregation method over projected 2D bbox extents.
        localization_error_px: Optional per-edge coordinate localization error in px.
            Never defaults to a fixed 1-pixel assumption when omitted.
        bbox_size_error_px: Optional direct error on bbox ``(width_px, height_px)``.
            Takes precedence over ``localization_error_px`` for size uncertainty.
        gsd_x_uncertainty_m_per_px: Optional 1-sigma GSD x uncertainty in m/px.
        gsd_y_uncertainty_m_per_px: Optional 1-sigma GSD y uncertainty in m/px.
        gsd_source: Provenance label for the GSD values used.

    Returns:
        Dictionary with ``estimated_size_m``, ``size_uncertainty_m``, and
        ``size_estimation`` provenance metadata.
    """
    if method not in SUPPORTED_SIZE_METHODS:
        raise GeoTransformError(
            f"Unsupported size method {method!r}; expected one of {SUPPORTED_SIZE_METHODS}"
        )

    x_min, y_min, x_max, y_max = validate_bbox_px(bbox_px)
    width_px = x_max - x_min
    height_px = y_max - y_min

    gsd_x = positive_optional_number(gsd_x_m_per_px, "gsd_x_m_per_px")
    gsd_y = positive_optional_number(gsd_y_m_per_px, "gsd_y_m_per_px")
    sgx = non_negative_optional_number(gsd_x_uncertainty_m_per_px, "gsd_x_uncertainty_m_per_px")
    sgy = non_negative_optional_number(gsd_y_uncertainty_m_per_px, "gsd_y_uncertainty_m_per_px")

    parsed_size_err = parse_xy_error_px(bbox_size_error_px, "bbox_size_error_px")
    parsed_loc_err = parse_xy_error_px(localization_error_px, "localization_error_px")

    reason_codes: list[str] = []
    if gsd_x is None:
        reason_codes.append("missing_gsd_x")
    if gsd_y is None:
        reason_codes.append("missing_gsd_y")

    if gsd_x is None or gsd_y is None:
        return {
            "estimated_size_m": None,
            "size_uncertainty_m": None,
            "size_estimation": {
                "method": method,
                "projected_2d_only": True,
                "height_3d_inferred": False,
                "bbox_width_px": width_px,
                "bbox_height_px": height_px,
                "bbox_width_m": None,
                "bbox_height_m": None,
                "gsd_x_m_per_px": gsd_x,
                "gsd_y_m_per_px": gsd_y,
                "gsd_source": "unavailable",
                "uncertainty_method": "unavailable_missing_gsd",
                "model_localization_error_px": (
                    {"x": parsed_loc_err[0], "y": parsed_loc_err[1]} if parsed_loc_err is not None else None
                ),
                "gsd_uncertainty_m_per_px": (
                    {"x": sgx, "y": sgy} if (sgx is not None or sgy is not None) else None
                ),
                "reason_codes": reason_codes,
            },
        }

    width_m = width_px * gsd_x
    height_m = height_px * gsd_y
    estimated_size_m = _compute_projected_metric(width_m, height_m, method)

    if parsed_size_err is not None:
        ew_px, eh_px = parsed_size_err
        base_uncertainty_method = "linear_error_propagation_from_bbox_size_error"
    elif parsed_loc_err is not None:
        # Width = x_max - x_min; assuming independent endpoint errors gives sqrt(2) * sigma_edge.
        ew_px = parsed_loc_err[0] * math.sqrt(2.0)
        eh_px = parsed_loc_err[1] * math.sqrt(2.0)
        base_uncertainty_method = "linear_error_propagation_from_edge_localization_rss"
    else:
        ew_px = None
        eh_px = None
        base_uncertainty_method = None

    gsd_only_sigma_w = width_px * (sgx or 0.0)
    gsd_only_sigma_h = height_px * (sgy or 0.0)
    has_gsd_unc = sgx is not None or sgy is not None
    gsd_only_uncertainty_m = (
        _propagate_size_uncertainty(width_m, height_m, gsd_only_sigma_w, gsd_only_sigma_h, estimated_size_m, method)
        if has_gsd_unc
        else None
    )

    if ew_px is not None and eh_px is not None:
        sigma_w_m = math.hypot(gsd_x * ew_px, gsd_only_sigma_w)
        sigma_h_m = math.hypot(gsd_y * eh_px, gsd_only_sigma_h)
        size_uncertainty_m = _propagate_size_uncertainty(
            width_m, height_m, sigma_w_m, sigma_h_m, estimated_size_m, method
        )
        uncertainty_method = f"{base_uncertainty_method}_and_gsd" if has_gsd_unc else base_uncertainty_method
    else:
        size_uncertainty_m = None
        reason_codes.append("model_localization_error_unknown")
        uncertainty_method = (
            "unavailable_partial_gsd_only_no_localization_error"
            if has_gsd_unc
            else "unavailable_no_localization_error"
        )

    return {
        "estimated_size_m": estimated_size_m,
        "size_uncertainty_m": size_uncertainty_m,
        "size_estimation": {
            "method": method,
            "projected_2d_only": True,
            "height_3d_inferred": False,
            "bbox_width_px": width_px,
            "bbox_height_px": height_px,
            "bbox_width_m": width_m,
            "bbox_height_m": height_m,
            "gsd_x_m_per_px": gsd_x,
            "gsd_y_m_per_px": gsd_y,
            "gsd_source": gsd_source,
            "uncertainty_method": uncertainty_method,
            "model_localization_error_px": (
                {"x": parsed_loc_err[0], "y": parsed_loc_err[1]} if parsed_loc_err is not None else None
            ),
            "bbox_size_error_px": (
                {"width": ew_px, "height": eh_px} if (ew_px is not None and eh_px is not None) else None
            ),
            "gsd_uncertainty_m_per_px": {"x": sgx, "y": sgy} if has_gsd_unc else None,
            "gsd_only_uncertainty_m": gsd_only_uncertainty_m,
            "reason_codes": reason_codes,
        },
    }
