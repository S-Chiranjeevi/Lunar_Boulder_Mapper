"""Large-image tile slicing and cross-tile duplicate box merging."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class TileWindow:
    """Pixel crop window [x0, y0, x1, y1] inside a source raster."""

    tile_id: str
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return self.x1 - self.x0

    @property
    def height(self) -> int:
        return self.y1 - self.y0


def _axis_windows(total_len: int, tile_len: int, overlap_ratio: float) -> list[tuple[int, int]]:
    if total_len <= 0 or tile_len <= 0:
        raise ValueError("total_len and tile_len must be positive")
    if total_len <= tile_len:
        return [(0, total_len)]

    overlap_px = int(round(tile_len * overlap_ratio))
    stride = max(1, tile_len - overlap_px)
    starts: list[int] = []
    pos = 0
    while pos + tile_len < total_len:
        starts.append(pos)
        pos += stride
    last_start = max(0, total_len - tile_len)
    if not starts or starts[-1] != last_start:
        starts.append(last_start)
    return [(s, min(total_len, s + tile_len)) for s in starts]


def generate_tile_windows(
    width_px: int,
    height_px: int,
    tile_size: tuple[int, int] | None,
    overlap_ratio: float,
) -> list[TileWindow]:
    """Generate overlapping tile windows covering the full image raster."""
    if width_px <= 0 or height_px <= 0:
        raise ValueError("Image dimensions must be positive")
    if tile_size is None:
        return [TileWindow(tile_id="tile_0_0", x0=0, y0=0, x1=width_px, y1=height_px)]

    tile_w, tile_h = tile_size
    xs = _axis_windows(width_px, tile_w, overlap_ratio)
    ys = _axis_windows(height_px, tile_h, overlap_ratio)

    windows: list[TileWindow] = []
    for row_idx, (y0, y1) in enumerate(ys):
        for col_idx, (x0, x1) in enumerate(xs):
            windows.append(
                TileWindow(
                    tile_id=f"tile_{col_idx}_{row_idx}",
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                )
            )
    return windows


def box_iou_and_ios(box_a: Sequence[float], box_b: Sequence[float]) -> tuple[float, float]:
    """Return (IoU, IoS) where IoS = intersection / min(area_a, area_b)."""
    ax1, ay1, ax2, ay2 = (float(v) for v in box_a)
    bx1, by1, bx2, by2 = (float(v) for v in box_b)

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return (0.0, 0.0)

    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    min_area = min(area_a, area_b)
    iou = inter / union if union > 0.0 else 0.0
    ios = inter / min_area if min_area > 0.0 else 0.0
    return (iou, ios)


def merge_tile_detections(
    detections: Sequence[Mapping[str, Any]],
    *,
    iou_threshold: float = 0.5,
    ios_threshold: float = 0.8,
    strategy: str = "nms",
    max_detections: int = 1000,
) -> list[dict[str, Any]]:
    """Merge duplicate detections produced across overlapping tile boundaries.

    Supports:
    - ``nms``: keeps the highest-confidence box and suppresses duplicates whose
      IoU >= ``iou_threshold`` or IoS >= ``ios_threshold`` (catching partial-edge
      fragments inside overlapping regions).
    - ``wbf``: clusters matching boxes and computes a confidence-weighted
      average bounding box.
    """
    if strategy not in {"nms", "wbf"}:
        raise ValueError(f"Unsupported merge strategy: {strategy!r}")

    ordered = sorted(
        (dict(item) for item in detections),
        key=lambda d: float(d["confidence"]),
        reverse=True,
    )
    if not ordered:
        return []

    if strategy == "nms":
        kept: list[dict[str, Any]] = []
        for candidate in ordered:
            c_box = candidate["bbox_px"]
            is_dup = False
            for existing in kept:
                iou, ios = box_iou_and_ios(c_box, existing["bbox_px"])
                if iou >= iou_threshold or ios >= ios_threshold:
                    is_dup = True
                    break
            if not is_dup:
                kept.append(candidate)
                if len(kept) >= max_detections:
                    break
        return kept

    # Weighted box fusion (WBF) over overlapping tile predictions.
    clusters: list[list[dict[str, Any]]] = []
    cluster_rep_boxes: list[list[float]] = []

    for candidate in ordered:
        c_box = [float(v) for v in candidate["bbox_px"]]
        matched_idx: int | None = None
        best_iou = -1.0
        for idx, rep_box in enumerate(cluster_rep_boxes):
            iou, ios = box_iou_and_ios(c_box, rep_box)
            if (iou >= iou_threshold or ios >= ios_threshold) and iou > best_iou:
                best_iou = iou
                matched_idx = idx

        if matched_idx is None:
            clusters.append([candidate])
            cluster_rep_boxes.append(c_box)
        else:
            cluster = clusters[matched_idx]
            cluster.append(candidate)
            total_w = sum(max(1e-6, float(d["confidence"])) for d in cluster)
            fused = [
                sum(float(d["bbox_px"][axis]) * max(1e-6, float(d["confidence"])) for d in cluster) / total_w
                for axis in range(4)
            ]
            cluster_rep_boxes[matched_idx] = fused

    merged: list[dict[str, Any]] = []
    for cluster, fused_box in zip(clusters, cluster_rep_boxes):
        top = dict(cluster[0])
        top["bbox_px"] = [round(v, 4) if math.isfinite(v) else v for v in fused_box]
        top["confidence"] = max(float(d["confidence"]) for d in cluster)
        merged.append(top)

    merged.sort(key=lambda d: float(d["confidence"]), reverse=True)
    return merged[:max_detections]
