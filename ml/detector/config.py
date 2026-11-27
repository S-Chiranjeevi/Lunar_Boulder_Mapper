"""Configuration dataclasses for MoonSafe YOLO boulder detection and training."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

MergeStrategy = Literal["nms", "wbf"]
SlicingBackend = Literal["auto", "builtin", "sahi"]


@dataclass(frozen=True)
class DetectorConfig:
    """Configuration for Ultralytics YOLO boulder box detection.

    Note: ``weights_path`` defaults to ``None``. Inference refuses to run until
    real trained weights are supplied.
    """

    model_version: str = "yolo-lunar-boulder-untrained"
    weights_path: str | Path | None = None
    image_size: int = 640
    confidence_threshold: float = 0.25
    iou_threshold: float = 0.45
    tile_size: int | tuple[int, int] | None = 640
    tile_overlap_ratio: float = 0.2
    merge_iou_threshold: float = 0.5
    merge_ios_threshold: float = 0.8
    merge_strategy: MergeStrategy = "nms"
    slicing_backend: SlicingBackend = "auto"
    max_detections: int = 1000
    boulder_class_id: int = 0
    device: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.model_version, str) or not self.model_version.strip():
            raise ValueError("model_version must be a non-empty string")
        if self.image_size <= 0:
            raise ValueError("image_size must be > 0")
        if not (0.0 <= self.confidence_threshold <= 1.0):
            raise ValueError("confidence_threshold must be in [0.0, 1.0]")
        if not (0.0 < self.iou_threshold <= 1.0):
            raise ValueError("iou_threshold must be in (0.0, 1.0]")
        if self.tile_size is not None:
            tw, th = (
                (self.tile_size, self.tile_size)
                if isinstance(self.tile_size, int)
                else self.tile_size
            )
            if tw <= 0 or th <= 0:
                raise ValueError("tile_size dimensions must be > 0")
        if not (0.0 <= self.tile_overlap_ratio < 0.9):
            raise ValueError("tile_overlap_ratio must be in [0.0, 0.9)")
        if not (0.0 < self.merge_iou_threshold <= 1.0):
            raise ValueError("merge_iou_threshold must be in (0.0, 1.0]")
        if not (0.0 < self.merge_ios_threshold <= 1.0):
            raise ValueError("merge_ios_threshold must be in (0.0, 1.0]")
        if self.merge_strategy not in {"nms", "wbf"}:
            raise ValueError("merge_strategy must be 'nms' or 'wbf'")
        if self.slicing_backend not in {"auto", "builtin", "sahi"}:
            raise ValueError("slicing_backend must be 'auto', 'builtin', or 'sahi'")
        if self.max_detections <= 0:
            raise ValueError("max_detections must be > 0")

    @property
    def tile_dimensions(self) -> tuple[int, int] | None:
        if self.tile_size is None:
            return None
        if isinstance(self.tile_size, int):
            return (self.tile_size, self.tile_size)
        return (int(self.tile_size[0]), int(self.tile_size[1]))


@dataclass(frozen=True)
class TrainConfig:
    """Training configuration consuming dataset-preparation output."""

    dataset_path: str | Path
    base_weights: str | Path = "yolov8n.pt"
    model_version: str = "yolov8n-lunar-boulder"
    image_size: int = 640
    epochs: int = 50
    batch_size: int = 16
    device: str | None = None
    project_dir: str | Path = "runs/detect"
    run_name: str = "moonsafe_boulder"
    learning_rate: float | None = None
    seed: int = 42
    workers: int = 4

    def __post_init__(self) -> None:
        if self.image_size <= 0:
            raise ValueError("image_size must be > 0")
        if self.epochs <= 0:
            raise ValueError("epochs must be > 0")
        if self.batch_size <= 0:
            raise ValueError("batch_size must be > 0")
