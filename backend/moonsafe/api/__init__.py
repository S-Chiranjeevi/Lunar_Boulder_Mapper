"""FastAPI web API connecting MoonSafe frontend to processing modules."""

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
from .app import app, create_app
from .errors import (
    ImageConflictError,
    ImageNotFoundError,
    InvalidThresholdConfigError,
    JobNotFoundError,
    JobNotReadyError,
    MissingModelWeightsError,
    MoonSafeAPIError,
    RiskModuleUnavailableError,
    UnavailableGeoreferencingError,
    UnsupportedImageryError,
)
from .runner import JobRunner
from .schemas import ILLUSTRATIVE_THRESHOLD_PROFILES, resolve_threshold_config
from .storage import LocalFileJobStore, StorageBackend, StoredImage

__all__ = [
    "DefaultDetectorAdapter",
    "DefaultRiskGridAdapter",
    "DetectorPort",
    "GeoMapperPort",
    "GeoModuleAdapter",
    "ILLUSTRATIVE_THRESHOLD_PROFILES",
    "ImageConflictError",
    "ImageIngestorPort",
    "ImageNotFoundError",
    "IngestModuleAdapter",
    "InvalidThresholdConfigError",
    "JobNotFoundError",
    "JobNotReadyError",
    "JobRunner",
    "LocalFileJobStore",
    "MissingModelWeightsError",
    "MoonSafeAPIError",
    "RiskGridPort",
    "RiskModuleUnavailableError",
    "StorageBackend",
    "StoredImage",
    "UnavailableGeoreferencingError",
    "UnsupportedImageryError",
    "app",
    "create_app",
    "resolve_threshold_config",
]
