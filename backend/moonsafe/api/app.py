"""FastAPI application and route wiring for MoonSafe."""

from __future__ import annotations

import io
import json
import os
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Mapping, Sequence

from fastapi import FastAPI, File, Form, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .adapters import (
    DefaultDetectorAdapter,
    DefaultRiskGridAdapter,
    DetectorPort,
    GeoMapperPort,
    GeoModuleAdapter,
    ImageIngestorPort,
    IngestModuleAdapter,
    RiskGridPort,
)
from .errors import MoonSafeAPIError, UnsupportedImageryError
from .runner import JobRunner
from .schemas import (
    CreateJobRequest,
    ThresholdUpdateRequest,
    build_units_summary,
    format_image_response,
)
from .storage import LocalFileJobStore, StorageBackend

_SUPPORTED_RASTER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}


def _job_status_payload(job: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "job_id": job["job_id"],
        "image_id": job["image_id"],
        "status": job["status"],
        "stage": job["stage"],
        "created_at": job["created_at"],
        "started_at": job["started_at"],
        "completed_at": job["completed_at"],
        "threshold_config": job["threshold_config"],
        "require_georeferencing": job["require_georeferencing"],
        "error": job["error"],
        "screening_only": True,
        "poll_url": f"/api/jobs/{job['job_id']}",
        "results_url": f"/api/jobs/{job['job_id']}/results",
    }


def _render_preview_png(image_path: Path, max_dim: int) -> tuple[bytes, int, int]:
    try:
        from PIL import Image, ImageMath
    except ImportError as exc:
        raise UnsupportedImageryError("Pillow is required to render image previews") from exc

    try:
        with Image.open(image_path) as img:
            if img.mode in {"I;16", "I;16B", "I;16L", "I", "F"}:
                # Normalize 16-bit / float NAC rasters into 8-bit grayscale for browser preview.
                float_img = img.convert("F")
                if max(float_img.size) > max_dim:
                    float_img.thumbnail((max_dim, max_dim))
                lo, hi = float_img.getextrema()
                if hi > lo:
                    scale = 255.0 / (hi - lo)
                    img = ImageMath.lambda_eval(lambda a: (a["x"] - lo) * scale, x=float_img).convert("L")
                else:
                    img = float_img.convert("L")
            else:
                if img.mode not in {"L", "RGB", "RGBA"}:
                    img = img.convert("RGB")
                if max(img.size) > max_dim:
                    img.thumbnail((max_dim, max_dim))

            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return (buf.getvalue(), img.width, img.height)
    except Exception as exc:
        raise UnsupportedImageryError(f"Could not render preview for {image_path.name}: {exc}") from exc


