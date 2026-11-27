"""End-to-end job execution: ingest → detect → geo-enrich → risk grid.

Runs in a background thread so the FastAPI event loop is not blocked.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Optional

from .detection.detector import BoulderDetector, DetectorConfig, RawDetection
from .geo import GeoConfig, process_detections
from .risk.grid import RiskGridBuilder, ThresholdSet
from .schemas import (
    Detection,
    DetectionPosition,
    ImageMetadata,
    JobStatus,
    ThresholdProfile,
)
from .store.image_store import ImageStore
from .store.job_store import JobStore, StoredJob

logger = logging.getLogger(__name__)

# Directory under which preview images are written
_PREVIEW_DIR = Path(__file__).parent.parent / "data" / "previews"


def _raw_to_schema(raw: RawDetection, metadata: ImageMetadata) -> Detection:
    """Convert a RawDetection + geo result into the shared Detection schema."""
    from .geo import process_detection as geo_enrich

    raw_dict = {
        "detection_id": raw.detection_id,
        "image_id": raw.image_id,
        "bbox_px": raw.bbox_px,
        "confidence": raw.confidence,
        "model_version": raw.model_version,
    }
    result = geo_enrich(metadata.model_dump(), raw_dict)

    pos = result["position"]
    return Detection(
        detection_id=result["detection_id"],
        image_id=result["image_id"],
        bbox_px=result["bbox_px"],
        confidence=result["confidence"],
        model_version=result["model_version"],
        estimated_size_m=result.get("estimated_size_m"),
        size_uncertainty_m=result.get("size_uncertainty_m"),
        position=DetectionPosition(
            x=pos["x"],
            y=pos["y"],
            frame=pos["frame"],
            uncertainty_m=pos.get("uncertainty_m"),
        ),
    )


def recalculate_risk(
    job: StoredJob,
    thresholds: Optional[ThresholdSet] = None,
) -> None:
    """Recompute the risk grid for a completed job without re-running detection."""
    image_store = ImageStore.get()
    job_store = JobStore.get()

    stored_image = image_store.get_image(job.image_id)
    if stored_image is None:
        return

    profile = job.threshold_profile
    if thresholds is None:
        from .risk.grid import DEFAULT_THRESHOLDS
        thresholds = DEFAULT_THRESHOLDS[profile]
        # Apply any per-job overrides
        if job.safe_max_size_m is not None:
            thresholds = ThresholdSet(
                safe_max_size_m=job.safe_max_size_m,
                caution_max_size_m=thresholds.caution_max_size_m,
                min_confidence=job.confidence_threshold,
            )
        if job.caution_max_size_m is not None:
            thresholds = ThresholdSet(
                safe_max_size_m=thresholds.safe_max_size_m,
                caution_max_size_m=job.caution_max_size_m,
                min_confidence=job.confidence_threshold,
            )

    builder = RiskGridBuilder(thresholds=thresholds, profile=profile)
    new_grid = builder.build(
        stored_image.metadata,
        job.detections,
        cell_size_px=job.cell_size_px,
    )

    with job_store._mu:
        job.risk_grid = new_grid


def run_job(job_id: str) -> None:
    """Execute the full pipeline for a job.  Intended to run in a thread pool."""
    job_store = JobStore.get()
    image_store = ImageStore.get()

    job = job_store.get_job(job_id)
    if job is None:
        logger.error("run_job called for unknown job_id=%r", job_id)
        return

    job_store.update_status(job_id, JobStatus.running, progress_pct=0.0)

    try:
        stored_image = image_store.get_image(job.image_id)
        if stored_image is None:
            raise ValueError(f"Image {job.image_id!r} not found in store")

        # 1. Detect
        job_store.update_status(job_id, JobStatus.running, progress_pct=10.0)
        detector = BoulderDetector(
            DetectorConfig(confidence_threshold=job.confidence_threshold)
        )
        raw_detections, _preview = detector.run(
            stored_image.path, job.image_id, preview_dir=_PREVIEW_DIR
        )
        logger.info(
            "Job %s: %d raw detection(s) for image %s",
            job_id,
            len(raw_detections),
            job.image_id,
        )
        job_store.update_status(job_id, JobStatus.running, progress_pct=60.0)

        # 2. Geo-enrich
        detections = [
            _raw_to_schema(r, stored_image.metadata) for r in raw_detections
        ]
        job_store.update_status(job_id, JobStatus.running, progress_pct=80.0)

        # 3. Risk grid
        from .risk.grid import DEFAULT_THRESHOLDS, ThresholdSet

        base = DEFAULT_THRESHOLDS[job.threshold_profile]
        thresholds = ThresholdSet(
            safe_max_size_m=job.safe_max_size_m or base.safe_max_size_m,
            caution_max_size_m=job.caution_max_size_m or base.caution_max_size_m,
            min_confidence=job.confidence_threshold,
        )
        builder = RiskGridBuilder(thresholds=thresholds, profile=job.threshold_profile)
        risk_grid = builder.build(
            stored_image.metadata, detections, cell_size_px=job.cell_size_px
        )
        job_store.update_status(job_id, JobStatus.running, progress_pct=95.0)

        job_store.set_results(job_id, detections, risk_grid)
        logger.info("Job %s completed successfully.", job_id)

    except Exception as exc:
        logger.error("Job %s failed: %s", job_id, exc, exc_info=True)
        job_store.update_status(
            job_id, JobStatus.failed, error_message=str(exc)
        )
