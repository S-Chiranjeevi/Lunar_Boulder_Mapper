"""Evaluation and lunar-subset loading for the BOULDERING dataset (Zenodo 14250874)."""

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any

from PIL import Image

from .bickel_policy import ExcludedTile
from .schema import CuratedBox, TileRecord

ZENODO_RECORD_ID = "14250874"
ZENODO_API_URL = f"https://zenodo.org/api/records/{ZENODO_RECORD_ID}"
BOULDERING_CITATION = (
    "Prieur, N., Amaro, B., Gonzalez, E., & Lapotre, M. (2024). "
    "Pre-processed (in Detectron2 and YOLO format) planetary images and boulder labels "
    "collected during the BOULDERING Marie Sklodowska-Curie Global fellowship. "
    "Zenodo record 14250874 (DOI: 10.5281/zenodo.14250874)."
)
BOULDERING_LICENSE = "CC-BY-4.0"

# LRO LROC NAC product IDs begin with M followed by 8-11 digits and optional L/R suffix
# (e.g. M121118602, M1234567890L).
_LRO_NAC_RE = re.compile(r"^(M\d{8,11}[LR]?)(?:_|$)", re.IGNORECASE)
# Mars HiRISE / CTX prefixes commonly present in mixed planetary datasets.
_MARS_OBS_RE = re.compile(r"^((?:ESP|PSP|TRA)_\d+_\d+|B\d{2}_\d+)", re.IGNORECASE)

_UPSTREAM_SPLIT_DIRS = ("train", "validation", "val", "test")
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff"}


@dataclass(frozen=True)
class ObservationClassification:
    """Result of classifying a BOULDERING tile filename by planetary body/source."""

    origin: str  # "lunar_lroc_nac" | "lunar_allowlisted" | "mars_excluded" | "unverified_excluded"
    source_observation_id: str
    is_lunar: bool


def check_zenodo_accessibility(
    record_id: str = ZENODO_RECORD_ID,
    *,
    timeout_s: float = 15.0,
) -> dict[str, Any]:
    """Query Zenodo's public REST API to verify metadata/file accessibility without inventing counts."""
    url = f"https://zenodo.org/api/records/{record_id}"
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as response:
            payload = json.loads(response.read().decode("utf-8"))
        metadata = payload.get("metadata", {})
        license_info = metadata.get("license")
        license_id = license_info.get("id") if isinstance(license_info, dict) else license_info
        return {
            "record_id": record_id,
            "accessible": True,
            "doi": payload.get("doi"),
            "title": metadata.get("title"),
            "license": license_id,
            "creators": [c.get("name") for c in metadata.get("creators", []) if isinstance(c, dict)],
            "files": [
                {"key": item.get("key"), "size_bytes": item.get("size")}
                for item in payload.get("files", [])
                if isinstance(item, dict)
            ],
            "error": None,
        }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        return {
            "record_id": record_id,
            "accessible": False,
            "doi": f"10.5281/zenodo.{record_id}",
            "title": None,
            "license": BOULDERING_LICENSE,
            "creators": [],
            "files": [],
            "error": str(exc),
        }


def load_lunar_allowlist(path: str | Path | None) -> set[str]:
    """Load an optional newline-delimited or JSON list of verified lunar observation IDs."""
    if path is None:
        return set()
    allow_path = Path(path)
    if not allow_path.is_file():
        raise FileNotFoundError(f"Lunar observation allowlist not found: {allow_path}")
    text = allow_path.read_text(encoding="utf-8").strip()
    if not text:
        return set()
    if allow_path.suffix.lower() == ".json":
        data = json.loads(text)
        if not isinstance(data, list):
            raise ValueError("JSON allowlist must contain an array of observation IDs or filenames")
        return {str(item).strip() for item in data if str(item).strip()}
    return {
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    }


def classify_observation_origin(
    filename_or_stem: str,
    *,
    lunar_allowlist: set[str] | None = None,
) -> ObservationClassification:
    """Identify whether a BOULDERING tile belongs to an LRO NAC lunar observation."""
    stem = Path(filename_or_stem).stem
    base_stem = re.sub(r"_image$", "", stem, flags=re.IGNORECASE)
    allowlist = lunar_allowlist or set()

    nac_match = _LRO_NAC_RE.match(base_stem)
    if nac_match:
        obs_id = nac_match.group(1).upper()
        return ObservationClassification("lunar_lroc_nac", obs_id, True)

    token = base_stem.split("_")[0]
    if base_stem in allowlist or stem in allowlist or token in allowlist:
        return ObservationClassification("lunar_allowlisted", token, True)

    mars_match = _MARS_OBS_RE.match(base_stem)
    if mars_match:
        return ObservationClassification("mars_excluded", mars_match.group(1).upper(), False)

    return ObservationClassification("unverified_excluded", token or base_stem, False)


