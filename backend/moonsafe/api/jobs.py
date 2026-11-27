"""Background job runner and persistent JSON store for MoonSafe screening jobs."""

from __future__ import annotations

import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from moonsafe.config import resolve_thresholds
from moonsafe.detect import DetectorExecutionError, YoloBoulderDetector
from moonsafe.risk import compute_risk_grid
from moonsafe.schemas import (
    Detection,
    ImageMetadata,
    JobCreateRequest,
    JobResultsResponse,
    JobStatus,
    JobStatusResponse,
    RiskGrid,
    ThresholdConfig,
    ThresholdPatchRequest,
    ThresholdPatchResponse,
    ThresholdProfile,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class JobRecord:
    job_id: str
    image_id: str
    status: JobStatus
    threshold_profile: ThresholdProfile
    thresholds: ThresholdConfig
    confidence_threshold: float
    model_weights_path: str | None
    model_status: str
    model_version: str
    model_executed: bool
    status_message: str
    detections: list[Detection]
    risk_grid: RiskGrid | None
    created_at: str
    updated_at: str
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "image_id": self.image_id,
            "status": self.status,
            "threshold_profile": self.threshold_profile,
            "thresholds": self.thresholds.model_dump(mode="json"),
            "confidence_threshold": self.confidence_threshold,
            "model_weights_path": self.model_weights_path,
            "model_status": self.model_status,
            "model_version": self.model_version,
            "model_executed": self.model_executed,
            "status_message": self.status_message,
            "detections": [d.model_dump(mode="json") for d in self.detections],
            "risk_grid": (
                self.risk_grid.model_dump(mode="json", by_alias=True)
                if self.risk_grid is not None
                else None
            ),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "JobRecord":
        return cls(
            job_id=raw["job_id"],
            image_id=raw["image_id"],
            status=raw["status"],
            threshold_profile=raw["threshold_profile"],
            thresholds=ThresholdConfig.model_validate(raw["thresholds"]),
            confidence_threshold=float(raw["confidence_threshold"]),
            model_weights_path=raw.get("model_weights_path"),
            model_status=raw["model_status"],
            model_version=raw["model_version"],
            model_executed=bool(raw["model_executed"]),
            status_message=raw["status_message"],
            detections=[Detection.model_validate(d) for d in raw.get("detections", [])],
            risk_grid=(
                RiskGrid.model_validate(raw["risk_grid"])
                if raw.get("risk_grid") is not None
                else None
            ),
            created_at=raw["created_at"],
            updated_at=raw["updated_at"],
            error=raw.get("error"),
        )


class JobManager:
    """Thread-safe job queue and result store."""

    def __init__(
        self,
        jobs_dir: Path,
        detector: YoloBoulderDetector | None = None,
        max_workers: int = 2,
    ) -> None:
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.detector = detector or YoloBoulderDetector()
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="moonsafe-job")
        self._jobs: dict[str, JobRecord] = {}
        self._load_existing()

    def _load_existing(self) -> None:
        for path in sorted(self.jobs_dir.glob("*.json")):
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                record = JobRecord.from_dict(raw)
                # Interrupted queued/running jobs from a prior process cannot auto-resume.
                if record.status in {"queued", "running"}:
                    record.status = "failed"
                    record.error = "Job was interrupted by server shutdown before completion."
                    record.updated_at = _utc_now_iso()
                    self._persist(record)
                self._jobs[record.job_id] = record
            except Exception:
                continue

    def _persist(self, record: JobRecord) -> None:
        target = self.jobs_dir / f"{record.job_id}.json"
        tmp = self.jobs_dir / f"{record.job_id}.json.tmp"
        tmp.write_text(json.dumps(record.to_dict(), indent=2), encoding="utf-8")
        tmp.replace(target)

    def submit_job(
        self,
        request: JobCreateRequest,
        metadata: ImageMetadata,
        image_path: Path,
    ) -> JobRecord:
        thresholds = resolve_thresholds(request.threshold_profile, request.thresholds)
        confidence_threshold = (
            request.confidence_threshold
            if request.confidence_threshold is not None
            else thresholds.min_confidence
        )
        now = _utc_now_iso()
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        record = JobRecord(
            job_id=job_id,
            image_id=metadata.image_id,
            status="queued",
            threshold_profile=request.threshold_profile,
            thresholds=thresholds,
            confidence_threshold=confidence_threshold,
            model_weights_path=request.model_weights_path,
            model_status="pending",
            model_version="pending",
            model_executed=False,
            status_message="Queued for boulder screening.",
            detections=[],
            risk_grid=None,
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            self._jobs[job_id] = record
            self._persist(record)

        self._executor.submit(self._run_job, job_id, metadata, image_path)
        return record

    def _run_job(self, job_id: str, metadata: ImageMetadata, image_path: Path) -> None:
        with self._lock:
            record = self._jobs[job_id]
            record.status = "running"
            record.status_message = "Running boulder detection and RiskGrid aggregation."
            record.updated_at = _utc_now_iso()
            self._persist(record)

        try:
            det_result = self.detector.detect(
                image_path,
                metadata,
                confidence_threshold=record.confidence_threshold,
                weights_path=record.model_weights_path,
            )
            risk_grid = compute_risk_grid(
                metadata,
                det_result.detections,
                record.threshold_profile,
                record.thresholds,
                model_executed=det_result.model_executed,
            )
        except DetectorExecutionError as exc:
            self._mark_failed(job_id, str(exc))
            return
        except Exception as exc:
            self._mark_failed(job_id, f"Processing failed: {exc}")
            return

        with self._lock:
            record = self._jobs[job_id]
            record.status = "completed"
            record.detections = det_result.detections
            record.model_executed = det_result.model_executed
            record.model_status = det_result.model_status
            record.model_version = det_result.model_version
            record.status_message = det_result.status_message
            record.risk_grid = risk_grid
            record.error = None
            record.updated_at = _utc_now_iso()
            self._persist(record)

    def _mark_failed(self, job_id: str, message: str) -> None:
        with self._lock:
            record = self._jobs[job_id]
            record.status = "failed"
            record.model_status = "failed"
            record.status_message = message
            record.error = message
            record.updated_at = _utc_now_iso()
            self._persist(record)

    def get_job(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def get_status(self, job_id: str) -> JobStatusResponse | None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                return None
            return JobStatusResponse(
                job_id=record.job_id,
                image_id=record.image_id,
                status=record.status,
                threshold_profile=record.threshold_profile,
                thresholds=record.thresholds,
                model_status=record.model_status,
                model_version=record.model_version,
                status_message=record.status_message,
                created_at=record.created_at,
                updated_at=record.updated_at,
                error=record.error,
            )

    def get_results(self, job_id: str) -> JobResultsResponse:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                raise KeyError(job_id)
            if record.status in {"queued", "running"}:
                raise RuntimeError(f"Job {job_id} is still {record.status}")
            if record.status == "failed" or record.risk_grid is None:
                raise ValueError(record.error or f"Job {job_id} failed")
            return JobResultsResponse(
                job_id=record.job_id,
                image_id=record.image_id,
                status="completed",
                model_status=record.model_status,
                model_version=record.model_version,
                status_message=record.status_message,
                thresholds=record.thresholds,
                screening_only=True,
                detections=record.detections,
                risk_grid=record.risk_grid,
            )

    def update_thresholds(
        self,
        job_id: str,
        patch: ThresholdPatchRequest,
        metadata: ImageMetadata,
    ) -> ThresholdPatchResponse:
        """Recalculate RiskGrid from stored detections without rerunning detection."""
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                raise KeyError(job_id)
            if record.status != "completed":
                raise RuntimeError(f"Cannot update thresholds while job status is {record.status}")

            next_profile: ThresholdProfile = patch.threshold_profile or (
                "custom" if patch.thresholds is not None else record.threshold_profile
            )
            next_thresholds = resolve_thresholds(next_profile, patch.thresholds)
            next_grid = compute_risk_grid(
                metadata,
                record.detections,
                next_profile,
                next_thresholds,
                model_executed=record.model_executed,
            )
            record.threshold_profile = next_profile
            record.thresholds = next_thresholds
            record.risk_grid = next_grid
            record.updated_at = _utc_now_iso()
            self._persist(record)

            return ThresholdPatchResponse(
                job_id=record.job_id,
                image_id=record.image_id,
                threshold_profile=next_profile,
                thresholds=next_thresholds,
                rerun_detection=False,
                risk_grid=next_grid,
            )

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True)
