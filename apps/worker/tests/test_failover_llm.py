from __future__ import annotations

from src.engine.failover_llm import FailoverLLM


class _PrimaryFails:
    def invoke(self, prompt: str) -> str:
        raise RuntimeError("429: rate limit")


class _SecondaryWorks:
    def invoke(self, prompt: str) -> str:
        return f"fallback:{prompt}"


class _PrimaryWorks:
    def invoke(self, prompt: str) -> str:
        return f"primary:{prompt}"


class _SecondaryShouldNotRun:
    def invoke(self, prompt: str) -> str:
        raise AssertionError("Secondary should not be called when primary succeeds")


def test_failover_uses_secondary_when_primary_fails() -> None:
    llm = FailoverLLM(primary=_PrimaryFails(), secondary=_SecondaryWorks())
    result = llm.invoke("infer entities")
    assert result == "fallback:infer entities"


def test_failover_prefers_primary_when_available() -> None:
    llm = FailoverLLM(primary=_PrimaryWorks(), secondary=_SecondaryShouldNotRun())
    result = llm.invoke("infer entities")
    assert result == "primary:infer entities"


def test_failover_reuses_successful_provider_for_later_evidence_batches():
    class Primary:
        calls = 0
        def invoke(self, prompt):
            self.calls += 1
            raise TimeoutError("private provider response")
    primary = Primary()
    llm = FailoverLLM(primary=primary, secondary=_SecondaryWorks())
    assert llm.invoke("one") == "fallback:one"
    assert llm.invoke("two") == "fallback:two"
    assert primary.calls == 1


def test_provider_failures_are_visible_without_leaking_error_bodies():
    class Rejected:
        name = "Example"
        def invoke(self, prompt):
            raise TimeoutError("secret-from-provider")
    events = []
    import pytest
    with pytest.raises(RuntimeError, match="request timed out") as error:
        FailoverLLM(models=[Rejected()]).invoke("prompt", on_event=events.append)
    assert "secret-from-provider" not in str(error.value)
    assert all("secret-from-provider" not in event["message"] for event in events)
    assert any("timed out" in event["message"] for event in events)
