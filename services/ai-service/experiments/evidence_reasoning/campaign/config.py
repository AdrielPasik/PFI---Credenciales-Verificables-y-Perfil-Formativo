from __future__ import annotations

"""Frozen execution-protocol constants. Part of the EXECUTION PROTOCOL FINGERPRINT."""

CAMPAIGN_ID = "b241-full-dev-reexecution-v1"

B241_BEHAVIOR_FINGERPRINT = "55f37a8529c046e750f4e0351f544dabca1fb7bb9796b05fc1c860b5c979d6fc"
B24_HISTORICAL_FINGERPRINT = "1cc883d785fd689213708106f715910025bf806db116f1814a2f48e8980c2be9"

PROVIDER = "openai"
MODEL = "gpt-5.6-terra"
REASONING_EFFORT = "medium"

# Transport configuration. Identical for every attempt, including recoveries.
PROVIDER_TIMEOUT_SECONDS = 360
TRANSPORT_RETRY_BACKOFF_SECONDS = 15
MAX_CONCURRENT_LOGICAL_CALLS = 1

DEVELOPMENT_CASES = (
    "case_01", "case_03", "case_05", "case_06", "case_07",
    "case_08", "case_09", "case_11", "case_12", "case_15",
)
# case_13 sits between 12 and 15 in the frozen order; kept explicit below.
EXECUTION_CASES = (
    "case_01", "case_03", "case_05", "case_06", "case_07", "case_08",
    "case_09", "case_11", "case_12", "case_13", "case_15",
)
REPETITIONS = 5
RUNS = len(EXECUTION_CASES) * REPETITIONS

STAGES = ("evidence_unit", "objective_analysis", "unified_reasoning")
STAGES_PER_RUN = len(STAGES)

LOGICAL_PROVIDER_CALLS = RUNS * STAGES_PER_RUN          # 165
TRANSPORT_RECOVERY_RESERVE = 5
ABSOLUTE_PROVIDER_ATTEMPT_CAP = LOGICAL_PROVIDER_CALLS + TRANSPORT_RECOVERY_RESERVE  # 170
MAX_ATTEMPTS_PER_LOGICAL_CALL = 2

HOLDOUT_CASES = frozenset({"case_02", "case_04", "case_10", "case_14", "case_16", "case_17"})

LEVEL2_CASES = (
    "case_03", "case_05", "case_06", "case_07", "case_08",
    "case_09", "case_11", "case_12", "case_15",
)

# Run states
NOT_STARTED = "NOT_STARTED"
INCOMPLETE = "INCOMPLETE"
COMPLETE = "COMPLETE"
ABORTED_INFRASTRUCTURE = "ABORTED_INFRASTRUCTURE"
ABORTED_INTEGRITY = "ABORTED_INTEGRITY"

# Attempt states
SUCCESS = "SUCCESS"
FAILED_TRANSPORT = "FAILED_TRANSPORT"
FAILED_NONRECOVERABLE = "FAILED_NONRECOVERABLE"


def execution_order() -> list[dict[str, object]]:
    return [
        {"index": index, "runId": f"{case}_r{rep}", "caseId": case, "repetition": rep}
        for index, (case, rep) in enumerate(
            ((c, r) for c in EXECUTION_CASES for r in range(1, REPETITIONS + 1)), start=1
        )
    ]
