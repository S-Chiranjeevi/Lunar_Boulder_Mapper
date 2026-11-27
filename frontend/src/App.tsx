import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Eye,
  EyeOff,
  FileImage,
  Gauge,
  Layers3,
  LoaderCircle,
  Map as MapIcon,
  Maximize2,
  Moon,
  Plus,
  Radar,
  RefreshCw,
  ScanSearch,
  Settings2,
  Shield,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react'
import { api } from './api'
import {
  ILLUSTRATIVE_PROFILE_DEFAULTS,
  type Detection,
  type ImageMetadata,
  type Job,
  type RiskCell,
  type RiskGrid,
  type ThresholdConfig,
  type ThresholdProfile,
} from './types'
import {
  detectionToLeafletBounds,
  getAffineInverse,
  inferPixelPitch,
  riskCellToLeafletBounds,
} from './utils/coords'

const colors: Record<RiskCell['class'], string> = {
  safe: '#8eb497',
  caution: '#d9b44a',
  unsafe: '#d96c53',
  uncertain: '#9b9b8c',
}

interface MapPanelProps {
  image: ImageMetadata
  detections: Detection[]
  grid: RiskGrid | null
  showGrid: boolean
  showDetections: boolean
  selectedDetectionId: string | null
  selectedCellId: string | null
  fitNonce: number
  onSelectDetection: (detectionId: string) => void
  onSelectCell: (cellId: string) => void
}

function MapPanel({
  image,
  detections,
  grid,
  showGrid,
  showDetections,
  selectedDetectionId,
  selectedCellId,
  fitNonce,
  onSelectDetection,
  onSelectCell,
}: MapPanelProps) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!host.current) return
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [image.height_px, image.width_px],
    ]
    const map = L.map(host.current, {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: 4,
      zoomSnap: 0.25,
    })
    map.setMaxBounds([
      [-image.height_px * 0.25, -image.width_px * 0.25],
      [image.height_px * 1.25, image.width_px * 1.25],
    ])
    L.imageOverlay(`/api/v1/images/${encodeURIComponent(image.image_id)}/preview`, bounds).addTo(map)
    const overlays = L.layerGroup().addTo(map)
    map.fitBounds(bounds, { padding: [24, 24] })

    mapRef.current = map
    overlayRef.current = overlays

    return () => {
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [image.image_id, image.width_px, image.height_px])

  useEffect(() => {
    if (fitNonce === 0 || !mapRef.current) return
    mapRef.current.fitBounds(
      [
        [0, 0],
        [image.height_px, image.width_px],
      ],
      { padding: [24, 24] },
    )
  }, [fitNonce, image.height_px, image.width_px])

  useEffect(() => {
    const overlays = overlayRef.current
    if (!overlays) return
    overlays.clearLayers()

    const inverse = getAffineInverse(image)
    const fallbackWidth = grid
      ? inferPixelPitch(
          grid.cells.map((cell) => cell.x),
          image.width_px,
        )
      : 256
    const fallbackHeight = grid
      ? inferPixelPitch(
          grid.cells.map((cell) => cell.y),
          image.height_px,
        )
      : 256

    if (showGrid && grid && !(grid.coordinate_frame === 'lunar_local_m' && !inverse)) {
      grid.cells.forEach((cell) => {
        const isSelected = cell.cell_id === selectedCellId
        const box = L.rectangle(
          riskCellToLeafletBounds(cell, image, grid, inverse, fallbackWidth, fallbackHeight),
          {
            color: isSelected ? '#f4f0dc' : colors[cell.class],
            weight: isSelected ? 2.2 : 1,
            fillColor: colors[cell.class],
            fillOpacity: isSelected ? 0.34 : cell.class === 'safe' ? 0.08 : 0.2,
          },
        ).addTo(overlays)

        const tip = document.createElement('span')
        tip.textContent = `${cell.cell_id} · ${cell.class.toUpperCase()} · ${cell.boulder_count} detections${
          cell.max_size_m !== null ? ` · max ${cell.max_size_m.toFixed(2)} m` : ''
        }`
        box.bindTooltip(tip, { sticky: true })
        box.on('click', () => onSelectCell(cell.cell_id))
      })
    }

    if (showDetections) {
      detections.forEach((detection) => {
        const isSelected = detection.detection_id === selectedDetectionId
        const box = L.rectangle(detectionToLeafletBounds(detection, image), {
          color: isSelected ? '#ffe39b' : '#df835d',
          weight: isSelected ? 2.5 : 1.5,
          fillColor: '#df835d',
          fillOpacity: isSelected ? 0.25 : 0.08,
        }).addTo(overlays)

        const tip = document.createElement('span')
        tip.textContent = `${
          detection.estimated_size_m !== null
            ? `~${detection.estimated_size_m.toFixed(2)} m`
            : 'Size unavailable'
        } · ${(detection.confidence * 100).toFixed(0)}% confidence`
        box.bindTooltip(tip, { sticky: true })
        box.on('click', () => onSelectDetection(detection.detection_id))
      })
    }
  }, [
    image,
    detections,
    grid,
    showGrid,
    showDetections,
    selectedDetectionId,
    selectedCellId,
    onSelectDetection,
    onSelectCell,
  ])

  useEffect(() => {
    if (!selectedDetectionId || !mapRef.current) return
    const target = detections.find((d) => d.detection_id === selectedDetectionId)
    if (!target) return
    const bounds = detectionToLeafletBounds(target, image)
    mapRef.current.fitBounds(bounds, { maxZoom: 2, padding: [48, 48] })
  }, [selectedDetectionId, detections, image])

  return <div className="map-view" ref={host} />
}

