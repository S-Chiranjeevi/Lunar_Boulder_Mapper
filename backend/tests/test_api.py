"""End-to-end API tests for MoonSafe FastAPI routes."""

from __future__ import annotations

import io
import json
import tempfile
import time
import unittest
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from moonsafe.api.app import create_app
from moonsafe.detect import DetectorResult
from moonsafe.schemas import Detection, DetectionPosition, ImageMetadata


class _CountingFakeDetector:
    def __init__(self) -> None:
        self.calls = 0

    def detect(
        self,
        image_path: str | Path,
        metadata: ImageMetadata,
        *,
        confidence_threshold: float = 0.25,
        weights_path: str | Path | None = None,
    ) -> DetectorResult:
        self.calls += 1
        det = Detection(
            detection_id=f"{metadata.image_id}_det_0001",
            image_id=metadata.image_id,
            bbox_px=[10.0, 10.0, 14.0, 14.0],
            confidence=0.91,
            model_version="test-stub-only",
            estimated_size_m=0.75 if metadata.gsd_x_m_per_px else None,
            size_uncertainty_m=None,
            position=DetectionPosition(x=12.0, y=12.0, frame="image_px", uncertainty_m=None),
        )
        return DetectorResult(
            detections=[det] if det.confidence >= confidence_threshold else [],
            model_executed=True,
            model_status="executed",
            model_version="test-stub-only",
            status_message="Test stub executed.",
        )


def _png_bytes(width: int = 100, height: int = 100) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.full((height, width), 140, dtype=np.uint8), mode="L").save(buf, format="PNG")
    return buf.getvalue()


class ApiRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _wait_for_job(self, client: TestClient, job_id: str) -> dict:
        deadline = time.time() + 5.0
        while time.time() < deadline:
            resp = client.get(f"/api/v1/jobs/{job_id}")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            if body["status"] in {"completed", "failed"}:
                return body
            time.sleep(0.05)
        self.fail(f"Job {job_id} did not finish within timeout")

    def test_upload_list_preview_and_unconfigured_job_flow(self) -> None:
        app = create_app(data_dir=self.data_dir)
        with TestClient(app) as client:
            manifest = {
                "image_id": "nac_test_01",
                "source_image_id": "M1234567L",
                "gsd_x_m_per_px": 0.5,
                "gsd_y_m_per_px": 0.5,
                "coverage": "valid",
                "coordinate_frame": "image_px",
                "image_to_lunar": None,
            }
            upload = client.post(
                "/api/v1/images",
                files={
                    "file": ("nac.png", _png_bytes(100, 100), "image/png"),
                    "manifest": ("nac.png.json", json.dumps(manifest).encode(), "application/json"),
                },
            )
            self.assertEqual(upload.status_code, 201)
            up_body = upload.json()
            self.assertEqual(up_body["image_id"], "nac_test_01")
            self.assertEqual(up_body["metadata"]["width_px"], 100)
            self.assertFalse(up_body["has_elevation_data"])

            listing = client.get("/api/v1/images")
            self.assertEqual(listing.status_code, 200)
            self.assertEqual(len(listing.json()["images"]), 1)

            preview = client.get("/api/v1/images/nac_test_01/preview")
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview.headers["content-type"], "image/png")

            job_resp = client.post(
                "/api/v1/jobs",
                json={"image_id": "nac_test_01", "threshold_profile": "lander"},
            )
            self.assertEqual(job_resp.status_code, 202)
            job_id = job_resp.json()["job_id"]

            status_body = self._wait_for_job(client, job_id)
            self.assertEqual(status_body["status"], "completed")
            self.assertEqual(status_body["model_status"], "unconfigured")

            results = client.get(f"/api/v1/jobs/{job_id}/results")
            self.assertEqual(results.status_code, 200)
            res_body = results.json()
            self.assertEqual(res_body["detections"], [])
            self.assertTrue(res_body["risk_grid"]["screening_only"])
            self.assertEqual(res_body["risk_grid"]["cells"][0]["class"], "uncertain")

    def test_patch_thresholds_recalculates_without_rerunning_detection(self) -> None:
        fake_detector = _CountingFakeDetector()
        app = create_app(data_dir=self.data_dir, detector=fake_detector)  # type: ignore[arg-type]
        with TestClient(app) as client:
            upload = client.post(
                "/api/v1/images",
                files={"file": ("nac.png", _png_bytes(100, 100), "image/png")},
                data={"gsd_x_m_per_px": "0.5", "gsd_y_m_per_px": "0.5", "coverage": "valid"},
            )
            self.assertEqual(upload.status_code, 201)
            image_id = upload.json()["image_id"]

            job_resp = client.post(
                "/api/v1/jobs",
                json={"image_id": image_id, "threshold_profile": "lander"},
            )
            job_id = job_resp.json()["job_id"]
            self._wait_for_job(client, job_id)
            self.assertEqual(fake_detector.calls, 1)

            res_before = client.get(f"/api/v1/jobs/{job_id}/results").json()
            cell0_before = next(c for c in res_before["risk_grid"]["cells"] if c["cell_id"] == "r000_c000")
            self.assertEqual(cell0_before["class"], "caution")  # 0.75m >= 0.5m caution, < 1.0m unsafe

            patch_resp = client.patch(
                f"/api/v1/jobs/{job_id}/thresholds",
                json={"threshold_profile": "rover"},
            )
            self.assertEqual(patch_resp.status_code, 200)
            patch_body = patch_resp.json()
            self.assertFalse(patch_body["rerun_detection"])
            self.assertEqual(fake_detector.calls, 1)  # Detection was NOT rerun!
            cell0_after = next(c for c in patch_body["risk_grid"]["cells"] if c["cell_id"] == "r000_c000")
            self.assertEqual(cell0_after["class"], "unsafe")  # 0.75m >= 0.6m rover unsafe


if __name__ == "__main__":
    unittest.main()
