# MoonSafe — LRO NAC Boulder Detection & Risk Screening Prototype

MoonSafe is a hackathon prototype that ingests LRO LROC NAC imagery, runs
configurable boulder detection (when trained YOLO weights are configured), maps
projected 2D boulder sizes and lunar-local or pixel coordinates, scores
boulder-hazard screening grids, and renders an authoritative 2D Leaflet map.

> **Important MVP & Scientific Honesty Notes**
> - **Screening-only output (`screening_only: true`)**: Default `lander` and
>   `rover` thresholds are illustrative, unvalidated parameters—not
>   mission-certified landing or traverse safety guidance.
> - **No fabricated model weights or detections**: Without trained YOLO weights
>   configured via `MOONSAFE_WEIGHTS_PATH`, detection endpoints report
>   `missing_model_weights` instead of generating synthetic boxes.
> - **2D authoritative map & non-Earth coordinates**: Imagery, detections, and
>   `RiskGrid` cells use `image_px` or `lunar_local_m` coordinates (`L.CRS.Simple`),
>   never Earth longitude/latitude. If reliable lunar georeferencing is
>   unavailable, coordinates remain in `image_px` and are marked uncertain.
> - **No invented 3D boulder heights**: Optional 3D terrain context requires real
>   DEM/DTM elevation data; otherwise only a clearly labeled flat schematic is
>   shown.

## Repository Structure

- `backend/moonsafe/ingest/` — local LRO NAC raster + manifest ingestion (`ImageMetadata`)
- `backend/moonsafe/geo/` — projected 2D size estimation and `image_px` / `lunar_local_m` coordinate mapping (`Detection`)
- `backend/moonsafe/risk/` — configurable boulder-risk grid scoring (`RiskGrid`)
- `backend/moonsafe/api/` — FastAPI routes, local file job store, and background job runner
- `ml/data/` — dataset preparation and YOLO label validation (`feature/03-dataset`)
- `ml/detector/` — PyTorch + Ultralytics YOLO sliced inference and training pipeline (`feature/04-detector`)
- `frontend/src/app/` — React workspace shell, upload/library panels, and API client
- `frontend/src/features/map/` — 2D Leaflet viewer, layer toggles, threshold controls, feature inspector, and optional 3D DEM context
- `infra/` & `docker-compose.yml` — containerized API + Nginx frontend deployment
- `docs/integration/` — local setup, path configuration, and branch merge guide

## Quick Start (Local Development)

### 1. Backend API

```bash
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r infra/requirements-backend.txt
# Optional ML inference/training dependencies:
# pip install -r infra/requirements-ml.txt

export PYTHONPATH=backend:.
export MOONSAFE_DATA_DIR=./.moonsafe_data
# Optional trained weights:
# export MOONSAFE_WEIGHTS_PATH=./models/boulder_best.pt

uvicorn moonsafe.api.app:app --reload --host 0.0.0.0 --port 8000
```

### 2. Frontend Web App

```bash
cd frontend
npm install
npm run dev
```

See [docs/integration/README.md](docs/integration/README.md) for Vite proxy /
API path notes, Docker Compose instructions, and
[docs/integration/branch-merge-guide.md](docs/integration/branch-merge-guide.md)
for merging all feature branches into `integration`.

## Quick Start (Docker Compose)

```bash
cp .env.example .env
docker compose up --build
```

- Web UI: `http://localhost:8080`
- Backend API & OpenAPI docs: `http://localhost:8000/docs`
