import type { ImageMetadata, JobResultsResponse } from '../../app/types/contracts';

export interface SampleTileSpec {
  id: string;
  label: string;
  sourceProductId: string;
  widthPx: number;
  heightPx: number;
  gsdMPerPx: number;
  seed: number;
  lunarOriginX?: number;
  lunarOriginY?: number;
}

export const SAMPLE_LUNAR_TILES: SampleTileSpec[] = [
  {
    id: 'nac_mare_tranq_sample',
    label: 'Mare Tranquillitatis Tile',
    sourceProductId: 'M183717830LC_SAMPLE',
    widthPx: 800,
    heightPx: 600,
    gsdMPerPx: 0.5,
    seed: 17,
    lunarOriginX: 1200,
    lunarOriginY: 4800,
  },
  {
    id: 'nac_south_pole_sample',
    label: 'South Pole Crater Rim',
    sourceProductId: 'M139481022RC_SAMPLE',
    widthPx: 800,
    heightPx: 600,
    gsdMPerPx: 0.5,
    seed: 43,
  },
];

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic grayscale LRO NAC-style lunar regolith raster PNG in-browser.
 * Produces ONLY an image preview + ImageMetadata; never generates fake detections.
 */
export async function generateSampleLunarTile(
  spec: SampleTileSpec,
): Promise<{ file: File; metadata: ImageMetadata; previewUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = spec.widthPx;
  canvas.height = spec.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable for sample tile generation.');
  }

  const rand = mulberry32(spec.seed);
  ctx.fillStyle = '#383d46';
  ctx.fillRect(0, 0, spec.widthPx, spec.heightPx);

  // Subtle low-frequency regolith illumination gradient (oblique solar incidence)
  const grad = ctx.createLinearGradient(0, 0, spec.widthPx, spec.heightPx);
  grad.addColorStop(0, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, spec.widthPx, spec.heightPx);

  // Fine regolith micro-texture
  for (let i = 0; i < 4500; i += 1) {
    const x = rand() * spec.widthPx;
    const y = rand() * spec.heightPx;
    const lum = Math.floor(42 + rand() * 58);
    ctx.fillStyle = `rgba(${lum}, ${lum}, ${lum + 4}, 0.42)`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Impact craters with sunlit rim and shadowed interior
  for (let i = 0; i < 28; i += 1) {
    const cx = rand() * spec.widthPx;
    const cy = rand() * spec.heightPx;
    const r = 8 + rand() * 44;

    const rim = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.28, r * 0.2, cx, cy, r);
    rim.addColorStop(0, 'rgba(18, 21, 28, 0.72)');
    rim.addColorStop(0.74, 'rgba(42, 47, 56, 0.55)');
    rim.addColorStop(0.92, 'rgba(190, 200, 215, 0.42)');
    rim.addColorStop(1, 'rgba(56, 61, 70, 0)');

    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Surface rock/ejecta speckles (visual raster texture only)
  for (let i = 0; i < 60; i += 1) {
    const rx = rand() * spec.widthPx;
    const ry = rand() * spec.heightPx;
    const rr = 1.5 + rand() * 3.5;
    ctx.fillStyle = 'rgba(12, 14, 20, 0.75)';
    ctx.beginPath();
    ctx.arc(rx + 1.5, ry + 1.2, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(215, 222, 234, 0.85)';
    ctx.beginPath();
    ctx.arc(rx, ry, rr * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Failed to encode sample tile PNG.'));
    }, 'image/png');
  });

  const file = new File([blob], `${spec.id}.png`, { type: 'image/png' });
  const previewUrl = URL.createObjectURL(blob);

  const hasLunarTransform =
    typeof spec.lunarOriginX === 'number' && typeof spec.lunarOriginY === 'number';

  const metadata: ImageMetadata = {
    image_id: spec.id,
    source_image_id: spec.sourceProductId,
    width_px: spec.widthPx,
    height_px: spec.heightPx,
    gsd_x_m_per_px: spec.gsdMPerPx,
    gsd_y_m_per_px: spec.gsdMPerPx,
    coverage: 'valid',
    coordinate_frame: hasLunarTransform ? 'lunar_local_m' : 'image_px',
    image_to_lunar: hasLunarTransform
      ? {
          type: 'affine_2d',
          units: 'm',
          matrix: [
            [spec.gsdMPerPx, 0, spec.lunarOriginX!],
            [0, -spec.gsdMPerPx, spec.lunarOriginY!],
            [0, 0, 1],
          ],
          uncertainty_m: 3.5,
        }
      : null,
  };

  return { file, metadata, previewUrl };
}

/**
 * Export an honest screening report JSON without mislabeling unreferenced pixels
 * as Earth latitude/longitude or standard EPSG:4326 GeoJSON.
 */
export function downloadScreeningReport(
  metadata: ImageMetadata | null,
  results: JobResultsResponse | null,
): void {
  if (!metadata) return;

  const coordFrame = results?.risk_grid.coordinate_frame ?? metadata.coordinate_frame;
  const report = {
    schema: 'moonsafe.screening_report.v1',
    generated_at: new Date().toISOString(),
    screening_only: true,
    validated_for_flight: false,
    coordinate_frame: coordFrame,
    earth_geojson_compatible: false,
    note:
      coordFrame === 'lunar_local_m'
        ? 'Coordinates are in lunar_local_m metres (non-Earth local tangent frame).'
        : 'Reliable lunar georeferencing unavailable; coordinates retained in image_px.',
    image_metadata: metadata,
    detections: results?.detections ?? [],
    risk_grid: results?.risk_grid ?? null,
    thresholds: results?.thresholds ?? null,
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${metadata.image_id}_moonsafe_screening_report.json`;
  link.click();
  URL.revokeObjectURL(url);
}
