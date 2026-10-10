"""Save desktop/mobile source comparisons and browser diagnostics, not a fidelity score."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--converted", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            for width, height in [(1440, 900), (390, 844)]:
                for name, url in [("source", args.source), ("converted", args.converted)]:
                    context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
                    page = context.new_page()
                    errors = []
                    failures = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.on("response", lambda response: failures.append({"url": response.url, "status": response.status}) if response.status >= 400 else None)
                    page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(8000)
                    document = page.frames[1] if name == "converted" and len(page.frames) > 1 else page.main_frame
                    document.evaluate("document.fonts.ready")
                    for fraction in [0.25, 0.5, 0.75, 1, 0]:
                        document.evaluate("(fraction) => window.scrollTo(0, document.body.scrollHeight * fraction)", fraction)
                        page.wait_for_timeout(350)
                    page.wait_for_timeout(2000)
                    metrics = document.evaluate("""() => ({
                        title: document.title,
                        textLength: document.body.innerText.length,
                        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
                        images: [...document.images].map(img => ({
                            url: img.currentSrc || img.src, loaded: img.complete && img.naturalWidth > 0
                        }))
                    })""")
                    page.screenshot(path=str(output / f"{name}-{width}.png"), full_page=False)
                    report.append({"name": name, "viewport": width, **metrics, "errors": errors, "httpFailures": failures})
                    context.close()
        finally:
            browser.close()
    (output / "browser-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps([{**row, "images": {"total": len(row["images"]), "failed": sum(not img["loaded"] for img in row["images"])}} for row in report], indent=2))


if __name__ == "__main__":
    main()
