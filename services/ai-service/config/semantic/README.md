# Semantic Ontology Overrides

This folder allows extending semantic coverage without editing src/semantic_builder.py.

Supported optional files:
- area_profiles.json
- domain_concept_lexicon.json
- name_area_hints.json
- area_anchor_requirements.json
- area_context_group.json
- skill_evidence_patterns.json
- concept_canonical_patterns.json
- family_coverage_gate.json
- area_embedding_references_v1.json

Merge behavior:
- Maps are merged by key.
- Lists are merged with deduplication preserving order.
- New keys are appended.

Examples:

## area_profiles.json
```json
{
  "New Domain": {
    "strong": ["strong term"],
    "medium": ["medium term"],
    "light": ["light term"]
  }
}
```

## concept_canonical_patterns.json
```json
[
  ["new signal", "Canonical Label"]
]
```

## skill_evidence_patterns.json
```json
{
  "NewSkill": ["explicit token", "explicit alias"]
}
```

## family_coverage_gate.json
```json
{
  "software_family": {"min_hits": 3, "min_ratio": 0.35},
  "telecom_family": {"min_hits": 3, "min_ratio": 0.35}
}
```

## area_embedding_references_v1.json

Versioned, reviewable semantic prototypes for the existing Scope areas. They
must cover exactly the active area profiles, keep their existing labels, and be
reviewed independently from any Development or Holdout examples. They are only
used when the optional local embedding feature is enabled.
