/**
 * Main workspace: left panel (upload + run + thresholds + detection list),
 * right panel (Leaflet risk map).
 */
import { useCallback, useEffect, useState } from 'react'
import { createJob, getJobResults } from '../api/client'
import { ImageUpload } from '../components/upload/ImageUpload'
import { ImageLibrary } from '../components/upload/ImageLibrary'
import { ThresholdPanel } from '../components/risk/ThresholdPanel'
import { DetectionList } from '../components/viewer/DetectionList'
import { DetectionDetail } from '../components/viewer/DetectionDetail'
import { JobProgress } from '../components/viewer/JobProgress'
import { RiskMap } from '../components/viewer/RiskMap'
import { useJobPoller } from '../hooks/useJobPoller'
import type {
  Detection,
  ImageListItem,
  ImageMetadata,
  ImageUploadResponse,
  JobResults,
  RiskGrid,
  ThresholdProfile,
} from '../types/api'
import { countByClass } from '../utils/format'

type Panel = 'upload' | 'library' | 'thresholds' | 'detections'

export function WorkspacePage() {
  // ── Active image ───────────────────────────────────────────────────────────
  const [imageId, setImageId]       = useState<string | null>(null)
  const [metadata, setMetadata]     = useState<ImageMetadata | null>(null)
  const [profile, setProfile]       = useState<ThresholdProfile>('lander')

  // ── Job state ──────────────────────────────────────────────────────────────
  const [jobId, setJobId]           = useState<string | null>(null)
  const [results, setResults]       = useState<JobResults | null>(null)
  const [launching, setLaunching]   = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const { status: jobStatus, error: pollError } = useJobPoller(jobId)

  // ── Selection state ────────────────────────────────────────────────────────
  const [selectedDetId, setSelectedDetId] = useState<string | null>(null)
  const [activePanel, setActivePanel]     = useState<Panel>('upload')

  // ── Fetch results once job completes ──────────────────────────────────────
  useEffect(() => {
    if (jobStatus?.status === 'completed' && jobId) {
      getJobResults(jobId).then(setResults).catch(console.error)
    }
  }, [jobStatus?.status, jobId])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleUploaded = (res: ImageUploadResponse) => {
    setImageId(res.image_id)
    setMetadata(res.metadata)
    setJobId(null)
    setResults(null)
    setSelectedDetId(null)
  }

  const handleLibrarySelect = (item: ImageListItem) => {
    setImageId(item.image_id)
    setMetadata({
      image_id: item.image_id,
      source_image_id: item.image_id,
      width_px: item.width_px,
      height_px: item.height_px,
      gsd_x_m_per_px: item.gsd_x_m_per_px,
      gsd_y_m_per_px: item.gsd_y_m_per_px,
      coverage: item.coverage,
      coordinate_frame: 'image_px',
      image_to_lunar: null,
    })
    setJobId(null)
    setResults(null)
    setSelectedDetId(null)
  }

  const launchJob = async () => {
    if (!imageId) return
    setLaunchError(null)
    setLaunching(true)
    setResults(null)
    setSelectedDetId(null)
    try {
      const res = await createJob({
        image_id: imageId,
        threshold_profile: profile,
        confidence_threshold: 0.5,
        cell_size_px: 64,
      })
      setJobId(res.job_id)
    } catch (err: unknown) {
      setLaunchError(err instanceof Error ? err.message : 'Failed to start job')
    } finally {
      setLaunching(false)
    }
  }

  const handleThresholdsUpdated = () => {
    if (jobId) {
      getJobResults(jobId).then(setResults).catch(console.error)
    }
  }

  const detections: Detection[] = results?.detections ?? []
  const riskGrid: RiskGrid | null = results?.risk_grid ?? null
  const selectedDet = detections.find((d) => d.detection_id === selectedDetId) ?? null

  // Summary counts
  const classCounts = riskGrid ? countByClass(riskGrid.cells) : null

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left sidebar ───────────────────────────────────────────────────── */}
      <aside className="w-80 flex-shrink-0 flex flex-col bg-moon-900/60 border-r border-moon-800 overflow-y-auto">
        {/* Tab nav */}
        <nav className="flex border-b border-moon-800 text-xs font-medium">
          {(['upload', 'library', 'thresholds', 'detections'] as Panel[]).map((p) => (
            <button
              key={p}
              onClick={() => setActivePanel(p)}
              className={[
                'flex-1 py-2.5 capitalize transition-colors',
                activePanel === p
                  ? 'text-moon-100 border-b-2 border-moon-400'
                  : 'text-moon-500 hover:text-moon-300',
              ].join(' ')}
            >
              {p}
            </button>
          ))}
        </nav>

        <div className="flex-1 p-4 overflow-y-auto">
          {activePanel === 'upload' && (
            <div className="flex flex-col gap-4">
              <ImageUpload onUploaded={handleUploaded} />

              {imageId && (
                <div className="rounded-lg bg-moon-800/40 border border-moon-700 p-3 flex flex-col gap-2">
                  <p className="text-xs text-moon-400">Selected image</p>
                  <p className="text-xs font-mono text-moon-200 truncate">{imageId}</p>
                  {metadata && (
                    <p className="text-xs font-mono text-moon-500">
                      {metadata.width_px}×{metadata.height_px}px
                      {metadata.gsd_x_m_per_px != null
                        ? ` · GSD ${metadata.gsd_x_m_per_px.toFixed(3)} m/px`
                        : ' · GSD unknown'}
                    </p>
                  )}

                  <div className="flex gap-2 items-center mt-1">
                    <label className="text-xs text-moon-500">Profile:</label>
                    {(['lander', 'rover', 'custom'] as ThresholdProfile[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setProfile(p)}
                        className={[
                          'px-2 py-0.5 rounded text-xs capitalize border transition-colors',
                          profile === p
                            ? 'bg-moon-700 border-moon-500 text-moon-100'
                            : 'bg-moon-900 border-moon-700 text-moon-500 hover:border-moon-500',
                        ].join(' ')}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={launchJob}
                    disabled={launching || (jobStatus?.status === 'running' || jobStatus?.status === 'queued')}
                    className="mt-1 py-2 rounded bg-moon-600 hover:bg-moon-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
                  >
                    {launching ? 'Starting…' : 'Run Detection'}
                  </button>

                  {launchError && (
                    <p className="text-xs text-red-400">{launchError}</p>
                  )}
                </div>
              )}

              {/* Job progress */}
              {jobId && (
                <JobProgress status={jobStatus ?? null} error={pollError} />
              )}

              {/* Summary stats */}
              {classCounts && (
                <div className="rounded-lg border border-moon-800 bg-moon-900/40 p-3">
                  <p className="text-xs text-moon-400 mb-2">Risk summary</p>
                  <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                    {Object.entries(classCounts).map(([cls, n]) => (
                      <div key={cls} className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ background: { safe: '#22c55e', caution: '#f59e0b', unsafe: '#ef4444', uncertain: '#6366f1' }[cls] ?? '#888' }}
                        />
                        <span className="text-moon-400 capitalize">{cls}</span>
                        <span className="text-moon-200 ml-auto">{n}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-moon-700 mt-2">
                    {detections.length} detection{detections.length !== 1 ? 's' : ''} total
                  </p>
                </div>
              )}
            </div>
          )}

          {activePanel === 'library' && (
            <ImageLibrary
              onSelect={handleLibrarySelect}
              selectedId={imageId}
            />
          )}

          {activePanel === 'thresholds' && (
            <ThresholdPanel
              jobId={jobId}
              profile={profile}
              onUpdated={handleThresholdsUpdated}
            />
          )}

          {activePanel === 'detections' && (
            <div className="flex flex-col gap-3">
              <DetectionList
                detections={detections}
                selectedId={selectedDetId}
                onSelect={(id) => setSelectedDetId(id === selectedDetId ? null : id)}
              />
              {selectedDet && (
                <div className="border-t border-moon-800 pt-3">
                  <DetectionDetail detection={selectedDet} />
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ── Map panel ──────────────────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden">
        {metadata ? (
          <RiskMap
            metadata={metadata}
            detections={detections}
            riskGrid={riskGrid}
            selectedDetectionId={selectedDetId}
            onSelectDetection={(id) =>
              setSelectedDetId((prev) => (prev === id ? null : id))
            }
          />
        ) : (
          <EmptyMapPlaceholder />
        )}
      </main>
    </div>
  )
}

function EmptyMapPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-moon-600">
      <img src="/moon.svg" alt="" className="w-20 h-20 opacity-20" />
      <p className="text-sm">Upload or select an image to begin.</p>
    </div>
  )
}
