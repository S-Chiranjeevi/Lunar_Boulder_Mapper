import type { LatLngBoundsExpression } from 'leaflet';
import type { Detection, ImageMetadata, RiskCell, RiskGrid } from '../types';

export interface Affine2DInverse {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  determinant: number;
}

/**
 * Extract an invertible 2D affine pixel-to-lunar-meter transform when present.
 * Returns null if the image has no valid declared lunar_local_m affine_2d matrix.
 */
export function getAffineInverse(image: ImageMetadata): Affine2DInverse | null {
  const transform = image.image_to_lunar as {
    type?: unknown;
    units?: unknown;
    matrix?: unknown;
  } | null;

  if (!transform || transform.type !== 'affine_2d' || transform.units !== 'm') {
    return null;
  }

  const matrix = transform.matrix;
  if (!Array.isArray(matrix) || matrix.length !== 3) {
    return null;
  }
  if (matrix.some((row) => !Array.isArray(row) || row.length !== 3 || row.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) {
    return null;
  }

  const [a, b, c] = matrix[0] as number[];
  const [d, e, f] = matrix[1] as number[];
  const [g, h, i] = matrix[2] as number[];
  if (g !== 0 || h !== 0 || i !== 1) {
    return null;
  }

  const determinant = a * e - b * d;
  if (!Number.isFinite(determinant) || determinant === 0) {
    return null;
  }

  return { a, b, c, d, e, f, determinant };
}

export function inferPixelPitch(values: number[], fallbackDimension: number): number {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  const gaps = distinct
    .slice(1)
    .map((value, index) => value - distinct[index])
    .filter((value) => value > 0);
  return gaps.length > 0 ? Math.min(...gaps) : fallbackDimension;
}

/**
 * Convert a RiskCell center + size to Leaflet L.CRS.Simple bounds [[south, west], [north, east]].
 * Image pixel y grows downward; Leaflet CRS.Simple latitude grows upward.
 */
export function riskCellToLeafletBounds(
  cell: RiskCell,
  image: ImageMetadata,
  grid: RiskGrid,
  inverse: Affine2DInverse | null,
  fallbackWidthPx: number,
  fallbackHeightPx: number,
): LatLngBoundsExpression {
  let cx = cell.x;
  let cy = cell.y;
  let widthPx = fallbackWidthPx;
  let heightPx = fallbackHeightPx;

  if (grid.coordinate_frame === 'lunar_local_m' && inverse) {
    const { a, b, c, d, e, f, determinant } = inverse;
    const dx = cell.x - c;
    const dy = cell.y - f;
    cx = (e * dx - b * dy) / determinant;
    cy = (-d * dx + a * dy) / determinant;
    widthPx = grid.cell_size_m * (Math.abs(e / determinant) + Math.abs(b / determinant));
    heightPx = grid.cell_size_m * (Math.abs(d / determinant) + Math.abs(a / determinant));
  } else if (image.gsd_x_m_per_px && image.gsd_y_m_per_px) {
    widthPx = grid.cell_size_m / image.gsd_x_m_per_px;
    heightPx = grid.cell_size_m / image.gsd_y_m_per_px;
  }

  const left = Math.max(0, cx - widthPx / 2);
  const right = Math.min(image.width_px, cx + widthPx / 2);
  const top = Math.max(0, cy - heightPx / 2);
  const bottom = Math.min(image.height_px, cy + heightPx / 2);

  return [
    [image.height_px - bottom, left],
    [image.height_px - top, right],
  ];
}

export function detectionToLeafletBounds(
  detection: Detection,
  image: ImageMetadata,
): LatLngBoundsExpression {
  const [x1, y1, x2, y2] = detection.bbox_px;
  const left = Math.max(0, Math.min(x1, image.width_px));
  const right = Math.max(left, Math.min(x2, image.width_px));
  const top = Math.max(0, Math.min(y1, image.height_px));
  const bottom = Math.max(top, Math.min(y2, image.height_px));
  return [
    [image.height_px - bottom, left],
    [image.height_px - top, right],
  ];
}

