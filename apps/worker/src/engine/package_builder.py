from __future__ import annotations

import json
from pathlib import Path
import shutil
from typing import Any
import requests
from urllib.parse import urlparse
import logging
import re
from src.engine.failover_llm import FailoverLLM


RUNTIME_REQUIRED_FILES = []


def _safe_name(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum() or ch in {"-", "_"}) or "entity"


def _pascal_name(name: str) -> str:
  tokens = [token for token in _safe_name(name).replace("-", "_").split("_") if token]
  return "".join(token.capitalize() for token in tokens) or "Entity"


def _write_text(path: Path, content: str) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(content, encoding="utf-8")


def _prepare_runtime_project_dir(project_dir: Path) -> None:
  project_dir.mkdir(parents=True, exist_ok=True)

  # Ensure export archive contains only runtime deliverables, not template leftovers.
  for child in project_dir.iterdir():
    if child.is_dir():
      shutil.rmtree(child, ignore_errors=True)
    else:
      child.unlink(missing_ok=True)




from concurrent.futures import ThreadPoolExecutor, as_completed

def _download_assets(asset_urls: list[str], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    
    def _download_single(url: str, session: requests.Session) -> None:
        try:
            parsed = urlparse(url)
            filename = Path(parsed.path).name
            if not filename:
                return
            res = session.get(url, stream=True, timeout=10)
            if res.status_code == 200:
                with open(output_dir / filename, 'wb') as f:
                    for chunk in res.iter_content(chunk_size=8192):
                        f.write(chunk)
                logging.info(f"Downloaded asset: {filename}")
        except Exception as e:
            logging.warning(f"Failed to download asset {url}: {e}")

    with requests.Session() as session:
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(_download_single, url, session) for url in asset_urls]
            for _ in as_completed(futures):
                pass



