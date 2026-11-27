import type { CoordinateFrame, ImageMetadata } from '../../app/types/contracts';

export interface LunarAffine2D {
  type: 'affine_2d';
  units: 'm';
  matrix: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  uncertainty_m?: number | null;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface LeafletBoundsBox {
  southWest: [number, number];
  northEast: [number, number];
}

export function extractLunarAffine(metadata: ImageMetadata | null): LunarAffine2D | null {
  if (!metadata || metadata.coordinate_frame !== 'lunar_local_m' || !metadata.image_to_lunar) {
    return null;
  }
  const raw = metadata.image_to_lunar as Record<string, unknown>;
  if (raw.type !== 'affine_2d' || raw.units !== 'm' || raw.reliable === false || raw.is_reliable === false) {
    return null;
  }
  const matrix = raw.matrix;
  if (!Array.isArray(matrix) || matrix.length !== 3) {
    return null;
  }
  const rows: number[][] = [];
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== 3 || row.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      return null;
    }
    rows.push(row.map(Number));
  }
  if (rows[2][0] !== 0 || rows[2][1] !== 0 || rows[2][2] !== 1) {
    return null;
  }
  const det = rows[0][0] * rows[1][1] - rows[0][1] * rows[1][0];
  if (Math.abs(det) <= 1e-12) {
    return null;
  }
  return {
    type: 'affine_2d',
    units: 'm',
    matrix: [
      [rows[0][0], rows[0][1], rows[0][2]],
      [rows[1][0], rows[1][1], rows[1][2]],
      [0, 0, 1],
    ],
    uncertainty_m: typeof raw.uncertainty_m === 'number' ? raw.uncertainty_m : null,
  };
}

export function isAxisAlignedNorthUpAffine(affine: LunarAffine2D): boolean {
  const [[a, b], [c, d]] = affine.matrix;
  return Math.abs(b) < 1e-12 && Math.abs(c) < 1e-12 && a > 0 && d < 0;
}

export function applyAffine2D(affine: LunarAffine2D, px: number, py: number): Point2D {
  const [[a, b, tx], [c, d, ty]] = affine.matrix;
  return {
    x: a * px + b * py + tx,
    y: c * px + d * py + ty,
  };
}

export function invertAffine2D(affine: LunarAffine2D, lx: number, ly: number): Point2D | null {
  const [[a, b, tx], [c, d, ty]] = affine.matrix;
  const det = a * d - b * c;
  if (Math.abs(det) <= 1e-12) {
    return null;
  }
  const dx = lx - tx;
  const dy = ly - ty;
  return {
    x: (d * dx - b * dy) / det,
    y: (-c * dx + a * dy) / det,
  };
}

/**
 * Convert an image-pixel coordinate (top-left origin, y downward) to Leaflet CRS.Simple [lat, lng].
 */
export function imagePxToLeafletLatLng(px: number, py: number, heightPx: number): [number, number] {
  return [heightPx - py, px];
}

/**
 * Convert a Leaflet CRS.Simple [lat, lng] back to image-pixel (x, y).
 */
export function leafletLatLngToImagePx(lat: number, lng: number, heightPx: number): Point2D {
  return { x: lng, y: heightPx - lat };
}

/**
 * Convert a pixel bbox [xMin, yMin, xMax, yMax] to Leaflet bounds [[south, west], [north, east]].
 */
export function pixelBboxToLeafletBounds(
  bboxPx: [number, number, number, number],
  heightPx: number,
): [[number, number], [number, number]] {
  const [xMin, yMin, xMax, yMax] = bboxPx;
  return [
    [heightPx - yMax, xMin],
    [heightPx - yMin, xMax],
  ];
}

/**
 * Resolve the display coordinate frame for the Leaflet map.
 * Uses lunar_local_m directly when an axis-aligned north-up affine transform is present;
 * otherwise keeps Leaflet CRS.Simple in image_px while still transforming lunar readouts if available.
 */
export function resolveViewerFrame(
  metadata: ImageMetadata,
  resultFrame?: CoordinateFrame,
): {
  canvasFrame: CoordinateFrame;
  affine: LunarAffine2D | null;
  imageBounds: [[number, number], [number, number]];
} {
  const affine = extractLunarAffine(metadata);
  if (resultFrame === 'lunar_local_m' && affine && isAxisAlignedNorthUpAffine(affine)) {
    const topLeft = applyAffine2D(affine, 0, 0);
    const bottomRight = applyAffine2D(affine, metadata.width_px, metadata.height_px);
    const minX = Math.min(topLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, bottomRight.y);
    return {
      canvasFrame: 'lunar_local_m',
      affine,
      imageBounds: [
        [minY, minX],
        [maxY, maxX],
      ],
    };
  }

  return {
    canvasFrame: 'image_px',
    affine,
    imageBounds: [
      [0, 0],
      [metadata.height_px, metadata.width_px],
    ],
  };
}

/**
 * Compute Leaflet rectangle bounds for a RiskGrid cell in either lunar_local_m or image_px.
 */
export function riskCellToLeafletBounds(
  cell: { x: number; y: number; bounds?: [number, number, number, number] },
  cellSizeM: number,
  metadata: ImageMetadata,
  gridFrame: CoordinateFrame,
  canvasFrame: CoordinateFrame,
  affine: LunarAffine2D | null,
): [[number, number], [number, number]] {
  let x0: number;
  let y0: number;
  let x1: number;
  let y1: number;

  if (Array.isArray(cell.bounds) && cell.bounds.length === 4) {
    [x0, y0, x1, y1] = cell.bounds;
  } else if (gridFrame === 'lunar_local_m') {
    const half = cellSizeM / 2;
    x0 = cell.x - half;
    y0 = cell.y - half;
    x1 = cell.x + half;
    y1 = cell.y + half;
  } else {
    const gx = metadata.gsd_x_m_per_px ?? 1;
    const gy = metadata.gsd_y_m_per_px ?? 1;
    const halfW = metadata.gsd_x_m_per_px ? cellSizeM / (2 * gx) : 32;
    const halfH = metadata.gsd_y_m_per_px ? cellSizeM / (2 * gy) : 32;
    x0 = cell.x - halfW;
    y0 = cell.y - halfH;
    x1 = cell.x + halfW;
    y1 = cell.y + halfH;
  }

  if (canvasFrame === 'lunar_local_m' && gridFrame === 'lunar_local_m') {
    return [
      [y0, x0],
      [y1, x1],
    ];
  }

  if (gridFrame === 'lunar_local_m' && affine) {
    const cornersPx = [
      invertAffine2D(affine, x0, y0),
      invertAffine2D(affine, x1, y0),
      invertAffine2D(affine, x1, y1),
      invertAffine2D(affine, x0, y1),
    ].filter((pt): pt is Point2D => pt !== null);
    if (cornersPx.length === 4) {
      const xs = cornersPx.map((p) => p.x);
      const ys = cornersPx.map((p) => p.y);
      return pixelBboxToLeafletBounds(
        [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        metadata.height_px,
      );
    }
  }

  return pixelBboxToLeafletBounds([x0, y0, x1, y1], metadata.height_px);
}
