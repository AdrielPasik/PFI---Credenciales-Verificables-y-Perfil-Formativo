from __future__ import annotations

from typing import Any

from experiments.evidence_reasoning import providers


SIMPLE_SCHEMA = {
    "type": "object",
    "properties": {"value": {"type": "string"}},
    "required": ["value"],
    "additionalProperties": False,
}


def test_openai_adapter_uses_responses_structured_output(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int):
        captured.update({"url": url, "headers": headers, "payload": payload, "timeout": timeout})
        return {
            "id": "response-test", "model": "configured-openai-model",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": '{"value":"ok"}'}]}],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }, 4

    monkeypatch.setenv("ER_OPENAI_API_KEY", "test-only-secret")
    monkeypatch.setenv("ER_OPENAI_MODEL", "configured-openai-model")
    monkeypatch.setattr(providers, "_post_json", fake_post)
    result = providers.OpenAIResponsesProvider().complete(prompt="synthetic", schema_name="simple", schema=SIMPLE_SCHEMA)
    assert result.output == {"value": "ok"}
    assert captured["url"].endswith("/responses")
    assert captured["payload"]["store"] is False
    assert captured["payload"]["text"]["format"]["type"] == "json_schema"
    assert captured["payload"]["text"]["format"]["strict"] is True


def test_anthropic_adapter_uses_output_config_schema(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_post(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int):
        captured.update({"url": url, "headers": headers, "payload": payload, "timeout": timeout})
        return {
            "id": "message-test", "model": "configured-anthropic-model",
            "content": [{"type": "text", "text": '{"value":"ok"}'}],
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }, 5

    monkeypatch.setenv("ER_ANTHROPIC_API_KEY", "test-only-secret")
    monkeypatch.setenv("ER_ANTHROPIC_MODEL", "configured-anthropic-model")
    monkeypatch.setattr(providers, "_post_json", fake_post)
    result = providers.AnthropicMessagesProvider().complete(prompt="synthetic", schema_name="simple", schema=SIMPLE_SCHEMA)
    assert result.output == {"value": "ok"}
    assert captured["url"].endswith("/messages")
    assert captured["payload"]["output_config"]["format"] == {"type": "json_schema", "schema": SIMPLE_SCHEMA}

