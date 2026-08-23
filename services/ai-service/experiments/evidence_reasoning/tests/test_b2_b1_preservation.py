from __future__ import annotations

import hashlib
from pathlib import Path

from experiments.evidence_reasoning.policy import final_state


ROOT = Path(__file__).resolve().parents[1]

FROZEN_HASHES = {
    "prompts.py": "e4367569ad40a67ceab4033b055f8ba176769a0b639f3ef3769c76d55ec4330b",
    "schemas.py": "f141257fb1a3329fd83103d7d41e977a17dfe89620252d1ab370fefa7edf7751",
    "guards.py": "9caa86975cb5b9905d1eb0135143ee533ccf8e1a976d5b3fa89291940c9467f8",
    "policy.py": "7541f879ef00ded6ddd4dff4461043cbf82a49443d57fd33bfd71575b5498420",
    "providers.py": "34c568ad20eff41a1077d7488edb7c2bd863743faf204b42574b11adad6f5a1e",
    "versions.py": "194119a53c94428c831cffaac02c6b88ce2548c18677208d525fb020583b01b2",
    "fixtures/inputs/seed_v0_inputs.json": "50c0407ce1c10cd1f7484474f76ea985489719a2ac0a948b0c7c940159fc57b3",
    "fixtures/gold/seed_v0_gold.json": "72eb834147a58252ae7e0678725bfc4175d096fc852861527474a075a5aed5ec",
}


def test_b1_frozen_files_remain_byte_identical() -> None:
    for relative, expected in FROZEN_HASHES.items():
        assert hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == expected


def test_b1_policy_invariants_are_preserved() -> None:
    assert final_state(formative_evidence_capable=False, unresolved=True, critical_guard_failure=True, reaches_full_requirement=True, has_materially_useful_weaker_claim=True, weaker_claim_still_belongs_to_requirement=True) == "NOT_ASSESSABLE"
    assert final_state(formative_evidence_capable=True, unresolved=True, critical_guard_failure=False, reaches_full_requirement=True, has_materially_useful_weaker_claim=True, weaker_claim_still_belongs_to_requirement=True) == "ABSTAIN"
    assert final_state(formative_evidence_capable=True, unresolved=False, critical_guard_failure=False, reaches_full_requirement=False, has_materially_useful_weaker_claim=True, weaker_claim_still_belongs_to_requirement=True) == "PARTIALLY_SUPPORTED"
