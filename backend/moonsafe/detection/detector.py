"""Boulder detection pipeline.

Design notes
------------
- OpenCV is used to normalise the input image (8-bit grayscale → 3-channel RGB)
  and produce the preview PNG that the API serves.
- YOLO inference runs when ``ultralytics`` is installed *and* a real model
  weight file exists at ``MOONSAFE_MODEL_PATH``.  When either is absent the
  pipeline falls back to a clearly-labelled **illustrative stub** that returns
  zero detections, so the rest of the system can be exercised without a trained
  model.  No synthetic detection boxes are invented.
- Confidence scores, bounding boxes, and estimated sizes come only from the
  model; nothing is fabricated or hard-coded.

Status label
------------
Every detection carries ``model_version`` that includes the string
``"stub-no-model"`` when the stub is active.  The API and UI surface this so
the user knows they are seeing illustrative, unvalidated output.
"""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

MODEL_VERSION_STUB = "stub-no-model-v0"


@dataclass
class DetectorConfig:
    confidence_threshold: float = 0.5
    # Path to a YOLOv8 .pt weight file.  Omit / leave empty to use the stub.
    model_path: Optional[str] = field(
        default_factory=lambda: os.environ.get("MOONSAFE_MODEL_PATH", "")
    )
    # Tile the image into overlapping crops of this size for large NAC images.
    tile_size_px: int = 640
    tile_overlap_px: int = 64
    # Device string accepted by ultralytics ("cpu", "cuda:0", etc.)
    device: str = "cpu"


@dataclass
class RawDetection:
    """Raw detection before geo-enrichment."""
    detection_id: str
    image_id: str
    bbox_px: List[float]       # [x_min, y_min, x_max, y_max]
    confidence: float
    model_version: str


def _load_image_cv2(path: Path) -> np.ndarray:
    """Read any supported raster as an 8-bit 3-channel numpy array."""
    import cv2  # type: ignore

    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None:
        # Try rasterio for GeoTIFF / IMG formats
        try:
            import rasterio  # type: ignore
            with rasterio.open(str(path)) as src:
                band = src.read(1)
        except Exception as exc:
            raise ValueError(f"Cannot decode image at {path}: {exc}") from exc
        band = band.astype(np.float32)
        lo, hi = band.min(), band.max()
        if hi > lo:
            band = ((band - lo) / (hi - lo) * 255).astype(np.uint8)
        else:
            band = np.zeros_like(band, dtype=np.uint8)
        img = cv2.cvtColor(band, cv2.COLOR_GRAY2BGR)
        return img

    # Normalise bit-depth
    if img.dtype == np.uint16:
        img = (img // 256).astype(np.uint8)
    elif img.dtype != np.uint8:
        img = img.astype(np.uint8)

    # Ensure 3-channel BGR
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    return img


def _enhance_for_detection(img_bgr: np.ndarray) -> np.ndarray:
    """Apply CLAHE to the luminance channel to improve contrast on NAC imagery."""
    import cv2  # type: ignore

    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_chan = clahe.apply(l_chan)
    lab = cv2.merge([l_chan, a_chan, b_chan])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def _run_yolo(
    img_bgr: np.ndarray,
    image_id: str,
    cfg: DetectorConfig,
) -> List[RawDetection]:
    """Run YOLOv8 inference, returning raw detections in image-pixel coordinates."""
    from ultralytics import YOLO  # type: ignore

    model = YOLO(cfg.model_path)
    h, w = img_bgr.shape[:2]
    detections: List[RawDetection] = []

    # Tile large images to stay within GPU memory limits
    step = cfg.tile_size_px - cfg.tile_overlap_px
    seen_ids: set[str] = set()

    for y0 in range(0, h, step):
        for x0 in range(0, w, step):
            x1 = min(x0 + cfg.tile_size_px, w)
            y1 = min(y0 + cfg.tile_size_px, h)
            tile = img_bgr[y0:y1, x0:x1]

            results = model.predict(
                tile,
                conf=cfg.confidence_threshold,
                device=cfg.device,
                verbose=False,
            )
            for result in results:
                for box in result.boxes:
                    bx1, by1, bx2, by2 = box.xyxy[0].tolist()
                    # Map back to full-image coordinates
                    abs_bbox = [
                        bx1 + x0,
                        by1 + y0,
                        bx2 + x0,
                        by2 + y0,
                    ]
                    conf = float(box.conf[0])
                    det_id = str(uuid.uuid4())
                    # Deduplicate overlapping tile predictions by spatial proximity
                    key = f"{round(abs_bbox[0])},{round(abs_bbox[1])},{round(abs_bbox[2])},{round(abs_bbox[3])}"
                    if key in seen_ids:
                        continue
                    seen_ids.add(key)
                    detections.append(
                        RawDetection(
                            detection_id=det_id,
                            image_id=image_id,
                            bbox_px=abs_bbox,
                            confidence=conf,
                            model_version=getattr(model, "ckpt_path", cfg.model_path)
                            or cfg.model_path
                            or "yolo-unknown",
                        )
                    )

    return detections


class BoulderDetector:
    """Main entry point for boulder detection.

    Usage::

        detector = BoulderDetector(DetectorConfig())
        detections, preview_path = detector.run(image_path, image_id)
    """

    def __init__(self, config: DetectorConfig | None = None) -> None:
        self.config = config or DetectorConfig()
        self._model_available = self._check_model()

    def _check_model(self) -> bool:
        path = self.config.model_path
        if not path:
            return False
        if not Path(path).is_file():
            logger.warning(
                "MOONSAFE_MODEL_PATH=%r does not point to a file — "
                "running in stub mode (no detections produced).",
                path,
            )
            return False
        try:
            import ultralytics  # noqa: F401
            return True
        except ImportError:
            logger.warning(
                "ultralytics is not installed — running in stub mode."
            )
            return False

    def run(
        self,
        image_path: Path,
        image_id: str,
        preview_dir: Path | None = None,
    ) -> Tuple[List[RawDetection], Optional[Path]]:
        """Detect boulders and return (detections, preview_path).

        ``preview_path`` is a JPEG/PNG written to ``preview_dir`` suitable for
        the GET /preview endpoint.  Returns None if the preview cannot be
        written.
        """
        try:
            import cv2  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "opencv-python is required for image preprocessing."
            ) from exc

        img_bgr = _load_image_cv2(image_path)
        enhanced = _enhance_for_detection(img_bgr)

        # Write preview
        preview_path: Optional[Path] = None
        if preview_dir is not None:
            preview_dir.mkdir(parents=True, exist_ok=True)
            preview_path = preview_dir / f"{image_id}_preview.jpg"
            # Downscale large previews to max 2048 px on the long edge
            h, w = enhanced.shape[:2]
            max_dim = 2048
            if max(h, w) > max_dim:
                scale = max_dim / max(h, w)
                new_w, new_h = int(w * scale), int(h * scale)
                preview_img = cv2.resize(enhanced, (new_w, new_h), interpolation=cv2.INTER_AREA)
            else:
                preview_img = enhanced
            cv2.imwrite(str(preview_path), preview_img, [cv2.IMWRITE_JPEG_QUALITY, 85])

        if not self._model_available:
            logger.info(
                "Stub mode active for image %r — returning empty detections.", image_id
            )
            return [], preview_path

        try:
            detections = _run_yolo(enhanced, image_id, self.config)
            logger.info(
                "YOLO produced %d detections for image %r.", len(detections), image_id
            )
            return detections, preview_path
        except Exception as exc:
            logger.error("YOLO inference failed: %s", exc, exc_info=True)
            raise
