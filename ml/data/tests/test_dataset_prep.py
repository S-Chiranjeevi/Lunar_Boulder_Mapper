from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ml.data.bickel_policy import filter_curated_records, is_bickel_rockfall_record
from ml.data.bouldering import classify_observation_origin, load_bouldering_lunar_tiles
from ml.data.label_studio import load_label_studio_export
from ml.data.prepare_dataset import prepare_yolo_dataset
from ml.data.schema import CuratedBox, TileRecord
from ml.data.split import assign_group_splits, verify_no_group_leakage


def _make_dummy_png(path: Path, width: int = 200, height: int = 100) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("L", (width, height), color=128).save(path)


class TestBoulderingEvaluationAndConversion(unittest.TestCase):
    def test_observation_classification_filters_planets(self) -> None:
        lunar = classify_observation_origin("M121118602_00875_image.png")
        self.assertTrue(lunar.is_lunar)
        self.assertEqual(lunar.source_observation_id, "M121118602")
        self.assertEqual(lunar.origin, "lunar_lroc_nac")

        mars = classify_observation_origin("ESP_045678_1900_001_image.png")
        self.assertFalse(mars.is_lunar)
        self.assertEqual(mars.origin, "mars_excluded")

        earth = classify_observation_origin("field_site_alpha_01_image.png")
        self.assertFalse(earth.is_lunar)
        self.assertEqual(earth.origin, "unverified_excluded")

        allowlisted = classify_observation_origin(
            "apollo17_extra_01_image.png",
            lunar_allowlist={"apollo17"},
        )
        self.assertTrue(allowlisted.is_lunar)
        self.assertEqual(allowlisted.origin, "lunar_allowlisted")

    def test_bouldering_polygon_conversion_and_upstream_leakage_detection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "boulder2024"
            # Two tiles from the same lunar observation M121118602 split across train and val upstream
            t1_img = root / "train" / "images" / "M121118602_0001_image.png"
            t1_lbl = root / "train" / "labels" / "M121118602_0001_image.txt"
            _make_dummy_png(t1_img, 200, 100)
            t1_lbl.parent.mkdir(parents=True, exist_ok=True)
            # Polygon covering x=[0.1, 0.3], y=[0.2, 0.6]
            t1_lbl.write_text("0 0.1 0.2 0.3 0.2 0.3 0.6 0.1 0.6\n", encoding="utf-8")

            t2_img = root / "validation" / "images" / "M121118602_0002_image.png"
            t2_lbl = root / "validation" / "labels" / "M121118602_0002_image.txt"
            _make_dummy_png(t2_img, 200, 100)
            t2_lbl.parent.mkdir(parents=True, exist_ok=True)
            t2_lbl.write_text("0 0.5 0.5 0.2 0.4\n", encoding="utf-8")

            # Mars tile that must be excluded
            mars_img = root / "train" / "images" / "ESP_012345_1800_001_image.png"
            _make_dummy_png(mars_img, 200, 100)

            tiles, excluded, report = load_bouldering_lunar_tiles(root)
            self.assertEqual(len(tiles), 2)
            self.assertEqual(len(excluded), 1)
            self.assertEqual(excluded[0].reason_code, "MARS_EXCLUDED")
            self.assertTrue(report["upstream_leakage_detected"])
            self.assertEqual(report["upstream_cross_split_observations"], ["M121118602"])
            self.assertEqual(report["label_geometry_stats"]["polygon_rows"], 1)
            self.assertEqual(report["label_geometry_stats"]["box_rows"], 1)

            poly_box = tiles[0].boxes[0]
            self.assertEqual(poly_box.source_format, "yolo_polygon")
            self.assertAlmostEqual(poly_box.x_min_px, 20.0)
            self.assertAlmostEqual(poly_box.y_min_px, 20.0)
            self.assertAlmostEqual(poly_box.x_max_px, 60.0)
            self.assertAlmostEqual(poly_box.y_max_px, 60.0)


