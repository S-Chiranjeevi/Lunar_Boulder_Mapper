FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend:/app \
    MOONSAFE_DATA_DIR=/data

WORKDIR /app

COPY infra/requirements-backend.txt /tmp/requirements-backend.txt
RUN pip install --no-cache-dir -r /tmp/requirements-backend.txt

COPY backend /app/backend
COPY ml /app/ml

RUN mkdir -p /data /models

EXPOSE 8000

CMD ["uvicorn", "moonsafe.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
