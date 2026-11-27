"""GET /api/v1/health — liveness and readiness."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get("/health")
def health():
    """Return service status and capability flags."""
    model_available = False
    try:
        import os
        from pathlib import Path
        path = os.environ.get("MOONSAFE_MODEL_PATH", "")
        if path and Path(path).is_file():
            import ultralytics  # noqa: F401
            model_available = True
    except ImportError:
        pass

    return {
        "status": "ok",
        "model_available": model_available,
        "stub_mode": not model_available,
        "note": (
            "stub_mode=true means no YOLO weights are loaded; "
            "detection returns zero results. "
            "Set MOONSAFE_MODEL_PATH to a valid YOLOv8 .pt file to enable inference."
        ),
    }
