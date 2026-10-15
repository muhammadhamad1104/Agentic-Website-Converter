import json
import zipfile
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

import pytest
from requests.structures import CaseInsensitiveDict

from src.engine.nodes import _extract_css_urls, _discover_sitemap_page_urls, _response_content_type
from src.engine.package_builder import build_dynamic_site_package, write_runtime_project
from src.engine.preserved_site import generate_preserved_site
from src.engine.resilient_nodes import validate_build_smoke_node, validation_review_gate_node
from src.engine.source_assets import asset_path, rewrite_css
from src.engine.schema_evidence import infer_all_pages
from src.engine.runtime_validation import _source_issues, validate_runtime


def source_state(tmp_path):
    image = tmp_path / "image.png"
    image.write_bytes(b"unique-image-content")
    stylesheet = tmp_path / "style.css"
    stylesheet.write_text('body { background: url("../a/photo.png?size=1") }')
    return {
        "job_id": "preserved-test",
        "schema_proposal": {"entities": [{"name": "Service", "fields": [{"name": "title", "type": "string"}]}]},
        "crawled_page_map": {
            "https://example.com/": '<html><head><title>Original title</title><link rel="stylesheet" href="/css/style.css"></head><body><h1>Hello <em>world</em>!</h1><img src="/a/photo.png?size=1" srcset="/a/photo.png?size=1 1x, /b/photo.png 2x"><a href="/contact#form">Contact</a><script>window.originalBehavior = true;</script></body></html>',
            "https://example.com/contact": '<html><head><title>Contact</title></head><body><form id="form">Original contact</form></body></html>',
        },
        "crawl_artifacts": {"assets": [
            {"url": "https://example.com/a/photo.png?size=1", "storage_path": str(image), "content_type": "image/png"},
            {"url": "https://example.com/b/photo.png", "storage_path": str(image), "content_type": "image/png"},
            {"url": "https://example.com/css/style.css", "storage_path": str(stylesheet), "content_type": "text/css"},
        ]},
    }


def test_capture_retains_layout_scripts_routes_and_editable_content(tmp_path):
    artifacts = generate_preserved_site(source_state(tmp_path))
    seed = json.loads(next(file["code"] for file in artifacts["backend"]["files"] if file["filename"] == "seed-data.json"))
    assert len(seed["pages"]) == 2
    home = seed["pages"][0]
    assert "<em" in home["html"] and "window.originalBehavior = true;" in home["html"]
    assert 'href="/contact#form"' in home["html"]
    assert any(field["value"] == "Hello " for field in home["fields"])
    assert artifacts["source_report"]["missing_assets"] == []
    assert len({asset["filename"] for asset in artifacts["source_assets"]}) == 3


def test_response_content_type_accepts_requests_header_mapping():
    response = SimpleNamespace(headers=CaseInsensitiveDict({"Content-Type": "image/png"}))
    assert _response_content_type(response) == "image/png"


def test_legacy_inline_capture_does_not_duplicate_real_routes(tmp_path):
    state = source_state(tmp_path)
    state["crawl_artifacts"]["pages"] = [{"url": "inline://page-1", "storage_path": str(tmp_path / "expired.html")}]
    artifacts = generate_preserved_site(state)
    seed = json.loads(next(file["code"] for file in artifacts["backend"]["files"] if file["filename"] == "seed-data.json"))
    assert {page["route"] for page in seed["pages"]} == {"/", "/contact"}


@pytest.mark.parametrize("content_type", ["", None, "application/octet-stream", "IMAGE/PNG; charset=binary"])
def test_media_types_survive_missing_or_generic_capture_headers(tmp_path, content_type):
    state = source_state(tmp_path)
    state["crawl_artifacts"]["assets"][0]["content_type"] = content_type
    artifacts = generate_preserved_site(state)
    seed = json.loads(next(file["code"] for file in artifacts["backend"]["files"] if file["filename"] == "seed-data.json"))
    assert seed["media"][0]["type"] == "image/png"


def test_export_uses_captured_bytes_without_network_and_excludes_secrets(tmp_path):
    state = source_state(tmp_path)
    artifacts = generate_preserved_site(state)
    with patch("requests.get", side_effect=AssertionError("Export must not re-download assets")):
        package = build_dynamic_site_package(state["job_id"], state["schema_proposal"], str(tmp_path / "out"), generated_artifacts=artifacts)
    with zipfile.ZipFile(package["zip_path"]) as archive:
        names = archive.namelist()
        assert "frontend/index.html" in names
        assert "frontend/src/main.jsx" in names
        assert not any("src/src" in name or name.endswith("/.env") or "node_modules" in name for name in names)
        assert archive.read("frontend/public" + asset_path("https://example.com/a/photo.png?size=1")) == b"unique-image-content"
        css = archive.read("frontend/public" + asset_path("https://example.com/css/style.css")).decode()
        assert asset_path("https://example.com/a/photo.png?size=1") in css
    environment_file = Path(package["project_dir"]) / "backend" / ".env"
    environment_file.write_text("ADMIN_PASSWORD=private-local-password")
    package = build_dynamic_site_package(state["job_id"], state["schema_proposal"], str(tmp_path / "out"), generated_artifacts=artifacts)
    assert environment_file.read_text() == "ADMIN_PASSWORD=private-local-password"
    with zipfile.ZipFile(package["zip_path"]) as archive:
        assert "backend/.env" not in archive.namelist()
        assert b"ADMIN_EMAIL=admin@gmail.com" in archive.read("backend/.env.example")
        assert "backend/src/environment.js" in archive.namelist()


