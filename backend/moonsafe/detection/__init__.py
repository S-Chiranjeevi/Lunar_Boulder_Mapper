"""Boulder detection engine: OpenCV preprocessing + YOLO inference."""
from .detector import BoulderDetector, DetectorConfig, RawDetection

__all__ = ["BoulderDetector", "DetectorConfig", "RawDetection"]
