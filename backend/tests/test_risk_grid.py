"""Tests for deterministic RiskGrid screening calculations."""

from __future__ import annotations

import unittest

from moonsafe.config import ILLUSTRATIVE_THRESHOLD_PROFILES
from moonsafe.risk import compute_risk_grid
from moonsafe.schemas import Detection, DetectionPosition, ImageMetadata, ThresholdConfig


def _make_det(det_id: str, cx: float, cy: float, size_m: float | None, conf: float = 0.9) -> Detection:
    return Detection(
        detection_id=det_id,
        image_id="nac_01",
        bbox_px=[cx - 2.0, cy - 2.0, cx + 2.0, cy + 2.0],
        confidence=conf,
        model_version="test-v1",
        estimated_size_m=size_m,
        size_uncertainty_m=None,
        position=DetectionPosition(x=cx, y=cy, frame="image_px", uncertainty_m=None),
    )


class RiskGridTests(unittest.TestCase):
    def test_unconfigured_model_forces_uncertain_cells(self) -> None:
        meta = ImageMetadata(
            image_id="nac_01",
            source_image_id="M100L",
            width_px=100,
            height_px=100,
            gsd_x_m_per_px=0.5,
            gsd_y_m_per_px=0.5,
            coverage="valid",
            coordinate_frame="image_px",
            image_to_lunar=None,
        )
        grid = compute_risk_grid(
            meta,
            [],
            "lander",
            ILLUSTRATIVE_THRESHOLD_PROFILES["lander"],
            model_executed=False,
        )
        self.assertTrue(grid.screening_only)
        self.assertEqual(len(grid.cells), 4)  # 50m x 50m at 25m cell_size -> 2x2
        for cell in grid.cells:
            self.assertEqual(cell.risk_class, "uncertain")
            self.assertIn("MODEL_UNCONFIGURED", cell.reason_codes)
            self.assertIn("NO_LUNAR_TRANSFORM", cell.reason_codes)

    def test_missing_gsd_forces_uncertain(self) -> None:
        meta = ImageMetadata(
            image_id="nac_01",
            source_image_id="M100L",
            width_px=128,
            height_px=128,
            gsd_x_m_per_px=None,
            gsd_y_m_per_px=None,
            coverage="valid",
            coordinate_frame="image_px",
        )
        grid = compute_risk_grid(
            meta,
            [_make_det("d1", 20.0, 20.0, None)],
            "lander",
            ILLUSTRATIVE_THRESHOLD_PROFILES["lander"],
            model_executed=True,
        )
        for cell in grid.cells:
            self.assertEqual(cell.risk_class, "uncertain")
            self.assertIn("MISSING_GSD", cell.reason_codes)
            self.assertIsNone(cell.max_size_m)

    def test_threshold_recalculation_without_rerunning_detection(self) -> None:
        meta = ImageMetadata(
            image_id="nac_01",
            source_image_id="M100L",
            width_px=100,
            height_px=100,
            gsd_x_m_per_px=0.5,
            gsd_y_m_per_px=0.5,
            coverage="valid",
            coordinate_frame="lunar_local_m",
            image_to_lunar={
                "type": "affine_2d",
                "units": "m",
                "matrix": [[0.5, 0.0, 0.0], [0.0, 0.5, 0.0], [0.0, 0.0, 1.0]],
            },
        )
        detections = [
            _make_det("d1", 10.0, 10.0, 0.7),  # cell (0, 0) -> caution for lander, unsafe for rover
            _make_det("d2", 75.0, 75.0, 0.2),  # cell (1, 1) -> safe
        ]

        lander_grid = compute_risk_grid(
            meta,
            detections,
            "lander",
            ILLUSTRATIVE_THRESHOLD_PROFILES["lander"],
            model_executed=True,
        )
        classes_lander = {c.cell_id: c.risk_class for c in lander_grid.cells}
        self.assertEqual(classes_lander["r000_c000"], "caution")
        self.assertEqual(classes_lander["r001_c001"], "safe")

        rover_grid = compute_risk_grid(
            meta,
            detections,
            "rover",
            ThresholdConfig(
                cell_size_m=25.0,
                caution_boulder_size_m=0.3,
                unsafe_boulder_size_m=0.6,
                caution_boulder_count=2,
                unsafe_boulder_count=5,
            ),
            model_executed=True,
        )
        classes_rover = {c.cell_id: c.risk_class for c in rover_grid.cells}
        self.assertEqual(classes_rover["r000_c000"], "unsafe")
        self.assertEqual(classes_rover["r001_c001"], "safe")


if __name__ == "__main__":
    unittest.main()
