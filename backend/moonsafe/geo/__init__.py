"""Image-to-size and image-to-lunar-coordinate conversions for MoonSafe."""

from ._validation import GeoTransformError
from .coordinates import ValidatedLunarAffine, transform_pixel_to_lunar, validate_lunar_transform
from .pipeline import GeoConfig, process_detection, process_detections
from .size import SUPPORTED_SIZE_METHODS, estimate_projected_size

__all__ = [
    "GeoConfig",
    "GeoTransformError",
    "SUPPORTED_SIZE_METHODS",
    "ValidatedLunarAffine",
    "estimate_projected_size",
    "process_detection",
    "process_detections",
    "transform_pixel_to_lunar",
    "validate_lunar_transform",
]
