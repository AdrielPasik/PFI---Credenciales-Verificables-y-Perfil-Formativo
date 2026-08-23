from __future__ import annotations

import json
import os
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[2]
LOCAL_ENV_PATH = SERVICE_ROOT / ".env"


def _parse_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, str) else value
        except json.JSONDecodeError:
            return value[1:-1]
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1]
    return value


def load_local_env(path: Path = LOCAL_ENV_PATH) -> frozenset[str]:
    """Load local ER_* settings without overriding the process environment.

    Only variable names are returned; configuration values are never logged or
    included in CLI output.
    """
    if not path.is_file():
        return frozenset()

    loaded: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        name, raw_value = line.split("=", 1)
        name = name.strip()
        if not name.startswith("ER_") or not name.replace("_", "").isalnum():
            continue
        if name not in os.environ:
            os.environ[name] = _parse_value(raw_value)
            loaded.add(name)
    return frozenset(loaded)
