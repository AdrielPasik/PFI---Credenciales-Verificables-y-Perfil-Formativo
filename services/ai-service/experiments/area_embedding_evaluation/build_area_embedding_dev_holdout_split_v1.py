#!/usr/bin/env python3
"""Build the frozen v1 Development/Holdout split without inspecting predictions.

The program reads only frozen corpus provenance, frozen human annotation fields
explicitly allowed by the split protocol, and the precomputed exact leakage
groups.  It intentionally does not import application classifier code or model
libraries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from itertools import product
from pathlib import Path
from typing import Any


STATUSES = ("CLEAR", "BOUNDARY", "MULTIDISCIPLINARY")
CONFIDENCES = ("HIGH", "MEDIUM", "LOW")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def stable_hash(seed: str, *parts: str) -> str:
    return sha256_bytes((seed + "\n" + "\n".join(parts)).encode("utf-8"))


def group_digest(seed: str, group_ids: set[str]) -> str:
    return stable_hash(seed, *sorted(group_ids))


def count_by(items: list[dict[str, Any]], field: str, options: tuple[str, ...]) -> dict[str, int]:
    observed = Counter(item[field] for item in items)
    return {option: observed[option] for option in options}


def primary_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(item["primaryArea"] for item in items)
    return {"representedCount": len(counts), "counts": dict(sorted(counts.items()))}


def secondary_summary(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(len(item["acceptableSecondaryAreas"]) for item in items)
    return {str(index): counts[index] for index in range(4)}


def validate_protocol_inputs(
    protocol: dict[str, Any],
    gold_freeze: dict[str, Any],
    corpus_hash: str,
    gold_hash: str,
    gold_freeze_hash: str,
    leakage_hash: str,
) -> None:
    expected = {
        "corpusSha256": corpus_hash,
        "humanGoldSha256": gold_hash,
        "goldFreezeManifestSha256": gold_freeze_hash,
        "leakageAuditSha256": leakage_hash,
    }
    for field, value in expected.items():
        if protocol.get(field) != value:
            raise ValueError(f"Protocol mismatch for {field}.")
    if gold_freeze.get("humanGold", {}).get("sha256") != gold_hash:
        raise ValueError("Human gold freeze does not reference the supplied human gold.")
    if protocol.get("developmentTarget") != 77 or protocol.get("holdoutTarget") != 39:
        raise ValueError("Protocol targets must remain 77 Development / 39 Holdout.")


def profile_penalty(
    holdout_case_ids: set[str],
    annotations_by_id: dict[str, dict[str, Any]],
    primary_totals: Counter[str],
) -> tuple[int, int, int]:
    holdout_counts = Counter(annotations_by_id[case_id]["primaryArea"] for case_id in holdout_case_ids)
    support_ge_3_missed = sum(
        count >= 3 and not 0 < holdout_counts[area] < count
        for area, count in primary_totals.items()
    )
    support_eq_2_missed = sum(
        count == 2 and holdout_counts[area] != 1
        for area, count in primary_totals.items()
    )
    shared = sum(0 < holdout_counts[area] < count for area, count in primary_totals.items())
    return support_ge_3_missed, support_eq_2_missed, shared


def build_status_profile_options(
    singleton_groups: list[dict[str, Any]],
    required_count: int,
) -> list[tuple[int, int, int]]:
    available = Counter()
    for group in singleton_groups:
        available.update(group["statusCounts"])
    options: list[tuple[int, int, int]] = []
    for clear in range(available["CLEAR"] + 1):
        for boundary in range(available["BOUNDARY"] + 1):
            multi = required_count - clear - boundary
            if 0 <= multi <= available["MULTIDISCIPLINARY"]:
                options.append((clear, boundary, multi))
    return options


def status_profile_digest(seed: str, profile: dict[str, tuple[int, int, int]]) -> str:
    entries = [f"{family}:{counts[0]},{counts[1]},{counts[2]}" for family, counts in sorted(profile.items())]
    return stable_hash(seed, *entries)


def select_cases_for_plan(
    *,
    seed: str,
    plan_key: str,
    restart: int,
    selected_multicase_groups: set[str],
    singleton_by_family_status: dict[tuple[str, str], list[dict[str, Any]]],
    profile: dict[str, tuple[int, int, int]],
) -> set[str]:
    selected = set(selected_multicase_groups)
    for family, counts in sorted(profile.items()):
        for status, count in zip(STATUSES, counts):
            pool = singleton_by_family_status[(family, status)]
            ordered = sorted(
                pool,
                key=lambda group: stable_hash(seed, plan_key, str(restart), group["leakageGroupId"]),
            )
            selected.update(group["leakageGroupId"] for group in ordered[:count])
    return selected


def local_improve(
    *,
    seed: str,
    selected_groups: set[str],
    groups_by_id: dict[str, dict[str, Any]],
    singleton_by_family_status: dict[tuple[str, str], list[dict[str, Any]]],
    annotations_by_id: dict[str, dict[str, Any]],
    primary_totals: Counter[str],
) -> set[str]:
    """Swap singleton groups only within an identical family/status bucket.

    Every accepted move preserves group integrity, family targets, and the
    selected annotation-status distribution.  The move objective is the next
    lexicographic portion of the protocol objective after those fixed terms.
    """

    def holdout_cases(selection: set[str]) -> set[str]:
        return {
            case_id
            for group_id in selection
            for case_id in groups_by_id[group_id]["caseIds"]
        }

    def local_objective(selection: set[str]) -> tuple[int, int, int, int]:
        ids = holdout_cases(selection)
        ge3, eq2, shared = profile_penalty(ids, annotations_by_id, primary_totals)
        medium_holdout = sum(
            annotations_by_id[case_id]["annotationConfidence"] == "MEDIUM" for case_id in ids
        )
        return ge3, eq2, -shared, abs(medium_holdout - 1)

    current = set(selected_groups)
    current_objective = local_objective(current)
    while True:
        best: tuple[tuple[int, int, int, int], str, str] | None = None
        for bucket, groups in sorted(singleton_by_family_status.items()):
            chosen = [group for group in groups if group["leakageGroupId"] in current]
            unchosen = [group for group in groups if group["leakageGroupId"] not in current]
            pairs = sorted(
                (
                    (out_group, in_group)
                    for out_group in chosen
                    for in_group in unchosen
                ),
                key=lambda pair: stable_hash(
                    seed,
                    bucket[0],
                    bucket[1],
                    pair[0]["leakageGroupId"],
                    pair[1]["leakageGroupId"],
                ),
            )
            for out_group, in_group in pairs:
                proposal = set(current)
                proposal.remove(out_group["leakageGroupId"])
                proposal.add(in_group["leakageGroupId"])
                proposal_objective = local_objective(proposal)
                if proposal_objective >= current_objective:
                    continue
                candidate = (
                    proposal_objective,
                    out_group["leakageGroupId"],
                    in_group["leakageGroupId"],
                )
                if best is None or candidate < best:
                    best = candidate
        if best is None:
            return current
        _, out_group_id, in_group_id = best
        current.remove(out_group_id)
        current.add(in_group_id)
        current_objective = local_objective(current)


def create_split(
    corpus: dict[str, Any],
    annotations: list[dict[str, Any]],
    leakage_audit: dict[str, Any],
    protocol: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    cases_by_id = {case["caseId"]: case for case in corpus["cases"]}
    annotations_by_id = {annotation["caseId"]: annotation for annotation in annotations}
    if set(cases_by_id) != set(annotations_by_id):
        raise ValueError("Frozen corpus and human gold case IDs differ.")

    family_targets = {
        family: details["holdoutTarget"]
        for family, details in protocol["familyTargets"].items()
    }
    seed = protocol["seed"]
    groups = leakage_audit["leakageGroupDefinitions"]
    groups_by_id = {group["leakageGroupId"]: group for group in groups}
    group_case_ids = [case_id for group in groups for case_id in group["caseIds"]]
    if Counter(group_case_ids) != Counter(cases_by_id.keys()):
        raise ValueError("Leakage group definitions do not partition frozen cases.")

    for group in groups:
        members = [cases_by_id[case_id] for case_id in group["caseIds"]]
        group["familyCounts"] = dict(Counter(case["disciplinaryFamily"] for case in members))
        group["statusCounts"] = dict(
            Counter(annotations_by_id[case["caseId"]]["annotationStatus"] for case in members)
        )
        group["confidenceCounts"] = dict(
            Counter(annotations_by_id[case["caseId"]]["annotationConfidence"] for case in members)
        )

    multicase = [group for group in groups if group["caseCount"] > 1]
    singleton = [group for group in groups if group["caseCount"] == 1]
    singleton_by_family_status: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    singleton_by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for group in singleton:
        case_id = group["caseIds"][0]
        family = cases_by_id[case_id]["disciplinaryFamily"]
        status = annotations_by_id[case_id]["annotationStatus"]
        singleton_by_family_status[(family, status)].append(group)
        singleton_by_family[family].append(group)

    # Enumerate multigroup membership exactly; all remaining decisions are
    # singleton selections constrained by the frozen family targets.
    raw_plans: list[tuple[set[str], dict[str, tuple[int, int, int]], int]] = []
    global_status_minimum: int | None = None
    status_target = protocol["annotationStatusTargets"]["holdoutTarget"]
    for bits in product((False, True), repeat=len(multicase)):
        selected_multi = {
            group["leakageGroupId"]
            for group, selected in zip(multicase, bits)
            if selected
        }
        family_counts = Counter()
        status_counts = Counter()
        for group, selected in zip(multicase, bits):
            if selected:
                family_counts.update(group["familyCounts"])
                status_counts.update(group["statusCounts"])
        if any(family_counts[family] > family_targets[family] for family in family_targets):
            continue
        residual = {family: family_targets[family] - family_counts[family] for family in family_targets}
        if any(residual[family] > len(singleton_by_family[family]) for family in family_targets):
            continue

        # DP retains one deterministic profile per aggregate status state.
        states: dict[tuple[int, int, int], dict[str, tuple[int, int, int]]] = {(0, 0, 0): {}}
        for family in sorted(family_targets):
            choices = build_status_profile_options(singleton_by_family[family], residual[family])
            next_states: dict[tuple[int, int, int], dict[str, tuple[int, int, int]]] = {}
            for state, partial in states.items():
                for choice in choices:
                    next_state = tuple(state[index] + choice[index] for index in range(3))
                    candidate = dict(partial)
                    candidate[family] = choice
                    prior = next_states.get(next_state)
                    if prior is None or status_profile_digest(seed, candidate) < status_profile_digest(seed, prior):
                        next_states[next_state] = candidate
            states = next_states
        for state, profile in states.items():
            final_status = {
                status: status_counts[status] + state[index]
                for index, status in enumerate(STATUSES)
            }
            deviation = sum(abs(final_status[status] - status_target[status]) for status in STATUSES)
            if global_status_minimum is None or deviation < global_status_minimum:
                global_status_minimum = deviation
                raw_plans = [(selected_multi, profile, deviation)]
            elif deviation == global_status_minimum:
                raw_plans.append((selected_multi, profile, deviation))
    if global_status_minimum is None:
        raise ValueError("No assignment can satisfy exact family targets under leakage groups.")

    # Fixed, seeded candidate cap makes heuristic work bounded and replayable.
    ranked_plans = sorted(
        raw_plans,
        key=lambda plan: stable_hash(
            seed,
            group_digest(seed, plan[0]),
            status_profile_digest(seed, plan[1]),
        ),
    )[:256]
    primary_totals = Counter(annotation["primaryArea"] for annotation in annotations)
    best: tuple[tuple[Any, ...], set[str]] | None = None
    evaluated = 0
    for selected_multi, profile, status_deviation in ranked_plans:
        plan_key = stable_hash(seed, group_digest(seed, selected_multi), status_profile_digest(seed, profile))
        for restart in range(4):
            selection = select_cases_for_plan(
                seed=seed,
                plan_key=plan_key,
                restart=restart,
                selected_multicase_groups=selected_multi,
                singleton_by_family_status=singleton_by_family_status,
                profile=profile,
            )
            selection = local_improve(
                seed=seed,
                selected_groups=selection,
                groups_by_id=groups_by_id,
                singleton_by_family_status=singleton_by_family_status,
                annotations_by_id=annotations_by_id,
                primary_totals=primary_totals,
            )
            holdout_ids = {
                case_id
                for group_id in selection
                for case_id in groups_by_id[group_id]["caseIds"]
            }
            family_counts = Counter(cases_by_id[case_id]["disciplinaryFamily"] for case_id in holdout_ids)
            family_deviation = sum(
                abs(family_counts[family] - family_targets[family])
                for family in family_targets
            )
            status_counts = Counter(annotations_by_id[case_id]["annotationStatus"] for case_id in holdout_ids)
            observed_status_deviation = sum(
                abs(status_counts[status] - status_target[status]) for status in STATUSES
            )
            ge3, eq2, shared = profile_penalty(holdout_ids, annotations_by_id, primary_totals)
            medium_holdout = sum(
                annotations_by_id[case_id]["annotationConfidence"] == "MEDIUM"
                for case_id in holdout_ids
            )
            objective = (
                0,  # all candidates select whole leakage groups
                abs(len(holdout_ids) - protocol["holdoutTarget"]),
                family_deviation,
                observed_status_deviation,
                ge3,
                eq2,
                -shared,
                abs(medium_holdout - 1),
                group_digest(seed, selection),
            )
            evaluated += 1
            if best is None or objective < best[0]:
                best = (objective, selection)
    if best is None:
        raise ValueError("No deterministic candidate was evaluated.")

    objective, holdout_groups = best
    holdout_case_ids = sorted(
        case_id
        for group_id in holdout_groups
        for case_id in groups_by_id[group_id]["caseIds"]
    )
    development_case_ids = sorted(set(cases_by_id) - set(holdout_case_ids))
    if len(holdout_case_ids) != 39 or len(development_case_ids) != 77:
        raise ValueError("Selected split does not meet exact 77/39 targets.")

    group_by_case_id = {
        case_id: group["leakageGroupId"]
        for group in groups
        for case_id in group["caseIds"]
    }
    group_overlap = set(group_by_case_id[case_id] for case_id in development_case_ids) & set(
        group_by_case_id[case_id] for case_id in holdout_case_ids
    )
    if group_overlap:
        raise ValueError("Cross-split leakage group detected.")

    development_annotations = [annotations_by_id[case_id] for case_id in development_case_ids]
    holdout_annotations = [annotations_by_id[case_id] for case_id in holdout_case_ids]
    development_cases = [cases_by_id[case_id] for case_id in development_case_ids]
    holdout_cases = [cases_by_id[case_id] for case_id in holdout_case_ids]
    development_primary = primary_summary(development_annotations)
    holdout_primary = primary_summary(holdout_annotations)
    dev_areas = set(development_primary["counts"])
    hold_areas = set(holdout_primary["counts"])
    family_distribution = {
        family: {
            "total": sum(case["disciplinaryFamily"] == family for case in corpus["cases"]),
            "development": sum(case["disciplinaryFamily"] == family for case in development_cases),
            "holdout": sum(case["disciplinaryFamily"] == family for case in holdout_cases),
            "holdoutTarget": family_targets[family],
            "absoluteDeviation": abs(
                sum(case["disciplinaryFamily"] == family for case in holdout_cases) - family_targets[family]
            ),
        }
        for family in sorted(family_targets)
    }
    diagnostics = {
        "leakageAudit": {
            "totalLeakageGroups": leakage_audit["totalLeakageGroups"],
            "singletonGroups": leakage_audit["singletonGroups"],
            "multiCaseGroups": leakage_audit["multiCaseGroups"],
            "maximumGroupSize": leakage_audit["maximumGroupSize"],
            "leakageGroupCrossSplitCount": 0,
        },
        "familyDistribution": family_distribution,
        "annotationStatusDistribution": {
            "development": count_by(development_annotations, "annotationStatus", STATUSES),
            "holdout": count_by(holdout_annotations, "annotationStatus", STATUSES),
            "holdoutTarget": protocol["annotationStatusTargets"]["holdoutTarget"],
        },
        "annotationConfidenceDistribution": {
            "development": count_by(development_annotations, "annotationConfidence", CONFIDENCES),
            "holdout": count_by(holdout_annotations, "annotationConfidence", CONFIDENCES),
        },
        "secondaryCountDistribution": {
            "development": secondary_summary(development_annotations),
            "holdout": secondary_summary(holdout_annotations),
        },
        "primaryAreaDistribution": {
            "development": development_primary,
            "holdout": holdout_primary,
        },
        "crossSplitAreaCoverage": {
            "developmentPrimaryAreas": sorted(dev_areas),
            "holdoutPrimaryAreas": sorted(hold_areas),
            "sharedPrimaryAreas": sorted(dev_areas & hold_areas),
            "developmentOnlyPrimaryAreas": sorted(dev_areas - hold_areas),
            "holdoutOnlyPrimaryAreas": sorted(hold_areas - dev_areas),
        },
        "algorithmExecution": {
            "minimumAnnotationStatusAbsoluteDeviation": global_status_minimum,
            "candidatePlansConsidered": len(raw_plans),
            "seedRankedPlansEvaluated": len(ranked_plans),
            "candidateAssignmentsEvaluated": evaluated,
            "selectedObjectiveVector": list(objective[:-1]),
            "tieBreakDigest": objective[-1],
        },
    }
    split = {
        "schemaVersion": "area_embedding_dev_holdout_split_v1",
        "splitVersion": protocol["splitVersion"],
        "protocolSha256": None,  # supplied by the caller to avoid stale source assumptions
        "humanGoldSha256": protocol["humanGoldSha256"],
        "developmentCaseIds": development_case_ids,
        "holdoutCaseIds": holdout_case_ids,
        "developmentCount": len(development_case_ids),
        "holdoutCount": len(holdout_case_ids),
        "diagnostics": diagnostics,
        "validation": {
            "caseOverlapCount": 0,
            "unionMatchesFrozenGold": sorted(set(development_case_ids) | set(holdout_case_ids)) == sorted(cases_by_id),
            "everyCaseAppearsExactlyOnce": len(development_case_ids) + len(holdout_case_ids) == len(cases_by_id),
            "leakageGroupCrossSplitCount": 0,
        },
    }
    return split, diagnostics


def main() -> int:
    directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, default=directory / "area_embedding_dev_holdout_split_protocol_v1.json")
    parser.add_argument("--leakage-audit", type=Path, default=directory / "area_embedding_leakage_group_audit_v1.json")
    parser.add_argument("--corpus", type=Path, default=directory / "area_embedding_evaluation_corpus_v1.json")
    parser.add_argument("--gold", type=Path, default=directory / "area_embedding_human_annotations_v1.json")
    parser.add_argument("--gold-freeze", type=Path, default=directory / "area_embedding_human_gold_v1.freeze.json")
    parser.add_argument("--split-output", type=Path, default=directory / "area_embedding_dev_holdout_split_v1.json")
    parser.add_argument("--seal-output", type=Path, default=directory / "area_embedding_holdout_seal_v1.json")
    args = parser.parse_args()
    try:
        protocol_hash = sha256_file(args.protocol)
        corpus_hash = sha256_file(args.corpus)
        gold_hash = sha256_file(args.gold)
        gold_freeze_hash = sha256_file(args.gold_freeze)
        leakage_hash = sha256_file(args.leakage_audit)
        protocol = load_json(args.protocol)
        validate_protocol_inputs(
            protocol, load_json(args.gold_freeze), corpus_hash, gold_hash, gold_freeze_hash, leakage_hash
        )
        split, _ = create_split(
            load_json(args.corpus), load_json(args.gold), load_json(args.leakage_audit), protocol
        )
        split["protocolSha256"] = protocol_hash
        args.split_output.write_bytes(canonical_bytes(split))
        split_hash = sha256_file(args.split_output)
        holdout_ids_hash = sha256_bytes(("\n".join(split["holdoutCaseIds"]) + "\n").encode("utf-8"))
        seal = {
            "schemaVersion": "area_embedding_holdout_seal_v1",
            "splitVersion": protocol["splitVersion"],
            "splitSha256": split_hash,
            "protocolSha256": protocol_hash,
            "humanGoldSha256": gold_hash,
            "holdoutCaseCount": 39,
            "holdoutCaseIdsHash": holdout_ids_hash,
            "holdoutCaseIdsHashMethod": "SHA-256 of sorted holdout case IDs joined by LF with one trailing LF.",
            "status": "SEALED",
            "allowedBeforeUnseal": {
                "NONE_OF": [
                    "baseline evaluation on Holdout",
                    "E5 evaluation on Holdout",
                    "cosine inspection on Holdout",
                    "hybrid evaluation on Holdout",
                    "per-case Holdout analysis",
                ]
            },
            "unsealCondition": "DEVELOPMENT_CONFIGURATION_FROZEN",
        }
        args.seal_output.write_bytes(canonical_bytes(seal))
        print(
            json.dumps(
                {
                    "splitSha256": split_hash,
                    "holdoutSealSha256": sha256_file(args.seal_output),
                    "developmentCount": split["developmentCount"],
                    "holdoutCount": split["holdoutCount"],
                    "leakageGroupCrossSplitCount": split["diagnostics"]["leakageAudit"]["leakageGroupCrossSplitCount"],
                },
                sort_keys=True,
            )
        )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"INVALID: {exc}", file=__import__("sys").stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
