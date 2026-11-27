"""MoonSafe API adapter for the experimental lunar boulder YOLO detector."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from ml.detector.inference import detect_boulders as _run_yolo


MODEL_VERSION = "yolov8n-lunar-boulder-10pct-5ep-experimental"


def detect_boulders(
    image_path: str | Path,
    *,
    image_metadata: Mapping[str, Any] | None = None,
    weights_path: str | Path | None = None,
    options: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Run the trained YOLO model through the existing tiled inference pipeline."""
    if weights_path is None:
        raise FileNotFoundError(
            "Set MOONSAFE_WEIGHTS_PATH to the deployed lunar boulder checkpoint."
        )

    config_options = dict(options or {})
    config_options.setdefault("model_version", MODEL_VERSION)
    config_options.setdefault("slicing_backend", "builtin")
    config_options.setdefault("device", "cpu")

    return _run_yolo(
        image_path,
        image_metadata=image_metadata,
        weights_path=weights_path,
        options=config_options,
    )


__all__ = ["MODEL_VERSION", "detect_boulders"]
