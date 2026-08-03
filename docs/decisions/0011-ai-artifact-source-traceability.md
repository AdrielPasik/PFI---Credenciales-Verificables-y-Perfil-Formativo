# ADR 0011 - AI artifact source traceability

## Estado

Aceptado como direccion para P5f.

## Contexto

`SemanticAnalysis.analysisJson` preserva artifacts, pero `sourceRefs` JSON no
garantiza ownership ni referencia relacional a evidencia exacta reemplazable.

## Decision

Mantener `semantic_analysis_v1` y `formative_profile_result_v0` como artifacts
oficiales validados. Agregar en P5f `SemanticAnalysisSource` con FK a fuente
exacta y hash observado. Considerar `FormativeProfileSource` posteriormente.
No persistir debug/prompts como artifacts oficiales.

## Consecuencias

- P5f requiere migracion;
- documento/texto reemplazados siguen siendo auditables;
- el artifact no define por si solo user/credential ownership;
- modo combinado puede registrar mas de una fuente;
- stale detection/readiness obtienen una base explicable.

## Alternativas consideradas

- solo `sourceRefs` JSON: flexible pero sin integridad relacional;
- copiar contenido/bytes en SemanticAnalysis: duplicacion y privacidad;
- resolver siempre la fuente current: pierde reproducibilidad;
- meter IA en canon: contradice separacion vigente.

