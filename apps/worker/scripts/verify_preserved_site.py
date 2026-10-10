"""Capture a public site and produce a reproducible runtime diagnostic report.

Run from apps/worker with PYTHONPATH=. This deliberately uses a small schema
fixture to test source fidelity independently of model-provider availability.
It is not an end-to-end LLM acceptance test.
"""
import argparse
import json
from pathlib import Path

from src.config.settings import settings
from src.engine.nodes import crawl_site_node
from src.engine.preserved_site import generate_preserved_site
from src.engine.runtime_validation import validate_runtime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--output", default="/tmp/converter-acceptance")
    parser.add_argument("--reuse-capture", action="store_true")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    settings.GENERATED_OUTPUT_PATH = str(output)
    capture_path = output / "capture.json"
    if args.reuse_capture:
        state = json.loads(capture_path.read_text())
    else:
        state = crawl_site_node({
            "job_id": "source-acceptance", "input_url": args.url,
            "crawl_full_site": True, "crawl_max_pages": 0, "crawl_max_assets": 0,
            "crawl_depth_limit": 3, "crawl_render_js": True,
            "crawl_enforce_static_source": False, "errors": [],
        })
        capture_path.write_text(json.dumps(state, indent=2))
    print(json.dumps({"capture": state.get("crawl_artifacts", {}).get("totals"),
                      "failures": state.get("crawl_artifacts", {}).get("failures", [])}), flush=True)
    state["schema_proposal"] = {"entities": [{"name": "Service", "fields": [
        {"name": "title", "type": "string"}, {"name": "description", "type": "text"}]}]}
    state["generated_artifacts"] = generate_preserved_site(state)
    (output / "runtime.json").write_text(json.dumps(state))
    print(json.dumps(state["generated_artifacts"]["source_report"]), flush=True)
    result = validate_runtime(state)
    (output / "validation.json").write_text(json.dumps(result["validation_report"], indent=2))
    print(json.dumps(result["validation_report"], indent=2), flush=True)


if __name__ == "__main__":
    main()
