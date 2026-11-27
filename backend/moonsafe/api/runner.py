"""Background job execution and threshold recalculation coordinator."""

from __future__ import annotations

import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Mapping

from moonsafe.geo import GeoConfig

from .adapters import DetectorPort, GeoMapperPort, RiskGridPort
from .errors import JobNotReadyError, MoonSafeAPIError, UnavailableGeoreferencingError
from .schemas import CreateJobRequest, ThresholdUpdateRequest, resolve_threshold_config
from .storage import StorageBackend, StoredImage, utc_now_iso


def summarize_georeferencing(
    image_metadata: Mapping[str, Any],
    detections: list[dict[str, Any]],
) -> dict[str, Any]:
    """Summarize coordinate frame and uncertainty state across detections."""
    meta_frame = image_metadata.get("coordinate_frame", "image_px")
    has_transform = meta_frame == "lunar_local_m" and image_metadata.get("image_to_lunar") is not None
    uncertain_count = sum(1 for det in detections if det.get("position", {}).get("uncertain"))
    lunar_count = sum(1 for det in detections if det.get("position", {}).get("frame") == "lunar_local_m")
    pixel_count = len(detections) - lunar_count

    if has_transform and uncertain_count == 0:
        status = "lunar_local_m"
        notice = None
    else:
        status = "image_px_uncertain"
        notice = (
            "Reliable lunar georeferencing is unavailable; pixel coordinates are retained "
            "and marked uncertain."
        )

    return {
        "status": status,
        "coordinate_frame": "lunar_local_m" if (lunar_count > 0 and pixel_count == 0) else "image_px",
        "georeferencing_available": has_transform,
        "detections_in_lunar_local_m": lunar_count,
        "detections_in_image_px": pixel_count,
        "uncertain_positions_count": uncertain_count,
        "notice": notice,
    }


def _validate_risk_grid_shape(
    risk_grid: Mapping[str, Any],
    image_id: str,
    threshold_config: Mapping[str, Any],
) -> dict[str, Any]:
    """Normalize explicit units and screening_only metadata on the RiskGrid payload."""
    grid = dict(risk_grid)
    grid.setdefault("image_id", image_id)
    grid.setdefault("cell_size_m", threshold_config["cell_size_m"])
    grid.setdefault("threshold_profile", threshold_config["threshold_profile"])
    grid.setdefault("cells", [])
    grid["screening_only"] = True
    grid.setdefault("cell_size_units", "m")
    return grid


