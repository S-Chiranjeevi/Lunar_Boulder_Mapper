/**
 * Drag-and-drop / file picker panel.
 * Calls onUploaded with the returned image_id + metadata on success.
 */
import { useCallback, useRef, useState } from 'react'
import { uploadImage } from '../../api/client'
import type { ImageUploadResponse } from '../../types/api'

interface Props {
  onUploaded: (result: ImageUploadResponse) => void
}

const ACCEPT = '.png,.jpg,.jpeg,.tif,.tiff,.img'

export function ImageUpload({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      setUploading(true)
      setProgress(0)
      try {
        // Fake progress pulse while awaiting — axios upload progress only
        // fires for the upload itself; detection runs server-side afterward.
        const timer = setInterval(() => {
          setProgress((p) => Math.min((p ?? 0) + 5, 90))
        }, 200)
        const result = await uploadImage(file)
        clearInterval(timer)
        setProgress(100)
        onUploaded(result)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
        setTimeout(() => setProgress(null), 600)
      }
    },
    [onUploaded],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors px-6 py-10',
          dragging
            ? 'border-moon-400 bg-moon-800/60'
            : 'border-moon-600 bg-moon-900/40 hover:border-moon-500 hover:bg-moon-800/40',
          uploading ? 'pointer-events-none opacity-70' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={onInputChange}
        />

        {/* Icon */}
        <svg
          className="w-10 h-10 text-moon-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>

        <p className="text-sm text-moon-300 text-center">
          Drop an LRO LROC NAC image here, or{' '}
          <span className="text-moon-100 underline">browse</span>
        </p>
        <p className="text-xs text-moon-500">
          PNG · JPEG · GeoTIFF · LRO IMG — max 500 MB
        </p>

        {/* Progress bar */}
        {progress != null && (
          <div className="absolute bottom-0 left-0 right-0 h-1 rounded-b-xl overflow-hidden bg-moon-800">
            <div
              className="h-full bg-moon-400 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-950/40 border border-red-800 rounded px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}
