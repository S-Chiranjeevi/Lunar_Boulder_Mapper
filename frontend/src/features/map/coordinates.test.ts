import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImageMetadata } from '../../app/types/contracts';
import {
  applyAffine2D,
  imagePxToLeafletLatLng,
  invertAffine2D,
  pixelBboxToLeafletBounds,
  resolveViewerFrame,
  riskCellToLeafletBounds,
} from './coordinates.ts';

const BASE_META: ImageMetadata = {
  image_id: 'nac_001',
  source_image_id: 'M1234567890L',
  width_px: 200,
  height_px: 100,
  gsd_x_m_per_px: 0.5,
  gsd_y_m_per_px: 0.5,
  coverage: 'valid',
  coordinate_frame: 'image_px',
  image_to_lunar: null,
};

test('imagePxToLeafletLatLng maps top-left (0,0) to [height, 0]', () => {
  assert.deepEqual(imagePxToLeafletLatLng(0, 0, 100), [100, 0]);
  assert.deepEqual(imagePxToLeafletLatLng(200, 100, 100), [0, 200]);
});

test('pixelBboxToLeafletBounds produces valid Leaflet SW/NE bounds', () => {
  const bounds = pixelBboxToLeafletBounds([10, 20, 30, 50], 100);
  assert.deepEqual(bounds, [
    [50, 10],
    [80, 30],
  ]);
});

test('resolveViewerFrame uses lunar_local_m bounds for valid axis-aligned north-up affine', () => {
  const lunarMeta: ImageMetadata = {
    ...BASE_META,
    coordinate_frame: 'lunar_local_m',
    image_to_lunar: {
      type: 'affine_2d',
      units: 'm',
      matrix: [
        [0.5, 0, 1000],
        [0, -0.5, 2000],
        [0, 0, 1],
      ],
    },
  };
  const resolved = resolveViewerFrame(lunarMeta, 'lunar_local_m');
  assert.equal(resolved.canvasFrame, 'lunar_local_m');
  assert.deepEqual(resolved.imageBounds, [
    [1950, 1000],
    [2000, 1100],
  ]);

  const pt = applyAffine2D(resolved.affine!, 20, 40);
  assert.deepEqual(pt, { x: 1010, y: 1980 });
  const inv = invertAffine2D(resolved.affine!, 1010, 1980);
  assert.deepEqual(inv, { x: 20, y: 40 });
});

test('resolveViewerFrame falls back to image_px if transform is unreliable or missing', () => {
  const badMeta: ImageMetadata = {
    ...BASE_META,
    coordinate_frame: 'lunar_local_m',
    image_to_lunar: {
      type: 'affine_2d',
      units: 'm',
      reliable: false,
      matrix: [
        [0.5, 0, 0],
        [0, -0.5, 0],
        [0, 0, 1],
      ],
    },
  };
  const resolved = resolveViewerFrame(badMeta, 'lunar_local_m');
  assert.equal(resolved.canvasFrame, 'image_px');
  assert.deepEqual(resolved.imageBounds, [
    [0, 0],
    [100, 200],
  ]);
});

test('riskCellToLeafletBounds uses explicit bounds in both frames', () => {
  const lunarBounds = riskCellToLeafletBounds(
    { x: 1005, y: 1995, bounds: [1000, 1990, 1010, 2000] },
    10,
    BASE_META,
    'lunar_local_m',
    'lunar_local_m',
    null,
  );
  assert.deepEqual(lunarBounds, [
    [1990, 1000],
    [2000, 1010],
  ]);

  const pxBounds = riskCellToLeafletBounds(
    { x: 10, y: 10, bounds: [0, 0, 20, 20] },
    10,
    BASE_META,
    'image_px',
    'image_px',
    null,
  );
  assert.deepEqual(pxBounds, [
    [80, 0],
    [100, 20],
  ]);
});
