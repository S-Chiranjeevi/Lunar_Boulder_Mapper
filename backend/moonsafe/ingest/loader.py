"""Read image dimensions and trustworthy metadata without inventing georeferencing.

Raster decoding is delegated to Pillow, which supports common PNG, JPEG, and TIFF
images. Product-specific formats can be added when the repository establishes a
format/dependency convention.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Mapping


class ImageIngestionError(ValueError):
    """Raised when an image, manifest, or metadata value is invalid."""


def _positive_optional_number(value: Any, name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ImageIngestionError(f"{name} must be a positive number or null")
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise ImageIngestionError(f"{name} must be a positive finite number or null")
    return result


def _valid_transform(value: Any) -> bool:
    """Accept an explicitly declared 2D affine pixel-to-lunar-meter transform."""
    if not isinstance(value, Mapping):
        return False
    if value.get("type") != "affine_2d" or value.get("units") != "m":
        return False
    matrix = value.get("matrix")
    if not isinstance(matrix, (list, tuple)) or len(matrix) != 3:
        return False
    if any(not isinstance(row, (list, tuple)) or len(row) != 3 for row in matrix):
        return False
    try:
        numbers = [float(item) for row in matrix for item in row]
    except (TypeError, ValueError):
        return False
    if not all(math.isfinite(item) for item in numbers) or numbers[6:] != [0.0, 0.0, 1.0]:
        return False
    # Reject a collapsed coordinate mapping: it cannot locate pixels in a 2D frame.
    return numbers[0] * numbers[4] - numbers[1] * numbers[3] != 0


def _read_manifest(path: Path) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ImageIngestionError(f"Could not read manifest {path}: {exc}") from exc
    if not isinstance(value, Mapping):
        raise ImageIngestionError("Manifest must contain a JSON object")
    return value


def load_image_metadata(
    image_path: str | Path,
    manifest_path: str | Path | None = None,
    *,
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Load an image and return the shared ``ImageMetadata`` JSON shape.

    Metadata precedence is explicit ``metadata``, then a JSON sidecar (when
    supplied), then safe defaults. Width and height always come from the decoded
    image. By default the sidecar is ``<image filename>.json`` if that file exists.
    Unknown coverage is reported as ``missing``; absent GSD/transform stay null.
    """
    path = Path(image_path)
    if not path.is_file():
        raise ImageIngestionError(f"Image does not exist or is not a file: {path}")

    if metadata is not None and not isinstance(metadata, Mapping):
        raise ImageIngestionError("metadata must be a mapping")
    sidecar = Path(manifest_path) if manifest_path is not None else path.with_name(path.name + ".json")
    manifest: Mapping[str, Any] = _read_manifest(sidecar) if sidecar.is_file() else {}
    supplied = {**manifest, **(dict(metadata) if metadata is not None else {})}

    try:
        from PIL import Image
    except ImportError as exc:
        raise ImageIngestionError("Pillow is required to read local raster images (pip install Pillow)") from exc

    try:
        with Image.open(path) as image:
            width, height = image.size
            image.verify()
    except Exception as exc:
        raise ImageIngestionError(f"Could not decode image {path}: {exc}") from exc
    if width <= 0 or height <= 0:
        raise ImageIngestionError("Decoded image dimensions must be positive")

    coverage = supplied.get("coverage", "missing")
    if coverage not in {"valid", "partial", "missing"}:
        raise ImageIngestionError("coverage must be valid, partial, or missing")

    transform = supplied.get("image_to_lunar")
    has_transform = _valid_transform(transform)
    # A transform is meaningful only when its coordinate frame is explicitly
    # declared. Unsupported or incomplete values are omitted, never guessed.
    coordinate_frame = supplied.get("coordinate_frame")
    if coordinate_frame == "lunar_local_m" and has_transform:
        retained_transform = dict(transform)
    else:
        coordinate_frame = "image_px"
        retained_transform = None

    image_id = supplied.get("image_id") or path.stem
    source_image_id = supplied.get("source_image_id") or image_id
    if not isinstance(image_id, str) or not image_id.strip():
        raise ImageIngestionError("image_id must be a non-empty string")
    if not isinstance(source_image_id, str) or not source_image_id.strip():
        raise ImageIngestionError("source_image_id must be a non-empty string")

    return {
        "image_id": image_id,
        "source_image_id": source_image_id,
        "width_px": int(width),
        "height_px": int(height),
        "gsd_x_m_per_px": _positive_optional_number(supplied.get("gsd_x_m_per_px"), "gsd_x_m_per_px"),
        "gsd_y_m_per_px": _positive_optional_number(supplied.get("gsd_y_m_per_px"), "gsd_y_m_per_px"),
        "coverage": coverage,
        "coordinate_frame": coordinate_frame,
        "image_to_lunar": retained_transform,
    }
