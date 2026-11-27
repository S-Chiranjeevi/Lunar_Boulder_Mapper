"""Unit and API-integration tests for moonsafe.risk."""

from __future__ import annotations

import io
import json
import math
import sys
import tempfile
import time
import unittest
from pathlib import Path

from PIL import Image

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from moonsafe.geo import process_detections  # noqa: E402
from moonsafe.risk import (  # noqa: E402
    ILLUSTRATIVE_PROFILES,
    RiskConfig,
    RiskGridError,
    compute_risk_grid,
)


def _lunar_metadata(**overrides):
    data = {
        "image_id": "nac_risk_001",
        "source_image_id": "M1234567890L",
        "width_px": 40,
        "height_px": 40,
        "gsd_x_m_per_px": 0.5,
        "gsd_y_m_per_px": 0.5,
        "coverage": "valid",
        "coordinate_frame": "lunar_local_m",
        "image_to_lunar": {
            "type": "affine_2d",
            "units": "m",
            "matrix": [[0.5, 0.0, 0.0], [0.0, 0.5, 0.0], [0.0, 0.0, 1.0]],
            "uncertainty_m": 2.0,
        },
    }
    data.update(overrides)
    return data


def _det(det_id: str, x: float, y: float, size_m: float | None, **extra):
    payload = {
        "detection_id": det_id,
        "image_id": "nac_risk_001",
        "bbox_px": [0.0, 0.0, 2.0, 2.0],
        "confidence": 0.9,
        "model_version": "test-v0",
        "estimated_size_m": size_m,
        "size_uncertainty_m": 0.1 if size_m is not None else None,
        "position": {
            "x": x,
            "y": y,
            "frame": "lunar_local_m",
            "uncertainty_m": 2.0,
            "uncertain": False,
        },
    }
    payload.update(extra)
    return payload


