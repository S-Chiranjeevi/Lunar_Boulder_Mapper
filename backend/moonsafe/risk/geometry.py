"""Grid geometry and exact polygon-cell coverage helpers."""

from __future__ import annotations

import math
from typing import Any, Mapping, Sequence


def polygon_area(poly: Sequence[tuple[float, float]]) -> float:
    """Compute unsigned area of a 2D polygon via the shoelace formula."""
    n = len(poly)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return 0.5 * abs(total)


def _clip_polygon_half_plane(
    poly: list[tuple[float, float]],
    inside_fn: Any,
    intersect_fn: Any,
) -> list[tuple[float, float]]:
    if not poly:
        return []
    output: list[tuple[float, float]] = []
    prev = poly[-1]
    prev_in = inside_fn(prev)
    for curr in poly:
        curr_in = inside_fn(curr)
        if curr_in:
            if not prev_in:
                output.append(intersect_fn(prev, curr))
            output.append(curr)
        elif prev_in:
            output.append(intersect_fn(prev, curr))
        prev = curr
        prev_in = curr_in
    return output


def clip_polygon_to_rect(
    poly: Sequence[tuple[float, float]],
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float,
) -> list[tuple[float, float]]:
    """Clip a convex or simple polygon against an axis-aligned rectangle."""
    clipped = list(poly)

    def _lerp_x(p1: tuple[float, float], p2: tuple[float, float], x_edge: float) -> tuple[float, float]:
        dx = p2[0] - p1[0]
        if dx == 0:
            return (x_edge, p1[1])
        t = (x_edge - p1[0]) / dx
        return (x_edge, p1[1] + t * (p2[1] - p1[1]))

    def _lerp_y(p1: tuple[float, float], p2: tuple[float, float], y_edge: float) -> tuple[float, float]:
        dy = p2[1] - p1[1]
        if dy == 0:
            return (p1[0], y_edge)
        t = (y_edge - p1[1]) / dy
        return (p1[0] + t * (p2[0] - p1[0]), y_edge)

    clipped = _clip_polygon_half_plane(clipped, lambda p: p[0] >= x_min, lambda a, b: _lerp_x(a, b, x_min))
    clipped = _clip_polygon_half_plane(clipped, lambda p: p[0] <= x_max, lambda a, b: _lerp_x(a, b, x_max))
    clipped = _clip_polygon_half_plane(clipped, lambda p: p[1] >= y_min, lambda a, b: _lerp_y(a, b, y_min))
    clipped = _clip_polygon_half_plane(clipped, lambda p: p[1] <= y_max, lambda a, b: _lerp_y(a, b, y_max))
    return clipped


def cell_footprint_coverage(
    footprint_poly: Sequence[tuple[float, float]],
    x0: float,
    y0: float,
    x1: float,
    y1: float,
) -> float:
    """Return fractional overlap in [0.0, 1.0] of a footprint polygon within a cell."""
    cell_area = (x1 - x0) * (y1 - y0)
    if cell_area <= 0:
        return 0.0
    clipped = clip_polygon_to_rect(footprint_poly, x0, y0, x1, y1)
    overlap = polygon_area(clipped)
    return max(0.0, min(1.0, overlap / cell_area))


def image_footprint_polygon(
    width_px: int,
    height_px: int,
    transform: Mapping[str, Any] | None,
    coordinate_frame: str,
) -> list[tuple[float, float]]:
    """Compute the 4-corner image footprint polygon in the target coordinate frame."""
    corners_px = [
        (0.0, 0.0),
        (float(width_px), 0.0),
        (float(width_px), float(height_px)),
        (0.0, float(height_px)),
    ]
    if coordinate_frame != "lunar_local_m" or not isinstance(transform, Mapping):
        return corners_px

    matrix = transform.get("matrix")
    if not isinstance(matrix, (list, tuple)) or len(matrix) != 3:
        return corners_px
    a, b, tx = (float(v) for v in matrix[0])
    c, d, ty = (float(v) for v in matrix[1])
    return [(a * px + b * py + tx, c * px + d * py + ty) for px, py in corners_px]


def grid_index_range(min_val: float, max_val: float, step: float) -> range:
    """Compute integer grid indices covering [min_val, max_val] with positive step."""
    ix_start = math.floor(min_val / step)
    ix_end = math.ceil(max_val / step)
    if ix_end <= ix_start:
        ix_end = ix_start + 1
    return range(ix_start, ix_end)
