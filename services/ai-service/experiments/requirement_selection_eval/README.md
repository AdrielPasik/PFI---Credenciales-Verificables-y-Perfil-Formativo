# Evaluación de extracción y selección de requisitos (P0)

Set de referencia para medir la **calidad semántica** de la propuesta de requisitos del
titular (`product_requirement_extraction_v1` + `product_requirement_selection_v1`) con el
tope de 15 requisitos.

> **Estado del gold.** Las referencias de `gold/` las redactó Claude a partir de la
> política acordada. Están **pendientes de adjudicación humana** por el autor del PFI.
> Hasta entonces sirven para fijar la métrica y probar el pipeline, no como verdad final.
> Ver **[GOLD_REVIEW.md](GOLD_REVIEW.md)**: decisiones discutibles y sesgos conocidos
> (RSE_01 y RSE_06 comparten frases con los ejemplos de la política; RSE_03 y RSE_05 no).

## Contenido

| Archivo | Qué es |
|---|---|
| `postings/RSE_0N_*.md` | Seis avisos **sintéticos**, escritos para este eval (no son de terceros). |
| `gold/*.gold.json` | Por aviso: cada línea candidata con `label` (KEEP / DISCARD / BORDERLINE), categoría, prioridad (MANDATORY / REQUIRED / DESIRABLE), `group` (duplicados comparten grupo), motivo y cita literal. |
| `eval_lib.py` | Emparejamiento por cita, métricas, criterios de aceptación, permutación y simulaciones. |
| `run_simulations.py` | Simulaciones sin proveedor → `results/simulations_v1.json`. |
| `run_real_eval.py` | Eval contra el proveedor real. **Genera costo**: tres barreras y presupuesto de llamadas. |

| Aviso | Dominio | Ítems | Requisitos legítimos | Qué pone a prueba |
|---|---|---:|---:|---|
| RSE_01 | Backend fintech | 26 | 13 | tareas, actitudes, 3 condiciones en una línea, agrupaciones, duplicados entre secciones |
| RSE_02 | Analista de datos | 9 | 5 | aviso corto: cinco son cinco |
| RSE_03 | Docente secundario | 13 | 7 | capacidades cualitativas sin métricas, rutina docente |
| RSE_04 | Enfermería | 14 | 6 | matrícula y certificaciones excluyentes, "buena presencia" |
| RSE_05 | Beca doctoral | 12 | 8 | elegibilidad no formativa (edad), documentación |
| RSE_06 | Plataforma (largo) | 47 | 24 | obliga a seleccionar 15; referencia humana sin jerarquía rígida |

## Categorías

`TECHNICAL_KNOWLEDGE`, `EDUCATION_ACCREDITATION`, `EXPERIENCE`, `LANGUAGE_LEVEL`,
`PROFESSIONAL_CAPABILITY` (se conservan) · `RESPONSIBILITY_ACTIVITY` (solo si expresa una
capacidad exigida) · `ATTITUDE_GENERIC`, `CONTEXT` (nunca) · `NON_FORMATIVE_CONDITION`
(legítima pero no formativa: disponibilidad, edad, documentación; debe quedar **visible**
como pasaje con su cita, y si se emite como Requirement se cuenta como lugar consumido,
no como falso positivo) · los duplicados se marcan con el mismo `group` · lo "explícito"
va en `priority`.

`BORDERLINE` es neutral: emitirlo u omitirlo no suma ni resta precisión.

## Criterios de aceptación (por aviso)

- 0 citas inventadas (`unanchored`).
- 0 inflaciones: ningún candidato agrega "liderazgo", "competencias avanzadas", etc. que su cita no dice.
- precisión ≥ 0,90.
- todos los excluyentes conservados cuando entran en el tope; idem excluyentes + requeridos.
- 0 duplicados sustanciales y 0 fusiones de condiciones independientes.
- como máximo 15.
- todas las condiciones no formativas visibles (como Requirement o como pasaje con su cita).
- informativo: estabilidad bajo permutación de párrafos (Jaccard) y acuerdo con la selección humana.

## Correr

```bash
python experiments/requirement_selection_eval/run_simulations.py
```

Eval real (solo con autorización explícita). Llamadas esperadas: 14 (12 extracciones —6
avisos × original y permutado— + 2 selecciones de RSE_06); techo duro 24. Los precios del
modelo configurado se pasan explícitos; el costo reportado es una cota superior:

```bash
REQUIREMENT_SELECTION_EVAL_ALLOW_PROVIDER=1 python experiments/requirement_selection_eval/run_real_eval.py --allow-billable-provider-calls --max-calls 24 --max-cost-usd 5 --input-usd-per-mtok <precio> --output-usd-per-mtok <precio>
```
