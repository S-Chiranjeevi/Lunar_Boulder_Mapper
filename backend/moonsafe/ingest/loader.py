"""Validate local NAC rasters and extract only source-supported metadata."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any, Mapping

SUPPORTED_IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".tif", ".tiff"})
DEFAULT_MAX_IMAGE_BYTES = 2 * 1024**3
MAX_MANIFEST_BYTES = 1 * 1024**2

_EXPECTED_FORMATS = {
    ".png": {"PNG"},
    ".jpg": {"JPEG"},
    ".jpeg": {"JPEG"},
    ".tif": {"TIFF"},
    ".tiff": {"TIFF"},
}
_UNIT_TO_METERS = {
    "metre": 1.0,
    "meter": 1.0,
    "meters": 1.0,
    "metres": 1.0,
    "kilometer": 1000.0,
    "kilometre": 1000.0,
    "foot": 0.3048,
    "feet": 0.3048,
    "us survey foot": 1200.0 / 3937.0,
}


class ImageIngestionError(ValueError):
    """Raised when an image, manifest, or metadata value is invalid."""


def _max_image_bytes() -> int:
    raw = os.getenv("MOONSAFE_MAX_IMAGE_BYTES")
    if raw is None:
        return DEFAULT_MAX_IMAGE_BYTES
    try:
        limit = int(raw)
    except ValueError as exc:
        raise ImageIngestionError("MOONSAFE_MAX_IMAGE_BYTES must be a positive integer") from exc
    if limit <= 0:
        raise ImageIngestionError("MOONSAFE_MAX_IMAGE_BYTES must be a positive integer")
    return limit


def validate_image_file(
    image_path: str | Path,
    *,
    max_bytes: int | None = None,
) -> Path:
    """Validate path, supported suffix, non-empty content, and configured size cap."""
    path = Path(image_path)
    if not path.is_file():
        raise ImageIngestionError(f"Image does not exist or is not a file: {path}")
    if path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
        allowed = ", ".join(sorted(SUPPORTED_IMAGE_SUFFIXES))
        raise ImageIngestionError(f"Unsupported image file type '{path.suffix}'. Allowed suffixes: {allowed}")
    size = path.stat().st_size
    if size == 0:
        raise ImageIngestionError("Image file is empty")
    limit = _max_image_bytes() if max_bytes is None else max_bytes
    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        raise ImageIngestionError("max_bytes must be a positive integer")
    if size > limit:
        raise ImageIngestionError(f"Image exceeds the {limit}-byte upload limit")
    return path


def preview_path_for(image_path: str | Path) -> Path:
    """Return the repo storage convention's browser-preview path for an image.

    The existing ImageStore writes ``preview.png`` beside ``original.<suffix>``.
    This function only returns that path; preview rendering remains in the imagery
    layer so ingestion does not make a second raster copy.
    """
    return Path(image_path).parent / "preview.png"


def _positive_optional_number(value: Any, name: str) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ImageIngestionError(f"{name} must be a positive number or null")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ImageIngestionError(f"{name} must be a positive number or null") from exc
    if not math.isfinite(result) or result <= 0:
        raise ImageIngestionError(f"{name} must be a positive finite number or null")
    return result


def _json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    if isinstance(value, str):
        try:
            parsed = json.loads(value.strip())
        except (json.JSONDecodeError, TypeError):
            return None
        return dict(parsed) if isinstance(parsed, Mapping) else None
    return None


def _valid_transform(value: Any) -> dict[str, Any] | None:
    """Normalize an explicitly supplied affine pixel-to-lunar-meter transform."""
    transform = _json_object(value)
    if not transform or transform.get("type") != "affine_2d" or transform.get("units") != "m":
        return None
    matrix = transform.get("matrix")
    if not isinstance(matrix, (list, tuple)) or len(matrix) != 3:
        return None
    if any(not isinstance(row, (list, tuple)) or len(row) != 3 for row in matrix):
        return None
    numbers: list[float] = []
    try:
        for row in matrix:
            for item in row:
                if isinstance(item, bool):
                    return None
                numbers.append(float(item))
    except (TypeError, ValueError, OverflowError):
        return None
    if not all(math.isfinite(item) for item in numbers) or numbers[6:] != [0.0, 0.0, 1.0]:
        return None
    determinant = numbers[0] * numbers[4] - numbers[1] * numbers[3]
    if not math.isfinite(determinant) or determinant == 0:
        return None
    transform["matrix"] = [numbers[0:3], numbers[3:6], numbers[6:9]]
    return transform


def _read_manifest(path: Path) -> Mapping[str, Any]:
    try:
        if path.stat().st_size > MAX_MANIFEST_BYTES:
            raise ImageIngestionError(f"Manifest exceeds the {MAX_MANIFEST_BYTES}-byte size limit")
        value = json.loads(path.read_text(encoding="utf-8"))
    except ImageIngestionError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ImageIngestionError(f"Could not read manifest {path}: {exc}") from exc
    if not isinstance(value, Mapping):
        raise ImageIngestionError("Manifest must contain a JSON object")
    return value


def _pillow_metadata(path: Path) -> tuple[int, int, str, dict[str, Any]]:
    try:
        from PIL import Image, TiffTags
    except ImportError as exc:
        raise ImageIngestionError("Pillow is required to validate image file types") from exc
    try:
        with Image.open(path) as image:
            width, height = image.size
            image_format = str(image.format or "").upper()
            metadata: dict[str, Any] = {}
            for key, value in image.info.items():
                if isinstance(key, str):
                    metadata[key] = value
            tags = getattr(image, "tag_v2", None)
            if tags is not None:
                for tag_id, value in tags.items():
                    name = TiffTags.TAGS_V2.get(tag_id, str(tag_id))
                    metadata[str(name)] = value
            image.verify()
    except Exception as exc:
        raise ImageIngestionError(f"Could not decode image {path}: {exc}") from exc
    expected = _EXPECTED_FORMATS[path.suffix.lower()]
    if image_format not in expected:
        raise ImageIngestionError(
            f"Image content is {image_format or 'unknown'}, which does not match {path.suffix.lower()}"
        )
    if width <= 0 or height <= 0:
        raise ImageIngestionError("Decoded image dimensions must be positive")
    return int(width), int(height), image_format, metadata


def _flat_metadata(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Read only recognized explicit fields from embedded image tags."""
    values: dict[str, Any] = {}
    for key, value in raw.items():
        normalized = str(key).strip().lower().replace("-", "_").replace(" ", "_")
        if normalized in {"imagedescription", "image_description", "description", "moonsafe_metadata"}:
            parsed = _json_object(value)
            if parsed:
                values.update(
                    {
                        str(parsed_key).strip().lower().replace("-", "_").replace(" ", "_"): parsed_value
                        for parsed_key, parsed_value in parsed.items()
                    }
                )
        values[normalized] = value

    aliases = {
        "image_id": ("image_id", "moonsafe_image_id"),
        "source_image_id": ("source_image_id", "product_id", "lroc_product_id"),
        "gsd_x_m_per_px": ("gsd_x_m_per_px", "ground_sample_distance_x_m", "pixel_size_x_m"),
        "gsd_y_m_per_px": ("gsd_y_m_per_px", "ground_sample_distance_y_m", "pixel_size_y_m"),
        "coverage": ("coverage", "coverage_state"),
        "coordinate_frame": ("coordinate_frame",),
        "image_to_lunar": ("image_to_lunar", "moonsafe_image_to_lunar"),
        "target_name": ("target_name", "target", "body_name"),
    }
    result: dict[str, Any] = {}
    for target, names in aliases.items():
        for name in names:
            if name in values:
                result[target] = values[name]
                break
    return result


