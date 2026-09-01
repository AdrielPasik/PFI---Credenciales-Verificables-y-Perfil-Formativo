from __future__ import annotations

"""Frozen Holdout execution-protocol constants.

Every parameter that must be IDENTICAL to the Development campaign is imported
from `campaign.config` rather than re-typed, so the two can never drift apart by
transcription. Only what must genuinely differ — campaign identity, case set,
run count and the derived budgets — is declared here.
"""

from ..campaign.config import (  # noqa: F401  (re-exported: identical by construction)
    ABORTED_INFRASTRUCTURE,
    ABORTED_INTEGRITY,
    B24_HISTORICAL_FINGERPRINT,
    B241_BEHAVIOR_FINGERPRINT,
    COMPLETE,
    FAILED_NONRECOVERABLE,
    FAILED_TRANSPORT,
    INCOMPLETE,
    MAX_ATTEMPTS_PER_LOGICAL_CALL,
    MAX_CONCURRENT_LOGICAL_CALLS,
    MODEL,
    NOT_STARTED,
    PROVIDER,
    PROVIDER_TIMEOUT_SECONDS,
    REASONING_EFFORT,
    STAGES,
    STAGES_PER_RUN,
    SUCCESS,
    TRANSPORT_RETRY_BACKOFF_SECONDS,
)

CAMPAIGN_ID = "b241-holdout-v1"

# The frozen Holdout split. Confirmed against fixtures: these are exactly the six
# cases carrying split == "holdout" in seed_gold_set_v0_frozen.
HOLDOUT_CASES = ("case_02", "case_04", "case_10", "case_14", "case_16", "case_17")

# Development is CLOSED. These may never be executed, resumed or re-evaluated by
# this campaign; the tuple is complete on purpose and is asserted against, not
# merely documented.
DEVELOPMENT_CASES = (
    "case_01", "case_03", "case_05", "case_06", "case_07", "case_08",
    "case_09", "case_11", "case_12", "case_13", "case_15",
)

REPETITIONS = 5
RUNS = len(HOLDOUT_CASES) * REPETITIONS                     # 30

# Cardinality assumption, verified offline against the fixtures and against the
# 55/55 Development precedent: one Objective decomposing to one Requirement, so
# one Unified Contextual Reasoning call per run. The runtime guard in
# campaign.generation.run_case still aborts on ABORTED_INTEGRITY if a run ever
# yields a different cardinality — the budget is never silently widened.
UNIFIED_CALLS_PER_RUN = 1
LOGICAL_PROVIDER_CALLS = RUNS * STAGES_PER_RUN              # 90

# Transport reserve, proportional to the approved Development reserve and rounded
# UP so it is never less generous per call:
#   Development  5 / 165 = 3.030 %
#   Holdout      90 x 5/165 = 2.727 -> ceil -> 3   (3.333 %)
TRANSPORT_RECOVERY_RESERVE = 3
ABSOLUTE_PROVIDER_ATTEMPT_CAP = LOGICAL_PROVIDER_CALLS + TRANSPORT_RECOVERY_RESERVE  # 93

# Level 2 deep review cannot name cases in advance without knowing the results,
# so it is defined by frozen CRITERIA instead. See holdout.adjudication.
LEVEL2_SELECTION = "CRITERIA_BASED_NOT_CASE_BASED"

# --------------------------------------------------------------------------
# Model-generated topology deviation (protocol fix v2)
# --------------------------------------------------------------------------
# Objective decomposition is a SEMANTIC responsibility of the candidate. When the
# provider returns a complete, durable, schema-valid Objective Analysis that
# nonetheless fails to resolve exactly one authoritative Requirement, that is a
# generalization failure to be MEASURED, not an integrity failure to be censored.
# Aborting there would amount to "if the model fails this particular way, we stop
# measuring" — selective censorship of one failure class.
#
# The opposite case — the same cardinality anomaly arising from fixture, schema,
# hash, attribution, checkpoint or fingerprint corruption — remains a hard stop,
# because continuing would produce invalid evidence.
#
#   MODEL SAID SOMETHING WRONG   -> record unmappable and continue
#   HARNESS DID SOMETHING WRONG  -> ABORTED_INTEGRITY
#
# This is orchestration/evaluation policy only. It changes no prompt, no schema,
# no artifact contract and no B2.4.1 behaviour.
UNMAPPABLE_CARDINALITY = "OBJECTIVE_DECOMPOSITION_CARDINALITY"
UNMAPPABLE_AMBIGUOUS = "OBJECTIVE_DECOMPOSITION_AMBIGUOUS"
UNMAPPABLE_REASONS = (UNMAPPABLE_CARDINALITY, UNMAPPABLE_AMBIGUOUS)

# An unmappable run is a TERMINAL SEMANTIC RESULT: runState COMPLETE, no final
# state invented. Phase 2 may begin once all 30 planned runs are terminal,
# whether mappable or unmappable — 30 non-null final states are NOT required.
TERMINAL_RUN_STATES = (COMPLETE,)

# Reporting label for an unmappable run in a per-case state distribution.
# Deliberately NOT a FinalState enum value: inventing ABSTAIN, NOT_ASSESSABLE or
# INSUFFICIENT_EVIDENCE here would falsify the failure that was observed.
UNMAPPABLE_DISTRIBUTION_LABEL = "UNMAPPABLE_NO_FINAL_STATE"

# 90 is the MAXIMUM expected logical call count, reached only if all 30 runs are
# mappable. An unmappable run simply never issues its Unified call. The unused
# slot is DISCARDED: it never becomes extra reserve and is never reassigned.
LOGICAL_CALL_BUDGET_SEMANTICS = "MAXIMUM_EXPECTED_NOT_A_QUOTA"


def execution_order() -> list[dict[str, object]]:
    """case_02 r1-5, case_04 r1-5, ... case_17 r1-5. Ascending, not randomized."""
    return [
        {"index": index, "runId": f"{case}_r{rep}", "caseId": case, "repetition": rep}
        for index, (case, rep) in enumerate(
            ((c, r) for c in HOLDOUT_CASES for r in range(1, REPETITIONS + 1)), start=1
        )
    ]


def assert_development_excluded(case_id: str) -> None:
    if case_id in DEVELOPMENT_CASES:
        raise AssertionError(f"development_case_in_holdout_campaign:{case_id}")
