"""Compute RiskGrid screening classifications from ImageMetadata, Detections, and thresholds."""

from __future__ import annotations

import math
from typing import Mapping, Sequence

from moonsafe.schemas import (
    Detection,
    ImageMetadata,
    RiskCell,
    RiskClass,
    RiskGrid,
    ThresholdConfig,
    ThresholdProfile,
)

MAX_GRID_CELLS = 6400


def _transform_point(
    x_px: float,
    y_px: float,
    metadata: ImageMetadata,
) -> tuple[float, float]:
    transform = metadata.image_to_lunar
    if (
        metadata.coordinate_frame == "lunar_local_m"
        and isinstance(transform, Mapping)
        and transform.get("type") == "affine_2d"
        and transform.get("units") == "m"
    ):
        matrix = transform.get("matrix")
        if isinstance(matrix, (list, tuple)) and len(matrix) == 3:
            x_m = float(matrix[0][0]) * x_px + float(matrix[0][1]) * y_px + float(matrix[0][2])
            y_m = float(matrix[1][0]) * x_px + float(matrix[1][1]) * y_px + float(matrix[1][2])
            return x_m, y_m
    return x_px, y_px


def compute_risk_grid(
    metadata: ImageMetadata,
    detections: Sequence[Detection],
    threshold_profile: ThresholdProfile,
    thresholds: ThresholdConfig,
    *,
    model_executed: bool,
) -> RiskGrid:
    """Aggregate detections into a screening-only RiskGrid without rerunning detection."""
    width_px = float(metadata.width_px)
    height_px = float(metadata.height_px)
    has_gsd = metadata.gsd_x_m_per_px is not None and metadata.gsd_y_m_per_px is not None
    has_lunar_transform = metadata.coordinate_frame == "lunar_local_m" and metadata.image_to_lunar is not None

    effective_cell_size_m = float(thresholds.cell_size_m)
    aggregated_for_extent = False

    if has_gsd:
        assert metadata.gsd_x_m_per_px is not None and metadata.gsd_y_m_per_px is not None
        cell_w_px = effective_cell_size_m / metadata.gsd_x_m_per_px
        cell_h_px = effective_cell_size_m / metadata.gsd_y_m_per_px
        cols = max(1, math.ceil(width_px / cell_w_px))
        rows = max(1, math.ceil(height_px / cell_h_px))
        if cols * rows > MAX_GRID_CELLS:
            scale = math.ceil(math.sqrt((cols * rows) / MAX_GRID_CELLS))
            effective_cell_size_m *= scale
            cell_w_px *= scale
            cell_h_px *= scale
            cols = max(1, math.ceil(width_px / cell_w_px))
            rows = max(1, math.ceil(height_px / cell_h_px))
            aggregated_for_extent = True
    else:
        stride_px = max(64.0, min(256.0, max(width_px, height_px) / 8.0))
        cell_w_px = stride_px
        cell_h_px = stride_px
        cols = max(1, math.ceil(width_px / cell_w_px))
        rows = max(1, math.ceil(height_px / cell_h_px))

    # Bucket detections by their image-pixel bounding box center.
    cell_detections: dict[tuple[int, int], list[Detection]] = {}
    filtered_low_conf_cells: set[tuple[int, int]] = set()
    for det in detections:
        x_min, y_min, x_max, y_max = det.bbox_px
        cx = (x_min + x_max) / 2.0
        cy = (y_min + y_max) / 2.0
        col = min(cols - 1, max(0, int(cx // cell_w_px)))
        row = min(rows - 1, max(0, int(cy // cell_h_px)))
        key = (row, col)
        if det.confidence >= thresholds.min_confidence:
            cell_detections.setdefault(key, []).append(det)
        else:
            filtered_low_conf_cells.add(key)

    cells: list[RiskCell] = []
    for row in range(rows):
        y0 = row * cell_h_px
        y1 = min(height_px, (row + 1) * cell_h_px)
        cy_px = (row + 0.5) * cell_h_px
        for col in range(cols):
            x0 = col * cell_w_px
            x1 = min(width_px, (col + 1) * cell_w_px)
            cx_px = (col + 0.5) * cell_w_px

            geom_cov = max(0.0, (x1 - x0) * (y1 - y0)) / (cell_w_px * cell_h_px)
            geom_cov = min(1.0, geom_cov)

            reason_codes: list[str] = []
            if not model_executed:
                reason_codes.append("MODEL_UNCONFIGURED")
            if not has_gsd:
                reason_codes.append("MISSING_GSD")
            if not has_lunar_transform:
                reason_codes.append("NO_LUNAR_TRANSFORM")
            if aggregated_for_extent:
                reason_codes.append("CELL_SIZE_SCALED_FOR_IMAGE_EXTENT")

            if metadata.coverage == "missing":
                cell_cov = 0.0
                reason_codes.append("COVERAGE_MISSING")
            elif metadata.coverage == "partial":
                cell_cov = round(min(geom_cov, 0.5), 4)
                reason_codes.append("COVERAGE_PARTIAL")
            else:
                cell_cov = round(geom_cov, 4)

            if metadata.coverage != "missing" and cell_cov < thresholds.min_cell_coverage:
                reason_codes.append("LOW_CELL_COVERAGE")

            bucket = cell_detections.get((row, col), [])
            boulder_count = len(bucket)
            sizes = [d.estimated_size_m for d in bucket if d.estimated_size_m is not None]
            max_size_m = round(max(sizes), 4) if sizes else None

            if (row, col) in filtered_low_conf_cells:
                reason_codes.append("LOW_CONFIDENCE_DETECTIONS_FILTERED")

            has_unsafe = False
            has_caution = False
            if model_executed and has_gsd:
                if max_size_m is not None and max_size_m >= thresholds.unsafe_boulder_size_m:
                    has_unsafe = True
                    reason_codes.append("SIZE_EXCEEDS_UNSAFE")
                if boulder_count >= thresholds.unsafe_boulder_count:
                    has_unsafe = True
                    reason_codes.append("COUNT_EXCEEDS_UNSAFE")

                if not has_unsafe:
                    if max_size_m is not None and max_size_m >= thresholds.caution_boulder_size_m:
                        has_caution = True
                        reason_codes.append("SIZE_EXCEEDS_CAUTION")
                    if boulder_count >= thresholds.caution_boulder_count:
                        has_caution = True
                        reason_codes.append("COUNT_EXCEEDS_CAUTION")

            risk_class: RiskClass
            if has_unsafe:
                risk_class = "unsafe"
            elif (
                not model_executed
                or not has_gsd
                or metadata.coverage in {"missing", "partial"}
                or cell_cov < thresholds.min_cell_coverage
                or (thresholds.require_lunar_transform_for_safe and not has_lunar_transform)
            ):
                if thresholds.require_lunar_transform_for_safe and not has_lunar_transform:
                    reason_codes.append("TRANSFORM_REQUIRED_FOR_SAFE")
                risk_class = "uncertain"
            elif has_caution:
                risk_class = "caution"
            else:
                risk_class = "safe"
                reason_codes.append("WITHIN_ILLUSTRATIVE_THRESHOLDS")

            out_x, out_y = _transform_point(cx_px, cy_px, metadata)
            cells.append(
                RiskCell(
                    cell_id=f"r{row:03d}_c{col:03d}",
                    x=round(out_x, 4),
                    y=round(out_y, 4),
                    **{"class": risk_class},
                    boulder_count=boulder_count,
                    max_size_m=max_size_m,
                    coverage=cell_cov,
                    reason_codes=reason_codes,
                )
            )

    return RiskGrid(
        image_id=metadata.image_id,
        cell_size_m=round(effective_cell_size_m, 4),
        coordinate_frame="lunar_local_m" if has_lunar_transform else "image_px",
        threshold_profile=threshold_profile,
        cells=cells,
        screening_only=True,
    )
