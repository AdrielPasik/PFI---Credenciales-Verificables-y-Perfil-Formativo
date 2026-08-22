# Fixture boundary

`inputs/seed_v0_inputs.json` is the only fixture file that may be loaded by B1a/B1b inference. It contains synthetic Spanish Objectives and sources, but no gold state, gold relation, gold ceiling, rationale, or phenomenon label.

`gold/seed_v0_gold.json` is loaded only by the evaluator. Holdout cases are 02, 04, 10, 14, 16 and 17. Runtime prompts and provider payload builders do not import the gold loader.

Source SHA-256 values are deterministically materialized from the exact UTF-8 input bytes before a provider payload is built. This avoids stale hand-maintained hashes while ensuring every actual model input carries a real source hash.

