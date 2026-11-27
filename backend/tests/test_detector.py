"""Tests for YoloBoulderDetector honest unconfigured fallback and tiled execution."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image

from moonsafe.detect import DetectorExecutionError, YoloBoulderDetector
from moonsafe.schemas import ImageMetadata


class _FakeModel:
    def __init__(self) -> None:
        self.calls = 0

    def predict(self, source: np.ndarray, conf: float, verbose: bool = False):
        self.calls += 1
        # Emit one overlapping detection near tile center if tile covers pixel (60, 60).
        h, w = source.shape[:2]
        if w >= 80 and h >= 80:
            boxes = SimpleNamespace(
                xyxy=np.array([[20.0, 20.0, 24.0, 26.0]], dtype=np.float64),
                conf=np.array([0.88], dtype=np.float64),
            )
            return [SimpleNamespace(boxes=boxes)]
        return []


class DetectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)
        self.image_path = self.tmp_dir / "nac_sample.png"
        Image.fromarray(np.full((120, 120), 128, dtype=np.uint8), mode="L").save(self.image_path)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_unconfigured_weights_returns_empty_without_inventing(self) -> None:
        meta = ImageMetadata(
            image_id="nac_sample",
            source_image_id="M001L",
            width_px=120,
            height_px=120,
            gsd_x_m_per_px=0.5,
            gsd_y_m_per_px=0.5,
            coverage="valid",
            coordinate_frame="image_px",
            image_to_lunar=None,
        )
        detector = YoloBoulderDetector()
        with patch.dict(os.environ, {"MOONSAFE_YOLO_WEIGHTS": ""}, clear=False):
            result = detector.detect(self.image_path, meta)

        self.assertFalse(result.model_executed)
        self.assertEqual(result.model_status, "unconfigured")
        self.assertEqual(result.detections, [])

    def test_explicit_missing_weights_raises_execution_error(self) -> None:
        meta = ImageMetadata(
            image_id="nac_sample",
            source_image_id="M001L",
            width_px=120,
            height_px=120,
            coverage="valid",
            coordinate_frame="image_px",
        )
        detector = YoloBoulderDetector()
        with self.assertRaises(DetectorExecutionError):
            detector.detect(self.image_path, meta, weights_path=self.tmp_dir / "missing.pt")

    def test_executed_model_respects_gsd_and_lunar_transform(self) -> None:
        weights_file = self.tmp_dir / "boulder.pt"
        weights_file.write_bytes(b"placeholder")
        fake_model = _FakeModel()
        detector = YoloBoulderDetector(model_loader=lambda _p: fake_model)

        # Without GSD or lunar transform: size is null and position stays in image_px.
        meta_px = ImageMetadata(
            image_id="nac_sample",
            source_image_id="M001L",
            width_px=120,
            height_px=120,
            gsd_x_m_per_px=None,
            gsd_y_m_per_px=None,
            coverage="valid",
            coordinate_frame="image_px",
            image_to_lunar=None,
        )
        res_px = detector.detect(self.image_path, meta_px, weights_path=weights_file)
        self.assertTrue(res_px.model_executed)
        self.assertEqual(len(res_px.detections), 1)
        self.assertIsNone(res_px.detections[0].estimated_size_m)
        self.assertEqual(res_px.detections[0].position.frame, "image_px")
        self.assertIsNone(res_px.detections[0].position.uncertainty_m)

        # With GSD and explicit lunar_local_m affine_2d transform:
        meta_lunar = ImageMetadata(
            image_id="nac_sample",
            source_image_id="M001L",
            width_px=120,
            height_px=120,
            gsd_x_m_per_px=0.5,
            gsd_y_m_per_px=0.5,
            coverage="valid",
            coordinate_frame="lunar_local_m",
            image_to_lunar={
                "type": "affine_2d",
                "units": "m",
                "matrix": [[0.5, 0.0, 100.0], [0.0, -0.5, 200.0], [0.0, 0.0, 1.0]],
            },
        )
        res_lunar = detector.detect(self.image_path, meta_lunar, weights_path=weights_file)
        det = res_lunar.detections[0]
        # Box [20, 20, 24, 26] -> width=4px (2.0m), height=6px (3.0m) -> major axis 3.0m
        self.assertEqual(det.estimated_size_m, 3.0)
        self.assertEqual(det.position.frame, "lunar_local_m")
        # Center (22, 23) -> x = 0.5*22 + 100 = 111.0, y = -0.5*23 + 200 = 188.5
        self.assertAlmostEqual(det.position.x, 111.0)
        self.assertAlmostEqual(det.position.y, 188.5)
        self.assertIsNone(det.position.uncertainty_m)


if __name__ == "__main__":
    unittest.main()
