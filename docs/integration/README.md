# Integration & Deployment Guide

This guide describes how to run the full MoonSafe stack locally, configure data
and model weight paths, and wire the frontend shell to the map viewer and API.

## 1. Environment & Path Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOONSAFE_DATA_DIR` | System temp dir (`./.moonsafe_data` in Compose) | Local directory for uploaded NAC imagery, sidecar manifests, and job JSON records |
| `MOONSAFE_WEIGHTS_PATH` | Unset (`null`) | Filesystem path to trained Ultralytics YOLO `.pt` boulder weights |
| `PYTHONPATH` | `backend:.` | Resolves `moonsafe.*` (`backend/`) and `ml.*` (repo root) |
| `API_PORT` | `8000` | Host port mapped to the FastAPI container |
| `WEB_PORT` | `8080` | Host port mapped to the Nginx frontend container |

> When `MOONSAFE_WEIGHTS_PATH` is unset or missing, `POST /api/jobs` reports
> `missing_model_weights` (`503`) rather than inventing synthetic detections.

## 2. Running Locally Without Docker

### Backend (FastAPI)

```powershell
$env:PYTHONPATH = "backend;."
$env:MOONSAFE_DATA_DIR = ".\.moonsafe_data"
# Optional once trained weights exist:
# $env:MOONSAFE_WEIGHTS_PATH = ".\models\boulder_best.pt"

pip install -r infra/requirements-backend.txt
uvicorn moonsafe.api.app:app --reload --host 127.0.0.1 --port 8000
```

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

## 3. Running With Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

`infra/nginx.conf` serves the built Vite SPA on port `80` (`WEB_PORT=8080`) and
proxies both `/api/*` and `/api/v1/*` requests to `http://backend:8000/api/*`.

## 4. Known Integration Wiring Notes

1. **API Route Prefix Alignment (`/api/v1/*` vs `/api/*`):**
   - `frontend/src/app/api/client.ts` currently requests `/api/v1/images` and
     `/api/v1/jobs`.
   - `backend/moonsafe/api/app.py` serves `/api/images` and `/api/jobs`.
   - `infra/nginx.conf` bridges this automatically via `rewrite ^/api/v1/(.*)$ /api/$1 break;`
     for Docker deployments; during direct `integration` merge, align either
     the Vite dev proxy or `app.py` router prefix.
2. **Mounting `AnalysisMapViewer` in `AnalysisView.tsx`:**
   - `frontend/src/features/map/AnalysisMapViewer.tsx` is designed to drop
     directly into the `data-testid="map-feature-slot"` container in
     `frontend/src/app/components/AnalysisView.tsx` once `feature/01-web-shell`
     and `feature/08-viewer-deploy` are merged into `integration`.
3. **Connecting `ml.detector` to `backend/moonsafe/api/adapters.py`:**
   - `DefaultDetectorAdapter` looks for `moonsafe.detect` / `moonsafe.detector`
     with `detect_boulders`; once `ml/detector` is wired on `integration`, pass
     `detect_boulders` (from `ml.detector`) or `weights_path` into `create_app`.
4. **Frontend Vite Build Config:**
   - `frontend/package.json` expects a `tsconfig.json`, `vite.config.ts`, and
     `index.html` from the shell/integration branch before running `vite build`.
