from __future__ import annotations

from experiments.evidence_reasoning.fixtures import assert_input_gold_isolation, load_cases
from experiments.evidence_reasoning.gold import load_gold
from experiments.evidence_reasoning.policy import final_state


def test_frozen_seed_has_17_cases_and_isolated_gold() -> None:
    assert_input_gold_isolation()
    cases = load_cases()
    gold = load_gold()
    assert len(cases) == 17
    assert set(gold) == {case.case_id for case in cases}
    assert {case.case_id for case in cases if case.split == "holdout"} == {
        "case_02", "case_04", "case_10", "case_14", "case_16", "case_17"
    }


def test_corrected_limited_scope_cases_are_partial_in_gold() -> None:
    gold = load_gold()
    assert {gold[case_id]["expectedState"] for case_id in ("case_07", "case_10", "case_17")} == {
        "PARTIALLY_SUPPORTED"
    }


def test_policy_separates_relation_from_final_state() -> None:
    common = dict(
        formative_evidence_capable=True,
        unresolved=False,
        critical_guard_failure=False,
        reaches_full_requirement=False,
    )
    assert final_state(
        **common,
        has_materially_useful_weaker_claim=True,
        weaker_claim_still_belongs_to_requirement=True,
    ) == "PARTIALLY_SUPPORTED"
    assert final_state(
        **common,
        has_materially_useful_weaker_claim=False,
        weaker_claim_still_belongs_to_requirement=False,
    ) == "INSUFFICIENT_EVIDENCE"


def test_policy_prioritizes_not_assessable_and_abstain() -> None:
    assert final_state(
        formative_evidence_capable=False,
        unresolved=True,
        critical_guard_failure=True,
        reaches_full_requirement=True,
        has_materially_useful_weaker_claim=True,
        weaker_claim_still_belongs_to_requirement=True,
    ) == "NOT_ASSESSABLE"
    assert final_state(
        formative_evidence_capable=True,
        unresolved=False,
        critical_guard_failure=True,
        reaches_full_requirement=True,
        has_materially_useful_weaker_claim=False,
        weaker_claim_still_belongs_to_requirement=False,
    ) == "ABSTAIN"
