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
- Node.js 20+ and npm on the worker host (generated projects are actually built).
- Playwright Chromium: `python -m playwright install --with-deps chromium`.

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

### Source-Preserving Conversion

The existing wizard, queue, Python worker, LangGraph approval stages, and
React/Express/Prisma output stack remain in place. The source classifier is
unchanged. Captured pages now retain their original markup, CSS, scripts,
fonts and media; a React public renderer displays the database-backed
documents instead of asking the LLM to redraw the design.

The wizard accepts either a URL or an uploaded static website ZIP. ZIP sources
are validated before project creation and kept in the worker's persistent
`data/source-uploads` directory with account ownership. The original archive
can be reused for a retry and is removed when its project is deleted. Uploads
are limited to 100 MB compressed, 512 MB expanded and 20,000 archive entries.
Corrupt archives, encrypted files, symbolic links, unsafe/duplicate paths and
server-side file types are rejected. Wrapper folders are removed from the
website root; HTML pages and media are captured together, while original
asset paths preserve CSS imports, JavaScript modules and local references.
Private `.env` files and tooling directories are excluded from capture.

- Full-site mode has no page, asset or depth cap. Smaller page presets are
  explicit. Reaching a configured capture limit marks the capture incomplete.
- Every captured page is included in batched schema inference. The
  `LLM_MAX_OUTPUT_TOKENS` setting limits each provider response, not the total
  conversion budget. Provider quotas, context windows and request failures still apply.
- Provider requests use `LLM_REQUEST_TIMEOUT_SECONDS` (60 seconds by default),
  bounded SDK retries, and reuse a successful provider for later evidence batches.
  Batch/provider progress and partial model/field counts are persisted while
  inference runs. Unavailable models and provider failures are reported rather
  than leaving an indefinite silent spinner. Confirm model IDs against each
  provider's current catalog; environment values override code defaults.
- Generated admin supports page content/link/media edits, publishing,
  duplication/deletion, media uploads, and typed collection CRUD.
  The source-preserving runtime uses a reusable responsive CMS template with
  an overview, searchable page tables, media previews and collection editors.
  The legacy model-generated admin prompt specifies the same design requirements.
  Login screens and frontend bundles contain no default credentials;
  the default-password warning is available only after authentication.
- Generated setup creates a private backend `.env` without overwriting an
  existing file. Local login defaults to `admin@gmail.com` / `admin123`.
  Change `ADMIN_EMAIL` and `ADMIN_PASSWORD` and restart to update the same
  account and revoke old sessions. Passwords are hashed in the database;
  `.env` is plaintext and must remain private. Default credentials are
  rejected in production mode or on a non-loopback bind address. Never
  expose defaults through a reverse proxy or tunnel.
- Actual npm installs, backend syntax checks, Prisma setup, frontend builds,
  database health and page HTTP checks determine runtime readiness.
  A structural score of 100 is not a visual fidelity score.
- Export is best-effort for every job with generated files. Missing assets,
  failed source pages, low quality scores and failed/unverified runtime builds
  do not block ZIP downloads. Original validation results remain unchanged.
  Each ZIP includes export-report.json and README warnings; unavailable files
  are listed rather than fabricated. Optional sitemap failures remain in the
  capture report. Downloads are not proof of deployment readiness.
- Unit tests isolate provider/build work. The real generated-runtime test is:

```bash
RUN_RUNTIME_INTEGRATION=1 python -m pytest tests/test_generated_runtime_integration.py -q
PYTHONPATH=. python scripts/verify_preserved_site.py https://www.nowwadvisory.co.nz/ --output /tmp/noww-check
```

The diagnostic script uses a schema fixture, not a real LLM inference result.
For a real provider-backed run through the worker stages, use:

```bash
PYTHONPATH=. python scripts/run_live_acceptance.py https://www.nowwadvisory.co.nz/ --output /tmp/noww-live
```

This diagnostic runner approves the inferred proposal for acceptance testing;
the normal application still requires schema approval. To rebuild updated
templates from that saved live schema, add `--job-id JOB_ID --generate-only`
with the same output directory. Provider-call evidence is recorded separately
in `provider-audit.json` and is retained when regenerating.

To export existing output without re-running models or builds, add
`--job-id JOB_ID --export-only` with the same output directory. No per-site
approval flag is needed for best-effort downloads. The optional
`--accept-source-failure URL` flag on generation-only runs records explicit
acceptance of known source failures in the validation report; it does not
repair missing source content.

Browser comparison is available through `scripts/compare_source_site.py`.
Production validation reports `visual_status: not_run` until an explicit
browser comparison has been performed.

### Remaining Boundaries

This is not a universal lossless converter. Contact forms, search, payments,
third-party APIs and authentication embedded in source scripts keep their
original behavior and may require separate integrations. Collection records
are not automatically bound to repeated source-page sections or transformed
into inferred relational Prisma tables. Same-origin preserved scripts must be
trusted; isolate the generated application from the converter and other
authenticated applications when previewing or deploying it.

NOWW live acceptance on 2026-10-01 received 19 successful model responses via
provider failover and inferred 28 entities. Generation captured 7 unique
pages and 113 assets, and the runtime build passed. The original validation
reported source failures: its
`/legal/terms-of-service` link returned 404 and an external
`https://t87fw5.csb.app/script.js` returned 401. These source failures are
reported rather than silently replaced.

- Quality behavior is profile-driven via `QUALITY_PROFILE` and `QUALITY_USE_PROFILE_PRESETS`.
- Export quality gates are advisory. No generated files, unsafe artifact paths,
  corrupt ZIP output or filesystem failures can still prevent a download.
- Legacy deployment-readiness export settings no longer block source downloads.
- Export zip is built as a runtime-only dynamic website bundle (`backend/`, `frontend/`, runtime manifest, and project README).
- Successful export can auto-copy the generated zip to your local Downloads folder (`EXPORT_COPY_TO_DOWNLOADS=true`).
- You can override the target folder with `EXPORT_DOWNLOADS_DIR`.
- Job responses include phase reports and a normalized `quality_summary`.

## License

Add your preferred license file (for example, MIT) before public distribution.
