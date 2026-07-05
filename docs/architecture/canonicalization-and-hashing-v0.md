# Canonicalizacion y hashing v0

> Este documento define una estrategia inicial y versionada para calcular un hash reproducible de una credencial emitida.

## 1. Por que hace falta canonizacion

El mismo hecho educativo puede representarse con diferencias operativas que no cambian su significado:

- distinto orden de propiedades JSON;
- espacios o mayusculas inconsistentes;
- metadata mutable;
- identificadores internos del sistema;
- timestamps operativos;
- datos derivados o semanticos.

Sin una representacion canonica, dos sistemas pueden calcular hashes distintos sobre una credencial equivalente.

## 2. Problema que resuelve

- permite recalcular el mismo hash a partir del mismo hecho educativo emitido;
- separa el contenido verificable de los datos operativos del sistema;
- crea un puente estable entre `credential_v1` off-chain y `blockchain_record_v1` on-chain;
- reduce falsos negativos en verificaciones por diferencias de serializacion.

## 3. Regla base

El hash no debe calcularse sobre el JSON completo persistido de la credencial. Debe calcularse sobre una proyeccion canonica versionada que incluya solo datos estables del hecho educativo emitido.

## 4. Campos que entran en el hash

La primera version de canonizacion toma como base:

- `schema_version`
- `type`
- `issuer_did`
- `subject_did`
- `title`
- `description`
- `issued_at`
- `hours`
- `credential_subject.achievement_name`
- `credential_subject.institution_name`
- `credential_subject.academic_period`
- `credential_subject.completion_date`
- `credential_subject.grade`
- `credential_subject.skills`
- `credential_subject.competencies`

## 5. Campos que no entran en el hash

- `credential_id`
- `issuer_id`
- `subject_id`
- `source_type`
- `created_at`
- `status`
- `revoked_at`
- `revocation_reason`
- `metadata`
- `raw_data`
- cualquier `blockchain_record`
- cualquier `semantic_analysis`
- logs, auditoria, tokens o sharing links

## 6. Tratamiento de `metadata`

- `metadata` queda fuera del hash en v0;
- puede servir para trazabilidad o UX, pero no se considera estable;
- si mas adelante algunos metadatos resultan verificables, deberan pasar a una nueva `canonicalization_version`.

## 7. Tratamiento de `raw_data`

- `raw_data` queda completamente fuera del hash;
- su funcion es preservar el origen o payload fuente;
- no es seguro asumir que el dato bruto sea estable ni uniforme.

## 8. Tratamiento de fechas

- usar ISO 8601 con zona UTC cuando corresponda;
- `issued_at` debe serializarse en forma normalizada, por ejemplo `2026-07-05T12:00:00Z`;
- fechas de solo calendario, como `completion_date`, se mantienen en formato `YYYY-MM-DD`;
- `created_at`, `revoked_at` y timestamps operativos no participan del hash.

## 9. Tratamiento de strings

- trim de espacios iniciales y finales;
- colapso de espacios internos repetidos a un solo espacio;
- normalizacion Unicode conceptual a una forma estable antes de serializar;
- conservar el contenido semantico, sin traducir ni reformatear arbitrariamente.

## 10. Orden de propiedades

- serializar objetos con propiedades ordenadas alfabeticamente;
- aplicar la misma regla en objetos anidados;
- para listas sin orden semantico fuerte, como `skills` o `competencies`, ordenar alfabeticamente luego de normalizar;
- para listas que representen evidencia mutable o no estable, excluirlas del hash.

## 11. Algoritmo sugerido

- algoritmo inicial sugerido: `sha-256`;
- salida codificada como hexadecimal lowercase con prefijo `0x`;
- ejemplo de formato: `0x<64-hex>`.
- en v0 el hash canonico se calcula off-chain en el backend;
- el contrato Solidity no recalcula el hash en esta etapa;
- blockchain solo almacena o compara el valor equivalente a `bytes32`;
- `hash_algorithm` permite versionar esta decision;
- si en el futuro se decide usar `keccak256`, debera introducirse una nueva `canonicalization_version` o una nueva ADR.

## 12. Relacion con `credential_v1`

- `credential_v1` puede almacenar `canonical_hash` y `canonicalization_version`;
- esos campos describen el resultado del proceso, no la fuente del proceso;
- una credencial `draft` puede no tener aun `canonical_hash` si todavia no fue emitida.

## 13. Relacion con `blockchain_record_v1`

- `blockchain_record_v1.credential_hash` debe corresponder al `canonical_hash`;
- `hash_algorithm` y `canonicalization_version` deben persistirse junto al registro blockchain;
- `network` y `chain_id` contextualizan la evidencia on-chain, pero no alteran el hash.

## 14. Relacion con revocacion

- la revocacion no cambia el `canonical_hash`;
- lo que cambia es el estado operativo de la credencial y, cuando corresponda, el estado del `blockchain_record`;
- por eso `revoked_at` y `revocation_reason` quedan fuera de la proyeccion canonica.

## 15. Objeto canonico conceptual

```json
{
  "credential_subject": {
    "academic_period": "2025-1",
    "achievement_name": "Algoritmos y Estructuras de Datos",
    "competencies": [
      "analisis de complejidad",
      "estructuras de datos"
    ],
    "completion_date": "2025-07-10",
    "grade": "8",
    "institution_name": "Universidad Ejemplo",
    "skills": [
      "algoritmos",
      "programacion"
    ]
  },
  "description": "Asignatura aprobada del plan de estudios.",
  "hours": 96,
  "issued_at": "2025-07-15T00:00:00Z",
  "issuer_did": "did:example:issuer-001",
  "schema_version": "credential_v1",
  "subject_did": "did:example:user-001",
  "title": "Algoritmos y Estructuras de Datos",
  "type": "academic_subject"
}
```

## 16. Ejemplo conceptual de calculo

1. Construir la proyeccion canonica.
2. Normalizar strings, fechas y arrays definidas como ordenables.
3. Serializar el JSON con orden deterministico de propiedades.
4. Aplicar `sha-256`.
5. Persistir el resultado en `canonical_hash`.

## 17. Versionado

- la estrategia se identifica con `canonicalization_version`;
- primera etiqueta sugerida: `canon_v1`;
- cualquier cambio en campos incluidos, reglas de normalizacion o serializacion debe crear una nueva version.

## 18. Consecuencia practica para implementacion

- el backend NestJS debe centralizar este proceso;
- el frontend no debe calcular el hash definitivo;
- el AI service y blockchain consumen el resultado, pero no definen la proyeccion canonica.
