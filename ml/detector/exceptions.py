"""Exceptions for the MoonSafe boulder detector package."""

from __future__ import annotations


class DetectorError(RuntimeError):
    """Base error for boulder detector configuration, training, and inference."""


class MissingWeightsError(DetectorError, FileNotFoundError):
    """Raised when trained model weights are not configured or missing on disk."""


class DetectorDependencyError(DetectorError):
    """Raised when required ML runtime packages (torch/ultralytics/sahi) are unavailable."""


class DatasetUnavailableError(DetectorError):
    """Raised when prepared dataset images or labels are missing or invalid."""
