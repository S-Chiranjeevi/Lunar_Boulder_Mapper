"""MoonSafe YOLO boulder detector module."""

from .config import DetectorConfig, TrainConfig
from .dataset import PreparedDatasetSummary, validate_prepared_dataset
from .exceptions import (
    DatasetUnavailableError,
    DetectorDependencyError,
    DetectorError,
    MissingWeightsError,
)
from .inference import BoulderDetector, check_inference_availability, detect_boulders
from .slicing import TileWindow, box_iou_and_ios, generate_tile_windows, merge_tile_detections
from .training import TrainingPlan, prepare_training_plan, train_boulder_detector

__all__ = [
    "BoulderDetector",
    "DatasetUnavailableError",
    "DetectorConfig",
    "DetectorDependencyError",
    "DetectorError",
    "MissingWeightsError",
    "PreparedDatasetSummary",
    "TileWindow",
    "TrainConfig",
    "TrainingPlan",
    "box_iou_and_ios",
    "check_inference_availability",
    "detect_boulders",
    "generate_tile_windows",
    "merge_tile_detections",
    "prepare_training_plan",
    "train_boulder_detector",
    "validate_prepared_dataset",
]
