from __future__ import annotations

import pytest

from src.api.run import DEFAULT_PORT, read_port


def test_read_port_uses_local_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PORT", raising=False)

    assert read_port() == DEFAULT_PORT


def test_read_port_accepts_configured_port(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PORT", " 8010 ")

    assert read_port() == 8010


@pytest.mark.parametrize("value", ["", "invalid", "0", "65536"])
def test_read_port_rejects_invalid_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("PORT", value)

    with pytest.raises(RuntimeError, match="PORT must be an integer"):
        read_port()
