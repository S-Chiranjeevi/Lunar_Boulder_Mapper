# Vercel deployment

The repository-level `vercel.json` builds the Vite app from `frontend/` and
publishes `frontend/dist`. A matching `frontend/vercel.json` supports Vercel
projects whose Root Directory is set to `frontend/`. The page shell can be
deployed as a static site.

MoonSafe's API is a separate FastAPI service; Vercel does not run it from this
static build. Set the Vercel environment variable `VITE_API_BASE_URL` to the
public HTTPS origin of the deployed API (no trailing slash), then redeploy. The
API service must allow the deployed Vercel origin in `MOONSAFE_CORS_ORIGINS`.
Without this configuration, the frontend deliberately reports that the API is
unavailable; it does not display fabricated images, detections, or risk data.

The API currently stores images and jobs on local disk. A production API host
must provide persistent storage or uploads/jobs will not survive instance
restarts.
