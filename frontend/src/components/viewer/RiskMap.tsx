/**
 * Primary 2D viewer using Leaflet (react-leaflet).
 *
 * Layout:
 *  - Background: the uploaded image served from GET /images/{id}/preview,
 *    placed as an ImageOverlay spanning a pixel coordinate system (CRS.Simple).
 *  - Risk cells: coloured Rectangle overlays drawn over the image.
 *  - Detection markers: small circle markers at bbox centres.
 *  - Selected detection: highlighted with a larger circle.
 *
 * Coordinate system:
 *  Leaflet CRS.Simple maps (lat, lng) → (y, x) in pixel space with y
 *  increasing upward.  We negate the y coordinate so the image is not
 *  flipped: bounds = [[−height, 0], [0, width]].
 *
 * No lunar geographic (lat/lon) coordinates are assumed.  If a lunar
 * transform is present in the future a separate geospatial layer can be
 * added without breaking this component.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MapContainer,
  ImageOverlay,
  Rectangle,
  CircleMarker,
  Tooltip,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import { getPreviewUrl } from '../../api/client'
import type { Detection, ImageMetadata, RiskCell, RiskGrid } from '../../types/api'

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  metadata: ImageMetadata
  detections: Detection[]
  riskGrid: RiskGrid | null
  selectedDetectionId: string | null
  onSelectDetection: (id: string | null) => void
}

// ── Colour map ────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  safe:      '#22c55e',
  caution:   '#f59e0b',
  unsafe:    '#ef4444',
  uncertain: '#6366f1',
}

// ── Helper: fit map to image bounds ──────────────────────────────────────────

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(bounds, { animate: false })
  }, [map, bounds])
  return null
}

// ── px → Leaflet LatLng (y negated for CRS.Simple) ───────────────────────────

function px(x: number, y: number): L.LatLngExpression {
  return [-y, x]
}

// ── Main component ────────────────────────────────────────────────────────────

export function RiskMap({
  metadata,
  detections,
  riskGrid,
  selectedDetectionId,
  onSelectDetection,
}: Props) {
  const { width_px: W, height_px: H, image_id } = metadata
  const previewUrl = getPreviewUrl(image_id)

  // Leaflet bounds: [[y_min, x_min], [y_max, x_max]] in CRS.Simple
  // With y-negation: top-left = [-0, 0], bottom-right = [-H, W]
  const imageBounds: L.LatLngBoundsExpression = [[-H, 0], [0, W]]

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden">
      <MapContainer
        crs={L.CRS.Simple}
        center={[-H / 2, W / 2]}
        zoom={0}
        minZoom={-4}
        maxZoom={6}
        scrollWheelZoom
        className="w-full h-full"
        style={{ background: '#0d0d0a' }}
        attributionControl={false}
      >
        <FitBounds bounds={imageBounds} />

        {/* Base image */}
        <ImageOverlay url={previewUrl} bounds={imageBounds} opacity={1} />

        {/* Risk grid cells */}
        {riskGrid?.cells.map((cell) => {
          const color = RISK_COLORS[cell.class] ?? '#6366f1'
          const cellW = cell.coverage * riskGrid.cell_size_m   // approximate
          const x0 = cell.x
          const y0 = cell.y
          // cell_size_m is in pixels when coordinate_frame = image_px
          const cs = riskGrid.cell_size_m
          const bounds: L.LatLngBoundsExpression = [
            [-(y0 + cs), x0],
            [-y0, x0 + cs],
          ]
          return (
            <Rectangle
              key={cell.cell_id}
              bounds={bounds}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.28,
                weight: 0.5,
                opacity: 0.6,
              }}
            >
              <Tooltip>
                <span className="font-mono text-xs">
                  {cell.class} · {cell.boulder_count} boulder
                  {cell.boulder_count !== 1 ? 's' : ''}
                  {cell.max_size_m != null
                    ? ` · max ${cell.max_size_m.toFixed(2)} m`
                    : ''}
                </span>
              </Tooltip>
            </Rectangle>
          )
        })}

        {/* Detection circles */}
        {detections.map((d) => {
          const cx = (d.bbox_px[0] + d.bbox_px[2]) / 2
          const cy = (d.bbox_px[1] + d.bbox_px[3]) / 2
          const isSelected = d.detection_id === selectedDetectionId
          return (
            <CircleMarker
              key={d.detection_id}
              center={px(cx, cy)}
              radius={isSelected ? 10 : 5}
              pathOptions={{
                color: isSelected ? '#fff' : '#facc15',
                fillColor: '#facc15',
                fillOpacity: isSelected ? 0.9 : 0.5,
                weight: isSelected ? 2 : 1,
              }}
              eventHandlers={{
                click: () => onSelectDetection(
                  isSelected ? null : d.detection_id
                ),
              }}
            >
              <Tooltip>
                <span className="font-mono text-xs">
                  {(d.confidence * 100).toFixed(0)}% conf
                  {d.estimated_size_m != null
                    ? ` · ${d.estimated_size_m.toFixed(2)} m`
                    : ''}
                </span>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>

      {/* Legend */}
      <Legend />
    </div>
  )
}

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 z-[500] bg-moon-950/90 border border-moon-700 rounded-lg px-3 py-2 text-xs font-mono space-y-1 select-none pointer-events-none">
      {Object.entries(RISK_COLORS).map(([cls, color]) => (
        <div key={cls} className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-sm border border-white/20"
            style={{ background: color }}
          />
          <span className="text-moon-300 capitalize">{cls}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-1 pt-1 border-t border-moon-800">
        <span className="inline-block w-3 h-3 rounded-full bg-yellow-400 border border-white/20" />
        <span className="text-moon-300">Detection</span>
      </div>
      <p className="text-moon-700 text-[9px] mt-1">Screening aid only</p>
    </div>
  )
}
