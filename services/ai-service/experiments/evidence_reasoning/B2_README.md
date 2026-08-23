# Evidence Reasoning B2 — Target AI Architecture v1.1

B2 es una variante experimental paralela. No reemplaza ni modifica B1a/B1b.

Pipeline:

```text
Source freeze/extraction
→ EvidenceUnit quote-first
→ deterministic alignment/authoritative trace
→ Objective quote-first
→ deterministic Requirement/qualifier alignment
→ FULL_SCAN evidence preparation
→ one unified contextual reasoning call per Requirement
→ factual validation / deterministic repair
→ deterministic epistemic policy
→ deterministic renderer
```

El modelo no controla IDs autoritativos, offsets, SHA, Credential identity, provenance ni final state. Provenance y blockchain no multiplican semantic support.

## Comandos

Solo Development; el CLI rechaza IDs no-Development:

```text
python -m experiments.evidence_reasoning.cli b2 --provider openai --cases case_01,case_08 --repeats 1 --output output/evidence_reasoning/b2-smoke/runs.json
python -m experiments.evidence_reasoning.cli evaluate-b2 --runs output/evidence_reasoning/b2-smoke/runs.json --output output/evidence_reasoning/b2-smoke/evaluation.json
python -m experiments.evidence_reasoning.cli b2-fingerprint --output output/evidence_reasoning/b2-fingerprint.json
```

No ejecutar holdout desde este track. Los resultados Development son architecture-iteration evidence, no generalization validation.
