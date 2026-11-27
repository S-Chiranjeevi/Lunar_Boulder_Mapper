"""Raster decoding and contrast-stretched PNG previews using Rasterio, OpenCV, or Pillow."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


class ImageryError(RuntimeError):
    """Raised when a raster cannot be decoded into an array or PNG preview."""


def _stretch_to_uint8(band: np.ndarray, nodata: float | None = None) -> np.ndarray:
    """Stretch single-channel numeric raster data to 8-bit grayscale for display."""
    arr = band.astype(np.float64, copy=False)
    valid = np.isfinite(arr)
    if nodata is not None and np.isfinite(nodata):
        valid &= arr != float(nodata)

    if not np.any(valid):
        return np.zeros(arr.shape, dtype=np.uint8)

    if band.dtype == np.uint8 and nodata is None:
        return band

    values = arr[valid]
    lo = float(np.percentile(values, 2.0))
    hi = float(np.percentile(values, 98.0))
    if hi <= lo:
        lo = float(np.min(values))
        hi = float(np.max(values))
    if hi <= lo:
        out = np.zeros(arr.shape, dtype=np.uint8)
        out[valid] = 128
        return out

    scaled = np.clip((arr - lo) / (hi - lo), 0.0, 1.0) * 255.0
    out = np.zeros(arr.shape, dtype=np.uint8)
    out[valid] = scaled[valid].astype(np.uint8)
    return out


def _read_with_rasterio(path: Path) -> tuple[np.ndarray, tuple[int, int]] | None:
    try:
        import rasterio  # type: ignore[import-not-found]
    except ImportError:
        return None

    try:
        with rasterio.open(path) as src:
            width, height = int(src.width), int(src.height)
            nodata = src.nodata
            if src.count == 1:
                band = src.read(1)
                gray = _stretch_to_uint8(band, nodata=nodata)
                rgb = np.stack([gray, gray, gray], axis=-1)
            else:
                bands = src.read([1, 2, 3]) if src.count >= 3 else src.read([1, 1, 1])
                channels = [_stretch_to_uint8(bands[idx], nodata=nodata) for idx in range(3)]
                rgb = np.stack(channels, axis=-1)
            return rgb, (width, height)
    except Exception:
        return None


def _read_with_opencv(path: Path) -> tuple[np.ndarray, tuple[int, int]] | None:
    try:
        import cv2  # type: ignore[import-not-found]
    except ImportError:
        return None

    arr = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if arr is None:
        return None
    height, width = arr.shape[:2]
    if arr.ndim == 2:
        gray = _stretch_to_uint8(arr)
        rgb = np.stack([gray, gray, gray], axis=-1)
    elif arr.shape[2] >= 3:
        bgr = arr[:, :, :3]
        rgb_raw = bgr[:, :, ::-1]
        if rgb_raw.dtype != np.uint8:
            rgb = np.stack([_stretch_to_uint8(rgb_raw[:, :, i]) for i in range(3)], axis=-1)
        else:
            rgb = rgb_raw
    else:
        gray = _stretch_to_uint8(arr[:, :, 0])
        rgb = np.stack([gray, gray, gray], axis=-1)
    return rgb, (int(width), int(height))


def _read_with_pillow(path: Path) -> tuple[np.ndarray, tuple[int, int]]:
    try:
        with Image.open(path) as img:
            width, height = img.size
            arr = np.asarray(img)
    except Exception as exc:
        raise ImageryError(f"Unable to decode image {path}: {exc}") from exc

    if arr.ndim == 2:
        gray = _stretch_to_uint8(arr)
        rgb = np.stack([gray, gray, gray], axis=-1)
    elif arr.ndim == 3 and arr.shape[2] >= 3:
        rgb_raw = arr[:, :, :3]
        if rgb_raw.dtype != np.uint8:
            rgb = np.stack([_stretch_to_uint8(rgb_raw[:, :, i]) for i in range(3)], axis=-1)
        else:
            rgb = rgb_raw
    elif arr.ndim == 3 and arr.shape[2] == 1:
        gray = _stretch_to_uint8(arr[:, :, 0])
        rgb = np.stack([gray, gray, gray], axis=-1)
    else:
        raise ImageryError(f"Unsupported channel layout {arr.shape} in {path}")
    return rgb, (int(width), int(height))


def load_raster_rgb_array(image_path: str | Path) -> np.ndarray:
    """Load an image into an 8-bit RGB NumPy array without altering dimensions."""
    path = Path(image_path)
    if not path.is_file():
        raise ImageryError(f"Image file does not exist: {path}")

    for reader in (_read_with_rasterio, _read_with_opencv):
        decoded = reader(path)
        if decoded is not None:
            rgb, _ = decoded
            return rgb
    rgb, _ = _read_with_pillow(path)
    return rgb


def probe_raster_dimensions(image_path: str | Path) -> tuple[int, int]:
    """Return (width_px, height_px) using Rasterio, OpenCV, or Pillow."""
    path = Path(image_path)
    for reader in (_read_with_rasterio, _read_with_opencv):
        decoded = reader(path)
        if decoded is not None:
            _, dims = decoded
            return dims
    _, dims = _read_with_pillow(path)
    return dims


def build_display_preview(
    image_path: str | Path,
    output_png_path: str | Path,
    *,
    max_dim: int = 2048,
) -> tuple[int, int]:
    """Create a browser-displayable PNG preview and return original (width_px, height_px)."""
    rgb = load_raster_rgb_array(image_path)
    height, width = rgb.shape[:2]

    preview_img = Image.fromarray(rgb, mode="RGB")
    if max(width, height) > max_dim:
        preview_img.thumbnail((max_dim, max_dim), Image.Resampling.BILINEAR)

    out = Path(output_png_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    preview_img.save(out, format="PNG", optimize=True)
    return int(width), int(height)