def test_generated_paths_cannot_escape_project(tmp_path):
    state = source_state(tmp_path)
    artifacts = generate_preserved_site(state)
    artifacts["frontend"]["index_html"]["filename"] = "../outside.html"
    with pytest.raises(ValueError, match="Unsafe artifact path"):
        write_runtime_project(tmp_path / "out", artifacts, state["job_id"])
    assert not (tmp_path / "out" / "outside.html").exists()


def test_best_effort_packages_partial_files_with_report(tmp_path):
    artifacts = {"backend": {"files": [{"filename": "src/partial.js", "code": "console.log('partial');"},
                                     {"filename": "empty.js", "code": ""},
                                     {"filename": ".env", "code": "ADMIN_PASSWORD=private"}]},
                 "source_assets": [{"filename": "public/assets/gone.png", "source": str(tmp_path / "gone.png")}]}
    package = build_dynamic_site_package("partial", {}, str(tmp_path), generated_artifacts=artifacts,
                                         export_report={"build_status": "failed", "warnings": ["Build failed"]})
    with zipfile.ZipFile(package["zip_path"]) as archive:
        assert archive.testzip() is None
        assert "backend/src/partial.js" in archive.namelist()
        assert "backend/.env" not in archive.namelist()
        report = json.loads(archive.read("export-report.json"))
        assert report["build_status"] == "failed"
        assert "frontend/src/main.jsx" in report["missing_runtime_files"]
        assert any("Unavailable captured asset" in warning for warning in report["warnings"])
    artifacts["backend"]["files"].append({"filename": "../escape.txt", "code": "unsafe"})
    package = build_dynamic_site_package("partial", {}, str(tmp_path), generated_artifacts=artifacts, export_report={})
    with zipfile.ZipFile(package["zip_path"]) as archive:
        assert not any("escape.txt" in name for name in archive.namelist())
        assert any("Skipped unsafe generated path" in warning for warning in json.loads(archive.read("export-report.json"))["warnings"])
    assert not (tmp_path / "escape.txt").exists()


def test_legacy_entry_filename_is_canonical_and_unsafe_assets_are_excluded(tmp_path):
    artifacts = {"frontend": {"index_html": {"filename": "../index.html", "code": "<html><body>Saved entry</body></html>"}},
                 "source_assets": [{"filename": "../../outside.png", "source": str(tmp_path / "gone.png")}]}
    package = build_dynamic_site_package("legacy", {}, str(tmp_path), generated_artifacts=artifacts, export_report={})
    with zipfile.ZipFile(package["zip_path"]) as archive:
        assert archive.read("frontend/index.html") == b"<html><body>Saved entry</body></html>"
        assert not any("outside.png" in name for name in archive.namelist())
        assert any("Skipped unsafe captured asset path" in warning for warning in json.loads(archive.read("export-report.json"))["warnings"])


def test_missing_asset_is_reported_instead_of_silently_dropped(tmp_path):
    state = source_state(tmp_path)
    state["crawl_artifacts"]["assets"].pop()
    artifacts = generate_preserved_site(state)
    assert "https://example.com/css/style.css" in artifacts["source_report"]["missing_assets"]


def test_source_acceptance_is_exact_and_does_not_waive_capture_limits():
    artifacts = {"source_report": {"missing_assets": ["https://example.com/missing.js", "https://example.com/other.js"]}}
    captured = {
        "accepted_source_failures": ["https://example.com/missing.js", "https://example.com/broken"],
        "failures": [{"kind": "page", "url": "https://example.com/broken"},
                     {"kind": "page", "url": "https://example.com/another"}],
        "limits": {"max_pages_reached": True},
    }
    issues = _source_issues(artifacts, captured)
    assert {issue["url"] for issue in issues if issue["severity"] == "warning"} == set(captured["accepted_source_failures"])
    assert len([issue for issue in issues if issue["severity"] == "blocker"]) == 3
    captured["accepted_source_failures"] = []
    assert all(issue["severity"] == "blocker" for issue in _source_issues(artifacts, captured))


