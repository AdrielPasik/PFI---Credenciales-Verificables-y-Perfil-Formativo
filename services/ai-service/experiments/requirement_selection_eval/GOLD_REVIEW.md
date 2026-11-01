# Revisión crítica del gold provisional

Estado: **PROVISIONAL**. Lo redactó Claude; ninguna decisión de esta lista está
adjudicada por una persona. Hasta que lo esté, los resultados contra este gold
son indicativos.

## 1. Tres preguntas distintas, tres respuestas en el gold

| Pregunta | Dónde se responde |
|---|---|
| ¿Es un requisito legítimo de la oportunidad? | `label` ≠ DISCARD, o `category = NON_FORMATIVE_CONDITION` |
| ¿Corresponde al análisis formativo profundo (uno de los 15)? | `label = KEEP` |
| ¿Es prioritario si hay que elegir? | `priority` (MANDATORY > REQUIRED > DESIRABLE como señal, no como regla) + `humanSelection` |

| Tipo | Ejemplos | Qué se espera del sistema |
|---|---|---|
| Legítimo y formativo (`KEEP`) | Python, SQL, inglés B2, título, matrícula, RCP | Requirement; cuenta para precisión y cobertura |
| Legítimo **no formativo** (`NON_FORMATIVE_CONDITION`) | turnos rotativos, turno mañana, edad máxima, documentación, guardias | **Visible** con su cita (pasaje no convertido); emitirlo como Requirement no es error pero se cuenta como lugar consumido |
| No es requisito (`DISCARD`) | buena actitud, participar en reuniones, beneficios | No debe emitirse; si se emite es falso positivo |
| Dudoso (`BORDERLINE`) | tareas que expresan capacidad, versión débil de un duplicado | Neutral |

## 2. Requisitos obligatorios prioritarios por aviso

| Aviso | Excluyentes (MANDATORY) | Requeridos sin marca explícita |
|---|---|---|
| RSE_01 | — (la sección "Requisitos" no marca excluyentes) | título, inglés, Unix, 3 años backend, Python, bases de datos, mensajería, Docker, testing, seguridad |
| RSE_02 | — | formación, SQL, Python o R, inglés intermedio, Power BI/Tableau |
| RSE_03 | título de Profesor/a de Matemática | experiencia 2 años, planificación, plataformas, GeoGebra |
| RSE_04 | título, matrícula, 1 año de guardia, RCP avanzado | bombas/monitores, medicación |
| RSE_05 | — | título de grado, promedio ≥ 8, inglés B2 certificado, aprendizaje automático, Python |
| RSE_06 | 9 excluyentes (título, 5 años, Kubernetes, Terraform, nube, Go/Python, observabilidad, inglés B2, redes) | CI/CD, Vault, PostgreSQL, IAM, incidentes, Linux, comunicar decisiones |

Criterio de aceptación: todos los excluyentes se conservan cuando entran en 15 (en los
seis avisos entran); excluyentes + requeridos se exigen solo cuando entran (no en RSE_06: 16).

## 3. Decisiones discutibles que necesitan validación humana

| # | Aviso / ítem | Decisión provisional | Alternativa razonable |
|---|---|---|---|
| 1 | RSE_01 `documentacion` "Mantener la documentación técnica actualizada" | DISCARD (rutina) | KEEP como capacidad de redacción técnica |
| 2 | RSE_01 `apis_tarea` (tarea) y `apis_valorado` (deseable) | mismo grupo: emitir ambos = duplicado | dos claims (tarea en pagos vs experiencia general) |
| 3 | RSE_01 `python_dominio` vs `python_asyncio` | grupos distintos (difieren en fuerza, regla DUPLICADOS de OU_A2) | un solo grupo |
| 4 | RSE_01 línea "Título…, inglés avanzado y experiencia en Unix" | tres requisitos independientes | — (lo fija OU_A2) |
| 5 | RSE_03 `empatia` "Paciencia y empatía con adolescentes" | BORDERLINE | DISCARD (actitud) |
| 6 | RSE_04 `presencia` "Buena presencia" | DISCARD (no formativo, potencialmente discriminatorio) | NON_FORMATIVE_CONDITION visible |
| 7 | RSE_04 `triage` (función con protocolo) | BORDERLINE | KEEP REQUIRED |
| 8 | RSE_05 `promedio` | KEEP (acreditable con el analítico) | NON_FORMATIVE_CONDITION |
| 9 | RSE_05 `documentacion` | NON_FORMATIVE_CONDITION | CONTEXT (no es condición de la persona) |
| 10 | RSE_06 `o_hibrida` "Modalidad híbrida…" (en "Ofrecemos") | CONTEXT (ofrecido, no pedido) | NON_FORMATIVE_CONDITION |
| 11 | RSE_06 `t_guardias` | NON_FORMATIVE_CONDITION | CONTEXT |
| 12 | RSE_06 `k8s_dup` "Experiencia con Kubernetes en producción" | BORDERLINE (versión débil) | duplicado del excluyente |
| 13 | RSE_06 `humanSelection` | entra Helm/Argo CD (deseable, central); salen PostgreSQL y "comunicar decisiones" (requeridos) | 9 excluyentes + 6 requeridos por sección |
| 14 | RSE_06 `charlas` "Haber dado charlas técnicas o escrito artículos" | KEEP DESIRABLE | DISCARD (no diferencia) |

## 4. ¿El gold favorece artificialmente la implementación?

**Sí, en parte, y hay que leer los resultados con eso en mente.**

- **Simulaciones circulares.** El escenario `ORACLE_PIPELINE` sale del propio gold: que
  "pase" solo prueba que el pipeline no pierde, no inventa ni recorta. No dice nada del modelo.
- **Ejemplos de la política dentro de los avisos.** La política de extracción usa como
  ejemplos frases que aparecen casi literales en algunos avisos:

  | Aviso | Coincidencias con ejemplos de la política |
  |---|---|
  | RSE_01 | "MariaDB, MongoDB y KeyDB", "Kafka y RabbitMQ", título + inglés + Unix en una línea, "participar en reuniones", "revisar documentos", "tareas asignadas", "buena actitud" |
  | RSE_02 | "buena predisposición", "ganas de aprender" |
  | RSE_04 | "disponibilidad para turnos", "trabajo en equipo", "responsabilidad" |
  | RSE_06 | lista de actitudes, "participar en reuniones", "comunicar decisiones técnicas" |
  | RSE_03, RSE_05 | **ninguna** |

  Esos ejemplos vienen de los casos reales reportados, así que RSE_01 funciona como
  **regresión de casos conocidos**, no como prueba de generalización. **RSE_03 y RSE_05 son
  los avisos menos sesgados** y deberían leerse por separado.
- **El autor del gold leyó la política antes de escribirlo.** Mitigación recomendada: que una
  persona agregue 1–2 avisos reales o escritos sin leer la política, antes de dar el P0 por cerrado.

## 5. Qué queda para la persona revisora

1. Confirmar o cambiar las 14 decisiones de la tabla 3.
2. Confirmar la `humanSelection` de RSE_06.
3. Decidir si RSE_01 cuenta para la aceptación o solo como regresión.
4. Opcional: aportar 1–2 avisos sin solapamiento con la política.
