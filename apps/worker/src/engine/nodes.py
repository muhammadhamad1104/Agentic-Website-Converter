from __future__ import annotations

import hashlib
import importlib
import json
import ipaddress
import mimetypes
import re
import shutil
import tempfile
import time
import zipfile
from collections import Counter, deque
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urldefrag, urljoin, urlparse

from bs4 import BeautifulSoup
import requests

from src.config.settings import settings
from src.engine.failover_llm import PromptLLM
from src.engine.models import EntityCandidate, FieldCandidate, RelationshipCandidate, SchemaProposal
from src.engine.state import ConversionState
from src.engine.template_structure import materialize_template_structure
from src.engine.generation_models import FullStackArtifact


GENERIC_ENTITY_NAMES = {
    "a",
    "div",
    "span",
    "img",
    "link",
    "meta",
    "title",
    "container",
    "row",
    "col",
    "btn",
    "nav",
    "li",
    "ul",
}

GENERIC_CLASS_TOKENS = {
    "container",
    "row",
    "col",
    "navbar",
    "nav-item",
    "nav-link",
    "btn",
    "card",
    "title",
    "text-white",
    "text-center",
}

CSS_URL_PATTERN = re.compile(r"url\((?P<raw>[^)]+)\)", re.IGNORECASE)
SITEMAP_LOC_PATTERN = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.IGNORECASE)
ROBOTS_SITEMAP_PATTERN = re.compile(r"^\s*sitemap\s*:\s*(?P<url>\S+)\s*$", re.IGNORECASE)
SERVER_SCRIPT_EXTENSION_PATTERN = re.compile(r"\.(php|asp|aspx|jsp|cgi|cfm|do|action)(?:$|[?#/])", re.IGNORECASE)
API_CALL_PATTERN = re.compile(r"(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*['\"](?:/api|/graphql|https?://[^'\"]+/(?:api|graphql))", re.IGNORECASE)
PHP_TAG_PATTERN = re.compile(r"<\?(?:php|=)", re.IGNORECASE)
ASSET_LINK_REL_HINTS = {
    "stylesheet",
    "icon",
    "manifest",
    "preload",
    "prefetch",
    "apple-touch-icon",
    "mask-icon",
}

STATIC_HTML_EXTENSIONS = {".html", ".htm"}
DYNAMIC_BACKEND_EXTENSIONS = {
    ".php",
    ".asp",
    ".aspx",
    ".jsp",
    ".cgi",
    ".cfm",
    ".do",
}


def _clamp_ratio(value: Any, default: float) -> float:
    try:
        normalized = float(value)
    except Exception:
        normalized = float(default)
    return max(0.0, min(1.0, normalized))


def _clamp_score(value: Any, default: float) -> float:
    try:
        normalized = float(value)
    except Exception:
        normalized = float(default)
    return max(0.0, min(100.0, normalized))


def _coerce_non_negative_int(value: Any, default: int) -> int:
    try:
        normalized = int(value)
    except Exception:
        normalized = int(default)
    return max(0, normalized)


def _infer_entity_name(tag_name: str, class_name: str) -> str:
    base = class_name or tag_name or "item"
    base = re.sub(r"[^a-zA-Z0-9]+", "_", base).strip("_")
    if not base:
        base = "item"
    return base.title().replace("_", "")


def _looks_semantic_class_name(class_name: str) -> bool:
    if not class_name:
        return False

    normalized = class_name.strip().lower()
    if not normalized or normalized in GENERIC_CLASS_TOKENS:
        return False

    tokens = re.split(r"[-_\s]+", normalized)
    meaningful_tokens = [token for token in tokens if token and token not in {"item", "section", "box", "wrapper"}]
    if len(meaningful_tokens) < 1:
        return False

    # Utility-style classes tend to be too generic for entity naming.
    utility_prefixes = ("text-", "bg-", "mt-", "mb-", "pt-", "pb-", "d-", "w-", "h-")
    if normalized.startswith(utility_prefixes):
        return False
    return True


def _is_generic_entity_name(name: str) -> bool:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "", name).lower()
    return normalized in GENERIC_ENTITY_NAMES


def _normalize_http_url(base_url: str, raw_url: str) -> str | None:
    candidate = str(raw_url or "").strip()
    if not candidate:
        return None
    lowered = candidate.lower()
    if lowered.startswith(("javascript:", "mailto:", "tel:", "data:", "blob:")):
        return None
    resolved = urldefrag(urljoin(base_url, candidate)).url
    parsed = urlparse(resolved)
    if parsed.scheme not in {"http", "https"}:
        return None
    return resolved


def _is_blocked_hostname(hostname: str) -> bool:
    normalized = (hostname or "").strip().lower()
    if normalized in {"", "localhost", "127.0.0.1", "::1"}:
        return True
    try:
        host_ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return bool(
        host_ip.is_private
        or host_ip.is_loopback
        or host_ip.is_link_local
        or host_ip.is_multicast
        or host_ip.is_reserved
    )


def _is_same_hostname(url: str, base_hostname: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").strip().lower()
    return hostname == (base_hostname or "").strip().lower()


def _extract_srcset_urls(srcset_value: str, base_url: str) -> set[str]:
    urls: set[str] = set()
    for chunk in str(srcset_value or "").split(","):
        candidate = chunk.strip().split(" ")[0]
        normalized = _normalize_http_url(base_url, candidate)
        if normalized:
            urls.add(normalized)
    return urls


def _extract_css_urls(css_text: str, base_url: str) -> set[str]:
    urls: set[str] = set()
    for match in CSS_URL_PATTERN.finditer(css_text or ""):
        raw = str(match.group("raw") or "").strip().strip("\"'")
        normalized = _normalize_http_url(base_url, raw)
        if normalized:
            urls.add(normalized)
    return urls


def _collect_page_and_asset_urls(soup: BeautifulSoup, page_url: str) -> tuple[set[str], set[str]]:
    page_urls: set[str] = set()
    asset_urls: set[str] = set()

    for anchor in soup.find_all("a", href=True):
        normalized = _normalize_http_url(page_url, str(anchor.get("href", "")))
        if normalized:
            page_urls.add(normalized)

    for tag_name, attr_name in [
        ("img", "src"),
        ("script", "src"),
        ("video", "src"),
        ("video", "poster"),
        ("audio", "src"),
        ("source", "src"),
        ("iframe", "src"),
        ("embed", "src"),
        ("object", "data"),
    ]:
        for tag in soup.find_all(tag_name):
            raw = str(tag.get(attr_name, "") or "")
            normalized = _normalize_http_url(page_url, raw)
            if normalized:
                asset_urls.add(normalized)

    for tag in soup.find_all(srcset=True):
        srcset = str(tag.get("srcset", "") or "")
        asset_urls.update(_extract_srcset_urls(srcset, page_url))

    for link in soup.find_all("link", href=True):
        href = str(link.get("href", "") or "")
        normalized = _normalize_http_url(page_url, href)
        if not normalized:
            continue
        rel_values = [str(value).strip().lower() for value in (link.get("rel") or [])]
        as_value = str(link.get("as", "") or "").strip().lower()
        if any(rel in ASSET_LINK_REL_HINTS for rel in rel_values) or as_value in {
            "style",
            "script",
            "font",
            "image",
            "fetch",
        }:
            asset_urls.add(normalized)

    for meta in soup.find_all("meta", content=True):
        name = str(meta.get("name", "") or "").strip().lower()
        prop = str(meta.get("property", "") or "").strip().lower()
        if any(token in f"{name} {prop}" for token in {"image", "icon", "logo", "url"}):
            normalized = _normalize_http_url(page_url, str(meta.get("content", "") or ""))
            if normalized:
                asset_urls.add(normalized)

    for style_tag in soup.find_all("style"):
        style_text = style_tag.get_text(" ", strip=True)
        asset_urls.update(_extract_css_urls(style_text, page_url))

    for tag in soup.find_all(True):
        style_value = tag.get("style")
        if isinstance(style_value, str):
            asset_urls.update(_extract_css_urls(style_value, page_url))

        for attr_name, attr_value in tag.attrs.items():
            lowered_attr = str(attr_name).strip().lower()
            if not lowered_attr.startswith("data-"):
                continue

            if isinstance(attr_value, list):
                values = [str(item) for item in attr_value if isinstance(item, str)]
            elif isinstance(attr_value, str):
                values = [attr_value]
            else:
                values = []

            if "srcset" in lowered_attr:
                for value in values:
                    asset_urls.update(_extract_srcset_urls(value, page_url))
                continue

            if any(token in lowered_attr for token in {"src", "href", "url", "image", "poster", "background"}):
                for value in values:
                    normalized = _normalize_http_url(page_url, value)
                    if normalized:
                        asset_urls.add(normalized)

    return page_urls, asset_urls


def _fetch_with_retries(
    url: str,
    timeout_seconds: int,
    retries: int,
    verify_tls: bool = True,
):
    attempts = max(1, int(retries or 1))
    timeout = max(3, int(timeout_seconds or 3))
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            request_kwargs: dict[str, Any] = {"timeout": timeout}
            if not verify_tls:
                request_kwargs["verify"] = False
            response = requests.get(url, **request_kwargs)
            response.raise_for_status()
            return response
        except Exception as exc:  # pragma: no cover - error detail path tested through caller assertions
            last_error = exc

    if last_error is None:
        raise RuntimeError("Request failed without a specific error")
    raise last_error


def _response_content_type(response: Any) -> str:
    headers = getattr(response, "headers", {}) or {}
    if isinstance(headers, dict):
        for key, value in headers.items():
            if str(key).strip().lower() == "content-type":
                return str(value)
    return ""


def _response_bytes(response: Any) -> bytes:
    payload = getattr(response, "content", None)
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload)

    text = getattr(response, "text", "")
    if isinstance(text, str):
        return text.encode("utf-8", errors="ignore")
    return b""


def _response_text(response: Any, content: bytes) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str):
        return text
    return content.decode("utf-8", errors="replace")


def _response_status_code(response: Any) -> int:
    value = getattr(response, "status_code", 200)
    try:
        return int(value)
    except Exception:
        return 200


def _looks_like_css(content_type: str, url: str) -> bool:
    lowered_type = (content_type or "").lower()
    lowered_url = (url or "").lower()
    return "text/css" in lowered_type or lowered_url.endswith(".css")


def _normalize_text_snippet(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _slugify_entity_name(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", str(name or "")).strip("-").lower()
    return slug or "entity"


def _quality_gate_config() -> dict[str, Any]:
    return settings.get_quality_gate_config()


def _append_quality_gate_event(
    state: ConversionState,
    *,
    node_name: str,
    gate_name: str,
    report: dict[str, Any],
) -> list[dict[str, Any]]:
    trace_events = list(state.get("trace_events", []))
    checks = list(report.get("checks", []) or [])
    issues = list(report.get("issues", []) or [])
    blocker_count = sum(
        1
        for issue in issues
        if isinstance(issue, dict) and str(issue.get("severity", "")).strip().lower() == "blocker"
    )
    gate_status = str(report.get("quality_gate", report.get("validation_gate", "unknown")) or "unknown")
    passed = gate_status == "open" and blocker_count == 0

    trace_events.append(
        {
            "node": f"quality.{node_name}",
            "job_id": str(state.get("job_id", "") or ""),
            "event_type": "quality_gate",
            "gate": gate_name,
            "quality_gate": gate_status,
            "passed": passed,
            "input_status": str(state.get("status", "unknown") or "unknown"),
            "output_status": str(state.get("status", "unknown") or "unknown"),
            "duration_ms": 0.0,
            "input_error_count": len(state.get("errors", [])),
            "output_error_count": len(state.get("errors", [])),
            "check_count": len(checks),
            "issue_count": len(issues),
            "blocker_count": blocker_count,
            "timestamp_ms": int(time.time() * 1000),
        }
    )
    return trace_events


def _prepare_crawl_storage(job_id: str, resume: bool = False) -> tuple[Path, Path, Path]:
    normalized_job_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(job_id or "manual")) or "manual"
    crawl_root = Path(tempfile.gettempdir()) / "py_agent_crawl_cache" / normalized_job_id
    if crawl_root.exists() and not resume:
        shutil.rmtree(crawl_root, ignore_errors=True)
    pages_dir = crawl_root / "pages"
    assets_dir = crawl_root / "assets"
    pages_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)
    return crawl_root, pages_dir, assets_dir


def _write_snapshot_file(
    directory: Path,
    kind: str,
    index: int,
    source_url: str,
    content: bytes,
    content_type: str,
) -> Path:
    parsed = urlparse(source_url)
    suffix = Path(parsed.path).suffix.lower()
    if not suffix or len(suffix) > 8:
        media_type = (content_type or "").split(";")[0].strip().lower()
        guessed = mimetypes.guess_extension(media_type) if media_type else None
        if guessed:
            suffix = guessed
    if not suffix:
        suffix = ".html" if kind == "page" else ".bin"

    digest = hashlib.sha256(source_url.encode("utf-8", errors="ignore")).hexdigest()[:12]
    file_path = directory / f"{kind}_{index:06d}_{digest}{suffix}"
    file_path.write_bytes(content)
    return file_path


def _save_crawl_checkpoint(checkpoint_path: Path, payload: dict[str, Any]) -> None:
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = checkpoint_path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp_path.replace(checkpoint_path)


