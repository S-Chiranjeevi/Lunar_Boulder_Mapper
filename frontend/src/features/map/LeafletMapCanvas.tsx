import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Maximize2 } from 'lucide-react';
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Rectangle,
  Tooltip,
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

function MapViewportController({
  imageId,
  bounds,
  fitNonce,
  focusBounds,
}: {
  imageId: string;
  bounds: [[number, number], [number, number]];
  fitNonce: number;
  focusBounds: [[number, number], [number, number]] | null;
}) {
  const map = useMap();
  const lastImageIdRef = useRef<string | null>(null);
  const lastFitNonceRef = useRef<number>(0);

  useEffect(() => {
    if (lastImageIdRef.current !== imageId) {
      lastImageIdRef.current = imageId;
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [map, imageId, bounds]);

  useEffect(() => {
    if (fitNonce > lastFitNonceRef.current) {
      lastFitNonceRef.current = fitNonce;
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [map, fitNonce, bounds]);

  useEffect(() => {
    if (focusBounds) {
      map.fitBounds(focusBounds, { maxZoom: 3, padding: [56, 56] });
    }
  }, [map, focusBounds]);

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
  const [fitNonce, setFitNonce] = useState(0);

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

  const focusedDetectionBounds = useMemo(() => {
    if (!selected || selected.kind !== 'detection') return null;
    const det = selected.detection;
    if (canvasFrame === 'lunar_local_m' && affine) {
      const p1 = applyAffine2D(affine, det.bbox_px[0], det.bbox_px[1]);
      const p2 = applyAffine2D(affine, det.bbox_px[2], det.bbox_px[3]);
      return [
        [Math.min(p1.y, p2.y), Math.min(p1.x, p2.x)],
        [Math.max(p1.y, p2.y), Math.max(p1.x, p2.x)],
      ] as [[number, number], [number, number]];
    }
    return pixelBboxToLeafletBounds(det.bbox_px, imageMetadata.height_px);
  }, [selected, canvasFrame, affine, imageMetadata.height_px]);

  const cursorReadout = useMemo(() => {
    if (!cursor) {
      return canvasFrame === 'lunar_local_m'
        ? 'Move cursor over lunar_local_m scene'
        : 'Move cursor over image_px scene';
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
    <div className="relative rounded-2xl overflow-hidden border border-slate-700/80 bg-[#05080f] shadow-lg">
      {/* Fit-to-image floating action */}
      <button
        type="button"
        onClick={() => setFitNonce((n) => n + 1)}
        className="absolute top-3 right-3 z-[450] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-950/85 hover:bg-slate-900 text-slate-200 border border-slate-700/80 backdrop-blur shadow cursor-pointer"
        title="Fit NAC image to map viewport"
      >
        <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
        <span>Fit Image</span>
      </button>

      {/* Floating bottom-left Risk Legend */}
      <div className="absolute bottom-11 left-3 z-[450] flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-950/85 border border-slate-800/90 backdrop-blur text-[11px] text-slate-200 pointer-events-none">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Safe
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" /> Caution
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" /> Unsafe
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-purple-400" /> Uncertain
        </span>
        <span className="inline-flex items-center gap-1.5 border-l border-slate-700 pl-2.5">
          <span className="w-2.5 h-2.5 border border-sky-400 bg-sky-400/20 inline-block" /> Boulder
        </span>
      </div>

      <MapContainer
        crs={L.CRS.Simple}
        bounds={imageBounds}
        minZoom={-4}
        maxZoom={6}
        zoomSnap={0.25}
        attributionControl={false}
        style={{ height: '560px', width: '100%', background: '#05080f' }}
      >
        <MapViewportController
          imageId={imageMetadata.image_id}
          bounds={imageBounds}
          fitNonce={fitNonce}
          focusBounds={focusedDetectionBounds}
        />
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
                fillOpacity: isSelected ? Math.min(0.7, layers.riskOpacity + 0.2) : layers.riskOpacity,
              }}
              eventHandlers={{
                click: () => onSelect({ kind: 'risk_cell', cell }),
              }}
            >
              <Tooltip sticky>
                <span className="font-mono text-[11px]">
                  {cell.cell_id} · {cell.class.toUpperCase()} · {cell.boulder_count} boulders
                  {cell.max_size_m !== null ? ` · max ${cell.max_size_m.toFixed(2)} m` : ''}
                </span>
              </Tooltip>
            </Rectangle>
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
                    fillOpacity: isSelected ? 0.22 : 0.08,
                  }}
                  eventHandlers={{
                    click: () => onSelect({ kind: 'detection', detection: det }),
                  }}
                >
                  <Tooltip sticky>
                    <span className="font-mono text-[11px]">
                      {det.estimated_size_m !== null
                        ? `~${det.estimated_size_m.toFixed(2)} m`
                        : 'Size unavailable'}{' '}
                      · {(det.confidence * 100).toFixed(0)}% conf
                    </span>
                  </Tooltip>
                </Rectangle>
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

      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-[#080c14] border-t border-slate-800 text-[11px] font-mono text-slate-300">
        <span>{cursorReadout}</span>
        <span className="text-slate-400">CRS: L.CRS.Simple (non-Earth {canvasFrame})</span>
      </div>
    </div>
  );
}
