"""FastAPI application for MoonSafe LRO LROC NAC boulder-risk screening."""

from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from moonsafe.config import ILLUSTRATIVE_THRESHOLD_PROFILES, get_data_dir
from moonsafe.detect import YoloBoulderDetector
from moonsafe.imagery import ImageryError, build_display_preview
from moonsafe.ingest import ImageIngestionError, load_image_metadata
from moonsafe.schemas import (
    ImageDetailResponse,
    ImageListResponse,
    ImageMetadata,
    ImageUploadResponse,
    JobCreateRequest,
    JobCreateResponse,
    JobResultsResponse,
    JobStatusResponse,
    ThresholdConfig,
    ThresholdPatchRequest,
    ThresholdPatchResponse,
    ThresholdProfile,
)

from .jobs import JobManager

_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_.-]+")
_ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


def _sanitize_id(raw: str) -> str:
    cleaned = _SAFE_ID_RE.sub("_", raw.strip()).strip("._-")
    return cleaned or f"nac_{uuid.uuid4().hex[:8]}"


class ImageStore:
    """Disk-backed registry of uploaded/available LRO NAC images and metadata."""

    def __init__(self, images_dir: Path) -> None:
        self.images_dir = images_dir
        self.images_dir.mkdir(parents=True, exist_ok=True)

    def _image_folder(self, image_id: str) -> Path:
        safe = _sanitize_id(image_id)
        folder = (self.images_dir / safe).resolve()
        if not folder.is_relative_to(self.images_dir.resolve()):
            raise HTTPException(status_code=400, detail="Invalid image_id")
        return folder

    def list_images(self) -> list[ImageMetadata]:
        items: list[ImageMetadata] = []
        for meta_file in sorted(self.images_dir.glob("*/metadata.json")):
            try:
                raw = json.loads(meta_file.read_text(encoding="utf-8"))
                items.append(ImageMetadata.model_validate(raw))
            except Exception:
                continue
        return items

    def get_image(self, image_id: str) -> tuple[ImageMetadata, Path, Path]:
        folder = self._image_folder(image_id)
        meta_path = folder / "metadata.json"
        if not meta_path.is_file():
            raise HTTPException(status_code=404, detail=f"Image '{image_id}' not found")
        metadata = ImageMetadata.model_validate(
            json.loads(meta_path.read_text(encoding="utf-8"))
        )
        originals = [p for p in folder.iterdir() if p.name.startswith("original")]
        if not originals:
            raise HTTPException(status_code=404, detail=f"Raster missing for '{image_id}'")
        preview_path = folder / "preview.png"
        return metadata, originals[0], preview_path

    def save_upload(
        self,
        *,
        upload_filename: str,
        image_bytes: bytes,
        manifest_bytes: bytes | None = None,
        overrides: dict[str, Any] | None = None,
    ) -> tuple[ImageMetadata, Path]:
        ext = Path(upload_filename).suffix.lower()
        if ext not in _ALLOWED_IMAGE_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported image extension '{ext}'. Allowed: {sorted(_ALLOWED_IMAGE_EXTS)}",
            )

        manifest_data: dict[str, Any] = {}
        if manifest_bytes is not None:
            try:
                parsed = json.loads(manifest_bytes.decode("utf-8"))
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Invalid manifest JSON: {exc}") from exc
            if not isinstance(parsed, dict):
                raise HTTPException(status_code=400, detail="Manifest must be a JSON object")
            manifest_data = parsed

        merged_overrides = {**manifest_data, **(overrides or {})}
        base_name = str(
            merged_overrides.get("image_id")
            or Path(upload_filename).stem
            or f"nac_{uuid.uuid4().hex[:8]}"
        )
        candidate_id = _sanitize_id(base_name)
        folder = self._image_folder(candidate_id)
        if folder.exists():
            candidate_id = f"{candidate_id}_{uuid.uuid4().hex[:6]}"
            folder = self._image_folder(candidate_id)
        folder.mkdir(parents=True, exist_ok=False)

        original_path = folder / f"original{ext}"
        manifest_path: Path | None = None
        preview_path = folder / "preview.png"

        try:
            original_path.write_bytes(image_bytes)
            merged_overrides["image_id"] = candidate_id
            if not merged_overrides.get("source_image_id"):
                merged_overrides["source_image_id"] = Path(upload_filename).stem or candidate_id

            if manifest_bytes is not None:
                manifest_path = folder / "manifest.json"
                manifest_path.write_bytes(manifest_bytes)

            try:
                raw_metadata = load_image_metadata(
                    original_path,
                    manifest_path=manifest_path,
                    metadata=merged_overrides,
                )
                build_display_preview(original_path, preview_path)
            except ImageIngestionError as exc:
                # Fallback for 16-bit/float scientific TIFFs readable via Rasterio/OpenCV.
                if "Could not decode image" not in str(exc):
                    raise
                build_display_preview(original_path, preview_path, max_dim=1_000_000)
                raw_metadata = load_image_metadata(
                    preview_path,
                    manifest_path=manifest_path,
                    metadata=merged_overrides,
                )
                # Rebuild capped browser preview after validating dimensions.
                build_display_preview(original_path, preview_path)

            metadata = ImageMetadata.model_validate(raw_metadata)
            (folder / "metadata.json").write_text(
                metadata.model_dump_json(indent=2),
                encoding="utf-8",
            )
            return metadata, preview_path
        except (ImageIngestionError, ImageryError) as exc:
            shutil.rmtree(folder, ignore_errors=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except HTTPException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        except Exception as exc:
            shutil.rmtree(folder, ignore_errors=True)
            raise HTTPException(status_code=400, detail=f"Failed to ingest image: {exc}") from exc


def create_app(
    *,
    data_dir: Path | None = None,
    detector: YoloBoulderDetector | None = None,
) -> FastAPI:
    """Create and configure a MoonSafe FastAPI application instance."""
    resolved_data_dir = data_dir or get_data_dir()
    image_store = ImageStore(resolved_data_dir / "images")
    job_manager = JobManager(resolved_data_dir / "jobs", detector=detector)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            job_manager.shutdown()

    application = FastAPI(
        title="MoonSafe API",
        version="0.1.0",
        description=(
            "Screening-only lunar boulder detection and RiskGrid API for LRO LROC NAC imagery."
        ),
        lifespan=lifespan,
    )

    cors_raw = os.environ.get(
        "MOONSAFE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.state.image_store = image_store
    application.state.job_manager = job_manager

    @application.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "moonsafe"}

    @application.get("/api/v1/profiles")
    def list_profiles() -> dict[ThresholdProfile, ThresholdConfig]:
        return ILLUSTRATIVE_THRESHOLD_PROFILES

    @application.post(
        "/api/v1/images",
        response_model=ImageUploadResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def upload_image(
        file: UploadFile = File(...),
        manifest: UploadFile | None = File(default=None),
        image_id: str | None = Form(default=None),
        source_image_id: str | None = Form(default=None),
        gsd_x_m_per_px: float | None = Form(default=None),
        gsd_y_m_per_px: float | None = Form(default=None),
        coverage: str | None = Form(default=None),
        coordinate_frame: str | None = Form(default=None),
        image_to_lunar_json: str | None = Form(default=None),
    ) -> ImageUploadResponse:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Uploaded image must have a filename")

        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="Uploaded image file is empty")

        manifest_bytes = await manifest.read() if manifest is not None else None

        overrides: dict[str, Any] = {}
        if image_id is not None and image_id.strip():
            overrides["image_id"] = image_id.strip()
        if source_image_id is not None and source_image_id.strip():
            overrides["source_image_id"] = source_image_id.strip()
        if gsd_x_m_per_px is not None:
            overrides["gsd_x_m_per_px"] = gsd_x_m_per_px
        if gsd_y_m_per_px is not None:
            overrides["gsd_y_m_per_px"] = gsd_y_m_per_px
        if coverage is not None and coverage.strip():
            overrides["coverage"] = coverage.strip()
        if coordinate_frame is not None and coordinate_frame.strip():
            overrides["coordinate_frame"] = coordinate_frame.strip()
        if image_to_lunar_json is not None and image_to_lunar_json.strip():
            try:
                overrides["image_to_lunar"] = json.loads(image_to_lunar_json)
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid image_to_lunar_json: {exc}",
                ) from exc

        metadata, _ = image_store.save_upload(
            upload_filename=file.filename,
            image_bytes=image_bytes,
            manifest_bytes=manifest_bytes,
            overrides=overrides,
        )
        return ImageUploadResponse(
            image_id=metadata.image_id,
            metadata=metadata,
            has_elevation_data=False,
            preview_url=f"/api/v1/images/{metadata.image_id}/preview",
        )

    @application.get("/api/v1/images", response_model=ImageListResponse)
    def list_images() -> ImageListResponse:
        return ImageListResponse(images=image_store.list_images())

    @application.get("/api/v1/images/{image_id}", response_model=ImageDetailResponse)
    def get_image_detail(image_id: str) -> ImageDetailResponse:
        metadata, _, _ = image_store.get_image(image_id)
        return ImageDetailResponse(
            image_id=metadata.image_id,
            metadata=metadata,
            has_elevation_data=False,
            preview_url=f"/api/v1/images/{metadata.image_id}/preview",
        )

    @application.get("/api/v1/images/{image_id}/preview")
    def get_image_preview(image_id: str) -> FileResponse:
        _, original_path, preview_path = image_store.get_image(image_id)
        if not preview_path.is_file():
            try:
                build_display_preview(original_path, preview_path)
            except ImageryError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc
        return FileResponse(preview_path, media_type="image/png")

    @application.post(
        "/api/v1/jobs",
        response_model=JobCreateResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    def create_job(request: JobCreateRequest) -> JobCreateResponse:
        metadata, original_path, _ = image_store.get_image(request.image_id)
        record = job_manager.submit_job(request, metadata, original_path)
        return JobCreateResponse(
            job_id=record.job_id,
            image_id=record.image_id,
            status=record.status,
            threshold_profile=record.threshold_profile,
        )

    @application.get("/api/v1/jobs/{job_id}", response_model=JobStatusResponse)
    def get_job_status(job_id: str) -> JobStatusResponse:
        status_resp = job_manager.get_status(job_id)
        if status_resp is None:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
        return status_resp

    @application.get(
        "/api/v1/jobs/{job_id}/results",
        response_model=JobResultsResponse,
        response_model_by_alias=True,
    )
    def get_job_results(job_id: str) -> JobResultsResponse:
        try:
            return job_manager.get_results(job_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.patch(
        "/api/v1/jobs/{job_id}/thresholds",
        response_model=ThresholdPatchResponse,
        response_model_by_alias=True,
    )
    def patch_job_thresholds(
        job_id: str,
        request: ThresholdPatchRequest,
    ) -> ThresholdPatchResponse:
        record = job_manager.get_job(job_id)
        if record is None:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
        metadata, _, _ = image_store.get_image(record.image_id)
        try:
            return job_manager.update_thresholds(job_id, request, metadata)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return application


app = create_app()
