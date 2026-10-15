import json
from threading import Barrier, Event, Lock
from types import SimpleNamespace

import pytest

from src.engine.schema_evidence import infer_all_pages, plan_evidence, semantic_evidence


def schema(name="Service", field_type="string"):
    return json.dumps({"entities": [{"name": name, "confidence": 0.9, "fields": [
        {"name": "title", "type": field_type, "confidence": 0.9}]}]})


def test_compaction_retains_content_links_media_metadata_and_jsonld():
    original = '''<html><head><script type="application/ld+json">{"name":"Business"}</script>
    <style>.x{color:red}</style><script>danger()</script></head><body>
    <div><span><h1>Consulting</h1></span></div><a href="/services">Our services</a>
    <img src="/photo.jpg" srcset="/photo2.jpg 2x" alt="Our team" width="400">
    <section style="background-image:url('/background.jpg')">Advice</section>
    <svg aria-label="Company"><title>Brand</title><path d="very-long-geometry"/></svg>
    <input name="email" placeholder="Email"><meta property="og:title" content="Advisory">
    <div data-w-id="animation" data-product-id="123">Product</div><!-- secret comment -->
    </body></html>'''
    compact = semantic_evidence(original)
    for text in ("Business", "Consulting", "/services", "/photo.jpg", "/photo2.jpg", "Our team",
                 "/background.jpg", "Company", "Brand", "email", "Advisory", "123", "Product"):
        assert text in compact
    for text in ("danger()", "color:red", "very-long-geometry", "animation", "secret comment"):
        assert text not in compact
    assert "very-long-geometry" in original


def test_planner_covers_every_page_and_late_fragment_without_duplicate_pages():
    pages = ["<p>" + "x" * 25000 + "LAST</p>"] * 3 + ["<p>UNIQUE</p>"]
    batches = plan_evidence(pages)
    assert {page for batch in batches for page in batch["pages"]} == {1, 2, 3, 4}
    assert sum("LAST" in batch["text"] for batch in batches) == 1
    assert "UNIQUE" in batches[-1]["text"]
    assert plan_evidence([""])[0]["pages"] == [1]


def test_two_bounded_requests_run_concurrently_and_merge_in_source_order():
    barrier = Barrier(2, timeout=5)
    second_finished = Event()
    events, active, maximum = [], 0, 0
    lock = Lock()

    def invoke(prompt):
        nonlocal active, maximum
        with lock:
            active += 1
            maximum = max(maximum, active)
        barrier.wait()
        if "FIRST" in prompt:
            assert second_finished.wait(5)
            result = schema(field_type="string")
        else:
            result = schema(field_type="integer")
            second_finished.set()
        with lock:
            active -= 1
        return result

    result = json.loads(infer_all_pages(["<p>FIRST" + "a" * 1000, "<p>SECOND" + "b" * 1000],
        SimpleNamespace(invoke=invoke), lambda pages: pages[0], json.loads, events.append, max_chars=1200))
    assert maximum == 2
    assert result["entities"][0]["fields"][0]["type"] == "string"
    assert any("conflicting types" in item for item in result["assumptions"])
    assert [event["completed_batches"] for event in events] == sorted(event["completed_batches"] for event in events)
    assert events[-1]["completed_batches"] == 2


def test_validated_cache_reuses_completed_work_and_prompt_changes_invalidate(tmp_path):
    prompts = []
    def invoke(prompt):
        prompts.append(prompt)
        return schema()
    llm = SimpleNamespace(invoke=invoke)
    args = (["<h1>Services</h1>"], llm, lambda pages: pages[0], json.loads)
    infer_all_pages(*args, cache_dir=tmp_path)
    events = []
    infer_all_pages(*args, cache_dir=tmp_path, on_progress=events.append)
    assert len(prompts) == 1
    assert events[-1]["cached_batches"] == 1
    infer_all_pages(args[0], llm, lambda pages: "Feedback: use service titles\n" + pages[0], json.loads, cache_dir=tmp_path)
    assert len(prompts) == 2
    for cache in tmp_path.glob("*.json"):
        cache.write_text("broken")
    infer_all_pages(*args, cache_dir=tmp_path)
    assert len(prompts) == 3


def test_empty_content_fragment_is_not_retried_but_invalid_json_is():
    calls = []
    def invoke(prompt):
        calls.append(prompt)
        return '{"entities":[]}'
    result = json.loads(infer_all_pages(["<footer>Copyright</footer>"], SimpleNamespace(invoke=invoke),
                                      lambda pages: pages[0], json.loads))
    assert result["entities"] == [] and len(calls) == 1
    with pytest.raises(ValueError, match="Invalid schema response"):
        infer_all_pages(["<p>Text</p>"], SimpleNamespace(invoke=lambda _: '{}'), lambda pages: pages[0], json.loads)


def test_global_context_is_sent_once_not_repeated_per_page():
    batches = plan_evidence(["<p>" + "a" * 14000, "<p>" + "b" * 14000], extra_evidence=["CONTEXT", "CONTEXT"])
    assert sum(batch["text"].count("CONTEXT") for batch in batches) == 1


def test_identical_shared_sections_are_sent_once_with_page_references():
    footer = '<footer><p>' + 'Shared footer text. ' * 50 + '</p></footer>'
    batches = plan_evidence(['<h1>First</h1>' + footer, '<h1>Second</h1>' + footer])
    evidence = '\n'.join(batch['text'] for batch in batches)
    assert evidence.count('Shared footer text.') == 50
    assert 'First' in evidence and 'Second' in evidence
    assert 'source pages [1, 2]' in evidence and 'shared-evidence' in evidence
