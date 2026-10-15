import json
from types import SimpleNamespace
from unittest.mock import patch

from src.config.settings import settings
from src.engine.job_store import InMemoryJobStore
from src.engine.schema_evidence import infer_all_pages
from src.engine.service import ConversionEngine


SCHEMA = '{"entities":[{"name":"Service","confidence":0.9,"fields":[{"name":"title","type":"string","confidence":0.9}]}]}'


def test_evidence_progress_covers_every_page_and_keeps_merged_counts():
    events = []
    llm = SimpleNamespace(invoke=lambda prompt: SCHEMA)
    result = infer_all_pages(["<p>" + "x" * 13000 + "</p>", "<p>second page</p>"],
                             llm, lambda pages: pages[0], json.loads, events.append)
    assert json.loads(result)["entities"]
    assert events[-1]["completed_batches"] == events[-1]["total_batches"] == 3
    assert events[-1]["entity_count"] == events[-1]["field_count"] == 1
    assert {event["page_number"] for event in events} == {1, 2}


def test_inference_progress_is_persisted_before_the_model_returns():
    store = InMemoryJobStore()
    observed = []
    class Model:
        def invoke(self, prompt):
            job = store.get_job(job_id)
            observed.append(job.schema_quality_report["inference_progress"])
            return SCHEMA
    with patch.object(ConversionEngine, "_build_failover_llm", return_value=Model()):
        engine = ConversionEngine(store=store)
    job_id = engine.create_job(html_pages=["<p>Consulting services and useful content.</p>"])["job_id"]
    engine.run_job(job_id)
    result = engine.infer_schema_stage(job_id)
    assert observed[0]["completed_batches"] == 0
    assert observed[0]["total_batches"] == 1
    assert result["status"] == "awaiting_approval"
    assert result["schema_quality_report"]["inference_progress"]["completed_batches"] == 1
    assert any(event.get("event_type") == "inference_progress" for event in result["trace_events"])


def test_all_configured_sdk_clients_receive_bounded_timeouts(monkeypatch):
    received = []
    def client(**kwargs):
        received.append(kwargs)
        return SimpleNamespace(invoke=lambda prompt: SCHEMA)
    module = SimpleNamespace(ChatOpenAI=client, ChatGroq=client,
                             ChatGoogleGenerativeAI=client, ChatAnthropic=client)
    for name in ("KIMI", "DEEPSEEK", "OPENAI", "GROQ", "GEMINI", "OPEN_SOURCE", "ANTHROPIC"):
        monkeypatch.setattr(settings, name + "_API_KEY", "test-only-key")
    monkeypatch.setattr(settings, "OPEN_SOURCE_BASE_URL", "https://provider.invalid")
    monkeypatch.setattr(settings, "KIMI_MODEL", "kimi-k2.6")
    monkeypatch.setattr("src.engine.service.importlib.import_module", lambda name: module)
    chain = ConversionEngine.__new__(ConversionEngine)._build_failover_llm()
    assert len(chain.models) == len(received) == 7
    assert all(options["timeout"] == settings.LLM_REQUEST_TIMEOUT_SECONDS for options in received)
    assert [options["max_retries"] for options in received] == [0, 0, 0, 0, 1, 0, 0]
    assert received[0]["temperature"] is None
    assert received[0]["extra_body"] == {"thinking": {"type": "disabled"}}
