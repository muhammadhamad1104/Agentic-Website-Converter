from __future__ import annotations

from typing import Any

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    
    # LLM
    KIMI_API_KEY: str = ""
    KIMI_MODEL: str = "moonshot-v1-128k"
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-chat"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.6-flash"
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    OPEN_SOURCE_API_KEY: str = ""
    OPEN_SOURCE_MODEL: str = ""
    OPEN_SOURCE_BASE_URL: str = ""
    ANTHROPIC_API_KEY: str = ""
    DEFAULT_LLM_MODEL: str = "gpt-4o-mini"
    
    # Database
    DATABASE_URL: str = ""
    
    # Redis
    REDIS_URL: str = ""
    
    # Storage
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_S3_BUCKET: str = ""
    AWS_REGION: str = "us-east-1"

    # Engine state persistence
    JOB_STORE_PATH: str = "data/conversion_jobs.db"
    GENERATED_OUTPUT_PATH: str = "generated"
    TEMPLATE_GENERATOR_PATH: str = ""

    # Crawl defaults
    CRAWL_DEPTH_LIMIT_DEFAULT: int = 3
    CRAWL_MAX_PAGES_DEFAULT: int = 0
    CRAWL_MAX_ASSETS_DEFAULT: int = 0
    CRAWL_SAME_DOMAIN_ONLY_DEFAULT: bool = True
    CRAWL_FOLLOW_ASSET_DOMAINS_DEFAULT: bool = True
    CRAWL_REQUEST_TIMEOUT_SECONDS: int = 20
    CRAWL_REQUEST_RETRIES: int = 3
    CRAWL_VERIFY_TLS_DEFAULT: bool = True
    CRAWL_ENFORCE_STATIC_SOURCE_DEFAULT: bool = False
    CRAWL_RESUME_FROM_CHECKPOINT_DEFAULT: bool = True
    CRAWL_INCLUDE_SITEMAP_SEEDS_DEFAULT: bool = True
    CRAWL_RENDER_JS_DEFAULT: bool = True
    CRAWL_RENDER_WAIT_SECONDS: int = 2
    CRAWL_RENDER_HEADLESS: bool = True

    # Quality gates (post-crawl workflow hardening)
    QUALITY_EXTRACTION_MIN_NON_EMPTY_PAGE_RATIO: float = 0.5
    QUALITY_EXTRACTION_MIN_AVG_TEXT_LENGTH: int = 8
    QUALITY_EXTRACTION_FAIL_ON_LOW_TEXT_DENSITY: bool = False
    QUALITY_EXTRACTION_MAX_BLOCKS: int = 60
    QUALITY_EXTRACTION_MAX_BLOCK_LENGTH: int = 1200
    QUALITY_EXTRACTION_MIN_BLOCK_CHAR_LENGTH: int = 20
    QUALITY_INFER_USE_EXTRACTED_BLOCKS: bool = True
    QUALITY_INFER_MAX_EVIDENCE_SLICES: int = 8
    QUALITY_SCAFFOLD_MIN_DIR_COUNT: int = 10
    QUALITY_SCAFFOLD_MIN_FILE_COUNT: int = 10
    QUALITY_GENERATION_REQUIRE_SCHEMA_QUALITY_GATE: bool = True
    QUALITY_GENERATION_REQUIRE_SCAFFOLD_QUALITY_GATE: bool = True
    QUALITY_SCHEMA_MAX_GENERIC_ENTITY_RATIO: float = 0.55
    QUALITY_SCHEMA_MIN_ENTITY_CONFIDENCE: float = 0.35
    QUALITY_VALIDATION_MIN_SEMANTIC_RATIO: float = 0.45
    QUALITY_VALIDATION_MIN_READINESS_SCORE: float = 80.0
    QUALITY_VALIDATION_REQUIRE_ENTITY_ENDPOINT_ALIGNMENT: bool = True
    QUALITY_EXPORT_REQUIRE_DEPLOYMENT_READY: bool = True
    QUALITY_EXPORT_VERIFY_PACKAGE_LAYOUT: bool = True
    QUALITY_EXPORT_MIN_ZIP_BYTES: int = 512
    EXPORT_COPY_TO_DOWNLOADS: bool = True
    EXPORT_DOWNLOADS_DIR: str = ""
    QUALITY_PROFILE: str = "prod"
    QUALITY_USE_PROFILE_PRESETS: bool = True

    # LangSmith
    LANGSMITH_TRACING: bool = True
    LANGSMITH_ENDPOINT: str = "https://api.smith.langchain.com"
    LANGSMITH_API_KEY: str = ""
    LANGSMITH_PROJECT: str = "STATIC-TO-DYNAMIC-WEBSITE-CONVERTER"

    @staticmethod
    def _quality_profile_matrix() -> dict[str, dict[str, Any]]:
        return {
            "dev": {
                "extraction_min_non_empty_page_ratio": 0.3,
                "extraction_min_avg_text_length": 5,
                "extraction_fail_on_low_text_density": False,
                "extraction_max_blocks": 60,
                "extraction_max_block_length": 1200,
                "extraction_min_block_char_length": 10,
                "infer_use_extracted_blocks": True,
                "infer_max_evidence_slices": 8,
                "scaffold_min_dir_count": 1,
                "scaffold_min_file_count": 1,
                "generation_require_schema_quality_gate": False,
                "generation_require_scaffold_quality_gate": False,
                "schema_max_generic_entity_ratio": 0.75,
                "schema_min_entity_confidence": 0.2,
                "validation_min_semantic_ratio": 0.35,
                "validation_min_readiness_score": 65.0,
                "validation_require_entity_endpoint_alignment": False,
                "export_require_deployment_ready": False,
                "export_verify_package_layout": False,
                "export_min_zip_bytes": 128,
            },
            "staging": {
                "extraction_min_non_empty_page_ratio": 0.45,
                "extraction_min_avg_text_length": 8,
                "extraction_fail_on_low_text_density": False,
                "extraction_max_blocks": 60,
                "extraction_max_block_length": 1200,
                "extraction_min_block_char_length": 15,
                "infer_use_extracted_blocks": True,
                "infer_max_evidence_slices": 8,
                "scaffold_min_dir_count": 10,
                "scaffold_min_file_count": 10,
                "generation_require_schema_quality_gate": True,
                "generation_require_scaffold_quality_gate": True,
                "schema_max_generic_entity_ratio": 0.6,
                "schema_min_entity_confidence": 0.3,
                "validation_min_semantic_ratio": 0.4,
                "validation_min_readiness_score": 75.0,
                "validation_require_entity_endpoint_alignment": True,
                "export_require_deployment_ready": True,
                "export_verify_package_layout": True,
                "export_min_zip_bytes": 512,
            },
            "prod": {
                "extraction_min_non_empty_page_ratio": 0.5,
                "extraction_min_avg_text_length": 8,
                "extraction_fail_on_low_text_density": False,
                "extraction_max_blocks": 60,
                "extraction_max_block_length": 1200,
                "extraction_min_block_char_length": 20,
                "infer_use_extracted_blocks": True,
                "infer_max_evidence_slices": 8,
                "scaffold_min_dir_count": 10,
                "scaffold_min_file_count": 10,
                "generation_require_schema_quality_gate": True,
                "generation_require_scaffold_quality_gate": True,
                "schema_max_generic_entity_ratio": 0.55,
                "schema_min_entity_confidence": 0.35,
                "validation_min_semantic_ratio": 0.45,
                "validation_min_readiness_score": 80.0,
                "validation_require_entity_endpoint_alignment": True,
                "export_require_deployment_ready": True,
                "export_verify_package_layout": True,
                "export_min_zip_bytes": 512,
            },
        }

    def get_quality_gate_config(self) -> dict[str, Any]:
        profile = str(self.QUALITY_PROFILE or "prod").strip().lower()
        if bool(self.QUALITY_USE_PROFILE_PRESETS):
            return dict(self._quality_profile_matrix()[profile])

        return {
            "extraction_min_non_empty_page_ratio": float(self.QUALITY_EXTRACTION_MIN_NON_EMPTY_PAGE_RATIO),
            "extraction_min_avg_text_length": int(self.QUALITY_EXTRACTION_MIN_AVG_TEXT_LENGTH),
            "extraction_fail_on_low_text_density": bool(self.QUALITY_EXTRACTION_FAIL_ON_LOW_TEXT_DENSITY),
            "extraction_max_blocks": int(self.QUALITY_EXTRACTION_MAX_BLOCKS),
            "extraction_max_block_length": int(self.QUALITY_EXTRACTION_MAX_BLOCK_LENGTH),
            "extraction_min_block_char_length": int(self.QUALITY_EXTRACTION_MIN_BLOCK_CHAR_LENGTH),
            "infer_use_extracted_blocks": bool(self.QUALITY_INFER_USE_EXTRACTED_BLOCKS),
            "infer_max_evidence_slices": int(self.QUALITY_INFER_MAX_EVIDENCE_SLICES),
            "scaffold_min_dir_count": int(self.QUALITY_SCAFFOLD_MIN_DIR_COUNT),
            "scaffold_min_file_count": int(self.QUALITY_SCAFFOLD_MIN_FILE_COUNT),
            "generation_require_schema_quality_gate": bool(self.QUALITY_GENERATION_REQUIRE_SCHEMA_QUALITY_GATE),
            "generation_require_scaffold_quality_gate": bool(self.QUALITY_GENERATION_REQUIRE_SCAFFOLD_QUALITY_GATE),
            "schema_max_generic_entity_ratio": float(self.QUALITY_SCHEMA_MAX_GENERIC_ENTITY_RATIO),
            "schema_min_entity_confidence": float(self.QUALITY_SCHEMA_MIN_ENTITY_CONFIDENCE),
            "validation_min_semantic_ratio": float(self.QUALITY_VALIDATION_MIN_SEMANTIC_RATIO),
            "validation_min_readiness_score": float(self.QUALITY_VALIDATION_MIN_READINESS_SCORE),
            "validation_require_entity_endpoint_alignment": bool(self.QUALITY_VALIDATION_REQUIRE_ENTITY_ENDPOINT_ALIGNMENT),
            "export_require_deployment_ready": bool(self.QUALITY_EXPORT_REQUIRE_DEPLOYMENT_READY),
            "export_verify_package_layout": bool(self.QUALITY_EXPORT_VERIFY_PACKAGE_LAYOUT),
            "export_min_zip_bytes": int(self.QUALITY_EXPORT_MIN_ZIP_BYTES),
        }

    @model_validator(mode="after")
    def _validate_quality_and_runtime_settings(self) -> "Settings":
        profile = str(self.QUALITY_PROFILE or "").strip().lower()
        if profile not in self._quality_profile_matrix():
            raise ValueError("QUALITY_PROFILE must be one of: dev, staging, prod")

        for key in [
            "QUALITY_EXTRACTION_MIN_NON_EMPTY_PAGE_RATIO",
            "QUALITY_SCHEMA_MAX_GENERIC_ENTITY_RATIO",
            "QUALITY_SCHEMA_MIN_ENTITY_CONFIDENCE",
            "QUALITY_VALIDATION_MIN_SEMANTIC_RATIO",
        ]:
            value = float(getattr(self, key))
            if value < 0.0 or value > 1.0:
                raise ValueError(f"{key} must be between 0 and 1")

        if int(self.QUALITY_EXTRACTION_MIN_AVG_TEXT_LENGTH) < 0:
            raise ValueError("QUALITY_EXTRACTION_MIN_AVG_TEXT_LENGTH must be >= 0")

        if int(self.QUALITY_EXTRACTION_MAX_BLOCKS) < 1:
            raise ValueError("QUALITY_EXTRACTION_MAX_BLOCKS must be >= 1")

        if int(self.QUALITY_EXTRACTION_MAX_BLOCK_LENGTH) < 80:
            raise ValueError("QUALITY_EXTRACTION_MAX_BLOCK_LENGTH must be >= 80")

        if int(self.QUALITY_EXTRACTION_MIN_BLOCK_CHAR_LENGTH) < 0:
            raise ValueError("QUALITY_EXTRACTION_MIN_BLOCK_CHAR_LENGTH must be >= 0")

        if int(self.QUALITY_INFER_MAX_EVIDENCE_SLICES) < 1:
            raise ValueError("QUALITY_INFER_MAX_EVIDENCE_SLICES must be >= 1")

        if int(self.QUALITY_SCAFFOLD_MIN_DIR_COUNT) < 1:
            raise ValueError("QUALITY_SCAFFOLD_MIN_DIR_COUNT must be >= 1")

        if int(self.QUALITY_SCAFFOLD_MIN_FILE_COUNT) < 1:
            raise ValueError("QUALITY_SCAFFOLD_MIN_FILE_COUNT must be >= 1")

        if int(self.QUALITY_EXPORT_MIN_ZIP_BYTES) < 1:
            raise ValueError("QUALITY_EXPORT_MIN_ZIP_BYTES must be >= 1")

        readiness = float(self.QUALITY_VALIDATION_MIN_READINESS_SCORE)
        if readiness < 0.0 or readiness > 100.0:
            raise ValueError("QUALITY_VALIDATION_MIN_READINESS_SCORE must be between 0 and 100")

        if int(self.CRAWL_REQUEST_TIMEOUT_SECONDS) < 3:
            raise ValueError("CRAWL_REQUEST_TIMEOUT_SECONDS must be >= 3")

        if int(self.CRAWL_REQUEST_RETRIES) < 1:
            raise ValueError("CRAWL_REQUEST_RETRIES must be >= 1")

        return self

    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
