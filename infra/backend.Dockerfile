FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend:/app \
    MOONSAFE_DATA_DIR=/data \
    MOONSAFE_WEIGHTS_PATH=/models/moonsafe-yolov8n-lunar-10pct-5ep.pt

WORKDIR /app

COPY infra/requirements-backend.txt /tmp/requirements-backend.txt
COPY infra/requirements-inference.txt /tmp/requirements-inference.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r /tmp/requirements-backend.txt \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements-inference.txt \
    && pip install --no-cache-dir ultralytics==8.4.220

COPY backend /app/backend
COPY ml /app/ml
COPY models/moonsafe-yolov8n-lunar-10pct-5ep.pt /models/moonsafe-yolov8n-lunar-10pct-5ep.pt

RUN mkdir -p /data /models

EXPOSE 8000

CMD ["uvicorn", "moonsafe.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
