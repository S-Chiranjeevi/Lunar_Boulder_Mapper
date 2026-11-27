"""Typed API and domain errors for MoonSafe FastAPI endpoints."""

from __future__ import annotations

from typing import Any


class MoonSafeAPIError(Exception):
    """Base error rendered into a structured JSON error payload."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


class UnsupportedImageryError(MoonSafeAPIError):
    """Raised when uploaded imagery or its metadata cannot be decoded/accepted."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__("unsupported_imagery", message, status_code=422, details=details)


class MissingModelWeightsError(MoonSafeAPIError):
    """Raised when YOLO detector weights or module are unavailable."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__("missing_model_weights", message, status_code=503, details=details)


class UnavailableGeoreferencingError(MoonSafeAPIError):
    """Raised when strict lunar georeferencing is requested but unavailable/unreliable."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__("unavailable_georeferencing", message, status_code=422, details=details)


class RiskModuleUnavailableError(MoonSafeAPIError):
    """Raised when the risk-grid module has not been integrated or configured."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__("risk_module_unavailable", message, status_code=503, details=details)


class ImageNotFoundError(MoonSafeAPIError):
    """Raised when a requested image ID is not present in the store."""

    def __init__(self, image_id: str) -> None:
        super().__init__(
            "image_not_found",
            f"Image {image_id!r} was not found",
            status_code=404,
            details={"image_id": image_id},
        )


class ImageConflictError(MoonSafeAPIError):
    """Raised when uploading an explicit image_id that already exists."""

    def __init__(self, image_id: str) -> None:
        super().__init__(
            "image_already_exists",
            f"Image {image_id!r} already exists; pass overwrite=true or choose another image_id",
            status_code=409,
            details={"image_id": image_id},
        )


class JobNotFoundError(MoonSafeAPIError):
    """Raised when a requested job ID is not present in the store."""

    def __init__(self, job_id: str) -> None:
        super().__init__(
            "job_not_found",
            f"Job {job_id!r} was not found",
            status_code=404,
            details={"job_id": job_id},
        )


class JobNotReadyError(MoonSafeAPIError):
    """Raised when results or threshold recalculation are requested before completion."""

    def __init__(self, job_id: str, status: str) -> None:
        super().__init__(
            "job_not_ready",
            f"Job {job_id!r} is in state {status!r}; poll job status until completed",
            status_code=409,
            details={"job_id": job_id, "status": status},
        )


class InvalidThresholdConfigError(MoonSafeAPIError):
    """Raised when supplied threshold settings are invalid."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__("invalid_threshold_config", message, status_code=422, details=details)
