import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Rectangle,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { ImageMetadata, RiskClass, RiskGrid } from '../../app/types/contracts';
import {
  applyAffine2D,
  leafletLatLngToImagePx,
  pixelBboxToLeafletBounds,
  resolveViewerFrame,
  riskCellToLeafletBounds,
} from './coordinates';
import type {
  DetectionWithGeo,
  MapLayerState,
  RiskCellWithBounds,
  SelectedMapFeature,
} from './types';

interface LeafletMapCanvasProps {
  imageMetadata: ImageMetadata;
  previewUrl: string;
  detections: DetectionWithGeo[];
  riskGrid: RiskGrid | null;
  layers: MapLayerState;
  selected: SelectedMapFeature;
  onSelect: (feature: SelectedMapFeature) => void;
}

const RISK_STYLE: Record<RiskClass, { color: string; fillColor: string }> = {
  safe: { color: '#10b981', fillColor: '#10b981' },
  caution: { color: '#f59e0b', fillColor: '#f59e0b' },
  unsafe: { color: '#ef4444', fillColor: '#ef4444' },
  uncertain: { color: '#a855f7', fillColor: '#a855f7' },
};

function FitImageBounds({ bounds }: { bounds: [[number, number], [number, number]] }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [16, 16] });
  }, [map, bounds]);
  return null;
}

function CursorTracker({
  onCursorMove,
}: {
  onCursorMove: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    mousemove(e) {
      onCursorMove(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function LeafletMapCanvas({
  imageMetadata,
  previewUrl,
  detections,
  riskGrid,
  layers,
  selected,
  onSelect,
}: LeafletMapCanvasProps) {
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null);

  const resultFrame = riskGrid?.coordinate_frame ?? imageMetadata.coordinate_frame;
  const { canvasFrame, affine, imageBounds } = useMemo(
    () => resolveViewerFrame(imageMetadata, resultFrame),
    [imageMetadata, resultFrame],
  );

  const visibleDetections = useMemo(
    () => detections.filter((d) => d.confidence >= layers.minDetectionConfidence),
    [detections, layers.minDetectionConfidence],
  );

  const visibleCells = useMemo(() => {
    if (!riskGrid || !layers.showRiskGrid) return [];
    return (riskGrid.cells as RiskCellWithBounds[]).filter(
      (cell) => layers.visibleRiskClasses[cell.class],
    );
  }, [riskGrid, layers.showRiskGrid, layers.visibleRiskClasses]);

  const cursorReadout = useMemo(() => {
    if (!cursor) {
      return canvasFrame === 'lunar_local_m' ? 'Move cursor over lunar_local_m scene' : 'Move cursor over image_px scene';
    }
    if (canvasFrame === 'lunar_local_m') {
      return `lunar_local_m: (${cursor.lng.toFixed(2)} m, ${cursor.lat.toFixed(2)} m)`;
    }
    const px = leafletLatLngToImagePx(cursor.lat, cursor.lng, imageMetadata.height_px);
    if (affine) {
      const lunar = applyAffine2D(affine, px.x, px.y);
      return `image_px: (${px.x.toFixed(1)}, ${px.y.toFixed(1)}) · lunar_local_m: (${lunar.x.toFixed(2)} m, ${lunar.y.toFixed(2)} m)`;
    }
    return `image_px: (${px.x.toFixed(1)}, ${px.y.toFixed(1)}) [unreferenced]`;
  }, [cursor, canvasFrame, imageMetadata.height_px, affine]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-[#070a10]">
      <MapContainer
        crs={L.CRS.Simple}
        bounds={imageBounds}
        minZoom={-4}
        maxZoom={6}
        zoomSnap={0.25}
        attributionControl={false}
        style={{ height: '520px', width: '100%', background: '#070a10' }}
      >
        <FitImageBounds bounds={imageBounds} />
        <CursorTracker onCursorMove={(lat, lng) => setCursor({ lat, lng })} />

        {layers.showImage && (
          <ImageOverlay
            url={previewUrl}
            bounds={imageBounds}
            opacity={layers.imageOpacity}
          />
        )}

        {visibleCells.map((cell) => {
          const cellBounds = riskCellToLeafletBounds(
            cell,
            riskGrid?.cell_size_m ?? 10,
            imageMetadata,
            riskGrid?.coordinate_frame ?? canvasFrame,
            canvasFrame,
            affine,
          );
          const isSelected =
            selected?.kind === 'risk_cell' && selected.cell.cell_id === cell.cell_id;
          const style = RISK_STYLE[cell.class];

          return (
            <Rectangle
              key={cell.cell_id}
              bounds={cellBounds}
              pathOptions={{
                color: isSelected ? '#ffffff' : style.color,
                weight: isSelected ? 2.5 : 1,
                fillColor: style.fillColor,
                fillOpacity: layers.riskOpacity,
              }}
              eventHandlers={{
                click: () => onSelect({ kind: 'risk_cell', cell }),
              }}
            />
          );
        })}

        {layers.showDetections &&
          visibleDetections.map((det) => {
            const boxBounds =
              canvasFrame === 'lunar_local_m' && affine
                ? (() => {
                    const p1 = applyAffine2D(affine, det.bbox_px[0], det.bbox_px[1]);
                    const p2 = applyAffine2D(affine, det.bbox_px[2], det.bbox_px[3]);
                    return [
                      [Math.min(p1.y, p2.y), Math.min(p1.x, p2.x)],
                      [Math.max(p1.y, p2.y), Math.max(p1.x, p2.x)],
                    ] as [[number, number], [number, number]];
                  })()
                : pixelBboxToLeafletBounds(det.bbox_px, imageMetadata.height_px);

            const centerLatLng: [number, number] =
              canvasFrame === 'lunar_local_m' && det.position.frame === 'lunar_local_m'
                ? [det.position.y, det.position.x]
                : [
                    imageMetadata.height_px - (det.bbox_px[1] + det.bbox_px[3]) / 2,
                    (det.bbox_px[0] + det.bbox_px[2]) / 2,
                  ];

            const isSelected =
              selected?.kind === 'detection' &&
              selected.detection.detection_id === det.detection_id;

            return (
              <span key={det.detection_id}>
                <Rectangle
                  bounds={boxBounds}
                  pathOptions={{
                    color: isSelected ? '#ffffff' : '#38bdf8',
                    weight: isSelected ? 2.5 : 1.5,
                    fillOpacity: 0.08,
                  }}
                  eventHandlers={{
                    click: () => onSelect({ kind: 'detection', detection: det }),
                  }}
                />
                <CircleMarker
                  center={centerLatLng}
                  radius={isSelected ? 5 : 3}
                  pathOptions={{
                    color: det.position.uncertain ? '#a855f7' : '#38bdf8',
                    fillColor: det.position.uncertain ? '#a855f7' : '#38bdf8',
                    fillOpacity: 0.9,
                  }}
                  eventHandlers={{
                    click: () => onSelect({ kind: 'detection', detection: det }),
                  }}
                />
              </span>
            );
          })}
      </MapContainer>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0b0f17] border-t border-slate-800 text-[11px] font-mono text-slate-300">
        <span>{cursorReadout}</span>
        <span className="text-slate-400">CRS: L.CRS.Simple (non-Earth {canvasFrame})</span>
      </div>
    </div>
  );
}