def parse_yolo_label_file(
    label_path: Path,
    width_px: int,
    height_px: int,
) -> tuple[list[CuratedBox], dict[str, int]]:
    """Parse YOLOv8 box (5-col) or segmentation polygon (5+ even coords) labels into pixel boxes."""
    stats = {"box_rows": 0, "polygon_rows": 0, "skipped_degenerate": 0}
    if not label_path.is_file():
        return [], stats

    boxes: list[CuratedBox] = []
    for line_no, raw_line in enumerate(label_path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 5:
            raise ValueError(f"{label_path}:{line_no} expected >= 5 tokens, found {len(parts)}")

        raw_class = float(parts[0])
        if not math.isfinite(raw_class) or not raw_class.is_integer() or int(raw_class) != 0:
            raise ValueError(
                f"{label_path}:{line_no} expected the single boulder class ID 0; got {parts[0]!r}"
            )
        class_id = int(raw_class)
        try:
            coords = [float(value) for value in parts[1:]]
        except ValueError as exc:
            raise ValueError(f"{label_path}:{line_no} contains a non-numeric coordinate") from exc
        if not all(math.isfinite(value) for value in coords):
            raise ValueError(f"{label_path}:{line_no} contains a non-finite coordinate")
        if any(value < 0.0 or value > 1.0 for value in coords):
            raise ValueError(f"{label_path}:{line_no} normalized coordinates must be in [0, 1]")

        if len(coords) == 4:
            xc, yc, bw, bh = coords
            x_min = (xc - bw / 2.0) * width_px
            y_min = (yc - bh / 2.0) * height_px
            x_max = (xc + bw / 2.0) * width_px
            y_max = (yc + bh / 2.0) * height_px
            source_format = "yolo_box"
            stats["box_rows"] += 1
        elif len(coords) >= 6 and len(coords) % 2 == 0:
            xs = [coords[i] * width_px for i in range(0, len(coords), 2)]
            ys = [coords[i + 1] * height_px for i in range(0, len(coords), 2)]
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)
            source_format = "yolo_polygon"
            stats["polygon_rows"] += 1
        else:
            raise ValueError(
                f"{label_path}:{line_no} invalid coordinate count {len(coords)} "
                "(expected 4 for box or even >= 6 for polygon)"
            )

        x_min_c = max(0.0, min(float(width_px), x_min))
        y_min_c = max(0.0, min(float(height_px), y_min))
        x_max_c = max(0.0, min(float(width_px), x_max))
        y_max_c = max(0.0, min(float(height_px), y_max))
        if x_max_c <= x_min_c or y_max_c <= y_min_c:
            stats["skipped_degenerate"] += 1
            continue

        boxes.append(
            CuratedBox(
                x_min_px=x_min_c,
                y_min_px=y_min_c,
                x_max_px=x_max_c,
                y_max_px=y_max_c,
                class_id=class_id,
                class_name="boulder",
                source_format=source_format,
                reviewed_for_standalone_boulder=True,
            )
        )
    return boxes, stats


def _resolve_bouldering_root(dataset_root: Path) -> Path:
    if (dataset_root / "boulder2024").is_dir():
        return dataset_root / "boulder2024"
    return dataset_root


def _read_image_size(image_path: Path) -> tuple[int, int]:
    with Image.open(image_path) as image:
        width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid image dimensions in {image_path}: {width}x{height}")
    return int(width), int(height)


