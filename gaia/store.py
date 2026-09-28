"""The latest snapshot of every feed, as files under the data folder.

Each write lands in a temporary file first and is renamed into place, so a
reader never sees half a file, and a failed fetch leaves the last good
snapshot where it was.
"""

import json
import os
import time
from pathlib import Path
from typing import Any


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, tuple[float, Any]] = {}

    def path(self, name: str) -> Path:
        return self.root / name

    def write_bytes(self, name: str, data: bytes) -> None:
        target = self.path(name)
        tmp = target.with_name(f".{target.name}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)

    def write_json(self, name: str, obj: Any) -> None:
        self.write_bytes(name, json.dumps(obj, separators=(",", ":")).encode())

    def read_json(self, name: str, default: Any = None) -> Any:
        """Read a snapshot, re-parsing only when the file has changed."""
        path = self.path(name)
        try:
            mtime = path.stat().st_mtime
        except FileNotFoundError:
            return default
        cached = self._cache.get(name)
        if cached and cached[0] == mtime:
            return cached[1]
        obj = json.loads(path.read_bytes())
        self._cache[name] = (mtime, obj)
        return obj

    def age(self, name: str) -> float | None:
        """Seconds since the snapshot was written, or None if there is none."""
        try:
            return time.time() - self.path(name).stat().st_mtime
        except FileNotFoundError:
            return None
