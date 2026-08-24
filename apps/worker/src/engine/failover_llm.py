from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class PromptLLM(Protocol):
    def invoke(self, prompt: str) -> str:
        ...


class LangChainChatAdapter:
    """Adapter that returns string output from LangChain chat models."""

    def __init__(self, chat_model: Any) -> None:
        self._chat_model = chat_model

    def invoke(self, prompt: str) -> str:
        response = self._chat_model.invoke(prompt)
        return getattr(response, "content", str(response))


@dataclass
class FailoverLLM:
    models: list[PromptLLM]

    def invoke(self, prompt: str) -> str:
        last_exception = None
        for model in self.models:
            try:
                return model.invoke(prompt)
            except Exception as e:
                last_exception = e
                continue
        if last_exception:
            raise RuntimeError(f"All LLM models failed. Last error: {last_exception}")
        raise RuntimeError("No LLM models configured.")
