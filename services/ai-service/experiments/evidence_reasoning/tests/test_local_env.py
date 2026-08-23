from __future__ import annotations

import os

from experiments.evidence_reasoning.local_env import load_local_env


def test_load_local_env_loads_only_er_names_without_returning_values(tmp_path, monkeypatch) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text(
        "# local test\nER_OPENAI_API_KEY='test-secret'\nER_OPENAI_MODEL=example-model\nIGNORED=value\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("ER_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ER_OPENAI_MODEL", raising=False)

    loaded = load_local_env(env_path)

    assert loaded == frozenset({"ER_OPENAI_API_KEY", "ER_OPENAI_MODEL"})
    assert os.environ["ER_OPENAI_API_KEY"] == "test-secret"
    assert "test-secret" not in repr(loaded)
    assert "IGNORED" not in os.environ


def test_load_local_env_does_not_override_process_environment(tmp_path, monkeypatch) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("ER_OPENAI_MODEL=file-model\n", encoding="utf-8")
    monkeypatch.setenv("ER_OPENAI_MODEL", "session-model")

    loaded = load_local_env(env_path)

    assert loaded == frozenset()
    assert os.environ["ER_OPENAI_MODEL"] == "session-model"
