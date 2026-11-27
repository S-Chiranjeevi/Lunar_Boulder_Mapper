"""Adapter boundaries connecting the FastAPI layer to ingest, detect, geo, and risk modules.

The API delegates all domain work through these ports without duplicating
detector, geospatial, or risk-grid logic.
"""

from __future__ import annotations

import importlib
import inspect
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence

from moonsafe.geo import GeoConfig, GeoTransformError, process_detections
from moonsafe.ingest import ImageIngestionError, load_image_metadata

from .errors import (
    MissingModelWeightsError,
    RiskModuleUnavailableError,
    UnsupportedImageryError,
)


class ImageIngestorPort(Protocol):
    """Loads local image files and returns the shared ImageMetadata shape."""

    def load(
        self,
        image_path: Path,
        manifest_path: Path | None = None,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]: ...


class DetectorPort(Protocol):
    """Runs boulder detection on an image and returns raw detections."""

    def check_available(self) -> None:
        """Raise MissingModelWeightsError if model or weights are unavailable."""

    def detect(
        self,
        image_path: Path,
        image_metadata: Mapping[str, Any],
        *,
        options: Mapping[str, Any] | None = None,
    ) -> Sequence[Mapping[str, Any]]: ...


class GeoMapperPort(Protocol):
    """Maps raw pixel detections + ImageMetadata into shared Detection dicts."""

    def map_detections(
        self,
        image_metadata: Mapping[str, Any],
        raw_detections: Sequence[Mapping[str, Any]],
        *,
        config: GeoConfig | None = None,
    ) -> list[dict[str, Any]]: ...


class RiskGridPort(Protocol):
    """Computes the shared RiskGrid dict from detections and threshold settings."""

    def compute_risk_grid(
        self,
        image_metadata: Mapping[str, Any],
        detections: Sequence[Mapping[str, Any]],
        *,
        threshold_config: Mapping[str, Any],
    ) -> dict[str, Any]: ...


class IngestModuleAdapter:
    """Delegates image decoding and metadata extraction to ``moonsafe.ingest``."""

    def load(
        self,
        image_path: Path,
        manifest_path: Path | None = None,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            return load_image_metadata(image_path, manifest_path=manifest_path, metadata=metadata)
        except ImageIngestionError as exc:
            raise UnsupportedImageryError(str(exc)) from exc


class GeoModuleAdapter:
    """Delegates size estimation and coordinate transforms to ``moonsafe.geo``."""

    def map_detections(
        self,
        image_metadata: Mapping[str, Any],
        raw_detections: Sequence[Mapping[str, Any]],
        *,
        config: GeoConfig | None = None,
    ) -> list[dict[str, Any]]:
        try:
            return process_detections(image_metadata, raw_detections, config=config)
        except GeoTransformError as exc:
            raise UnsupportedImageryError(f"Invalid detection or image geometry: {exc}") from exc


def _resolve_callable(module_names: tuple[str, ...], fn_names: tuple[str, ...]) -> Any | None:
    for mod_name in module_names:
        try:
            module = importlib.import_module(mod_name)
        except ImportError:
            continue
        for fn_name in fn_names:
            fn = getattr(module, fn_name, None)
            if callable(fn):
                return fn
    return None


class DefaultDetectorAdapter:
    """Discovers the integrated YOLO detector module when present and weights exist."""

    def __init__(self, weights_path: str | Path | None = None) -> None:
        self._weights_path = Path(weights_path) if weights_path is not None else None

    def _find_detector_callable(self) -> Any | None:
        return _resolve_callable(
            ("moonsafe.detect", "moonsafe.detector", "moonsafe.detect.detector"),
            ("detect_boulders", "run_detection", "detect"),
        )

    def check_available(self) -> None:
        if self._weights_path is not None and not self._weights_path.is_file():
            raise MissingModelWeightsError(
                f"Configured detector weights file does not exist: {self._weights_path}",
                details={"weights_path": str(self._weights_path)},
            )
        detect_fn = self._find_detector_callable()
        if detect_fn is None:
            raise MissingModelWeightsError(
                "Boulder detector module/weights are not available; install trained YOLO weights before running detection.",
                details={"weights_path": str(self._weights_path) if self._weights_path else None},
            )

    def detect(
        self,
        image_path: Path,
        image_metadata: Mapping[str, Any],
        *,
        options: Mapping[str, Any] | None = None,
    ) -> Sequence[Mapping[str, Any]]:
        self.check_available()
        detect_fn = self._find_detector_callable()
        assert detect_fn is not None
        kwargs: dict[str, Any] = {}
        sig = inspect.signature(detect_fn)
        if "image_metadata" in sig.parameters:
            kwargs["image_metadata"] = image_metadata
        if "weights_path" in sig.parameters and self._weights_path is not None:
            kwargs["weights_path"] = self._weights_path
        if "options" in sig.parameters and options is not None:
            kwargs["options"] = dict(options)
        try:
            return detect_fn(image_path, **kwargs)
        except FileNotFoundError as exc:
            raise MissingModelWeightsError(f"Model weights not found: {exc}") from exc


class DefaultRiskGridAdapter:
    """Discovers the integrated risk-grid module when present."""

    def _find_risk_callable(self) -> Any | None:
        return _resolve_callable(
            ("moonsafe.risk", "moonsafe.risk_grid", "moonsafe.risk.grid"),
            ("compute_risk_grid", "build_risk_grid", "evaluate_risk_grid"),
        )

    def compute_risk_grid(
        self,
        image_metadata: Mapping[str, Any],
        detections: Sequence[Mapping[str, Any]],
        *,
        threshold_config: Mapping[str, Any],
    ) -> dict[str, Any]:
        risk_fn = self._find_risk_callable()
        if risk_fn is None:
            raise RiskModuleUnavailableError(
                "Risk-grid module (moonsafe.risk) is not integrated in this environment yet."
            )
        sig = inspect.signature(risk_fn)
        if "threshold_config" in sig.parameters:
            result = risk_fn(image_metadata, detections, threshold_config=threshold_config)
        elif "thresholds" in sig.parameters:
            result = risk_fn(image_metadata, detections, thresholds=threshold_config)
        else:
            result = risk_fn(image_metadata, detections, threshold_config)
        return dict(result)
