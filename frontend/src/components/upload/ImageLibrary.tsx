/**
 * Shows previously uploaded images and lets the user select one to re-run.
 */
import { useEffect, useState } from 'react'
import { listImages } from '../../api/client'
import type { ImageListItem } from '../../types/api'

interface Props {
  onSelect: (item: ImageListItem) => void
  selectedId: string | null
}

export function ImageLibrary({ onSelect, selectedId }: Props) {
  const [images, setImages] = useState<ImageListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listImages()
      .then(setImages)
      .catch(() => setImages([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <p className="text-xs text-moon-500 py-2">Loading library…</p>
  }

  if (images.length === 0) {
    return <p className="text-xs text-moon-600 py-2">No images uploaded yet.</p>
  }

  return (
    <ul className="divide-y divide-moon-800">
      {images.map((img) => (
        <li key={img.image_id}>
          <button
            onClick={() => onSelect(img)}
            className={[
              'w-full text-left px-3 py-2 hover:bg-moon-800/60 transition-colors',
              selectedId === img.image_id ? 'bg-moon-800' : '',
            ].join(' ')}
          >
            <p className="text-sm text-moon-200 truncate">{img.filename || img.image_id}</p>
            <p className="text-xs text-moon-500 font-mono mt-0.5">
              {img.width_px}×{img.height_px}px
              {img.gsd_x_m_per_px != null
                ? ` · GSD ${img.gsd_x_m_per_px.toFixed(3)} m/px`
                : ' · GSD unknown'}
              {' · '}
              <span className={img.coverage === 'valid' ? 'text-green-400' : 'text-moon-500'}>
                {img.coverage}
              </span>
            </p>
          </button>
        </li>
      ))}
    </ul>
  )
}
