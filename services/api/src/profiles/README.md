# Profiles Module

## Current responsibilities

The module exposes the authenticated holder profile endpoints:

- `GET /me/profile/current`;
- `POST /me/profile/rebuild`.

The rebuild endpoint creates `backend_formative_profile_snapshot_v0` using
the deterministic backend fallback. That flow remains separate from the AI
artifact contract.

## AI artifact file ingestion

The internal CLI persists an externally associated
`formative_profile_result_v0`:

```bash
npm run profile:ingest:file --workspace @credential-intelligence/api -- \
  --userId <holder-user-id> \
  --file <path-to-formative-profile-result-v0-json>
```

The command validates the artifact, verifies that the supplied user exists,
marks previous profiles as non-current and creates a new current
`FormativeProfile` with:

- `profileVersion = formative_profile_result_v0`;
- `generationMethod = ai_artifact_ingest_v0`;
- the complete artifact preserved in `profileJson`.

The `userId` is trusted only from the external CLI argument. The artifact
does not contain a trusted holder identity. Its `sourceRefs` do not currently
include backend `credentialId` or `semanticAnalysisId` values, so this slice
cannot verify source ownership end to end.

`generatedFrom.artifactCount` counts source `semantic_analysis_v1` artifacts.
It is stored in the required `credentialsCount` column only as a documented
technical approximation; it does not prove completed credentials or holder
completion. Sources of type `online_course_catalog` remain catalog evidence,
not completion evidence.

This CLI does not execute Python, call the AI module, modify credentials or
semantic analyses, recalculate hashes, or interact with blockchain.
