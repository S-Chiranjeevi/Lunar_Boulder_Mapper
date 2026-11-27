"""Replaceable local storage boundary for uploaded imagery and background jobs."""

from __future__ import annotations

import json
import threading
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Protocol

from .errors import ImageConflictError, ImageNotFoundError, JobNotFoundError


def utc_now_iso() -> str:
    """Return an ISO-8601 UTC timestamp string."""
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class StoredImage:
    """Persisted image record returned by a StorageBackend."""

    image_id: str
    filename: str
    image_path: Path
    manifest_path: Path | None
    metadata: dict[str, Any]
    created_at: str


class StorageBackend(Protocol):
    """Abstract persistence interface so local storage can be swapped later."""

    def save_image(
        self,
        image_id: str,
        filename: str,
        image_bytes: bytes,
        metadata: Mapping[str, Any],
        *,
        manifest_bytes: bytes | None = None,
        overwrite: bool = False,
    ) -> StoredImage: ...

    def get_image(self, image_id: str) -> StoredImage: ...

    def list_images(self) -> list[StoredImage]: ...

    def create_job(self, job_record: Mapping[str, Any]) -> dict[str, Any]: ...

    def get_job(self, job_id: str) -> dict[str, Any]: ...

    def update_job(self, job_id: str, **updates: Any) -> dict[str, Any]: ...

    def list_jobs(self) -> list[dict[str, Any]]: ...


class LocalFileJobStore:
    """Thread-safe local filesystem store suitable for hackathon demos."""

    def __init__(self, root_dir: str | Path) -> None:
        self.root_dir = Path(root_dir)
        self._images_dir = self.root_dir / "images"
        self._jobs_dir = self.root_dir / "jobs"
        self._lock = threading.RLock()

    @staticmethod
    def _safe_id(value: str) -> str:
        cleaned = "".join(ch if (ch.isalnum() or ch in "-_.") else "_" for ch in value.strip())
        if not cleaned or cleaned in {".", ".."}:
            raise ValueError(f"Unsafe identifier: {value!r}")
        return cleaned

    def _image_dir(self, image_id: str) -> Path:
        return self._images_dir / self._safe_id(image_id)

    def _job_file(self, job_id: str) -> Path:
        return self._jobs_dir / f"{self._safe_id(job_id)}.json"

    def save_image(
        self,
        image_id: str,
        filename: str,
        image_bytes: bytes,
        metadata: Mapping[str, Any],
        *,
        manifest_bytes: bytes | None = None,
        overwrite: bool = False,
    ) -> StoredImage:
        with self._lock:
            img_dir = self._image_dir(image_id)
            meta_path = img_dir / "metadata.json"
            if meta_path.exists() and not overwrite:
                raise ImageConflictError(image_id)

            img_dir.mkdir(parents=True, exist_ok=True)
            ext = Path(filename).suffix or ".bin"
            image_path = img_dir / f"source{ext}"
            image_path.write_bytes(image_bytes)

            manifest_path: Path | None = None
            if manifest_bytes is not None:
                manifest_path = img_dir / "manifest.json"
                manifest_path.write_bytes(manifest_bytes)

            created_at = utc_now_iso()
            record = {
                "image_id": image_id,
                "filename": filename,
                "image_file": image_path.name,
                "manifest_file": manifest_path.name if manifest_path is not None else None,
                "metadata": dict(metadata),
                "created_at": created_at,
            }
            meta_path.write_text(json.dumps(record, indent=2), encoding="utf-8")
            return StoredImage(
                image_id=image_id,
                filename=filename,
                image_path=image_path,
                manifest_path=manifest_path,
                metadata=dict(metadata),
                created_at=created_at,
            )

    def _read_stored_image(self, img_dir: Path) -> StoredImage:
        meta_path = img_dir / "metadata.json"
        if not meta_path.is_file():
            raise ImageNotFoundError(img_dir.name)
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        manifest_file = raw.get("manifest_file")
        return StoredImage(
            image_id=raw["image_id"],
            filename=raw["filename"],
            image_path=img_dir / raw["image_file"],
            manifest_path=(img_dir / manifest_file) if manifest_file else None,
            metadata=raw["metadata"],
            created_at=raw["created_at"],
        )

    def get_image(self, image_id: str) -> StoredImage:
        with self._lock:
            img_dir = self._image_dir(image_id)
            if not (img_dir / "metadata.json").is_file():
                raise ImageNotFoundError(image_id)
            return self._read_stored_image(img_dir)

    def list_images(self) -> list[StoredImage]:
        with self._lock:
            if not self._images_dir.is_dir():
                return []
            items = [
                self._read_stored_image(path)
                for path in sorted(self._images_dir.iterdir())
                if path.is_dir() and (path / "metadata.json").is_file()
            ]
            return sorted(items, key=lambda item: item.created_at, reverse=True)

    def create_job(self, job_record: Mapping[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._jobs_dir.mkdir(parents=True, exist_ok=True)
            job_id = str(job_record["job_id"])
            record = deepcopy(dict(job_record))
            self._job_file(job_id).write_text(json.dumps(record, indent=2), encoding="utf-8")
            return deepcopy(record)

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            path = self._job_file(job_id)
            if not path.is_file():
                raise JobNotFoundError(job_id)
            return json.loads(path.read_text(encoding="utf-8"))

    def update_job(self, job_id: str, **updates: Any) -> dict[str, Any]:
        with self._lock:
            record = self.get_job(job_id)
            record.update(deepcopy(updates))
            self._job_file(job_id).write_text(json.dumps(record, indent=2), encoding="utf-8")
            return deepcopy(record)

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            if not self._jobs_dir.is_dir():
                return []
            jobs = [
                json.loads(path.read_text(encoding="utf-8"))
                for path in sorted(self._jobs_dir.glob("*.json"))
            ]
            return sorted(jobs, key=lambda item: item.get("created_at", ""), reverse=True)
