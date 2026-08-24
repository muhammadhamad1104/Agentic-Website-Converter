from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.config.settings import Settings


def test_settings_reject_invalid_quality_profile() -> None:
    with pytest.raises(ValidationError, match="QUALITY_PROFILE"):
        Settings(_env_file=None, QUALITY_PROFILE="qa")


def test_settings_reject_invalid_quality_ratio() -> None:
    with pytest.raises(ValidationError, match="QUALITY_SCHEMA_MAX_GENERIC_ENTITY_RATIO"):
        Settings(_env_file=None, QUALITY_SCHEMA_MAX_GENERIC_ENTITY_RATIO=1.2)


def test_settings_reject_invalid_runtime_crawl_timeout() -> None:
    with pytest.raises(ValidationError, match="CRAWL_REQUEST_TIMEOUT_SECONDS"):
        Settings(_env_file=None, CRAWL_REQUEST_TIMEOUT_SECONDS=2)


def test_settings_reject_invalid_extraction_block_length() -> None:
    with pytest.raises(ValidationError, match="QUALITY_EXTRACTION_MAX_BLOCK_LENGTH"):
        Settings(_env_file=None, QUALITY_EXTRACTION_MAX_BLOCK_LENGTH=40)


def test_quality_profile_dev_defaults() -> None:
    cfg = Settings(
        _env_file=None,
        QUALITY_PROFILE="dev",
        QUALITY_USE_PROFILE_PRESETS=True,
    ).get_quality_gate_config()

    assert cfg["validation_min_readiness_score"] == 65.0
    assert cfg["validation_require_entity_endpoint_alignment"] is False
    assert cfg["export_require_deployment_ready"] is False
    assert cfg["infer_use_extracted_blocks"] is True


def test_quality_custom_thresholds_when_presets_disabled() -> None:
    cfg = Settings(
        _env_file=None,
        QUALITY_USE_PROFILE_PRESETS=False,
        QUALITY_EXTRACTION_MIN_NON_EMPTY_PAGE_RATIO=0.72,
        QUALITY_VALIDATION_MIN_READINESS_SCORE=91.0,
        QUALITY_EXTRACTION_MAX_BLOCKS=25,
    ).get_quality_gate_config()

    assert cfg["extraction_min_non_empty_page_ratio"] == 0.72
    assert cfg["validation_min_readiness_score"] == 91.0
    assert cfg["extraction_max_blocks"] == 25
