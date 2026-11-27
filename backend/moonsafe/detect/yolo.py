"""PyTorch / Ultralytics YOLO boulder detector with tiled inference and honest unconfigured fallback.

When no trained lunar boulder weights (.pt) are configured, this module does NOT
fabricate detections or confidence scores; it reports ``model_executed=False`` and
returns an empty detection list so downstream RiskGrid marks cells uncertain.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

import numpy as np

from moonsafe.imagery import load_raster_rgb_array
from moonsafe.schemas import Detection, DetectionPosition, ImageMetadata


class DetectorExecutionError(RuntimeError):
    """Raised when configured YOLO weights cannot be loaded or executed."""


@dataclass(frozen=True)
class DetectorResult:
    """Output of running the boulder detector on an image."""

    detections: list[Detection]
    model_executed: bool
    model_status: str
    model_version: str
    status_message: str


def _pixel_to_position(
    cx: float,
    cy: float,
    metadata: ImageMetadata,
) -> DetectionPosition:
    """Map pixel center to lunar_local_m only when a valid transform is declared."""
    transform = metadata.image_to_lunar
    if (
        metadata.coordinate_frame == "lunar_local_m"
        and isinstance(transform, Mapping)
        and transform.get("type") == "affine_2d"
        and transform.get("units") == "m"
    ):
        matrix = transform.get("matrix")
        if isinstance(matrix, (list, tuple)) and len(matrix) == 3:
            x_m = float(matrix[0][0]) * cx + float(matrix[0][1]) * cy + float(matrix[0][2])
            y_m = float(matrix[1][0]) * cx + float(matrix[1][1]) * cy + float(matrix[1][2])
            raw_unc = transform.get("uncertainty_m")
            uncertainty_m = (
                float(raw_unc)
                if isinstance(raw_unc, (int, float))
                and not isinstance(raw_unc, bool)
                and math.isfinite(float(raw_unc))
                and float(raw_unc) >= 0
                else None
            )
            return DetectionPosition(
                x=x_m,
                y=y_m,
                frame="lunar_local_m",
                uncertainty_m=uncertainty_m,
            )

    return DetectionPosition(
        x=float(cx),
        y=float(cy),
        frame="image_px",
        uncertainty_m=None,
    )


def build_detection_record(
    *,
    detection_id: str,
    metadata: ImageMetadata,
    bbox_px: list[float],
    confidence: float,
    model_version: str,
) -> Detection:
    """Convert raw pixel box and confidence into the shared Detection contract."""
    x_min, y_min, x_max, y_max = [float(v) for v in bbox_px]
    x_min = max(0.0, min(x_min, float(metadata.width_px)))
    x_max = max(x_min, min(x_max, float(metadata.width_px)))
    y_min = max(0.0, min(y_min, float(metadata.height_px)))
    y_max = max(y_min, min(y_max, float(metadata.height_px)))

    estimated_size_m: float | None = None
    if metadata.gsd_x_m_per_px is not None and metadata.gsd_y_m_per_px is not None:
        width_m = (x_max - x_min) * metadata.gsd_x_m_per_px
        height_m = (y_max - y_min) * metadata.gsd_y_m_per_px
        # Major-axis 2D footprint proxy; physical boulder height is never invented.
        estimated_size_m = round(max(width_m, height_m), 4)

    cx = (x_min + x_max) / 2.0
    cy = (y_min + y_max) / 2.0
    position = _pixel_to_position(cx, cy, metadata)

    return Detection(
        detection_id=detection_id,
        image_id=metadata.image_id,
        bbox_px=[round(x_min, 2), round(y_min, 2), round(x_max, 2), round(y_max, 2)],
        confidence=round(max(0.0, min(1.0, float(confidence))), 4),
        model_version=model_version,
        estimated_size_m=estimated_size_m,
        size_uncertainty_m=None,
        position=position,
    )


def compute_nms_indices(
    boxes: np.ndarray,
    scores: np.ndarray,
    iou_threshold: float = 0.45,
) -> list[int]:
    """Run class-agnostic IoU Non-Maximum Suppression across tiled predictions."""
    if len(boxes) == 0:
        return []

    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = np.maximum(0.0, x2 - x1) * np.maximum(0.0, y2 - y1)
    order = scores.argsort()[::-1]

    keep: list[int] = []
    while order.size > 0:
        idx = int(order[0])
        keep.append(idx)
        if order.size == 1:
            break

        rest = order[1:]
        xx1 = np.maximum(x1[idx], x1[rest])
        yy1 = np.maximum(y1[idx], y1[rest])
        xx2 = np.minimum(x2[idx], x2[rest])
        yy2 = np.minimum(y2[idx], y2[rest])

        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        union = areas[idx] + areas[rest] - inter
        iou = np.where(union > 0, inter / union, 0.0)
        order = rest[iou <= iou_threshold]
    return keep


def _iter_tiles(width: int, height: int, tile_size: int, overlap: int) -> list[tuple[int, int, int, int]]:
    """Generate (x0, y0, x1, y1) windows covering the full image."""
    if width <= tile_size and height <= tile_size:
        return [(0, 0, width, height)]

    stride = max(64, tile_size - overlap)
    xs = list(range(0, max(1, width - tile_size + 1), stride))
    ys = list(range(0, max(1, height - tile_size + 1), stride))
    if not xs or xs[-1] + tile_size < width:
        xs.append(max(0, width - tile_size))
    if not ys or ys[-1] + tile_size < height:
        ys.append(max(0, height - tile_size))

    windows: list[tuple[int, int, int, int]] = []
    seen: set[tuple[int, int, int, int]] = set()
    for y0 in ys:
        y1 = min(height, y0 + tile_size)
        for x0 in xs:
            x1 = min(width, x0 + tile_size)
            win = (x0, y0, x1, y1)
            if win not in seen:
                seen.add(win)
                windows.append(win)
    return windows


def _default_yolo_loader(weights_path: Path) -> Any:
    try:
        import torch  # noqa: F401
        from ultralytics import YOLO  # type: ignore[import-not-found]
    except ImportError as exc:
        raise DetectorExecutionError(
            "PyTorch and Ultralytics YOLO are required to execute .pt model weights "
            "(pip install torch ultralytics)."
        ) from exc

    try:
        return YOLO(str(weights_path))
    except Exception as exc:
        raise DetectorExecutionError(f"Failed to load YOLO weights {weights_path}: {exc}") from exc


class YoloBoulderDetector:
    """Tiled Ultralytics YOLO detector with explicit unconfigured handling."""

    def __init__(
        self,
        *,
        tile_size: int = 1024,
        overlap: int = 128,
        iou_threshold: float = 0.45,
        model_loader: Callable[[Path], Any] | None = None,
    ) -> None:
        self.tile_size = tile_size
        self.overlap = overlap
        self.iou_threshold = iou_threshold
        self._model_loader = model_loader or _default_yolo_loader
        self._cached_models: dict[tuple[str, float], Any] = {}

    def _get_model(self, weights_path: Path) -> Any:
        mtime = weights_path.stat().st_mtime
        key = (str(weights_path.resolve()), mtime)
        if key not in self._cached_models:
            self._cached_models[key] = self._model_loader(weights_path)
        return self._cached_models[key]

    def detect(
        self,
        image_path: str | Path,
        metadata: ImageMetadata,
        *,
        confidence_threshold: float = 0.25,
        weights_path: str | Path | None = None,
    ) -> DetectorResult:
        """Run YOLO detection if weights exist; otherwise report unconfigured honestly."""
        explicit_weights = Path(weights_path) if weights_path else None
        env_weights_raw = os.environ.get("MOONSAFE_YOLO_WEIGHTS", "").strip()
        resolved_weights = explicit_weights or (Path(env_weights_raw) if env_weights_raw else None)

        if resolved_weights is None:
            return DetectorResult(
                detections=[],
                model_executed=False,
                model_status="unconfigured",
                model_version="yolo-unconfigured",
                status_message=(
                    "YOLO model is planned/unconfigured: no trained lunar boulder weights "
                    "(.pt) are loaded (set MOONSAFE_YOLO_WEIGHTS to run inference). "
                    "No detections were invented."
                ),
            )

        if not resolved_weights.is_file():
            if explicit_weights is not None:
                raise DetectorExecutionError(
                    f"Requested YOLO weights file does not exist: {resolved_weights}"
                )
            return DetectorResult(
                detections=[],
                model_executed=False,
                model_status="weights_missing",
                model_version="yolo-weights-missing",
                status_message=(
                    f"Configured MOONSAFE_YOLO_WEIGHTS file was not found ({resolved_weights}). "
                    "No detections were invented."
                ),
            )

        model = self._get_model(resolved_weights)
        rgb = load_raster_rgb_array(image_path)
        height, width = rgb.shape[:2]

        raw_boxes: list[list[float]] = []
        raw_scores: list[float] = []
        windows = _iter_tiles(width, height, self.tile_size, self.overlap)
        for x0, y0, x1, y1 in windows:
            tile = rgb[y0:y1, x0:x1]
            try:
                results = model.predict(
                    source=tile,
                    conf=confidence_threshold,
                    verbose=False,
                )
            except Exception as exc:
                raise DetectorExecutionError(f"YOLO inference failed on tile {(x0, y0, x1, y1)}: {exc}") from exc

            for res in results:
                boxes_obj = getattr(res, "boxes", None)
                if boxes_obj is None:
                    continue
                xyxy = boxes_obj.xyxy
                conf = boxes_obj.conf
                xyxy_np = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else np.asarray(xyxy)
                conf_np = conf.cpu().numpy() if hasattr(conf, "cpu") else np.asarray(conf)
                for box, score in zip(xyxy_np, conf_np):
                    if float(score) < confidence_threshold:
                        continue
                    raw_boxes.append(
                        [
                            float(box[0]) + x0,
                            float(box[1]) + y0,
                            float(box[2]) + x0,
                            float(box[3]) + y0,
                        ]
                    )
                    raw_scores.append(float(score))

        model_version = f"ultralytics:{resolved_weights.name}"
        if not raw_boxes:
            return DetectorResult(
                detections=[],
                model_executed=True,
                model_status="executed",
                model_version=model_version,
                status_message=(
                    f"Executed {model_version} across {len(windows)} tile(s); "
                    f"0 boulders met confidence >= {confidence_threshold:.2f}."
                ),
            )

        boxes_arr = np.asarray(raw_boxes, dtype=np.float64)
        scores_arr = np.asarray(raw_scores, dtype=np.float64)
        keep = compute_nms_indices(boxes_arr, scores_arr, iou_threshold=self.iou_threshold)

        detections = [
            build_detection_record(
                detection_id=f"{metadata.image_id}_det_{rank + 1:04d}",
                metadata=metadata,
                bbox_px=boxes_arr[idx].tolist(),
                confidence=float(scores_arr[idx]),
                model_version=model_version,
            )
            for rank, idx in enumerate(keep)
        ]
        return DetectorResult(
            detections=detections,
            model_executed=True,
            model_status="executed",
            model_version=model_version,
            status_message=(
                f"Executed {model_version} across {len(windows)} tile(s); "
                f"found {len(detections)} candidate detection(s)."
            ),
        )
