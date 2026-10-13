"""Opt in with RUN_RUNTIME_INTEGRATION=1; requires Node, npm and Chromium."""
import base64
import os
import socket
import sqlite3
import stat
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

import pytest
import requests

from src.config.settings import settings
from src.engine.preserved_site import generate_preserved_site
from src.engine.runtime_validation import validate_runtime

pytestmark = pytest.mark.skipif(os.environ.get("RUN_RUNTIME_INTEGRATION") != "1",
                               reason="Opt-in generated runtime build and browser test")


@contextmanager
def running_site(project, env):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    with (project / "test-server.log").open("a") as log:
        process = subprocess.Popen(["node", "src/index.js"], cwd=project / "backend",
                                   env={**env, "PORT": str(port), "HOST": "127.0.0.1"}, stdout=log, stderr=log)
        try:
            for _ in range(100):
                assert process.poll() is None, (project / "test-server.log").read_text()
                try:
                    if requests.get(base + "/health", timeout=1).ok:
                        break
                except requests.RequestException:
                    pass
                time.sleep(.1)
            else:
                pytest.fail("Generated backend never became healthy")
            yield base
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def test_admin_edits_uploads_records_and_deletions_survive_restart(tmp_path, monkeypatch):
    from playwright.sync_api import sync_playwright
    monkeypatch.setattr(settings, "GENERATED_OUTPUT_PATH", str(tmp_path))
    image = tmp_path / "pixel.png"
    image.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII="))
    state = {
        "job_id": "integration",
        "schema_proposal": {"entities": [{"name": "Service", "fields": [{"name": "title", "type": "string"}]}]},
        "crawled_page_map": {
            "https://example.com/": '<html><head><title>Original</title></head><body><h1>Original heading</h1><img src="/pixel.png"><a href="/contact">Contact</a></body></html>',
            "https://example.com/contact": "<html><body><h1>Contact</h1></body></html>",
        },
        "crawl_artifacts": {"assets": [{"url": "https://example.com/pixel.png", "storage_path": str(image), "content_type": "image/png"}]},
    }
    state["generated_artifacts"] = generate_preserved_site(state)
    state["generated_artifacts"]["source_report"]["missing_assets"] = ["https://example.com/unavailable.js"]
    state["crawl_artifacts"]["accepted_source_failures"] = ["https://example.com/unavailable.js"]
    validation = validate_runtime(state)["validation_report"]
    assert validation["build_status"] == "passed", validation
    assert validation["validation_gate"] == "open", validation
    assert validation["source_completeness"] == "incomplete"
    assert validation["issues"][0]["severity"] == "warning"
    project = Path(validation["project_dir"])
    env = {**os.environ, "DATABASE_URL": "file:./verification.db",
           "ADMIN_EMAIL": "test@example.com", "ADMIN_PASSWORD": "Test-only-password-294"}
    with running_site(project, {**env, 'PREVIEW_MODE': '1'}) as base:
        assert requests.get(base + "/api/admin/pages").status_code == 401
        login = requests.post(base + "/api/admin/login", json={"email": env["ADMIN_EMAIL"], "password": env["ADMIN_PASSWORD"]})
        assert login.ok, login.text
        headers = {"Authorization": "Bearer " + login.json()["token"]}
        pages = requests.get(base + "/api/admin/pages", headers=headers).json()
        home = next(page for page in pages if page["route"] == "/")
        contact = next(page for page in pages if page["route"] == "/contact")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                tab = browser.new_page(viewport={"width": 1440, "height": 900})
                tab.goto(base + '/')
                tab.evaluate("""base => {
                    const frame = document.createElement('iframe');
                    frame.title = 'Sandbox preview';
                    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
                    frame.style.cssText = 'width:100%;height:850px;border:0';
                    frame.src = base + '/';
                    document.body.replaceChildren(frame);
                }""", base)
                source = tab.frame_locator('iframe[title="Sandbox preview"]').frame_locator('iframe')
                source.get_by_role('heading', name='Original heading', exact=True).wait_for()
                source.get_by_role('link', name='Contact', exact=True).click()
                source.get_by_role('heading', name='Contact', exact=True).wait_for()
                assert tab.url == base + '/'
                tab.goto(base + "/admin")
                tab.get_by_label("Email").fill(env["ADMIN_EMAIL"])
                tab.get_by_label("Password", exact=True).fill(env["ADMIN_PASSWORD"])
                tab.get_by_role("button", name="Sign in", exact=True).click()
                tab.get_by_role("heading", name="Overview", exact=True).wait_for()
                tab.get_by_role("navigation").get_by_role("button", name="Pages").click()
                tab.get_by_label("Search pages").fill("missing page")
                tab.get_by_role("heading", name="No matching pages").wait_for()
                tab.get_by_label("Search pages").fill("Original")
                tab.get_by_role("button", name="Original /", exact=False).click()
                tab.get_by_label("h1: Original heading", exact=True).fill("Edited heading")
                tab.get_by_role("button", name="Save", exact=True).click()
                tab.get_by_role("status").filter(has_text="Saved").wait_for()
                for width, height in [(1440, 900), (390, 844)]:
                    tab.set_viewport_size({"width": width, "height": height})
                    tab.screenshot(path=str(tmp_path / f"admin-{width}.png"), full_page=True)
                    assert tab.evaluate("document.documentElement.scrollWidth <= innerWidth")
                tab.get_by_role("button", name="Open navigation").click()
                tab.get_by_role("navigation").get_by_role("button", name="Media library").click()
                tab.get_by_label("Media type").select_option("image")
                assert tab.locator(".media-item").count() == 1
                tab.get_by_label("Search media").fill("missing asset")
                tab.get_by_role("heading", name="No matching assets").wait_for()
                tab.get_by_role("button", name="Open navigation").click()
                tab.get_by_role("navigation").get_by_role("button", name="Collections").click()
                tab.locator(".collection-list").get_by_role("button", name="Service").click()
                tab.get_by_label("title", exact=True).fill("Browser record")
                tab.get_by_role("button", name="Save record", exact=True).click()
                tab.get_by_role("status").filter(has_text="Record saved").wait_for()
                assert tab.locator(".record-table").get_by_text("Browser record", exact=True).count() == 1
                tab.get_by_label("title", exact=True).fill("Updated browser record")
                tab.get_by_role("button", name="Save record", exact=True).click()
                tab.locator(".record-table").get_by_text("Updated browser record", exact=True).wait_for()
                tab.once("dialog", lambda dialog: dialog.accept())
                tab.get_by_role("button", name="Delete record ").click()
                tab.get_by_role("heading", name="No records yet").wait_for()
                assert tab.evaluate("document.documentElement.scrollWidth <= innerWidth")
                tab.goto(base)
                frame = tab.frame_locator('iframe[title="Website"]')
                frame.get_by_role("heading", name="Edited heading").wait_for()
                assert frame.locator("img").evaluate("(img) => img.complete && img.naturalWidth > 0")
                frame.get_by_role("link", name="Contact", exact=True).click()
                tab.wait_for_url(base + "/contact")
            finally:
                browser.close()
        uploaded = requests.post(base + "/api/admin/media", headers={**headers, "Content-Type": "image/png; charset=binary"}, data=image.read_bytes())
        assert uploaded.status_code == 201, uploaded.text
        media_url = uploaded.json()["url"]
        assert requests.get(base + media_url).content == image.read_bytes()
        page = requests.get(base + "/api/admin/pages/" + home["id"], headers=headers).json()
        image_field = next(field for field in page["fields"] if field.get("attribute") == "src")
        image_field["value"] = media_url
        assert requests.put(base + "/api/admin/pages/" + home["id"], headers=headers, json=page).ok
        assert media_url in requests.get(base + "/__site/").text
        record = requests.post(base + "/api/admin/records/Service", headers=headers, json={"title": "Consulting"})
        assert record.status_code == 201, record.text
        duplicate = requests.post(base + "/api/admin/pages", headers=headers, json={"sourceId": home["id"], "route": "/draft"})
        assert duplicate.status_code == 201, duplicate.text
        assert requests.get(base + "/__site/draft").status_code == 404
        assert requests.delete(base + "/api/admin/pages/" + contact["id"], headers=headers).ok
    with running_site(project, env) as base:
        assert "Edited heading" in requests.get(base + "/__site/").text
        assert requests.get(base + "/__site/contact").status_code == 404
        assert any(item["url"] == media_url for item in requests.get(base + "/api/admin/media", headers=headers).json())
        assert requests.get(base + "/api/admin/records/Service", headers=headers).json()[0]["data"]["title"] == "Consulting"
        assert requests.post(base + "/api/admin/logout", headers=headers).ok
        assert requests.get(base + "/api/admin/pages", headers=headers).status_code == 401

    environment_file = project / "backend" / ".env"
    assert environment_file.is_file()
    if os.name != "nt":
        assert stat.S_IMODE(environment_file.stat().st_mode) == 0o600
    local_env = {key: value for key, value in env.items() if key not in {"ADMIN_EMAIL", "ADMIN_PASSWORD"}}
    local_env["NODE_ENV"] = "development"
    with running_site(project, local_env) as base:
        config = requests.get(base + "/api/admin/config").json()
        assert set(config) == {"siteTitle", "coverImage"}
        assert config["coverImage"].startswith("/assets/")
        assert requests.get(base + config["coverImage"]).ok
        assert requests.get(base + "/api/admin/account").status_code == 401
        credentials = {"email": "admin@gmail.com", "password": "admin123"}
        login = requests.post(base + "/api/admin/login", json=credentials)
        assert login.ok, login.text
        default_headers = {"Authorization": "Bearer " + login.json()["token"]}
        assert requests.get(base + "/api/admin/account", headers=default_headers).json()["defaultCredentials"] is True
        for frontend_file in [project / "frontend" / "src" / "main.jsx", *(project / "frontend" / "dist").rglob("*.js")]:
            frontend_code = frontend_file.read_text()
            assert "admin@gmail.com" not in frontend_code
            assert "admin123" not in frontend_code
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                tab = browser.new_page()
                for width, height in [(1440, 900), (390, 844)]:
                    tab.set_viewport_size({"width": width, "height": height})
                    tab.goto(base + "/admin")
                    tab.get_by_role("button", name="Sign in", exact=True).wait_for()
                    assert "admin@gmail.com" not in tab.locator("body").inner_text()
                    assert "admin123" not in tab.locator("body").inner_text()
                    assert tab.get_by_label("Email").input_value() == ""
                    assert tab.get_by_label("Password", exact=True).input_value() == ""
                    tab.get_by_label("Password", exact=True).fill("visibility-test")
                    tab.get_by_role("button", name="Show password", exact=True).click()
                    assert tab.get_by_label("Password", exact=True).get_attribute("type") == "text"
                    tab.get_by_label("Password", exact=True).fill("")
                    tab.screenshot(path=str(tmp_path / f"login-{width}.png"), full_page=True)
                    assert tab.evaluate("document.documentElement.scrollWidth <= innerWidth")
            finally:
                browser.close()

    for extra in [{"NODE_ENV": "production", "HOST": "127.0.0.1"}, {"HOST": "0.0.0.0"}]:
        rejected = subprocess.run(["node", "src/index.js"], cwd=project / "backend",
                                  env={**local_env, **extra}, capture_output=True, text=True, timeout=15)
        assert rejected.returncode != 0
        assert "Default admin credentials are local-only" in rejected.stderr

    replacement = environment_file.read_text().replace("ADMIN_EMAIL=admin@gmail.com", "ADMIN_EMAIL=owner@example.com")
    replacement = replacement.replace("ADMIN_PASSWORD=admin123", "ADMIN_PASSWORD=Replaced-local-secret-572")
    environment_file.write_text(replacement)
    with running_site(project, local_env) as base:
        assert environment_file.read_text() == replacement
        assert set(requests.get(base + "/api/admin/config").json()) == {"siteTitle", "coverImage"}
        assert requests.post(base + "/api/admin/login", json=credentials).status_code == 401
        assert requests.get(base + "/api/admin/pages", headers=default_headers).status_code == 401
        replacement_login = requests.post(base + "/api/admin/login", json={
            "email": "owner@example.com", "password": "Replaced-local-secret-572"})
        assert replacement_login.ok
        replacement_headers = {"Authorization": "Bearer " + replacement_login.json()["token"]}
        assert requests.get(base + "/api/admin/account", headers=replacement_headers).json()["defaultCredentials"] is False
        assert "Replaced-local-secret-572" not in requests.get(base + "/.env").text
    with sqlite3.connect(project / "backend" / "prisma" / "verification.db") as connection:
        admins = connection.execute('SELECT email, passwordHash FROM SiteAdmin').fetchall()
    assert len(admins) == 1
    assert admins[0][0] == "owner@example.com"
    assert admins[0][1] != "Replaced-local-secret-572"
    assert len(admins[0][1].split(":")) == 2