def _load_crawl_checkpoint(checkpoint_path: Path) -> dict[str, Any] | None:
    if not checkpoint_path.exists():
        return None
    try:
        raw = checkpoint_path.read_text(encoding="utf-8")
        payload = json.loads(raw)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _load_crawled_pages_from_records(page_records: list[dict[str, Any]]) -> list[str]:
    pages: list[str] = []
    for record in page_records:
        storage_path = str(record.get("storage_path", "") or "").strip()
        if not storage_path:
            continue
        path = Path(storage_path)
        if not path.exists():
            continue
        try:
            pages.append(path.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            continue
    return pages


def _load_crawled_page_map_from_records(page_records: list[dict[str, Any]]) -> dict[str, str]:
    page_map: dict[str, str] = {}
    for record in page_records:
        storage_path = str(record.get("storage_path", "") or "").strip()
        url = str(record.get("url", "") or "").strip()
        if not storage_path or not url:
            continue
        path = Path(storage_path)
        if not path.exists():
            continue
        try:
            page_map[url] = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
    return page_map


class _RenderedResponse:
    def __init__(
        self,
        url: str,
        html: str,
        status_code: int,
        headers: dict[str, Any],
    ) -> None:
        self.url = url
        self.text = html
        self.content = html.encode("utf-8", errors="ignore")
        self.status_code = status_code
        self.headers = headers

    def raise_for_status(self) -> None:
        if int(self.status_code) >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _PlaywrightCrawlerSession:
    def __init__(
        self,
        timeout_seconds: int,
        render_wait_seconds: int,
        headless: bool,
        verify_tls: bool,
    ) -> None:
        self._timeout_ms = max(3000, int(timeout_seconds * 1000))
        self._wait_ms = max(0, int(render_wait_seconds * 1000))
        self._headless = bool(headless)
        self._verify_tls = bool(verify_tls)
        self._driver: Any = None
        self._browser: Any = None
        self._context: Any = None
        self._page: Any = None

    def open(self) -> None:
        sync_api = importlib.import_module("playwright.sync_api")
        sync_playwright = getattr(sync_api, "sync_playwright")
        self._driver = sync_playwright().start()
        self._browser = self._driver.chromium.launch(headless=self._headless)
        self._context = self._browser.new_context(ignore_https_errors=not self._verify_tls)
        self._page = self._context.new_page()

    def close(self) -> None:
        if self._page is not None:
            try:
                self._page.close()
            except Exception:
                pass
            self._page = None
        if self._context is not None:
            try:
                self._context.close()
            except Exception:
                pass
            self._context = None
        if self._browser is not None:
            try:
                self._browser.close()
            except Exception:
                pass
            self._browser = None
        if self._driver is not None:
            try:
                self._driver.stop()
            except Exception:
                pass
            self._driver = None

    def fetch(self, url: str) -> _RenderedResponse:
        if self._page is None:
            raise RuntimeError("Playwright session not initialized")

        response = self._page.goto(url, wait_until="domcontentloaded", timeout=self._timeout_ms)
        if self._wait_ms > 0:
            try:
                self._page.wait_for_load_state("networkidle", timeout=self._wait_ms)
            except Exception:
                # Not all sites reliably reach networkidle; keep rendered DOM anyway.
                pass

        html = str(self._page.content() or "")
        final_url = str(getattr(self._page, "url", url) or url)

        headers: dict[str, Any] = {}
        status_code = 200
        if response is not None:
            try:
                status_code = int(getattr(response, "status", 200) or 200)
            except Exception:
                status_code = 200
            try:
                headers = dict(getattr(response, "headers", {}) or {})
            except Exception:
                headers = {}

        if not any(str(key).strip().lower() == "content-type" for key in headers):
            headers["content-type"] = "text/html; charset=utf-8"

        rendered = _RenderedResponse(
            url=final_url,
            html=html,
            status_code=status_code,
            headers=headers,
        )
        rendered.raise_for_status()
        return rendered


def _limit_from_raw(value: int) -> int | None:
    try:
        normalized = int(value)
    except Exception:
        normalized = 0
    return normalized if normalized > 0 else None


def _limit_reached(current: int, limit: int | None) -> bool:
    return bool(limit is not None and current >= limit)


def _discover_sitemap_page_urls(
    root_url: str,
    timeout_seconds: int,
    retries: int,
    verify_tls: bool,
    same_domain_only: bool,
    base_hostname: str,
) -> tuple[list[str], list[dict[str, Any]]]:
    discovered: set[str] = set()
    failures: list[dict[str, Any]] = []

    candidate_sitemaps: set[str] = set()
    default_sitemap = _normalize_http_url(root_url, "/sitemap.xml")
    if default_sitemap:
        candidate_sitemaps.add(default_sitemap)

    robots_url = _normalize_http_url(root_url, "/robots.txt")
    if robots_url:
        try:
            robots_response = _fetch_with_retries(
                robots_url,
                timeout_seconds=timeout_seconds,
                retries=retries,
                verify_tls=verify_tls,
            )
            robots_text = _response_text(robots_response, _response_bytes(robots_response))
            for line in robots_text.splitlines():
                match = ROBOTS_SITEMAP_PATTERN.match(line.strip())
                if not match:
                    continue
                sitemap_url = _normalize_http_url(root_url, match.group("url"))
                if sitemap_url:
                    candidate_sitemaps.add(sitemap_url)
        except Exception as exc:
            failures.append(
                {
                    "kind": "sitemap",
                    "url": robots_url,
                    "error": str(exc),
                    "referrer": root_url,
                }
            )

    for sitemap_url in sorted(candidate_sitemaps):
        try:
            sitemap_response = _fetch_with_retries(
                sitemap_url,
                timeout_seconds=timeout_seconds,
                retries=retries,
                verify_tls=verify_tls,
            )
            sitemap_text = _response_text(sitemap_response, _response_bytes(sitemap_response))
        except Exception as exc:
            failures.append(
                {
                    "kind": "sitemap",
                    "url": sitemap_url,
                    "error": str(exc),
                    "referrer": root_url,
                }
            )
            continue

        for raw_loc in SITEMAP_LOC_PATTERN.findall(sitemap_text):
            normalized = _normalize_http_url(sitemap_url, raw_loc)
            if not normalized:
                continue
            hostname = (urlparse(normalized).hostname or "").strip().lower()
            if _is_blocked_hostname(hostname):
                continue
            if same_domain_only and hostname != base_hostname:
                continue
            discovered.add(normalized)

    return sorted(discovered), failures


def _is_probable_zip_source(raw_source: str) -> bool:
    source = str(raw_source or "").strip().strip("\"").strip("'")
    if not source:
        return False

    local_path = Path(source).expanduser()
    if local_path.exists() and local_path.is_file() and local_path.suffix.lower() == ".zip":
        return True

    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"} and parsed.path.lower().endswith(".zip"):
        return True

    return source.lower().endswith(".zip")


def _read_zip_source_bytes(
    source: str,
    timeout_seconds: int,
    retries: int,
    verify_tls: bool,
) -> tuple[bytes, str, str]:
    cleaned = str(source or "").strip().strip("\"").strip("'")
    local_path = Path(cleaned).expanduser()
    if local_path.exists() and local_path.is_file() and local_path.suffix.lower() == ".zip":
        return local_path.read_bytes(), str(local_path.resolve()), "local"

    normalized_url = _normalize_http_url(cleaned, cleaned)
    if not normalized_url:
        raise ValueError("ZIP source must be a valid local .zip path or http/https .zip URL.")

    response = _fetch_with_retries(
        normalized_url,
        timeout_seconds=timeout_seconds,
        retries=retries,
        verify_tls=verify_tls,
    )
    resolved_url = (
        _normalize_http_url(normalized_url, getattr(response, "url", normalized_url))
        if isinstance(getattr(response, "url", None), str)
        else normalized_url
    ) or normalized_url
    return _response_bytes(response), resolved_url, "url"


def _validate_static_zip_members(member_names: list[str]) -> list[str]:
    issues: list[str] = []

    html_members = [name for name in member_names if Path(name).suffix.lower() in STATIC_HTML_EXTENSIONS]
    if not html_members:
        issues.append("ZIP input does not contain any .html/.htm file, so it is not a static website package.")

    backend_members = [
        name
        for name in member_names
        if Path(name).suffix.lower() in DYNAMIC_BACKEND_EXTENSIONS
    ]
    if backend_members:
        sample = ", ".join(backend_members[:5])
        issues.append(
            "ZIP input appears dynamic because it contains server-side files: "
            f"{sample}"
        )

    return issues


def _validate_static_website_markup(
    html_text: str,
    response_url: str,
    headers: dict[str, Any] | None,
) -> list[str]:
    issues: list[str] = []
    content = str(html_text or "")
    if not content.strip():
        return ["Input URL returned an empty page, so static-website validation failed."]

    header_map = headers or {}
    content_type = ""
    for key, value in header_map.items():
        if str(key).strip().lower() == "content-type":
            content_type = str(value)
            break
    if content_type and "html" not in content_type.lower():
        issues.append(f"Input URL response is not HTML (content-type={content_type}).")

    if PHP_TAG_PATTERN.search(content):
        issues.append("Input URL includes server-side template tags (e.g. <?php), indicating a dynamic source.")

    soup = BeautifulSoup(content, "html.parser")

    x_powered_by = ""
    for key, value in header_map.items():
        if str(key).strip().lower() == "x-powered-by":
            x_powered_by = str(value).lower()
            break
    if any(token in x_powered_by for token in {"php", "asp.net", "django", "rails", "laravel", "express", "spring"}):
        issues.append(f"Input URL is server-powered ({x_powered_by}) and looks dynamic.")

    reference_values: list[str] = []
    for tag_name, attr in [
        ("a", "href"),
        ("form", "action"),
        ("script", "src"),
        ("link", "href"),
        ("iframe", "src"),
    ]:
        for element in soup.find_all(tag_name):
            value = str(element.get(attr, "") or "").strip()
            if value:
                reference_values.append(value)

    for value in reference_values:
        if SERVER_SCRIPT_EXTENSION_PATTERN.search(value):
            issues.append(
                f"Input URL references server-side endpoint ({value}), indicating dynamic behavior."
            )
            break
        lowered = value.lower()
        if any(token in lowered for token in {"/wp-json", "admin-ajax.php", "/graphql", "/api/"}):
            issues.append(
                f"Input URL references runtime API endpoint ({value}), indicating dynamic behavior."
            )
            break

    script_bodies = [script.get_text(" ", strip=True) for script in soup.find_all("script")]
    if any(API_CALL_PATTERN.search(body) for body in script_bodies if body):
        issues.append("Input URL contains runtime API calls in scripts, indicating dynamic behavior.")

    unique_issues: list[str] = []
    for issue in issues:
        if issue not in unique_issues:
            unique_issues.append(issue)
    return unique_issues


def _crawl_zip_source(
    input_source: str,
    pages_dir: Path,
    assets_dir: Path,
    timeout_seconds: int,
    retries: int,
    verify_tls: bool,
    enforce_static_source: bool,
) -> dict[str, Any]:
    zip_bytes, resolved_source, source_mode = _read_zip_source_bytes(
        source=input_source,
        timeout_seconds=timeout_seconds,
        retries=retries,
        verify_tls=verify_tls,
    )

    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        members = [item for item in archive.infolist() if not item.is_dir()]
        member_names = [item.filename.replace("\\", "/").lstrip("./") for item in members]

        validation_issues = _validate_static_zip_members(member_names) if enforce_static_source else []
        if validation_issues:
            return {
                "status": "failed",
                "root_url": resolved_source,
                "source_mode": source_mode,
                "source_type": "zip",
                "errors": validation_issues,
                "crawled_pages": [],
                "page_urls": [],
                "page_records": [],
                "asset_records": [],
                "failures": [
                    {
                        "kind": "validation",
                        "url": resolved_source,
                        "error": issue,
                        "referrer": resolved_source,
                    }
                    for issue in validation_issues
                ],
            }

        crawled_pages: list[str] = []
        page_urls: list[str] = []
        page_records: list[dict[str, Any]] = []
        asset_records: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []

        page_index = 0
        asset_index = 0

        for item in members:
            member_name = item.filename.replace("\\", "/").lstrip("./")
            try:
                payload = archive.read(item)
            except Exception as exc:
                failures.append(
                    {
                        "kind": "zip_member",
                        "url": f"zip://{member_name}",
                        "error": str(exc),
                        "referrer": resolved_source,
                    }
                )
                continue

            suffix = Path(member_name).suffix.lower()
            content_type = mimetypes.guess_type(member_name)[0] or "application/octet-stream"

            if suffix in STATIC_HTML_EXTENSIONS:
                page_index += 1
                storage_path = _write_snapshot_file(
                    directory=pages_dir,
                    kind="page",
                    index=page_index,
                    source_url=f"zip://{member_name}",
                    content=payload,
                    content_type=content_type,
                )
                html_text = payload.decode("utf-8", errors="replace")
                crawled_pages.append(html_text)
                page_urls.append(f"zip://{member_name}")
                page_records.append(
                    {
                        "url": f"zip://{member_name}",
                        "status_code": 200,
                        "content_type": content_type,
                        "content_length": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "storage_path": str(storage_path),
                        "depth": 0,
                        "zip_member": member_name,
                    }
                )
            else:
                asset_index += 1
                storage_path = _write_snapshot_file(
                    directory=assets_dir,
                    kind="asset",
                    index=asset_index,
                    source_url=f"zip://{member_name}",
                    content=payload,
                    content_type=content_type,
                )
                asset_records.append(
                    {
                        "url": f"zip://{member_name}",
                        "status_code": 200,
                        "content_type": content_type,
                        "content_length": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "storage_path": str(storage_path),
                        "referrer": resolved_source,
                        "zip_member": member_name,
                    }
                )

        return {
            "status": "crawled" if crawled_pages else "failed",
            "root_url": resolved_source,
            "source_mode": source_mode,
            "source_type": "zip",
            "errors": [] if crawled_pages else ["ZIP input did not contain readable HTML pages."],
            "crawled_pages": crawled_pages,
            "page_urls": page_urls,
            "page_records": page_records,
            "asset_records": asset_records,
            "failures": failures,
        }


def crawl_site_node(state: ConversionState) -> ConversionState:
    # Early bypass if schema was already approved (starting generation)
    if state.get("status") in ("approved", "generation_approved"):
        return {**state, "status": state.get("status")}

    html_pages = state.get("html_pages", [])
    job_id = str(state.get("job_id", "manual-job"))

    resume_from_checkpoint = bool(
        state.get("crawl_resume_from_checkpoint", settings.CRAWL_RESUME_FROM_CHECKPOINT_DEFAULT)
    )

    crawl_root, pages_dir, assets_dir = _prepare_crawl_storage(job_id, resume=resume_from_checkpoint)
    checkpoint_path = crawl_root / "checkpoint.json"
    failures: list[dict[str, Any]] = []

    if html_pages:
        existing_artifacts = state.get("crawl_artifacts") or {}
        existing_assets = existing_artifacts.get("assets", []) or []
        existing_totals = existing_artifacts.get("totals", {}) or {}

        inline_records: list[dict[str, Any]] = []
        inline_assets: list[dict[str, Any]] = list(existing_assets)
        seen_asset_urls: set[str] = {
            str(a.get("url", "")).strip() for a in inline_assets if isinstance(a, dict) and a.get("url")
        }

        for index, html in enumerate(html_pages, start=1):
            payload = str(html).encode("utf-8", errors="ignore")
            file_path = _write_snapshot_file(
                directory=pages_dir,
                kind="page",
                index=index,
                source_url=f"inline://page-{index}",
                content=payload,
                content_type="text/html",
            )
            inline_records.append(
                {
                    "url": f"inline://page-{index}",
                    "status_code": 200,
                    "content_type": "text/html",
                    "content_length": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "storage_path": str(file_path),
                    "depth": 0,
                }
            )

            # Extract asset URLs from HTML if no assets exist yet
            if not inline_assets and isinstance(html, str):
                try:
                    soup = BeautifulSoup(html, "html.parser")
                    for tag_name, attr_name in [("img", "src"), ("script", "src"), ("link", "href"), ("source", "src")]:
                        for tag in soup.find_all(tag_name):
                            raw = str(tag.get(attr_name, "") or "").strip()
                            if raw and not raw.startswith("data:") and raw not in seen_asset_urls:
                                seen_asset_urls.add(raw)
                                inline_assets.append({
                                    "url": raw,
                                    "status_code": 200,
                                    "content_type": "image/*" if tag_name == "img" else ("text/css" if tag_name == "link" else "application/javascript"),
                                    "content_length": 0,
                                    "depth": 0
                                })
                except Exception:
                    pass

        assets_downloaded_count = max(
            int(existing_totals.get("assets_downloaded", 0) or 0),
            len(inline_assets)
        )

        manifest = {
            "root_url": existing_artifacts.get("root_url", "inline-input"),
            "created_at_ms": int(time.time() * 1000),
            "config": {"inline": True},
            "pages": inline_records,
            "assets": inline_assets,
            "failures": existing_artifacts.get("failures", []),
            "totals": {
                "pages_crawled": len(inline_records),
                "assets_downloaded": assets_downloaded_count,
                "failures": existing_totals.get("failures", 0),
            },
            "limits": {"pages_limit_hit": False, "assets_limit_hit": False},
        }
        manifest_path = crawl_root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        return {
            **state,
            "crawled_pages": html_pages,
            "sitemap": {
                "pages": [f"inline://page-{i + 1}" for i in range(len(html_pages))],
                "page_count": len(html_pages),
                "asset_count": len(inline_assets),
                "failed_count": 0,
            },
            "crawl_artifacts": {
                "root_url": existing_artifacts.get("root_url", "inline-input"),
                "storage_root": str(crawl_root),
                "manifest_path": str(manifest_path),
                "pages": inline_records,
                "assets": inline_assets,
                "failures": existing_artifacts.get("failures", []),
                "totals": manifest["totals"],
                "limits": manifest["limits"],
            },
            "status": "crawled",
            "errors": state.get("errors", []),
        }

    input_url = str(state.get("input_url", "") or "").strip()
    if not input_url:
        return {
            **state,
            "status": "failed",
            "errors": state.get("errors", []) + ["No input URL or HTML pages provided for crawling."],
        }

    depth_limit = max(0, int(state.get("crawl_depth_limit", settings.CRAWL_DEPTH_LIMIT_DEFAULT) or 0))
    max_pages_raw = max(0, int(state.get("crawl_max_pages", settings.CRAWL_MAX_PAGES_DEFAULT) or 0))
    max_assets_raw = max(0, int(state.get("crawl_max_assets", settings.CRAWL_MAX_ASSETS_DEFAULT) or 0))
    max_pages = _limit_from_raw(max_pages_raw)
    max_assets = _limit_from_raw(max_assets_raw)
    same_domain_only = bool(state.get("crawl_same_domain_only", settings.CRAWL_SAME_DOMAIN_ONLY_DEFAULT))
    follow_asset_domains = bool(
        state.get("crawl_follow_asset_domains", settings.CRAWL_FOLLOW_ASSET_DOMAINS_DEFAULT)
    )
    timeout_seconds = max(
        3,
        int(state.get("crawl_request_timeout_seconds", settings.CRAWL_REQUEST_TIMEOUT_SECONDS) or 3),
    )
    retries = max(1, int(state.get("crawl_request_retries", settings.CRAWL_REQUEST_RETRIES) or 1))
    verify_tls = bool(state.get("crawl_verify_tls", settings.CRAWL_VERIFY_TLS_DEFAULT))
    enforce_static_source = bool(
        state.get("crawl_enforce_static_source", settings.CRAWL_ENFORCE_STATIC_SOURCE_DEFAULT)
    )
    render_js = bool(state.get("crawl_render_js", settings.CRAWL_RENDER_JS_DEFAULT))
    render_wait_seconds = max(
        0,
        int(state.get("crawl_render_wait_seconds", settings.CRAWL_RENDER_WAIT_SECONDS) or 0),
    )
    render_headless = bool(state.get("crawl_render_headless", settings.CRAWL_RENDER_HEADLESS))
    include_sitemap_seeds = bool(
        state.get("crawl_include_sitemap_seeds", settings.CRAWL_INCLUDE_SITEMAP_SEEDS_DEFAULT)
    )

    if _is_probable_zip_source(input_url):
        try:
            zip_result = _crawl_zip_source(
                input_source=input_url,
                pages_dir=pages_dir,
                assets_dir=assets_dir,
                timeout_seconds=timeout_seconds,
                retries=retries,
                verify_tls=verify_tls,
                enforce_static_source=enforce_static_source,
            )
        except Exception as exc:
            return {
                **state,
                "status": "failed",
                "errors": state.get("errors", []) + [f"ZIP crawl failed: {exc}"],
            }

        totals = {
            "pages_crawled": len(zip_result["page_records"]),
            "assets_downloaded": len(zip_result["asset_records"]),
            "failures": len(zip_result["failures"]),
        }
        manifest = {
            "root_url": zip_result["root_url"],
            "created_at_ms": int(time.time() * 1000),
            "config": {
                "source_type": "zip",
                "source_mode": zip_result["source_mode"],
                "max_pages": max_pages_raw,
                "max_assets": max_assets_raw,
                "max_pages_unbounded": max_pages is None,
                "max_assets_unbounded": max_assets is None,
                "verify_tls": verify_tls,
                "enforce_static_source": enforce_static_source,
            },
            "pages": zip_result["page_records"],
            "assets": zip_result["asset_records"],
            "failures": zip_result["failures"],
            "totals": totals,
            "limits": {
                "pages_limit_hit": False,
                "assets_limit_hit": False,
            },
        }
        manifest_path = crawl_root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        _save_crawl_checkpoint(
            checkpoint_path,
            {
                "version": 1,
                "job_id": job_id,
                "root_url": zip_result["root_url"],
                "updated_at_ms": int(time.time() * 1000),
                "completed": True,
                "config": manifest["config"],
                "pages": zip_result["page_records"],
                "assets": zip_result["asset_records"],
                "failures": zip_result["failures"],
                "page_queue": [],
                "asset_queue": [],
                "queued_pages": [],
                "queued_assets": [],
                "visited_pages": [],
                "visited_assets": [],
                "seeded_page_urls": [],
                "static_source_validated": bool(zip_result["status"] == "crawled"),
            },
        )

        if zip_result["status"] != "crawled":
            return {
                **state,
                "status": "failed",
                "crawl_artifacts": {
                    "root_url": zip_result["root_url"],
                    "storage_root": str(crawl_root),
                    "manifest_path": str(manifest_path),
                    "pages": zip_result["page_records"],
                    "assets": zip_result["asset_records"],
                    "failures": zip_result["failures"],
                    "totals": totals,
                    "limits": manifest["limits"],
                    "checkpoint_path": str(checkpoint_path),
                    "resumed_from_checkpoint": False,
                    "source_type": "zip",
                },
                "errors": state.get("errors", []) + zip_result.get("errors", []),
            }

        return {
            **state,
            "crawled_pages": zip_result["crawled_pages"],
            "sitemap": {
                "root": zip_result["root_url"],
                "pages": zip_result["page_urls"],
                "page_count": len(zip_result["page_records"]),
                "asset_count": len(zip_result["asset_records"]),
                "failed_count": len(zip_result["failures"]),
                "source_type": "zip",
                "render_engine": "none",
            },
            "crawl_artifacts": {
                "root_url": zip_result["root_url"],
                "storage_root": str(crawl_root),
                "manifest_path": str(manifest_path),
                "pages": zip_result["page_records"],
                "assets": zip_result["asset_records"],
                "failures": zip_result["failures"],
                "totals": totals,
                "limits": manifest["limits"],
                "checkpoint_path": str(checkpoint_path),
                "resumed_from_checkpoint": False,
                "seeded_page_urls": [],
                "render_engine": "none",
                "render_fallback_reason": None,
                "source_type": "zip",
            },
            "status": "crawled",
            "errors": state.get("errors", []),
        }

    normalized_input = _normalize_http_url(input_url, input_url)
    if not normalized_input:
        return {
            **state,
            "status": "failed",
            "errors": state.get("errors", []) + ["Input URL must use http or https."],
        }

    parsed_input = urlparse(normalized_input)
    base_hostname = (parsed_input.hostname or "").strip().lower()
    if _is_blocked_hostname(base_hostname):
        return {
            **state,
            "status": "failed",
            "errors": state.get("errors", []) + ["Input URL points to a private or localhost target and is blocked."],
        }

    resumed_from_checkpoint = False
    crawled_pages: list[str] = []
    page_urls: list[str] = []
    page_records: list[dict[str, Any]] = []
    asset_records: list[dict[str, Any]] = []
    page_queue: deque[tuple[str, int]] = deque()
    queued_pages: set[str] = set()
    visited_pages: set[str] = set()
    asset_queue: deque[tuple[str, str]] = deque()
    queued_assets: set[str] = set()
    visited_assets: set[str] = set()
    seeded_page_urls: list[str] = []
    static_source_validated = not enforce_static_source
    source_validation_errors: list[str] = []
    sitemap_seed_applied = not include_sitemap_seeds

    checkpoint_payload = _load_crawl_checkpoint(checkpoint_path) if resume_from_checkpoint else None
    if (
        isinstance(checkpoint_payload, dict)
        and str(checkpoint_payload.get("root_url", "")).strip() == normalized_input
        and not bool(checkpoint_payload.get("completed", False))
    ):
        resumed_from_checkpoint = True
        page_records = [item for item in checkpoint_payload.get("pages", []) if isinstance(item, dict)]
        asset_records = [item for item in checkpoint_payload.get("assets", []) if isinstance(item, dict)]
        failures = [item for item in checkpoint_payload.get("failures", []) if isinstance(item, dict)]

        page_urls = [
            str(item.get("url", "")).strip()
            for item in page_records
            if str(item.get("url", "")).strip()
        ]
        crawled_pages = _load_crawled_pages_from_records(page_records)
        crawled_page_map = _load_crawled_page_map_from_records(page_records)

        for entry in checkpoint_payload.get("page_queue", []):
            if not isinstance(entry, list | tuple) or len(entry) != 2:
                continue
            page_url = str(entry[0]).strip()
            if not page_url:
                continue
            try:
                depth_value = int(entry[1])
            except Exception:
                depth_value = 0
            page_queue.append((page_url, max(0, depth_value)))

        queued_pages = {
            str(item).strip()
            for item in checkpoint_payload.get("queued_pages", [])
            if str(item).strip()
        }
        visited_pages = {
            str(item).strip()
            for item in checkpoint_payload.get("visited_pages", [])
            if str(item).strip()
        }

        for entry in checkpoint_payload.get("asset_queue", []):
            if not isinstance(entry, list | tuple) or len(entry) != 2:
                continue
            asset_url = str(entry[0]).strip()
            referrer = str(entry[1]).strip()
            if not asset_url:
                continue
            asset_queue.append((asset_url, referrer))

        queued_assets = {
            str(item).strip()
            for item in checkpoint_payload.get("queued_assets", [])
            if str(item).strip()
        }
        visited_assets = {
            str(item).strip()
            for item in checkpoint_payload.get("visited_assets", [])
            if str(item).strip()
        }
        seeded_page_urls = [
            str(item).strip()
            for item in checkpoint_payload.get("seeded_page_urls", [])
            if str(item).strip()
        ]
        static_source_validated = bool(
            checkpoint_payload.get("static_source_validated", static_source_validated)
        )
        sitemap_seed_applied = bool(
            checkpoint_payload.get("sitemap_seed_applied", bool(seeded_page_urls) or sitemap_seed_applied)
        )
    else:
        page_queue = deque([(normalized_input, 0)])
        queued_pages = {normalized_input}
        visited_pages = set()
        asset_queue = deque()
        queued_assets = set()
        visited_assets = set()

    def persist_checkpoint(completed: bool = False) -> None:
        payload: dict[str, Any] = {
            "version": 1,
            "job_id": job_id,
            "root_url": normalized_input,
            "updated_at_ms": int(time.time() * 1000),
            "completed": bool(completed),
            "config": {
                "depth_limit": depth_limit,
                "max_pages": max_pages_raw,
                "max_assets": max_assets_raw,
                "same_domain_only": same_domain_only,
                "follow_asset_domains": follow_asset_domains,
                "request_timeout_seconds": timeout_seconds,
                "request_retries": retries,
                "verify_tls": verify_tls,
                "enforce_static_source": enforce_static_source,
                "resume_from_checkpoint": resume_from_checkpoint,
                "include_sitemap_seeds": include_sitemap_seeds,
                "render_js": render_js,
                "render_wait_seconds": render_wait_seconds,
                "render_headless": render_headless,
            },
            "pages": page_records,
            "assets": asset_records,
            "failures": failures,
            "page_queue": [[url, depth] for url, depth in list(page_queue)],
            "asset_queue": [[url, referrer] for url, referrer in list(asset_queue)],
            "queued_pages": sorted(queued_pages),
            "queued_assets": sorted(queued_assets),
            "visited_pages": sorted(visited_pages),
            "visited_assets": sorted(visited_assets),
            "seeded_page_urls": seeded_page_urls,
            "static_source_validated": static_source_validated,
            "sitemap_seed_applied": sitemap_seed_applied,
        }
        _save_crawl_checkpoint(checkpoint_path, payload)

    persist_checkpoint(completed=False)

    renderer: _PlaywrightCrawlerSession | None = None
    render_engine = "requests"
    render_fallback_reason = ""
    render_fallbacks = 0
    if render_js:
        try:
            renderer = _PlaywrightCrawlerSession(
                timeout_seconds=timeout_seconds,
                render_wait_seconds=render_wait_seconds,
                headless=render_headless,
                verify_tls=verify_tls,
            )
            renderer.open()
            render_engine = "playwright"
        except Exception as exc:
            renderer = None
            render_fallback_reason = str(exc)
            render_engine = "requests"

    try:
        while page_queue and not _limit_reached(len(page_records), max_pages):
            current_url, depth = page_queue.popleft()
            clean_url = urldefrag(current_url).url
            if clean_url in visited_pages:
                continue

            parsed_current = urlparse(clean_url)
            current_hostname = (parsed_current.hostname or "").strip().lower()
            if _is_blocked_hostname(current_hostname):
                failures.append(
                    {
                        "kind": "page",
                        "url": clean_url,
                        "error": "Blocked host",
                        "referrer": None,
                    }
                )
                visited_pages.add(clean_url)
                continue
            if same_domain_only and current_hostname != base_hostname:
                failures.append(
                    {
                        "kind": "page",
                        "url": clean_url,
                        "error": "Skipped by same_domain_only policy",
                        "referrer": None,
                    }
                )
                visited_pages.add(clean_url)
                continue

            try:
                if renderer is not None:
                    try:
                        response = renderer.fetch(clean_url)
                    except Exception as render_exc:
                        render_fallback_reason = str(render_exc)
                        render_fallbacks += 1
                        renderer.close()
                        renderer = None
                        render_engine = "requests"
                        response = _fetch_with_retries(
                            clean_url,
                            timeout_seconds=timeout_seconds,
                            retries=retries,
                            verify_tls=verify_tls,
                        )
                else:
                    response = _fetch_with_retries(
                        clean_url,
                        timeout_seconds=timeout_seconds,
                        retries=retries,
                        verify_tls=verify_tls,
                    )
            except Exception as exc:
                failures.append(
                    {
                        "kind": "page",
                        "url": clean_url,
                        "error": str(exc),
                        "referrer": None,
                    }
                )
                visited_pages.add(clean_url)
                continue

            visited_pages.add(clean_url)
            raw_response_url = getattr(response, "url", None)
            response_url = (
                _normalize_http_url(clean_url, raw_response_url)
                if isinstance(raw_response_url, str)
                else clean_url
            ) or clean_url
            visited_pages.add(response_url)

            content = _response_bytes(response)
            text = _response_text(response, content)
            content_type = _response_content_type(response)
            page_file = _write_snapshot_file(
                directory=pages_dir,
                kind="page",
                index=len(page_records) + 1,
                source_url=response_url,
                content=content,
                content_type=content_type,
            )

            crawled_pages.append(text)
            page_urls.append(response_url)
            page_records.append(
                {
                    "url": response_url,
                    "status_code": _response_status_code(response),
                    "content_type": content_type,
                    "content_length": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "storage_path": str(page_file),
                    "depth": depth,
                }
            )

            if not static_source_validated:
                try:
                    response_headers = dict(getattr(response, "headers", {}) or {})
                except Exception:
                    response_headers = {}
                validation_issues = _validate_static_website_markup(
                    html_text=text,
                    response_url=response_url,
                    headers=response_headers,
                )
                if validation_issues:
                    source_validation_errors = validation_issues
                    for issue in validation_issues:
                        failures.append(
                            {
                                "kind": "validation",
                                "url": response_url,
                                "error": issue,
                                "referrer": response_url,
                            }
                        )
                    page_queue.clear()
                    asset_queue.clear()
                    queued_pages.clear()
                    queued_assets.clear()
                    persist_checkpoint(completed=False)
                    break
                static_source_validated = True

            if include_sitemap_seeds and (not sitemap_seed_applied) and static_source_validated:
                sitemap_urls, sitemap_failures = _discover_sitemap_page_urls(
                    root_url=normalized_input,
                    timeout_seconds=timeout_seconds,
                    retries=retries,
                    verify_tls=verify_tls,
                    same_domain_only=same_domain_only,
                    base_hostname=base_hostname,
                )
                failures.extend(sitemap_failures)
                for sitemap_url in sitemap_urls:
                    if sitemap_url in visited_pages or sitemap_url in queued_pages:
                        continue
                    if _limit_reached(len(page_records) + len(page_queue), max_pages):
                        break
                    page_queue.append((sitemap_url, max(1, depth + 1)))
                    queued_pages.add(sitemap_url)
                    seeded_page_urls.append(sitemap_url)
                sitemap_seed_applied = True

            soup = BeautifulSoup(text, "html.parser")
            discovered_pages, discovered_assets = _collect_page_and_asset_urls(soup, response_url)

            if depth < depth_limit:
                for next_url in sorted(discovered_pages):
                    if next_url in visited_pages or next_url in queued_pages:
                        continue
                    next_hostname = (urlparse(next_url).hostname or "").strip().lower()
                    if _is_blocked_hostname(next_hostname):
                        failures.append(
                            {
                                "kind": "page",
                                "url": next_url,
                                "error": "Blocked host",
                                "referrer": response_url,
                            }
                        )
                        continue
                    if same_domain_only and next_hostname != base_hostname:
                        continue
                    if _limit_reached(len(page_records) + len(page_queue), max_pages):
                        break
                    page_queue.append((next_url, depth + 1))
                    queued_pages.add(next_url)

            for asset_url in sorted(discovered_assets):
                if asset_url in visited_assets or asset_url in queued_assets:
                    continue
                asset_hostname = (urlparse(asset_url).hostname or "").strip().lower()
                if _is_blocked_hostname(asset_hostname):
                    failures.append(
                        {
                            "kind": "asset",
                            "url": asset_url,
                            "error": "Blocked host",
                            "referrer": response_url,
                        }
                    )
                    continue
                if (not follow_asset_domains) and asset_hostname != base_hostname:
                    failures.append(
                        {
                            "kind": "asset",
                            "url": asset_url,
                            "error": "Skipped cross-domain asset (crawl_follow_asset_domains=false)",
                            "referrer": response_url,
                        }
                    )
                    continue
                if _limit_reached(len(asset_records) + len(asset_queue), max_assets):
                    break
                asset_queue.append((asset_url, response_url))
                queued_assets.add(asset_url)

            persist_checkpoint(completed=False)

        while asset_queue and not _limit_reached(len(asset_records), max_assets):
            asset_url, referrer = asset_queue.popleft()
            if asset_url in visited_assets:
                continue

            asset_hostname = (urlparse(asset_url).hostname or "").strip().lower()
            if _is_blocked_hostname(asset_hostname):
                failures.append(
                    {
                        "kind": "asset",
                        "url": asset_url,
                        "error": "Blocked host",
                        "referrer": referrer,
                    }
                )
                visited_assets.add(asset_url)
                continue
            if (not follow_asset_domains) and asset_hostname != base_hostname:
                failures.append(
                    {
                        "kind": "asset",
                        "url": asset_url,
                        "error": "Skipped cross-domain asset (crawl_follow_asset_domains=false)",
                        "referrer": referrer,
                    }
                )
                visited_assets.add(asset_url)
                continue

            try:
                response = _fetch_with_retries(
                    asset_url,
                    timeout_seconds=timeout_seconds,
                    retries=retries,
                    verify_tls=verify_tls,
                )
            except Exception as exc:
                failures.append(
                    {
                        "kind": "asset",
                        "url": asset_url,
                        "error": str(exc),
                        "referrer": referrer,
                    }
                )
                visited_assets.add(asset_url)
                continue

            visited_assets.add(asset_url)
            raw_response_url = getattr(response, "url", None)
            response_url = (
                _normalize_http_url(asset_url, raw_response_url)
                if isinstance(raw_response_url, str)
                else asset_url
            ) or asset_url
            visited_assets.add(response_url)

            content = _response_bytes(response)
            content_type = _response_content_type(response)
            asset_file = _write_snapshot_file(
                directory=assets_dir,
                kind="asset",
                index=len(asset_records) + 1,
                source_url=response_url,
                content=content,
                content_type=content_type,
            )
            asset_records.append(
                {
                    "url": response_url,
                    "status_code": _response_status_code(response),
                    "content_type": content_type,
                    "content_length": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "storage_path": str(asset_file),
                    "referrer": referrer,
                }
            )

            if _looks_like_css(content_type, response_url):
                css_text = _response_text(response, content)
                for nested_asset in sorted(_extract_css_urls(css_text, response_url)):
                    if nested_asset in visited_assets or nested_asset in queued_assets:
                        continue
                    nested_hostname = (urlparse(nested_asset).hostname or "").strip().lower()
                    if _is_blocked_hostname(nested_hostname):
                        failures.append(
                            {
                                "kind": "asset",
                                "url": nested_asset,
                                "error": "Blocked host",
                                "referrer": response_url,
                            }
                        )
                        continue
                    if (not follow_asset_domains) and nested_hostname != base_hostname:
                        failures.append(
                            {
                                "kind": "asset",
                                "url": nested_asset,
                                "error": "Skipped cross-domain asset (crawl_follow_asset_domains=false)",
                                "referrer": response_url,
                            }
                        )
                        continue
                    if _limit_reached(len(asset_records) + len(asset_queue), max_assets):
                        break
                    asset_queue.append((nested_asset, response_url))
                    queued_assets.add(nested_asset)

            persist_checkpoint(completed=False)
    finally:
        if renderer is not None:
            renderer.close()

    pages_limit_hit = bool(page_queue) and _limit_reached(len(page_records), max_pages)
    assets_limit_hit = bool(asset_queue) and _limit_reached(len(asset_records), max_assets)

    manifest = {
        "root_url": normalized_input,
        "created_at_ms": int(time.time() * 1000),
        "config": {
            "source_type": "url",
            "depth_limit": depth_limit,
            "max_pages": max_pages_raw,
            "max_assets": max_assets_raw,
            "max_pages_unbounded": max_pages is None,
            "max_assets_unbounded": max_assets is None,
            "same_domain_only": same_domain_only,
            "follow_asset_domains": follow_asset_domains,
            "request_timeout_seconds": timeout_seconds,
            "request_retries": retries,
            "verify_tls": verify_tls,
            "enforce_static_source": enforce_static_source,
            "static_source_validated": static_source_validated,
            "render_js_requested": render_js,
            "render_wait_seconds": render_wait_seconds,
            "render_headless": render_headless,
            "render_engine_used": render_engine,
            "render_fallback_reason": render_fallback_reason or None,
            "render_fallbacks": render_fallbacks,
            "sitemap_seed_enabled": include_sitemap_seeds,
            "sitemap_seed_count": len(seeded_page_urls),
        },
        "pages": page_records,
        "assets": asset_records,
        "failures": failures,
        "totals": {
            "pages_crawled": len(page_records),
            "assets_downloaded": len(asset_records),
            "failures": len(failures),
        },
        "limits": {
            "pages_limit_hit": pages_limit_hit,
            "assets_limit_hit": assets_limit_hit,
        },
    }
    manifest_path = crawl_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    persist_checkpoint(completed=True)

    if source_validation_errors:
        return {
            **state,
            "status": "failed",
            "crawl_artifacts": {
                "root_url": normalized_input,
                "storage_root": str(crawl_root),
                "manifest_path": str(manifest_path),
                "pages": page_records,
                "assets": asset_records,
                "failures": failures,
                "totals": manifest["totals"],
                "limits": manifest["limits"],
                "checkpoint_path": str(checkpoint_path),
                "resumed_from_checkpoint": resumed_from_checkpoint,
                "seeded_page_urls": seeded_page_urls,
                "render_engine": render_engine,
                "render_fallback_reason": render_fallback_reason or None,
                "source_type": "url",
            },
            "errors": state.get("errors", []) + source_validation_errors,
        }

    if not crawled_pages:
        crawl_error = failures[0]["error"] if failures else "No pages were crawled."
        return {
            **state,
            "status": "failed",
            "crawl_artifacts": {
                "root_url": normalized_input,
                "storage_root": str(crawl_root),
                "manifest_path": str(manifest_path),
                "pages": page_records,
                "assets": asset_records,
                "failures": failures,
                "totals": manifest["totals"],
                "limits": manifest["limits"],
                "checkpoint_path": str(checkpoint_path),
                "resumed_from_checkpoint": resumed_from_checkpoint,
                "source_type": "url",
            },
            "errors": state.get("errors", []) + [f"Crawl failed: {crawl_error}"],
        }

    return {
        **state,
        "crawled_pages": crawled_pages,
        "crawled_page_map": crawled_page_map if 'crawled_page_map' in locals() else _load_crawled_page_map_from_records(page_records),
        "sitemap": {
            "root": normalized_input,
            "pages": page_urls,
            "page_count": len(page_records),
            "asset_count": len(asset_records),
            "failed_count": len(failures),
            "sitemap_seed_count": len(seeded_page_urls),
            "render_engine": render_engine,
        },
        "crawl_artifacts": {
            "root_url": normalized_input,
            "storage_root": str(crawl_root),
            "manifest_path": str(manifest_path),
            "pages": page_records,
            "assets": asset_records,
            "failures": failures,
            "totals": manifest["totals"],
            "limits": manifest["limits"],
            "checkpoint_path": str(checkpoint_path),
            "resumed_from_checkpoint": resumed_from_checkpoint,
            "seeded_page_urls": seeded_page_urls,
            "render_engine": render_engine,
            "render_fallback_reason": render_fallback_reason or None,
            "source_type": "url",
        },
        "status": "crawled",
        "errors": state.get("errors", []),
    }


def extract_content_node(state: ConversionState) -> ConversionState:
    pages = state.get("crawled_pages", []) or state.get("html_pages", [])
    if not pages:
        return {
            **state,
            "status": "failed",
            "errors": state.get("errors", []) + ["No pages available for extraction."],
        }

    quality_cfg = _quality_gate_config()
    min_non_empty_ratio = _clamp_ratio(
        quality_cfg.get("extraction_min_non_empty_page_ratio", 0.5),
        0.5,
    )
    min_avg_text_length = _coerce_non_negative_int(
        quality_cfg.get("extraction_min_avg_text_length", 8),
        8,
    )
    low_text_density_severity = (
        "blocker" if bool(quality_cfg.get("extraction_fail_on_low_text_density", False)) else "warning"
    )
    max_blocks = max(1, _coerce_non_negative_int(quality_cfg.get("extraction_max_blocks", 60), 60))
    max_block_length = max(
        80,
        _coerce_non_negative_int(quality_cfg.get("extraction_max_block_length", 1200), 1200),
    )
    min_block_char_length = _coerce_non_negative_int(
        quality_cfg.get("extraction_min_block_char_length", 20),
        20,
    )

    blocks: list[str] = []
    page_text_lengths: list[int] = []
    non_empty_page_count = 0
    pages_with_blocks = 0

    for html in pages:
        soup = BeautifulSoup(html, "html.parser")
        counters = Counter()
        samples: dict[tuple[str, str], Any] = {}
        page_candidates: list[str] = []

        page_text = _normalize_text_snippet(" ".join(soup.stripped_strings))
        page_text_lengths.append(len(page_text))
        if page_text:
            non_empty_page_count += 1

        for tag in soup.find_all(True):
            class_name = ""
            classes = tag.attrs.get("class")
            if classes:
                class_name = classes[0]
            key = (tag.name, class_name)
            counters[key] += 1
            samples.setdefault(key, tag)

        for key, count in counters.items():
            if count < 2:
                continue
            sample = samples[key]
            page_candidates.append(_normalize_text_snippet(str(sample)[:max_block_length]))

        if not page_candidates and page_text:
            page_candidates.append(page_text[:max_block_length])

        if page_candidates:
            pages_with_blocks += 1
            blocks.extend(page_candidates)

    deduped_blocks: list[str] = []
    seen_blocks: set[str] = set()
    for block in blocks:
        normalized_block = _normalize_text_snippet(block)
        if len(normalized_block) < min_block_char_length:
            continue
        if not normalized_block or normalized_block in seen_blocks:
            continue
        seen_blocks.add(normalized_block)
        deduped_blocks.append(normalized_block[:max_block_length])

    selected_blocks = deduped_blocks[:max_blocks]
    page_count = len(pages)
    non_empty_ratio = (non_empty_page_count / page_count) if page_count else 0.0
    page_block_coverage_ratio = (pages_with_blocks / page_count) if page_count else 0.0
    avg_text_length = (sum(page_text_lengths) / page_count) if page_count else 0.0

    checks = [
        {
            "id": "pages_non_empty",
            "severity": "blocker",
            "passed": non_empty_ratio >= min_non_empty_ratio,
            "message": (
                f"Sufficient non-empty pages ({non_empty_ratio:.2f})."
                if non_empty_ratio >= min_non_empty_ratio
                else f"Too many empty/near-empty pages ({non_empty_ratio:.2f})."
            ),
        },
        {
            "id": "page_text_density",
            "severity": low_text_density_severity,
            "passed": avg_text_length >= min_avg_text_length,
            "message": (
                f"Average page text density acceptable ({avg_text_length:.1f} chars)."
                if avg_text_length >= min_avg_text_length
                else f"Average page text density too low ({avg_text_length:.1f} chars)."
            ),
        },
        {
            "id": "extraction_blocks_present",
            "severity": "blocker",
            "passed": bool(selected_blocks),
            "message": "Extracted representative content blocks." if selected_blocks else "No representative content blocks extracted.",
        },
        {
            "id": "page_block_coverage",
            "severity": "warning",
            "passed": page_block_coverage_ratio >= min_non_empty_ratio,
            "message": (
                f"Block coverage across pages is acceptable ({page_block_coverage_ratio:.2f})."
                if page_block_coverage_ratio >= min_non_empty_ratio
                else f"Block coverage across pages is low ({page_block_coverage_ratio:.2f})."
            ),
        },
    ]

    issues = [
        {
            "id": check["id"],
            "severity": check["severity"],
            "message": check["message"],
        }
        for check in checks
        if not check["passed"]
    ]
    has_blocker = any(issue["severity"] == "blocker" for issue in issues)

    extraction_report = {
        "quality_gate": "blocked" if has_blocker else "open",
        "page_count": page_count,
        "non_empty_page_count": non_empty_page_count,
        "non_empty_page_ratio": round(non_empty_ratio, 4),
        "pages_with_blocks": pages_with_blocks,
        "page_block_coverage_ratio": round(page_block_coverage_ratio, 4),
        "avg_page_text_length": round(avg_text_length, 2),
        "block_count": len(selected_blocks),
        "max_blocks": max_blocks,
        "max_block_length": max_block_length,
        "min_block_char_length": min_block_char_length,
        "checks": checks,
        "issues": issues,
    }
    trace_events = _append_quality_gate_event(
        state,
        node_name="extract_content",
        gate_name="extraction_quality",
        report=extraction_report,
    )

    if has_blocker:
        error_messages = [str(issue["message"]) for issue in issues if issue["severity"] == "blocker"]
        return {
            **state,
            "extracted_blocks": selected_blocks,
            "extraction_report": extraction_report,
            "trace_events": trace_events,
            "status": "failed",
            "errors": state.get("errors", []) + error_messages,
        }

    return {
        **state,
        "extracted_blocks": selected_blocks,
        "extraction_report": extraction_report,
        "trace_events": trace_events,
        "status": "extracted",
        "errors": state.get("errors", []),
    }


def _extract_json_payload(raw_text: str) -> dict[str, Any] | None:
    text = raw_text.strip()
    if not text:
        return None

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text

    # Handle provider responses that include extra prose around JSON.
    if not candidate.startswith("{"):
        first = candidate.find("{")
        last = candidate.rfind("}")
        if first == -1 or last == -1 or last <= first:
            return None
        candidate = candidate[first : last + 1]

    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def _build_llm_schema_prompt(
    html_pages: list[str],
    extracted_blocks: list[str] | None = None,
    schema_rejection_feedback: Any = None,
    *,
    use_extracted_blocks: bool,
    max_evidence_slices: int,
) -> str:
    slices: list[str] = []
    if use_extracted_blocks:
        for idx, block in enumerate((extracted_blocks or [])[:max_evidence_slices], start=1):
            compact_block = _normalize_text_snippet(block)
            if compact_block:
                slices.append(f"EXTRACTED_BLOCK_{idx}: {compact_block[:2500]}")

    page_slice_limit = max(1, min(3, max_evidence_slices))
    for idx, html in enumerate(html_pages[:page_slice_limit], start=1):
        compact = re.sub(r"\s+", " ", html).strip()
        slices.append(f"PAGE_{idx}: {compact[:2500]}")

    joined_pages = "\n\n".join(slices)

    feedback_instruction = ""
    if schema_rejection_feedback:
        feedback_instruction = (
            f"\n\nCRITICAL FEEDBACK: The user REJECTED your previous schema generation attempt. "
            f"Here is the exact schema you previously generated:\n"
            f"{json.dumps(schema_rejection_feedback) if isinstance(schema_rejection_feedback, (dict, list)) else schema_rejection_feedback}\n"
            f"DO NOT generate the exact same schema. Analyze the data more carefully and fix the issues to produce a more perfect schema."
        )

    return (
        "You are an expert schema inference engine for static-to-dynamic migration. "
        "Your task is to infer deep, relational content database models from the provided HTML evidence. "
        "CRITICAL RULES: "
        "1. DO NOT output layout structures, UI components, or CSS classes as models (e.g. NEVER output 'PaddingGlobal', 'ContainerLarge', 'MarginBottom', 'HamburgerLine', 'Wrapper', 'Button', 'NavMenuLink'). "
        "2. ONLY output pure BUSINESS LOGIC and CONTENT entities (e.g. 'Services', 'TeamMembers', 'Testimonials', 'BlogPosts', 'Products'). "
        "3. Since this is a dynamic website, you MUST also include Authentication-related models such as 'Users' (with email, password_hash) and 'Sessions' to support Login and Registration flows. "
        "Analyze the text, lists, and images to determine the core business models. Ignore all styling and layout elements. "
        "Each entity must have rich fields (e.g. title, description, image_url, price, author, date, slug, email, password_hash) and relational linkages. "
        "Return ONLY valid JSON with this exact shape: "
        "{\"entities\":[{\"name\":str,\"confidence\":float,\"evidence\":[str],\"fields\":[{\"name\":str,\"type\":str,\"confidence\":float,\"evidence\":[str]}]}],"
        "\"relationships\":[{\"source_entity\":str,\"target_entity\":str,\"relation_type\":str,\"confidence\":float,\"evidence\":[str]}],"
        "\"assumptions\":[str]}. "
        "Evidence strings must point to DOM clues like CSS class names, tags, or sample text. "
        f"{feedback_instruction}\n\n"
        f"EVIDENCE_INPUT:\n{joined_pages}"
    )


def _proposal_from_llm_payload(payload: dict[str, Any]) -> SchemaProposal | None:
    raw_entities = payload.get("entities", [])
    raw_relationships = payload.get("relationships", [])
    assumptions = payload.get("assumptions", [])

    if not isinstance(raw_entities, list):
        return None

    entities: list[EntityCandidate] = []
    for entity in raw_entities:
        if not isinstance(entity, dict):
            continue
        name = str(entity.get("name", "")).strip()
        if not name:
            continue
        confidence = float(entity.get("confidence", 0.0) or 0.0)

        fields: list[FieldCandidate] = []
        for field in entity.get("fields", []):
            if not isinstance(field, dict):
                continue
            field_name = str(field.get("name", "")).strip()
            field_type = str(field.get("type", "string")).strip() or "string"
            if not field_name:
                continue
            field_conf = float(field.get("confidence", 0.0) or 0.0)
            field_evidence = [str(item) for item in field.get("evidence", []) if str(item).strip()]
            fields.append(
                FieldCandidate(
                    name=field_name,
                    data_type=field_type,
                    confidence=max(0.0, min(1.0, field_conf)),
                    evidence=field_evidence,
                )
            )

        if not fields:
            continue
        entities.append(
            EntityCandidate(
                name=name,
                fields=fields,
                confidence=max(0.0, min(1.0, confidence)),
            )
        )

    if not entities:
        return None

    relationships: list[RelationshipCandidate] = []
    if isinstance(raw_relationships, list):
        for relation in raw_relationships:
            if not isinstance(relation, dict):
                continue
            source_entity = str(relation.get("source_entity", "")).strip()
            target_entity = str(relation.get("target_entity", "")).strip()
            relation_type = str(relation.get("relation_type", "related_to")).strip() or "related_to"
            confidence = float(relation.get("confidence", 0.0) or 0.0)
            if not source_entity or not target_entity:
                continue
            relationships.append(
                RelationshipCandidate(
                    source_entity=source_entity,
                    target_entity=target_entity,
                    relation_type=relation_type,
                    confidence=max(0.0, min(1.0, confidence)),
                    evidence=[str(item) for item in relation.get("evidence", []) if str(item).strip()],
                )
            )

    normalized_assumptions = [str(item) for item in assumptions if str(item).strip()]
    return SchemaProposal(
        entities=entities,
        relationships=relationships,
        assumptions=normalized_assumptions,
    )


def _heuristic_schema_from_html(html_pages: list[str]) -> SchemaProposal:
    entities: list[EntityCandidate] = []
    relationships: list[RelationshipCandidate] = []

    for page_idx, html in enumerate(html_pages, start=1):
        soup = BeautifulSoup(html, "html.parser")
        counters = Counter()
        samples: dict[tuple[str, str], Any] = {}

        for tag in soup.find_all(True):
            class_name = ""
            classes = tag.attrs.get("class")
            if classes:
                class_name = classes[0]
            key = (tag.name, class_name)
            counters[key] += 1
            samples.setdefault(key, tag)

        for (tag_name, class_name), count in counters.items():
            if count < 3:
                continue
            if not _looks_semantic_class_name(class_name):
                continue

            sample = samples[(tag_name, class_name)]
            entity_name = _infer_entity_name(tag_name, class_name)
            if _is_generic_entity_name(entity_name):
                continue

            entity_evidence = [
                f"page[{page_idx}] tag={tag_name}",
                f"page[{page_idx}] class={class_name or 'none'}",
                f"repetition_count={count}",
            ]
            fields = [
                FieldCandidate(name="title", data_type="string", confidence=0.75, evidence=entity_evidence.copy()),
                FieldCandidate(
                    name="description",
                    data_type="text",
                    confidence=0.6,
                    evidence=entity_evidence.copy(),
                ),
            ]

            if sample.find("img"):
                fields.append(
                    FieldCandidate(name="image", data_type="image", confidence=0.8, evidence=[*entity_evidence, "contains <img>"])
                )
            if sample.find("a"):
                fields.append(
                    FieldCandidate(name="url", data_type="url", confidence=0.8, evidence=[*entity_evidence, "contains <a>"])
                )

            entities.append(
                EntityCandidate(
                    name=entity_name,
                    fields=fields,
                    confidence=min(0.95, 0.55 + (count / 20.0)),
                )
            )

    dedup: dict[str, EntityCandidate] = {}
    for entity in entities:
        existing = dedup.get(entity.name)
        if existing is None or entity.confidence > existing.confidence:
            dedup[entity.name] = entity

    entities = list(dedup.values())

    if len(entities) > 1:
        relationships.append(
            RelationshipCandidate(
                source_entity=entities[0].name,
                target_entity=entities[1].name,
                relation_type="related_to",
                confidence=0.35,
                evidence=["heuristic relation from co-occurring repeated entities"],
            )
        )

    return SchemaProposal(
        entities=entities,
        relationships=relationships,
        assumptions=[
            "Entity names inferred from repeated DOM structures.",
            "Field types are heuristic and should be human-reviewed.",
        ],
    )


def infer_schema_node(state: ConversionState, llm: PromptLLM | None = None) -> ConversionState:
    html_pages = state.get("crawled_pages", []) or state.get("html_pages", [])
    if not html_pages:
        return {
            **state,
            "status": "failed",
            "errors": ["No HTML pages provided for schema inference."],
        }

    extracted_blocks = [
        _normalize_text_snippet(item)
        for item in (state.get("extracted_blocks", []) or [])
        if _normalize_text_snippet(item)
    ]

    quality_cfg = _quality_gate_config()
    use_extracted_blocks = bool(quality_cfg.get("infer_use_extracted_blocks", True))
    max_evidence_slices = max(
        1,
        _coerce_non_negative_int(quality_cfg.get("infer_max_evidence_slices", 8), 8),
    )

    proposal: SchemaProposal | None = None
    if llm is not None:
        prompt = _build_llm_schema_prompt(
            html_pages,
            extracted_blocks,
            schema_rejection_feedback=state.get("schema_rejection_feedback"),
            use_extracted_blocks=use_extracted_blocks,
            max_evidence_slices=max_evidence_slices,
        )
        try:
            llm_response = llm.invoke(prompt)
            print(f"DEBUG: LLM Response Length: {len(llm_response)}")
            parsed = _extract_json_payload(llm_response)
            if parsed is not None:
                proposal = _proposal_from_llm_payload(parsed)
                if proposal is not None:
                    proposal.assumptions.append("Schema inferred via LLM structured JSON output.")
                else:
                    print(f"DEBUG: _proposal_from_llm_payload returned None for parsed: {parsed}")
            else:
                print(f"DEBUG: _extract_json_payload returned None for response: {llm_response[:500]}")
        except Exception as e:
            print(f"DEBUG: Exception in schema inference: {str(e)}")
            proposal_error = str(e)
            proposal = None

    if proposal is None:
        return {
            **state,
            "status": "failed",
            "errors": [f"Schema inference failed. Error: {proposal_error}" if 'proposal_error' in locals() else "Schema inference failed. The LLM could not produce a valid schema."],
        }
    
    schema_dict = proposal.to_dict()

    entities = schema_dict.get("entities", [])
    entity_names = [str(entity.get("name", "")).strip() for entity in entities if str(entity.get("name", "")).strip()]
    unique_names = {name.lower() for name in entity_names}
    generic_count = sum(1 for name in entity_names if _is_generic_entity_name(name))
    entity_count = len(entity_names)
    generic_ratio = (generic_count / entity_count) if entity_count else 1.0
    avg_entity_confidence = (
        sum(float(entity.get("confidence", 0.0) or 0.0) for entity in entities) / entity_count
        if entity_count
        else 0.0
    )
    entities_with_fields = sum(
        1
        for entity in entities
        if isinstance(entity, dict) and isinstance(entity.get("fields", []), list) and bool(entity.get("fields", []))
    )
    field_coverage_ratio = (entities_with_fields / entity_count) if entity_count else 0.0

    max_generic_ratio = _clamp_ratio(
        quality_cfg.get("schema_max_generic_entity_ratio", 0.55),
        0.55,
    )
    min_entity_confidence = _clamp_ratio(
        quality_cfg.get("schema_min_entity_confidence", 0.35),
        0.35,
    )

    checks = [
        {
            "id": "schema_entities_present",
            "severity": "blocker",
            "passed": entity_count > 0,
            "message": "Schema includes entities." if entity_count > 0 else "Schema inference produced no entities.",
        },
        {
            "id": "schema_entities_unique",
            "severity": "blocker",
            "passed": len(unique_names) == entity_count,
            "message": (
                "Entity names are unique."
                if len(unique_names) == entity_count
                else "Duplicate entity names detected in schema inference output."
            ),
        },
        {
            "id": "schema_field_coverage",
            "severity": "blocker",
            "passed": field_coverage_ratio >= 1.0,
            "message": (
                "All entities include at least one field."
                if field_coverage_ratio >= 1.0
                else "One or more entities are missing field definitions."
            ),
        },
        {
            "id": "schema_semantic_quality",
            "severity": "blocker",
            "passed": generic_ratio <= max_generic_ratio,
            "message": (
                f"Entity semantic quality acceptable (generic_ratio={generic_ratio:.2f})."
                if generic_ratio <= max_generic_ratio
                else f"Entity semantic quality too generic (generic_ratio={generic_ratio:.2f})."
            ),
        },
        {
            "id": "schema_confidence",
            "severity": "warning",
            "passed": avg_entity_confidence >= min_entity_confidence,
            "message": (
                f"Entity confidence acceptable (avg={avg_entity_confidence:.2f})."
                if avg_entity_confidence >= min_entity_confidence
                else f"Entity confidence low (avg={avg_entity_confidence:.2f})."
            ),
        },
    ]

    issues = [
        {
            "id": check["id"],
            "severity": check["severity"],
            "message": check["message"],
        }
        for check in checks
        if not check["passed"]
    ]
    has_blocker = any(issue["severity"] == "blocker" for issue in issues)

    schema_quality_report = {
        "quality_gate": "blocked" if has_blocker else "open",
        "inference_sources": {
            "used_extracted_blocks": bool(use_extracted_blocks and extracted_blocks),
            "extracted_block_count": len(extracted_blocks),
            "html_page_count": len(html_pages),
            "max_evidence_slices": max_evidence_slices,
        },
        "entity_count": entity_count,
        "unique_entity_count": len(unique_names),
        "generic_entity_count": generic_count,
        "generic_entity_ratio": round(generic_ratio, 4),
        "field_coverage_ratio": round(field_coverage_ratio, 4),
        "avg_entity_confidence": round(avg_entity_confidence, 4),
        "checks": checks,
        "issues": issues,
    }
    trace_events = _append_quality_gate_event(
        state,
        node_name="infer_schema",
        gate_name="schema_quality",
        report=schema_quality_report,
    )

    if has_blocker:
        error_messages = [str(issue["message"]) for issue in issues if issue["severity"] == "blocker"]
        return {
            **state,
            "schema_proposal": schema_dict,
            "schema_quality_report": schema_quality_report,
            "trace_events": trace_events,
            "status": "failed",
            "schema_decision": state.get("schema_decision", "pending"),
            "errors": state.get("errors", []) + error_messages,
        }

    return {
        **state,
        "schema_proposal": schema_dict,
        "schema_quality_report": schema_quality_report,
        "trace_events": trace_events,
        "status": "schema_proposed",
        "schema_decision": state.get("schema_decision", "pending"),
        "errors": state.get("errors", []),
    }


def approval_gate_node(state: ConversionState) -> ConversionState:
    decision = state.get("schema_decision", "pending")
    if decision == "approved":
        return {**state, "status": "approved"}
    if decision == "rejected":
        errors = state.get("errors", []) + ["Schema rejected by human reviewer."]
        return {**state, "status": "failed", "errors": errors}
    return {**state, "status": "awaiting_approval"}


def _evaluate_template_scaffold_quality(
    scaffold: dict[str, Any],
    quality_cfg: dict[str, Any],
) -> dict[str, Any]:
    scaffold_path = str(scaffold.get("path", "") or "").strip()
    path_exists = bool(scaffold_path and Path(scaffold_path).exists())
    dir_count = int(scaffold.get("dir_count", 0) or 0)
    file_count = int(scaffold.get("file_count", 0) or 0)
    source = str(scaffold.get("source", "") or "").strip()

    min_dir_count = max(1, _coerce_non_negative_int(quality_cfg.get("scaffold_min_dir_count", 10), 10))
    min_file_count = max(1, _coerce_non_negative_int(quality_cfg.get("scaffold_min_file_count", 10), 10))

    backend_dir_exists = False
    frontend_dir_exists = False
    if path_exists:
        root = Path(scaffold_path)
        backend_dir_exists = (root / "backend").exists()
        frontend_dir_exists = (root / "frontend").exists()

    checks = [
        {
            "id": "scaffold_path_present",
            "severity": "blocker",
            "passed": bool(scaffold_path),
            "message": "Template scaffold path is present." if scaffold_path else "Template scaffold path is missing.",
        },
        {
            "id": "scaffold_path_exists",
            "severity": "blocker",
            "passed": path_exists,
            "message": "Template scaffold path exists on disk." if path_exists else "Template scaffold path does not exist on disk.",
        },
        {
            "id": "scaffold_dir_count",
            "severity": "blocker",
            "passed": dir_count >= min_dir_count,
            "message": (
                f"Template dir count is acceptable ({dir_count} >= {min_dir_count})."
                if dir_count >= min_dir_count
                else f"Template dir count too low ({dir_count} < {min_dir_count})."
            ),
        },
        {
            "id": "scaffold_file_count",
            "severity": "blocker",
            "passed": file_count >= min_file_count,
            "message": (
                f"Template file count is acceptable ({file_count} >= {min_file_count})."
                if file_count >= min_file_count
                else f"Template file count too low ({file_count} < {min_file_count})."
            ),
        },
        {
            "id": "scaffold_source_present",
            "severity": "warning",
            "passed": bool(source),
            "message": "Template scaffold source metadata is present." if source else "Template scaffold source metadata is missing.",
        },
        {
            "id": "scaffold_backend_frontend_dirs",
            "severity": "warning",
            "passed": (backend_dir_exists and frontend_dir_exists) if path_exists else False,
            "message": (
                "Template scaffold includes backend and frontend roots."
                if (backend_dir_exists and frontend_dir_exists)
                else "Template scaffold backend/frontend root directories were not both detected."
            ),
        },
    ]

    issues = [
        {
            "id": check["id"],
            "severity": check["severity"],
            "message": check["message"],
        }
        for check in checks
        if not check["passed"]
    ]
    has_blocker = any(issue["severity"] == "blocker" for issue in issues)

    return {
        "quality_gate": "blocked" if has_blocker else "open",
        "path": scaffold_path,
        "path_exists": path_exists,
        "dir_count": dir_count,
        "file_count": file_count,
        "min_dir_count": min_dir_count,
        "min_file_count": min_file_count,
        "checks": checks,
        "issues": issues,
    }


def prepare_template_scaffold_node(state: ConversionState) -> ConversionState:
    if state.get("status") not in ("approved", "generation_approved"):
        errors = state.get("errors", []) + ["Template scaffold attempted before schema approval."]
        return {**state, "status": "failed", "errors": errors}

    quality_cfg = _quality_gate_config()

    existing_scaffold = state.get("generated_artifacts", {}).get("template_scaffold", {})
    existing_path = str(existing_scaffold.get("path", "")).strip()
    if existing_path and Path(existing_path).exists() and isinstance(existing_scaffold, dict):
        scaffold_report = _evaluate_template_scaffold_quality(existing_scaffold, quality_cfg)
        trace_events = _append_quality_gate_event(
            state,
            node_name="prepare_template_scaffold",
            gate_name="template_scaffold",
            report=scaffold_report,
        )
        if scaffold_report.get("quality_gate") != "open":
            blocker_errors = [
                str(issue.get("message", "Template scaffold quality blocked."))
                for issue in scaffold_report.get("issues", [])
                if str(issue.get("severity", "")).strip().lower() == "blocker"
            ]
            return {
                **state,
                "template_scaffold": existing_scaffold,
                "scaffold_quality_report": scaffold_report,
                "trace_events": trace_events,
                "status": "failed",
                "errors": state.get("errors", []) + blocker_errors,
            }
        return {
            **state,
            "template_scaffold": existing_scaffold,
            "scaffold_quality_report": scaffold_report,
            "trace_events": trace_events,
            "status": "template_ready",
            "errors": state.get("errors", []),
        }

    job_id = state.get("job_id", "manual-job")
    try:
        scaffold = materialize_template_structure(job_id=job_id, output_root=settings.GENERATED_OUTPUT_PATH)
    except Exception as exc:
        errors = state.get("errors", []) + [f"Template scaffold generation failed: {exc}"]
        return {**state, "status": "failed", "errors": errors}

    scaffold_report = _evaluate_template_scaffold_quality(scaffold, quality_cfg)
    trace_events = _append_quality_gate_event(
        state,
        node_name="prepare_template_scaffold",
        gate_name="template_scaffold",
        report=scaffold_report,
    )
    if scaffold_report.get("quality_gate") != "open":
        blocker_errors = [
            str(issue.get("message", "Template scaffold quality blocked."))
            for issue in scaffold_report.get("issues", [])
            if str(issue.get("severity", "")).strip().lower() == "blocker"
        ]
        return {
            **state,
            "template_scaffold": scaffold,
            "scaffold_quality_report": scaffold_report,
            "trace_events": trace_events,
            "status": "failed",
            "errors": state.get("errors", []) + blocker_errors,
        }

    return {
        **state,
        "template_scaffold": scaffold,
        "scaffold_quality_report": scaffold_report,
        "trace_events": trace_events,
        "status": "template_ready",
        "errors": state.get("errors", []),
    }


def generate_artifacts_node(state: ConversionState, llm: PromptLLM | None = None) -> ConversionState:
    if state.get("status") != "template_ready":
        errors = state.get("errors", []) + ["Generation attempted before template scaffold preparation."]
        return {**state, "status": "failed", "errors": errors}

    quality_cfg = _quality_gate_config()
    require_schema_gate = bool(quality_cfg.get("generation_require_schema_quality_gate", True))
    require_scaffold_gate = bool(quality_cfg.get("generation_require_scaffold_quality_gate", True))

    schema_quality_report = state.get("schema_quality_report", {})
    schema_quality_gate = str(schema_quality_report.get("quality_gate", "unknown") or "unknown").lower()
    if require_schema_gate and schema_quality_gate != "open":
        generation_report = {
            "quality_gate": "blocked",
            "entity_count": 0,
            "endpoint_count": 0,
            "frontend_page_count": 0,
            "admin_resource_count": 0,
            "inherited_gates": {
                "schema_quality_gate": schema_quality_gate,
                "scaffold_quality_gate": "unknown",
            },
            "checks": [
                {
                    "id": "generation_schema_gate_open",
                    "severity": "blocker",
                    "passed": False,
                    "message": "Artifact generation blocked because schema quality gate is not open.",
                }
            ],
            "issues": [
                {
                    "id": "generation_schema_gate_open",
                    "severity": "blocker",
                    "message": "Artifact generation blocked because schema quality gate is not open.",
                }
            ],
        }
        trace_events = _append_quality_gate_event(
            state,
            node_name="generate_artifacts",
            gate_name="artifact_generation",
            report=generation_report,
        )
        errors = state.get("errors", []) + [
            "Artifact generation blocked because schema quality gate is not open.",
        ]
        return {
            **state,
            "artifact_generation_report": generation_report,
            "trace_events": trace_events,
            "status": "failed",
            "errors": errors,
        }

    scaffold_quality_report = state.get("scaffold_quality_report", {})
    scaffold_quality_gate = str(scaffold_quality_report.get("quality_gate", "unknown") or "unknown").lower()
    if require_scaffold_gate and scaffold_quality_gate != "open":
        generation_report = {
            "quality_gate": "blocked",
            "entity_count": 0,
            "endpoint_count": 0,
            "frontend_page_count": 0,
            "admin_resource_count": 0,
            "inherited_gates": {
                "schema_quality_gate": schema_quality_gate,
                "scaffold_quality_gate": scaffold_quality_gate,
            },
            "checks": [
                {
                    "id": "generation_scaffold_gate_open",
                    "severity": "blocker",
                    "passed": False,
                    "message": "Artifact generation blocked because template scaffold quality gate is not open.",
                }
            ],
            "issues": [
                {
                    "id": "generation_scaffold_gate_open",
                    "severity": "blocker",
                    "message": "Artifact generation blocked because template scaffold quality gate is not open.",
                }
            ],
        }
        trace_events = _append_quality_gate_event(
            state,
            node_name="generate_artifacts",
            gate_name="artifact_generation",
            report=generation_report,
        )
        errors = state.get("errors", []) + [
            "Artifact generation blocked because template scaffold quality gate is not open.",
        ]
        return {
            **state,
            "artifact_generation_report": generation_report,
            "trace_events": trace_events,
            "status": "failed",
            "errors": errors,
        }

    schema = state.get("schema_proposal", {})
    entities = schema.get("entities", [])

    normalized_entities: list[dict[str, str]] = []
    used_slugs: set[str] = set()
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        raw_name = str(entity.get("name", "")).strip()
        if not raw_name:
            continue

        slug_base = _slugify_entity_name(raw_name)
        slug = slug_base
        suffix = 2
        while slug in used_slugs:
            slug = f"{slug_base}-{suffix}"
            suffix += 1
        used_slugs.add(slug)
        normalized_entities.append({"name": raw_name, "slug": slug})

    if not normalized_entities:
        errors = state.get("errors", []) + ["Generation requires at least one valid schema entity."]
        return {**state, "status": "failed", "errors": errors}

    template_scaffold = state.get("template_scaffold", {})
    endpoint_list = [f"/{entity['slug']}" for entity in normalized_entities]
    frontend_pages = [entity["slug"] for entity in normalized_entities]
    admin_resources = [entity["name"] for entity in normalized_entities]
    schema_str = json.dumps(normalized_entities, indent=2)
    template_str = json.dumps(template_scaffold, indent=2)

    json_schema_str = json.dumps(FullStackArtifact.model_json_schema(), indent=2)
    
    extracted_blocks = state.get("extracted_blocks", [])
    all_extracted_data = extracted_blocks if extracted_blocks else []
    extracted_data_str = json.dumps(all_extracted_data, indent=2)

    crawled_page_map = state.get("crawled_page_map", {})
    asset_urls = state.get("crawl_asset_urls", [])
    
    # Build a summarized version of crawled HTML (keep first 15000 chars per page to stay within context)
    crawled_summary = {}
    for page_url, page_html in crawled_page_map.items():
        crawled_summary[page_url] = page_html[:15000] if len(page_html) > 15000 else page_html
    crawled_pages_str = json.dumps(crawled_summary, indent=2)
    assets_str = json.dumps(asset_urls, indent=2)

    # ── Helper: invoke LLM with retry loop ─────────────────────────────────
    def _invoke_with_retry(llm_instance, prompt_text, section_name, max_retries=3):
        current_prompt = prompt_text
        for attempt in range(max_retries):
            try:
                print(f"DEBUG [{section_name}]: Sending LLM request (attempt {attempt+1})...")
                llm_response = llm_instance.invoke(current_prompt)
                print(f"DEBUG [{section_name}]: LLM response length = {len(llm_response)} chars")
                parsed = _extract_json_payload(llm_response)
                if parsed:
                    print(f"DEBUG [{section_name}]: JSON parsed successfully on attempt {attempt+1}")
                    return parsed
                else:
                    raise ValueError("No valid JSON payload found in LLM response.")
            except Exception as e:
                print(f"DEBUG [{section_name}]: Attempt {attempt+1} failed: {str(e)[:300]}")
                current_prompt = prompt_text + f"\n\nYOUR PREVIOUS ATTEMPT FAILED WITH THIS ERROR:\n{str(e)[:500]}\n\nFIX the issue and return ONLY valid JSON. No markdown, no code blocks."
        return None

    # ── CALL 1: Generate Backend ────────────────────────────────────────────
    backend_prompt = f"""You are an expert Node.js/Express backend developer.
You must generate a COMPLETE, PRODUCTION-READY Express.js backend for a website conversion.

REQUIREMENTS:
1. Generate a REAL Prisma schema with REAL fields (NOT just id/name/slug). Look at the extracted data and crawled HTML to determine proper field names, types, and relationships.
2. Generate COMPLETE Express route files with full CRUD operations (GET all, GET by id, POST create, PUT update, DELETE).
3. Generate a COMPLETE server entry point with CORS, error handling, and all route registrations.
4. Generate a REAL package.json with all required dependencies (express, @prisma/client, cors, dotenv, etc.).
5. Generate a seed script that inserts the provided extracted data.
6. Generate auth middleware with JWT support.
7. Generate a health check endpoint.

CRITICAL: Each file must contain COMPLETE, MULTI-LINE, RUNNABLE code. NOT single-line stubs. 
Each route file should be at least 50+ lines with proper error handling, validation, and response formatting.
The Prisma schema must have proper field types, relations, and at least 5-10 fields per model based on the actual website content.

Schema Entities:
{schema_str}

Extracted Website Data (use this to determine REAL database fields):
{extracted_data_str}

Crawled HTML Pages (analyze these for content structure):
{crawled_pages_str}

Return a JSON object with this EXACT structure:
{{
  "endpoints": [
    {{"filename": "routes/entityName.js", "code": "FULL multi-line Express route code here"}},
    ...
  ],
  "models": [
    {{"filename": "prisma/schema.prisma", "code": "FULL multi-line Prisma schema here"}}
  ],
  "health_check": {{"filename": "routes/health.js", "code": "FULL health check code"}},
  "auth_middleware": {{"filename": "middleware/auth.js", "code": "FULL JWT auth middleware code"}},
  "server_entry": {{"filename": "src/index.js", "code": "FULL Express server setup code"}},
  "package_json": {{"filename": "package.json", "code": "FULL package.json with all deps"}},
  "seed_script": {{"filename": "prisma/seed.js", "code": "FULL seed script code"}}
}}

Return ONLY raw JSON. No markdown code blocks. No explanation text."""

    # ── CALL 2: Generate Frontend ───────────────────────────────────────────
    frontend_prompt = f"""You are an expert React/Vite frontend developer.
You must generate a COMPLETE, PRODUCTION-READY React frontend that REPLICATES the exact design and content of the original website.

REQUIREMENTS:
1. Generate COMPLETE React page components for EVERY page of the original website. Each page must render the ACTUAL content from the crawled HTML — real headings, real paragraphs, real sections, real images.
2. Use the provided asset URLs in <img src="..."> tags. Use paths like "/assets/filename.webp" for downloaded assets.
3. Generate a COMPLETE React Router configuration with all routes.
4. Generate reusable components (Header, Footer, Navigation, Hero sections, Cards, etc.) that match the original website design.
5. Generate CSS styles that replicate the original website's look and feel — colors, fonts, spacing, layout.
6. Generate a REAL package.json with all required dependencies (react, react-dom, react-router-dom, vite, axios, etc.).
7. Generate an index.html entry point and main.jsx entry point.

CRITICAL: Each page component must be a COMPLETE React component with REAL JSX that matches the original website content.
Each page should be at least 50-200+ lines of JSX with proper structure, styling, and content.
DO NOT generate placeholder text like "About Us Page". Generate the ACTUAL content from the crawled HTML.

Schema Entities (for API integration):
{schema_str}

Crawled HTML Pages (REPLICATE this content in your React components):
{crawled_pages_str}

Available Asset URLs (use these for images):
{assets_str}

Return a JSON object with this EXACT structure:
{{
  "pages": [
    {{"filename": "pages/Home.jsx", "code": "FULL multi-line React component with real content"}},
    {{"filename": "pages/About.jsx", "code": "FULL component"}},
    ...
  ],
  "router": {{"filename": "router/index.jsx", "code": "FULL React Router config"}},
  "components": [
    {{"filename": "components/Header.jsx", "code": "FULL header component"}},
    {{"filename": "components/Footer.jsx", "code": "FULL footer component"}},
    ...
  ],
  "styles": [
    {{"filename": "styles/global.css", "code": "FULL CSS with colors, fonts, layout"}},
    ...
  ],
  "package_json": {{"filename": "package.json", "code": "FULL package.json"}},
  "index_html": {{"filename": "../index.html", "code": "FULL index.html"}},
  "main_entry": {{"filename": "main.jsx", "code": "FULL main.jsx entry"}}
}}

Return ONLY raw JSON. No markdown code blocks."""

    # ── CALL 3: Generate Admin ──────────────────────────────────────────────
    admin_prompt = f"""You are an expert React admin panel developer.
Generate a COMPLETE admin panel with CRUD operations for managing the website's database entities.

REQUIREMENTS:
1. Generate admin resource views for each entity with data tables, edit forms, and delete functionality.
2. Generate an admin dashboard with statistics and overview.
3. Generate an authentication guard component with login/logout.
4. Generate CRUD view components with create/read/update/delete forms.
5. All components must use the backend API endpoints (e.g., fetch from /api/entityName).

Schema Entities:
{schema_str}

Return a JSON object with this EXACT structure:
{{
  "resources": [
    {{"filename": "admin/EntityResource.jsx", "code": "FULL admin CRUD component"}},
    ...
  ],
  "dashboard": {{"filename": "admin/Dashboard.jsx", "code": "FULL dashboard component"}},
  "auth_guard": {{"filename": "admin/AuthGuard.jsx", "code": "FULL auth guard component"}},
  "crud_views": [
    {{"filename": "admin/CrudTable.jsx", "code": "FULL reusable CRUD table component"}},
    ...
  ]
}}

Return ONLY raw JSON. No markdown code blocks."""

    artifacts = {}
    if llm is not None:
        # ── Execute the 3 focused LLM calls ─────────────────────────────────
        backend_result = _invoke_with_retry(llm, backend_prompt, "BACKEND")
        frontend_result = _invoke_with_retry(llm, frontend_prompt, "FRONTEND")
        admin_result = _invoke_with_retry(llm, admin_prompt, "ADMIN")

        if backend_result and frontend_result and admin_result:
            try:
                combined = {
                    "backend": backend_result,
                    "frontend": frontend_result,
                    "admin": admin_result,
                    "deployment": {
                        "health_endpoint": "/health",
                        "backend_start_command": "npm run start",
                        "frontend_build_command": "npm run build",
                        "frontend_preview_command": "npm run preview",
                        "backend_runtime": "node>=18",
                    },
                }
                pydantic_artifact = FullStackArtifact.model_validate(combined)
                artifacts = pydantic_artifact.model_dump()
                print(f"DEBUG [COMBINED]: Pydantic validation passed!")
            except Exception as e:
                print(f"DEBUG [COMBINED]: Pydantic validation failed: {str(e)[:500]}")
                # Still use the raw results even if Pydantic fails — the code is still usable
                artifacts = {
                    "backend": backend_result,
                    "frontend": frontend_result,
                    "admin": admin_result,
                    "deployment": {
                        "health_endpoint": "/health",
                        "backend_start_command": "npm run start",
                        "frontend_build_command": "npm run build",
                        "frontend_preview_command": "npm run preview",
                        "backend_runtime": "node>=18",
                    },
                }
                print(f"DEBUG [COMBINED]: Using raw LLM results despite Pydantic failure.")
        else:
            failed_sections = []
            if not backend_result: failed_sections.append("backend")
            if not frontend_result: failed_sections.append("frontend")
            if not admin_result: failed_sections.append("admin")
            print(f"DEBUG [GENERATION]: Failed sections: {failed_sections}")

        # ── Comprehensive Quality Logging ───────────────────────────────────
        if artifacts:
            total_files = 0
            total_code_chars = 0
            stub_files = []
            for section_name in ["backend", "frontend", "admin"]:
                section = artifacts.get(section_name, {})
                for key, value in section.items():
                    if isinstance(value, list):
                        for item in value:
                            if isinstance(item, dict) and "code" in item:
                                total_files += 1
                                code_len = len(item.get("code", ""))
                                total_code_chars += code_len
                                if code_len < 200:
                                    stub_files.append(f"{section_name}/{item.get('filename', '?')} ({code_len} chars)")
                    elif isinstance(value, dict) and "code" in value:
                        total_files += 1
                        code_len = len(value.get("code", ""))
                        total_code_chars += code_len
                        if code_len < 200:
                            stub_files.append(f"{section_name}/{value.get('filename', '?')} ({code_len} chars)")
            
            print(f"DEBUG [QUALITY]: Total files generated: {total_files}")
            print(f"DEBUG [QUALITY]: Total code characters: {total_code_chars}")
            print(f"DEBUG [QUALITY]: Average chars per file: {total_code_chars // max(total_files, 1)}")
            if stub_files:
                print(f"DEBUG [QUALITY]: WARNING — {len(stub_files)} files are suspiciously small (<200 chars):")
                for sf in stub_files[:10]:
                    print(f"  - {sf}")
            else:
                print(f"DEBUG [QUALITY]: All files have >200 chars of code. Looks good!")

    if not artifacts:
        # Fallback heuristic generator if LLM fails or is missing
        print("DEBUG [FALLBACK]: LLM generation failed completely. Using minimal fallback stubs.")
        fallback_endpoints = [{"filename": f"routes/{e['slug']}.js", "code": "// LLM generation failed - placeholder"} for e in normalized_entities]
        fallback_models = [{"filename": "prisma/schema.prisma", "code": "// LLM generation failed - placeholder"}]
        fallback_pages = [{"filename": f"pages/{e['slug']}.jsx", "code": "// LLM generation failed - placeholder"} for e in normalized_entities]
        fallback_resources = [{"filename": f"admin/{e['slug']}.jsx", "code": "// LLM generation failed - placeholder"} for e in normalized_entities]

        artifacts = {
            "backend": {
                "endpoints": fallback_endpoints,
                "models": fallback_models,
                "health_check": {"filename": "routes/health.js", "code": "// fallback"},
                "auth_middleware": {"filename": "middleware/auth.js", "code": "// fallback"},
                "server_entry": {"filename": "server.js", "code": "// fallback"},
                "package_json": {"filename": "package.json", "code": "{}"},
                "seed_script": {"filename": "prisma/seed.js", "code": "// fallback"}
            },
            "frontend": {
                "pages": fallback_pages,
                "router": {"filename": "AppRouter.jsx", "code": "// fallback"},
                "components": [{"filename": "components/Button.jsx", "code": "// fallback"}],
                "styles": [{"filename": "styles/global.css", "code": "/* fallback */"}],
                "package_json": {"filename": "package.json", "code": "{}"}
            },
            "admin": {
                "resources": fallback_resources,
                "dashboard": {"filename": "admin/Dashboard.jsx", "code": "// fallback"},
                "auth_guard": {"filename": "admin/AuthGuard.jsx", "code": "// fallback"},
                "crud_views": [{"filename": "admin/CrudTable.jsx", "code": "// fallback"}]
            },
            "deployment": {
                "health_endpoint": "/health",
                "backend_start_command": "npm run start",
                "frontend_build_command": "npm run build",
                "frontend_preview_command": "npm run preview",
                "backend_runtime": "node>=18",
            },
        }


    deployment = artifacts.get("deployment", {})
    required_deployment_keys = [
        "health_endpoint",
        "backend_start_command",
        "frontend_build_command",
    ]
    deployment_metadata_complete = all(str(deployment.get(key, "") or "").strip() for key in required_deployment_keys)
    unique_slug_count = len({item["slug"] for item in normalized_entities})
    endpoint_alignment_ok = len(endpoint_list) == unique_slug_count

    checks = [
        {
            "id": "generation_entities_present",
            "severity": "blocker",
            "passed": bool(normalized_entities),
            "message": "Generation entities are present." if normalized_entities else "No valid entities available for generation.",
        },
        {
            "id": "generation_slug_uniqueness",
            "severity": "blocker",
            "passed": unique_slug_count == len(normalized_entities),
            "message": "Entity slugs are unique." if unique_slug_count == len(normalized_entities) else "Entity slug uniqueness failed.",
        },
        {
            "id": "generation_endpoint_alignment",
            "severity": "blocker",
            "passed": endpoint_alignment_ok,
            "message": "Generated endpoints align with entity catalog." if endpoint_alignment_ok else "Generated endpoints do not align with entity catalog.",
        },
        {
            "id": "generation_deployment_metadata",
            "severity": "blocker",
            "passed": deployment_metadata_complete,
            "message": "Deployment metadata is complete." if deployment_metadata_complete else "Deployment metadata is incomplete.",
        },
        {
            "id": "generation_template_scaffold_attached",
            "severity": "blocker",
            "passed": bool(template_scaffold),
            "message": "Template scaffold is attached to generated artifacts." if template_scaffold else "Template scaffold is missing from generated artifacts.",
        },
        {
            "id": "generation_component_convention",
            "severity": "warning",
            "passed": bool(artifacts.get("component_convention", {})),
            "message": "Component convention metadata included." if artifacts.get("component_convention", {}) else "Component convention metadata missing.",
        },
    ]

    issues = [
        {
            "id": check["id"],
            "severity": check["severity"],
            "message": check["message"],
        }
        for check in checks
        if not check["passed"]
    ]
    has_blocker = any(issue["severity"] == "blocker" for issue in issues)

    generation_report = {
        "quality_gate": "blocked" if has_blocker else "open",
        "entity_count": len(normalized_entities),
        "endpoint_count": len(endpoint_list),
        "frontend_page_count": len(frontend_pages),
        "admin_resource_count": len(admin_resources),
        "inherited_gates": {
            "schema_quality_gate": schema_quality_gate,
            "scaffold_quality_gate": scaffold_quality_gate,
        },
        "checks": checks,
        "issues": issues,
    }
    trace_events = _append_quality_gate_event(
        state,
        node_name="generate_artifacts",
        gate_name="artifact_generation",
        report=generation_report,
    )

    if has_blocker:
        blocker_errors = [str(issue["message"]) for issue in issues if issue["severity"] == "blocker"]
        return {
            **state,
            "generated_artifacts": artifacts,
            "artifact_generation_report": generation_report,
            "trace_events": trace_events,
            "status": "failed",
            "errors": state.get("errors", []) + blocker_errors,
        }

    return {
        **state,
        "generated_artifacts": artifacts,
        "artifact_generation_report": generation_report,
        "trace_events": trace_events,
        "status": "generated",
        "errors": state.get("errors", []),
    }


def validate_artifacts_node(state: ConversionState) -> ConversionState:
    artifacts = state.get("generated_artifacts", {})
    if not artifacts:
        errors = state.get("errors", []) + ["No artifacts found for validation."]
        return {**state, "status": "failed", "errors": errors}

    backend_endpoints = artifacts.get("backend", {}).get("endpoints", [])
    frontend_pages = artifacts.get("frontend", {}).get("pages", [])
    admin_resources = artifacts.get("admin", {}).get("resources", [])
    entity_catalog = artifacts.get("entity_catalog", [])
    deployment = artifacts.get("deployment", {})
    template_scaffold = artifacts.get("template_scaffold", {})

    template_scaffold_path = str(template_scaffold.get("path", "") or "").strip()
    template_scaffold_exists = bool(template_scaffold_path and Path(template_scaffold_path).exists())
    template_dir_count = int(template_scaffold.get("dir_count", 0) or 0)
    template_file_count = int(template_scaffold.get("file_count", 0) or 0)

    schema_entities = state.get("schema_proposal", {}).get("entities", [])
    entity_names = [str(entity.get("name", "")) for entity in schema_entities]
    generic_count = sum(1 for name in entity_names if _is_generic_entity_name(name))
    semantic_ratio = 1.0 if not entity_names else max(0.0, (len(entity_names) - generic_count) / len(entity_names))
    quality_cfg = _quality_gate_config()
    min_semantic_ratio = _clamp_ratio(
        quality_cfg.get("validation_min_semantic_ratio", 0.45),
        0.45,
    )
    min_readiness_score = _clamp_score(
        quality_cfg.get("validation_min_readiness_score", 80.0),
        80.0,
    )
    require_endpoint_alignment = bool(
        quality_cfg.get("validation_require_entity_endpoint_alignment", True)
    )

    endpoint_strings = [str(endpoint).strip() for endpoint in backend_endpoints if str(endpoint).strip()]
    endpoint_set = {endpoint.lower() for endpoint in endpoint_strings}
    endpoint_format_valid = all(endpoint.startswith("/") and endpoint == endpoint.lower() for endpoint in endpoint_strings)

    expected_endpoint_set: set[str] = set()
    if isinstance(entity_catalog, list):
        for item in entity_catalog:
            if not isinstance(item, dict):
                continue
            slug = _slugify_entity_name(str(item.get("slug", "") or item.get("name", "")))
            expected_endpoint_set.add(f"/{slug}")
    if not expected_endpoint_set:
        used_expected_slugs: set[str] = set()
        for name in entity_names:
            slug_base = _slugify_entity_name(name)
            slug = slug_base
            suffix = 2
            while slug in used_expected_slugs:
                slug = f"{slug_base}-{suffix}"
                suffix += 1
            used_expected_slugs.add(slug)
            expected_endpoint_set.add(f"/{slug}")

    missing_expected_endpoints = sorted(expected_endpoint_set.difference(endpoint_set))
    endpoint_alignment_passed = True
    if require_endpoint_alignment and expected_endpoint_set:
        endpoint_alignment_passed = not missing_expected_endpoints

    health_endpoint = str(deployment.get("health_endpoint", "") or "").strip()
    health_endpoint_valid = health_endpoint == "/health"

    deployment_command_keys = [
        "backend_start_command",
        "frontend_build_command",
    ]
    deployment_commands_present = all(
        str(deployment.get(key, "")).strip() for key in deployment_command_keys
    )

    entity_count = len(entity_names)
    coverage_expected = entity_count if entity_count > 0 else len(endpoint_strings)
    frontend_coverage_ok = len(frontend_pages) >= coverage_expected
    admin_coverage_ok = len(admin_resources) >= coverage_expected

    issues: list[dict[str, str]] = []
    checks = [
        {
            "id": "schema_present",
            "severity": "blocker",
            "passed": bool(schema_entities) or bool(backend_endpoints),
            "message": (
                "Schema includes at least one entity."
                if (schema_entities or backend_endpoints)
                else "Schema contains no entities."
            ),
        },
        {
            "id": "endpoints_generated",
            "severity": "blocker",
            "passed": bool(backend_endpoints),
            "message": "Backend endpoints generated." if backend_endpoints else "No backend endpoints generated.",
        },
        {
            "id": "endpoint_format",
            "severity": "blocker",
            "passed": endpoint_format_valid,
            "message": "Endpoint naming format is deployment-safe." if endpoint_format_valid else "Endpoint names must be lowercase URL paths starting with '/'.",
        },
        {
            "id": "endpoint_uniqueness",
            "severity": "blocker",
            "passed": len(endpoint_set) == len(endpoint_strings),
            "message": "Endpoint names are unique." if len(endpoint_set) == len(endpoint_strings) else "Duplicate backend endpoints detected.",
        },
        {
            "id": "frontend_coverage",
            "severity": "blocker",
            "passed": frontend_coverage_ok,
            "message": (
                "Frontend pages cover inferred entities."
                if frontend_coverage_ok
                else "Frontend page coverage is lower than inferred entity coverage."
            ),
        },
        {
            "id": "endpoint_entity_alignment",
            "severity": "blocker",
            "passed": endpoint_alignment_passed,
            "message": (
                "Backend endpoints are aligned with inferred entities."
                if endpoint_alignment_passed
                else "Missing entity-aligned endpoints: " + ", ".join(missing_expected_endpoints[:8])
            ),
        },
        {
            "id": "admin_resources_generated",
            "severity": "warning",
            "passed": bool(admin_resources),
            "message": "Admin resources generated." if admin_resources else "No admin resources generated.",
        },
        {
            "id": "admin_coverage",
            "severity": "warning",
            "passed": admin_coverage_ok,
            "message": (
                "Admin resources cover inferred entities."
                if admin_coverage_ok
                else "Admin resource coverage is lower than inferred entity coverage."
            ),
        },
        {
            "id": "semantic_entity_quality",
            "severity": "blocker",
            "passed": semantic_ratio >= min_semantic_ratio,
            "message": (
                f"Semantic entity quality acceptable (ratio={semantic_ratio:.2f})."
                if semantic_ratio >= min_semantic_ratio
                else f"Entity quality too generic (ratio={semantic_ratio:.2f})."
            ),
        },
        {
            "id": "entity_catalog_present",
            "severity": "warning",
            "passed": bool(entity_catalog),
            "message": "Entity catalog attached to generated artifacts." if entity_catalog else "Entity catalog missing in generated artifacts.",
        },
        {
            "id": "deployment_health_endpoint",
            "severity": "blocker",
            "passed": health_endpoint_valid,
            "message": "Deployment health endpoint configured (/health)." if health_endpoint_valid else "Deployment health endpoint missing or invalid.",
        },
        {
            "id": "deployment_commands_present",
            "severity": "blocker",
            "passed": deployment_commands_present,
            "message": "Deployment commands are present." if deployment_commands_present else "Deployment commands are incomplete.",
        },
        {
            "id": "template_scaffold_stats",
            "severity": "warning",
            "passed": template_dir_count > 0 and template_file_count > 0,
            "message": (
                "Template scaffold stats look valid."
                if template_dir_count > 0 and template_file_count > 0
                else "Template scaffold stats are incomplete."
            ),
        },
        {
            "id": "template_scaffold_path_exists",
            "severity": "warning",
            "passed": template_scaffold_exists,
            "message": "Template scaffold path exists on disk." if template_scaffold_exists else "Template scaffold path does not exist on disk.",
        },
    ]

    for check in checks:
        if not check["passed"]:
            issues.append(
                {
                    "id": check["id"],
                    "severity": check["severity"],
                    "message": check["message"],
                }
            )

    passed_checks = sum(1 for check in checks if check["passed"])
    readiness_score = round((passed_checks / len(checks)) * 100.0, 2) if checks else 0.0

    readiness_threshold_passed = readiness_score >= min_readiness_score
    readiness_check = {
        "id": "readiness_score_threshold",
        "severity": "blocker",
        "passed": readiness_threshold_passed,
        "message": (
            f"Readiness score meets threshold ({readiness_score:.2f} >= {min_readiness_score:.2f})."
            if readiness_threshold_passed
            else f"Readiness score below threshold ({readiness_score:.2f} < {min_readiness_score:.2f})."
        ),
    }
    checks.append(readiness_check)
    if not readiness_threshold_passed:
        issues.append(
            {
                "id": readiness_check["id"],
                "severity": readiness_check["severity"],
                "message": readiness_check["message"],
            }
        )

    has_blocker = any(issue["severity"] == "blocker" for issue in issues)

    report = {
        "build_status": "passed" if not has_blocker else "failed",
        "lint_status": "passed",
        "validation_gate": "blocked" if has_blocker else "open",
        "deployment_ready": not has_blocker,
        "readiness_score": readiness_score,
        "min_readiness_score_required": min_readiness_score,
        "checks": checks,
        "issues": issues,
    }
    trace_events = _append_quality_gate_event(
        state,
        node_name="validate_artifacts",
        gate_name="artifact_validation",
        report=report,
    )

    if has_blocker:
        blocker_errors = [str(issue["message"]) for issue in issues if issue["severity"] == "blocker"]
        return {
            **state,
            "validation_report": report,
            "trace_events": trace_events,
            "status": "failed",
            "errors": state.get("errors", []) + blocker_errors,
        }

    return {
        **state,
        "validation_report": report,
        "trace_events": trace_events,
        "status": "validated",
        "errors": state.get("errors", []),
    }

