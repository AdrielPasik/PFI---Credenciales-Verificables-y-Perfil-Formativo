# P2.1 — Rúbrica de evaluación de Objective Understanding (v1)

```
RUBRIC_VERSION: P2_1_RUBRIC_V1
FROZEN_BEFORE_PROVIDER_CALLS: YES
PRIMARY_EVALUATION_LANGUAGE: es
```

Esta rúbrica se congela **antes** de la primera llamada al proveedor y **antes** de ejecutar
el baseline. Ninguna de sus definiciones puede alterarse después de observar salidas.

---

## 1. Qué se mide

Una sola pregunta:

> Dado un Objective largo escrito en español, ¿el sistema identificó fielmente lo que ese
> Objective pide?

No se mide si un holder lo satisface, ni evaluabilidad, ni `finalState`, ni fit.

---

## 2. Unidad de adjudicación

La unidad es el **par (gold, candidato)**. El matching por igualdad de strings está
**prohibido** como métrica principal (P2.0 §25.3): la granularidad es justamente la variable
en disputa.

El procedimiento tiene dos etapas y la autoridad está sólo en la segunda:

```
1. ALINEACIÓN PROPUESTA     código determinista por solapamiento de excerpt y de términos
                            → sugiere pares candidatos. NO es autoridad.
2. ADJUDICACIÓN             lectura humana del claim contra el texto crudo congelado
                            → única autoridad sobre correspondencia, fidelidad y granularidad
```

**Principio de correspondencia, escrito antes de ver resultados** (P2.0 §25.3):

> Un candidato corresponde a un ítem gold cuando un lector razonable evaluaría **la misma
> condición del mundo**.

---

## 3. Cardinalidades admitidas

```
1 gold ↔ 1 candidato        correspondencia limpia
1 gold ↔ N candidatos       cubierto; además SOBRE-PARTICIÓN sólo si la separación viola §4.1
                            (algún qualifier compartido no distribuyó)
N gold ↔ 1 candidato        cubiertos; además SOBRE-FUSIÓN sólo si el Objective los
                            presentaba como criterios separados
solapamiento parcial        preservación semántica parcial
0 gold ↔ 1 candidato        no soportado (ver §5)
1 gold ↔ 0 candidatos       omisión (cuenta contra recall)
```

Un gold cubierto por N candidatos cuenta como **cubierto** aunque además se marque
sobre-partición. Recall y mis-granularidad son métricas separadas y no se compensan.

---

## 4. Recall material

```
MATERIAL_REQUIREMENT_RECALL = gold cubiertos / gold totales
```

Todos los gold del objective cuentan, incluidos los marcados `ambiguous`. Los pasajes
listados en `ambiguousPassages` **no** son gold y su ausencia no penaliza.

---

## 5. Candidatos no soportados y alucinación material

Cada candidato que no corresponde a ningún gold se clasifica en exactamente una categoría:

| Categoría | Definición | Cuenta como |
|---|---|---|
| `HALLUCINATION_MATERIAL` | El claim afirma una condición que **el texto crudo no establece**: tecnología, años, nivel, credencial, modalidad o alcance ausentes; o proviene sólo del título; o convierte prosa institucional / beneficios / metadata de plataforma en criterio | **Alucinación material** |
| `NEGATION_INVERSION` | El claim convierte en exigencia algo que el Objective marcó como no requerido, no excluyente o deseable, o invierte una cláusula que amplía elegibilidad | **Inversión de negación** |
| `AMBIGUOUS_PASSAGE` | Corresponde a un pasaje registrado en `ambiguousPassages` del gold | **Neutro**: ni recall ni alucinación |
| `NON_REQUIREMENT_SOFT` | Corresponde a un pasaje de `explicitNonRequirements` cuyo motivo es prosa de encuadre o resumen del rol, no invención | **No soportado**, no alucinación material |
| `GRANULARITY_ARTIFACT` | Fragmento producido por partir un gold; ya contabilizado en sobre-partición | **No soportado**, no alucinación material |

```
MATERIAL_HALLUCINATION_COUNT = candidatos con HALLUCINATION_MATERIAL
NEGATION_INVERSION_COUNT     = candidatos con NEGATION_INVERSION
UNSUPPORTED_CANDIDATE_COUNT  = todos los candidatos sin gold, excluidos AMBIGUOUS_PASSAGE
SEMANTIC_PRECISION           = candidatos con gold / (candidatos con gold + no soportados)
```

Convertir prosa de empresa en Requirement **es** alucinación material: el Objective no lo pide.

---

## 6. Preservación de qualifiers

Para cada par (gold, candidato) correspondiente se evalúan los `materialQualifiers` del gold:

```
PRESERVED    el qualifier sobrevive en el texto propuesto, con el mismo alcance
LOST         el qualifier desaparece (el claim queda más débil o más amplio)
STRENGTHENED el claim exige MÁS que la fuente (años inventados, nivel elevado,
             alternativa convertida en obligación, preferencia convertida en requisito)
```

