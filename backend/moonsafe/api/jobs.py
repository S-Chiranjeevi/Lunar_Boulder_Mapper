"""POST /api/v1/jobs         — create job
GET  /api/v1/jobs/{job_id}  — status
GET  /api/v1/jobs/{job_id}/results    — detections + risk grid
PATCH /api/v1/jobs/{job_id}/thresholds — update thresholds, recalculate risk
"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..pipeline import recalculate_risk, run_job
from ..risk.grid import DEFAULT_THRESHOLDS, ThresholdSet
from ..schemas import (
    JobCreateRequest,
    JobCreateResponse,
    JobResults,
    JobStatus,
    JobStatusResponse,
    ThresholdPatchRequest,
    ThresholdProfile,
)
from ..store.image_store import ImageStore
from ..store.job_store import JobStore, StoredJob

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])

# A small thread pool so detection can run without blocking the event loop.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="moonsafe-worker")


def _submit_job(job_id: str) -> None:
    _executor.submit(run_job, job_id)


@router.post("", response_model=JobCreateResponse, status_code=202)
def create_job(body: JobCreateRequest, background_tasks: BackgroundTasks):
    """Start processing an image with a threshold profile.

    Returns immediately with a ``job_id``; poll GET /jobs/{job_id} for status.
    """
    image_store = ImageStore.get()
    if not image_store.exists(body.image_id):
        raise HTTPException(status_code=404, detail=f"Image {body.image_id!r} not found.")

    job_id = str(uuid.uuid4())
    job = StoredJob(
        job_id=job_id,
        image_id=body.image_id,
        threshold_profile=body.threshold_profile,
        confidence_threshold=body.confidence_threshold,
        cell_size_px=body.cell_size_px,
    )
    JobStore.get().put(job)

    # Run in background thread (not in the event loop)
    background_tasks.add_task(_submit_job, job_id)

    return JobCreateResponse(
        job_id=job_id,
        image_id=body.image_id,
        status=JobStatus.queued,
    )


@router.get("/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str):
    """Return current status of a job (queued / running / completed / failed)."""
    job = JobStore.get().get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")

    return JobStatusResponse(
        job_id=job.job_id,
        image_id=job.image_id,
        status=job.status,
        error_message=job.error_message,
        progress_pct=job.progress_pct,
    )


@router.get("/{job_id}/results", response_model=JobResults)
def get_job_results(job_id: str):
    """Return detections and RiskGrid for a completed job."""
    job = JobStore.get().get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    if job.status == JobStatus.queued or job.status == JobStatus.running:
        raise HTTPException(
            status_code=202,
            detail=f"Job is {job.status.value}; check back later.",
        )
    if job.status == JobStatus.failed:
        raise HTTPException(
            status_code=500,
            detail=f"Job failed: {job.error_message}",
        )

    return JobResults(
        job_id=job.job_id,
        image_id=job.image_id,
        detections=job.detections,
        risk_grid=job.risk_grid,
    )


@router.patch("/{job_id}/thresholds", response_model=JobStatusResponse)
def patch_thresholds(job_id: str, body: ThresholdPatchRequest):
    """Update threshold settings and immediately recalculate the risk grid.

    Detection is NOT re-run; only the grid classification changes.
    Requires the job to be in ``completed`` state.
    """
    job_store = JobStore.get()
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found.")
    if job.status != JobStatus.completed:
        raise HTTPException(
            status_code=409,
            detail="Threshold patching requires a completed job.",
        )

    # Apply changes to stored job
    with job_store._mu:
        if body.threshold_profile is not None:
            job.threshold_profile = body.threshold_profile
        if body.safe_max_size_m is not None:
            job.safe_max_size_m = body.safe_max_size_m
        if body.caution_max_size_m is not None:
            job.caution_max_size_m = body.caution_max_size_m
        if body.min_confidence is not None:
            job.confidence_threshold = body.min_confidence
        if body.cell_size_px is not None:
            job.cell_size_px = body.cell_size_px

    # Rebuild thresholds object
    base = DEFAULT_THRESHOLDS[job.threshold_profile]
    new_thresholds = ThresholdSet(
        safe_max_size_m=job.safe_max_size_m or base.safe_max_size_m,
        caution_max_size_m=job.caution_max_size_m or base.caution_max_size_m,
        min_confidence=job.confidence_threshold,
    )

    recalculate_risk(job, thresholds=new_thresholds)

    return JobStatusResponse(
        job_id=job.job_id,
        image_id=job.image_id,
        status=job.status,
    )
