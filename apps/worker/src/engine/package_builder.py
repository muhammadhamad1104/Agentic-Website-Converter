from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

RUNTIME_REQUIRED_FILES = ["backend/package.json", "backend/src/index.js", "frontend/package.json",
                          "frontend/index.html", "frontend/src/main.jsx", "runtime-manifest.json", "README.md"]


def _safe_path(root: Path, name: str) -> Path:
    relative = PurePosixPath(name.replace("\\", "/"))
    if not name or relative.is_absolute() or ".." in relative.parts or ":" in name:
        raise ValueError(f"Unsafe artifact path: {name!r}")
    path = (root / str(relative)).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"Artifact escapes project directory: {name!r}")
    return path


def write_runtime_project(project: Path, artifacts: dict[str, Any], job_id: str,
                          export_report: dict[str, Any] | None = None) -> list[str]:
    project.mkdir(parents=True, exist_ok=True)
    best_effort = export_report is not None
    warnings = list(export_report.get("warnings", [])) if best_effort else []
    if best_effort:
        (project / "backend").mkdir(exist_ok=True)
        (project / "frontend").mkdir(exist_ok=True)
    files: dict[str, bytes] = {}

    def add(root, file, source=False):
        if not isinstance(file, dict) or not isinstance(file.get("filename"), str):
            if best_effort:
                warnings.append("Skipped malformed generated file in " + root)
                return
            raise ValueError("Artifact must contain a filename and code")
        filename = file["filename"]
        if source and filename.startswith("src/"):
            filename = filename[4:]
        try:
            path = _safe_path(project, root + "/" + filename)
        except ValueError:
            if best_effort:
                warnings.append("Skipped unsafe generated path: " + root + "/" + filename)
                return
            raise
        if any(part in {".git", "node_modules", "__pycache__"} or
               (part == ".env" or part.startswith(".env.") and part != ".env.example")
               for part in path.relative_to(project.resolve()).parts):
            if best_effort:
                warnings.append("Excluded private or non-runtime generated file: " + root + "/" + filename)
                return
            raise ValueError("Private or non-runtime artifact: " + filename)
        code = file.get("code")
        if not isinstance(code, str) or not code.strip():
            if best_effort:
                warnings.append("Skipped empty generated file: " + root + "/" + filename)
                return
            raise ValueError(f"Empty artifact: {filename}")
        relative = str(path.relative_to(project.resolve())).replace("\\", "/")
        content = code.encode("utf-8")
        if relative in files and files[relative] != content:
            if best_effort:
                warnings.append("Conflicting generated file; retained first version: " + relative)
                return
            raise ValueError(f"Conflicting generated files: {relative}")
        files[relative] = content

    backend = artifacts.get("backend") or {}
    frontend = artifacts.get("frontend") or {}
    admin = artifacts.get("admin") or {}
    for key in ("endpoints", "models", "files"):
        for file in backend.get(key, []):
            add("backend", file)
    for key in ("health_check", "auth_middleware", "server_entry", "package_json", "seed_script"):
        if backend.get(key): add("backend", backend[key])
    for key in ("pages", "components", "styles"):
        for file in frontend.get(key, []): add("frontend/src", file, source=True)
    for key in ("router", "main_entry"):
        if frontend.get(key): add("frontend/src", frontend[key], source=True)
    for key in ("package_json", "index_html"):
        if frontend.get(key):
            file = frontend[key]
            # These semantic slots belong at the frontend root, including legacy output.
            expected = "package.json" if key == "package_json" else "index.html"
            if best_effort and isinstance(file, dict) and isinstance(file.get("filename"), str) and Path(file["filename"]).name == expected:
                file = {**file, "filename": expected}
            add("frontend", file)
    for file in frontend.get("files", []): add("frontend", file)
    for key in ("resources", "crud_views"):
        for file in admin.get(key, []): add("frontend/src", file, source=True)
    for key in ("dashboard", "auth_guard"):
        if admin.get(key): add("frontend/src", admin[key], source=True)
    for asset in artifacts.get("source_assets", []):
        if not isinstance(asset, dict) or not isinstance(asset.get("filename"), str):
            if best_effort:
                warnings.append("Skipped malformed captured asset")
                continue
            raise ValueError("Asset must contain a filename")
        try:
            target = _safe_path(project, "frontend/" + asset["filename"])
        except ValueError:
            if best_effort:
                warnings.append("Skipped unsafe captured asset path: " + asset["filename"])
                continue
            raise
        relative = str(target.relative_to(project.resolve())).replace("\\", "/")
        try:
            content = asset["code"].encode("utf-8") if "code" in asset else Path(asset["source"]).read_bytes()
        except (OSError, KeyError, AttributeError) as error:
            if best_effort:
                warnings.append("Unavailable captured asset: " + relative + " (" + type(error).__name__ + ")")
                continue
            raise
        if relative in files and files[relative] != content:
            raise ValueError(f"Conflicting asset: {relative}")
        files[relative] = content
    manifest = {"job_id": job_id, "package_mode": "runtime-only", "source_report": artifacts.get("source_report", {}),
                "required_files": RUNTIME_REQUIRED_FILES}
    files["runtime-manifest.json"] = json.dumps(manifest, indent=2).encode()
    files["README.md"] = b"""# Converted dynamic website

Requirements: Node.js 20 or newer, npm.

1. In backend/, run npm install and npm run setup. This automatically creates
   backend/.env from .env.example if it does not already exist.
2. For local setup, sign in with admin@gmail.com / admin123.
   Before deployment, set ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least
   12 characters in backend/.env.
3. In frontend/, run npm install and npm run build.
4. In backend/, run npm start.

Website: http://127.0.0.1:5000
Admin: http://127.0.0.1:5000/admin
Health: http://127.0.0.1:5000/health

Changing admin credentials:
Edit ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env and restart the backend.
The managed admin account is updated automatically, including email changes.
Existing sessions are revoked when either credential changes.
Shell/container environment variables override .env values.

The default login is LOCAL ONLY: startup rejects it with NODE_ENV=production
or HOST set to a non-loopback address. Do not expose it through a tunnel or
reverse proxy. Set unique credentials and use HTTPS before publishing.
Passwords are stored as salted scrypt hashes in the database. The .env file
still contains the plaintext password: keep it private, never commit it,
and restrict access. New .env files use owner-only permissions on Unix.
Setup never overwrites an existing .env. It is excluded from export ZIPs;
.env.example contains only the public local-setup defaults.

The React public renderer loads captured pages from the Express server.
Page content, publishing state, admin sessions and collection records persist
in the Prisma SQLite database. Admin page edits appear on the public website
after refresh. Original CSS, images, fonts and scripts are packaged locally.
Source scripts and external integrations may still depend on third-party
services; consult runtime-manifest.json for external and missing references.
Collection records are separate from the captured page content fields.
Forms and external services retain their original integrations; they are not
automatically replaced with local form handlers, search or payment systems.
Only run trusted captured scripts. Isolate previews from the converter and
other authenticated applications.

For development, run npm run dev in frontend/ while the backend is running.
For deployment, set HOST=0.0.0.0 behind your HTTPS reverse proxy and persist
backend/prisma/site.db and backend/uploads. Never publish .env.
"""
    accepted_failures = artifacts.get("source_report", {}).get("accepted_source_failures", [])
    if accepted_failures:
        files["README.md"] += ("\n## Accepted Source Warnings\n\n"
                              "Export was explicitly approved with these unavailable source URLs.\n"
                              "They were not repaired or replaced; affected behavior may remain unavailable.\n\n"
                              + "\n".join("- " + url for url in accepted_failures) + "\n").encode("utf-8")
    missing = set(RUNTIME_REQUIRED_FILES) - files.keys()
    if missing and not best_effort:
        raise ValueError("Missing required runtime files: " + ", ".join(sorted(missing)))
    if best_effort:
        if missing:
            warnings.append("Incomplete runtime package; missing files: " + ", ".join(sorted(missing)))
        export_report = {**export_report, "warnings": list(dict.fromkeys(warnings)), "missing_runtime_files": sorted(missing)}
        manifest["export_report"] = export_report
        files["runtime-manifest.json"] = json.dumps(manifest, indent=2).encode()
        files["export-report.json"] = json.dumps(export_report, indent=2).encode()
        files["README.md"] += ("\n## Export Status\n\n"
                              "This is a best-effort source export, not a deployment guarantee.\n"
                              "See export-report.json for build status and missing runtime files.\n\n"
                              + "\n".join("- " + warning for warning in export_report["warnings"]) + "\n").encode("utf-8")
    for relative, content in files.items():
        target = _safe_path(project, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return sorted(files)


def build_dynamic_site_package(job_id: str, schema: dict[str, Any], output_root: str,
                               template_dir: str | None = None, input_url: str | None = None,
                               crawled_pages=None, asset_urls=None, llm=None, generated_artifacts=None,
                               export_report: dict[str, Any] | None = None):
    if not generated_artifacts:
        raise ValueError("No generated artifacts to export")
    base = Path(output_root).resolve()
    project = (base / ("website_" + "".join(c for c in job_id if c.isalnum() or c == "-"))).resolve()
    members = write_runtime_project(project, generated_artifacts, job_id, export_report=export_report)
    archive_path = project.with_suffix(".zip")
    temporary = archive_path.with_suffix(".zip.tmp")
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
        for member in members:
            archive.write(project / member, member)
    temporary.replace(archive_path)
    return {"project_dir": str(project), "zip_path": str(archive_path), "package_mode": "runtime-only",
            "backend_path": str(project / "backend"), "frontend_path": str(project / "frontend"),
            "warnings": json.loads((project / "export-report.json").read_text())["warnings"] if export_report is not None else [],
            "entity_count": len(schema.get("entities", [])),
            "entities": [entity["name"] for entity in schema.get("entities", [])]}
