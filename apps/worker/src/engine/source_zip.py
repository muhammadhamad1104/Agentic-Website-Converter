"""Bounded, path-safe inspection of static website archives."""
from __future__ import annotations

import posixpath
import stat
import zipfile
from pathlib import PurePosixPath
from bs4 import UnicodeDammit

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_MEMBERS = 20000
IGNORED_PARTS = {"__MACOSX", ".git", "node_modules", "__pycache__"}


def website_members(archive):
    infos = archive.infolist()
    if len(infos) > MAX_MEMBERS:
        raise ValueError("ZIP contains too many entries (maximum 20,000).")
    total = 0
    members = []
    seen = set()
    for item in infos:
        name = item.filename.replace("\\", "/")
        path = PurePosixPath(name)
        if name in {"", "."} or path.is_absolute() or ".." in path.parts or ":" in name or "\x00" in name:
            raise ValueError("ZIP contains an unsafe file path.")
        if stat.S_ISLNK(item.external_attr >> 16):
            raise ValueError("ZIP symbolic links are not supported.")
        if item.flag_bits & 1:
            raise ValueError("Password-protected ZIP files are not supported.")
        total += item.file_size
        if total > MAX_EXPANDED_BYTES:
            raise ValueError("Expanded ZIP exceeds the 512 MB limit.")
        if item.is_dir():
            continue
        name = path.as_posix()
        if name in seen:
            raise ValueError("ZIP contains duplicate file paths.")
        seen.add(name)
        if any(part in IGNORED_PARTS for part in path.parts) or path.name == ".DS_Store" or path.name.startswith(".env"):
            continue
        members.append((item, name))
    if not members:
        raise ValueError("ZIP does not contain any website files.")
    root = posixpath.commonpath([posixpath.dirname(name) for _, name in members])
    prefix = root + "/" if root else ""
    return [(item, name[len(prefix):]) for item, name in members]


def inspect_static_archive(path):
    from src.engine.nodes import _validate_static_zip_members, PHP_TAG_PATTERN
    try:
        with zipfile.ZipFile(path) as archive:
            members = website_members(archive)
            issues = _validate_static_zip_members([name for _, name in members])
            if issues:
                raise ValueError(" ".join(issues))
            pages = 0
            for item, name in members:
                content = archive.read(item)
                if PurePosixPath(name).suffix.lower() in {".html", ".htm"}:
                    if not content.strip():
                        raise ValueError("ZIP contains an empty HTML page: " + name)
                    markup = UnicodeDammit(content, is_html=True).unicode_markup or content.decode("utf-8", errors="replace")
                    if PHP_TAG_PATTERN.search(markup):
                        raise ValueError("ZIP contains server-side template tags: " + name)
                    pages += 1
            return {"pages": pages, "assets": len(members) - pages}
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError) as error:
        raise ValueError("ZIP is corrupt or uses an unsupported archive format.") from error
