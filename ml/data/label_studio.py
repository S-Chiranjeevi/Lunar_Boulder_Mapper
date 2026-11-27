"""Label Studio JSON annotation export converter for MoonSafe LRO NAC tiles."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PIL import Image

from .schema import CuratedBox, TaskType, TileRecord


def _extract_image_path(task: dict[str, Any], images_dir: Path | None) -> Path | None:
    data = task.get("data") or {}
    candidates = [
        data.get("local_path"),
        data.get("image_path"),
        data.get("image"),
    ]
    for raw in candidates:
        if not raw or not isinstance(raw, str):
            continue
        cleaned = raw.split("?d=")[-1]
        direct = Path(cleaned)
        if direct.is_file():
            return direct
        if images_dir is not None:
            joined = images_dir / direct.name
            if joined.is_file():
                return joined
    return None


def _resolve_dimensions(
    task: dict[str, Any],
    results: list[dict[str, Any]],
    image_path: Path | None,
) -> tuple[int, int]:
    data = task.get("data") or {}
    width = data.get("width_px")
    height = data.get("height_px")
    if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
        return width, height

    for result in results:
        ow = result.get("original_width")
        oh = result.get("original_height")
        if isinstance(ow, int) and isinstance(oh, int) and ow > 0 and oh > 0:
            return ow, oh

    if image_path is not None and image_path.is_file():
        with Image.open(image_path) as image:
            w, h = image.size
        if w > 0 and h > 0:
            return int(w), int(h)

    raise ValueError(
        f"Task {task.get('id')} is missing width_px/height_px, original_width/original_height, "
        "and a readable local image_path."
    )


def load_label_studio_export(
    export_path: str | Path,
    *,
    images_dir: str | Path | None = None,
    default_license: str = "not-specified",
    default_label_source: str = "Label Studio NAC Curation",
) -> list[TileRecord]:
    """Parse a Label Studio JSON export into curated ``TileRecord`` objects.

    Supports ``rectanglelabels`` items expressed in Label Studio's 0-100% coordinate
    convention. Preserves ``image_id``, ``source_observation_id``, ``site_id``, GSD,
    provenance, and rockfall/review flags without inventing missing fields.
    """
    json_path = Path(export_path)
    if not json_path.is_file():
        raise FileNotFoundError(f"Label Studio export file not found: {json_path}")

    raw_tasks = json.loads(json_path.read_text(encoding="utf-8"))
    if not isinstance(raw_tasks, list):
        raise ValueError("Label Studio JSON export must contain a top-level array of tasks")

    resolved_images_dir = Path(images_dir) if images_dir is not None else None
    records: list[TileRecord] = []

    for index, task in enumerate(raw_tasks):
        if not isinstance(task, dict):
            raise ValueError(f"Label Studio task at index {index} must be a JSON object")

        data = task.get("data") or {}
        annotations = task.get("annotations") or []
        active_annotation = next(
            (ann for ann in annotations if isinstance(ann, dict) and not ann.get("was_cancelled")),
            None,
        )
        results = (active_annotation or {}).get("result") or []

        image_path = _extract_image_path(task, resolved_images_dir)
        width_px, height_px = _resolve_dimensions(task, results, image_path)

        raw_image_ref = str(data.get("image") or data.get("local_path") or "")
        image_id = str(
            data.get("image_id")
            or (image_path.stem if image_path is not None else Path(raw_image_ref).stem)
            or f"ls_task_{task.get('id', index)}"
        )
        source_obs_id = str(
            data.get("source_observation_id")
            or data.get("source_image_id")
            or ""
        )
        if not source_obs_id.strip():
            raise ValueError(
                f"Task {task.get('id', index)} is missing source_observation_id/source_image_id; "
                "provide the source observation to prevent tile leakage across splits."
            )
        site_id = str(data["site_id"]) if data.get("site_id") else None

        task_type_raw = str(data.get("task_type") or "standalone_boulder")
        task_type: TaskType = (
            task_type_raw
            if task_type_raw in {"standalone_boulder", "rockfall", "other"}
            else "other"
        )
        reviewed = bool(data.get("reviewed_for_standalone_boulder", False))

        boxes: list[CuratedBox] = []
        for item in results:
            if not isinstance(item, dict) or item.get("type") != "rectanglelabels":
                continue
            value = item.get("value") or {}
            rotation = float(value.get("rotation", 0.0) or 0.0)
            if abs(rotation) > 1e-3:
                raise ValueError(
                    f"Task {image_id} contains rotated rectangle (rotation={rotation}); "
                    "MoonSafe YOLO box conversion requires axis-aligned boxes or explicit review."
                )

            x_pct = float(value["x"])
            y_pct = float(value["y"])
            w_pct = float(value["width"])
            h_pct = float(value["height"])
            labels = value.get("rectanglelabels") or ["boulder"]
            label_name = str(labels[0]).strip().lower()
            if label_name not in {"boulder", "standalone boulder", "standalone_boulder"}:
                raise ValueError(
                    f"Task {image_id} contains rectangle label '{label_name}', which is not "
                    "a boulder label. Curate/relabel it explicitly before YOLO conversion."
                )

            x_min = max(0.0, (x_pct / 100.0) * width_px)
            y_min = max(0.0, (y_pct / 100.0) * height_px)
            x_max = min(float(width_px), ((x_pct + w_pct) / 100.0) * width_px)
            y_max = min(float(height_px), ((y_pct + h_pct) / 100.0) * height_px)
            if x_max <= x_min or y_max <= y_min:
                continue

            boxes.append(
                CuratedBox(
                    x_min_px=x_min,
                    y_min_px=y_min,
                    x_max_px=x_max,
                    y_max_px=y_max,
                    class_id=0,
                    class_name=label_name or "boulder",
                    source_format="label_studio_rect",
                    reviewed_for_standalone_boulder=reviewed,
                )
            )

        ann_id = active_annotation.get("id") if isinstance(active_annotation, dict) else None
        records.append(
            TileRecord(
                image_id=image_id,
                source_observation_id=source_obs_id,
                site_id=site_id,
                image_path=image_path,
                width_px=width_px,
                height_px=height_px,
                gsd_x_m_per_px=(
                    float(data["gsd_x_m_per_px"]) if data.get("gsd_x_m_per_px") is not None else None
                ),
                gsd_y_m_per_px=(
                    float(data["gsd_y_m_per_px"]) if data.get("gsd_y_m_per_px") is not None else None
                ),
                coordinate_units=str(data.get("coordinate_units") or "image_px"),
                label_source=str(data.get("label_source") or default_label_source),
                license=str(data.get("license") or default_license),
                task_type=task_type,
                reviewed_for_standalone_boulder=reviewed,
                provenance_notes=str(
                    data.get("provenance_notes")
                    or f"label_studio_task_id={task.get('id')}; annotation_id={ann_id}"
                ),
                boxes=boxes,
            )
        )

    return records
