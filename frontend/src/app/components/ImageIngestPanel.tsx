import { useRef, useState } from 'react';
import { FileJson, ImagePlus, Info, Loader2, Upload } from 'lucide-react';
import { ApiError, uploadImage } from '../api/client';
import type { CoverageState, ImageUploadResponse } from '../types/contracts';

interface ImageIngestPanelProps {
  onUploaded: (response: ImageUploadResponse) => void;
}

const ACCEPTED_IMAGE_TYPES = '.png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff';

export function ImageIngestPanel({ onUploaded }: ImageIngestPanelProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const manifestInputRef = useRef<HTMLInputElement | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [showMetadataFields, setShowMetadataFields] = useState(false);
  const [sourceImageId, setSourceImageId] = useState('');
  const [gsdX, setGsdX] = useState('');
  const [gsdY, setGsdY] = useState('');
  const [coverage, setCoverage] = useState<CoverageState | ''>('');

  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  function validateSelectedImage(file: File | null): file is File {
    if (!file) return false;
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (!['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) {
      setErrorMessage(
        `Unsupported file "${file.name}". Upload a PNG, JPEG, or TIFF LRO NAC image.`,
      );
      return false;
    }
    setErrorMessage(null);
    return true;
  }

  function handleFileSelection(file: File | null) {
    if (validateSelectedImage(file)) {
      setImageFile(file);
      setSuccessNotice(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!imageFile) {
      setErrorMessage('Select an LRO LROC NAC image file before uploading.');
      return;
    }

    if (gsdX.trim() && (Number.isNaN(Number(gsdX)) || Number(gsdX) <= 0)) {
      setErrorMessage('GSD X must be a positive number in meters/pixel.');
      return;
    }
    if (gsdY.trim() && (Number.isNaN(Number(gsdY)) || Number(gsdY) <= 0)) {
      setErrorMessage('GSD Y must be a positive number in meters/pixel.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);
    setSuccessNotice(null);

    try {
      const response = await uploadImage({
        file: imageFile,
        manifest: manifestFile,
        sourceImageId,
        gsdXMPerPx: gsdX,
        gsdYMPerPx: gsdY,
        coverage,
      });

      setSuccessNotice(
        `Ingested "${response.metadata.source_image_id}" (${response.metadata.width_px}×${response.metadata.height_px} px, frame: ${response.metadata.coordinate_frame}).`,
      );
      setImageFile(null);
      setManifestFile(null);
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (manifestInputRef.current) manifestInputRef.current.value = '';
      onUploaded(response);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Unexpected upload error. Verify the FastAPI backend is running.');
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <section className="ms-panel p-5 flex flex-col gap-4" aria-labelledby="ingest-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="ingest-heading" className="text-base font-semibold text-slate-100">
            1. Upload LRO LROC NAC Image
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Supports PNG, JPEG, and TIFF rasters with an optional sidecar JSON manifest.
          </p>
        </div>
        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
          POST /api/v1/images
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const dropped = e.dataTransfer.files?.[0] ?? null;
            handleFileSelection(dropped);
          }}
          className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
            isDragging
              ? 'border-sky-400 bg-sky-950/30'
              : 'border-slate-700/80 bg-[#0e131d] hover:border-slate-500'
          }`}
        >
          <input
            ref={imageInputRef}
            id="nac-image-input"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            className="sr-only"
            onChange={(e) => handleFileSelection(e.target.files?.[0] ?? null)}
          />

          <ImagePlus className="w-8 h-8 mx-auto text-sky-400/90 mb-2" />
          <p className="text-sm font-medium text-slate-200">
            {imageFile ? imageFile.name : 'Drop an LRO NAC raster here or browse'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {imageFile
              ? `${(imageFile.size / (1024 * 1024)).toFixed(2)} MB ready for ingestion`
              : 'PNG, JPEG, or TIFF. Without a verified transform, coordinates stay in image_px.'}
          </p>

          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="ms-btn-secondary text-xs"
            >
              Choose Image File
            </button>
            {imageFile && (
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  if (imageInputRef.current) imageInputRef.current.value = '';
                }}
                className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Optional manifest file */}
        <div className="ms-panel-elevated p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <FileJson className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-slate-200">
                Optional Sidecar Manifest (.json)
              </p>
              <p className="text-[11px] text-slate-400">
                {manifestFile
                  ? `Selected: ${manifestFile.name}`
                  : 'Supply GSD (m/px), coverage state, or affine image_to_lunar transform.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={manifestInputRef}
              id="nac-manifest-input"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => setManifestFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => manifestInputRef.current?.click()}
              className="ms-btn-secondary text-xs"
            >
              {manifestFile ? 'Change JSON' : 'Attach JSON'}
            </button>
            {manifestFile && (
              <button
                type="button"
                onClick={() => {
                  setManifestFile(null);
                  if (manifestInputRef.current) manifestInputRef.current.value = '';
                }}
                className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Optional inline metadata overrides */}
        <div>
          <button
            type="button"
            onClick={() => setShowMetadataFields((prev) => !prev)}
            className="text-xs text-sky-300 hover:text-sky-200 font-medium cursor-pointer"
          >
            {showMetadataFields
              ? '− Hide optional metadata overrides'
              : '+ Provide optional GSD / coverage metadata manually'}
          </button>

          {showMetadataFields && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 ms-panel-elevated p-3.5">
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>Source NAC Product ID</span>
                <input
                  type="text"
                  value={sourceImageId}
                  onChange={(e) => setSourceImageId(e.target.value)}
                  placeholder="e.g. M1234567890L"
                  className="ms-input font-mono text-xs"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>Coverage Assessment</span>
                <select
                  value={coverage}
                  onChange={(e) => setCoverage(e.target.value as CoverageState | '')}
                  className="ms-input text-xs"
                >
                  <option value="">Default (manifest or missing)</option>
                  <option value="valid">valid</option>
                  <option value="partial">partial</option>
                  <option value="missing">missing</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>GSD X (m/px)</span>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={gsdX}
                  onChange={(e) => setGsdX(e.target.value)}
                  placeholder="e.g. 0.50 (optional)"
                  className="ms-input font-mono text-xs"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>GSD Y (m/px)</span>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={gsdY}
                  onChange={(e) => setGsdY(e.target.value)}
                  placeholder="e.g. 0.50 (optional)"
                  className="ms-input font-mono text-xs"
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-400 bg-slate-900/70 border border-slate-800 rounded-lg p-2.5">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <span>
            No georeferencing is fabricated: images without a declared{' '}
            <code className="text-slate-300">lunar_local_m</code> affine transform remain in{' '}
            <code className="text-slate-300">image_px</code> coordinates with uncertain location.
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="text-xs text-red-200 bg-red-950/60 border border-red-500/40 rounded-lg p-3"
          >
            {errorMessage}
          </div>
        )}

        {successNotice && (
          <div
            role="status"
            className="text-xs text-emerald-200 bg-emerald-950/50 border border-emerald-500/40 rounded-lg p-3"
          >
            {successNotice}
          </div>
        )}

        <button
          type="submit"
          disabled={!imageFile || isUploading}
          className="ms-btn-primary w-full"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Uploading &amp; Inspecting Raster…</span>
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              <span>Upload Image to MoonSafe</span>
            </>
          )}
        </button>
      </form>
    </section>
  );
}
