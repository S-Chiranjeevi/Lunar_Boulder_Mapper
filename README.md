# MoonSafe

MoonSafe is a screening-only prototype for boulder detection and boulder-risk
screening in LRO LROC NAC imagery. Its 2D viewer uses Leaflet with a simple
image-pixel coordinate frame unless the source supplies a supported `lunar_local_m`
affine transform. It does not convert lunar coordinates to Earth
longitude/latitude or claim standard GeoJSON compatibility without a valid
transform.

## Current prototype behavior

- Upload local PNG, JPEG, or TIFF imagery (`POST /api/v1/images`) or select a
  previously uploaded image (`GET /api/v1/images`).
- Optionally attach the JSON sidecar format described in
  [`backend/moonsafe/ingest/README.md`](backend/moonsafe/ingest/README.md) or
  provide verified GSD and coverage metadata fields.
- Detection jobs (`POST /api/v1/jobs`) use Ultralytics YOLO only when
  `MOONSAFE_YOLO_WEIGHTS` points to a trained `.pt` weights file. Without it,
  the job completes honestly with `model_status: "unconfigured"`, produces zero
  detections, and marks all `RiskGrid` cells `uncertain` (`MODEL_UNCONFIGURED`).
- Risk thresholds are illustrative and unvalidated. Updating them via
  `PATCH /api/v1/jobs/{job_id}/thresholds` recalculates the `RiskGrid` from the
  completed job's stored detections without rerunning the detector.
- Unknown scale (`gsd_x_m_per_px` / `gsd_y_m_per_px`) or missing/partial
  coverage produces `uncertain` risk cells. The product is a screening aid and
  does not guarantee safe landing or travel.
- 3D terrain (React Three Fiber / Drei) is disabled until real lunar terrain
  elevation data is available (`has_elevation_data: false`). Physical boulder
  height is never invented.

## Run locally

### Backend (from `backend/`)

```bash
python -m pip install -r requirements.txt
uvicorn moonsafe.api.app:app --reload
```

Set `MOONSAFE_YOLO_WEIGHTS` to a trained Ultralytics `.pt` weights file before
running detection. Uploaded rasters and job state are stored under `backend/data`
by default; override this with `MOONSAFE_DATA_DIR`.

Run backend tests:

```bash
python -m unittest discover -s tests -v
```

### Frontend (from `frontend/`)

```bash
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8000`. Run frontend
tests and production build checks with:

```bash
npm test
npm run build
```

No trained model, sample NAC imagery, measured model accuracy, or validated risk
thresholds are included.

