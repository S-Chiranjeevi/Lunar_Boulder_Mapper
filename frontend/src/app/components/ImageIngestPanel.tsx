import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Eye,
  FileJson,
  ImagePlus,
  Info,
  Loader2,
  Upload,
} from 'lucide-react';
import { ApiError, uploadImage } from '../api/client';
import type {
  CoverageState,
  ImageMetadata,
  ImageUploadResponse,
} from '../types/contracts';

interface ImageIngestPanelProps {
  onUploaded: (response: ImageUploadResponse) => void;
  onLocalPreview: (metadata: ImageMetadata, previewUrl: string) => void;
  apiAvailable: boolean;
}

const ACCEPTED_IMAGE_TYPES = '.png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff';

const SAMPLE_MANIFEST = {
  image_id: 'nac_sample_001',
  source_image_id: 'M1234567890L',
  gsd_x_m_per_px: 0.5,
  gsd_y_m_per_px: 0.5,
  coverage: 'valid',
  coordinate_frame: 'image_px',
  image_to_lunar: null,
};

export function ImageIngestPanel({
  onUploaded,
  onLocalPreview,
  apiAvailable,
}: ImageIngestPanelProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const manifestInputRef = useRef<HTMLInputElement | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [localThumbUrl, setLocalThumbUrl] = useState<string | null>(null);
  const [localDims, setLocalDims] = useState<{ width: number; height: number } | null>(null);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [showSampleManifest, setShowSampleManifest] = useState(false);
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
      setLocalThumbUrl(null);
      setLocalDims(null);
      return;
    }

    const ext = imageFile.name.toLowerCase().split('.').pop() ?? '';
    if (!['png', 'jpg', 'jpeg'].includes(ext)) {
      setLocalThumbUrl(null);
      setLocalDims(null);
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setLocalThumbUrl(objectUrl);

    const probe = new Image();
    probe.onload = () => {
      setLocalDims({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.onerror = () => {
      setLocalDims(null);
    };
    probe.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
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

  function handleDownloadSampleManifest() {
    const blob = new Blob([JSON.stringify(SAMPLE_MANIFEST, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'example_manifest.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleInspectLocally() {
    if (!imageFile || !localThumbUrl || !localDims) {
      setErrorMessage(
        'Local browser preview works for PNG and JPEG images. TIFF rasters require a connected backend.',
      );
      return;
    }

    let manifestObj: Record<string, unknown> = {};
    if (manifestFile) {
      try {
        manifestObj = JSON.parse(await manifestFile.text()) as Record<string, unknown>;
      } catch {
        setErrorMessage(`Could not parse JSON manifest "${manifestFile.name}".`);
        return;
      }
    }

    const stem = imageFile.name.replace(/\.[^.]+$/, '') || 'local_nac';
    const parsedGsdX = gsdX.trim()
      ? Number(gsdX)
      : typeof manifestObj.gsd_x_m_per_px === 'number'
        ? manifestObj.gsd_x_m_per_px
        : null;
    const parsedGsdY = gsdY.trim()
      ? Number(gsdY)
      : typeof manifestObj.gsd_y_m_per_px === 'number'
        ? manifestObj.gsd_y_m_per_px
        : null;

    const frame =
      manifestObj.coordinate_frame === 'lunar_local_m' && manifestObj.image_to_lunar
        ? 'lunar_local_m'
        : 'image_px';

    const cov =
      coverage ||
      (manifestObj.coverage === 'valid' ||
      manifestObj.coverage === 'partial' ||
      manifestObj.coverage === 'missing'
        ? manifestObj.coverage
        : 'missing');

    const persistentUrl = URL.createObjectURL(imageFile);
    const localMeta: ImageMetadata = {
      image_id:
        typeof manifestObj.image_id === 'string' && manifestObj.image_id.trim()
          ? manifestObj.image_id
          : `${stem}_local`,
      source_image_id:
        sourceImageId.trim() ||
        (typeof manifestObj.source_image_id === 'string' && manifestObj.source_image_id.trim()
          ? manifestObj.source_image_id
          : stem),
      width_px: localDims.width,
      height_px: localDims.height,
      gsd_x_m_per_px: parsedGsdX,
      gsd_y_m_per_px: parsedGsdY,
      coverage: cov,
      coordinate_frame: frame,
      image_to_lunar:
        frame === 'lunar_local_m'
          ? (manifestObj.image_to_lunar as Record<string, unknown>)
          : null,
    };

    onLocalPreview(localMeta, persistentUrl);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!imageFile) {
      setErrorMessage('Select an LRO LROC NAC image file before uploading.');
      return;
    }

    if (gsdX.trim() && (Number.isNaN(Number(gsdX)) || Number(gsdX) <= 0)) {
      setErrorMessage('GSD X must be a positive number in metres/pixel.');
      return;
    }
    if (gsdY.trim() && (Number.isNaN(Number(gsdY)) || Number(gsdY) <= 0)) {
      setErrorMessage('GSD Y must be a positive number in metres/pixel.');
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
        setErrorMessage(
          err.status === 404 || err.status === 0
            ? 'Backend API is not connected here. Use "Preview Locally in 2D Map" for PNG/JPEG files, or connect your FastAPI server in the header.'
            : err.message,
        );
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
            Drop a lunar orbiter image (PNG, JPEG, or TIFF) with optional scale &amp; transform metadata.
          </p>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
          Raster Input
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

          {localThumbUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img
                src={localThumbUrl}
                alt="Selected NAC raster thumbnail"
                className="max-h-32 w-auto rounded-lg border border-slate-700 bg-black object-contain"
              />
              <p className="text-sm font-medium text-slate-100">{imageFile?.name}</p>
              <p className="text-xs text-slate-400 font-mono">
                {localDims ? `${localDims.width} × ${localDims.height} px · ` : ''}
                {imageFile ? `${(imageFile.size / (1024 * 1024)).toFixed(2)} MB` : ''}
              </p>
            </div>
          ) : (
            <>
              <ImagePlus className="w-8 h-8 mx-auto text-sky-400/90 mb-2" />
              <p className="text-sm font-medium text-slate-200">
                {imageFile ? imageFile.name : 'Drop an LRO NAC raster here or browse'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {imageFile
                  ? `${(imageFile.size / (1024 * 1024)).toFixed(2)} MB selected`
                  : 'Supports PNG, JPEG, and 8/16-bit TIFF images.'}
              </p>
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="ms-btn-secondary text-xs"
            >
              {imageFile ? 'Replace File' : 'Choose Image File'}
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
        <div className="ms-panel-elevated p-3.5 flex flex-col gap-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <FileJson className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-slate-200">
                  Optional Sidecar Manifest (.json)
                </p>
                <p className="text-[11px] text-slate-400">
                  {manifestFile
                    ? `Attached: ${manifestFile.name}`
                    : 'Provides ground resolution (m/px), coverage status, or lunar transform.'}
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

          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <button
              type="button"
              onClick={() => setShowSampleManifest((prev) => !prev)}
              className="text-sky-300 hover:text-sky-200 cursor-pointer"
            >
              {showSampleManifest ? 'Hide sample JSON schema' : 'View sample JSON schema'}
            </button>
            <button
              type="button"
              onClick={handleDownloadSampleManifest}
              className="inline-flex items-center gap-1 text-slate-300 hover:text-slate-100 cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>Download example_manifest.json</span>
            </button>
          </div>

          {showSampleManifest && (
            <pre className="text-[11px] font-mono bg-[#0b0e14] border border-slate-800 rounded-lg p-2.5 text-slate-300 overflow-x-auto">
              {JSON.stringify(SAMPLE_MANIFEST, null, 2)}
            </pre>
          )}
        </div>

        {/* Optional inline metadata overrides */}
        <div>
          <button
            type="button"
            onClick={() => setShowMetadataFields((prev) => !prev)}
            className="text-xs text-sky-300 hover:text-sky-200 font-medium cursor-pointer"
          >
            {showMetadataFields
              ? '− Hide manual resolution & coverage overrides'
              : '+ Enter pixel resolution (m/px) or coverage manually'}
          </button>

          {showMetadataFields && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 ms-panel-elevated p-3.5">
              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>NAC Product ID</span>
                <input
                  type="text"
                  value={sourceImageId}
                  onChange={(e) => setSourceImageId(e.target.value)}
                  placeholder="e.g. M1234567890L"
                  className="ms-input font-mono text-xs"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>Coverage Quality</span>
                <select
                  value={coverage}
                  onChange={(e) => setCoverage(e.target.value as CoverageState | '')}
                  className="ms-input text-xs"
                >
                  <option value="">From manifest (or missing)</option>
                  <option value="valid">valid — complete scene</option>
                  <option value="partial">partial — partial coverage</option>
                  <option value="missing">missing — unverified</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>Resolution X (m/px)</span>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={gsdX}
                  onChange={(e) => setGsdX(e.target.value)}
                  placeholder="e.g. 0.50 (LRO NAC)"
                  className="ms-input font-mono text-xs"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-300">
                <span>Resolution Y (m/px)</span>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={gsdY}
                  onChange={(e) => setGsdY(e.target.value)}
                  placeholder="e.g. 0.50 (LRO NAC)"
                  className="ms-input font-mono text-xs"
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 text-[11px] text-slate-400 bg-slate-900/70 border border-slate-800 rounded-lg p-2.5">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <span>
            Images without a declared lunar transform stay in pixel coordinates (
            <code className="text-slate-300">image_px</code>) and are never mislabeled as Earth
            longitude/latitude.
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

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="submit"
            disabled={!imageFile || isUploading}
            className="ms-btn-primary flex-1"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Uploading &amp; Inspecting…</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>{imageFile ? 'Upload Image to MoonSafe' : 'Select an Image First'}</span>
              </>
            )}
          </button>

          {localThumbUrl && localDims && (
            <button
              type="button"
              onClick={() => void handleInspectLocally()}
              className="ms-btn-secondary text-xs shrink-0"
              title="Open selected image in the 2D Leaflet viewer without requiring a backend upload"
            >
              <Eye className="w-4 h-4 text-sky-400" />
              <span>{apiAvailable ? 'Local Preview' : 'Preview in 2D Map'}</span>
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
