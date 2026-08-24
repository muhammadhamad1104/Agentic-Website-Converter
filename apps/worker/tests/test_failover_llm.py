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
