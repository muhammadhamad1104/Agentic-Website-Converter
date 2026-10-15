from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from threading import RLock
from time import monotonic


class PromptLLM(Protocol):
    def invoke(self, prompt: str) -> str:
        ...


class LangChainChatAdapter:
    """Adapter that returns string output from LangChain chat models."""

    def __init__(self, chat_model: Any, name: str = "LLM") -> None:
        self._chat_model = chat_model
        self.name = name

    def invoke(self, prompt: str) -> str:
        response = self._chat_model.invoke(prompt)
        return getattr(response, "content", str(response))


class FailoverLLM:
    def __init__(self, models=None, primary=None, secondary=None):
        self.models = list(models) if models is not None else [model for model in (primary, secondary) if model is not None]
        self._preferred = 0
        self._health_lock = RLock()
        self._blocked_until = {}

    def invoke(self, prompt: str, on_event=None) -> str:
        failures = []
        with self._health_lock:
            order = sorted((index for index in range(len(self.models))
                            if self._blocked_until.get(index, 0) <= monotonic()),
                           key=lambda index: index != self._preferred)
        for index in order:
            model = self.models[index]
            name = getattr(model, "name", type(model).__name__)
            if on_event:
                on_event({"provider": name, "message": f"Waiting for {name} response (request timeout configured)."})
            try:
                result = model.invoke(prompt)
            except Exception as e:
                code = getattr(e, "status_code", None) or getattr(e, "code", None)
                with self._health_lock:
                    self._blocked_until[index] = monotonic() + (300 if code in (401, 402, 403, 404) else 30)
                reason = {401: "authentication rejected", 402: "provider credit unavailable", 403: "access denied",
                          404: "configured model unavailable", 429: "rate limit or quota exceeded",
                          503: "provider temporarily unavailable"}.get(code)
                reason = reason or ("request timed out" if "timeout" in type(e).__name__.lower() else "request failed")
                failures.append(f"{name}: {reason}")
                if on_event:
                    on_event({"provider": name, "message": f"{name}: {reason}; trying another configured provider."})
                continue
            with self._health_lock:
                self._preferred = index
                self._blocked_until.pop(index, None)
            return result
        if failures:
            raise RuntimeError("All LLM providers failed. " + "; ".join(failures) + ". Check provider quota, credentials and connectivity.")
        if self.models:
            raise RuntimeError("LLM providers are temporarily unavailable after recent failures. Retry shortly; completed evidence is saved.")
        raise RuntimeError("No LLM models configured.")
