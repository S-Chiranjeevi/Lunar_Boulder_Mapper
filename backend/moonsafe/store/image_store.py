"""Thread-safe in-memory store for uploaded image files and their metadata."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from ..schemas import ImageMetadata


@dataclass
class StoredImage:
    image_id: str
    filename: str
    path: Path
    metadata: ImageMetadata


class ImageStore:
    """Singleton in-memory image registry.

    In production this would back onto object storage; for the prototype all
    data lives in memory / a temp directory and is not persisted across
    restarts.
    """

    _instance: Optional["ImageStore"] = None
    _lock: threading.Lock = threading.Lock()

    def __init__(self) -> None:
        self._images: Dict[str, StoredImage] = {}
        self._mu = threading.Lock()

    @classmethod
    def get(cls) -> "ImageStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def put(self, stored: StoredImage) -> None:
        with self._mu:
            self._images[stored.image_id] = stored

    def get_image(self, image_id: str) -> Optional[StoredImage]:
        with self._mu:
            return self._images.get(image_id)

    def list_all(self) -> List[StoredImage]:
        with self._mu:
            return list(self._images.values())

    def exists(self, image_id: str) -> bool:
        with self._mu:
            return image_id in self._images
