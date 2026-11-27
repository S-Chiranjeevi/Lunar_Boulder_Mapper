# Feature Branch Merge Guide (`integration`)

Merge feature branches into `integration` in dependency order to minimize
conflicts and verify contracts at each step.

## Branch Inventory & Ownership

| Order | Branch | Owned Paths | Role |
| --- | --- | --- | --- |
| 1 | `feature/01-web-shell` | `frontend/package.json`, `frontend/src/app/`, `frontend/src/styles/` | React shell, contracts, upload/library/status panels |
| 2 | `feature/02-image-ingest` | `backend/moonsafe/ingest/` | Local raster + sidecar manifest ingestion (`ImageMetadata`) |
| 3 | `feature/03-dataset` | `ml/data/` | Dataset preparation, Label Studio import, YOLO split validation |
| 4 | `feature/04-detector` | `ml/detector/` | YOLO training/inference + large-image tile slicing & merging |
| 5 | `feature/05-geospatial` | `backend/moonsafe/geo/` | Projected 2D size & `image_px` / `lunar_local_m` mapping (`Detection`) |
| 6 | `feature/06-risk` | `backend/moonsafe/risk/` | Configurable `lander`/`rover`/`custom` `RiskGrid` scorer |
| 7 | `feature/07-api` | `backend/moonsafe/api/` | FastAPI routes, local store, background job runner |
| 8 | `feature/08-viewer-deploy` | `frontend/src/features/map/`, `infra/`, `docs/integration/`, `README.md`, root deploy configs | 2D Leaflet + optional 3D DEM viewer, Dockerfiles, Compose, integration docs |

## Recommended Merge Steps

```bash
git checkout integration
git pull origin integration

# 1. Core data contracts & backend pipeline
git merge --no-ff feature/02-image-ingest
git merge --no-ff feature/05-geospatial
git merge --no-ff feature/06-risk
git merge --no-ff feature/07-api

# 2. ML pipeline
git merge --no-ff feature/03-dataset
git merge --no-ff feature/04-detector

# 3. Frontend shell, map viewer & deployment
git merge --no-ff feature/01-web-shell
git merge --no-ff feature/08-viewer-deploy
```

## Post-Merge Integration Checklist

1. Wire `AnalysisMapViewer` (`frontend/src/features/map/`) inside `AnalysisView.tsx` (`frontend/src/app/components/`).
2. Add `/api/v1` proxy rewrite (or mount `/api/v1` alongside `/api`) for local `vite dev`.
3. Wire `ml.detector.detect_boulders` into `backend/moonsafe/api/adapters.py`.
4. Run all Python unit tests (`geo`, `risk`, `api`, `ml/data`, `ml/detector`) and `npm run build` in `frontend/`.