def _unit_factor_to_meters(crs: Any) -> float | None:
    try:
        name = str(crs.linear_units).strip().lower()
    except Exception:
        return None
    return _UNIT_TO_METERS.get(name)


def _rasterio_metadata(path: Path) -> tuple[int, int, dict[str, Any]] | None:
    """Read optional GDAL/Rasterio projection and affine metadata when present."""
    try:
        import rasterio
    except ImportError:
        return None
    try:
        with rasterio.open(path) as dataset:
            width, height = int(dataset.width), int(dataset.height)
            tags = _flat_metadata(dataset.tags())
            crs = dataset.crs
            affine = dataset.transform
            affine_values = tuple(float(value) for value in (affine.a, affine.b, affine.c, affine.d, affine.e, affine.f))
            has_real_affine = affine_values != (1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
            if crs is not None and has_real_affine and bool(getattr(crs, "is_projected", False)):
                factor = _unit_factor_to_meters(crs)
                if factor is not None:
                    gsd_x = math.hypot(float(affine.a), float(affine.d)) * factor
                    gsd_y = math.hypot(float(affine.b), float(affine.e)) * factor
                    if gsd_x > 0 and gsd_y > 0 and math.isfinite(gsd_x + gsd_y):
                        tags.setdefault("gsd_x_m_per_px", gsd_x)
                        tags.setdefault("gsd_y_m_per_px", gsd_y)

                    description = " ".join(
                        [str(getattr(crs, "name", "")), str(crs.to_wkt()), str(tags.get("target_name", ""))]
                    ).lower()
                    lunar_projection = any(word in description for word in ("moon", "lunar", "selenographic", "selenocentric"))
                    if lunar_projection:
                        candidate = {
                            "type": "affine_2d",
                            "units": "m",
                            "matrix": [
                                [float(affine.a) * factor, float(affine.b) * factor, float(affine.c) * factor],
                                [float(affine.d) * factor, float(affine.e) * factor, float(affine.f) * factor],
                                [0.0, 0.0, 1.0],
                            ],
                        }
                        if _valid_transform(candidate):
                            tags.setdefault("coordinate_frame", "lunar_local_m")
                            tags.setdefault("image_to_lunar", candidate)
            return width, height, tags
    except Exception:
        return None


def _read_dimensions_and_metadata(path: Path) -> tuple[int, int, dict[str, Any]]:
    raster = _rasterio_metadata(path)
    try:
        width, height, _, pillow_tags = _pillow_metadata(path)
    except ImageIngestionError as pillow_error:
        if raster is None:
            raise pillow_error
        width, height = raster[0], raster[1]
        # A Rasterio-only decode is accepted only for one of the API's TIFF types.
        if path.suffix.lower() not in {".tif", ".tiff"}:
            raise pillow_error
        pillow_tags = {}

    metadata = _flat_metadata(pillow_tags)
    if raster is not None:
        if (raster[0], raster[1]) != (width, height):
            raise ImageIngestionError("Raster dimension readers reported inconsistent sizes")
        metadata.update({key: value for key, value in raster[2].items() if value is not None})
    return width, height, metadata


def load_image_metadata(
    image_path: str | Path,
    manifest_path: str | Path | None = None,
    *,
    metadata: Mapping[str, Any] | None = None,
    max_bytes: int | None = None,
) -> dict[str, Any]:
    """Return the shared ``ImageMetadata`` shape for an uploaded or local raster.

    Raster dimensions and supported embedded metadata are inspected first. An
    optional JSON sidecar overrides embedded fields, and explicit ``metadata``
    overrides the sidecar. The default sidecar is ``<filename>.json``. Missing
    ground scale, coverage, and lunar transform stay missing/null.
    """
    path = validate_image_file(image_path, max_bytes=max_bytes)
    if metadata is not None and not isinstance(metadata, Mapping):
        raise ImageIngestionError("metadata must be a mapping")

    if manifest_path is None:
        sidecar = path.with_name(path.name + ".json")
        manifest: Mapping[str, Any] = _read_manifest(sidecar) if sidecar.is_file() else {}
    else:
        sidecar = Path(manifest_path)
        if not sidecar.is_file():
            raise ImageIngestionError(f"Manifest does not exist or is not a file: {sidecar}")
        manifest = _read_manifest(sidecar)

    width, height, embedded = _read_dimensions_and_metadata(path)
    supplied = {**embedded, **dict(manifest), **(dict(metadata) if metadata is not None else {})}

    coverage = supplied.get("coverage", "missing")
    if not isinstance(coverage, str):
        raise ImageIngestionError("coverage must be valid, partial, or missing")
    coverage = coverage.strip().lower()
    if coverage not in {"valid", "partial", "missing"}:
        raise ImageIngestionError("coverage must be valid, partial, or missing")

    transform = _valid_transform(supplied.get("image_to_lunar"))
    if supplied.get("coordinate_frame") == "lunar_local_m" and transform is not None:
        coordinate_frame = "lunar_local_m"
        retained_transform = transform
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
        "image_id": image_id.strip(),
        "source_image_id": source_image_id.strip(),
        "width_px": int(width),
        "height_px": int(height),
        "gsd_x_m_per_px": _positive_optional_number(supplied.get("gsd_x_m_per_px"), "gsd_x_m_per_px"),
        "gsd_y_m_per_px": _positive_optional_number(supplied.get("gsd_y_m_per_px"), "gsd_y_m_per_px"),
        "coverage": coverage,
        "coordinate_frame": coordinate_frame,
        "image_to_lunar": retained_transform,
    }
