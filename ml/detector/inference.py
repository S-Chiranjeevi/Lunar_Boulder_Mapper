"""YOLO boulder detection inference with large-image slicing and SAHI support."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import numpy as np
from PIL import Image

from .config import DetectorConfig
from .exceptions import DetectorDependencyError, DetectorError, MissingWeightsError
from .slicing import generate_tile_windows, merge_tile_detections

TilePredictorFn = Callable[[np.ndarray, DetectorConfig], Sequence[Mapping[str, Any]]]


def _has_package(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def check_inference_availability(config: DetectorConfig) -> dict[str, Any]:
    """Report honestly whether YOLO inference can run with the current config/env."""
    missing_deps: list[str] = []
    if not _has_package("torch"):
        missing_deps.append("torch")
    if not _has_package("ultralytics"):
        missing_deps.append("ultralytics")
    if config.slicing_backend == "sahi" and not _has_package("sahi"):
        missing_deps.append("sahi")

    weights_ok = config.weights_path is not None and Path(config.weights_path).is_file()
    reasons: list[str] = []
    if not weights_ok:
        reasons.append(
            "Model weights are not configured or missing on disk."
            if config.weights_path is None
            else f"Weights file does not exist: {config.weights_path}"
        )
    if missing_deps:
        reasons.append(f"Missing required runtime packages: {', '.join(missing_deps)}")

    return {
        "available": weights_ok and not missing_deps,
        "weights_path": str(config.weights_path) if config.weights_path is not None else None,
        "weights_present": weights_ok,
        "missing_dependencies": missing_deps,
        "slicing_backend": config.slicing_backend,
        "reason": "; ".join(reasons) if reasons else None,
    }


def _to_uint8_rgb(image: Image.Image) -> np.ndarray:
    """Convert 8-bit, 16-bit, or float NAC imagery to HxWx3 uint8 RGB for YOLO."""
    if image.mode in {"I;16", "I;16B", "I;16L", "I", "F"}:
        arr = np.asarray(image, dtype=np.float32)
        lo = float(np.nanmin(arr))
        hi = float(np.nanmax(arr))
        if hi > lo:
            norm = np.clip((arr - lo) * (255.0 / (hi - lo)), 0.0, 255.0).astype(np.uint8)
        else:
            norm = np.zeros(arr.shape, dtype=np.uint8)
        return np.stack([norm, norm, norm], axis=-1)

    rgb = image.convert("RGB")
    return np.asarray(rgb, dtype=np.uint8)


class _UltralyticsTilePredictor:
    """Lazy wrapper around PyTorch + Ultralytics YOLO for tile prediction."""

    def __init__(self, weights_path: Path) -> None:
        self._weights_path = weights_path
        self._model: Any | None = None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        if not _has_package("torch") or not _has_package("ultralytics"):
            raise DetectorDependencyError(
                "PyTorch ('torch') and 'ultralytics' are required for YOLO inference."
            )
        from ultralytics import YOLO  # type: ignore[import-not-found]

        self._model = YOLO(str(self._weights_path))
        return self._model

    def __call__(self, tile_rgb: np.ndarray, config: DetectorConfig) -> list[dict[str, Any]]:
        model = self._load()
        kwargs: dict[str, Any] = {
            "imgsz": config.image_size,
            "conf": config.confidence_threshold,
            "iou": config.iou_threshold,
            "classes": [config.boulder_class_id],
            "verbose": False,
        }
        if config.device is not None:
            kwargs["device"] = config.device

        results = model.predict(source=tile_rgb, **kwargs)
        preds: list[dict[str, Any]] = []
        for result in results:
            boxes = getattr(result, "boxes", None)
            if boxes is None or len(boxes) == 0:
                continue
            xyxy = boxes.xyxy.detach().cpu().tolist()
            confs = boxes.conf.detach().cpu().tolist()
            for box, conf in zip(xyxy, confs):
                preds.append({"bbox_px": [float(v) for v in box], "confidence": float(conf)})
        return preds


def _run_sahi_inference(
    image_rgb: np.ndarray,
    config: DetectorConfig,
) -> list[dict[str, Any]]:
    """Optional SAHI sliced prediction path when SAHI is installed and selected."""
    if not _has_package("sahi"):
        raise DetectorDependencyError("sahi is required when slicing_backend='sahi'")
    if config.weights_path is None or not Path(config.weights_path).is_file():
        raise MissingWeightsError("Trained YOLO weights are required for SAHI inference.")

    from sahi import AutoDetectionModel  # type: ignore[import-not-found]
    from sahi.predict import get_sliced_prediction  # type: ignore[import-not-found]

    tile_dims = config.tile_dimensions or (image_rgb.shape[1], image_rgb.shape[0])
    detection_model = AutoDetectionModel.from_pretrained(
        model_type="ultralytics",
        model_path=str(config.weights_path),
        confidence_threshold=config.confidence_threshold,
        device=config.device or "cpu",
        image_size=config.image_size,
    )
    sahi_result = get_sliced_prediction(
        image=image_rgb,
        detection_model=detection_model,
        slice_width=tile_dims[0],
        slice_height=tile_dims[1],
        overlap_width_ratio=config.tile_overlap_ratio,
        overlap_height_ratio=config.tile_overlap_ratio,
        postprocess_type="NMS",
        postprocess_match_metric="IOS",
        postprocess_match_threshold=config.merge_iou_threshold,
        verbose=0,
    )
    raw: list[dict[str, Any]] = []
    for pred in sahi_result.object_prediction_list:
        if pred.category.id != config.boulder_class_id:
            continue
        x1, y1, x2, y2 = pred.bbox.to_xyxy()
        raw.append(
            {
                "bbox_px": [float(x1), float(y1), float(x2), float(y2)],
                "confidence": float(pred.score.value),
            }
        )
    return raw


class BoulderDetector:
    """YOLO boulder detector with large-image sliced inference and duplicate merging."""

    def __init__(
        self,
        config: DetectorConfig | None = None,
        *,
        tile_predictor: TilePredictorFn | None = None,
    ) -> None:
        self.config = config or DetectorConfig()
        self._tile_predictor = tile_predictor

    def availability_status(self) -> dict[str, Any]:
        if self._tile_predictor is not None:
            return {
                "available": True,
                "weights_path": str(self.config.weights_path) if self.config.weights_path else None,
                "weights_present": True,
                "missing_dependencies": [],
                "slicing_backend": "builtin",
                "reason": None,
            }
        return check_inference_availability(self.config)

    def is_available(self) -> bool:
        return bool(self.availability_status()["available"])

    def _require_ready(self) -> TilePredictorFn:
        if self._tile_predictor is not None:
            return self._tile_predictor

        status = check_inference_availability(self.config)
        if not status["weights_present"]:
            raise MissingWeightsError(
                status["reason"] or "Trained YOLO weights are unavailable for inference."
            )
        if status["missing_dependencies"]:
            raise DetectorDependencyError(
                status["reason"] or "Missing PyTorch/Ultralytics dependencies for inference."
            )
        assert self.config.weights_path is not None
        return _UltralyticsTilePredictor(Path(self.config.weights_path))

    def detect(
        self,
        image_path: str | Path,
        *,
        image_id: str | None = None,
        image_metadata: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Detect boulders in an image and emit the shared Detection contract.

        Leaves ``estimated_size_m``, ``size_uncertainty_m``, and ``position``
        unset (``None``) for the downstream geospatial module.
        """
        path = Path(image_path)
        if not path.is_file():
            raise DetectorError(f"Image file does not exist: {path}")

        resolved_image_id = (
            image_id
            or (image_metadata.get("image_id") if image_metadata is not None else None)
            or path.stem
        )

        predictor = self._require_ready()

        with Image.open(path) as img:
            rgb = _to_uint8_rgb(img)
        height_px, width_px = rgb.shape[:2]

        use_sahi = (
            self._tile_predictor is None
            and (
                self.config.slicing_backend == "sahi"
                or (self.config.slicing_backend == "auto" and _has_package("sahi"))
            )
        )

        if use_sahi:
            raw_detections = _run_sahi_inference(rgb, self.config)
        else:
            windows = generate_tile_windows(
                width_px,
                height_px,
                self.config.tile_dimensions,
                self.config.tile_overlap_ratio,
            )
            tile_detections: list[dict[str, Any]] = []
            for win in windows:
                tile_crop = rgb[win.y0 : win.y1, win.x0 : win.x1]
                preds = predictor(tile_crop, self.config)
                for pred in preds:
                    conf = float(pred["confidence"])
                    if conf < self.config.confidence_threshold:
                        continue
                    bx1, by1, bx2, by2 = (float(v) for v in pred["bbox_px"])
                    gx1 = max(0.0, min(float(width_px), bx1 + win.x0))
                    gy1 = max(0.0, min(float(height_px), by1 + win.y0))
                    gx2 = max(0.0, min(float(width_px), bx2 + win.x0))
                    gy2 = max(0.0, min(float(height_px), by2 + win.y0))
                    if gx2 <= gx1 or gy2 <= gy1:
                        continue
                    tile_detections.append(
                        {
                            "bbox_px": [gx1, gy1, gx2, gy2],
                            "confidence": conf,
                        }
                    )

            raw_detections = merge_tile_detections(
                tile_detections,
                iou_threshold=self.config.merge_iou_threshold,
                ios_threshold=self.config.merge_ios_threshold,
                strategy=self.config.merge_strategy,
                max_detections=self.config.max_detections,
            )

        filtered = [
            det for det in raw_detections if float(det["confidence"]) >= self.config.confidence_threshold
        ][: self.config.max_detections]

        return [
            {
                "detection_id": f"{resolved_image_id}_det_{idx:04d}",
                "image_id": resolved_image_id,
                "bbox_px": [float(v) for v in det["bbox_px"]],
                "confidence": float(det["confidence"]),
                "model_version": self.config.model_version,
                "estimated_size_m": None,
                "size_uncertainty_m": None,
                "position": None,
            }
            for idx, det in enumerate(filtered, start=1)
        ]


def detect_boulders(
    image_path: str | Path,
    *,
    image_metadata: Mapping[str, Any] | None = None,
    weights_path: str | Path | None = None,
    options: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Top-level inference entrypoint compatible with MoonSafe API adapters."""
    opts = dict(options or {})
    if weights_path is not None:
        opts.setdefault("weights_path", weights_path)
    config = DetectorConfig(**opts)
    detector = BoulderDetector(config)
    return detector.detect(image_path, image_metadata=image_metadata)
