"""Consume and validate YOLO dataset-preparation outputs before training."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .exceptions import DatasetUnavailableError

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}


@dataclass(frozen=True)
class PreparedDatasetSummary:
    """Validated summary of a prepared YOLO boulder dataset."""

    data_yaml_path: Path
    root_dir: Path
    train_images: int
    train_labels: int
    val_images: int
    val_labels: int
    class_names: dict[int, str]


def _parse_simple_yaml(text: str) -> dict[str, Any]:
    """Parse YAML via PyYAML if installed, or a minimal fallback for data.yaml."""
    try:
        import yaml  # type: ignore[import-not-found]

        loaded = yaml.safe_load(text)
        return dict(loaded) if isinstance(loaded, Mapping) else {}
    except ImportError:
        pass

    data: dict[str, Any] = {}
    current_map_key: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if current_map_key is not None and (line.startswith(" ") or line.startswith("\t")):
            stripped = line.strip()
            if ":" in stripped:
                k, v = stripped.split(":", 1)
                target = data.setdefault(current_map_key, {})
                if isinstance(target, dict):
                    key_parsed: Any = int(k.strip()) if k.strip().isdigit() else k.strip()
                    target[key_parsed] = v.strip().strip("'\"")
                continue
        current_map_key = None
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip()
        if not val:
            data[key] = {}
            current_map_key = key
        elif val.startswith("[") and val.endswith("]"):
            items = [item.strip().strip("'\"") for item in val[1:-1].split(",") if item.strip()]
            data[key] = items
        else:
            val_clean = val.strip("'\"")
            data[key] = int(val_clean) if val_clean.isdigit() else val_clean
    return data


def _resolve_data_yaml(dataset_path: str | Path) -> Path:
    path = Path(dataset_path)
    if path.is_file():
        if path.suffix.lower() == ".json":
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise DatasetUnavailableError(f"Could not read dataset manifest {path}: {exc}") from exc
            yaml_ref = manifest.get("data_yaml") or manifest.get("yaml_path")
            if not yaml_ref:
                raise DatasetUnavailableError(f"Dataset manifest {path} does not specify data_yaml")
            resolved = (path.parent / yaml_ref).resolve() if not Path(yaml_ref).is_absolute() else Path(yaml_ref)
            if not resolved.is_file():
                raise DatasetUnavailableError(f"Referenced data.yaml does not exist: {resolved}")
            return resolved
        return path

    if path.is_dir():
        for candidate_name in ("data.yaml", "dataset.yaml"):
            candidate = path / candidate_name
            if candidate.is_file():
                return candidate
        manifest_path = path / "dataset_manifest.json"
        if manifest_path.is_file():
            return _resolve_data_yaml(manifest_path)

    raise DatasetUnavailableError(
        f"Prepared YOLO dataset definition (data.yaml) not found at {path}"
    )


def _count_split(images_dir: Path) -> tuple[int, int]:
    if not images_dir.is_dir():
        return (0, 0)
    images = [p for p in images_dir.rglob("*") if p.is_file() and p.suffix.lower() in _IMAGE_EXTENSIONS]
    # Standard Ultralytics layout maps .../images/<split>/foo.png -> .../labels/<split>/foo.txt
    labels_found = 0
    for img_path in images:
        parts = list(img_path.parts)
        label_candidates = [img_path.with_suffix(".txt")]
        if "images" in parts:
            idx = len(parts) - 1 - parts[::-1].index("images")
            label_parts = list(parts)
            label_parts[idx] = "labels"
            label_candidates.insert(0, Path(*label_parts).with_suffix(".txt"))
        for lbl_path in label_candidates:
            if lbl_path.is_file():
                _validate_yolo_label_file(lbl_path)
                labels_found += 1
                break
    return (len(images), labels_found)


def _validate_yolo_label_file(label_path: Path) -> None:
    content = label_path.read_text(encoding="utf-8").strip()
    if not content:
        return
    for line_no, raw_line in enumerate(content.splitlines(), start=1):
        tokens = raw_line.strip().split()
        if len(tokens) < 5:
            raise DatasetUnavailableError(
                f"Invalid YOLO label format in {label_path}:{line_no} (expected 'class cx cy w h')"
            )
        try:
            int(tokens[0])
            cx, cy, w, h = (float(t) for t in tokens[1:5])
        except ValueError as exc:
            raise DatasetUnavailableError(f"Non-numeric YOLO label in {label_path}:{line_no}") from exc
        if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0):
            raise DatasetUnavailableError(
                f"YOLO box values out of normalized [0, 1] bounds in {label_path}:{line_no}"
            )


def validate_prepared_dataset(dataset_path: str | Path) -> PreparedDatasetSummary:
    """Validate that a prepared YOLO dataset has images and real labels ready for training."""
    yaml_path = _resolve_data_yaml(dataset_path)
    parsed = _parse_simple_yaml(yaml_path.read_text(encoding="utf-8"))

    raw_root = parsed.get("path")
    root_dir = (
        (yaml_path.parent / raw_root).resolve()
        if raw_root and not Path(str(raw_root)).is_absolute()
        else (Path(str(raw_root)) if raw_root else yaml_path.parent.resolve())
    )

    train_rel = parsed.get("train")
    val_rel = parsed.get("val")
    if not train_rel:
        raise DatasetUnavailableError(f"Dataset YAML {yaml_path} is missing a 'train' split path")

    train_dir = (root_dir / str(train_rel)).resolve() if not Path(str(train_rel)).is_absolute() else Path(str(train_rel))
    train_images, train_labels = _count_split(train_dir)
    if train_images == 0 or train_labels == 0:
        raise DatasetUnavailableError(
            f"Prepared training split lacks labeled images (images={train_images}, labels={train_labels}) at {train_dir}"
        )

    val_images = 0
    val_labels = 0
    if val_rel:
        val_dir = (root_dir / str(val_rel)).resolve() if not Path(str(val_rel)).is_absolute() else Path(str(val_rel))
        val_images, val_labels = _count_split(val_dir)

    raw_names = parsed.get("names", {0: "boulder"})
    if isinstance(raw_names, list):
        class_names = {idx: str(name) for idx, name in enumerate(raw_names)}
    elif isinstance(raw_names, Mapping):
        class_names = {int(k): str(v) for k, v in raw_names.items()}
    else:
        class_names = {0: "boulder"}

    return PreparedDatasetSummary(
        data_yaml_path=yaml_path,
        root_dir=root_dir,
        train_images=train_images,
        train_labels=train_labels,
        val_images=val_images,
        val_labels=val_labels,
        class_names=class_names,
    )
