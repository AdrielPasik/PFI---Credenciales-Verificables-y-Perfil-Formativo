from __future__ import annotations

from typing import Any

from .b24_prompts import (
    b24_evidence_unit_quote_first_prompt,
    objective_analysis_prompt as b24_objective_analysis_prompt,
    unified_reasoning_prompt as b24_unified_reasoning_prompt,
)
from .b24_versions import B24_PROMPT_VERSIONS
from .b241_versions import B241_PROMPT_VERSIONS, B2_NO_FORCED_CONTINUITY_USEFULNESS

# STRICT PROMPT-CONSTRUCTION FREEZE.
#
# The successor deliberately does NOT re-author B2.4's prompt text. It renders
# B2.4's own prompt and performs exactly one deterministic insertion, so that
# every other byte is provably identical. No clause-composition architecture is
# introduced here: that remains a documented future methodological improvement.

# Anchor: the last line of B2.4's continuity/usefulness block. The restored B2
# clause is appended immediately after it, where both continuity and usefulness
# are in scope -- the same referents B2's own sentence addresses.
_ANCHOR = (
    "MATERIAL USEFULNESS (solo si continuity=YES): si continuity no es YES, "
    "devolvé NOT_EVALUATED. La utilidad nunca rescata un semantic shift."
)


class BaselineRestorationError(RuntimeError):
    """Raised when the single authorized insertion cannot be applied exactly once."""


def b241_evidence_unit_quote_first_prompt(sources: list[dict[str, Any]]) -> str:
    """Unchanged from B2/B2.4."""
    return b24_evidence_unit_quote_first_prompt(sources)


def objective_analysis_prompt(objective: str) -> str:
    """Unchanged from B2.4. Only the version identifier differs."""
    rendered = b24_objective_analysis_prompt(objective)
    return rendered.replace(
        f"PROMPT_VERSION={B24_PROMPT_VERSIONS['objectiveAnalysis']}",
        f"PROMPT_VERSION={B241_PROMPT_VERSIONS['objectiveAnalysis']}",
    )


def unified_reasoning_prompt(context: dict[str, Any]) -> str:
    """B2.4's unified prompt plus exactly one restored B2 baseline clause."""
    rendered = b24_unified_reasoning_prompt(context)

    if rendered.count(_ANCHOR) != 1:
        raise BaselineRestorationError(
            f"anchor_not_found_exactly_once:{rendered.count(_ANCHOR)}"
        )
    if B2_NO_FORCED_CONTINUITY_USEFULNESS in rendered:
        raise BaselineRestorationError("clause_already_present_in_predecessor_prompt")

    repaired = rendered.replace(
        _ANCHOR,
        f"{_ANCHOR} {B2_NO_FORCED_CONTINUITY_USEFULNESS}",
        1,
    )
    return repaired.replace(
        f"PROMPT_VERSION={B24_PROMPT_VERSIONS['unifiedContextualReasoning']}",
        f"PROMPT_VERSION={B241_PROMPT_VERSIONS['unifiedContextualReasoning']}",
    )
