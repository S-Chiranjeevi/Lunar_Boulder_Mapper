"""Unit tests for ml.detector slicing, merging, dataset validation, and contracts."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

_REPO_ROOT = Path(__file__).resolve().parents[3]
_BACKEND_ROOT = _REPO_ROOT / "backend"
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from ml.detector import (  # noqa: E402
    BoulderDetector,
    DatasetUnavailableError,
    DetectorConfig,
    MissingWeightsError,
    TrainConfig,
    check_inference_availability,
    generate_tile_windows,
    merge_tile_detections,
    prepare_training_plan,
    validate_prepared_dataset,
)
from moonsafe.geo import process_detections  # noqa: E402
from moonsafe.risk import compute_risk_grid  # noqa: E402


class DetectorAvailabilityAndDatasetTests(unittest.TestCase):
    def test_missing_weights_reported_honestly_and_raises(self) -> None:
        cfg = DetectorConfig(weights_path=None, model_version="yolo-test-untrained")
        status = check_inference_availability(cfg)
        self.assertFalse(status["available"])
        self.assertFalse(status["weights_present"])
        self.assertIsNotNone(status["reason"])

        with tempfile.TemporaryDirectory() as tmp:
            img_path = Path(tmp) / "nac.png"
            Image.new("L", (64, 64), color=120).save(img_path)
            detector = BoulderDetector(cfg)
            self.assertFalse(detector.is_available())
            with self.assertRaises(MissingWeightsError) as ctx:
                detector.detect(img_path)
            self.assertIsInstance(ctx.exception, FileNotFoundError)

    def test_dataset_validation_requires_real_images_and_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            train_imgs = root / "images" / "train"
            train_lbls = root / "labels" / "train"
            train_imgs.mkdir(parents=True)
            train_lbls.mkdir(parents=True)

            Image.new("L", (64, 64), color=90).save(train_imgs / "tile_01.png")
            data_yaml = root / "data.yaml"
            data_yaml.write_text(
                "path: .\ntrain: images/train\nval: images/train\nnames:\n  0: boulder\n",
                encoding="utf-8",
            )

            # Missing label file -> DatasetUnavailableError
            with self.assertRaises(DatasetUnavailableError):
                validate_prepared_dataset(data_yaml)

            # Invalid normalized coordinates -> DatasetUnavailableError
            lbl_file = train_lbls / "tile_01.txt"
            lbl_file.write_text("0 1.5 0.5 0.2 0.2\n", encoding="utf-8")
            with self.assertRaises(DatasetUnavailableError):
                validate_prepared_dataset(data_yaml)

            # Valid YOLO label -> passes dataset validation and prepare_training_plan
            lbl_file.write_text("0 0.5 0.5 0.1 0.1\n", encoding="utf-8")
            summary = validate_prepared_dataset(data_yaml)
            self.assertEqual(summary.train_images, 1)
            self.assertEqual(summary.train_labels, 1)
            self.assertEqual(summary.class_names, {0: "boulder"})

            plan = prepare_training_plan(TrainConfig(dataset_path=root))
            self.assertEqual(plan.dataset.train_labels, 1)


class SlicedInferenceAndMergingTests(unittest.TestCase):
    def test_generate_tile_windows_covers_full_image_with_overlap(self) -> None:
        windows = generate_tile_windows(180, 100, (100, 100), overlap_ratio=0.2)
        self.assertEqual(len(windows), 2)
        self.assertEqual((windows[0].x0, windows[0].x1), (0, 100))
        self.assertEqual((windows[1].x0, windows[1].x1), (80, 180))

        windows_25 = generate_tile_windows(180, 100, (100, 100), overlap_ratio=0.25)
        self.assertEqual(len(windows_25), 3)
        self.assertEqual((windows_25[-1].x0, windows_25[-1].x1), (80, 180))

    def test_sliced_inference_merges_overlap_duplicates_and_connects_to_geo_and_risk(self) -> None:
        # True boulder at global [84, 40, 96, 52] sits inside overlap x in [80, 100].
        seen_tiles = []

        def fake_tile_predictor(tile_rgb, cfg):
            tile_idx = len(seen_tiles)
            seen_tiles.append(tile_rgb.shape)
            if tile_idx == 0:
                # Tile 0 spans x=[0, 100] -> global [84,40,96,52] is local [84,40,96,52].
                # Also emit a low-confidence noise box below cutoff.
                return [
                    {"bbox_px": [84.0, 40.0, 96.0, 52.0], "confidence": 0.92},
                    {"bbox_px": [10.0, 10.0, 14.0, 14.0], "confidence": 0.10},
                ]
            # Tile 1 spans x=[80, 180] -> global [84,40,96,52] is local [4,40,16,52] (slightly shifted).
            return [
                {"bbox_px": [4.5, 40.0, 16.5, 52.0], "confidence": 0.85},
                {"bbox_px": [60.0, 20.0, 68.0, 28.0], "confidence": 0.78},  # global [140,20,148,28]
            ]

        with tempfile.TemporaryDirectory() as tmp:
            img_path = Path(tmp) / "strip_16bit.tif"
            img = Image.new("I;16", (180, 100))
            img.putpixel((10, 10), 50000)
            img.save(img_path)

            cfg = DetectorConfig(
                model_version="yolov8n-lunar-test",
                image_size=128,
                confidence_threshold=0.5,
                tile_size=(100, 100),
                tile_overlap_ratio=0.2,
                merge_iou_threshold=0.5,
                merge_strategy="nms",
            )
            detector = BoulderDetector(cfg, tile_predictor=fake_tile_predictor)
            detections = detector.detect(img_path, image_id="nac_strip_01")

        self.assertEqual(len(seen_tiles), 2)
        self.assertEqual(seen_tiles[0], (100, 100, 3))
        self.assertEqual(len(detections), 2)  # Overlap duplicate merged; low-conf box filtered!

        first = detections[0]
        self.assertEqual(first["image_id"], "nac_strip_01")
        self.assertEqual(first["model_version"], "yolov8n-lunar-test")
        self.assertEqual(first["bbox_px"], [84.0, 40.0, 96.0, 52.0])
        self.assertAlmostEqual(first["confidence"], 0.92)
        # Size and position explicitly left unset for moonsafe.geo.
        self.assertIsNone(first["estimated_size_m"])
        self.assertIsNone(first["size_uncertainty_m"])
        self.assertIsNone(first["position"])

        # End-to-end handoff: ml.detector -> moonsafe.geo -> moonsafe.risk
        meta = {
            "image_id": "nac_strip_01",
            "source_image_id": "M1234567890L",
            "width_px": 180,
            "height_px": 100,
            "gsd_x_m_per_px": 0.5,
            "gsd_y_m_per_px": 0.5,
            "coverage": "valid",
            "coordinate_frame": "image_px",
            "image_to_lunar": None,
        }
        geo_dets = process_detections(meta, detections)
        self.assertAlmostEqual(geo_dets[0]["estimated_size_m"], 6.0)
        self.assertEqual(geo_dets[0]["position"]["frame"], "image_px")

        grid = compute_risk_grid(meta, geo_dets, threshold_profile="lander")
        self.assertTrue(grid["screening_only"])
        self.assertEqual(grid["summary"]["total_boulders"], 2)

    def test_wbf_merge_strategy_averages_overlapping_boxes(self) -> None:
        merged = merge_tile_detections(
            [
                {"bbox_px": [10.0, 10.0, 20.0, 20.0], "confidence": 0.8},
                {"bbox_px": [12.0, 10.0, 22.0, 20.0], "confidence": 0.4},
            ],
            iou_threshold=0.5,
            strategy="wbf",
        )
        self.assertEqual(len(merged), 1)
        self.assertAlmostEqual(merged[0]["confidence"], 0.8)
        self.assertAlmostEqual(merged[0]["bbox_px"][0], (10.0 * 0.8 + 12.0 * 0.4) / 1.2, places=3)


if __name__ == "__main__":
    unittest.main()