```
QUALIFIER_PRESERVATION = qualifiers PRESERVED / qualifiers de gold cubiertos
STRENGTHENED_QUALIFIER_COUNT = qualifiers STRENGTHENED
```

`STRENGTHENED` se cuenta aparte **además** de restar en preservación: fortalecer en silencio
es peor que perder, porque el revisor humano no lo nota.

Un qualifier de modalidad perdido o invertido se cuenta **también** en §7.

---

## 7. Modalidad y negación

```
MODALITY_CORRECT       la modalidad del candidato coincide con la del gold
MODALITY_LOST          el gold marca PREFERRED/NOT_REQUIRED y el candidato no lo dice
MODALITY_INVERTED      el gold marca PREFERRED/NOT_REQUIRED y el candidato lo afirma como exigencia
```

`MODALITY_INVERTED` sobre un gold `NOT_REQUIRED`, o sobre un gold `PREFERRED` cuya fuente usa
un marcador negado (`no excluyente`, `no es necesario`), cuenta además como
**inversión de negación** (§5).

Para los gold con `modality: UNSPECIFIED` la modalidad no se puntúa: la fuente no la establece.

---

## 8. Granularidad

```
OVER_SPLIT   N candidatos cubren 1 gold Y la separación viola §4.1
             (un qualifier compartido —cantidad, duración, nivel, modalidad, alcance—
              no distribuyó, o se partió un sintagma nominal, o se partió una disyunción
              en exigencias acumulativas)
OVER_MERGE   1 candidato cubre N gold Y el Objective los presentaba como criterios separados
```

```
MATERIAL_MIS_GRANULARITY = (gold en OVER_SPLIT + gold en OVER_MERGE) / gold totales
```

Separar una **disyunción** (`o`, `y/o`, `al menos uno de`) en claims acumulativos es
sobre-partición material aunque el recall no se vea afectado.

---

## 9. Duplicación semántica

```
SEMANTIC_DUPLICATE_COUNT = candidatos que expresan el mismo claim que otro candidato
                           del mismo objective, sin diferencia material de fuerza
```

Dos candidatos que se solapan pero **difieren materialmente en fuerza** NO son duplicados
(P2.0 §17); colapsarlos sería el error opuesto.

---

## 10. Anclaje y validez determinista

Medido por código confiable, no por juicio:

```
QUOTE_ANCHORING_SUCCESS   = citas propuestas que existen literalmente / citas propuestas
TRUSTED_GROUNDING_VALIDITY = candidatos cuya referencia primaria ancla UNIQUE / candidatos
PROVIDER_SCHEMA_VALIDITY   = respuestas schema-válidas / llamadas
```

Una cita con múltiples ocurrencias se marca `AMBIGUOUS` y **no** puede ser primaria (P2.0 §15).
`NOT_FOUND` cuenta contra `QUOTE_ANCHORING_SUCCESS`.

Anclaje y fidelidad se reportan **por separado** (P2.0 §25.2): un candidato puede anclar
correctamente y aun así fallar fidelidad.

---

## 11. Abstención

```
UNRESOLVED_PASSAGE_COUNT      pasajes que el proveedor declara no resueltos
UNRESOLVED_JUSTIFIED          los que corresponden a ambiguousPassages del gold
UNRESOLVED_UNJUSTIFIED        los que correspondían a un gold claro (cuenta como omisión)
```

---

## 12. Gates de Development (antes de Holdout)

```
material hallucinations        = 0
negation inversions            = 0
material recall               >= 90%
qualifier preservation        >= 95%
trusted grounding correctness  = 100%
provider schema validity       = 100%
material mis-granularity      <= 10%
baseline gate                  = PASS
```

## 13. Gates de Holdout (español, empleo)

```
MATERIAL_HALLUCINATION_COUNT   = 0
NEGATION_INVERSION_COUNT       = 0
MATERIAL_REQUIREMENT_RECALL   >= 90%
QUALIFIER_PRESERVATION        >= 95%
TRUSTED_GROUNDING_VALIDITY     = 100%
PROVIDER_SCHEMA_VALIDITY       = 100%
MATERIAL_MIS_GRANULARITY      <= 10%
BASELINE_ADVANTAGE             = PASS
```

Development **no** se promedia con Holdout. No hay score global ponderado.

## 14. Gate de baseline

El candidato con proveedor debe **mejorar estrictamente** sobre el baseline en:

```
conteo de candidatos no soportados / falsos positivos materiales
conteo de duplicados semánticos
conteo de mis-granularidad material
```

y **no debe regresar materialmente** frente al baseline en:

```
recall material de Requirements
preservación de qualifiers
preservación de negación
```

Los gates absolutos de §12 y §13 rigen de forma independiente del baseline.

## 15. Cross-domain

Se ejecuta sólo después de completar Holdout, con el candidato congelado, y se reporta
**por separado**. No contribuye a ningún gate de empleo. Su función es demostrar que el
contrato no asume empleo.

## 16. Inglés

No participa del gate primario. No se ejecuta en este slice.
