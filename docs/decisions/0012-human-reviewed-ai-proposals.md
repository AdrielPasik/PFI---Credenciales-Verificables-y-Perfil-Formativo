# ADR 0012 - Human-reviewed AI proposals

## Estado

Aceptado como direccion para P5h/P6a.

## Contexto

Los artifacts semanticos pueden sugerir descripcion, skills, competencias y
resultados, pero no prueban por si solos que esos claims sean oficiales.

## Decision

Persistir propuestas separadas del `SemanticAnalysis` y de `Credential`.
Permitir al emisor autorizado aceptar, editar o rechazar por campo. Solo una
decision humana aplica el PATCH normal al draft y deja trazabilidad.

## Consecuencias

- la IA no modifica credenciales automaticamente;
- P5h/P6a probablemente requieren migracion;
- propuestas deben detectar draft/fuentes stale;
- confidence, warnings y evidencia se presentan sin afirmar certeza;
- `canon_v2` se decide despues de estabilizar revision/readiness.

## Alternativas consideradas

- PATCH automatico desde IA: riesgo de claims no confirmados;
- guardar solo respuesta cruda: contrato inestable e inseguro;
- aceptar/rechazar todo: poca explicabilidad y control;
- decidir `canon_v2` ahora: prematuro antes de claims finales.

