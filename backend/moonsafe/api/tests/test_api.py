"""End-to-end API tests for moonsafe.api routes, background jobs, and error handling."""

from __future__ import annotations

import io
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Mapping, Sequence

from fastapi.testclient import TestClient
from PIL import Image

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from moonsafe.api import create_app  # noqa: E402


def _make_png_bytes(width: int = 64, height: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (width, height), color=128).save(buf, format="PNG")
    return buf.getvalue()


def _make_16bit_tiff_bytes(width: int = 64, height: int = 64) -> bytes:
    buf = io.BytesIO()
    img = Image.new("I;16", (width, height))
    img.putpixel((0, 0), 100)
    img.putpixel((1, 1), 60000)
    img.save(buf, format="TIFF")
    return buf.getvalue()


class StubDetector:
    def __init__(self, detections: Sequence[Mapping[str, Any]], delay_s: float = 0.0) -> None:
        self._detections = list(detections)
        self._delay_s = delay_s
        self.call_count = 0

    def check_available(self) -> None:
        return None

    def detect(
        self,
        image_path: Path,
        image_metadata: Mapping[str, Any],
        *,
        options: Mapping[str, Any] | None = None,
    ) -> Sequence[Mapping[str, Any]]:
        self.call_count += 1
        if self._delay_s > 0:
            time.sleep(self._delay_s)
        return self._detections


class StubRiskGrid:
    def __init__(self) -> None:
        self.call_count = 0

    def compute_risk_grid(
        self,
        image_metadata: Mapping[str, Any],
        detections: Sequence[Mapping[str, Any]],
        *,
        threshold_config: Mapping[str, Any],
    ) -> dict[str, Any]:
        self.call_count += 1
        caution_size = threshold_config["caution_boulder_size_m"]
        unsafe_size = threshold_config["unsafe_boulder_size_m"]
        max_size = max((d["estimated_size_m"] or 0.0 for d in detections), default=0.0)
        if max_size >= unsafe_size:
            cell_class = "unsafe"
        elif max_size >= caution_size:
            cell_class = "caution"
        else:
            cell_class = "safe"
        return {
            "image_id": image_metadata["image_id"],
            "cell_size_m": threshold_config["cell_size_m"],
            "coordinate_frame": detections[0]["position"]["frame"] if detections else image_metadata["coordinate_frame"],
            "threshold_profile": threshold_config["threshold_profile"],
            "cells": [
                {
                    "cell_id": "cell_0_0",
                    "x": 0,
                    "y": 0,
                    "class": cell_class,
                    "boulder_count": len(detections),
                    "max_size_m": max_size if detections else None,
                    "coverage": 1.0,
                    "reason_codes": [],
                }
            ],
            "screening_only": True,
        }


