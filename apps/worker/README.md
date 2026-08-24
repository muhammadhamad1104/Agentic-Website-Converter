# Agent

Production-grade agentic static-to-dynamic website converter.

## Overview

This project crawls static website sources, extracts structure, infers a schema, generates a dynamic application scaffold, validates deployment readiness, and exports a packaged build.

## Key Features

- Stateful conversion workflow with explicit node transitions and quality gates.
- Crawl controls for depth, page/asset limits, static-source enforcement, sitemap seeding, retries, and optional JS rendering.
- Extraction, schema, scaffold, generation, and validation quality reports.
- Normalized `quality_summary` contract for clients.
- Deployment-aware export checks (readiness threshold + package layout verification).
- Trace events and history endpoints for auditability.

## Project Structure

- `src/engine/`: workflow nodes, orchestration service, state, and persistence.
- `src/mcp_server.py`: MCP tool interface for conversion operations.
- `chat_interface/`: Gradio chat interface for interactive conversion.
- `tests/`: unit and integration tests.

## Requirements

- Python 3.11+
- pip

## Setup

1. Create and activate a virtual environment.

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

2. Install dependencies.

```powershell
pip install -r requirements.txt
```

3. Prepare environment variables.

- Copy `.env.example` to `.env` if needed.
- Update required keys (LLM providers, LangSmith, and optional infrastructure settings).

## Run

### MCP Server

```powershell
python -m src.mcp_server
```

### Chat Interface

```powershell
python chat_interface/app.py
```

## Testing

Run full test suite:

```powershell
python -m pytest -q
```

## Quality and Export Notes

- Quality behavior is profile-driven via `QUALITY_PROFILE` and `QUALITY_USE_PROFILE_PRESETS`.
- Export is blocked when validation gates or deployment/package checks fail.
- Export zip is built as a runtime-only dynamic website bundle (`backend/`, `frontend/`, runtime manifest, and project README).
- Successful export can auto-copy the generated zip to your local Downloads folder (`EXPORT_COPY_TO_DOWNLOADS=true`).
- You can override the target folder with `EXPORT_DOWNLOADS_DIR`.
- Job responses include phase reports and a normalized `quality_summary`.

## License

Add your preferred license file (for example, MIT) before public distribution.
