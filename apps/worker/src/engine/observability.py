from __future__ import annotations

import os
from functools import wraps
from typing import Any, Callable, TypeVar

from src.config.settings import settings

F = TypeVar("F", bound=Callable[..., Any])

_configured = False


def _to_env_bool(value: bool) -> str:
    return "true" if value else "false"


def configure_langsmith() -> None:
    global _configured
    if _configured:
        return

    if settings.LANGSMITH_API_KEY.strip():
        os.environ.setdefault("LANGSMITH_TRACING", _to_env_bool(settings.LANGSMITH_TRACING))
        os.environ.setdefault("LANGSMITH_ENDPOINT", settings.LANGSMITH_ENDPOINT)
        os.environ.setdefault("LANGSMITH_API_KEY", settings.LANGSMITH_API_KEY)
        os.environ.setdefault("LANGSMITH_PROJECT", settings.LANGSMITH_PROJECT)

    _configured = True


def traced(name: str) -> Callable[[F], F]:
    """Return a LangSmith traceable decorator when available, otherwise no-op."""

    try:
        from langsmith import traceable  # type: ignore

        return traceable(name=name)
    except Exception:

        def _decorator(func: F) -> F:
            @wraps(func)
            def _wrapper(*args: Any, **kwargs: Any):
                return func(*args, **kwargs)

            return _wrapper  # type: ignore[return-value]

        return _decorator
