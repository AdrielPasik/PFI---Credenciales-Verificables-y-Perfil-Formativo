from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from typing import Any

from .models import ProviderResult


class ProviderUnavailable(RuntimeError):
    pass


class ProviderResponseError(RuntimeError):
    pass


class StructuredProvider(ABC):
    @abstractmethod
    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        raise NotImplementedError


def _post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> tuple[dict[str, Any], int]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json", **headers},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        safe_body = exc.read().decode("utf-8", errors="replace")[:2000]
        raise ProviderResponseError(f"provider_http_{exc.code}:{safe_body}") from exc
    except urllib.error.URLError as exc:
        raise ProviderResponseError(f"provider_network_error:{exc.reason}") from exc
    return body, round((time.perf_counter() - started) * 1000)


class OpenAIResponsesProvider(StructuredProvider):
    def __init__(self) -> None:
        self.api_key = os.environ.get("ER_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        self.model = os.environ.get("ER_OPENAI_MODEL")
        self.base_url = os.environ.get("ER_OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        self.reasoning_effort = os.environ.get("ER_OPENAI_REASONING_EFFORT", "medium")
        self.timeout = int(os.environ.get("ER_PROVIDER_TIMEOUT_SECONDS", "180"))
        if not self.api_key:
            raise ProviderUnavailable("missing_ER_OPENAI_API_KEY_or_OPENAI_API_KEY")
        if not self.model:
            raise ProviderUnavailable("missing_ER_OPENAI_MODEL")

    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        payload = {
            "model": self.model,
            "input": prompt,
            "store": False,
            "reasoning": {"effort": self.reasoning_effort},
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "strict": True,
                    "schema": schema,
                }
            },
        }
        response, latency = _post_json(
            f"{self.base_url}/responses",
            {"authorization": f"Bearer {self.api_key}"},
            payload,
            self.timeout,
        )
        texts: list[str] = []
        for item in response.get("output", []):
            if item.get("type") != "message":
                continue
            for content in item.get("content", []):
                if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                    texts.append(content["text"])
        if not texts:
            raise ProviderResponseError("openai_response_missing_output_text")
        try:
            output = json.loads("".join(texts))
        except json.JSONDecodeError as exc:
            raise ProviderResponseError("openai_output_not_json") from exc
        return ProviderResult(
            output=output,
            provider="openai",
            requested_model=self.model,
            effective_model=str(response.get("model") or self.model),
            latency_ms=latency,
            usage=response.get("usage") or {},
            response_id=response.get("id"),
        )


class AnthropicMessagesProvider(StructuredProvider):
    def __init__(self) -> None:
        self.api_key = os.environ.get("ER_ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
        self.model = os.environ.get("ER_ANTHROPIC_MODEL")
        self.base_url = os.environ.get("ER_ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1").rstrip("/")
        self.max_tokens = int(os.environ.get("ER_ANTHROPIC_MAX_TOKENS", "8192"))
        self.timeout = int(os.environ.get("ER_PROVIDER_TIMEOUT_SECONDS", "180"))
        if not self.api_key:
            raise ProviderUnavailable("missing_ER_ANTHROPIC_API_KEY_or_ANTHROPIC_API_KEY")
        if not self.model:
            raise ProviderUnavailable("missing_ER_ANTHROPIC_MODEL")

    def complete(self, *, prompt: str, schema_name: str, schema: dict[str, Any]) -> ProviderResult:
        del schema_name
        payload = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "output_config": {"format": {"type": "json_schema", "schema": schema}},
        }
        response, latency = _post_json(
            f"{self.base_url}/messages",
            {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
            payload,
            self.timeout,
        )
        text = "".join(
            block.get("text", "")
            for block in response.get("content", [])
            if block.get("type") == "text"
        )
        if not text:
            raise ProviderResponseError("anthropic_response_missing_text")
        try:
            output = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProviderResponseError("anthropic_output_not_json") from exc
        usage = response.get("usage") or {}
        return ProviderResult(
            output=output,
            provider="anthropic",
            requested_model=self.model,
            effective_model=str(response.get("model") or self.model),
            latency_ms=latency,
            usage=usage,
            response_id=response.get("id"),
        )


def provider_from_name(name: str) -> StructuredProvider:
    normalized = name.strip().lower()
    if normalized == "openai":
        return OpenAIResponsesProvider()
    if normalized == "anthropic":
        return AnthropicMessagesProvider()
    raise ProviderUnavailable(f"unsupported_provider:{name}")

