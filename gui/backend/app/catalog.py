"""Browse local historical data files (GUI data dir + repo test_data + NAUTILUS_PATH catalog)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
GUI_DATA_DIR = BACKEND_DIR / "data"
REPO_ROOT = BACKEND_DIR.parents[1]
TEST_DATA_DIR = REPO_ROOT / "test_data"


def _file_row(path: Path, root: Path, kind_hint: str) -> dict[str, Any]:
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    return {
        "path": str(path.relative_to(root)),
        "abs_path": str(path),
        "name": path.name,
        "ext": path.suffix.lower().lstrip("."),
        "size_bytes": size,
        "kind": kind_hint,
        "source": root.name,
    }


def list_catalog() -> dict[str, Any]:
    files: list[dict[str, Any]] = []

    if GUI_DATA_DIR.is_dir():
        for p in sorted(GUI_DATA_DIR.glob("*.csv")):
            files.append(_file_row(p, GUI_DATA_DIR, "gui_data"))

    if TEST_DATA_DIR.is_dir():
        for p in sorted(TEST_DATA_DIR.rglob("*")):
            if p.is_file() and p.suffix.lower() in {".csv", ".parquet", ".json", ".feather"}:
                files.append(_file_row(p, TEST_DATA_DIR, "test_data"))

    catalogs: list[dict[str, Any]] = []
    nautilus_path = os.environ.get("NAUTILUS_PATH")
    if nautilus_path:
        catalog = Path(nautilus_path) / "catalog"
        catalogs.append(
            {
                "name": "NAUTILUS_PATH catalog",
                "path": str(catalog),
                "exists": catalog.exists(),
            },
        )

    return {
        "gui_data_dir": str(GUI_DATA_DIR),
        "test_data_dir": str(TEST_DATA_DIR) if TEST_DATA_DIR.exists() else None,
        "files": files[:200],
        "catalogs": catalogs,
    }
