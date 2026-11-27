import assert from 'node:assert/strict';
import test from 'node:test';
import type { Detection, ImageMetadata, RiskCell, RiskGrid } from '../types.ts';
import {
  detectionToLeafletBounds,
  getAffineInverse,
  inferPixelPitch,
  riskCellToLeafletBounds,
} from './coords.ts';

function sampleImage(overrides: Partial<ImageMetadata> = {}): ImageMetadata {
  return {
    image_id: 'nac_01',
    source_image_id: 'M123L',
    width_px: 100,
    height_px: 80,
    gsd_x_m_per_px: 0.5,
    gsd_y_m_per_px: 0.5,
    coverage: 'valid',
    coordinate_frame: 'image_px',
    image_to_lunar: null,
    ...overrides,
  };
}

test('getAffineInverse validates affine_2d meters matrix and rejects singular matrices', () => {
  const valid = sampleImage({
    coordinate_frame: 'lunar_local_m',
    image_to_lunar: {
      type: 'affine_2d',
      units: 'm',
      matrix: [
        [0.5, 0, 100],
        [0, -0.5, 200],
        [0, 0, 1],
      ],
    },
  });
  const inv = getAffineInverse(valid);
  assert.ok(inv);
  if (!inv) throw new Error('Expected affine inverse');
  assert.equal(inv.determinant, -0.25);

  const singular = sampleImage({
    coordinate_frame: 'lunar_local_m',
    image_to_lunar: {
      type: 'affine_2d',
      units: 'm',
      matrix: [
        [0.5, 0, 0],
        [0.5, 0, 0],
        [0, 0, 1],
      ],
    },
  });
  assert.equal(getAffineInverse(singular), null);
});

test('riskCellToLeafletBounds maps lunar_local_m cells back into Leaflet CRS.Simple pixel bounds', () => {
  const image = sampleImage({
    coordinate_frame: 'lunar_local_m',
    image_to_lunar: {
      type: 'affine_2d',
      units: 'm',
      matrix: [
        [0.5, 0, 100],
        [0, -0.5, 200],
        [0, 0, 1],
      ],
    },
  });
  const inverse = getAffineInverse(image);
  const grid: RiskGrid = {
    image_id: 'nac_01',
    cell_size_m: 10,
    coordinate_frame: 'lunar_local_m',
    threshold_profile: 'rover',
    cells: [],
    screening_only: true,
  };
  // Pixel center (20, 10) -> lunar (110, 195), width 20 px, height 20 px -> x in [10, 30], y in [0, 20]
  const cell: RiskCell = {
    cell_id: 'r000_c000',
    x: 110,
    y: 195,
    class: 'safe',
    boulder_count: 0,
    max_size_m: null,
    coverage: 1,
    reason_codes: ['WITHIN_ILLUSTRATIVE_THRESHOLDS'],
  };

  const bounds = riskCellToLeafletBounds(cell, image, grid, inverse, 20, 20);
  assert.deepEqual(bounds, [
    [60, 10],
    [80, 30],
  ]);
});

test('detectionToLeafletBounds flips image y into Leaflet CRS.Simple coordinates and clamps', () => {
  const image = sampleImage({ width_px: 100, height_px: 80 });
  const detection: Detection = {
    detection_id: 'det_1',
    image_id: 'nac_01',
    bbox_px: [10, 20, 30, 50],
    confidence: 0.9,
    model_version: 'yolo-test',
    estimated_size_m: 15,
    size_uncertainty_m: null,
    position: { x: 20, y: 35, frame: 'image_px', uncertainty_m: null },
  };
  assert.deepEqual(detectionToLeafletBounds(detection, image), [
    [30, 10],
    [60, 30],
  ]);
});

test('inferPixelPitch determines minimum spacing or falls back to image dimension', () => {
  assert.equal(inferPixelPitch([10, 30, 50], 100), 20);
  assert.equal(inferPixelPitch([25], 120), 120);
});
