import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Pane,
  Rectangle,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  Columns2,
  Crosshair,
  Eye,
  Grid3X3,
  Maximize2,
  Minus,
  Plus,
} from 'lucide-react';
import type { ImageMetadata, RiskClass, RiskGrid, ThresholdConfig } from '../../app/types/contracts';
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
  onChangeLayers: (next: MapLayerState) => void;
  activeThresholds?: ThresholdConfig;
  selected: SelectedMapFeature;
  onSelect: (feature: SelectedMapFeature) => void;
  isInferring?: boolean;
}

const RISK_STYLE: Record<RiskClass, { color: string; fillColor: string }> = {
  safe: { color: '#10b981', fillColor: '#10b981' },
  caution: { color: '#f59e0b', fillColor: '#f59e0b' },
  unsafe: { color: '#ef4444', fillColor: '#ef4444' },
  uncertain: { color: '#8b5cf6', fillColor: '#8b5cf6' },
};

const NICE_SCALE_METRES = [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000];

function MapHudBridge({
  bounds,
  canvasFrame,
  gsdX,
  onScaleUpdate,
  onCursorMove,
  mapRef,
}: {
  bounds: [[number, number], [number, number]];
  canvasFrame: string;
  gsdX: number | null;
  onScaleUpdate: (label: string, widthPx: number) => void;
  onCursorMove: (lat: number, lng: number) => void;
  mapRef: React.MutableRefObject<L.Map | null>;
}) {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [map, bounds, mapRef]);

  useEffect(() => {
    function recomputeScale() {
      const center = map.getCenter();
      const p1 = map.latLngToContainerPoint(center);
      const p2 = map.latLngToContainerPoint([center.lat, center.lng + 1]);
      const screenPxPerMapUnit = Math.abs(p2.x - p1.x);
      if (!Number.isFinite(screenPxPerMapUnit) || screenPxPerMapUnit <= 0) {
        onScaleUpdate('SCALE: --', 64);
        return;
      }

      if (canvasFrame === 'lunar_local_m') {
        const targetScreenPx = 96;
        const rawMetres = targetScreenPx / screenPxPerMapUnit;
        const nice =
          NICE_SCALE_METRES.find((m) => m >= rawMetres) ??
          NICE_SCALE_METRES[NICE_SCALE_METRES.length - 1];
        onScaleUpdate(`${nice} m`, Math.max(28, Math.min(140, Math.round(nice * screenPxPerMapUnit))));
        return;
      }

      if (gsdX && gsdX > 0) {
        const screenPxPerMetre = screenPxPerMapUnit / gsdX;
        const targetScreenPx = 96;
        const rawMetres = targetScreenPx / screenPxPerMetre;
        const nice =
          NICE_SCALE_METRES.find((m) => m >= rawMetres) ??
          NICE_SCALE_METRES[NICE_SCALE_METRES.length - 1];
        onScaleUpdate(`${nice} m`, Math.max(28, Math.min(140, Math.round(nice * screenPxPerMetre))));
        return;
      }

      const targetScreenPx = 80;
      const rawPx = Math.max(10, Math.round(targetScreenPx / screenPxPerMapUnit));
      onScaleUpdate(`${rawPx} px (unscaled)`, Math.max(36, Math.round(rawPx * screenPxPerMapUnit)));
    }

    recomputeScale();
    map.on('zoomend moveend resize', recomputeScale);
    return () => {
      map.off('zoomend moveend resize', recomputeScale);
    };
  }, [map, canvasFrame, gsdX, onScaleUpdate]);

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
  onChangeLayers,
  activeThresholds,
  selected,
  onSelect,
  isInferring = false,
}: LeafletMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null);
  const [scaleInfo, setScaleInfo] = useState<{ label: string; widthPx: number }>({
    label: '--',
    widthPx: 72,
  });
  const [splitCompare, setSplitCompare] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

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
      return canvasFrame === 'lunar_local_m'
        ? 'CURSOR: -- m, -- m'
        : 'CURSOR: -- px, -- px';
    }
    if (canvasFrame === 'lunar_local_m') {
      const px = affine
        ? (() => {
            const [[a, b, tx], [c, d, ty]] = affine.matrix;
            const det = a * d - b * c;
            if (Math.abs(det) <= 1e-12) return null;
            return {
              x: (d * (cursor.lng - tx) - b * (cursor.lat - ty)) / det,
              y: (-c * (cursor.lng - tx) + a * (cursor.lat - ty)) / det,
            };
          })()
        : null;
      return px
        ? `LUNAR: (${cursor.lng.toFixed(2)} m, ${cursor.lat.toFixed(2)} m) · PX: (${px.x.toFixed(0)}, ${px.y.toFixed(0)})`
        : `LUNAR: (${cursor.lng.toFixed(2)} m, ${cursor.lat.toFixed(2)} m)`;
    }

    const px = leafletLatLngToImagePx(cursor.lat, cursor.lng, imageMetadata.height_px);
    if (affine) {
      const lunar = applyAffine2D(affine, px.x, px.y);
      return `PX: (${px.x.toFixed(1)}, ${px.y.toFixed(1)}) · LUNAR: (${lunar.x.toFixed(2)} m, ${lunar.y.toFixed(2)} m)`;
    }
    return `PX: (${px.x.toFixed(1)}, ${px.y.toFixed(1)}) · UNREFERENCED`;
  }, [cursor, canvasFrame, imageMetadata.height_px, affine]);

  useEffect(() => {
    if (!isDraggingSplit) return;

    function handleMove(clientX: number) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(5, Math.min(95, pct)));
    }

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) handleMove(e.touches[0].clientX);
    };
    const stop = () => setIsDraggingSplit(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchend', stop);
    };
  }, [isDraggingSplit]);

  const cautionThresh = activeThresholds?.caution_boulder_size_m ?? 0.5;
  const unsafeThresh = activeThresholds?.unsafe_boulder_size_m ?? 1.0;
  const confThresh = layers.minDetectionConfidence;

  return (
    <div
      ref={containerRef}
      className={`relative h-full min-h-[460px] w-full rounded-xl overflow-hidden border border-sky-400/20 bg-[#05070b] hud-reticle ${
        isInferring ? 'hud-scanline-overlay' : ''
      }`}
    >
      <div className="hud-reticle-tr-bl absolute inset-0 pointer-events-none z-20" />

      {/* Floating Top-Center Layer & Compare Toolbar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] max-w-[calc(100%-6rem)] flex flex-wrap sm:flex-nowrap items-center justify-center gap-1 px-1.5 py-1 rounded-xl bg-slate-900/85 backdrop-blur-md border border-sky-400/25 shadow-xl">
        <button
          type="button"
          onClick={() => onChangeLayers({ ...layers, showImage: !layers.showImage })}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition cursor-pointer ${
            layers.showImage
              ? 'bg-sky-500/20 text-sky-200 border border-sky-400/50'
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Raw Orbiter</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeLayers({ ...layers, showDetections: !layers.showDetections })}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition cursor-pointer ${
            layers.showDetections
              ? 'bg-sky-500/20 text-sky-200 border border-sky-400/50'
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>YOLO Detections ({visibleDetections.length})</span>
        </button>

        <button
          type="button"
          onClick={() => onChangeLayers({ ...layers, showRiskGrid: !layers.showRiskGrid })}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition cursor-pointer ${
            layers.showRiskGrid
              ? 'bg-sky-500/20 text-sky-200 border border-sky-400/50'
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          <Grid3X3 className="w-3.5 h-3.5" />
          <span>Hazard Grid ({visibleCells.length})</span>
        </button>

        <div className="h-4 w-px bg-slate-700 mx-0.5 hidden sm:block" />

        <button
          type="button"
          onClick={() => {
            const next = !splitCompare;
            setSplitCompare(next);
            if (next && !layers.showImage) {
              onChangeLayers({ ...layers, showImage: true });
            }
          }}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition cursor-pointer ${
            splitCompare
              ? 'bg-cyan-400/25 text-cyan-200 border border-cyan-300/60 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
              : 'text-slate-300 hover:text-white border border-slate-700/80'
          }`}
        >
          <Columns2 className="w-3.5 h-3.5" />
          <span>Split-Compare</span>
        </button>
      </div>

      {/* Custom Dark-Mode Zoom Controls (Top-Right) */}
      <div className="absolute top-3 right-3 z-[500] flex flex-col gap-1 p-1 rounded-xl bg-slate-900/85 backdrop-blur-md border border-sky-400/25 shadow-lg">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-200 hover:bg-sky-500/20 hover:text-sky-300 transition cursor-pointer"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-200 hover:bg-sky-500/20 hover:text-sky-300 transition cursor-pointer"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.fitBounds(imageBounds, { padding: [24, 24] })}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-200 hover:bg-sky-500/20 hover:text-sky-300 transition cursor-pointer"
          title="Fit image to viewport"
          aria-label="Fit image to viewport"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Leaflet Canvas */}
      <MapContainer
        crs={L.CRS.Simple}
        bounds={imageBounds}
        minZoom={-4}
        maxZoom={6}
        zoomSnap={0.25}
        zoomControl={false}
        attributionControl={false}
        style={{ height: '100%', width: '100%', minHeight: '460px', background: '#05070b' }}
      >
        <MapHudBridge
          bounds={imageBounds}
          canvasFrame={canvasFrame}
          gsdX={imageMetadata.gsd_x_m_per_px}
          onScaleUpdate={(label, widthPx) => setScaleInfo({ label, widthPx })}
          onCursorMove={(lat, lng) => setCursor({ lat, lng })}
          mapRef={mapRef}
        />

        <Pane name="rawOrbiterPane" style={{ zIndex: 250 }}>
          {layers.showImage && (
            <ImageOverlay
              url={previewUrl}
              bounds={imageBounds}
              opacity={layers.imageOpacity}
              pane="rawOrbiterPane"
            />
          )}
        </Pane>

        <Pane
          name="hazardOverlayPane"
          style={{
            zIndex: 450,
            clipPath: splitCompare ? `inset(0 0 0 ${splitPct}%)` : undefined,
          }}
        >
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
                pane="hazardOverlayPane"
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
                    pane="hazardOverlayPane"
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
                    pane="hazardOverlayPane"
                    pathOptions={{
                      color: det.position.uncertain ? '#8b5cf6' : '#38bdf8',
                      fillColor: det.position.uncertain ? '#8b5cf6' : '#38bdf8',
                      fillOpacity: 0.95,
                    }}
                    eventHandlers={{
                      click: () => onSelect({ kind: 'detection', detection: det }),
                    }}
                  />
                </span>
              );
            })}
        </Pane>
      </MapContainer>

      {/* Split-Compare Interactive Curtain Handle */}
      {splitCompare && (
        <div
          className="absolute inset-y-0 z-[520] pointer-events-none"
          style={{ left: `${splitPct}%` }}
        >
          <div className="h-full w-0.5 bg-cyan-400 shadow-[0_0_12px_rgba(56,189,248,0.9)]" />
          <button
            type="button"
            aria-label="Drag split comparison divider"
            onMouseDown={() => setIsDraggingSplit(true)}
            onTouchStart={() => setIsDraggingSplit(true)}
            className="pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-2 rounded-full bg-slate-950/90 border border-cyan-400 text-cyan-300 shadow-[0_0_16px_rgba(56,189,248,0.55)] cursor-ew-resize text-[10px] font-mono"
          >
            ◀▶
          </button>
          <span className="absolute top-16 -translate-x-full -ml-2 px-1.5 py-0.5 rounded bg-slate-950/80 border border-slate-700 text-[10px] font-mono text-slate-300 whitespace-nowrap">
            RAW ORBITER
          </span>
          <span className="absolute top-16 ml-2 px-1.5 py-0.5 rounded bg-slate-950/80 border border-sky-500/40 text-[10px] font-mono text-sky-200 whitespace-nowrap">
            HAZARD + YOLO
          </span>
        </div>
      )}

      {/* Bottom-Left Live Coordinate Readout + Dynamic Metric Scale Bar */}
      <div className="absolute bottom-3 left-3 z-[500] flex flex-col gap-1.5 px-3 py-2 rounded-xl bg-slate-900/85 backdrop-blur-md border border-sky-400/20 text-[11px] font-mono text-slate-200 shadow-lg pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
          <span>{cursorReadout}</span>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] text-slate-300">
          <div
            className="h-2 border-b-2 border-l-2 border-r-2 border-sky-400"
            style={{ width: `${scaleInfo.widthPx}px` }}
          />
          <span>{scaleInfo.label}</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">CRS.Simple ({canvasFrame})</span>
        </div>
      </div>

      {/* Bottom-Right Compact Floating Legend */}
      <div className="absolute bottom-3 right-3 z-[500] px-3 py-2 rounded-xl bg-slate-900/85 backdrop-blur-md border border-sky-400/20 shadow-lg text-[11px]">
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
          Hazard Legend
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
          <div className="flex items-center gap-1.5 text-emerald-300">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#10B981]" />
            <span>Safe (&lt;{cautionThresh.toFixed(1)}m)</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-300">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]" />
            <span>
              Caution ({cautionThresh.toFixed(1)}–{unsafeThresh.toFixed(1)}m)
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-red-300">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#EF4444]" />
            <span>Unsafe (&gt;{unsafeThresh.toFixed(1)}m)</span>
          </div>
          <div className="flex items-center gap-1.5 text-violet-300">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#8B5CF6]" />
            <span>Uncertain (&lt;{confThresh.toFixed(2)} conf)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
