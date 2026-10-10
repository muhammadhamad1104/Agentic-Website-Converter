"""Run the actual worker stages with configured providers, without a schema fixture."""
import argparse
import json
from pathlib import Path

from src.config.settings import settings
from src.engine.job_store import SqliteJobStore
from src.engine.service import ConversionEngine


class ObservedModel:
    def __init__(self, delegate, index):
        self.delegate = delegate
        self.index = index
        self.calls = 0
        self.successes = 0

    def invoke(self, prompt):
        self.calls += 1
        print(f"Provider {self.index}: request {self.calls} started ({len(prompt)} prompt characters)", flush=True)
        try:
            response = self.delegate.invoke(prompt)
        except Exception as error:
            print(f"Provider {self.index}: {type(error).__name__}", flush=True)
            raise
        self.successes += 1
        print(f"Provider {self.index}: response received ({len(response)} characters)", flush=True)
        return response


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--output", default="/tmp/converter-live-acceptance")
    parser.add_argument("--job-id", help="Resume a previously captured job in this output directory")
    parser.add_argument("--generate-only", action="store_true", help="Regenerate using the saved live schema")
    parser.add_argument("--export-only", action="store_true", help="Export saved generated files without rerunning models or builds")
    parser.add_argument("--accept-source-failure", action="append", default=[], metavar="URL",
                        help="Explicitly accept this exact failed source URL for this saved job")
    args = parser.parse_args()
    if args.generate_only and not args.job_id:
        parser.error("--generate-only requires --job-id")
    if args.export_only and (not args.job_id or args.generate_only):
        parser.error("--export-only requires --job-id and cannot be combined with --generate-only")
    if args.accept_source_failure and not args.generate_only:
        parser.error("--accept-source-failure requires --generate-only and --job-id")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    settings.GENERATED_OUTPUT_PATH = str(output)
    settings.LANGSMITH_TRACING = False
    settings.EXPORT_COPY_TO_DOWNLOADS = False
    engine = ConversionEngine(store=SqliteJobStore(str(output / "jobs.db")))
    observed = [ObservedModel(model, index) for index, model in enumerate(engine._llm.models, 1)]
    engine._llm.models = observed

    def record(stage, result):
        (output / f"{stage}.json").write_text(json.dumps(result, indent=2))
        print(json.dumps({"stage": stage, "job_id": result["job_id"], "status": result["status"],
                          "entities": len(result.get("schema_proposal", {}).get("entities", [])),
                          "build": result.get("validation_report", {}).get("build_status")}), flush=True)

    if args.job_id:
        result = engine.get_job(args.job_id)
    else:
        result = engine.create_job(input_url=args.url, crawl_config={
            "full_site": True, "max_pages": 0, "max_assets": 0,
            "render_js": True, "enforce_static_source": False,
        })
        record("created", result)
        result = engine.run_job(result["job_id"], target_stage="crawl")
        record("crawl", result)
    job_id = result["job_id"]
    if args.export_only:
        export = engine.export_job(job_id)
        (output / "export.json").write_text(json.dumps(export, indent=2))
        print(json.dumps({"export_status": export["export_status"], "quality_status": export["quality_status"],
                          "zip_path": export["download"]["zip_path"]}), flush=True)
        return
    if result["status"] == "failed" and not args.generate_only:
        raise SystemExit("Crawl failed; see crawl.json")
    if args.generate_only:
        if not result.get("schema_proposal", {}).get("entities") or result.get("schema_quality_report", {}).get("quality_gate") != "open":
            raise SystemExit("A saved, approved-quality schema is required for generation-only.")
        job = engine.store.get_job(job_id)
        known_failures = {item.get("url") for item in job.crawl_artifacts.get("failures", [])
                          if item.get("kind") in {"page", "asset"}}
        known_failures.update(job.generated_artifacts.get("source_report", {}).get("missing_assets", []))
        unknown = set(args.accept_source_failure) - known_failures
        if unknown:
            raise SystemExit("URLs are not recorded source failures: " + ", ".join(sorted(unknown)))
        accepted = set(job.crawl_artifacts.get("accepted_source_failures", []))
        accepted.update(args.accept_source_failure)
        job.crawl_artifacts["accepted_source_failures"] = sorted(accepted)
        job.generated_artifacts = {}
        job.artifact_generation_report = {}
        job.validation_report = {}
        job.errors = []
        engine.store.save_job(job)
    else:
        result = engine.infer_schema_stage(job_id)
        record("schema", result)
        (output / "provider-audit.json").write_text(json.dumps([
            {"provider_index": model.index, "attempts": model.calls, "successful_responses": model.successes}
            for model in observed], indent=2))
        if result["status"] != "awaiting_approval":
            raise SystemExit("Live schema inference did not pass. No fixture was substituted; see schema.json.")
    # This acceptance runner approves the inferred proposal under the user's
    # request to run conversion. The application still uses its normal human gate.
    engine.decide_schema(job_id, "approved")
    result = engine.run_job(job_id, target_stage="generate")
    record("generated", result)
    if result.get("generated_artifacts"):
        export = engine.export_job(job_id)
        (output / "export.json").write_text(json.dumps(export, indent=2))
        print("Export available. Quality status: " + export["quality_status"], flush=True)
    else:
        print("No generated files available; see generated.json.", flush=True)


if __name__ == "__main__":
    main()
