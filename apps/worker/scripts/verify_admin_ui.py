"""Read-only browser checks of a generated admin; credentials come from the environment."""
import argparse
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--output", default="/tmp/converter-admin-check")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    errors = []
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for width, height in [(1440, 900), (390, 844)]:
                tab = browser.new_page(viewport={"width": width, "height": height})
                tab.on("pageerror", lambda error: errors.append(str(error)))

                def capture(name):
                    tab.screenshot(path=str(output / f"{name}-{width}.png"), full_page=False)
                    assert tab.evaluate("document.documentElement.scrollWidth <= innerWidth"), name
                    checks.append(f"{name}-{width}")

                def navigate(name):
                    if width < 900:
                        tab.get_by_role("button", name="Open navigation").click()
                    tab.get_by_role("navigation").get_by_role("button", name=name).click()

                tab.goto(args.url.rstrip("/") + "/admin")
                tab.get_by_role("button", name="Sign in", exact=True).wait_for()
                assert os.environ["ADMIN_PASSWORD"] not in tab.locator("body").inner_text()
                assert os.environ["ADMIN_EMAIL"] not in tab.locator("body").inner_text()
                capture("login")
                tab.get_by_label("Email").fill(os.environ["ADMIN_EMAIL"])
                tab.get_by_label("Password", exact=True).fill(os.environ["ADMIN_PASSWORD"])
                tab.get_by_role("button", name="Sign in", exact=True).click()
                tab.get_by_role("heading", name="Overview", exact=True).wait_for()
                tab.locator(".media-strip img").first.wait_for()
                tab.wait_for_function("Array.from(document.querySelectorAll('.media-strip img')).every(img => img.complete && img.naturalWidth > 0)")
                capture("overview")
                navigate("Pages")
                tab.get_by_label("Search pages").fill("missing-test-page")
                tab.get_by_role("heading", name="No matching pages").wait_for()
                tab.get_by_label("Search pages").fill("")
                capture("pages")
                tab.locator(".page-link").first.click()
                tab.get_by_role("heading", name="Page settings").wait_for()
                capture("editor")
                navigate("Media library")
                tab.get_by_label("Media type").select_option("image")
                assert tab.locator(".media-item").count() > 0
                capture("media")
                navigate("Collections")
                tab.locator(".collection-list button").first.click()
                tab.get_by_role("button", name="Save record", exact=True).wait_for()
                capture("collections")
                if width < 900:
                    tab.get_by_role("button", name="Open navigation").click()
                    capture("navigation")
                    tab.keyboard.press("Escape")
                    assert not tab.locator(".sidebar").evaluate("(element) => element.classList.contains('open')")
                tab.close()
        finally:
            browser.close()
    assert not errors, errors
    report = {"checks": checks, "browser_errors": errors}
    (output / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
