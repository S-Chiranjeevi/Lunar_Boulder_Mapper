"""Training-ready PyTorch + Ultralytics YOLO pipeline for MoonSafe."""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import TrainConfig
from .dataset import PreparedDatasetSummary, validate_prepared_dataset
from .exceptions import DetectorDependencyError


@dataclass(frozen=True)
class TrainingPlan:
    """Readiness check for training a YOLO boulder detector from prepared data."""

    ready: bool
    dataset: PreparedDatasetSummary
    missing_dependencies: tuple[str, ...]
    base_weights: str
    notes: str


def prepare_training_plan(config: TrainConfig) -> TrainingPlan:
    """Validate prepared dataset labels and ML runtime readiness before training."""
    dataset = validate_prepared_dataset(config.dataset_path)
    missing: list[str] = []
    if importlib.util.find_spec("torch") is None:
        missing.append("torch")
    if importlib.util.find_spec("ultralytics") is None:
        missing.append("ultralytics")

    ready = not missing
    notes = (
        "Dataset labels and PyTorch/Ultralytics runtime verified; ready to train."
        if ready
        else f"Dataset verified ({dataset.train_images} train images), but missing packages: {', '.join(missing)}"
    )
    return TrainingPlan(
        ready=ready,
        dataset=dataset,
        missing_dependencies=tuple(missing),
        base_weights=str(config.base_weights),
        notes=notes,
    )


def train_boulder_detector(config: TrainConfig) -> dict[str, Any]:
    """Train an Ultralytics YOLO boulder model on prepared dataset output.

    Does not fabricate weights or training metrics when labels or runtime
    dependencies are unavailable.
    """
    plan = prepare_training_plan(config)
    if not plan.ready:
        raise DetectorDependencyError(
            f"Cannot start YOLO training; missing packages: {', '.join(plan.missing_dependencies)}"
        )

    from ultralytics import YOLO  # type: ignore[import-not-found]

    model = YOLO(str(config.base_weights))
    train_kwargs: dict[str, Any] = {
        "data": str(plan.dataset.data_yaml_path),
        "imgsz": config.image_size,
        "epochs": config.epochs,
        "batch": config.batch_size,
        "project": str(config.project_dir),
        "name": config.run_name,
        "seed": config.seed,
        "workers": config.workers,
    }
    if config.device is not None:
        train_kwargs["device"] = config.device
    if config.learning_rate is not None:
        train_kwargs["lr0"] = config.learning_rate

    results = model.train(**train_kwargs)
    save_dir = Path(getattr(results, "save_dir", Path(config.project_dir) / config.run_name))
    best_weights = save_dir / "weights" / "best.pt"

    return {
        "model_version": config.model_version,
        "data_yaml": str(plan.dataset.data_yaml_path),
        "save_dir": str(save_dir),
        "best_weights_path": str(best_weights) if best_weights.is_file() else None,
        "train_images": plan.dataset.train_images,
        "val_images": plan.dataset.val_images,
    }
