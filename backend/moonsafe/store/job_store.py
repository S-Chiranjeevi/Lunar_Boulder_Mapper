"""Thread-safe in-memory store for processing jobs and their results."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ..schemas import (
    Detection,
    JobStatus,
    RiskGrid,
    ThresholdProfile,
)


@dataclass
class StoredJob:
    job_id: str
    image_id: str
    status: JobStatus = JobStatus.queued
    threshold_profile: ThresholdProfile = ThresholdProfile.lander
    confidence_threshold: float = 0.5
    cell_size_px: int = 64
    # Threshold values — None means "not set" (defaults applied at run-time)
    safe_max_size_m: Optional[float] = None
    caution_max_size_m: Optional[float] = None
    detections: List[Detection] = field(default_factory=list)
    risk_grid: Optional[RiskGrid] = None
    error_message: Optional[str] = None
    progress_pct: Optional[float] = None


class JobStore:
    _instance: Optional["JobStore"] = None
    _lock: threading.Lock = threading.Lock()

    def __init__(self) -> None:
        self._jobs: Dict[str, StoredJob] = {}
        self._mu = threading.Lock()

    @classmethod
    def get(cls) -> "JobStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def put(self, job: StoredJob) -> None:
        with self._mu:
            self._jobs[job.job_id] = job

    def get_job(self, job_id: str) -> Optional[StoredJob]:
        with self._mu:
            return self._jobs.get(job_id)

    def update_status(
        self,
        job_id: str,
        status: JobStatus,
        *,
        error_message: Optional[str] = None,
        progress_pct: Optional[float] = None,
    ) -> None:
        with self._mu:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.status = status
            if error_message is not None:
                job.error_message = error_message
            if progress_pct is not None:
                job.progress_pct = progress_pct

    def set_results(
        self,
        job_id: str,
        detections: List[Detection],
        risk_grid: RiskGrid,
    ) -> None:
        with self._mu:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.detections = detections
            job.risk_grid = risk_grid
            job.status = JobStatus.completed
            job.progress_pct = 100.0
