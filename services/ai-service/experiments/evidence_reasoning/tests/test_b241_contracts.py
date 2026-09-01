"""B2.4.1 baseline-conformance-repair contract tests.

The successor must differ from the frozen B2.4 by exactly one restored B2 clause
in the *effective* prompt sent to the provider. These tests verify that
materially, without semantic similarity and without any LLM.
"""
from __future__ import annotations

import re
from typing import Any

import pytest

from experiments.evidence_reasoning import b24_prompts, b241_prompts
from experiments.evidence_reasoning.b24_versions import B24_PROMPT_VERSIONS
from experiments.evidence_reasoning.b241_runtime import (
    HARD_CALL_CAP,
    PROBE_PLAN,
    provider_call_plan,
)
from experiments.evidence_reasoning.b241_versions import (
    B241_LINEAGE,
    B241_PROMPT_VERSIONS,
    B2_NO_FORCED_CONTINUITY_USEFULNESS,
)

OBJECTIVE = "Contexto: equipo técnico. Requisito formativo: cartografía hidrológica avanzada."

BASELINE_CLAUSE_ANCHORS = {
    "B2_NO_SEMANTIC_STRENGTHENING": "NO SEMANTIC STRENGTHENING",
    "B2_NO_FORCED_CONTINUITY_USEFULNESS": "no fuerces esos valores",
    "B2_NO_ARBITRARY_CONSERVATIVE_UNCERTAINTY": "conservadurismo arbitrario",
    "B2_NO_PLURALITY_IMPLIES_INTEGRATION_BRIDGE": "bridge por la mera pluralidad",
}


def _context() -> dict[str, Any]:
    return {
        "originalObjective": OBJECTIVE,
        "requirement": {
            "requirementId": "req_01",
            "requirementQuote": "Requisito formativo: cartografía hidrológica avanzada.",
            "normalizedRequirement": "formación en cartografía hidrológica avanzada",
            "epistemicTarget": "FORMATIVE_EVIDENCE",
            "materialQualifiers": [],
        },
        "authorityOrder": ["requirementQuote", "explicitQualifiers", "objectiveContext", "normalizedRequirement"],
        "epistemicTarget": "FORMATIVE_EVIDENCE",
        "epistemicTargetIsReadOnly": True,
        "evidenceUnits": [],
        "evidencePreparation": {"mode": "FULL_SCAN"},
        "sourceContext": [],
    }


def _strip_version_ids(text: str) -> str:
    return re.sub(r"PROMPT_VERSION=\S+", "PROMPT_VERSION=<ID>", text)


# ---------------------------------------------------------------------------
# The authorized restoration
# ---------------------------------------------------------------------------

def test_restored_clause_is_verbatim_b2():
    b2_source = (b241_prompts.__file__.rsplit("b241_prompts.py", 1)[0] + "b2_prompts.py")
    with open(b2_source, encoding="utf-8") as handle:
        assert B2_NO_FORCED_CONTINUITY_USEFULNESS in handle.read()


def test_clause_absent_from_predecessor_effective_prompt():
    assert B2_NO_FORCED_CONTINUITY_USEFULNESS not in b24_prompts.unified_reasoning_prompt(_context())


def test_clause_materially_present_in_successor_effective_prompt():
    """Not a comment, constant, docstring or manifest -- the real provider text."""
    effective = b241_prompts.unified_reasoning_prompt(_context())
    assert B2_NO_FORCED_CONTINUITY_USEFULNESS in effective
    assert effective.count(B2_NO_FORCED_CONTINUITY_USEFULNESS) == 1


def test_all_four_baseline_clauses_present_across_effective_prompts():
    """The clauses live in different stage prompts; the union is what reaches the provider."""
    effective = "\n".join(
        [
            b241_prompts.b241_evidence_unit_quote_first_prompt([]),
            b241_prompts.objective_analysis_prompt(OBJECTIVE),
            b241_prompts.unified_reasoning_prompt(_context()),
        ]
    )
    missing = [name for name, anchor in BASELINE_CLAUSE_ANCHORS.items() if anchor not in effective]
    assert missing == [], f"baseline clauses absent from effective prompts: {missing}"


# ---------------------------------------------------------------------------
# No other semantic delta
# ---------------------------------------------------------------------------

def test_unified_prompt_delta_is_exactly_the_restored_clause():
    before = _strip_version_ids(b24_prompts.unified_reasoning_prompt(_context()))
    after = _strip_version_ids(b241_prompts.unified_reasoning_prompt(_context()))
    assert after.replace(" " + B2_NO_FORCED_CONTINUITY_USEFULNESS, "", 1) == before