def _poll_until_done(client: TestClient, job_id: str, timeout_s: float = 3.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        resp = client.get(f"/api/jobs/{job_id}")
        assert resp.status_code == 200
        payload = resp.json()
        if payload["status"] in {"completed", "failed"}:
            return payload
        time.sleep(0.02)
    raise AssertionError(f"Job {job_id} did not finish within {timeout_s}s")


class MoonSafeAPITests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.data_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_image_upload_list_get_and_16bit_preview(self) -> None:
        app = create_app(data_dir=self.data_dir, check_detector_on_submit=False)
        with TestClient(app) as client:
            manifest = {
                "image_id": "nac_tiff_01",
                "source_image_id": "M1234567890L",
                "gsd_x_m_per_px": 0.5,
                "gsd_y_m_per_px": 0.5,
                "coverage": "valid",
                "coordinate_frame": "image_px",
                "image_to_lunar": None,
            }
            resp = client.post(
                "/api/images",
                files={
                    "file": ("scene.tif", _make_16bit_tiff_bytes(80, 60), "image/tiff"),
                    "manifest": ("scene.tif.json", json.dumps(manifest).encode("utf-8"), "application/json"),
                },
            )
            self.assertEqual(resp.status_code, 201)
            body = resp.json()
            self.assertEqual(body["image_id"], "nac_tiff_01")
            self.assertEqual(body["width_px"], 80)
            self.assertEqual(body["height_px"], 60)
            self.assertEqual(body["dimensions_units"], "px")
            self.assertEqual(body["gsd_units"], "m/px")
            self.assertFalse(body["georeferencing_available"])

            list_resp = client.get("/api/images")
            self.assertEqual(list_resp.status_code, 200)
            self.assertEqual(list_resp.json()["count"], 1)

            get_resp = client.get("/api/images/nac_tiff_01")
            self.assertEqual(get_resp.status_code, 200)
            self.assertEqual(get_resp.json()["source_image_id"], "M1234567890L")

            preview_resp = client.get("/api/images/nac_tiff_01/preview?max_dim=64")
            self.assertEqual(preview_resp.status_code, 200)
            self.assertEqual(preview_resp.headers["content-type"], "image/png")
            with Image.open(io.BytesIO(preview_resp.content)) as preview_img:
                self.assertEqual(preview_img.format, "PNG")
                self.assertEqual(preview_img.size, (64, 48))

    def test_unsupported_imagery_returns_clear_422_error(self) -> None:
        app = create_app(data_dir=self.data_dir, check_detector_on_submit=False)
        with TestClient(app) as client:
            bad_ext = client.post(
                "/api/images",
                files={"file": ("notes.txt", b"not an image", "text/plain")},
            )
            self.assertEqual(bad_ext.status_code, 422)
            self.assertEqual(bad_ext.json()["error"]["code"], "unsupported_imagery")

            corrupt_png = client.post(
                "/api/images",
                files={"file": ("corrupt.png", b"broken-bytes", "image/png")},
            )
            self.assertEqual(corrupt_png.status_code, 422)
            self.assertEqual(corrupt_png.json()["error"]["code"], "unsupported_imagery")

    def test_missing_model_weights_returns_clear_503_error(self) -> None:
        app = create_app(data_dir=self.data_dir)
        with TestClient(app) as client:
            upload = client.post(
                "/api/images",
                files={"file": ("nac.png", _make_png_bytes(), "image/png")},
            )
            image_id = upload.json()["image_id"]

            resp = client.post("/api/jobs", json={"image_id": image_id})
            self.assertEqual(resp.status_code, 503)
            self.assertEqual(resp.json()["error"]["code"], "missing_model_weights")

    def test_unavailable_georeferencing_error_when_required_and_fallback_when_optional(self) -> None:
        detector = StubDetector(
            [
                {
                    "detection_id": "det_1",
                    "bbox_px": [10.0, 10.0, 14.0, 14.0],
                    "confidence": 0.9,
                    "model_version": "test-stub",
                }
            ]
        )
        risk = StubRiskGrid()
        app = create_app(data_dir=self.data_dir, detector=detector, risk_calculator=risk)
        with TestClient(app) as client:
            meta = {
                "image_id": "img_no_georef",
                "gsd_x_m_per_px": 0.5,
                "gsd_y_m_per_px": 0.5,
                "coverage": "valid",
                "coordinate_frame": "image_px",
            }
            client.post(
                "/api/images",
                files={"file": ("nac.png", _make_png_bytes(), "image/png")},
                data={"metadata_json": json.dumps(meta)},
            )

            # Strict requirement fails clearly.
            strict_resp = client.post(
                "/api/jobs",
                json={"image_id": "img_no_georef", "require_georeferencing": True},
            )
            self.assertEqual(strict_resp.status_code, 422)
            self.assertEqual(strict_resp.json()["error"]["code"], "unavailable_georeferencing")

            # Screening mode retains image_px and marks detections uncertain.
            job_resp = client.post("/api/jobs", json={"image_id": "img_no_georef"})
            self.assertEqual(job_resp.status_code, 202)
            job_id = job_resp.json()["job_id"]
            _poll_until_done(client, job_id)

            res = client.get(f"/api/jobs/{job_id}/results")
            self.assertEqual(res.status_code, 200)
            payload = res.json()
            self.assertEqual(payload["coordinate_frame"], "image_px")
            self.assertEqual(payload["units"]["position"], "px")
            self.assertTrue(payload["detections"][0]["position"]["uncertain"])
            self.assertEqual(payload["georeferencing_summary"]["status"], "image_px_uncertain")

    def test_async_job_polling_and_threshold_recalculation_without_rerunning_detection(self) -> None:
        detector = StubDetector(
            [
                {
                    "detection_id": "det_a",
                    "bbox_px": [10.0, 20.0, 14.0, 22.0],  # 4px * 0.5 = 2.0m max extent
                    "confidence": 0.95,
                    "model_version": "test-stub",
                }
            ],
            delay_s=0.05,
        )
        risk = StubRiskGrid()
        app = create_app(data_dir=self.data_dir, detector=detector, risk_calculator=risk)
        with TestClient(app) as client:
            meta = {
                "image_id": "img_lunar",
                "gsd_x_m_per_px": 0.5,
                "gsd_y_m_per_px": 0.5,
                "coverage": "valid",
                "coordinate_frame": "lunar_local_m",
                "image_to_lunar": {
                    "type": "affine_2d",
                    "units": "m",
                    "matrix": [[0.5, 0.0, 100.0], [0.0, -0.5, 200.0], [0.0, 0.0, 1.0]],
                    "uncertainty_m": 3.0,
                },
            }
            client.post(
                "/api/images",
                files={"file": ("lunar.png", _make_png_bytes(), "image/png")},
                data={"metadata_json": json.dumps(meta)},
            )

            create_resp = client.post(
                "/api/jobs",
                json={"image_id": "img_lunar", "threshold_profile": "lander"},
            )
            self.assertEqual(create_resp.status_code, 202)
            job_id = create_resp.json()["job_id"]
            self.assertTrue(create_resp.json()["threshold_config"]["illustrative_default"])
            self.assertFalse(create_resp.json()["threshold_config"]["validated"])

            final_status = _poll_until_done(client, job_id)
            self.assertEqual(final_status["status"], "completed")
            self.assertEqual(detector.call_count, 1)
            self.assertEqual(risk.call_count, 1)

            results = client.get(f"/api/jobs/{job_id}/results").json()
            self.assertEqual(results["coordinate_frame"], "lunar_local_m")
            self.assertEqual(results["units"]["position"], "m")
            self.assertEqual(results["risk_grid"]["cells"][0]["class"], "unsafe")

            # Recalculate thresholds: 2.0m boulder becomes "safe" if caution threshold raised to 3.0m.
            patch_resp = client.patch(
                f"/api/jobs/{job_id}/thresholds",
                json={
                    "threshold_profile": "custom",
                    "thresholds": {
                        "cell_size_m": 20.0,
                        "caution_boulder_size_m": 3.0,
                        "unsafe_boulder_size_m": 5.0,
                    },
                },
            )
            self.assertEqual(patch_resp.status_code, 200)
            patched = patch_resp.json()
            self.assertTrue(patched["recalculated_without_detection"])
            self.assertEqual(detector.call_count, 1)  # Detection was NOT rerun!
            self.assertEqual(risk.call_count, 2)
            self.assertEqual(patched["risk_grid"]["cells"][0]["class"], "safe")
            self.assertEqual(patched["risk_grid"]["cell_size_m"], 20.0)
            self.assertFalse(patched["threshold_config"]["illustrative_default"])


if __name__ == "__main__":
    unittest.main()