def test_source_acceptance_does_not_waive_runtime_failure():
    state = {
        "generated_artifacts": {"source_report": {"missing_assets": ["https://example.com/missing.js"]}},
        "crawl_artifacts": {"accepted_source_failures": ["https://example.com/missing.js"]},
    }
    with patch("src.engine.runtime_validation.write_runtime_project", side_effect=ValueError("Runtime build failed")):
        report = validate_runtime(state)["validation_report"]
    assert report["validation_gate"] == "blocked"
    assert report["deployment_ready"] is False
    assert any(issue["severity"] == "blocker" and issue["message"] == "Runtime build failed" for issue in report["issues"])


def test_export_records_accepted_source_failures(tmp_path):
    state = source_state(tmp_path)
    accepted = ["https://example.com/missing.js", "https://example.com/broken"]
    state["crawl_artifacts"].update({
        "accepted_source_failures": accepted,
        "failures": [{"kind": "page", "url": accepted[1], "error": "404 Not Found"}],
    })
    artifacts = generate_preserved_site(state)
    package = build_dynamic_site_package(state["job_id"], state["schema_proposal"], str(tmp_path / "out"), generated_artifacts=artifacts)
    with zipfile.ZipFile(package["zip_path"]) as archive:
        manifest = json.loads(archive.read("runtime-manifest.json"))
        assert manifest["source_report"]["accepted_source_failures"] == accepted
        assert manifest["source_report"]["failed_pages"][0]["url"] == accepted[1]
        assert all(url in archive.read("README.md").decode() for url in accepted)


def test_captured_internal_links_accept_www_and_https_aliases(tmp_path):
    state = source_state(tmp_path)
    state["crawled_page_map"]["https://example.com/"] += '<a href="http://www.example.com/contact#form">Contact alias</a>'
    artifacts = generate_preserved_site(state)
    seed = json.loads(next(file["code"] for file in artifacts["backend"]["files"] if file["filename"] == "seed-data.json"))
    assert "http://www.example.com/contact" not in seed["pages"][0]["html"]
    assert 'href="/contact#form"' in seed["pages"][0]["html"]


def test_multiple_inline_documents_have_distinct_routes(tmp_path):
    state = source_state(tmp_path)
    state["crawled_page_map"] = {"inline://page-1": "<h1>Home</h1>", "inline://page-2": "<h1>Next</h1>"}
    assert generate_preserved_site(state)["source_report"]["routes"] == ["/", "/page-2"]


def test_css_imports_nested_functions_and_fragments():
    css = '@import "theme.css"; a { background: image-set(url("a.png") 1x, url(b.png) 2x); filter:url(#mask) }'
    assert _extract_css_urls(css, "https://example.com/styles/base.css") == {
        "https://example.com/styles/theme.css", "https://example.com/styles/a.png", "https://example.com/styles/b.png"}
    rewritten = rewrite_css(css, lambda value: value if value.startswith("#") else "/local/" + value)
    assert '"/local/theme.css"' in rewritten and '/local/a.png' in rewritten and '#mask' in rewritten


def test_sitemap_indexes_are_followed_recursively():
    documents = {
        "https://example.com/robots.txt": "",
        "https://example.com/sitemap.xml": '<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>',
        "https://example.com/child.xml": '<urlset><url><loc>https://example.com/deep/page</loc></url></urlset>',
    }
    class Response:
        def __init__(self, text): self.text = text; self.content = text.encode()
    with patch("src.engine.nodes._fetch_with_retries", side_effect=lambda url, **kwargs: Response(documents[url])):
        urls, failures = _discover_sitemap_page_urls("https://example.com/", 10, 1, True, True, "example.com")
    assert urls == ["https://example.com/deep/page"]
    assert not failures


def test_all_pages_and_late_evidence_are_sent_to_inference():
    prompts = []
    class LLM:
        def invoke(self, prompt):
            prompts.append(prompt)
            return json.dumps({"entities": [{"name": "Service", "fields": [{"name": "title", "type": "string"}]}]})
    infer_all_pages(["<p>" + "x" * 25000 + "LAST_MARKER</p>"] * 4, LLM(), lambda pages: "\n".join(pages), json.loads)
    assert sum("LAST_MARKER" in prompt for prompt in prompts) == 1
    assert len(prompts) == 3
    assert all("Source pages 1, 2, 3, 4" in prompt for prompt in prompts)


def test_smoke_and_review_do_not_override_a_failed_build():
    state = {"backend_quality_score": 100, "frontend_quality_score": 100, "admin_quality_score": 100,
             "consistency_quality_score": 100, "overall_quality_score": 100,
             "validation_report": {"validation_gate": "blocked", "build_status": "failed"}}
    with patch("src.engine.nodes.validate_artifacts_node", return_value={**state, "status": "failed"}):
        assert validate_build_smoke_node(state)["status"] == "failed"
    assert validation_review_gate_node({**state, "validation_review_decision": "approved"})["status"] == "failed"
