# MoonSafe — Lunar Boulder Risk Screening

> **Screening aid only.** Results are illustrative and unvalidated. Do not use
> as a safety guarantee for mission planning.

MoonSafe lets you upload LRO LROC NAC imagery, run automated boulder detection,
inspect estimated boulder sizes and locations, and view a colour-coded risk
screening map — all in a browser.

---

## Architecture

```
frontend/           React + Vite + TypeScript + Tailwind + Leaflet
backend/
  main.py           FastAPI application entry point
  moonsafe/
    api/            REST routes (images, jobs, health)
    detection/      OpenCV preprocessing + YOLOv8 inference
    risk/           Risk grid construction and cell classification
    store/          In-memory image and job stores
    schemas.py      Pydantic models (canonical data shapes)
    pipeline.py     End-to-end job execution
    ingest/         [existing] LRO image ingestion
    geo/            [existing] Geo-enrichment and size estimation
```

---

## Quick start (local dev)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173

The Vite dev server proxies `/api/*` to the FastAPI backend automatically.

### Docker Compose

```bash
cp .env.example .env          # fill in MOONSAFE_MODEL_PATH if you have weights
docker compose up --build
```

Frontend: http://localhost:5173  
Backend:  http://localhost:8000

---

## Model status

The backend ships in **stub mode** when no YOLOv8 weight file is configured.
In stub mode:

- All API routes work normally.
- Detection returns zero boulders.
- The risk grid shows all cells as `safe` (no detections).

To enable real inference, set `MOONSAFE_MODEL_PATH` to a YOLOv8 `.pt` file
trained on lunar imagery and install `ultralytics`:

```bash
pip install ultralytics torch
export MOONSAFE_MODEL_PATH=/path/to/weights.pt
```

The header badge and `GET /api/v1/health` both show whether the model is loaded.

---

## API reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET`  | `/api/v1/health` | Liveness check; reports stub_mode |
| `POST` | `/api/v1/images` | Upload an image; returns image_id |
| `GET`  | `/api/v1/images` | List uploaded images |
| `GET`  | `/api/v1/images/{id}/preview` | Displayable JPEG preview |
| `POST` | `/api/v1/jobs` | Start a detection job |
| `GET`  | `/api/v1/jobs/{job_id}` | Job status |
| `GET`  | `/api/v1/jobs/{job_id}/results` | Detections + RiskGrid |
| `PATCH`| `/api/v1/jobs/{job_id}/thresholds` | Recalculate risk (no re-detection) |

---

## Data shapes

All shapes match the project specification exactly:

- **ImageMetadata** — image dimensions, GSD, coverage, coordinate frame
- **Detection** — bbox\_px, confidence, model\_version, estimated\_size\_m, position
- **RiskGrid** — cells classified as safe / caution / unsafe / uncertain

Coordinates remain in `image_px` unless a valid lunar affine transform is
provided in a sidecar manifest (see `backend/moonsafe/ingest/README.md`).

---

## Threshold profiles (illustrative defaults)

| Profile | Safe max | Caution max |
|---------|----------|-------------|
| lander  | 0.3 m    | 1.0 m       |
| rover   | 0.15 m   | 0.4 m       |
| custom  | user-set | user-set    |

These values are **illustrative** defaults not validated against any mission
requirement. Adjust via the Thresholds panel or `PATCH /thresholds`.

---

## Branch layout

| Branch | Contents |
|--------|----------|
| `feat/lro-nac-ingestion` | LRO image ingestion module |
| `feature/05-geospatial`  | Geo-enrichment and size estimation |
| `feat/moonsafe-webapp`   | **This branch** — full web application |

---

## Disclaimer

Estimated boulder sizes are **2D projected measurements** derived from bounding-box
extents and GSD. True 3D boulder height is never inferred from 2D imagery.
Position accuracy depends on the availability of a validated lunar affine
transform — without one, coordinates are reported in image pixels and marked
uncertain. All risk classifications are illustrative and unvalidated.