def test_objective_prompt_is_byte_identical_apart_from_version_id():
    before = _strip_version_ids(b24_prompts.objective_analysis_prompt(OBJECTIVE))
    after = _strip_version_ids(b241_prompts.objective_analysis_prompt(OBJECTIVE))
    assert after == before


def test_evidence_unit_prompt_is_reused_unchanged():
    assert b241_prompts.b241_evidence_unit_quote_first_prompt is not None
    sources: list[dict[str, Any]] = []
    assert b241_prompts.b241_evidence_unit_quote_first_prompt(sources) == b24_prompts.b24_evidence_unit_quote_first_prompt(sources)


def test_prompt_versions_differ_from_predecessor():
    assert B241_PROMPT_VERSIONS["unifiedContextualReasoning"] != B24_PROMPT_VERSIONS["unifiedContextualReasoning"]
    assert B241_PROMPT_VERSIONS["evidenceUnitQuoteFirst"] == B24_PROMPT_VERSIONS["evidenceUnitQuoteFirst"]


def test_insertion_is_idempotence_protected():
    """Applying the restoration to an already-repaired prompt must fail loudly."""
    original = b241_prompts.b24_unified_reasoning_prompt

    def already_repaired(context: dict[str, Any]) -> str:
        return original(context).replace(
            "La utilidad nunca rescata un semantic shift.",
            "La utilidad nunca rescata un semantic shift. " + B2_NO_FORCED_CONTINUITY_USEFULNESS,
            1,
        )

    # b241_prompts binds the predecessor at import time, so patch the bound name.
    b241_prompts.b24_unified_reasoning_prompt = already_repaired  # type: ignore[assignment]
    try:
        with pytest.raises(b241_prompts.BaselineRestorationError):
            b241_prompts.unified_reasoning_prompt(_context())
    finally:
        b241_prompts.b24_unified_reasoning_prompt = original  # type: ignore[assignment]


def test_missing_anchor_fails_loudly_instead_of_silently_skipping():
    original = b241_prompts.b24_unified_reasoning_prompt
    b241_prompts.b24_unified_reasoning_prompt = lambda context: "prompt without the anchor"  # type: ignore[assignment]
    try:
        with pytest.raises(b241_prompts.BaselineRestorationError):
            b241_prompts.unified_reasoning_prompt(_context())
    finally:
        b241_prompts.b24_unified_reasoning_prompt = original  # type: ignore[assignment]


def test_lineage_declares_restoration_and_no_new_content():
    assert B241_LINEAGE["changeClass"] == "BASELINE_CONFORMANCE_REPAIR"
    assert B241_LINEAGE["restores"] == ["B2_NO_FORCED_CONTINUITY_USEFULNESS"]
    assert B241_LINEAGE["adds"] == []
    assert B241_LINEAGE["removes"] == []
    assert B241_LINEAGE["newSemanticContentBeyondRestoration"] == "NONE"
    for name in BASELINE_CLAUSE_ANCHORS:
        assert name in B241_LINEAGE["inherits"]


def test_restoration_introduces_no_case_specific_vocabulary():
    effective = b241_prompts.unified_reasoning_prompt(_context())
    added = effective.replace(b24_prompts.unified_reasoning_prompt(_context()), "")
    forbidden = ("microbiolog", "industrial", "specialized", "CFD", "Kubernetes", "seismic", "sísmic", "prerequisit")
    assert not [word for word in forbidden if word.lower() in B2_NO_FORCED_CONTINUITY_USEFULNESS.lower()]
    assert "example" not in added.lower()


# ---------------------------------------------------------------------------
# Probe budget
# ---------------------------------------------------------------------------

def test_probe_plan_matches_authorized_design():
    assert PROBE_PLAN == (("case_06", 2), ("case_05", 1), ("case_09", 1))
    plan = provider_call_plan()
    assert plan["developmentProbe"]["runs"] == 4
    assert plan["combinedExpectedCalls"] == HARD_CALL_CAP == 12
    assert plan["liveSmoke"]["expectedCalls"] == 0
    assert plan["status"] == "PASS"


def test_probe_never_targets_holdout():
    holdout = {f"case_{item}" for item in ("02", "04", "10", "14", "16", "17")}
    assert not {case_id for case_id, _ in PROBE_PLAN} & holdout


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__]))
