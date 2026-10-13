"""Shared URL and CSS handling for capture and runtime export."""
from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urldefrag, quote, unquote

import tinycss2


def resolve_url(base: str, value: str) -> str:
    if base.startswith("zip://"):
        base = "https://zip.invalid/" + base[6:]
        resolved = urljoin(base, value)
        if resolved.startswith("https://zip.invalid/"):
            parsed = urlsplit(resolved)
            return "zip://" + quote(unquote(parsed.path.lstrip("/")), safe="/") + ("?" + parsed.query if parsed.query else "") + ("#" + parsed.fragment if parsed.fragment else "")
        return resolved
    return urljoin(base, value)


def asset_path(url: str) -> str:
    if url.startswith("zip://"):
        return "/" + url[6:].split("?", 1)[0].split("#", 1)[0]
    parsed = urlsplit(url)
    suffix = Path(parsed.path).suffix
    if not suffix or len(suffix) > 12:
        suffix = ".bin"
    return "/assets/source/" + hashlib.sha256(url.encode()).hexdigest()[:24] + suffix


def route_for(url: str) -> str:
    if url.startswith("inline://"):
        return "/" if url == "inline://page-1" else "/" + url[len("inline://"):]
    parsed = urlsplit(url)
    path = "/" + url[6:].split("?", 1)[0] if url.startswith("zip://") else parsed.path or "/"
    if url.startswith("zip://") and path.lower().endswith(("/index.html", "/index.htm")):
        path = path.rsplit("/", 1)[0] + "/"
    return path + ("?" + parsed.query if parsed.query else "")


def rewrite_css(css: str, rewrite) -> str:
    tokens = tinycss2.parse_component_value_list(css)

    def walk(items):
        for index, token in enumerate(items):
            if token.type == "url":
                value = rewrite(token.value)
                items[index] = tinycss2.ast.URLToken(token.source_line, token.source_column, value,
                                                     'url("' + tinycss2.serializer.serialize_string_value(value) + '")')
            elif token.type == "function" and token.lower_name == "url":
                values = [x for x in token.arguments if x.type not in {"whitespace", "comment"}]
                if len(values) == 1 and values[0].type == "string":
                    value = rewrite(values[0].value)
                    values[0].value = value
                    values[0].representation = '"' + tinycss2.serializer.serialize_string_value(value) + '"'
            elif token.type == "at-keyword" and token.lower_value == "import":
                following = next((x for x in items[index + 1:] if x.type not in {"whitespace", "comment"}), None)
                if following is not None and following.type == "string":
                    value = rewrite(following.value)
                    following.value = value
                    following.representation = '"' + tinycss2.serializer.serialize_string_value(value) + '"'
            if hasattr(token, "content"):
                walk(token.content)
            if token.type == "function" and token.lower_name != "url":
                walk(token.arguments)
    walk(tokens)
    return tinycss2.serialize(tokens)


def css_urls(css: str, base: str) -> set[str]:
    found = set()
    def collect(value):
        if value and not value.startswith(("data:", "#", "blob:")):
            found.add(urldefrag(resolve_url(base, value)).url)
        return value
    rewrite_css(css, collect)
    return found


def srcset_entries(value: str):
    # A data URL may contain commas; only a trailing comma ends its URL token.
    cursor = 0
    while cursor < len(value):
        while cursor < len(value) and (value[cursor].isspace() or value[cursor] == ","):
            cursor += 1
        start = cursor
        while cursor < len(value) and not value[cursor].isspace():
            cursor += 1
        url = value[start:cursor]
        if not url:
            break
        if url.endswith(","):
            yield url.rstrip(","), ""
            continue
        start = cursor
        while cursor < len(value) and value[cursor] != ",":
            cursor += 1
        yield url, value[start:cursor].strip()


def rewrite_srcset(value: str, rewrite) -> str:
    return ", ".join(rewrite(url) + (" " + descriptor if descriptor else "")
                     for url, descriptor in srcset_entries(value))