function App() {
  const [images, setImages] = useState<ImageMetadata[]>([])
  const [image, setImage] = useState<ImageMetadata | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [detections, setDetections] = useState<Detection[]>([])
  const [grid, setGrid] = useState<RiskGrid | null>(null)
  const [thresholdProfile, setThresholdProfile] = useState<ThresholdProfile>('rover')
  const [thresholds, setThresholds] = useState<ThresholdConfig>(ILLUSTRATIVE_PROFILE_DEFAULTS.rover)
  const [profileOptions, setProfileOptions] = useState<Record<ThresholdProfile, ThresholdConfig> | null>(null)
  const [busy, setBusy] = useState(false)
  const [applyingThresholds, setApplyingThresholds] = useState(false)
  const [thresholdNotice, setThresholdNotice] = useState('')
  const [error, setError] = useState('')
  const [manifest, setManifest] = useState<File | undefined>()
  const [inlineMetaOpen, setInlineMetaOpen] = useState(false)
  const [sourceImageIdInput, setSourceImageIdInput] = useState('')
  const [gsdXInput, setGsdXInput] = useState('')
  const [gsdYInput, setGsdYInput] = useState('')
  const [coverageInput, setCoverageInput] = useState<'' | 'valid' | 'partial' | 'missing'>('')
  const [settingsOpen, setSettingsOpen] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const [showDetections, setShowDetections] = useState(true)
  const [selectedDetectionId, setSelectedDetectionId] = useState<string | null>(null)
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null)
  const [fitNonce, setFitNonce] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)

  const clearAnalysisState = useCallback(() => {
    setJob(null)
    setDetections([])
    setGrid(null)
    setSelectedDetectionId(null)
    setSelectedCellId(null)
    setThresholdNotice('')
  }, [])

  const reload = useCallback(async () => {
    const listed = await api.listImages()
    setImages(listed.images)
    setImage((current) =>
      current
        ? listed.images.find((item) => item.image_id === current.image_id) || current
        : listed.images[0] || null,
    )
  }, [])

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : 'Could not load image library'))
    api
      .profiles()
      .then(setProfileOptions)
      .catch(() => {})
  }, [reload])

  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return
    const timer = window.setInterval(async () => {
      try {
        const updated = await api.job(job.job_id)
        setJob(updated)
        if (updated.status === 'completed') {
          const results = await api.results(job.job_id)
          setDetections(results.detections)
          setGrid(results.risk_grid)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to read job status')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [job])

  useEffect(() => {
    if (job?.status === 'failed' && job.error) setError(job.error)
  }, [job])

  const handleUpload = async (file?: File) => {
    if (!file) return
    if (gsdXInput.trim() && (!Number.isFinite(Number(gsdXInput)) || Number(gsdXInput) <= 0)) {
      setError('GSD X must be a positive number in meters/pixel.')
      return
    }
    if (gsdYInput.trim() && (!Number.isFinite(Number(gsdYInput)) || Number(gsdYInput) <= 0)) {
      setError('GSD Y must be a positive number in meters/pixel.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const uploaded = await api.upload(file, {
        manifest,
        sourceImageId: sourceImageIdInput,
        gsdXMPerPx: gsdXInput,
        gsdYMPerPx: gsdYInput,
        coverage: coverageInput,
      })
      setImages((current) => [
        uploaded.metadata,
        ...current.filter((item) => item.image_id !== uploaded.image_id),
      ])
      setImage(uploaded.metadata)
      clearAnalysisState()
      setManifest(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!image) return
    setBusy(true)
    setError('')
    clearAnalysisState()
    try {
      setJob(await api.start(image.image_id, thresholdProfile, thresholds))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start processing')
    } finally {
      setBusy(false)
    }
  }

  const updateThreshold = (key: keyof ThresholdConfig, value: string | boolean) => {
    setThresholdProfile('custom')
    setThresholdNotice('')
    setThresholds((current) => {
      const next: ThresholdConfig = {
        ...current,
        note: 'Custom illustrative screening thresholds; unvalidated for mission use.',
      }
      if (typeof value === 'boolean') {
        if (key === 'require_lunar_transform_for_safe' || key === 'illustrative_only') {
          next[key] = value
        }
        return next
      }
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return current
      if (key === 'cell_size_m') next.cell_size_m = Math.max(1, parsed)
      if (key === 'caution_boulder_size_m') {
        next.caution_boulder_size_m = Math.max(0.05, parsed)
        next.unsafe_boulder_size_m = Math.max(next.caution_boulder_size_m, current.unsafe_boulder_size_m)
      }
      if (key === 'unsafe_boulder_size_m') {
        next.unsafe_boulder_size_m = Math.max(0.05, parsed)
        next.caution_boulder_size_m = Math.min(next.unsafe_boulder_size_m, current.caution_boulder_size_m)
      }
      if (key === 'caution_boulder_count') {
        next.caution_boulder_count = Math.max(1, Math.round(parsed))
        next.unsafe_boulder_count = Math.max(next.caution_boulder_count, current.unsafe_boulder_count)
      }
      if (key === 'unsafe_boulder_count') {
        next.unsafe_boulder_count = Math.max(1, Math.round(parsed))
        next.caution_boulder_count = Math.min(next.unsafe_boulder_count, current.caution_boulder_count)
      }
      if (key === 'min_confidence') next.min_confidence = Math.min(1, Math.max(0, parsed))
      if (key === 'min_cell_coverage') next.min_cell_coverage = Math.min(1, Math.max(0, parsed))
      return next
    })
  }

  const saveThresholds = async () => {
    if (!job || job.status !== 'completed') return
    setApplyingThresholds(true)
    setError('')
    setThresholdNotice('')
    try {
      const updated = await api.thresholds(job.job_id, thresholdProfile, thresholds)
      setGrid(updated.risk_grid)
      setJob((prev) => (prev ? { ...prev, threshold_profile: updated.threshold_profile } : prev))
      setSelectedCellId(null)
      setThresholdNotice('Risk grid recalculated without rerunning boulder detection.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not recalculate risk')
    } finally {
      setApplyingThresholds(false)
    }
  }

  const chooseProfile = (profile: ThresholdProfile) => {
    setThresholdProfile(profile)
    setThresholdNotice('')
    const source = profileOptions ?? ILLUSTRATIVE_PROFILE_DEFAULTS
    setThresholds(source[profile])
  }

  const scale = image?.gsd_x_m_per_px && image?.gsd_y_m_per_px
  const uncertain = !image || image.coverage !== 'valid' || !scale || image.coordinate_frame !== 'lunar_local_m'
  const rawTransformUncertainty = image?.image_to_lunar?.uncertainty_m
  const transformUncertainty = typeof rawTransformUncertainty === 'number' ? rawTransformUncertainty : null
  const transformAccuracyUnknown =
    image?.coordinate_frame === 'lunar_local_m' && transformUncertainty === null

  const counts = useMemo(
    () => ({
      total: detections.length,
      unsafe: grid?.cells.filter((cell) => cell.class === 'unsafe').length || 0,
      caution: grid?.cells.filter((cell) => cell.class === 'caution').length || 0,
      uncertain: grid?.cells.filter((cell) => cell.class === 'uncertain').length || 0,
      safe: grid?.cells.filter((cell) => cell.class === 'safe').length || 0,
    }),
    [detections, grid],
  )

  const selectedDetection = useMemo(
    () => detections.find((d) => d.detection_id === selectedDetectionId) || null,
    [detections, selectedDetectionId],
  )
  const selectedCell = useMemo(
    () => grid?.cells.find((c) => c.cell_id === selectedCellId) || null,
    [grid, selectedCellId],
  )

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#top"
          onClick={(e) => {
            e.preventDefault()
            setFitNonce((n) => n + 1)
          }}
        >
          <span className="brand-mark">
            <Moon size={18} fill="currentColor" />
          </span>
          <span>
            MOONSAFE<small>MISSION SCREENING</small>
          </span>
        </a>
        <div className="top-context">
          <span className="live-dot" /> LUNAR SURFACE ANALYSIS <span className="divider">/</span> LROC NAC
        </div>
        <div className="top-actions">
          <span className="prototype-tag">PROTOTYPE · NO 3D DEM</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Help and methodology"
            title="Prototype limits & methodology"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left-rail">
          <div className="rail-label">WORKSPACE</div>
          <button type="button" className="rail-item active">
            <MapIcon size={18} />
            <span>Surface map</span>
          </button>
          <button type="button" className="rail-item" onClick={() => setSettingsOpen((v) => !v)}>
            <SlidersHorizontal size={18} />
            <span>Risk settings</span>
          </button>
          <div className="rail-bottom">
            <div className="status-orb">
              <Moon size={16} />
            </div>
            <span>
              LOCAL LIBRARY<small>UPLOADS STORED ON THIS HOST</small>
            </span>
          </div>
        </aside>

        <section className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">LUNAR TERRAIN INTELLIGENCE</div>
              <h1>Boulder risk screening</h1>
              <p>
                Review candidate hazards across LROC Narrow Angle Camera imagery. Screening aid only;
                unvalidated thresholds and no physical height inference.
              </p>
            </div>
            <div className="screening-label">
              <Shield size={15} /> SCREENING AID ONLY
            </div>
          </div>

          <div className="toolbar">
            <label className="select-wrap">
              <FileImage size={16} />
              <select
                aria-label="Select an image"
                value={image?.image_id || ''}
                onChange={(e) => {
                  const selected = images.find((item) => item.image_id === e.target.value)
                  setImage(selected || null)
                  clearAnalysisState()
                }}
              >
                <option value="">Choose an image</option>
                {images.map((item) => (
                  <option key={item.image_id} value={item.image_id}>
                    {item.source_image_id} ({item.width_px}×{item.height_px})
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>

            <label className="manifest-input" title="Optional JSON sidecar manifest">
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => setManifest(e.target.files?.[0])}
              />
              {manifest ? <Check size={15} /> : <Plus size={15} />}
              <span>{manifest ? manifest.name : 'Add manifest'}</span>
            </label>

            <button
              type="button"
              className={`meta-toggle-btn ${inlineMetaOpen ? 'active' : ''}`}
              onClick={() => setInlineMetaOpen((v) => !v)}
              title="Optional inline scale and coverage fields"
            >
              <SlidersHorizontal size={14} />
              <span>Scale / coverage</span>
            </button>

            <label className="upload-btn">
              <Upload size={15} /> Upload NAC image
              <input
                type="file"
                accept="image/png,image/jpeg,image/tiff,.tif,.tiff"
                onChange={(e) => handleUpload(e.target.files?.[0])}
                disabled={busy}
              />
            </label>

            <button
              type="button"
              className="run-btn"
              onClick={run}
              disabled={!image || busy || job?.status === 'queued' || job?.status === 'running'}
            >
              {job?.status === 'queued' || job?.status === 'running' ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ScanSearch size={16} />
              )}
              {job?.status === 'queued' || job?.status === 'running' ? 'Processing' : 'Run detection'}
            </button>
          </div>

          {inlineMetaOpen && (
            <div className="inline-meta-bar">
              <label>
                <span>Source ID</span>
                <input
                  type="text"
                  placeholder="e.g. M1234567890L"
                  value={sourceImageIdInput}
                  onChange={(e) => setSourceImageIdInput(e.target.value)}
                />
              </label>
              <label>
                <span>GSD X (m/px)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.05"
                  placeholder="unknown"
                  value={gsdXInput}
                  onChange={(e) => setGsdXInput(e.target.value)}
                />
              </label>
              <label>
                <span>GSD Y (m/px)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.05"
                  placeholder="unknown"
                  value={gsdYInput}
                  onChange={(e) => setGsdYInput(e.target.value)}
                />
              </label>
              <label>
                <span>Coverage</span>
                <select
                  value={coverageInput}
                  onChange={(e) =>
                    setCoverageInput(e.target.value as '' | 'valid' | 'partial' | 'missing')
                  }
                >
                  <option value="">Default (missing)</option>
                  <option value="valid">valid</option>
                  <option value="partial">partial</option>
                  <option value="missing">missing</option>
                </select>
              </label>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <AlertTriangle size={16} />
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}

          {!image ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Radar size={28} />
              </div>
              <h2>Start with a NAC image</h2>
              <p>
                Upload a local LROC NAC raster to begin a screening session. Attach a sidecar manifest
                or enter verified GSD and coverage metadata when available.
              </p>
              <label className="upload-btn large">
                <Upload size={16} /> Select image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/tiff,.tif,.tiff"
                  onChange={(e) => handleUpload(e.target.files?.[0])}
                />
              </label>
              <div className="format-hint">PNG · JPEG · TIFF</div>
            </div>
          ) : (
            <>
              <div className="status-strip">
                <div>
                  <span className="status-dot" />
                  {job?.status === 'completed' && job.model_status !== 'executed'
                    ? 'MODEL NOT CONFIGURED (CELLS UNCERTAIN)'
                    : job?.status === 'completed'
                      ? 'ANALYSIS COMPLETE'
                      : job?.status === 'failed'
                        ? 'PROCESSING FAILED'
                        : job?.status === 'running' || job?.status === 'queued'
                          ? 'ANALYSIS IN PROGRESS'
                          : 'IMAGE READY'}
                </div>
                <div className="status-meta">
                  <span>
                    {image.width_px.toLocaleString()} × {image.height_px.toLocaleString()} PX
                  </span>
                  <span>
                    GSD {scale ? `${image.gsd_x_m_per_px} × ${image.gsd_y_m_per_px} M/PIX` : 'NOT PROVIDED'}
                  </span>
                  <span>
                    {image.coordinate_frame === 'lunar_local_m'
                      ? 'LUNAR LOCAL FRAME (M)'
                      : 'IMAGE PIXEL FRAME'}
                  </span>
                </div>
              </div>

              {uncertain && (
                <div className="uncertainty-banner">
                  <AlertTriangle size={16} />
                  <span>
                    <b>Spatial context is incomplete.</b> The map uses image pixels; lunar coordinates,
                    scale, or coverage are not fully established. Lunar coordinates are never treated as
                    Earth latitude/longitude.
                  </span>
                </div>
              )}

              {!uncertain && transformAccuracyUnknown && (
                <div className="uncertainty-banner">
                  <AlertTriangle size={16} />
                  <span>
                    <b>Transform accuracy is not reported.</b> Positions use the supplied{' '}
                    <code>lunar_local_m</code> transform; its geolocation uncertainty is unknown.
                  </span>
                </div>
              )}

              <div className="map-card">
                <div className="map-head">
                  <div>
                    <div className="map-title">
                      <Crosshair size={16} /> IMAGE SPACE{' '}
                      <span className="map-subtitle">{image.source_image_id}</span>
                    </div>
                    <div className="map-caption">
                      Leaflet 2D image-aligned viewer ·{' '}
                      {image.coordinate_frame === 'lunar_local_m'
                        ? 'supplied lunar_local_m affine transform'
                        : 'pixel coordinates are authoritative; lunar location is uncertain'}
                    </div>
                  </div>
                  <div className="map-actions">
                    <button
                      type="button"
                      className={`map-chip ${showGrid ? 'active' : ''}`}
                      onClick={() => setShowGrid((v) => !v)}
                      title="Toggle RiskGrid layer"
                    >
                      {showGrid ? <Eye size={13} /> : <EyeOff size={13} />}
                      <span>Risk grid</span>
                    </button>
                    <button
                      type="button"
                      className={`map-chip ${showDetections ? 'active' : ''}`}
                      onClick={() => setShowDetections((v) => !v)}
                      title="Toggle boulder detection boxes"
                    >
                      {showDetections ? <Eye size={13} /> : <EyeOff size={13} />}
                      <span>Detections</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn map-tool"
                      title="Fit image to view"
                      onClick={() => setFitNonce((n) => n + 1)}
                    >
                      <Maximize2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn map-tool"
                      title="Refresh image list"
                      onClick={() => reload()}
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                </div>

                <div className="map-wrap">
                  <MapPanel
                    image={image}
                    detections={detections}
                    grid={grid}
                    showGrid={showGrid}
                    showDetections={showDetections}
                    selectedDetectionId={selectedDetectionId}
                    selectedCellId={selectedCellId}
                    fitNonce={fitNonce}
                    onSelectDetection={(id) => {
                      setSelectedDetectionId(id)
                      setSelectedCellId(null)
                    }}
                    onSelectCell={(id) => {
                      setSelectedCellId(id)
                      setSelectedDetectionId(null)
                    }}
                  />
                  {!grid && (
                    <div className="map-overlay-note">
                      <Layers3 size={14} />{' '}
                      {job?.status === 'failed'
                        ? 'Detection failed — review job error and weights configuration'
                        : 'Risk overlay appears after a completed detection job'}
                    </div>
                  )}
                </div>

                <div className="map-legend">
                  <span>
                    <i className="legend-swatch" style={{ background: colors.safe }} /> Safe ({counts.safe})
                  </span>
                  <span>
                    <i className="legend-swatch" style={{ background: colors.caution }} /> Caution (
                    {counts.caution})
                  </span>
                  <span>
                    <i className="legend-swatch" style={{ background: colors.unsafe }} /> Unsafe (
                    {counts.unsafe})
                  </span>
                  <span>
                    <i className="legend-swatch" style={{ background: colors.uncertain }} /> Uncertain (
                    {counts.uncertain})
                  </span>
                  <span className="legend-note">
                    Screening only · click any cell or detection box to inspect details.
                  </span>
                </div>
              </div>

              {(selectedDetection || selectedCell) && (
                <div className="inspector-card">
                  <div className="section-head">
                    <div>
                      <div className="eyebrow">
                        {selectedDetection ? 'SELECTED DETECTION' : 'SELECTED RISK CELL'}
                      </div>
                      <h3>
                        {selectedDetection ? selectedDetection.detection_id : selectedCell?.cell_id}
                      </h3>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Clear selection"
                      onClick={() => {
                        setSelectedDetectionId(null)
                        setSelectedCellId(null)
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>

                  {selectedDetection && (
                    <div className="inspector-grid">
                      <div>
                        <span>Estimated size (2D proxy)</span>
                        <b>
                          {selectedDetection.estimated_size_m !== null
                            ? `~${selectedDetection.estimated_size_m.toFixed(2)} m`
                            : 'Unavailable (GSD missing)'}
                        </b>
                      </div>
                      <div>
                        <span>Size uncertainty</span>
                        <b>
                          {selectedDetection.size_uncertainty_m !== null
                            ? `±${selectedDetection.size_uncertainty_m.toFixed(2)} m`
                            : 'Not calibrated'}
                        </b>
                      </div>
                      <div>
                        <span>Position ({selectedDetection.position.frame})</span>
                        <b>
                          ({selectedDetection.position.x.toFixed(2)},{' '}
                          {selectedDetection.position.y.toFixed(2)})
                          {selectedDetection.position.frame === 'image_px'
                            ? ' px · lunar location uncertain'
                            : selectedDetection.position.uncertainty_m !== null
                              ? ` m · ±${selectedDetection.position.uncertainty_m.toFixed(2)} m`
                              : ' m · uncertainty unknown'}
                        </b>
                      </div>
                      <div>
                        <span>Confidence / model</span>
                        <b>
                          {(selectedDetection.confidence * 100).toFixed(1)}% ·{' '}
                          {selectedDetection.model_version}
                        </b>
                      </div>
                      <div>
                        <span>BBox (px)</span>
                        <code>[{selectedDetection.bbox_px.map((v) => v.toFixed(1)).join(', ')}]</code>
                      </div>
                    </div>
                  )}

                  {selectedCell && (
                    <div className="inspector-grid">
                      <div>
                        <span>Screening class</span>
                        <b className="uppercase">{selectedCell.class}</b>
                      </div>
                      <div>
                        <span>Boulders in cell</span>
                        <b>{selectedCell.boulder_count}</b>
                      </div>
                      <div>
                        <span>Max estimated size</span>
                        <b>
                          {selectedCell.max_size_m !== null
                            ? `${selectedCell.max_size_m.toFixed(2)} m`
                            : 'N/A'}
                        </b>
                      </div>
                      <div>
                        <span>Cell coverage</span>
                        <b>{(selectedCell.coverage * 100).toFixed(0)}%</b>
                      </div>
                      <div>
                        <span>Center ({grid?.coordinate_frame})</span>
                        <b>
                          ({selectedCell.x.toFixed(2)}, {selectedCell.y.toFixed(2)})
                        </b>
                      </div>
                      <div>
                        <span>Reason codes</span>
                        <code>{selectedCell.reason_codes.join(', ') || 'NONE'}</code>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="summary-grid">
                <div className="metric-card">
                  <div className="metric-icon">
                    <ScanSearch size={16} />
                  </div>
                  <div>
                    <span>CANDIDATES</span>
                    <strong>{job?.status === 'completed' ? counts.total : '—'}</strong>
                  </div>
                  <small>
                    {job?.status === 'completed' && job.model_status === 'executed'
                      ? 'from configured model'
                      : 'awaiting detection'}
                  </small>
                </div>
                <div className="metric-card">
                  <div className="metric-icon orange">
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <span>UNSAFE CELLS</span>
                    <strong>{grid ? counts.unsafe : '—'}</strong>
                  </div>
                  <small>illustrative threshold</small>
                </div>
                <div className="metric-card">
                  <div className="metric-icon yellow">
                    <Activity size={16} />
                  </div>
                  <div>
                    <span>CAUTION CELLS</span>
                    <strong>{grid ? counts.caution : '—'}</strong>
                  </div>
                  <small>illustrative threshold</small>
                </div>
                <div className="metric-card">
                  <div className="metric-icon">
                    <Gauge size={16} />
                  </div>
                  <div>
                    <span>MODEL</span>
                    <strong className="model-status">
                      {job?.status === 'completed' && job.model_status === 'executed'
                        ? 'EXECUTED'
                        : job?.status === 'completed'
                          ? 'UNCONFIGURED'
                          : job?.status === 'failed'
                            ? 'FAILED'
                            : 'NOT SET'}
                    </strong>
                  </div>
                  <small>{job?.model_version || 'awaiting configured weights'}</small>
                </div>
              </div>

              <div className="detail-grid">
                <section className="detail-card">
                  <div className="section-head">
                    <div>
                      <div className="eyebrow">IMAGE METADATA</div>
                      <h3>Source details</h3>
                    </div>
                    <span className="coverage-pill">{image.coverage.toUpperCase()} COVERAGE</span>
                  </div>
                  <div className="metadata-list">
                    <div>
                      <span>Image ID</span>
                      <code title={image.image_id}>
                        {image.image_id.length > 22
                          ? `${image.image_id.slice(0, 20)}…`
                          : image.image_id}
                      </code>
                    </div>
                    <div>
                      <span>Source product</span>
                      <code>{image.source_image_id}</code>
                    </div>
                    <div>
                      <span>Dimensions</span>
                      <b>
                        {image.width_px} × {image.height_px} px
                      </b>
                    </div>
                    <div>
                      <span>GSD (m/px)</span>
                      <b>
                        {scale ? `${image.gsd_x_m_per_px} × ${image.gsd_y_m_per_px}` : 'Not provided'}
                      </b>
                    </div>
                    <div>
                      <span>Coordinate frame</span>
                      <b>
                        {image.coordinate_frame === 'image_px'
                          ? 'Image pixels (lunar uncertain)'
                          : 'Lunar local meters'}
                      </b>
                    </div>
                  </div>
                </section>

                <section className="detail-card">
                  <div className="section-head">
                    <div>
                      <div className="eyebrow">DETECTION REVIEW</div>
                      <h3>Candidate boulders</h3>
                    </div>
                    <span className="count-pill">{detections.length} FOUND</span>
                  </div>
                  {detections.length ? (
                    <div className="detection-list">
                      {detections.map((d) => {
                        const detUncertainty = d.position.uncertainty_m ?? transformUncertainty
                        const isSelected = d.detection_id === selectedDetectionId
                        return (
                          <button
                            type="button"
                            className={`detection-row ${isSelected ? 'selected' : ''}`}
                            key={d.detection_id}
                            onClick={() => {
                              setSelectedDetectionId(d.detection_id)
                              setSelectedCellId(null)
                            }}
                          >
                            <span className="candidate-mark">●</span>
                            <span>
                              {d.estimated_size_m !== null
                                ? `~${d.estimated_size_m.toFixed(2)} m`
                                : 'Size unavailable'}
                              <small>
                                ({d.position.x.toFixed(1)}, {d.position.y.toFixed(1)}){' '}
                                {d.position.frame === 'image_px'
                                  ? 'px · location uncertain'
                                  : detUncertainty !== null
                                    ? `m · ±${detUncertainty.toFixed(2)} m`
                                    : 'm · uncertainty unknown'}
                              </small>
                            </span>
                            <b>{Math.round(d.confidence * 100)}%</b>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="no-results">
                      {job?.status === 'failed'
                        ? 'Detection failed. Review the job error and model configuration.'
                        : job?.status === 'completed' && job.model_status !== 'executed'
                          ? job.status_message
                          : 'No detections returned by the configured model for this image.'}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </section>

        <aside className={`right-panel ${settingsOpen ? '' : 'collapsed'}`}>
          <div className="panel-head">
            <div>
              <div className="eyebrow">SCREENING PROFILE</div>
              <h2>Risk settings</h2>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Toggle risk settings"
            >
              {settingsOpen ? <X size={17} /> : <Settings2 size={17} />}
            </button>
          </div>

          {settingsOpen && (
            <>
              <div className="profile-select">
                <label>Vehicle profile</label>
                <div className="profile-buttons">
                  {(['lander', 'rover', 'custom'] as const).map((profile) => (
                    <button
                      type="button"
                      key={profile}
                      className={thresholdProfile === profile ? 'selected' : ''}
                      onClick={() => chooseProfile(profile)}
                    >
                      {profile}
                    </button>
                  ))}
                </div>
              </div>

              <div className="threshold-section">
                <div className="threshold-title">
                  <span>BOULDER SIZE THRESHOLDS</span>
                  <span className="illustrative">ILLUSTRATIVE</span>
                </div>

                <label className="range-row">
                  <span>
                    Caution from <b>{thresholds.caution_boulder_size_m.toFixed(1)} m</b>
                  </span>
                  <input
                    type="range"
                    min="0.1"
                    max="8"
                    step="0.1"
                    value={thresholds.caution_boulder_size_m}
                    onChange={(e) => updateThreshold('caution_boulder_size_m', e.target.value)}
                  />
                </label>

                <label className="range-row">
                  <span>
                    Unsafe from <b>{thresholds.unsafe_boulder_size_m.toFixed(1)} m</b>
                  </span>
                  <input
                    type="range"
                    min="0.1"
                    max="15"
                    step="0.1"
                    value={thresholds.unsafe_boulder_size_m}
                    onChange={(e) => updateThreshold('unsafe_boulder_size_m', e.target.value)}
                  />
                </label>

                <label className="range-row">
                  <span>
                    Caution count <b>{thresholds.caution_boulder_count}</b>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="12"
                    step="1"
                    value={thresholds.caution_boulder_count}
                    onChange={(e) => updateThreshold('caution_boulder_count', e.target.value)}
                  />
                </label>

                <label className="range-row">
                  <span>
                    Unsafe count <b>{thresholds.unsafe_boulder_count}</b>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="24"
                    step="1"
                    value={thresholds.unsafe_boulder_count}
                    onChange={(e) => updateThreshold('unsafe_boulder_count', e.target.value)}
                  />
                </label>

                <label className="number-row">
                  <span>Risk cell width</span>
                  <span>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      value={thresholds.cell_size_m}
                      onChange={(e) => updateThreshold('cell_size_m', e.target.value)}
                    />{' '}
                    m
                  </span>
                </label>

                <label className="number-row">
                  <span>Minimum confidence</span>
                  <span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={thresholds.min_confidence}
                      onChange={(e) => updateThreshold('min_confidence', e.target.value)}
                    />
                  </span>
                </label>

                <label className="number-row">
                  <span>Min cell coverage</span>
                  <span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={thresholds.min_cell_coverage}
                      onChange={(e) => updateThreshold('min_cell_coverage', e.target.value)}
                    />
                  </span>
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={thresholds.require_lunar_transform_for_safe}
                    onChange={(e) =>
                      updateThreshold('require_lunar_transform_for_safe', e.target.checked)
                    }
                  />
                  <span>Require lunar transform for Safe</span>
                </label>

                <p className="setting-hint">
                  Values are illustrative and unvalidated. Apply after detection to recalculate risk
                  without rerunning the detector.
                </p>

                <button
                  type="button"
                  className="apply-btn"
                  disabled={!job || job.status !== 'completed' || applyingThresholds}
                  onClick={saveThresholds}
                >
                  {applyingThresholds ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Check size={15} />
                  )}{' '}
                  Apply & recalculate
                </button>

                {thresholdNotice && <p className="apply-notice">{thresholdNotice}</p>}
              </div>

              <div className="profile-note">
                <Shield size={17} />
                <span>
                  <b>Screening aid only</b>
                  <small>
                    Risk classes do not guarantee safe landing or travel. Confirm results with
                    mission-specific review.
                  </small>
                </span>
              </div>

              <div className="panel-foot">
                <span>MODEL STATUS</span>
                <b className={job?.model_status === 'executed' ? 'ready' : ''}>
                  <i />
                  {job?.model_status === 'executed'
                    ? 'Executed'
                    : job?.model_status || 'Weights not configured'}
                </b>
                <small>
                  Detections appear only when trained weights (MOONSAFE_YOLO_WEIGHTS) are configured.
                </small>
              </div>
            </>
          )}
        </aside>
      </div>

      {helpOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="help-title">
          <div className="modal-card">
            <div className="section-head">
              <div>
                <div className="eyebrow">METHODOLOGY &amp; LIMITATIONS</div>
                <h3 id="help-title">MoonSafe Screening Prototype</h3>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close help"
                onClick={() => setHelpOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <ul className="help-list">
              <li>
                <b>Screening aid only:</b> Lander and rover risk profiles are illustrative and
                unvalidated. Risk cells never certify safe landing or surface traverse.
              </li>
              <li>
                <b>Detector honesty:</b> Ultralytics YOLO runs only when <code>MOONSAFE_YOLO_WEIGHTS</code>{' '}
                is configured. Without weights, jobs complete with zero detections and mark all cells{' '}
                <code>uncertain</code>.
              </li>
              <li>
                <b>No invented height or georeferencing:</b> Physical boulder height is never estimated
                from 2D imagery. Without a valid <code>lunar_local_m</code> affine transform, coordinates
                stay in <code>image_px</code> and are never treated as Earth longitude/latitude.
              </li>
              <li>
                <b>3D terrain disabled:</b> React Three Fiber / Drei 3D visualization is withheld until
                real lunar DEM / elevation data is supplied (<code>has_elevation_data: false</code>).
              </li>
            </ul>
          </div>
        </div>
      )}

      <footer className="footer">
        <span>
          MOONSAFE <span className="footer-version">0.1</span>
        </span>
        <span>
          RESEARCH PROTOTYPE <i /> NO SAFETY GUARANTEE
        </span>
      </footer>
    </main>
  )
}

export default App