class TestLabelStudioAndBickelPolicy(unittest.TestCase):
    def test_label_studio_conversion_and_rotated_rejection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            img_path = tmp_path / "M130000001_tile01.png"
            _make_dummy_png(img_path, 400, 200)

            export_path = tmp_path / "export.json"
            export_path.write_text(
                json.dumps(
                    [
                        {
                            "id": 101,
                            "data": {
                                "image": "M130000001_tile01.png",
                                "image_id": "M130000001_tile01",
                                "source_observation_id": "M130000001L",
                                "site_id": "aristarchus_north",
                                "gsd_x_m_per_px": 0.5,
                                "gsd_y_m_per_px": 0.5,
                                "license": "CC-BY-4.0",
                            },
                            "annotations": [
                                {
                                    "id": 501,
                                    "result": [
                                        {
                                            "type": "rectanglelabels",
                                            "original_width": 400,
                                            "original_height": 200,
                                            "value": {
                                                "x": 25.0,
                                                "y": 50.0,
                                                "width": 10.0,
                                                "height": 20.0,
                                                "rotation": 0,
                                                "rectanglelabels": ["boulder"],
                                            },
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                ),
                encoding="utf-8",
            )

            records = load_label_studio_export(export_path, images_dir=tmp_path)
            self.assertEqual(len(records), 1)
            rec = records[0]
            self.assertEqual(rec.site_id, "aristarchus_north")
            self.assertEqual(rec.gsd_x_m_per_px, 0.5)
            self.assertEqual(len(rec.boxes), 1)
            cls_id, xc, yc, w, h = rec.boxes[0].to_yolo_normalized(400, 200)
            self.assertEqual(cls_id, 0)
            self.assertAlmostEqual(xc, 0.30)
            self.assertAlmostEqual(yc, 0.60)
            self.assertAlmostEqual(w, 0.10)
            self.assertAlmostEqual(h, 0.20)

            bad_export = tmp_path / "rotated.json"
            bad_export.write_text(
                json.dumps(
                    [
                        {
                            "id": 102,
                            "data": {"image_id": "rot_tile", "width_px": 100, "height_px": 100},
                            "annotations": [
                                {
                                    "id": 502,
                                    "result": [
                                        {
                                            "type": "rectanglelabels",
                                            "value": {
                                                "x": 10,
                                                "y": 10,
                                                "width": 20,
                                                "height": 20,
                                                "rotation": 15,
                                                "rectanglelabels": ["boulder"],
                                            },
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                load_label_studio_export(bad_export)

    def test_bickel_rockfall_policy_excludes_unless_reviewed_and_enabled(self) -> None:
        bickel_unreviewed = TileRecord(
            image_id="bickel_01",
            source_observation_id="M140000001L",
            site_id="mare_site_1",
            image_path=None,
            width_px=256,
            height_px=256,
            label_source="Bickel et al. Rockfall Tracks",
            license="CC-BY-4.0",
            task_type="rockfall",
            reviewed_for_standalone_boulder=False,
            boxes=[CuratedBox(10, 10, 20, 20)],
        )
        bickel_relabeled = TileRecord(
            image_id="bickel_02_relabeled",
            source_observation_id="M140000002L",
            site_id="mare_site_2",
            image_path=None,
            width_px=256,
            height_px=256,
            label_source="Bickel imagery (relabeled standalone boulders)",
            license="CC-BY-4.0",
            task_type="standalone_boulder",
            reviewed_for_standalone_boulder=True,
            boxes=[CuratedBox(10, 10, 20, 20, source_format="manual_relabeled")],
        )

        self.assertTrue(is_bickel_rockfall_record(bickel_unreviewed))
        self.assertTrue(is_bickel_rockfall_record(bickel_relabeled))

        accepted_default, excluded_default = filter_curated_records(
            [bickel_unreviewed, bickel_relabeled],
            include_reviewed_bickel=False,
        )
        self.assertEqual(len(accepted_default), 0)
        self.assertEqual(len(excluded_default), 2)
        self.assertEqual(excluded_default[0].reason_code, "BICKEL_ROCKFALL_DIFFERENT_TASK")

        accepted_reviewed, excluded_reviewed = filter_curated_records(
            [bickel_unreviewed, bickel_relabeled],
            include_reviewed_bickel=True,
        )
        self.assertEqual([r.image_id for r in accepted_reviewed], ["bickel_02_relabeled"])
        self.assertEqual([e.image_id for e in excluded_reviewed], ["bickel_01"])


class TestLeakageFreeSplittingAndPipeline(unittest.TestCase):
    def test_group_split_keeps_same_observation_and_site_together(self) -> None:
        records = [
            TileRecord(
                image_id=f"obs_{obs}_tile_{tile}",
                source_observation_id=f"M10000000{obs}",
                site_id=f"site_{obs // 2}",
                image_path=None,
                width_px=256,
                height_px=256,
                label_source="curated",
                license="CC-BY-4.0",
                boxes=[CuratedBox(20, 20, 40, 40)],
            )
            for obs in range(8)
            for tile in range(3)
        ]

        splits = assign_group_splits(records, train_ratio=0.7, val_ratio=0.15, test_ratio=0.15, seed=7)
        verify_no_group_leakage(splits)
        self.assertEqual(sum(len(v) for v in splits.values()), 24)
        self.assertGreater(len(splits["train"]), 0)
        self.assertGreater(len(splits["val"]), 0)
        self.assertGreater(len(splits["test"]), 0)

    def test_end_to_end_prepare_yolo_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            boulder_dir = root / "bouldering" / "boulder2024"
            for obs_idx, obs_id in enumerate(("M111111111", "M222222222", "M333333333", "M444444444")):
                for tile_idx in range(2):
                    img = boulder_dir / ("train" if obs_idx < 3 else "test") / "images" / f"{obs_id}_00{tile_idx}_image.png"
                    lbl = boulder_dir / ("train" if obs_idx < 3 else "test") / "labels" / f"{obs_id}_00{tile_idx}_image.txt"
                    _make_dummy_png(img, 200, 200)
                    lbl.parent.mkdir(parents=True, exist_ok=True)
                    lbl.write_text("0 0.2 0.2 0.4 0.2 0.4 0.4 0.2 0.4\n", encoding="utf-8")

            # Add an excluded Bickel rockfall record via extra_records
            bickel_tile = TileRecord(
                image_id="bickel_rockfall_sample",
                source_observation_id="M999999999L",
                site_id="bickel_track_site",
                image_path=None,
                width_px=200,
                height_px=200,
                label_source="Bickel rockfall inventory",
                license="CC-BY-4.0",
                task_type="rockfall",
                reviewed_for_standalone_boulder=False,
                boxes=[CuratedBox(10, 10, 30, 30)],
            )

            out_dir = root / "yolo_out"
            summary = prepare_yolo_dataset(
                output_dir=out_dir,
                bouldering_dir=boulder_dir,
                copy_images=True,
                extra_records=[bickel_tile],
            )

            self.assertEqual(summary["total_accepted_tiles"], 8)
            self.assertEqual(summary["total_excluded_tiles"], 1)
            self.assertEqual(summary["total_boxes"], 8)
            self.assertTrue(summary["zero_group_leakage_verified"])
            self.assertFalse(summary["model_trained"])
            self.assertTrue((out_dir / "dataset.yaml").is_file())
            self.assertTrue((out_dir / "provenance_manifest.jsonl").is_file())
            self.assertTrue((out_dir / "excluded_manifest.jsonl").is_file())
            self.assertTrue((out_dir / "split_summary.json").is_file())

            manifest_lines = [
                json.loads(line)
                for line in (out_dir / "provenance_manifest.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(len(manifest_lines), 8)
            for row in manifest_lines:
                self.assertEqual(row["label_units"], "normalized_xywh")
                self.assertEqual(row["license"], "CC-BY-4.0")
                self.assertTrue((out_dir / row["label_rel"]).is_file())
                self.assertTrue((out_dir / row["copied_image_rel"]).is_file())


if __name__ == "__main__":
    unittest.main()
