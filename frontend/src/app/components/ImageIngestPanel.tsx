import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FileImage, FileJson, ImagePlus, Info, Loader2, Upload } from 'lucide-react';
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
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
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

  useEffect(() => {
    if (!imageFile) {
      setPreviewObjectUrl(null);
      return;
    }
    const ext = imageFile.name.toLowerCase().split('.').pop() ?? '';
    if (!['png', 'jpg', 'jpeg'].includes(ext)) {
      setPreviewObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

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

  const isTiff = imageFile ? /\.tiff?$/i.test(imageFile.name) : false;

  return (
    <section className="ms-panel p-5 flex flex-col gap-4" aria-labelledby="ingest-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-sky-400">
            Step 1 · Imagery Ingest
          </div>
          <h2 id="ingest-heading" className="text-base font-semibold text-slate-50 mt-0.5">
            Upload LRO LROC NAC Image
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Supports PNG, JPEG, and 8/16-bit scientific TIFF rasters with optional scale metadata.
          </p>
        </div>
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
          className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all ${
            isDragging
              ? 'border-sky-400 bg-sky-950/35 scale-[1.01]'
              : imageFile
                ? 'border-sky-500/45 bg-[#0c121e]'
                : 'border-slate-700/80 bg-[#0b101a]/90 hover:border-slate-500'
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

          {previewObjectUrl ? (
            <div className="flex flex-col items-center gap-2.5">
              <img
                src={previewObjectUrl}
                alt="Selected NAC preview"
                className="max-h-36 rounded-lg border border-slate-700/80 object-contain bg-black shadow-md"
              />
              <div>
                <p className="text-sm font-medium text-slate-100">{imageFile?.name}</p>
                <p className="text-xs text-slate-400">
                  {imageFile ? `${(imageFile.size / (1024 * 1024)).toFixed(2)} MB` : ''} · Ready to upload
                </p>
              </div>
            </div>
          ) : isTiff && imageFile ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
                <FileImage className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-slate-100">{imageFile.name}</p>
              <p className="text-xs text-slate-400">
                {(imageFile.size / (1024 * 1024)).toFixed(2)} MB · Server renders contrast-stretched PNG preview on upload
              </p>
            </div>
          ) : (
            <>
              <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-500/10 border border-sky-400/25 flex items-center justify-center text-sky-400 mb-3">
                <ImagePlus className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-slate-100">
                Drop an LRO NAC raster here, or browse
              </p>
              <p className="text-xs text-slate-400 mt-1">
                PNG, JPEG, or TIFF (.tif / .tiff)
              </p>
            </>
          )}

          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="ms-btn-secondary text-xs"
            >
              {imageFile ? 'Change File' : 'Choose Image File'}
            </button>
            {imageFile && (
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  if (imageInputRef.current) imageInputRef.current.value = '';
                }}
                className="text-xs text-slate-400 hover:text-slate-200 px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Optional manifest file */}
        <div className="ms-panel-elevated p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <FileJson className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-slate-200">
                Optional Sidecar Manifest (.json)
              </p>
              <p className="text-[11px] text-slate-400">
                {manifestFile
                  ? `Attached: ${manifestFile.name}`
                  : 'Attach GSD (m/px), coverage, or affine image_to_lunar transform.'}
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
            className="inline-flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 font-medium cursor-pointer"
          >
            {showMetadataFields ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>
              {showMetadataFields
                ? 'Hide manual scale & coverage overrides'
                : 'Enter optional GSD / coverage manually'}
            </span>
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

        <div className="flex items-start gap-2 text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <span>
            Images without a declared <code className="text-slate-300">lunar_local_m</code> affine
            transform stay in <code className="text-slate-300">image_px</code> coordinates with
            lunar location marked uncertain.
          </span>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="text-xs text-red-200 bg-red-950/55 border border-red-500/40 rounded-xl p-3"
          >
            {errorMessage}
          </div>
        )}

        {successNotice && (
          <div
            role="status"
            className="text-xs text-emerald-200 bg-emerald-950/45 border border-emerald-500/40 rounded-xl p-3"
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
