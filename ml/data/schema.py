"""Typed dataset curation contracts preserving IDs, units, provenance, and licensing."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

BoxSourceFormat = Literal[
    "yolo_box",
    "yolo_polygon",
    "label_studio_rect",
    "manual_relabeled",
]
TaskType = Literal["standalone_boulder", "rockfall", "other"]


@dataclass(frozen=True)
class CuratedBox:
    """Single boulder bounding box in image pixel coordinates."""

    x_min_px: float
    y_min_px: float
    x_max_px: float
    y_max_px: float
    class_id: int = 0
    class_name: str = "boulder"
    source_format: BoxSourceFormat = "yolo_box"
    reviewed_for_standalone_boulder: bool = True

    def __post_init__(self) -> None:
        if self.x_max_px <= self.x_min_px or self.y_max_px <= self.y_min_px:
            raise ValueError(
                "CuratedBox requires x_max_px > x_min_px and y_max_px > y_min_px "
                f"(got {self.x_min_px}, {self.y_min_px}, {self.x_max_px}, {self.y_max_px})"
            )
        if self.class_id < 0:
            raise ValueError(f"class_id must be >= 0 (got {self.class_id})")

    def to_yolo_normalized(self, width_px: int, height_px: int) -> tuple[int, float, float, float, float]:
        """Convert pixel bounds to normalized YOLO ``(class_id, xc, yc, w, h)``."""
        if width_px <= 0 or height_px <= 0:
            raise ValueError(f"Image dimensions must be positive (got {width_px}x{height_px})")

        x1 = max(0.0, min(float(width_px), self.x_min_px))
        y1 = max(0.0, min(float(height_px), self.y_min_px))
        x2 = max(0.0, min(float(width_px), self.x_max_px))
        y2 = max(0.0, min(float(height_px), self.y_max_px))
        if x2 <= x1 or y2 <= y1:
            raise ValueError("Clipped bounding box has zero area inside image bounds")

        xc = ((x1 + x2) / 2.0) / float(width_px)
        yc = ((y1 + y2) / 2.0) / float(height_px)
        w = (x2 - x1) / float(width_px)
        h = (y2 - y1) / float(height_px)
        return (self.class_id, xc, yc, w, h)


@dataclass
class TileRecord:
    """Curated NAC tile with source observation provenance, units, and licensing."""

    image_id: str
    source_observation_id: str
    site_id: str | None
    image_path: Path | None
    width_px: int
    height_px: int
    label_source: str
    license: str
    gsd_x_m_per_px: float | None = None
    gsd_y_m_per_px: float | None = None
    coordinate_units: str = "image_px"
    task_type: TaskType = "standalone_boulder"
    reviewed_for_standalone_boulder: bool = True
    provenance_notes: str = ""
    upstream_split: str | None = None
    boxes: list[CuratedBox] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.image_id.strip():
            raise ValueError("image_id must be a non-empty string")
        if not self.source_observation_id.strip():
            raise ValueError("source_observation_id must be a non-empty string")
        if self.width_px <= 0 or self.height_px <= 0:
            raise ValueError("width_px and height_px must be positive integers")
        if self.gsd_x_m_per_px is not None and self.gsd_x_m_per_px <= 0:
            raise ValueError("gsd_x_m_per_px must be positive when supplied")
        if self.gsd_y_m_per_px is not None and self.gsd_y_m_per_px <= 0:
            raise ValueError("gsd_y_m_per_px must be positive when supplied")

    @property
    def split_group_key(self) -> str:
        """Group key used to keep neighboring tiles from the same site/observation together."""
        if self.site_id and self.site_id.strip():
            return f"site:{self.site_id.strip()}"
        return f"obs:{self.source_observation_id.strip()}"