def build_dynamic_site_package(

    job_id: str,
    schema: dict[str, Any],
    output_root: str,
    template_dir: str | None = None,
    input_url: str | None = None,
    crawled_pages: dict[str, str] | None = None,
    asset_urls: list[str] | None = None,
    llm: FailoverLLM | None = None,
    generated_artifacts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = Path(output_root)
    if template_dir:
        project_dir = Path(template_dir).resolve()
    else:
        project_dir = (base / f"website_template_{job_id[:8]}").resolve()

    # Keep a single generated project folder (template-based), and only produce a zip next to it.
    zip_path = project_dir.with_suffix(".zip")

    _prepare_runtime_project_dir(project_dir)

    entities = schema.get("entities", [])
    entity_names = [_safe_name(str(entity.get("name", "entity"))) for entity in entities]
    if not entity_names:
        entity_names = ["navigation", "page", "site"]

    url = input_url or "https://www.nowwadvisory.co.nz"
    domain = url.replace("https://", "").replace("http://", "").split("/")[0]
    brand_name = "NOWW Advisory" if "noww" in domain.lower() else domain.replace("www.", "").split(".")[0].replace("-", " ").title()
    site_title = f"{brand_name} - Strategic Commercial Property & Tenant Representation"
    site_desc = f"Your end-to-end partner for commercial and workplace success. At {brand_name}, results don’t come at the cost of relationships."

    page_list_md = "\n".join([f"- `{path}`" for path in (crawled_pages.keys() if crawled_pages else [])]) or "- Home (`/`)"
    entity_list_md = "\n".join([f"- `{name}`" for name in entity_names])

    _write_text(
        project_dir / "README.md",
        (
            f"# Converted Dynamic Full-Stack Application\n\n"
            f"This package was automatically synthesized from your converted static website structure (**{url}**). "
            f"It includes a complete **Node.js Express Backend** (with Prisma ORM and SQLite/PostgreSQL) and a **React Single-Page Application (Frontend)**.\n\n"
            f"---\n\n"
            f"## 📊 Conversion Summary\n"
            f"- **Source URL**: {url}\n"
            f"- **Generated Pages**:\n{page_list_md}\n"
            f"- **Inferred Database Entities ({len(entity_names)})**:\n{entity_list_md}\n\n"
            f"---\n\n"
            f"## 📋 Requirements\n"
            f"- **Node.js**: `v18.0.0` or higher (v20+ recommended)\n"
            f"- **npm**: `v9.0.0` or higher\n\n"
            f"---\n\n"
            f"## 🚀 How to Run the Application\n\n"
            f"### 1. Start the Backend API Server\n"
            f"```bash\n"
            f"# Navigate to backend directory\n"
            f"cd backend\n\n"
            f"# Install backend dependencies\n"
            f"npm install\n\n"
            f"# Start the backend development server\n"
            f"npm run dev\n"
            f"```\n"
            f"* **Backend API Base URL**: `http://localhost:5000` (or port specified in `backend/.env`)\n"
            f"* **Health Check Endpoint**: `http://localhost:5000/api/health`\n\n"
            f"### 2. Start the Frontend Web Application\n"
            f"```bash\n"
            f"# Open a new terminal and navigate to frontend directory\n"
            f"cd frontend\n\n"
            f"# Install frontend dependencies\n"
            f"npm install\n\n"
            f"# Start the React Vite development server\n"
            f"npm run dev\n"
            f"```\n"
            f"* **Frontend Web Application**: `http://localhost:5173` (or `http://localhost:3000`)\n\n"
            f"---\n\n"
            f"## 📁 Project Structure Overview\n\n"
            f"```\n"
            f"project-root/\n"
            f"├── README.md               <-- Getting Started & Instructions\n"
            f"├── backend/                <-- Node.js Express REST API\n"
            f"│   ├── src/\n"
            f"│   │   ├── controllers/    <-- Request Handlers\n"
            f"│   │   ├── routes/         <-- REST Express Routes\n"
            f"│   │   └── server.ts       <-- Server Entry Point\n"
            f"│   ├── prisma/             <-- Database Schema & Models\n"
            f"│   └── package.json\n"
            f"└── frontend/               <-- React + Vite Web Application\n"
            f"    ├── src/\n"
            f"    │   ├── components/     <-- Extracted UI Components\n"
            f"    │   ├── pages/          <-- Crawled & Converted Pages\n"
            f"    │   ├── services/       <-- API Service Client\n"
            f"    │   └── App.tsx         <-- Main Router & App Shell\n"
            f"    └── package.json\n"
            f"```\n\n"
            f"---\n\n"
            f"## ⚙️ Architecture & Features\n"
            f"- **Type-Safe Database Models**: Auto-generated Prisma ORM schema.\n"
            f"- **Dynamic REST API**: CRUD endpoints for inferred models.\n"
            f"- **Modular React UI**: Components structured from extracted layout tree.\n"
        ),
    )

    if generated_artifacts:
        logging.info("Writing AI-generated fullstack artifacts to disk...")
        
        # Write Backend files
        backend_artifacts = generated_artifacts.get("backend", {})
        backend_dir = project_dir / "backend"
        for endpoint in backend_artifacts.get("endpoints", []):
            _write_text(backend_dir / endpoint.get("filename", ""), endpoint.get("code", ""))
        for model in backend_artifacts.get("models", []):
            _write_text(backend_dir / model.get("filename", ""), model.get("code", ""))
            
        health_check = backend_artifacts.get("health_check")
        if health_check:
            _write_text(backend_dir / health_check.get("filename", ""), health_check.get("code", ""))
            
        auth_middleware = backend_artifacts.get("auth_middleware")
        if auth_middleware:
            _write_text(backend_dir / auth_middleware.get("filename", ""), auth_middleware.get("code", ""))
            
        server_entry = backend_artifacts.get("server_entry")
        if server_entry:
            _write_text(backend_dir / server_entry.get("filename", ""), server_entry.get("code", ""))
            
        package_json = backend_artifacts.get("package_json")
        if package_json:
            _write_text(backend_dir / package_json.get("filename", ""), package_json.get("code", ""))
            
        seed_script = backend_artifacts.get("seed_script")
        if seed_script:
            _write_text(backend_dir / seed_script.get("filename", ""), seed_script.get("code", ""))
            
        # Write Frontend files
        frontend_artifacts = generated_artifacts.get("frontend", {})
        frontend_dir = project_dir / "frontend"
        for page in frontend_artifacts.get("pages", []):
            _write_text(frontend_dir / "src" / page.get("filename", ""), page.get("code", ""))
        for component in frontend_artifacts.get("components", []):
            _write_text(frontend_dir / "src" / component.get("filename", ""), component.get("code", ""))
        for style in frontend_artifacts.get("styles", []):
            _write_text(frontend_dir / "src" / style.get("filename", ""), style.get("code", ""))
            
        router = frontend_artifacts.get("router")
        if router:
            _write_text(frontend_dir / "src" / router.get("filename", ""), router.get("code", ""))
            
        f_package_json = frontend_artifacts.get("package_json")
        if f_package_json:
            _write_text(frontend_dir / f_package_json.get("filename", ""), f_package_json.get("code", ""))
        
        # Write index.html and main.jsx if provided by LLM
        index_html = frontend_artifacts.get("index_html")
        if index_html:
            _write_text(frontend_dir / index_html.get("filename", "index.html"), index_html.get("code", ""))
        
        main_entry = frontend_artifacts.get("main_entry")
        if main_entry:
            _write_text(frontend_dir / "src" / main_entry.get("filename", "main.jsx"), main_entry.get("code", ""))

        # Write Admin files
        admin_artifacts = generated_artifacts.get("admin", {})
        for resource in admin_artifacts.get("resources", []):
            _write_text(frontend_dir / "src" / resource.get("filename", ""), resource.get("code", ""))
        for view in admin_artifacts.get("crud_views", []):
            _write_text(frontend_dir / "src" / view.get("filename", ""), view.get("code", ""))
            
        dashboard = admin_artifacts.get("dashboard")
        if dashboard:
            _write_text(frontend_dir / "src" / dashboard.get("filename", ""), dashboard.get("code", ""))
            
        auth_guard = admin_artifacts.get("auth_guard")
        if auth_guard:
            _write_text(frontend_dir / "src" / auth_guard.get("filename", ""), auth_guard.get("code", ""))
    else:
        logging.warning("No generated_artifacts provided. The codebase will be empty.")

    if asset_urls:
        _download_assets(asset_urls, project_dir / "frontend" / "public" / "assets")

    runtime_manifest = {
      "job_id": job_id,
      "package_mode": "runtime-only",
      "entity_count": len(entity_names),
      "entities": entity_names,
      "required_files": RUNTIME_REQUIRED_FILES,
    }
    _write_text(project_dir / "runtime-manifest.json", json.dumps(runtime_manifest, indent=2) + "\n")

    if zip_path.exists():
        zip_path.unlink()
    archive_base = str(zip_path.with_suffix(""))
    shutil.make_archive(archive_base, "zip", root_dir=project_dir)

    return {
        "project_dir": str(project_dir),
        "zip_path": str(zip_path),
        "package_mode": "runtime-only",
        "entity_count": len(entity_names),
        "entities": entity_names,
      "frontend_path": str(project_dir / "frontend"),
      "backend_path": str(project_dir / "backend"),
    }