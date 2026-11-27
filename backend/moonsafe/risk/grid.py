"""Boulder-risk grid construction.

A RiskGrid divides the image into square cells of ``cell_size_px`` pixels.
Each cell is classified as safe / caution / unsafe / uncertain based on the
boulders whose bounding-box centres fall within it and the active threshold
profile.

Threshold values are labelled illustrative when no trained model has been
validated.  The ``screening_only`` flag on every RiskGrid is always True; this
tool is a screening aid, not a safety guarantee.

Threshold profiles (illustrative defaults, not validated):
  lander:  caution ≥ 0.3 m,  unsafe ≥ 1.0 m
  rover:   caution ≥ 0.15 m, unsafe ≥ 0.4 m
  custom:  caller-supplied values
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from ..schemas import (
    CoordinateFrame,
    Detection,
    ImageMetadata,
    RiskCell,
    RiskClass,
    RiskGrid,
    ThresholdProfile,
)


@dataclass
class ThresholdSet:
    """Size thresholds in metres (illustrative defaults — not validated).

    ``safe_max_size_m`` and ``caution_max_size_m`` are upper bounds for each
    class.  A cell is ``unsafe`` when any boulder exceeds ``caution_max_size_m``
    or when ``estimated_size_m`` is None for every boulder (confidence too low
    to size).
    """

    safe_max_size_m: float = 0.3       # illustrative
    caution_max_size_m: float = 1.0    # illustrative
    min_confidence: float = 0.5
    illustrative: bool = True


DEFAULT_THRESHOLDS: Dict[ThresholdProfile, ThresholdSet] = {
    ThresholdProfile.lander: ThresholdSet(
        safe_max_size_m=0.3,
        caution_max_size_m=1.0,
        min_confidence=0.5,
        illustrative=True,
    ),
    ThresholdProfile.rover: ThresholdSet(
        safe_max_size_m=0.15,
        caution_max_size_m=0.4,
        min_confidence=0.5,
        illustrative=True,
    ),
    ThresholdProfile.custom: ThresholdSet(
        safe_max_size_m=0.3,
        caution_max_size_m=1.0,
        min_confidence=0.5,
        illustrative=True,
    ),
}


def _cell_index(
    bbox_px: List[float],
    cell_size_px: int,
) -> Tuple[int, int]:
    cx = (bbox_px[0] + bbox_px[2]) / 2.0
    cy = (bbox_px[1] + bbox_px[3]) / 2.0
    return int(cx // cell_size_px), int(cy // cell_size_px)


def _classify_cell(
    boulders: List[Detection],
    thresholds: ThresholdSet,
) -> Tuple[RiskClass, List[str]]:
    """Classify one cell given the boulders whose centres fall within it."""
    reason_codes: List[str] = []

    if thresholds.illustrative:
        reason_codes.append("illustrative_thresholds_unvalidated")

    high_conf = [
        d for d in boulders if d.confidence >= thresholds.min_confidence
    ]

    if not high_conf:
        reason_codes.append("no_high_confidence_detections")
        return RiskClass.uncertain, reason_codes

    sizes = [d.estimated_size_m for d in high_conf if d.estimated_size_m is not None]

    if not sizes:
        # All high-confidence detections have unknown size
        reason_codes.append("size_unknown_for_all_detections")
        return RiskClass.uncertain, reason_codes

    max_size = max(sizes)

    if max_size > thresholds.caution_max_size_m:
        reason_codes.append("boulder_exceeds_caution_threshold")
        return RiskClass.unsafe, reason_codes
    elif max_size > thresholds.safe_max_size_m:
        reason_codes.append("boulder_exceeds_safe_threshold")
        return RiskClass.caution, reason_codes
    else:
        return RiskClass.safe, reason_codes


class RiskGridBuilder:
    """Partition detections into a grid and classify each cell."""

    def __init__(
        self,
        thresholds: Optional[ThresholdSet] = None,
        profile: ThresholdProfile = ThresholdProfile.lander,
    ) -> None:
        self.profile = profile
        self.thresholds = thresholds or DEFAULT_THRESHOLDS[profile]

    def build(
        self,
        metadata: ImageMetadata,
        detections: List[Detection],
        cell_size_px: int = 64,
    ) -> RiskGrid:
        """Build and return a RiskGrid for the given image and detections."""
        w = metadata.width_px
        h = metadata.height_px

        cols = math.ceil(w / cell_size_px)
        rows = math.ceil(h / cell_size_px)

        # Bin detections by cell
        cell_detections: Dict[Tuple[int, int], List[Detection]] = {}
        for det in detections:
            ci = _cell_index(det.bbox_px, cell_size_px)
            # Clamp to grid bounds
            ci = (min(ci[0], cols - 1), min(ci[1], rows - 1))
            cell_detections.setdefault(ci, []).append(det)

        # Determine cell_size in metres if GSD available
        gsd_x = metadata.gsd_x_m_per_px
        gsd_y = metadata.gsd_y_m_per_px
        if gsd_x is not None and gsd_y is not None:
            cell_size_m = cell_size_px * math.sqrt(gsd_x * gsd_y)
        else:
            # Fall back to cell_size in pixels (labelled as image_px frame)
            cell_size_m = float(cell_size_px)

        frame = (
            CoordinateFrame.lunar_local_m
            if metadata.coordinate_frame == CoordinateFrame.lunar_local_m
            else CoordinateFrame.image_px
        )

        cells: List[RiskCell] = []
        for row in range(rows):
            for col in range(cols):
                key = (col, row)
                boulders = cell_detections.get(key, [])

                # Cell origin in pixel coordinates
                x_px = float(col * cell_size_px)
                y_px = float(row * cell_size_px)

                # Fraction of cell that is non-zero (always 1.0 for inner cells;
                # edge cells may be smaller but we don't have pixel-level masks here)
                x_end = min(x_px + cell_size_px, w)
                y_end = min(y_px + cell_size_px, h)
                actual_w = x_end - x_px
                actual_h = y_end - y_px
                coverage_frac = (actual_w * actual_h) / (cell_size_px * cell_size_px)

                if boulders:
                    risk_class, reason_codes = _classify_cell(boulders, self.thresholds)
                    high_conf = [
                        d for d in boulders if d.confidence >= self.thresholds.min_confidence
                    ]
                    sized = [
                        d.estimated_size_m
                        for d in high_conf
                        if d.estimated_size_m is not None
                    ]
                    max_size_m = max(sized) if sized else None
                    boulder_count = len(high_conf)
                else:
                    risk_class = RiskClass.safe
                    reason_codes = []
                    max_size_m = None
                    boulder_count = 0

                cells.append(
                    RiskCell.model_validate(
                        {
                            "cell_id": str(uuid.uuid4()),
                            "x": x_px,
                            "y": y_px,
                            "class": risk_class.value,
                            "boulder_count": boulder_count,
                            "max_size_m": max_size_m,
                            "coverage": round(coverage_frac, 4),
                            "reason_codes": reason_codes,
                        }
                    )
                )

        return RiskGrid(
            image_id=metadata.image_id,
            cell_size_m=cell_size_m,
            coordinate_frame=frame,
            threshold_profile=self.profile,
            cells=cells,
            screening_only=True,
        )
