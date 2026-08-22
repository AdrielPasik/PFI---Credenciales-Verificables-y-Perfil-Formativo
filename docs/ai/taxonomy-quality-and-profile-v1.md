# Taxonomía, calidad semántica y perfil formativo v1

## Naturaleza del análisis actual

La clasificación actual es determinista y controlada por taxonomías y reglas. No hay inferencia generativa ni traducción libre. Las etiquetas que llegan a las vistas deben provenir de la taxonomía/patrones revisados o de contenido declarado por el emisor, no de una expansión improvisada.

El pipeline considera normalización, secciones, cobertura, anclas, perfiles de área, lexicones de conceptos y patrones de evidencia para skills. La calidad depende de la señal textual disponible: un resultado `partial` o una confianza baja no es un fallo del servicio, sino una indicación de cobertura limitada que requiere lectura prudente.

## Configuración que gobierna la clasificación

La configuración se encuentra en `services/ai-service/config/semantic/`.

| Archivo | Rol |
| --- | --- |
| `area_profiles.json` | Términos fuertes, medios y leves por área. |
| `area_anchor_requirements.json` | Señales mínimas para evitar asignaciones débiles. |
| `area_context_group.json` | Agrupaciones/contextos para scoring. |
| `domain_concept_lexicon.json` | Conceptos por dominio. |
| `name_area_hints.json` | Pistas del título, nunca sustituto único de evidencia. |
| `skill_evidence_patterns.json` | Patrones que permiten afirmar una habilidad detectada. |
| `quality_flags_map.py` | Interpretación/mapeo de calidad del exporter. |

Los archivos se cargan mediante `semantic_ontology.py`. No modificar JSON sin ejecutar las pruebas de pipeline y añadir una fixture que cubra la nueva decisión.

## Caso de gestión ágil

La taxonomía incorpora el área existente **Gestión de Proyectos Tecnológicos** para contenidos sobre Scrum, Kanban, metodologías ágiles, backlog, sprint, retrospectiva, planificación, mejora continua y project management. La corrección no debe ser un `if` por una frase de curso: la clasificación debe usar combinaciones de señales de taxonomía y anclas.

La expectativa de un texto como “Gestión ágil de proyectos con Scrum y Kanban” es que no tenga “Comunicación y Humanidades” como área principal y que refleje la mejor área disponible de la taxonomía. Una modificación futura debe además conservar un caso de regresión realmente comunicacional/humanístico; no se puede mejorar gestión degradando esas áreas.

## Quality flags y presentación

Los flags son códigos de diagnóstico, no copy final de producto. El frontend debe humanizarlos o agruparlos. Mapeos aprobados:

| Flag interno | Mensaje visible seguro |
| --- | --- |
| `area_assignment_low_confidence` | La asignación de área tiene confianza baja. |
| `semantic_quality_low` | La cobertura semántica es limitada. |
| `skills_detection_reliability_medium` | La detección de habilidades requiere revisión. |
| `hours_distribution_reliability_low_or_absent` | La distribución horaria no está disponible o tiene baja confiabilidad. |
| `no_curricular_sections_detected` | No se detectaron secciones curriculares estructuradas. |
| desconocido | El análisis incluye observaciones técnicas que requieren revisión. |

Nunca mostrar el identificador técnico crudo como si fuera lenguaje de producto. Tampoco usar un flag para afirmar que una habilidad fue certificada o que una credencial perdió validez.

## Horas y confianza

Hay dos conceptos distintos:

- **Horas oficiales declaradas**: `Credential.hours`, aportadas por el emisor.
- **Horas estimadas por IA**: `hoursDistribution`, inferida solo si el artifact tiene evidencia suficiente.

No se sustituyen ni se suman como si fueran la misma fuente. Si no hay distribución confiable, el perfil debe indicarlo mediante flags/cobertura, no inventar horas a partir de título, plataforma o modalidad.

## Reconstrucción de FormativeProfile

La reconstrucción productiva vive en `services/api/src/profiles/formative-profile.service.ts`. Es determinista y consulta PostgreSQL; no vuelve a llamar FastAPI. Para un holder:

1. lee sus credenciales `issued`;
2. incorpora datos declarados permitidos;
3. selecciona la interpretación semántica usable más adecuada por credencial;
4. agrega y deduplica áreas, skills, conceptos, cobertura y horas;
5. marca perfiles anteriores `isCurrent=false`;
6. crea una generación nueva con `isCurrent=true` en una transacción.

El servicio preserva explícitamente la separación de fuentes:

| Fuente | Campos de perfil |
| --- | --- |
| Declarada por emisor | `emittedSkills`, `emittedCompetencies`, `emittedLearningOutcomes`, horas oficiales. |
| Inferida por IA | `areas`, `skills`, `concepts`, `hoursDistribution`, flags/confianza. |

Un course histórico puede contener `credentialSubject.skills`, pero la agregación moderna lo ignora como habilidad declarada para `course`; conserva competencias y resultados de aprendizaje donde corresponda. Esto evita mostrar como skill emitida una etiqueta heredada e inconsistente sin modificar la credencial histórica.

## Interpretaciones revisadas y templates

Un template reutilizable puede tener una interpretación semántica revisada por el emisor. Esa aprobación no muta el `SemanticAnalysis` bruto, no muta la credencial original, no crea una credencial nueva, no entra en hash/canon/blockchain y no significa certificación por IA.

Cuando existe una interpretación reutilizable activa, el perfil puede usar la interpretación permitida según la lógica del servicio. Esto es distinto de aplicar automáticamente un snapshot de template a una credencial nueva: esa evolución sigue pendiente y requiere un slice de dominio explícito.

## Narrativa del perfil

La síntesis se formula con lenguaje prudente, por ejemplo: “la trayectoria muestra formación en...”, “se observan contenidos relacionados con...” y “según las credenciales emitidas y análisis disponibles...”. Si cobertura, horas o análisis son parciales, debe mencionarse.

No usar “domina”, “experto”, “apto para”, “nivel profesional”, “garantiza” ni “la IA certifica”. La narrativa es una lectura agregada de evidencia, no una certificación de capacidad profesional.

## Diagnóstico de perfil aparentemente desactualizado

Seguir este orden antes de corregir UI:

1. confirmar `AnalysisRun.status=completed`;
2. confirmar que se persistió `SemanticAnalysis` para la credential;
3. revisar el log seguro de `AutomaticProfileRebuildService`;
4. verificar que hay una nueva fila `FormativeProfile` y una sola `isCurrent=true`;
5. consultar `/me/profile/current` con la sesión del holder;
6. recién entonces revisar cache o estado de la wallet.

No asumir que la wallet es la causa si faltó persistencia, ni reconstruir un perfil durante un GET para “arreglar” una lectura vieja.

## Pruebas de calidad recomendadas

Mantener fixtures representativas para:

- PDF académico con secciones claras;
- course/certification textual suficiente y otro insuficiente;
- gestión ágil con Scrum/Kanban y caso humanístico de contraste;
- señales técnicas conocidas para no degradarlas;
- texto sin secciones, sin horas y resultado `partial`;
- rebuild con datos emitted e inferred separados;
- perfil sin análisis, con análisis y con rebuild fallido best-effort.

La calidad debe medirse con resultados esperados de áreas, skills, conceptos, flags y cobertura; no solo con que el endpoint responda `200`.