def create_app(
    *,
    storage: StorageBackend | None = None,
    data_dir: str | Path | None = None,
    ingestor: ImageIngestorPort | None = None,
    detector: DetectorPort | None = None,
    geo_mapper: GeoMapperPort | None = None,
    risk_calculator: RiskGridPort | None = None,
    weights_path: str | Path | None = None,
    check_detector_on_submit: bool = True,
    cors_origins: Sequence[str] | None = None,
) -> FastAPI:
    """Create the MoonSafe FastAPI application with replaceable ports and store."""
    resolved_data_dir = Path(
        data_dir or os.environ.get("MOONSAFE_DATA_DIR") or (Path(tempfile.gettempdir()) / "moonsafe_data")
    )
    resolved_weights = weights_path or os.environ.get("MOONSAFE_WEIGHTS_PATH")

    store: StorageBackend = storage or LocalFileJobStore(resolved_data_dir)
    ingestor_port: ImageIngestorPort = ingestor or IngestModuleAdapter()
    detector_port: DetectorPort = detector or DefaultDetectorAdapter(weights_path=resolved_weights)
    geo_port: GeoMapperPort = geo_mapper or GeoModuleAdapter()
    risk_port: RiskGridPort = risk_calculator or DefaultRiskGridAdapter()

    runner = JobRunner(
        store=store,
        detector=detector_port,
        geo_mapper=geo_port,
        risk_calculator=risk_port,
        check_detector_on_submit=check_detector_on_submit,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            yield
        finally:
            runner.shutdown(wait=True)

    app = FastAPI(
        title="MoonSafe API",
        description=(
            "Screening-only API connecting LRO NAC image ingestion, boulder detection, "
            "2D geospatial mapping, and boulder-risk grid calculation."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cors_origins) if cors_origins is not None else ["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.store = store
    app.state.runner = runner

    @app.exception_handler(MoonSafeAPIError)
    async def _handle_moonsafe_error(_request: Request, exc: MoonSafeAPIError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_payload())

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "screening_only": True}

    @app.post("/api/images", status_code=201)
    async def upload_image(
        file: UploadFile = File(...),
        manifest: UploadFile | None = File(default=None),
        metadata_json: str | None = Form(default=None),
        overwrite: bool = Form(default=False),
    ) -> dict[str, Any]:
        filename = Path(file.filename or "upload.bin").name
        ext = Path(filename).suffix.lower()
        if ext not in _SUPPORTED_RASTER_EXTENSIONS:
            raise UnsupportedImageryError(
                f"Unsupported image extension {ext!r}; supported extensions: {sorted(_SUPPORTED_RASTER_EXTENSIONS)}",
                details={"filename": filename, "supported_extensions": sorted(_SUPPORTED_RASTER_EXTENSIONS)},
            )

        image_bytes = await file.read()
        if not image_bytes:
            raise UnsupportedImageryError("Uploaded image file is empty")

        manifest_bytes = await manifest.read() if manifest is not None else None
        explicit_meta: Mapping[str, Any] | None = None
        if metadata_json is not None and metadata_json.strip():
            try:
                parsed = json.loads(metadata_json)
            except json.JSONDecodeError as exc:
                raise UnsupportedImageryError(f"Invalid metadata_json payload: {exc}") from exc
            if not isinstance(parsed, Mapping):
                raise UnsupportedImageryError("metadata_json must decode to a JSON object")
            explicit_meta = dict(parsed)

        with tempfile.TemporaryDirectory(prefix="moonsafe_upload_") as tmp_dir:
            tmp_path = Path(tmp_dir)
            tmp_image = tmp_path / filename
            tmp_image.write_bytes(image_bytes)
            tmp_manifest: Path | None = None
            if manifest_bytes is not None:
                tmp_manifest = tmp_path / f"{filename}.json"
                tmp_manifest.write_bytes(manifest_bytes)

            metadata = ingestor_port.load(tmp_image, manifest_path=tmp_manifest, metadata=explicit_meta)

        # Avoid silent overwrite when different uploads share a filename without an explicit image_id.
        has_explicit_id = bool(explicit_meta and explicit_meta.get("image_id"))
        if not has_explicit_id and manifest_bytes is not None:
            try:
                has_explicit_id = bool(json.loads(manifest_bytes.decode("utf-8")).get("image_id"))
            except Exception:
                has_explicit_id = False

        image_id = metadata["image_id"]
        if not has_explicit_id and not overwrite:
            image_id = f"{metadata['image_id']}_{uuid.uuid4().hex[:8]}"
            metadata = {**metadata, "image_id": image_id}

        stored = store.save_image(
            image_id,
            filename,
            image_bytes,
            metadata,
            manifest_bytes=manifest_bytes,
            overwrite=overwrite,
        )
        return format_image_response(stored.metadata, created_at=stored.created_at)

    @app.get("/api/images")
    def list_images() -> dict[str, Any]:
        images = [
            format_image_response(item.metadata, created_at=item.created_at)
            for item in store.list_images()
        ]
        return {"images": images, "count": len(images)}

    @app.get("/api/images/{image_id}")
    def get_image(image_id: str) -> dict[str, Any]:
        stored = store.get_image(image_id)
        return format_image_response(stored.metadata, created_at=stored.created_at)

    @app.get("/api/images/{image_id}/preview")
    def preview_image(
        image_id: str,
        max_dim: int = Query(default=1024, ge=64, le=4096),
    ) -> Response:
        stored = store.get_image(image_id)
        png_bytes, width, height = _render_preview_png(stored.image_path, max_dim=max_dim)
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={
                "X-MoonSafe-Image-Id": stored.image_id,
                "X-MoonSafe-Preview-Dimensions": f"{width}x{height}",
            },
        )

    @app.post("/api/jobs", status_code=202)
    def create_job(request: CreateJobRequest) -> dict[str, Any]:
        job = runner.submit_job(request)
        return _job_status_payload(job)

    @app.get("/api/jobs")
    def list_jobs() -> dict[str, Any]:
        jobs = [_job_status_payload(job) for job in store.list_jobs()]
        return {"jobs": jobs, "count": len(jobs)}

    @app.get("/api/jobs/{job_id}")
    def get_job_status(job_id: str) -> dict[str, Any]:
        return _job_status_payload(store.get_job(job_id))

    @app.get("/api/jobs/{job_id}/results")
    def get_job_results(job_id: str) -> dict[str, Any]:
        job = store.get_job(job_id)
        if job["status"] == "failed":
            err = job.get("error") or {}
            raise MoonSafeAPIError(
                err.get("code", "job_failed"),
                err.get("message", f"Job {job_id!r} failed"),
                status_code=503 if err.get("code") in {"missing_model_weights", "risk_module_unavailable"} else 422,
                details=err.get("details"),
            )
        if job["status"] != "completed":
            raise MoonSafeAPIError(
                "job_not_ready",
                f"Job {job_id!r} is currently {job['status']!r}; poll /api/jobs/{job_id}",
                status_code=409,
                details={"job_id": job_id, "status": job["status"]},
            )

        stored_image = store.get_image(job["image_id"])
        georef_summary = job["georeferencing_summary"]
        coord_frame = georef_summary["coordinate_frame"]
        return {
            "job_id": job["job_id"],
            "image_id": job["image_id"],
            "status": job["status"],
            "screening_only": True,
            "coordinate_frame": coord_frame,
            "units": build_units_summary(coord_frame),
            "image_metadata": stored_image.metadata,
            "detections": job["detections"],
            "risk_grid": job["risk_grid"],
            "threshold_config": job["threshold_config"],
            "georeferencing_summary": georef_summary,
        }

    @app.patch("/api/jobs/{job_id}/thresholds")
    def update_thresholds(job_id: str, request: ThresholdUpdateRequest) -> dict[str, Any]:
        updated_job = runner.recalculate_thresholds(job_id, request)
        coord_frame = updated_job["risk_grid"].get("coordinate_frame", "image_px")
        return {
            "job_id": updated_job["job_id"],
            "image_id": updated_job["image_id"],
            "coordinate_frame": coord_frame,
            "units": build_units_summary(coord_frame),
            "threshold_config": updated_job["threshold_config"],
            "risk_grid": updated_job["risk_grid"],
            "recalculated_without_detection": True,
            "screening_only": True,
        }

    return app


app = create_app()
