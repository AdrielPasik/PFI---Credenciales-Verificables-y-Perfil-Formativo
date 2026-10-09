# Reranking local de áreas con embeddings v1

## Estado

La implementación está disponible pero desactivada. No hay valores de
producción para `lambda` ni para el margen relativo. `semantic_analysis_v1` no
cambia y no expone diagnósticos de embeddings.

## Alcance y punto de integración

`semantic_builder.infer_areas_with_validation` primero construye candidatos con
las reglas existentes. Solo después de anclas, filtros, mínimos de evidencia y
penalizaciones, el reranker puede reordenar esos candidatos. Las reglas de
primaria/secundaria, pares y gates posteriores conservan sus condiciones y
scores léxicos.

La entrada es exclusivamente nombre, `objectives_raw` y secciones curriculares
de contenidos extraídas de la fuente. No usa resúmenes, labels, áreas,
conceptos, keywords, skills ni vectores persistidos.

## Prototipos

`services/ai-service/config/semantic/area_embedding_references_v1.json` cubre
exactamente las áreas activas. Sus descripciones se derivan de la taxonomía y
perfiles actuales, no de Development ni Holdout. Cualquier modificación exige
nueva `referencesVersion`, revisión taxonómica y evaluación posterior sin
retocar los prototipos con Holdout.

## Fórmula

Para `n >= 2` candidatos ya elegibles, se calcula el orden léxico actual y el
orden por coseno. Para cada candidato de rango `r`:

`rank_score(r) = 1 - (r - 1) / (n - 1)`

Con `L_a` como rango léxico normalizado y `E_a` como rango embedding
normalizado:

`C_a = (1 - lambda) * L_a + lambda * E_a`

Se ordena por `C_a` descendente y, ante empate, por el rango léxico original.
No se divide `validated_area_score` por 40 ni se interpreta coseno como
probabilidad.

Antes de fusionar, se exige que `coseno_1 - coseno_2 >= margen_relativo`.
Ese margen compara separación relativa entre los dos mejores candidatos; no
filtra por un coseno absoluto. Con un solo candidato, fuente vacía, fallo de
modelo, configuración inválida o referencias ausentes, se usa el baseline
exacto.

## Política de textos largos congelada

`area_embedding_long_text_policy_v1.json` fija la representación de cualquier
texto fuente. El tokenizer del modelo parte la secuencia fuente en orden, sin
solapamiento, con hasta 480 tokens fuente por chunk. Los cortes se retroceden a
un límite seguro de palabra SentencePiece cuando hace falta, sin repetir ni
omitir tokens. Cada input efectivo es `query: <chunk>` y se valida con special
tokens incluidos antes de codificar; ninguno puede superar 512 tokens.

El encoder normaliza cada vector de chunk. Para tamaños de chunk `t_i`, el
documento se representa como:

`L2_normalize(sum((t_i / sum(t_j)) * v_i))`

No se aplican overlap, max similarity, top-k, pesos de sección, truncamiento ni
agregación parcial. Si falla cualquier chunk, el resultado vuelve exactamente
al baseline léxico. El diagnóstico interno agrega versión de política, total
de tokens fuente, cantidad y tamaños de chunks, y método de agregación; no
guarda texto de chunks ni vectores.

## Operación y privacidad

El modelo es `intfloat/multilingual-e5-small` fijado en
`fd1525a9fd15316a2d503bf26ab031a61d056e98`; se carga lazy una vez por ruta de
modelo local. `transformers` y `torch` son opcionales y el runtime usa
`local_files_only=True`. El directorio preaprovisionado debe contener
`pfi-model-manifest.json` con:

```json
{"modelId":"intfloat/multilingual-e5-small","revision":"fd1525a9fd15316a2d503bf26ab031a61d056e98"}
```

El loader rechaza un manifest ausente o una revisión distinta. No se permite
red durante inferencia.

El diagnóstico interno contiene revisión de modelo, versión de referencias,
rango y score léxico, coseno, rango embedding, score combinado, aplicación y
motivo de fallback. No contiene vector ni texto fuente y no se exporta en el
artefacto público.

## Diseño de Development y Holdout

Crear ejemplos sanitizados con fuente original estructurada y una etiqueta de
área revisada por personas. Separar antes de calibrar:

| Split | Uso | Prohibición |
| --- | --- | --- |
| Development | Elegir `lambda` y margen relativo; comparar baseline y variante. | No modificar prototipos a partir de Holdout. |
| Holdout | Medición final congelada. | No ajustar configuración, reglas ni referencias. |

Ambos splits deben incluir informática, ciencias naturales y de la vida,
ingenierías mecánica, eléctrica y electrónica, alimentos/agro, ciencias básicas
y dominios humanísticos o regulatorios cuando tengan área existente. Incluir
casos cercanos entre áreas de una misma familia, entradas ambiguas que deben
quedar parciales y ejemplos con uno o varios candidatos. Reportar como mínimo
accuracy top-1 cuando haya área gold, recall@2, cambios respecto de baseline,
tasas de fallback y métricas por familia. No interpretar un ejemplo individual
ni las similitudes crudas como evaluación global.
