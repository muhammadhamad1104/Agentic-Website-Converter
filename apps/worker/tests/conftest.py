from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.config.settings import settings


@pytest.fixture(autouse=True, scope="session")
def _redirect_generated_output_for_tests(tmp_path_factory: pytest.TempPathFactory):
    original = settings.GENERATED_OUTPUT_PATH
    temp_output = tmp_path_factory.mktemp("generated_artifacts")
    settings.GENERATED_OUTPUT_PATH = str(temp_output)
    try:
        yield
    finally:
        settings.GENERATED_OUTPUT_PATH = original
