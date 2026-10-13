"""Generate a dynamic site from captured documents without redrawing their layout."""
from __future__ import annotations

import hashlib
import json
import mimetypes
from pathlib import Path
from urllib.parse import urldefrag, urlsplit, unquote

from bs4 import BeautifulSoup, NavigableString, Comment
import tinycss2

from src.engine.source_assets import asset_path, resolve_url, route_for, rewrite_css, rewrite_srcset

TEMPLATES = Path(__file__).parent / "runtime_templates"
URL_ATTRIBUTES = {"src", "href", "poster", "data", "xlink:href", "action"}


def _file(name, code):
    return {"filename": name, "code": code}


def generate_preserved_site(state):
    captured = state.get("crawl_artifacts") or {}
    pages = dict(state.get("crawled_page_map") or {})
    for record in captured.get("pages", []):
        # Older inference stages stored inline copies alongside real URL mappings.
        if pages and str(record.get("url", "")).startswith("inline://"):
            continue
        if record.get("url") not in pages and record.get("storage_path"):
            pages[record["url"]] = Path(record["storage_path"]).read_text(encoding="utf-8")
    if not pages:
        raise ValueError("No captured pages available for source-preserving generation")
    assets = captured.get("assets", [])
    asset_map = {}
    for record in assets:
        if not record.get("storage_path") or not Path(record["storage_path"]).is_file():
            continue
        target = asset_path(record["url"])
        asset_map[record["url"]] = target
        if record.get("requested_url"):
            asset_map[record["requested_url"]] = target
    routes = {url: route_for(url) for url in pages}
    if len(set(routes.values())) != len(routes):
        raise ValueError("Captured pages contain conflicting local routes")
    for url in pages:
        if url.startswith("zip://") and url.lower().endswith(("/index.html", "/index.htm", "zip://index.html", "zip://index.htm")):
            directory = url.rsplit("/", 1)[0] + "/" if "/" in url[6:] else "zip://"
            routes[directory] = routes[url]
            if directory != "zip://":
                routes[directory.rstrip("/")] = routes[url]
    for record in captured.get("pages", []):
        if record.get("requested_url") and record["url"] in routes:
            routes[record["requested_url"]] = routes[record["url"]]
    missing = set()
    external = set()
    local_routes = set(routes.values())
    site_hosts = {(urlsplit(url).hostname or "").removeprefix("www.") for url in pages}

    def rewrite(base, value, required=False):
        value = str(value)
        if not value or value.startswith(("#", "data:", "blob:", "mailto:", "tel:", "javascript:")):
            return value
        absolute, fragment = urldefrag(resolve_url(base, value))
        suffix = "#" + fragment if fragment else ""
        query = ""
        if absolute.startswith("zip://") and "?" in absolute:
            absolute, query = absolute.split("?", 1)
            query = "?" + query
        if absolute in asset_map:
            return asset_map[absolute] + query + suffix
        if absolute in routes:
            return routes[absolute] + query + suffix
        parsed = urlsplit(absolute)
        if (not required and parsed.scheme in {"http", "https"} and parsed.port in {None, 80, 443}
                and (parsed.hostname or "").removeprefix("www.") in site_hosts
                and route_for(absolute) in local_routes):
            return route_for(absolute) + suffix
        if required:
            missing.add(absolute)
        else:
            external.add(absolute)
        return absolute + suffix

    runtime_pages = []
    for page_url, html in pages.items():
        soup = BeautifulSoup(html, "html.parser")
        base_tag = soup.find("base", href=True)
        base = resolve_url(page_url, base_tag["href"]) if base_tag else page_url
        for tag in soup.find_all("base"):
            tag.decompose()
        for tag in soup.find_all(True):
            for key, value in list(tag.attrs.items()):
                if not isinstance(value, str):
                    continue
                if "srcset" in key:
                    tag[key] = rewrite_srcset(value, lambda url: rewrite(base, url, True))
                elif key in URL_ATTRIBUTES or (key.startswith("data-") and any(part in key for part in ("src", "image", "poster", "background"))):
                    required = tag.name not in {"a", "form", "iframe"} and key not in {"action"}
                    if tag.name == "link" and not any(rel in tag.get("rel", []) for rel in ["stylesheet", "icon", "preload"]):
                        required = False
                    tag[key] = rewrite(base, value, required)
                elif key == "style":
                    tag[key] = rewrite_css(value, lambda url: rewrite(base, url, True))
            if tag.name == "style" and tag.string:
                tag.string.replace_with(rewrite_css(str(tag.string), lambda url: rewrite(base, url, True)))
            if tag.name == "a" and tag.get("href", "").startswith("/") and not tag.get("href", "").startswith("//"):
                tag["target"] = "_top"
            if tag.name in {"script", "link"}:
                # Local CSS rewriting changes bytes, invalidating the source's SRI hash.
                tag.attrs.pop("integrity", None)

        fields = []
        for index, tag in enumerate(soup.find_all(True)):
            if tag.name in {"title", "script", "style", "noscript", "template", "svg", "path"} or tag.find_parent(["script", "style", "noscript", "template", "svg"]):
                continue
            element = "n" + str(index)
            own_fields = []
            for child_index, child in enumerate(tag.contents):
                if type(child) is NavigableString and str(child).strip():
                    own_fields.append({"id": element + "-t" + str(child_index), "element": element, "index": child_index,
                                       "kind": "text", "tag": tag.name, "label": tag.name + ": " + str(child).strip()[:70], "value": str(child)})
            for attr in ("src", "alt", "href", "poster", "title"):
                if tag.name not in {"script", "link", "base"} and isinstance(tag.get(attr), str):
                    own_fields.append({"id": element + "-" + attr, "element": element, "attribute": attr,
                                       "kind": "url" if attr in {"src", "href", "poster"} else "text", "tag": tag.name,
                                       "label": tag.name + " / " + attr, "value": tag[attr]})
            if own_fields:
                tag["data-converter-id"] = element
                fields.extend(own_fields)
        title = soup.title.get_text() if soup.title else routes[page_url]
        runtime_pages.append({"id": hashlib.sha256(page_url.encode()).hexdigest()[:24],
                              "route": routes[page_url], "title": title, "html": str(soup), "fields": fields, "published": True})

    runtime_assets = []
    media = []
    for record in assets:
        url = record.get("url", "")
        if url not in asset_map:
            missing.add(url)
            continue
        item = {"filename": "public" + (unquote(asset_map[url]) if url.startswith("zip://") else asset_map[url]), "source": record["storage_path"]}
        content_type = str(record.get("content_type") or "").split(";")[0].strip().lower()
        if not content_type or content_type == "application/octet-stream":
            content_type = mimetypes.guess_type(urlsplit(url).path)[0] or mimetypes.guess_type(record["storage_path"])[0] or "application/octet-stream"
        if "css" in content_type or urlsplit(url).path.endswith(".css"):
            if url.startswith("zip://"):
                rules, _encoding = tinycss2.parse_stylesheet_bytes(Path(record["storage_path"]).read_bytes())
                for rule in rules:
                    if rule.type == "at-rule" and rule.lower_at_keyword == "charset":
                        rule.prelude = tinycss2.parse_component_value_list(' "UTF-8"')
                css = tinycss2.serialize(rules)
            else:
                css = Path(record["storage_path"]).read_text(encoding="utf-8", errors="replace")
            item["code"] = rewrite_css(css, lambda value: rewrite(url, value, True))
        runtime_assets.append(item)
        media.append({"url": asset_map[url], "type": content_type, "source": url})
    schema = state["schema_proposal"]
    home = next((page["route"] for page in runtime_pages if page["route"] == "/"), runtime_pages[0]["route"])
    seed = {"pages": runtime_pages, "schema": schema, "media": media, "homeRoute": home}
    if captured.get("source_type") == "zip":
        seed["sourceType"] = "zip"
    backend_package = {"name": "converted-site-backend", "private": True, "type": "module",
                       "scripts": {"start": "node src/index.js", "dev": "node --watch src/index.js",
                                   "setup": "node scripts/setup.js", "check": "node --check src/index.js"},
                       "dependencies": {"express": "4.21.2", "cheerio": "1.0.0", "dotenv": "16.4.7",
                                        "@prisma/client": "6.19.0", "prisma": "6.19.0"}}
    frontend_package = {"name": "converted-site-frontend", "private": True, "type": "module",
                        "scripts": {"dev": "vite --host 127.0.0.1", "build": "vite build", "preview": "vite preview"},
                        "dependencies": {"react": "18.3.1", "react-dom": "18.3.1", "lucide-react": "0.454.0"},
                        "devDependencies": {"vite": "6.4.1"}}
    app = (TEMPLATES / "App.jsx").read_text()
    server = (TEMPLATES / "server.js").read_text()
    return {
        "mode": "preserved-source",
        "backend": {"endpoints": [_file("src/index.js", server)], "models": [_file("prisma/schema.prisma", (TEMPLATES / "schema.prisma").read_text())],
                    "server_entry": _file("src/index.js", server), "health_check": _file("src/index.js", server),
                    "auth_middleware": _file("src/index.js", server), "package_json": _file("package.json", json.dumps(backend_package, indent=2)),
                    "files": [_file("scripts/setup.js", (TEMPLATES / "setup.js").read_text()),
                              _file("src/environment.js", (TEMPLATES / "environment.js").read_text()),
                              _file(".gitignore", ".env\nnode_modules/\nprisma/*.db*\nuploads/\n"),
                              _file("seed-data.json", json.dumps(seed, ensure_ascii=False)),
                              _file(".env.example", "# Local setup only. Change credentials before deployment.\n# Restart the backend after edits. Shell environment variables take precedence.\nDATABASE_URL=file:./site.db\nHOST=127.0.0.1\nPORT=5000\nADMIN_EMAIL=admin@gmail.com\nADMIN_PASSWORD=admin123\n")]},
        "frontend": {"pages": [_file("main.jsx", app)], "router": _file("main.jsx", app),
                     "components": [_file("main.jsx", app)],
                     "styles": [_file("style.css", (TEMPLATES / "style.css").read_text())],
                     "package_json": _file("package.json", json.dumps(frontend_package, indent=2)),
                     "index_html": _file("index.html", '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Converted website</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>'),
                     "main_entry": _file("main.jsx", app),
                     "files": [_file("vite.config.js", "export default { server: { proxy: { '/api': 'http://127.0.0.1:5000', '/__site': 'http://127.0.0.1:5000', '/assets': 'http://127.0.0.1:5000' } } };\n")]},
        "admin": {"resources": [_file("main.jsx", app)], "dashboard": _file("main.jsx", app),
                  "auth_guard": _file("main.jsx", app), "crud_views": [_file("main.jsx", app)]},
        "deployment": {"health_endpoint": "/health", "backend_start_command": "npm start", "frontend_build_command": "npm run build", "backend_runtime": "node>=20"},
        "template_scaffold": state.get("template_scaffold", {}),
        "entity_catalog": schema.get("entities", []),
        "source_assets": runtime_assets,
        "source_report": {"page_count": len(runtime_pages), "asset_count": len(runtime_assets),
                          "editable_field_count": sum(len(page["fields"]) for page in runtime_pages),
                          "routes": [page["route"] for page in runtime_pages],
                          "failed_pages": [item for item in captured.get("failures", []) if item.get("kind") == "page"],
                          "accepted_source_failures": list(captured.get("accepted_source_failures", [])),
                          "missing_assets": sorted(missing), "external_references": sorted(external)},
    }
