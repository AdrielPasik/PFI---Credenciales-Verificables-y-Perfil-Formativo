import json
from pathlib import Path
from typing import Any, Dict


DEFAULT_CONFIG_PATH = Path("config/settings.json")


def load_config(config_path: Path | None = None) -> Dict[str, Any]:
    path = config_path or DEFAULT_CONFIG_PATH
    if not path.exists():
        raise FileNotFoundError(f"No existe el archivo de configuracion: {path}")

    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