class JobRunner:
    """Runs detection -> geo -> risk_grid off the HTTP request-response path."""

    def __init__(
        self,
        store: StorageBackend,
        detector: DetectorPort,
        geo_mapper: GeoMapperPort,
        risk_calculator: RiskGridPort,
        *,
        max_workers: int = 2,
        check_detector_on_submit: bool = True,
    ) -> None:
        self.store = store
        self.detector = detector
        self.geo_mapper = geo_mapper
        self.risk_calculator = risk_calculator
        self.check_detector_on_submit = check_detector_on_submit
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="moonsafe-job")
        self._futures: dict[str, Future[None]] = {}

    def shutdown(self, *, wait: bool = True) -> None:
        self._executor.shutdown(wait=wait)

    def submit_job(self, request: CreateJobRequest) -> dict[str, Any]:
        image: StoredImage = self.store.get_image(request.image_id)
        metadata = image.metadata

        has_georef = (
            metadata.get("coordinate_frame") == "lunar_local_m"
            and metadata.get("image_to_lunar") is not None
        )
        if request.require_georeferencing and not has_georef:
            raise UnavailableGeoreferencingError(
                f"Image {request.image_id!r} does not have reliable lunar georeferencing (coordinate_frame={metadata.get('coordinate_frame')!r}).",
                details={"image_id": request.image_id, "coordinate_frame": metadata.get("coordinate_frame")},
            )

        threshold_config = resolve_threshold_config(request.threshold_profile, request.thresholds)

        if self.check_detector_on_submit:
            self.detector.check_available()

        job_id = f"job_{uuid.uuid4().hex[:12]}"
        created_at = utc_now_iso()
        job_record = {
            "job_id": job_id,
            "image_id": request.image_id,
            "status": "queued",
            "stage": "queued",
            "created_at": created_at,
            "started_at": None,
            "completed_at": None,
            "threshold_config": threshold_config,
            "geo_options": {
                "size_method": request.size_method,
                "model_localization_error_px": request.model_localization_error_px,
            },
            "require_georeferencing": request.require_georeferencing,
            "detection_options": dict(request.detection_options),
            "detections": None,
            "risk_grid": None,
            "georeferencing_summary": None,
            "error": None,
            "screening_only": True,
        }
        self.store.create_job(job_record)
        self._futures[job_id] = self._executor.submit(self._execute_job, job_id)
        return self.store.get_job(job_id)

    def _execute_job(self, job_id: str) -> None:
        job = self.store.get_job(job_id)
        image = self.store.get_image(job["image_id"])
        metadata = image.metadata

        self.store.update_job(job_id, status="running", stage="detect", started_at=utc_now_iso())

        try:
            raw_detections = list(
                self.detector.detect(
                    image.image_path,
                    metadata,
                    options=job.get("detection_options") or None,
                )
            )

            self.store.update_job(job_id, stage="geospatial")
            geo_opts = job["geo_options"]
            geo_cfg = GeoConfig(
                size_method=geo_opts["size_method"],
                model_localization_error_px=geo_opts["model_localization_error_px"],
            )
            detections = self.geo_mapper.map_detections(metadata, raw_detections, config=geo_cfg)
            georef_summary = summarize_georeferencing(metadata, detections)

            if job.get("require_georeferencing") and georef_summary["coordinate_frame"] != "lunar_local_m":
                raise UnavailableGeoreferencingError(
                    "Lunar georeferencing transform could not be applied reliably; detections remained in image_px.",
                    details=georef_summary,
                )

            self.store.update_job(job_id, stage="risk_grid")
            raw_grid = self.risk_calculator.compute_risk_grid(
                metadata,
                detections,
                threshold_config=job["threshold_config"],
            )
            risk_grid = _validate_risk_grid_shape(raw_grid, image.image_id, job["threshold_config"])

            self.store.update_job(
                job_id,
                status="completed",
                stage="done",
                completed_at=utc_now_iso(),
                detections=detections,
                risk_grid=risk_grid,
                georeferencing_summary=georef_summary,
                error=None,
            )
        except MoonSafeAPIError as exc:
            self.store.update_job(
                job_id,
                status="failed",
                stage="failed",
                completed_at=utc_now_iso(),
                error={"code": exc.code, "message": exc.message, "details": exc.details},
            )
        except Exception as exc:
            self.store.update_job(
                job_id,
                status="failed",
                stage="failed",
                completed_at=utc_now_iso(),
                error={
                    "code": "job_execution_failed",
                    "message": str(exc),
                    "details": {"exception_type": type(exc).__name__},
                },
            )

    def recalculate_thresholds(self, job_id: str, request: ThresholdUpdateRequest) -> dict[str, Any]:
        """Recalculate RiskGrid from stored detections without rerunning detection."""
        job = self.store.get_job(job_id)
        if job["status"] == "failed":
            err = job.get("error") or {}
            raise MoonSafeAPIError(
                err.get("code", "job_failed"),
                err.get("message", f"Job {job_id!r} failed and cannot recalculate thresholds"),
                status_code=422,
                details=err.get("details"),
            )
        if job["status"] != "completed" or job.get("detections") is None:
            raise JobNotReadyError(job_id, job["status"])

        image = self.store.get_image(job["image_id"])
        updated_config = resolve_threshold_config(
            request.threshold_profile,
            request.thresholds,
            base_config=job.get("threshold_config"),
        )
        raw_grid = self.risk_calculator.compute_risk_grid(
            image.metadata,
            job["detections"],
            threshold_config=updated_config,
        )
        risk_grid = _validate_risk_grid_shape(raw_grid, image.image_id, updated_config)

        return self.store.update_job(
            job_id,
            threshold_config=updated_config,
            risk_grid=risk_grid,
            updated_at=utc_now_iso(),
        )