def load_bouldering_lunar_tiles(
    dataset_root: str | Path,
    *,
    allowlist_path: str | Path | None = None,
    gsd_lookup: dict[str, tuple[float, float]] | None = None,
) -> tuple[list[TileRecord], list[ExcludedTile], dict[str, Any]]:
    """Load verified lunar tiles from a local BOULDERING (Zenodo 14250874) extraction."""
    root = _resolve_bouldering_root(Path(dataset_root))
    if not root.is_dir():
        raise FileNotFoundError(f"BOULDERING dataset directory not found: {root}")

    allowlist = load_lunar_allowlist(allowlist_path)
    lunar_tiles: list[TileRecord] = []
    excluded: list[ExcludedTile] = []

    upstream_obs_splits: dict[str, set[str]] = defaultdict(set)
    origin_counts: dict[str, int] = defaultdict(int)
    label_stats = {"box_rows": 0, "polygon_rows": 0, "skipped_degenerate": 0, "missing_label_files": 0}
    box_widths_px: list[float] = []
    box_heights_px: list[float] = []

    split_dirs = [root / name for name in _UPSTREAM_SPLIT_DIRS if (root / name / "images").is_dir()]
    if not split_dirs and (root / "images").is_dir():
        split_dirs = [root]

    for split_dir in split_dirs:
        upstream_split = split_dir.name if split_dir != root else "unspecified"
        images_dir = split_dir / "images"
        labels_dir = split_dir / "labels"

        for image_path in sorted(images_dir.iterdir()):
            if not image_path.is_file() or image_path.suffix.lower() not in _IMAGE_EXTS:
                continue

            classification = classify_observation_origin(
                image_path.name,
                lunar_allowlist=allowlist,
            )
            origin_counts[classification.origin] += 1

            if not classification.is_lunar:
                excluded.append(
                    ExcludedTile(
                        image_id=image_path.stem,
                        source_observation_id=classification.source_observation_id,
                        label_source=f"BOULDERING (Zenodo {ZENODO_RECORD_ID})",
                        reason_code=classification.origin.upper(),
                        detail=(
                            f"Excluded non-lunar or unverified planetary tile '{image_path.name}' "
                            f"(origin={classification.origin})."
                        ),
                    )
                )
                continue

            upstream_obs_splits[classification.source_observation_id].add(upstream_split)
            width_px, height_px = _read_image_size(image_path)
            label_path = labels_dir / f"{image_path.stem}.txt"
            if not label_path.is_file():
                label_stats["missing_label_files"] += 1
                excluded.append(
                    ExcludedTile(
                        image_id=re.sub(r"_image$", "", image_path.stem, flags=re.IGNORECASE),
                        source_observation_id=classification.source_observation_id,
                        label_source=f"BOULDERING (Zenodo {ZENODO_RECORD_ID})",
                        reason_code="MISSING_LABEL_FILE",
                        detail="Excluded: missing annotation file is not evidence of a negative tile.",
                    )
                )
                continue
            else:
                boxes, file_stats = parse_yolo_label_file(label_path, width_px, height_px)
                label_stats["box_rows"] += file_stats["box_rows"]
                label_stats["polygon_rows"] += file_stats["polygon_rows"]
                label_stats["skipped_degenerate"] += file_stats["skipped_degenerate"]

            for box in boxes:
                box_widths_px.append(box.x_max_px - box.x_min_px)
                box_heights_px.append(box.y_max_px - box.y_min_px)

            gsd_x, gsd_y = (None, None)
            if gsd_lookup and classification.source_observation_id in gsd_lookup:
                gsd_x, gsd_y = gsd_lookup[classification.source_observation_id]

            lunar_tiles.append(
                TileRecord(
                    image_id=re.sub(r"_image$", "", image_path.stem, flags=re.IGNORECASE),
                    source_observation_id=classification.source_observation_id,
                    site_id=None,
                    image_path=image_path,
                    width_px=width_px,
                    height_px=height_px,
                    gsd_x_m_per_px=gsd_x,
                    gsd_y_m_per_px=gsd_y,
                    coordinate_units="image_px",
                    label_source=f"BOULDERING (Zenodo {ZENODO_RECORD_ID})",
                    license=BOULDERING_LICENSE,
                    task_type="standalone_boulder",
                    reviewed_for_standalone_boulder=True,
                    provenance_notes=(
                        f"origin={classification.origin}; upstream_split={upstream_split}; "
                        f"citation={BOULDERING_CITATION}"
                    ),
                    upstream_split=upstream_split,
                    boxes=boxes,
                )
            )

    leaked_upstream_obs = sorted(
        obs_id for obs_id, seen_splits in upstream_obs_splits.items() if len(seen_splits) > 1
    )

    report = {
        "dataset": "BOULDERING",
        "zenodo_record_id": ZENODO_RECORD_ID,
        "doi": f"10.5281/zenodo.{ZENODO_RECORD_ID}",
        "license": BOULDERING_LICENSE,
        "dataset_root": str(root),
        "origin_counts": dict(origin_counts),
        "lunar_tile_count": len(lunar_tiles),
        "lunar_unique_observations": len(upstream_obs_splits),
        "lunar_labeled_tile_count": sum(1 for tile in lunar_tiles if tile.boxes),
        "lunar_empty_tile_count": sum(1 for tile in lunar_tiles if not tile.boxes),
        "lunar_total_boulders": sum(len(tile.boxes) for tile in lunar_tiles),
        "upstream_cross_split_observations": leaked_upstream_obs,
        "upstream_leakage_detected": bool(leaked_upstream_obs),
        "label_geometry_stats": label_stats,
        "boulder_bbox_px_summary": {
            "min_width_px": round(min(box_widths_px), 2) if box_widths_px else None,
            "median_width_px": round(median(box_widths_px), 2) if box_widths_px else None,
            "max_width_px": round(max(box_widths_px), 2) if box_widths_px else None,
            "min_height_px": round(min(box_heights_px), 2) if box_heights_px else None,
            "median_height_px": round(median(box_heights_px), 2) if box_heights_px else None,
            "max_height_px": round(max(box_heights_px), 2) if box_heights_px else None,
        },
    }
    return lunar_tiles, excluded, report