class RiskScoringTests(unittest.TestCase):
    def test_illustrative_profiles_are_labeled_non_certified(self) -> None:
        self.assertFalse(ILLUSTRATIVE_PROFILES["lander"]["validated"])
        self.assertTrue(ILLUSTRATIVE_PROFILES["lander"]["illustrative_default"])

        grid = compute_risk_grid(_lunar_metadata(), [], threshold_profile="lander")
        self.assertTrue(grid["screening_only"])
        self.assertIn("not mission-certified", grid["disclaimer"].lower())
        self.assertEqual(grid["coordinate_frame"], "lunar_local_m")
        self.assertEqual(grid["cell_size_m"], 10.0)
        self.assertEqual(len(grid["cells"]), 4)  # 20m x 20m covered by 10m cells -> 2x2
        self.assertTrue(all(c["class"] == "safe" for c in grid["cells"]))

    def test_size_and_density_conflict_resolution_policies(self) -> None:
        meta = _lunar_metadata()
        # Cell (0,0) -> [0,10]x[0,10]: 1 large boulder (1.4m => unsafe size, caution count=1).
        # Cell (1,0) -> [10,20]x[0,10]: 3 small boulders (0.4m => safe size, unsafe count=3).
        detections = [
            _det("big_1", 5.0, 5.0, 1.4),
            _det("small_1", 12.0, 5.0, 0.4),
            _det("small_2", 14.0, 5.0, 0.4),
            _det("small_3", 16.0, 5.0, 0.4),
        ]

        worst = compute_risk_grid(meta, detections, threshold_profile="lander", config=RiskConfig(conflict_policy="worst_case"))
        by_id = {c["cell_id"]: c for c in worst["cells"]}
        self.assertEqual(by_id["cell_0_0"]["class"], "unsafe")
        self.assertEqual(by_id["cell_0_0"]["size_risk"], "unsafe")
        self.assertEqual(by_id["cell_0_0"]["density_risk"], "caution")
        self.assertIn("size_and_density_disagree_worst_case_wins", by_id["cell_0_0"]["reason_codes"])

        self.assertEqual(by_id["cell_1_0"]["class"], "unsafe")
        self.assertEqual(by_id["cell_1_0"]["size_risk"], "safe")
        self.assertEqual(by_id["cell_1_0"]["density_risk"], "unsafe")
        self.assertIn("size_and_density_disagree_worst_case_wins", by_id["cell_1_0"]["reason_codes"])

        size_wins = compute_risk_grid(
            meta, detections, threshold_profile="lander", config=RiskConfig(conflict_policy="size_priority")
        )
        size_by_id = {c["cell_id"]: c for c in size_wins["cells"]}
        self.assertEqual(size_by_id["cell_1_0"]["class"], "safe")
        self.assertIn("size_and_density_disagree_size_wins", size_by_id["cell_1_0"]["reason_codes"])

        density_wins = compute_risk_grid(
            meta, detections, threshold_profile="lander", config=RiskConfig(conflict_policy="density_priority")
        )
        dens_by_id = {c["cell_id"]: c for c in density_wins["cells"]}
        self.assertEqual(dens_by_id["cell_0_0"]["class"], "caution")
        self.assertIn("size_and_density_disagree_density_wins", dens_by_id["cell_0_0"]["reason_codes"])

    def test_uncertain_on_missing_or_partial_coverage_and_low_cell_overlap(self) -> None:
        # Missing coverage -> all cells uncertain.
        missing_grid = compute_risk_grid(_lunar_metadata(coverage="missing"), [])
        self.assertTrue(all(c["class"] == "uncertain" for c in missing_grid["cells"]))
        self.assertIn("missing_image_coverage", missing_grid["cells"][0]["reason_codes"])

        # Partial image coverage without mask -> uncertain.
        partial_grid = compute_risk_grid(_lunar_metadata(coverage="partial"), [])
        self.assertTrue(all(c["class"] == "uncertain" for c in partial_grid["cells"]))
        self.assertIn("partial_image_coverage", partial_grid["cells"][0]["reason_codes"])

        # Boundary geometric partial cell overlap (< min_valid_coverage 0.8):
        # 30 px * 0.5 m/px = 15m width -> cell_1_0 ([10,20]x[0,10]) has 0.5 coverage!
        boundary_grid = compute_risk_grid(_lunar_metadata(width_px=30, height_px=20), [])
        by_id = {c["cell_id"]: c for c in boundary_grid["cells"]}
        self.assertAlmostEqual(by_id["cell_0_0"]["coverage"], 1.0)
        self.assertEqual(by_id["cell_0_0"]["class"], "safe")
        self.assertAlmostEqual(by_id["cell_1_0"]["coverage"], 0.5)
        self.assertEqual(by_id["cell_1_0"]["class"], "uncertain")
        self.assertIn("insufficient_cell_coverage", by_id["cell_1_0"]["reason_codes"])

    def test_uncertain_when_resolution_cannot_resolve_threshold_or_detection_too_uncertain(self) -> None:
        # Coarse 2.0 m/px image cannot resolve 0.5m/1.0m lander thresholds.
        coarse_meta = _lunar_metadata(
            width_px=20,
            height_px=20,
            gsd_x_m_per_px=2.0,
            gsd_y_m_per_px=2.0,
            image_to_lunar={
                "type": "affine_2d",
                "units": "m",
                "matrix": [[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 1.0]],
            },
        )
        coarse_grid = compute_risk_grid(coarse_meta, [], threshold_profile="lander")
        self.assertTrue(all(c["class"] == "uncertain" for c in coarse_grid["cells"]))
        self.assertIn("image_resolution_cannot_resolve_unsafe_threshold", coarse_grid["cells"][0]["reason_codes"])

        # High position or size uncertainty marks only the affected cell uncertain.
        meta = _lunar_metadata()
        uncertain_det = _det("unc_1", 5.0, 5.0, 0.4, size_uncertainty_m=0.8)
        uncertain_pos = _det(
            "unc_2",
            15.0,
            5.0,
            0.4,
            position={"x": 15.0, "y": 5.0, "frame": "lunar_local_m", "uncertainty_m": 25.0, "uncertain": False},
        )
        grid = compute_risk_grid(
            meta,
            [uncertain_det, uncertain_pos],
            threshold_profile="lander",
            config=RiskConfig(max_size_uncertainty_m=0.5, max_position_uncertainty_m=10.0),
        )
        by_id = {c["cell_id"]: c for c in grid["cells"]}
        self.assertEqual(by_id["cell_0_0"]["class"], "uncertain")
        self.assertIn("boulder_size_uncertainty_too_high", by_id["cell_0_0"]["reason_codes"])
        self.assertEqual(by_id["cell_1_0"]["class"], "uncertain")
        self.assertIn("position_uncertainty_too_high", by_id["cell_1_0"]["reason_codes"])
        self.assertEqual(by_id["cell_0_1"]["class"], "safe")

    def test_image_px_fallback_and_missing_gsd_uncertain(self) -> None:
        px_meta = {
            "image_id": "nac_px_only",
            "width_px": 40,
            "height_px": 40,
            "gsd_x_m_per_px": 0.5,
            "gsd_y_m_per_px": 0.5,
            "coverage": "valid",
            "coordinate_frame": "image_px",
            "image_to_lunar": None,
        }
        geo_dets = process_detections(
            px_meta,
            [
                {
                    "detection_id": "d1",
                    "bbox_px": [4.0, 4.0, 8.0, 8.0],  # 2.0m boulder at (6, 6) px
                    "confidence": 0.88,
                    "model_version": "yolo-test",
                }
            ],
        )
        grid = compute_risk_grid(px_meta, geo_dets, threshold_profile="lander")
        self.assertEqual(grid["coordinate_frame"], "image_px")
        self.assertEqual(grid["cell_size_px"], [20.0, 20.0])
        by_id = {c["cell_id"]: c for c in grid["cells"]}
        self.assertEqual(by_id["cell_0_0"]["class"], "unsafe")
        self.assertIn("unreferenced_image_px_frame", by_id["cell_0_0"]["reason_codes"])

        # Missing GSD -> uncertain everywhere.
        no_gsd_meta = {**px_meta, "gsd_x_m_per_px": None, "gsd_y_m_per_px": None}
        no_gsd_grid = compute_risk_grid(no_gsd_meta, [], threshold_profile="lander")
        self.assertTrue(all(c["class"] == "uncertain" for c in no_gsd_grid["cells"]))
        self.assertIn("missing_gsd_cannot_resolve_size", no_gsd_grid["cells"][0]["reason_codes"])

    def test_invalid_threshold_config_raises(self) -> None:
        with self.assertRaises(RiskGridError):
            compute_risk_grid(
                _lunar_metadata(),
                [],
                overrides={"caution_boulder_size_m": 2.0, "unsafe_boulder_size_m": 1.0},
            )

    def test_api_default_risk_adapter_discovers_moonsafe_risk(self) -> None:
        from fastapi.testclient import TestClient
        from moonsafe.api import create_app

        class _StubDet:
            def check_available(self) -> None:
                return None

            def detect(self, image_path, image_metadata, *, options=None):
                return [
                    {
                        "detection_id": "d1",
                        "bbox_px": [2.0, 2.0, 6.0, 6.0],  # 2.0m
                        "confidence": 0.9,
                        "model_version": "stub",
                    }
                ]

        buf = io.BytesIO()
        Image.new("L", (40, 40), color=100).save(buf, format="PNG")

        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(data_dir=tmp, detector=_StubDet())
            with TestClient(app) as client:
                meta = _lunar_metadata()
                client.post(
                    "/api/images",
                    files={"file": ("nac.png", buf.getvalue(), "image/png")},
                    data={"metadata_json": json.dumps(meta)},
                )
                job = client.post("/api/jobs", json={"image_id": "nac_risk_001"}).json()
                for _ in range(100):
                    st = client.get(f"/api/jobs/{job['job_id']}").json()
                    if st["status"] == "completed":
                        break
                    time.sleep(0.02)
                results = client.get(f"/api/jobs/{job['job_id']}/results").json()
                self.assertEqual(results["risk_grid"]["summary"]["class_counts"]["unsafe"], 1)

                patched = client.patch(
                    f"/api/jobs/{job['job_id']}/thresholds",
                    json={
                        "threshold_profile": "custom",
                        "thresholds": {"caution_boulder_size_m": 3.0, "unsafe_boulder_size_m": 5.0},
                    },
                ).json()
                self.assertEqual(patched["risk_grid"]["summary"]["class_counts"]["unsafe"], 0)
                self.assertEqual(patched["risk_grid"]["summary"]["class_counts"]["caution"], 1)
                self.assertEqual(patched["risk_grid"]["summary"]["class_counts"]["safe"], 3)


if __name__ == "__main__":
    unittest.main()
