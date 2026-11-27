# MoonSafe FastAPI Web API

`moonsafe.api` exposes the HTTP routes connecting the web frontend to local
image ingestion (`moonsafe.ingest`), 2D size/coordinate mapping (`moonsafe.geo`),
and pluggable detector and risk-grid modules.

## Routes

- `GET /health` — service health check (`screening_only: true`).
- Both `/api/...` and `/api/v1/...` route prefixes are served. `/api/v1` is
  the frontend contract; `/api` remains available for existing clients and
  the Docker Nginx proxy.
- `POST /api/images` — multipart upload (`file`, optional `manifest` JSON file or
  `metadata_json` form field, optional `overwrite`). Returns `ImageMetadata`
  with explicit units and preview URL.
- `GET /api/images` — list uploaded images and their `ImageMetadata`.
- `GET /api/images/{image_id}` — fetch one image's `ImageMetadata`.
- `GET /api/images/{image_id}/preview?max_dim=1024` — render a browser-ready
  PNG preview (including 16-bit/float TIFF normalization).
- `POST /api/jobs` — enqueue a background detection + geospatial + risk-grid
  job (`202 Accepted`) outside the request-response path.
- `GET /api/jobs` — list jobs with status summaries.
- `GET /api/jobs/{job_id}` — poll job status (`queued | running | completed | failed`).
- `GET /api/jobs/{job_id}/results` — fetch completed `image_metadata`,
  `detections`, `risk_grid`, `threshold_config`, `georeferencing_summary`, and
  explicit `units` / `coordinate_frame`.
- `PATCH /api/jobs/{job_id}/thresholds` — recalculate `risk_grid` from stored
  detections without rerunning YOLO detection.

## Design Notes

- **Replaceable storage**: Routes and `JobRunner` depend only on the
  `StorageBackend` protocol; `LocalFileJobStore` persists JSON/image files under
  `MOONSAFE_DATA_DIR` (or the system temp directory by default).
- **CORS**: Set `MOONSAFE_CORS_ORIGINS` to a comma-separated list of exact
  browser origins (for example `https://your-site.vercel.app`). If unset, the
  app allows any origin for local development. Do not include URL paths.
- **Illustrative thresholds**: Default `lander` and `rover` threshold presets
  are explicitly marked `validated: false` and `illustrative_default: true`.
- **Honest error handling**: Clear structured JSON errors are returned for
  `unsupported_imagery` (`422`), `missing_model_weights` (`503`),
  `unavailable_georeferencing` (`422` when `require_georeferencing=true`), and
  `risk_module_unavailable` (`503`).
