from __future__ import annotations

from pathlib import Path
from typing import Any
import re


ROOT = Path(__file__).resolve().parent
BEHAVIOR_FILES = tuple(sorted(path.name for path in ROOT.glob("b22_*.py") if path.name not in {"b22_audit.py"}))
TECHNOLOGY_OR_SEED_TERMS = ("kubernetes", "pcb", "cfd", "microbiología", "sismo", "apis")


def development_overfitting_check() -> dict[str, Any]:
    hits: list[dict[str, str]] = []
    for name in BEHAVIOR_FILES:
        text = (ROOT / name).read_text(encoding="utf-8").casefold()
        for term in TECHNOLOGY_OR_SEED_TERMS:
            if term in text: hits.append({"file": name, "term": term})
        if re.search(r"case[_ ]?(?:id|0\d)\s*(?:==|!=|in\s*\{)", text):
            hits.append({"file": name, "term": "case_specific_literal_or_branch"})
    runtime_or_prompt = [(ROOT / name).read_text(encoding="utf-8").casefold() for name in ("b22_runtime.py", "b22_prompts.py")]
    gold_import = any("from .gold" in text or "import gold" in text for text in runtime_or_prompt)
    if gold_import: hits.append({"file": "runtime_or_prompts", "term": "gold_import"})
    return {"artifact": "B22_DEVELOPMENT_OVERFITTING_CHECK", "filesInspected": list(BEHAVIOR_FILES), "forbiddenTechnologyOrSeedTerms": list(TECHNOLOGY_OR_SEED_TERMS), "runtimeOrPromptsImportGold": gold_import, "findings": hits, "DEVELOPMENT_OVERFITTING_CHECK": "PASS" if not hits else "FAIL"}
