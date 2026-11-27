"""POST /api/v1/images  — upload
GET  /api/v1/images  — list
GET  /api/v1/images/{image_id}/preview  — displayable image
"""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..ingest.loader import ImageIngestionError, load_image_metadata
from ..schemas import (
    CoverageStatus,
    ImageListItem,
    ImageMetadata,
    ImageUploadResponse,
)
from ..store.image_store import ImageStore, StoredImage

router = APIRouter(prefix="/api/v1/images", tags=["images"])

# Persistent upload directory (created on first use)
_UPLOAD_DIR = Path(__file__).parent.parent.parent / "data" / "uploads"
_PREVIEW_DIR = Path(__file__).parent.parent.parent / "data" / "previews"

ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".img", ".png"}
MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


@router.post("", response_model=ImageUploadResponse, status_code=201)
async def upload_image(file: UploadFile = File(...)):
    """Upload a raster image (PNG, JPEG, GeoTIFF, LRO IMG, …).

    Returns the ``image_id`` and ``ImageMetadata``.  GSD and lunar transform
    are extracted only if present in an attached sidecar; nothing is invented.
    """
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES and suffix not in {".img"}:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type {suffix!r}. Upload a PNG, JPEG, or TIFF.",
        )

    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    image_id = str(uuid.uuid4())
    dest = _UPLOAD_DIR / f"{image_id}{suffix}"

    # Stream to disk
    written = 0
    with dest.open("wb") as fh:
        while True:
            chunk = await file.read(1024 * 256)  # 256 KB
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413, detail="File exceeds 500 MB limit."
                )
            fh.write(chunk)

    # Ingest metadata — never invent GSD or transforms
    try:
        raw_meta = load_image_metadata(
            dest,
            metadata={"image_id": image_id, "source_image_id": file.filename or image_id},
        )
    except ImageIngestionError as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500, detail=f"Could not read image: {exc}"
        ) from exc

    metadata = ImageMetadata(**raw_meta)
    stored = StoredImage(
        image_id=image_id, filename=file.filename or "", path=dest, metadata=metadata
    )
    ImageStore.get().put(stored)

    return ImageUploadResponse(image_id=image_id, metadata=metadata)


@router.get("", response_model=list[ImageListItem])
def list_images():
    """Return summary records for all uploaded images."""
    return [
        ImageListItem(
            image_id=s.image_id,
            filename=s.filename,
            width_px=s.metadata.width_px,
            height_px=s.metadata.height_px,
            gsd_x_m_per_px=s.metadata.gsd_x_m_per_px,
            gsd_y_m_per_px=s.metadata.gsd_y_m_per_px,
            coverage=s.metadata.coverage,
        )
        for s in ImageStore.get().list_all()
    ]


@router.get("/{image_id}/preview")
def get_preview(image_id: str):
    """Return a displayable JPEG preview of the uploaded image.

    The preview is generated during job processing.  If processing has not yet
    run, the original upload is returned (for small images) or a 404 is raised.
    """
    _PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    # Check for pre-generated preview first
    for ext in ("jpg", "jpeg", "png"):
        candidate = _PREVIEW_DIR / f"{image_id}_preview.{ext}"
        if candidate.is_file():
            return FileResponse(str(candidate), media_type=f"image/{ext}")

    # Fall back to original upload
    stored = ImageStore.get().get_image(image_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="Image not found.")

    suffix = stored.path.suffix.lower().lstrip(".")
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "tif": "image/tiff", "tiff": "image/tiff"}
    media_type = mime_map.get(suffix, "application/octet-stream")

    # For non-displayable formats generate a quick preview on-the-fly
    if suffix in {"tif", "tiff", "img"}:
        try:
            import cv2  # type: ignore
            import numpy as np
            from ..detection.detector import _load_image_cv2, _enhance_for_detection

            img = _load_image_cv2(stored.path)
            img = _enhance_for_detection(img)
            h, w = img.shape[:2]
            if max(h, w) > 1024:
                scale = 1024 / max(h, w)
                img = cv2.resize(img, (int(w * scale), int(h * scale)))
            out = _PREVIEW_DIR / f"{image_id}_preview.jpg"
            cv2.imwrite(str(out), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return FileResponse(str(out), media_type="image/jpeg")
        except Exception:
            pass  # Fall through to raw file

    return FileResponse(str(stored.path), media_type=media_type)
