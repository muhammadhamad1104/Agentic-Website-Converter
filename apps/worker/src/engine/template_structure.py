from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

from src.config.settings import settings


def _candidate_template_paths() -> list[Path]:
    candidates: list[Path] = []

    if settings.TEMPLATE_GENERATOR_PATH.strip():
        candidates.append(Path(settings.TEMPLATE_GENERATOR_PATH).expanduser())

    # User-provided external location.
    candidates.append(Path(r"d:\ALL SEMESTER\SEMESTER07\WAF\Website_name\generate_same_project.py"))

    # Default to repository root.
    candidates.append(Path(__file__).resolve().parents[2] / "generate_same_project.py")

    deduped: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path.resolve()) if path.exists() else str(path)
        if key not in seen:
            seen.add(key)
            deduped.append(path)
    return deduped


def _resolve_template_path() -> Path:
    for candidate in _candidate_template_paths():
        if candidate.exists():
            return candidate
    joined = " | ".join(str(path) for path in _candidate_template_paths())
    raise FileNotFoundError(f"Template generator not found. Checked: {joined}")


def _load_template_module() -> tuple[ModuleType, Path]:
    script_path = _resolve_template_path()

    spec = importlib.util.spec_from_file_location("template_snapshot_generator", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load template generator module spec.")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, script_path


def materialize_template_structure(job_id: str, output_root: str) -> dict[str, Any]:
    module, script_path = _load_template_module()
    job_suffix = (job_id or "job")[:8]
    template_name = f"website_template_{job_suffix}"
    output_path = (Path(output_root) / template_name).resolve()

    build_project = getattr(module, "build_project", None)
    if not callable(build_project):
        raise RuntimeError("Template module does not expose build_project(output_path, force).")

    dir_count, file_count = build_project(output_path=output_path, force=True)
    return {
        "name": template_name,
        "path": str(output_path),
        "dir_count": dir_count,
        "file_count": file_count,
        "source": str(script_path),
    }
