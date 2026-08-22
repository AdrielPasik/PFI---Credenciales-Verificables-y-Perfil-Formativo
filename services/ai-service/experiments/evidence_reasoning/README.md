# Evidence Reasoning Slice 0 — B0/B1 harness

This subtree is an isolated experiment. It does not add production Prisma models, migrations, endpoints, NestJS modules, frontend code, vector infrastructure, OCR, or changes to `semantic_analysis_v1`, `FormativeProfile`, `canon_v1`, blockchain, issuance or `/verify`.

## Systems

- **B0** executes the current deterministic semantic pipeline and exports the actual `semantic_analysis_v1` capability. It never invents Objective matching or epistemic states.
- **B1a** performs one structured provider call over the Objective and frozen synthetic sources. Its single-shot result is preserved as-is, with only schema/source/citation validation.
- **B1b** performs objective-independent EvidenceUnit extraction, Objective analysis, evidence-blind facet planning, relation reasoning, composition/claim ceiling, deterministic guards, deterministic epistemic policy and deterministic explanation rendering.

Inference never imports `fixtures/gold`. Source SHA-256 values are computed from exact fixture bytes. Provider payloads contain only synthetic sources.

## Commands

Run from `services/ai-service`:

```powershell
python -m pip install -r requirements-api-dev.txt
$env:PYTHONDONTWRITEBYTECODE='1'
python -m pytest -p no:cacheprovider experiments/evidence_reasoning/tests
python -m experiments.evidence_reasoning.cli inventory
python -m experiments.evidence_reasoning.cli schemas --output output/evidence_reasoning/schemas.json
python -m experiments.evidence_reasoning.cli b0 --output output/evidence_reasoning/b0.json
```

Live B1a and B1b are explicit and are not part of the normal test suite:

```powershell
$env:ER_OPENAI_API_KEY='...'
$env:ER_OPENAI_MODEL='gpt-5.6-terra'
$env:ER_OPENAI_REASONING_EFFORT='medium'
python -m experiments.evidence_reasoning.cli b1a --provider openai --repeats 5 --output output/evidence_reasoning/b1a.json
python -m experiments.evidence_reasoning.cli b1b --provider openai --repeats 5 --output output/evidence_reasoning/b1b.json
python -m experiments.evidence_reasoning.cli compare --provider openai --repeats 5 --output-dir output/evidence_reasoning/comparison
```

Anthropic uses `ER_ANTHROPIC_API_KEY`, `ER_ANTHROPIC_MODEL` and optional `ER_ANTHROPIC_MAX_TOKENS`. Both adapters support provider-specific base URL overrides and `ER_PROVIDER_TIMEOUT_SECONDS`. Secrets are never written to artifacts.

Generate evaluations and a report:

```powershell
python -m experiments.evidence_reasoning.cli evaluate --runs output/evidence_reasoning/b1b.json --output output/evidence_reasoning/b1b-evaluation.json
python -m experiments.evidence_reasoning.cli report --b0 output/evidence_reasoning/b0.json --b1a output/evidence_reasoning/b1a.json --b1b output/evidence_reasoning/b1b.json --output output/evidence_reasoning/report.md
```

## Prompt inventory

| Prompt | Version | Purpose | Inputs | Outputs |
|---|---|---|---|---|
| B1a single shot | `b1a_single_shot_es_v1.0.0` | Direct structured baseline | Objective + source snapshots | All B1 fields + final state |
| EvidenceUnit extraction | `evidence_unit_extraction_es_v1.0.0` | Reusable objective-independent propositions | source snapshots | EU proposals |
| Objective analysis | `objective_analysis_es_v1.0.0` | Requirements, atomicity, evaluability, qualifiers | Objective only | ObjectiveAnalysis |
| Facet planning | `facet_planning_es_v1.0.0` | Composition facets without evidence fitting | Requirements only | facet plan |
| Relation reasoning | `relation_reasoning_es_v1.0.0` | Evidence↔Requirement relations and individual ceilings | Requirements + facets + EUs | relations |
| Composition/ceiling | `composition_claim_ceiling_es_v1.0.0` | Nonredundant composition and semantic ceiling decisions | staged artifacts | ClaimCeiling |

## Artifact stages

B1b serializes `01_source_extraction`, `02_evidence_units`, `03_objective_analysis`, `04_relations`, `05_facets_composition`, `06_claim_ceiling`, `07_guard_results` and `08_final_result`. It stores short structured rationales, never private chain-of-thought.

## Fixture inventory

The `inventory` command prints case, domain, split, input file, gold file and phenomenon. Holdout cases 02, 04, 10, 14, 16 and 17 are absent from prompts/few-shot rules; their labels exist only in the evaluator.

## Experimental limits

This is an engineering pilot over 17 synthetic cases, not validated scientific performance. Full evidence scan is the only retrieval mode used in Slice 0. Embeddings, vector DB and contextual EvidenceUnit recovery remain unimplemented until a separate recall experiment justifies them.
