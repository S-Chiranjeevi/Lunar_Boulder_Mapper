"""Tests for shared MoonSafe JSON schemas."""

from __future__ import annotations

import unittest

from pydantic import ValidationError

from moonsafe.schemas import (
    Detection,
    DetectionPosition,
    ImageMetadata,
    RiskCell,
    RiskGrid,
    ThresholdConfig,
)


class SchemaContractTests(unittest.TestCase):
    def test_risk_grid_serializes_class_alias(self) -> None:
        grid = RiskGrid(
            image_id="nac_001",
            cell_size_m=25.0,
            coordinate_frame="image_px",
            threshold_profile="lander",
            cells=[
                RiskCell(
                    cell_id="r000_c000",
                    x=25.0,
                    y=25.0,
                    **{"class": "uncertain"},
                    boulder_count=0,
                    max_size_m=None,
                    coverage=1.0,
                    reason_codes=["MODEL_UNCONFIGURED"],
                )
            ],
            screening_only=True,
        )
        dumped = grid.model_dump(mode="json", by_alias=True)
        self.assertEqual(
            set(dumped.keys()),
            {
                "image_id",
                "cell_size_m",
                "coordinate_frame",
                "threshold_profile",
                "cells",
                "screening_only",
            },
        )
        self.assertEqual(dumped["cells"][0]["class"], "uncertain")
        self.assertNotIn("risk_class", dumped["cells"][0])

    def test_detection_and_image_metadata_keys(self) -> None:
        meta = ImageMetadata(
            image_id="nac_001",
            source_image_id="M12345L",
            width_px=512,
            height_px=512,
            gsd_x_m_per_px=0.5,
            gsd_y_m_per_px=0.5,
            coverage="valid",
            coordinate_frame="image_px",
            image_to_lunar=None,
        )
        self.assertEqual(
            set(meta.model_dump().keys()),
            {
                "image_id",
                "source_image_id",
                "width_px",
                "height_px",
                "gsd_x_m_per_px",
                "gsd_y_m_per_px",
                "coverage",
                "coordinate_frame",
                "image_to_lunar",
            },
        )

        det = Detection(
            detection_id="det_1",
            image_id="nac_001",
            bbox_px=[10, 20, 30, 40],
            confidence=0.82,
            model_version="test-v1",
            estimated_size_m=10.0,
            size_uncertainty_m=None,
            position=DetectionPosition(x=20.0, y=30.0, frame="image_px", uncertainty_m=None),
        )
        self.assertEqual(
            set(det.model_dump().keys()),
            {
                "detection_id",
                "image_id",
                "bbox_px",
                "confidence",
                "model_version",
                "estimated_size_m",
                "size_uncertainty_m",
                "position",
            },
        )

    def test_threshold_config_rejects_inverted_bounds(self) -> None:
        with self.assertRaises(ValidationError):
            ThresholdConfig(caution_boulder_size_m=2.0, unsafe_boulder_size_m=1.0)
        with self.assertRaises(ValidationError):
            ThresholdConfig(caution_boulder_count=6, unsafe_boulder_count=3)


if __name__ == "__main__":
    unittest.main()
