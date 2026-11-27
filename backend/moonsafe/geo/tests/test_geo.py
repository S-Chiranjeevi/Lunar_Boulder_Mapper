"""Unit tests for moonsafe.geo image-to-size and image-to-coordinate mapping."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

# Allow running directly via `python -m unittest` from repo root without editable install.
_BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from moonsafe.geo import (  # noqa: E402
    GeoConfig,
    GeoTransformError,
    estimate_projected_size,
    process_detection,
    process_detections,
    transform_pixel_to_lunar,
)


def _base_metadata(**overrides):
    data = {
        "image_id": "nac_test_001",
        "source_image_id": "M1234567890L",
        "width_px": 1000,
        "height_px": 1000,
        "gsd_x_m_per_px": 0.5,
        "gsd_y_m_per_px": 0.5,
        "coverage": "valid",
        "coordinate_frame": "image_px",
        "image_to_lunar": None,
    }
    data.update(overrides)
    return data


def _base_detection(**overrides):
    data = {
        "detection_id": "det_001",
        "image_id": "nac_test_001",
        "bbox_px": [100.0, 200.0, 112.0, 208.0],
        "confidence": 0.91,
        "model_version": "yolo-planned-v0",
    }
    data.update(overrides)
    return data


class SizeEstimationTests(unittest.TestCase):
    def test_projected_size_without_assumed_one_pixel_error(self) -> None:
        result = estimate_projected_size([10.0, 20.0, 22.0, 28.0], 0.5, 0.5)
        self.assertAlmostEqual(result["estimated_size_m"], 6.0)
        self.assertIsNone(result["size_uncertainty_m"])
        est = result["size_estimation"]
        self.assertEqual(est["method"], "max_bbox_extent")
        self.assertTrue(est["projected_2d_only"])
        self.assertFalse(est["height_3d_inferred"])
        self.assertEqual(est["uncertainty_method"], "unavailable_no_localization_error")
        self.assertIn("model_localization_error_unknown", est["reason_codes"])

    def test_projected_size_methods_and_uncertainty_propagation(self) -> None:
        # bbox: width=10px -> 5.0m, height=6px -> 3.0m
        bbox = [0.0, 0.0, 10.0, 6.0]
        res_mean = estimate_projected_size(
            bbox,
            0.5,
            0.5,
            method="mean_bbox_extent",
            localization_error_px=0.5,
        )
        self.assertAlmostEqual(res_mean["estimated_size_m"], 4.0)
        # sigma_w = 0.5 * (sqrt(2)*0.5) = 0.35355..., sigma_h same -> mean sigma = 0.5*sqrt(2)*sigma_w = 0.25
        self.assertAlmostEqual(res_mean["size_uncertainty_m"], 0.25)

        res_diag = estimate_projected_size(
            bbox,
            0.5,
            0.5,
            method="bbox_diagonal",
            bbox_size_error_px=(2.0, 2.0),
        )
        self.assertAlmostEqual(res_diag["estimated_size_m"], math.hypot(5.0, 3.0))
        self.assertAlmostEqual(res_diag["size_uncertainty_m"], 1.0)

        res_gmean = estimate_projected_size(
            bbox,
            0.5,
            0.5,
            method="geometric_mean_bbox_extent",
            bbox_size_error_px=(1.0, 1.0),
        )
        self.assertAlmostEqual(res_gmean["estimated_size_m"], math.sqrt(15.0))
        self.assertGreater(res_gmean["size_uncertainty_m"], 0.0)

    def test_missing_gsd_returns_null_size(self) -> None:
        result = estimate_projected_size([0.0, 0.0, 10.0, 10.0], None, 0.5)
        self.assertIsNone(result["estimated_size_m"])
        self.assertIsNone(result["size_uncertainty_m"])
        self.assertEqual(result["size_estimation"]["reason_codes"], ["missing_gsd_x"])


class CoordinateTransformTests(unittest.TestCase):
    def test_missing_transform_preserves_image_px_and_marks_uncertain(self) -> None:
        meta = _base_metadata()
        pos = transform_pixel_to_lunar((106.0, 204.0), meta, localization_error_px=0.4)
        self.assertEqual(pos["frame"], "image_px")
        self.assertEqual(pos["x"], 106.0)
        self.assertEqual(pos["y"], 204.0)
        self.assertTrue(pos["uncertain"])
        self.assertIsNone(pos["uncertainty_m"])
        # Model localization error is preserved separately even in image_px frame.
        breakdown = pos["uncertainty_breakdown"]
        self.assertIsNone(breakdown["georeferencing_m"])
        self.assertAlmostEqual(breakdown["model_localization_px"]["radial"], math.hypot(0.4, 0.4))
        self.assertAlmostEqual(breakdown["model_localization_m"], math.hypot(0.2, 0.2))

    def test_valid_lunar_transform_separates_model_and_georef_uncertainty(self) -> None:
        transform = {
            "type": "affine_2d",
            "units": "m",
            "matrix": [
                [0.5, 0.0, 1000.0],
                [0.0, -0.5, 2000.0],
                [0.0, 0.0, 1.0],
            ],
            "uncertainty_m": 12.0,
        }
        meta = _base_metadata(coordinate_frame="lunar_local_m", image_to_lunar=transform)
        pos = transform_pixel_to_lunar((100.0, 200.0), meta, localization_error_px=(2.0, 2.0))

        self.assertEqual(pos["frame"], "lunar_local_m")
        self.assertFalse(pos["uncertain"])
        self.assertAlmostEqual(pos["x"], 1050.0)
        self.assertAlmostEqual(pos["y"], 1900.0)

        breakdown = pos["uncertainty_breakdown"]
        expected_model_m = math.hypot(1.0, 1.0)
        self.assertAlmostEqual(breakdown["model_localization_m"], expected_model_m)
        self.assertAlmostEqual(breakdown["georeferencing_m"], 12.0)
        self.assertAlmostEqual(pos["uncertainty_m"], math.hypot(expected_model_m, 12.0))
        self.assertEqual(breakdown["combination_rule"], "rss_independent")

    def test_valid_lunar_transform_without_model_error_does_not_assume_one_pixel(self) -> None:
        transform = {
            "type": "affine_2d",
            "units": "m",
            "matrix": [
                [0.5, 0.0, 0.0],
                [0.0, 0.5, 0.0],
                [0.0, 0.0, 1.0],
            ],
            "uncertainty_m": 8.0,
        }
        meta = _base_metadata(coordinate_frame="lunar_local_m", image_to_lunar=transform)
        pos = transform_pixel_to_lunar((20.0, 40.0), meta)
        self.assertEqual(pos["frame"], "lunar_local_m")
        self.assertIsNone(pos["uncertainty_breakdown"]["model_localization_m"])
        self.assertIsNone(pos["uncertainty_breakdown"]["model_localization_px"])
        self.assertAlmostEqual(pos["uncertainty_breakdown"]["georeferencing_m"], 8.0)
        self.assertAlmostEqual(pos["uncertainty_m"], 8.0)
        self.assertIn("model_localization_error_unknown", pos["reason_codes"])

    def test_unreliable_or_earth_crs_transform_rejected(self) -> None:
        earth_transform = {
            "type": "affine_2d",
            "units": "deg",
            "crs": "EPSG:4326",
            "matrix": [[1e-5, 0.0, 20.0], [0.0, -1e-5, -10.0], [0.0, 0.0, 1.0]],
        }
        meta = _base_metadata(coordinate_frame="lunar_local_m", image_to_lunar=earth_transform)
        pos = transform_pixel_to_lunar((50.0, 60.0), meta)
        self.assertEqual(pos["frame"], "image_px")
        self.assertTrue(pos["uncertain"])
        self.assertIn("rejected_earth_crs", pos["reason_codes"])
        self.assertIn("unsupported_transform_units_must_be_meters", pos["reason_codes"])

        unreliable_transform = {
            "type": "affine_2d",
            "units": "m",
            "matrix": [[0.5, 0.0, 0.0], [0.0, 0.5, 0.0], [0.0, 0.0, 1.0]],
            "reliable": False,
        }
        meta_unrel = _base_metadata(coordinate_frame="lunar_local_m", image_to_lunar=unreliable_transform)
        pos_unrel = transform_pixel_to_lunar((50.0, 60.0), meta_unrel)
        self.assertEqual(pos_unrel["frame"], "image_px")
        self.assertTrue(pos_unrel["uncertain"])
        self.assertIn("transform_marked_unreliable", pos_unrel["reason_codes"])

    def test_gsd_and_transform_scale_mismatch_marked_unreliable(self) -> None:
        mismatched = {
            "type": "affine_2d",
            "units": "m",
            "matrix": [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 1.0]],
        }
        meta = _base_metadata(coordinate_frame="lunar_local_m", image_to_lunar=mismatched)
        pos = transform_pixel_to_lunar((50.0, 60.0), meta)
        self.assertEqual(pos["frame"], "image_px")
        self.assertTrue(pos["uncertain"])
        self.assertIn("gsd_x_transform_scale_mismatch", pos["reason_codes"])


class PipelineTests(unittest.TestCase):
    def test_process_detections_contract_and_explicit_transform(self) -> None:
        meta = _base_metadata(gsd_x_m_per_px=None, gsd_y_m_per_px=None, coverage="missing")
        explicit = {
            "type": "affine_2d",
            "units": "m",
            "matrix": [[0.5, 0.0, 10.0], [0.0, -0.5, 500.0], [0.0, 0.0, 1.0]],
            "uncertainty_m": 4.0,
        }
        detections = process_detections(
            meta,
            [_base_detection(localization_error_px=0.5)],
            transform=explicit,
            config=GeoConfig(size_method="max_bbox_extent"),
        )
        self.assertEqual(len(detections), 1)
        det = detections[0]
        # Required shared Detection keys
        for key in (
            "detection_id",
            "image_id",
            "bbox_px",
            "confidence",
            "model_version",
            "estimated_size_m",
            "size_uncertainty_m",
            "position",
        ):
            self.assertIn(key, det)

        self.assertAlmostEqual(det["estimated_size_m"], 6.0)
        self.assertAlmostEqual(det["size_uncertainty_m"], 0.5 * math.sqrt(2.0) * 0.5)
        self.assertEqual(det["size_estimation"]["gsd_source"], "image_to_lunar_affine")
        self.assertEqual(det["position"]["frame"], "lunar_local_m")
        self.assertAlmostEqual(det["position"]["x"], 10.0 + 0.5 * 106.0)
        self.assertAlmostEqual(det["position"]["y"], 500.0 - 0.5 * 204.0)
        self.assertIn("missing_image_coverage", det["position"]["reason_codes"])

    def test_mismatched_image_id_raises(self) -> None:
        meta = _base_metadata()
        det = _base_detection(image_id="other_image")
        with self.assertRaises(GeoTransformError):
            process_detection(meta, det)

    def test_out_of_bounds_bbox_raises(self) -> None:
        meta = _base_metadata(width_px=100, height_px=100)
        det = _base_detection(bbox_px=[90.0, 10.0, 120.0, 20.0])
        with self.assertRaises(GeoTransformError):
            process_detection(meta, det)


if __name__ == "__main__":
    unittest.main()
