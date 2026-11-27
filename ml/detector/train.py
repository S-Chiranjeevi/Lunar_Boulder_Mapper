"""Train and evaluate the MoonSafe prototype detector with Ultralytics YOLO."""

from __future__ import annotations

import argparse
import json
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import TrainConfig
from .dataset import validate_prepared_dataset
from .training import train_boulder_detector


def run_training(
    *,
    dataset: Path,
    project: Path,
    run_name: str,
    weights: str,
    epochs: int,
    image_size: int,
    batch: int,
    device: str,
    seed: int,
    workers: int,
    fraction: float,
) -> dict[str, Any]:
    """Train with the prepared train/val splits, then measure held-out test metrics."""
    from ultralytics import YOLO  # type: ignore[import-not-found]

    dataset_summary = validate_prepared_dataset(dataset)
    split_summary_path = dataset_summary.root_dir / "split_summary.json"
    if not split_summary_path.is_file():
        raise ValueError(f"Dataset split provenance is required: {split_summary_path}")
    split_summary = json.loads(split_summary_path.read_text(encoding="utf-8"))
    if split_summary.get("zero_group_leakage_verified") is not True:
        raise ValueError("Dataset must verify zero source-observation/site leakage before training")
    test_images_dir = dataset_summary.root_dir / "images" / "test"
    if not test_images_dir.is_dir():
        raise ValueError(f"Held-out test images are required for evaluation: {test_images_dir}")
    test_image_count = sum(
        1
        for path in test_images_dir.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
    )
    if test_image_count == 0:
        raise ValueError(f"Held-out test split contains no images: {test_images_dir}")
    config = TrainConfig(
        dataset_path=dataset,
        base_weights=weights,
        model_version=f"{Path(weights).stem}-moonsafe-prototype",
        image_size=image_size,
        epochs=epochs,
        batch_size=batch,
        device=device,
        project_dir=project,
        run_name=run_name,
        seed=seed,
        workers=workers,
        fraction=fraction,
    )
    training = train_boulder_detector(config)
    best_path = training.get("best_weights_path")
    if not best_path:
        raise RuntimeError("Training finished without writing best.pt; no evaluation was run.")

    model = YOLO(best_path)
    test_results = model.val(
        data=str(dataset_summary.data_yaml_path),
        split="test",
        imgsz=image_size,
        batch=batch,
        device=device,
        workers=workers,
        plots=True,
        project=str(project),
        name=f"{run_name}-test",
    )
    metrics = {
        str(name): float(value)
        for name, value in getattr(test_results, "results_dict", {}).items()
    }
    report = {
        "status": "completed",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "purpose": "prototype boulder detection; screening aid, not safety validation",
        "source_dataset": "BOULDERING, Zenodo 14250874, DOI 10.5281/zenodo.14250874",
        "source_license": "CC-BY-4.0",
        "model_version": config.model_version,
        "ultralytics_version": __import__("ultralytics").__version__,
        "python_version": platform.python_version(),
        "device": device,
        "initial_weights": weights,
        "best_weights_path": str(Path(best_path).resolve()),
        "training": {
            "epochs_requested": epochs,
            "image_size_px": image_size,
            "batch_size": batch,
            "seed": seed,
            "workers": workers,
            "training_fraction": fraction,
            "close_mosaic_epochs": min(10, max(0, epochs - 1)),
            "train_images_available": dataset_summary.train_images,
            "train_images_used": max(1, round(dataset_summary.train_images * fraction)),
            "validation_images": dataset_summary.val_images,
            "test_images": test_image_count,
            "group_leakage_verified": split_summary["zero_group_leakage_verified"],
            "split_counts": split_summary.get("splits", {}),
            "data_yaml": str(dataset_summary.data_yaml_path.resolve()),
            "training_run_dir": training["save_dir"],
        },
        "evaluation": {
            "split": "test",
            "metrics": metrics,
            "results_dir": str(getattr(test_results, "save_dir", "")),
        },
        "limitations": [
            "Held-out source observations from one curated dataset; external validation is absent.",
            "This report does not validate safety, geolocation, or physical boulder-size estimates.",
            "BOULDERING labels and image selection reflect the source dataset curation.",
        ],
    }
    report_path = Path(training["save_dir"]) / "evaluation_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report["report_path"] = str(report_path.resolve())
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset", type=Path, required=True, help="Prepared YOLO dataset directory."
    )
    parser.add_argument("--project", type=Path, default=Path("runs/moonsafe"))
    parser.add_argument("--name", default="lunar-boulder-prototype")
    parser.add_argument(
        "--weights", default="yolov8n.pt", help="Initial Ultralytics checkpoint or model name."
    )
    parser.add_argument(
        "--epochs", type=int, default=5, help="Short prototype run; configure for experiments."
    )
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="cpu", help="Ultralytics device, e.g. cpu or 0.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--workers", type=int, default=0, help="Use 0 for portability on Windows.")
    parser.add_argument(
        "--fraction",
        type=float,
        default=0.1,
        help="Fraction of the train split to use; validation and test remain complete.",
    )
    args = parser.parse_args(argv)
    if args.epochs <= 0 or args.image_size <= 0 or args.batch <= 0:
        parser.error("epochs, image-size, and batch must be positive")
    if not 0 < args.fraction <= 1:
        parser.error("fraction must be in (0, 1]")

    report = run_training(
        dataset=args.dataset,
        project=args.project,
        run_name=args.name,
        weights=args.weights,
        epochs=args.epochs,
        image_size=args.image_size,
        batch=args.batch,
        device=args.device,
        seed=args.seed,
        workers=args.workers,
        fraction=args.fraction,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
