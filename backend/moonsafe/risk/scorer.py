"""Configurable boulder-risk grid scoring for MoonSafe screening maps.

Produces the shared ``RiskGrid`` contract from detections, ImageMetadata,
coverage, cell size, and a lander/rover/custom threshold profile. All outputs
are explicitly marked ``screening_only: true`` and are not mission-certified
landing or traverse safety guidance.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .geometry import cell_footprint_coverage, grid_index_range, image_footprint_polygon
from .profiles import CONFLICT_POLICIES, RiskGridError, resolve_thresholds

_SEVERITY_RANK = {"safe": 0, "caution": 1, "unsafe": 2}


@dataclass(frozen=True)
class RiskConfig:
    """Scoring policy options for boulder-risk grid evaluation."""

    conflict_policy: str = "worst_case"
    min_resolve_pixels: float = 1.0
    fallback_cell_size_px: float = 64.0
    max_size_uncertainty_m: float | None = None
    max_relative_size_uncertainty: float | None = None
    max_position_uncertainty_m: float | None = None
    min_detection_confidence: float | None = None
    treat_partial_image_coverage_as_uncertain: bool = True
    mark_unreferenced_frame_uncertain: bool = False
    mark_uncertain_positions_uncertain: bool = True

    def __post_init__(self) -> None:
        if self.conflict_policy not in CONFLICT_POLICIES:
            raise RiskGridError(
                f"Unsupported conflict_policy {self.conflict_policy!r}; expected one of {CONFLICT_POLICIES}"
            )
        if self.min_resolve_pixels <= 0:
            raise RiskGridError("min_resolve_pixels must be > 0")
        if self.fallback_cell_size_px <= 0:
            raise RiskGridError("fallback_cell_size_px must be > 0")


def _has_valid_lunar_transform(image_metadata: Mapping[str, Any]) -> bool:
    if image_metadata.get("coordinate_frame") != "lunar_local_m":
        return False
    transform = image_metadata.get("image_to_lunar")
    if not isinstance(transform, Mapping):
        return False
    if transform.get("type") != "affine_2d" or transform.get("units") != "m":
        return False
    if transform.get("reliable") is False or transform.get("is_reliable") is False:
        return False
    matrix = transform.get("matrix")
    if (
        not isinstance(matrix, (list, tuple))
        or len(matrix) != 3
        or any(not isinstance(row, (list, tuple)) or len(row) != 3 for row in matrix)
    ):
        return False
    a, b, _ = (float(v) for v in matrix[0])
    c, d, _ = (float(v) for v in matrix[1])
    return abs(a * d - b * c) > 1e-12


def _extract_gsd(image_metadata: Mapping[str, Any]) -> tuple[float | None, float | None]:
    gx = image_metadata.get("gsd_x_m_per_px")
    gy = image_metadata.get("gsd_y_m_per_px")
    if gx is not None and gy is not None:
        return (float(gx), float(gy))
    if _has_valid_lunar_transform(image_metadata):
        matrix = image_metadata["image_to_lunar"]["matrix"]
        a, b, _ = (float(v) for v in matrix[0])
        c, d, _ = (float(v) for v in matrix[1])
        return (
            float(gx) if gx is not None else math.hypot(a, c),
            float(gy) if gy is not None else math.hypot(b, d),
        )
    return (float(gx) if gx is not None else None, float(gy) if gy is not None else None)


def _evaluate_size_risk(max_size_m: float | None, thresholds: Mapping[str, Any]) -> tuple[str, list[str]]:
    if max_size_m is None:
        return ("safe", [])
    if max_size_m >= thresholds["unsafe_boulder_size_m"]:
        return ("unsafe", ["boulder_size_exceeds_unsafe_threshold"])
    if max_size_m >= thresholds["caution_boulder_size_m"]:
        return ("caution", ["boulder_size_exceeds_caution_threshold"])
    return ("safe", [])


def _evaluate_density_risk(
    boulder_count: int,
    density_per_100m2: float | None,
    thresholds: Mapping[str, Any],
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    count_risk = "safe"
    if boulder_count >= thresholds["unsafe_boulder_count"]:
        count_risk = "unsafe"
        reasons.append("boulder_count_exceeds_unsafe_threshold")
    elif boulder_count >= thresholds["caution_boulder_count"]:
        count_risk = "caution"
        reasons.append("boulder_count_exceeds_caution_threshold")

    density_risk = "safe"
    c_dens = thresholds.get("caution_density_per_100m2")
    u_dens = thresholds.get("unsafe_density_per_100m2")
    if density_per_100m2 is not None and c_dens is not None and u_dens is not None:
        if density_per_100m2 >= u_dens:
            density_risk = "unsafe"
            reasons.append("boulder_density_exceeds_unsafe_threshold")
        elif density_per_100m2 >= c_dens:
            density_risk = "caution"
            reasons.append("boulder_density_exceeds_caution_threshold")

    final = count_risk if _SEVERITY_RANK[count_risk] >= _SEVERITY_RANK[density_risk] else density_risk
    return (final, reasons)


def _combine_size_and_density(size_risk: str, density_risk: str, policy: str) -> tuple[str, list[str]]:
    if size_risk == density_risk:
        return (size_risk, [])

    if policy == "worst_case":
        winner = size_risk if _SEVERITY_RANK[size_risk] >= _SEVERITY_RANK[density_risk] else density_risk
        return (winner, ["size_and_density_disagree_worst_case_wins"])
    if policy == "size_priority":
        return (size_risk, ["size_and_density_disagree_size_wins"])
    if policy == "density_priority":
        return (density_risk, ["size_and_density_disagree_density_wins"])
    raise RiskGridError(f"Unsupported conflict_policy: {policy}")


def _detection_in_cell_uncertainty_reasons(
    det: Mapping[str, Any],
    grid_frame: str,
    cfg: RiskConfig,
) -> list[str]:
    reasons: list[str] = []
    est_size = det.get("estimated_size_m")
    if est_size is None:
        reasons.append("missing_boulder_size_estimate")

    size_unc = det.get("size_uncertainty_m")
    if size_unc is not None:
        if cfg.max_size_uncertainty_m is not None and float(size_unc) > cfg.max_size_uncertainty_m:
            reasons.append("boulder_size_uncertainty_too_high")
        if (
            cfg.max_relative_size_uncertainty is not None
            and est_size is not None
            and float(est_size) > 0
            and float(size_unc) / float(est_size) > cfg.max_relative_size_uncertainty
        ):
            reasons.append("boulder_relative_size_uncertainty_too_high")

    conf = det.get("confidence")
    if cfg.min_detection_confidence is not None and conf is not None and float(conf) < cfg.min_detection_confidence:
        reasons.append("detection_confidence_below_threshold")

    pos = det.get("position") or {}
    pos_unc = pos.get("uncertainty_m")
    if cfg.max_position_uncertainty_m is not None and pos_unc is not None and float(pos_unc) > cfg.max_position_uncertainty_m:
        reasons.append("position_uncertainty_too_high")

    if grid_frame == "lunar_local_m" and cfg.mark_uncertain_positions_uncertain and pos.get("uncertain"):
        reasons.append("detection_position_uncertain")

    return reasons


def compute_risk_grid(
    image_metadata: Mapping[str, Any],
    detections: Sequence[Mapping[str, Any]],
    *,
    threshold_config: Mapping[str, Any] | None = None,
    threshold_profile: str | None = None,
    overrides: Mapping[str, Any] | None = None,
    config: RiskConfig | None = None,
    cell_coverages: Mapping[str, float] | None = None,
) -> dict[str, Any]:
    """Build the shared ``RiskGrid`` screening map from detections and metadata."""
    if not isinstance(image_metadata, Mapping):
        raise RiskGridError("image_metadata must be a mapping")
    image_id = image_metadata.get("image_id")
    if not isinstance(image_id, str) or not image_id.strip():
        raise RiskGridError("image_metadata.image_id must be a non-empty string")

    width_px = image_metadata.get("width_px")
    height_px = image_metadata.get("height_px")
    if isinstance(width_px, bool) or not isinstance(width_px, int) or width_px <= 0:
        raise RiskGridError("image_metadata.width_px must be a positive integer")
    if isinstance(height_px, bool) or not isinstance(height_px, int) or height_px <= 0:
        raise RiskGridError("image_metadata.height_px must be a positive integer")

    cfg = config or RiskConfig()
    thresholds = resolve_thresholds(
        threshold_config,
        threshold_profile=threshold_profile,
        overrides=overrides,
    )
    cell_size_m = thresholds["cell_size_m"]

    gsd_x, gsd_y = _extract_gsd(image_metadata)
    has_gsd = gsd_x is not None and gsd_y is not None and gsd_x > 0 and gsd_y > 0

    has_lunar_transform = _has_valid_lunar_transform(image_metadata)
    all_detections_lunar = bool(detections) and all(
        (d.get("position") or {}).get("frame") == "lunar_local_m" for d in detections
    )

    if has_lunar_transform and (not detections or all_detections_lunar):
        grid_frame = "lunar_local_m"
        step_x = cell_size_m
        step_y = cell_size_m
    else:
        grid_frame = "image_px"
        if has_gsd:
            step_x = cell_size_m / float(gsd_x)
            step_y = cell_size_m / float(gsd_y)
        else:
            step_x = cfg.fallback_cell_size_px
            step_y = cfg.fallback_cell_size_px

    footprint = image_footprint_polygon(
        width_px,
        height_px,
        image_metadata.get("image_to_lunar"),
        grid_frame,
    )
    min_x = min(p[0] for p in footprint)
    max_x = max(p[0] for p in footprint)
    min_y = min(p[1] for p in footprint)
    max_y = max(p[1] for p in footprint)

    ix_range = grid_index_range(min_x, max_x, step_x)
    iy_range = grid_index_range(min_y, max_y, step_y)

    # Index detections into grid cells using the grid's active coordinate frame.
    cell_detections: dict[tuple[int, int], list[Mapping[str, Any]]] = defaultdict(list)
    for det in detections:
        pos = det.get("position") or {}
        det_frame = pos.get("frame")
        if grid_frame == "lunar_local_m" and det_frame == "lunar_local_m":
            dx, dy = float(pos["x"]), float(pos["y"])
        else:
            bbox = det.get("bbox_px")
            if det_frame == "image_px" and "x" in pos and "y" in pos:
                dx, dy = float(pos["x"]), float(pos["y"])
            elif isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                dx = 0.5 * (float(bbox[0]) + float(bbox[2]))
                dy = 0.5 * (float(bbox[1]) + float(bbox[3]))
            else:
                raise RiskGridError(f"Detection {det.get('detection_id')!r} has no usable position or bbox_px")

        ix = math.floor(dx / step_x)
        iy = math.floor(dy / step_y)
        # Clamp upper boundary points onto the last cell index.
        if ix >= ix_range.stop and math.isclose(dx, ix_range.stop * step_x, rel_tol=1e-9, abs_tol=1e-9):
            ix = ix_range.stop - 1
        if iy >= iy_range.stop and math.isclose(dy, iy_range.stop * step_y, rel_tol=1e-9, abs_tol=1e-9):
            iy = iy_range.stop - 1
        cell_detections[(ix, iy)].append(det)

    image_coverage_state = image_metadata.get("coverage", "missing")
    min_resolvable_m = (
        max(float(gsd_x), float(gsd_y)) * cfg.min_resolve_pixels if has_gsd else None
    )
    cannot_resolve_caution = (
        min_resolvable_m is None or min_resolvable_m > thresholds["caution_boulder_size_m"]
    )
    cannot_resolve_unsafe = (
        min_resolvable_m is None or min_resolvable_m > thresholds["unsafe_boulder_size_m"]
    )

    cells: list[dict[str, Any]] = []
    class_counts = {"safe": 0, "caution": 0, "unsafe": 0, "uncertain": 0}

    for iy in iy_range:
        y0 = iy * step_y
        y1 = (iy + 1) * step_y
        for ix in ix_range:
            x0 = ix * step_x
            x1 = (ix + 1) * step_x
            cell_id = f"cell_{ix}_{iy}"

            geom_cov = cell_footprint_coverage(footprint, x0, y0, x1, y1)
            if geom_cov <= 1e-9 and (ix, iy) not in cell_detections:
                continue

            if image_coverage_state == "missing":
                effective_cov = 0.0
            elif cell_coverages is not None and cell_id in cell_coverages:
                effective_cov = max(0.0, min(1.0, float(cell_coverages[cell_id])))
            else:
                effective_cov = geom_cov

            dets_in_cell = cell_detections.get((ix, iy), [])
            boulder_count = len(dets_in_cell)
            sizes = [float(d["estimated_size_m"]) for d in dets_in_cell if d.get("estimated_size_m") is not None]
            max_size_m = max(sizes) if sizes else None

            cell_area_m2 = cell_size_m * cell_size_m
            density_per_100m2 = (
                (boulder_count / (cell_area_m2 * effective_cov)) * 100.0
                if effective_cov > 0
                else None
            )

            size_risk, size_reasons = _evaluate_size_risk(max_size_m, thresholds)
            density_risk, density_reasons = _evaluate_density_risk(
                boulder_count, density_per_100m2, thresholds
            )
            combined_risk, conflict_reasons = _combine_size_and_density(
                size_risk, density_risk, cfg.conflict_policy
            )

            reason_codes: list[str] = []
            reason_codes.extend(size_reasons)
            reason_codes.extend(density_reasons)
            reason_codes.extend(conflict_reasons)

            uncertain_reasons: list[str] = []
            if image_coverage_state == "missing":
                uncertain_reasons.append("missing_image_coverage")
            elif (
                image_coverage_state == "partial"
                and cfg.treat_partial_image_coverage_as_uncertain
                and (cell_coverages is None or cell_id not in cell_coverages)
            ):
                uncertain_reasons.append("partial_image_coverage")
            elif effective_cov < thresholds["min_valid_coverage"]:
                uncertain_reasons.append("insufficient_cell_coverage")

            if not has_gsd:
                uncertain_reasons.append("missing_gsd_cannot_resolve_size")
            elif cannot_resolve_unsafe:
                uncertain_reasons.append("image_resolution_cannot_resolve_unsafe_threshold")
            elif cannot_resolve_caution and combined_risk != "unsafe":
                uncertain_reasons.append("image_resolution_cannot_resolve_caution_threshold")

            for det in dets_in_cell:
                uncertain_reasons.extend(_detection_in_cell_uncertainty_reasons(det, grid_frame, cfg))

            if grid_frame == "image_px":
                reason_codes.append("unreferenced_image_px_frame")
                if cfg.mark_unreferenced_frame_uncertain:
                    uncertain_reasons.append("unavailable_lunar_georeferencing")

            reason_codes.extend(uncertain_reasons)
            final_class = "uncertain" if uncertain_reasons else combined_risk
            class_counts[final_class] += 1

            cells.append(
                {
                    "cell_id": cell_id,
                    "x": x0 + 0.5 * step_x,
                    "y": y0 + 0.5 * step_y,
                    "class": final_class,
                    "boulder_count": boulder_count,
                    "max_size_m": max_size_m,
                    "coverage": round(effective_cov, 6),
                    "reason_codes": list(dict.fromkeys(reason_codes)),
                    "size_risk": size_risk,
                    "density_risk": density_risk,
                    "density_per_100m2": round(density_per_100m2, 4) if density_per_100m2 is not None else None,
                    "bounds": [x0, y0, x1, y1],
                }
            )

    return {
        "image_id": image_id,
        "cell_size_m": cell_size_m,
        "cell_size_units": "m",
        "cell_size_px": [step_x, step_y] if grid_frame == "image_px" else None,
        "coordinate_frame": grid_frame,
        "threshold_profile": thresholds["threshold_profile"],
        "threshold_config": thresholds,
        "conflict_resolution_policy": cfg.conflict_policy,
        "conflict_resolution_note": (
            f"When size and density disagree, policy={cfg.conflict_policy!r} selects the winning hazard class; "
            "uncertain preconditions override safe/caution unless noted."
        ),
        "bounds": {
            "min_x": ix_range.start * step_x,
            "min_y": iy_range.start * step_y,
            "max_x": ix_range.stop * step_x,
            "max_y": iy_range.stop * step_y,
            "units": "m" if grid_frame == "lunar_local_m" else "px",
        },
        "summary": {
            "total_cells": len(cells),
            "total_boulders": len(detections),
            "class_counts": class_counts,
        },
        "cells": cells,
        "screening_only": True,
        "disclaimer": (
            "Screening-only output using illustrative/configurable thresholds. "
            "Not mission-certified landing or traverse safety guidance."
        ),
    }
