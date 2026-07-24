# AI Backend Integration Contract v0

## 1. Objetivo

Este documento define un contrato de integracion v0 entre el modulo de IA y el backend NestJS/Prisma.

El objetivo no es describir la implementacion interna del pipeline IA ni cerrar el modelo final de APIs, sino fijar una capa intermedia estable para que:

- el backend no dependa del formato interno actual de salida IA;
- los artifacts semanticos sean versionables;
- la emision de credenciales siga protegida por reglas de dominio propias del backend;
- `canon_v1` permanezca desacoplado de JSONs crudos o estructuras internas del pipeline IA.

## 2. Diagnostico actual

El estado actual del proyecto combina un contrato versionado de `semantic_analysis_v1`, exporter offline/aditivo del lado IA y validacion/persistencia controlada del lado backend. La integracion sigue siendo local/offline: no existe HTTP entre NestJS y el runtime IA.

### Situacion actual

- existen salidas IA con riqueza semantica real para PDFs/programas academicos y para cursos/plataformas online;
- el backend ya implementa el primer slice transaccional de credenciales:

```text
Credential draft -> issue -> canonical hash -> mock/local BlockchainRecord
```

- `canon_v1` ya es una pieza sensible del sistema y no debe quedar acoplada a formatos internos variables del pipeline IA.

### Problemas de integracion si se consumiera el output actual "en crudo"

- no hay garantia formal de `schemaVersion` para artifacts de IA;
- no hay `pipelineVersion` estable para auditar cambios de extraccion;
- no hay `taxonomyVersion` estable para areas/skills/concepts;
- hoy conviven datos crudos, datos semanticos y metadatos internos en estructuras que no necesariamente separan claramente:
  - datos publicos normalizados;
  - trazabilidad;
  - debugging interno;
  - errores parciales;
- las salidas de PDFs academicos y cursos online no necesariamente exponen los mismos campos ni la misma granularidad;
- no existe todavia un `credential_candidate_v1` formal;
- `semantic_analysis_v1` ya tiene validator/mapper backend, persistencia en `SemanticAnalysis` y script local `semantic:ingest:file`;
- el backend no depende de imports, rutas internas ni runtime Python del extractor;
- `credential_candidate_v1` sigue siendo solo contrato futuro y no se ingiere;
- `formative_profile_result_v0` sigue siendo un artifact externo futuro: el backend actual construye su propio snapshot deterministico desde `SemanticAnalysis` persistidos.

### Conclusiones

- el backend no deberia adaptarse directamente al JSON interno actual de IA;
- primero debe definirse un contrato versionado de artifacts;
- luego puede implementarse un exporter/adapter en IA o una capa adaptadora controlada antes de persistir o emitir.

## 3. Principio de integracion

La integracion IA-backend debe seguir estas reglas:

1. El backend no debe depender del formato interno actual del pipeline IA.
2. El modulo de IA debe exponer o generar artifacts estables y versionados.
3. Un artifact de IA no es lo mismo que un DTO del backend.
4. Un DTO del backend no es lo mismo que una entidad persistida.
5. Una entidad persistida no es lo mismo que la proyeccion usada para `canon_v1`.
6. El hash canonico debe seguir dependiendo de una representacion normalizada del backend, no del JSON crudo de IA.

### Separacion conceptual

- Artifact IA:
  salida estable entre modulos, pensada para interoperabilidad.

- DTO backend:
  contrato de entrada/salida HTTP o contrato interno de aplicacion.

- Entidad persistida:
  modelo Prisma/DB con su propia forma de almacenamiento.

- Payload canonico:
  proyeccion estrictamente controlada usada para canonicalizacion y hashing.

## 4. Artifact propuesto: `credential_candidate_v1`

## 4.1 Proposito

`credential_candidate_v1` representa una credencial candidata normalizada, lista para revision humana o validacion backend antes de crear un draft real.

No representa una credencial emitida.
No representa identidad verificada.
No representa autorizacion institucional.
No representa evidencia blockchain.

Sirve como puente entre el modulo IA y el flujo backend:

```text
IA output -> credential_candidate_v1 -> backend validation -> POST /credentials/draft
```

## 4.2 Relacion conceptual con el backend actual

`credential_candidate_v1` puede mapear, segun el caso, a:

- `CreateCredentialDraftDto`
- `credentialSubject`
- `rawData`
- `metadata`

No debe mapear directamente a:

- `issuerId` final confiable;
- `subjectUserId` final confiable;
- `canonicalHash`;
- `canonicalizationVersion`;
- `issuedAt` final de emision;
- `BlockchainRecord`;
- estado final `issued` o `revoked`.

## 4.3 Estructura conceptual sugerida

```json
{
  "schemaVersion": "credential_candidate_v1",
  "pipelineVersion": "ai_pipeline_vX",
  "sourceType": "academic_pdf",
  "sourceRefs": {
    "fileName": "programa.pdf",
    "documentId": "doc-123",
    "pageRanges": [1, 2, 3],
    "externalUrl": null
  },
  "candidateType": "course_completion",
  "suggestedCredentialType": "course",
  "title": "Programacion Avanzada",
  "description": "Programa analizado desde PDF institucional.",
  "institution": {
    "displayName": "Demo University",
    "normalizedName": "demo university"
  },
  "provider": {
    "name": "Moodle",
    "kind": "lms"
  },
  "academicContext": {
    "programName": "Licenciatura en Sistemas",
    "academicPeriod": "2026-1",
    "curriculumVersion": "2026"
  },
  "completion": {
    "completionDate": "2026-03-01",
    "grade": "Aprobado"
  },
  "hours": 64,
  "credentialSubjectSuggestion": {
    "achievement_name": "Programacion Avanzada",
    "institution_name": "Demo University",
    "program_name": "Licenciatura en Sistemas"
  },
  "semanticHints": {
    "areas": ["software_engineering"],
    "skills": ["python", "testing"],
    "concepts": ["oop", "api_design"]
  },
  "rawExtraction": {},
  "traceability": {
    "extractionMethod": "pdf_pipeline",
    "language": "es"
  },
  "warnings": ["missing_holder_identity"],
  "qualityFlags": ["institution_inferred"]
}
```

## 4.4 Campos requeridos sugeridos

Como minimo deberia incluir:

- `schemaVersion`
- `pipelineVersion`
- `sourceType`
- `title`
- `candidateType`
- `credentialSubjectSuggestion`
- `rawExtraction` o equivalente de evidencia cruda normalizada

## 4.5 Campos opcionales sugeridos

- `description`
- `institution`
- `provider`
- `academicContext`
- `completion`
- `hours`
- `semanticHints`
- `traceability`
- `warnings`
- `qualityFlags`

## 4.6 Que puede venir de IA

Campos que razonablemente pueden ser sugeridos por IA:

- nombre del curso, logro o credencial;
- `candidateType` sugerido como clasificacion interpretativa;
- `suggestedCredentialType` sugerido como aproximacion al tipo de credencial esperado;
- `sourceType` sugerido;
- plataforma, proveedor o contexto academico;
- duracion/horas;
- archivo fuente o referencias de origen;
- `rawExtraction`;
- `credentialSubjectSuggestion`;
- hints semanticos iniciales;
- warnings de calidad o completitud.

## 4.7 Que no debe venir confiado desde IA

Estos campos no deben venir desde IA como verdad final de negocio:

- `issuerId`
- `subjectUserId`
- DID del holder
- DID del issuer
- `issuedAt` final
- `canonicalHash`
- `canonicalizationVersion`
- `BlockchainRecord`
- autorizacion institucional del issuer
- estado final de emision
- datos de sharing
- datos de verificacion
- permisos o scopes

## 4.8 Campos que pueden faltar y requerir resolucion externa

Especialmente en PDFs academicos o fuentes incompletas, pueden faltar:

- institucion emisora confiable;
- periodo academico;
- fecha de aprobacion o finalizacion;
- nota;
- issuer real;
- holder real;
- relacion entre materia/curso y entidad emisora del sistema.

Estos datos podran resolverse via:

- contexto backend;
- seleccion humana;
- catalogo institucional;
- futura logica de conciliacion.

## 4.8.1 `candidateType` vs `CredentialType`

`candidateType` no debe interpretarse como el enum final del backend.

Su funcion es expresar una clasificacion sugerida por IA sobre el tipo de evidencia o logro detectado. Puede servir como pista semantica u operativa, pero no reemplaza la validacion del backend.

Si se usa un campo como `suggestedCredentialType`, debe entenderse tambien como sugerencia, no como valor automaticamente confiable para persistencia.

El backend o adapter debera mapear y validar esa sugerencia contra el enum real `CredentialType`, por ejemplo:

- `academic_subject`
- `course`
- `certification`
- `degree`

La conversion entre clasificacion IA y enum backend debe quedar explicita y controlada antes de crear el draft.

## 4.9 PDFs academicos vs cursos online

### Para `academic_pdf`

Es esperable encontrar:

- materia o modulo;
- programa;
- institucion;
- carga horaria;
- contenidos;
- bibliografia;
- evidencia documental rica;
- mas ambiguedad respecto de holder y estado de completitud.

### Para `course_dataset` o fuente online equivalente

Es esperable encontrar:

- nombre del curso;
- plataforma;
- instructor/proveedor;
- proveedor;
- duracion estimada;
- nivel;
- skills mas explicitadas;
- areas sugeridas;
- menos riqueza curricular formal y mas valor como catalogo o fuente formativa potencial.

Importante:

- el dataset online actual no debe interpretarse por si solo como prueba de finalizacion del holder;
- tampoco prueba por si solo progreso, aprobacion ni certificado emitido;
- `completionDate`, progreso, aprobacion o certificado deberian venir de otra fuente confiable, por ejemplo:
  - issuer;
  - plataforma;
  - certificado;
  - constancia;
  - usuario;
  - metadata externa validada.

El artifact debe permitir ambos casos sin perder trazabilidad ni forzar estructuras vacias artificiales.

## 4.10 Relacion con hash canonico

`credential_candidate_v1` no debe hashearse directamente.

No deben formar parte del hash canonico:

- `rawExtraction`
- `traceability`
- `semanticHints`
- `warnings`
- `qualityFlags`
- metadatos internos de pipeline
- referencias operativas de archivo
- cualquier estructura de debugging interno

El hash debe seguir construyendose desde la representacion canonica del backend luego de validacion y emision.

## 5. Artifact propuesto: `semantic_analysis_v1`

## 5.1 Proposito

`semantic_analysis_v1` representa un artifact semantico persistible para una credencial, curso o documento fuente.

Su funcion es:

- expresar areas, skills y conceptos detectados;
- guardar evidencia semantica trazable;
- exponer niveles de confianza;
- registrar calidad y warnings;
- alimentar `SemanticAnalysis`;
- preparar la futura construccion de `FormativeProfile`.

## 5.2 Relacion conceptual con el backend

Mapea conceptualmente a:

- `SemanticAnalysis`
- futura agregacion hacia `FormativeProfile`

No debe confundirse con:

- DTO HTTP final;
- payload canonico de credencial;
- modelo interno completo del pipeline IA.

## 5.3 Estructura conceptual sugerida

```json
{
  "schemaVersion": "semantic_analysis_v1",
  "pipelineVersion": "ai_pipeline_vX",
  "taxonomyVersion": "taxonomy_vX",
  "status": "completed",
  "sourceType": "academic_pdf",
  "sourceRefs": {
    "documentId": "doc-123",
    "fileName": "programa.pdf"
  },
  "areas": [
    {
      "id": "software_engineering",
      "label": "Software Engineering",
      "confidence": 0.91,
      "source": "explicit"
    }
  ],
  "skills": [
    {
      "id": "python",
      "label": "Python",
      "confidence": 0.88,
      "source": "explicit"
    }
  ],
  "concepts": [
    {
      "id": "oop",
      "label": "Object Oriented Programming",
      "confidence": 0.84
    }
  ],
  "hoursDistribution": [
    {
      "areaId": "software_engineering",
      "hours": 40
    }
  ],
  "evidenceMap": {
    "areas": {},
    "skills": {},
    "concepts": {}
  },
  "confidence": {
    "global": 0.87,
    "coverage": 0.79
  },
  "qualityFlags": ["institution_inferred"],
  "textForEmbedding": "normalized text for embeddings",
  "warnings": [],
  "partialReasons": []
}
```

## 5.4 Campos minimos requeridos

Como minimo deberia incluir:

- `schemaVersion`
- `pipelineVersion`
- `taxonomyVersion`
- `status`
- `sourceType`
- `sourceRefs`
- `areas`
- `skills`
- `concepts`
- `evidenceMap`
- `confidence`
- `qualityFlags`
- `textForEmbedding`
- `warnings`
- `partialReasons`

## 5.5 Estados sugeridos

Para el artifact persistible final, la opcion preferida sigue siendo:

- `completed`
- `partial`

`pending` o `failed` pueden existir como estados operativos del job interno, pero no necesariamente como artifact final persistible del analisis semantico.

## 5.6 Como representar escenarios frecuentes

### Exito completo

- `status = completed`
- `warnings = []` o warnings menores no bloqueantes
- areas/skills/concepts con cobertura suficiente
- `confidence.global` razonable

### Exito parcial

- `status = partial`
- `partialReasons` informa faltantes o ambiguedades
- puede haber arrays vacios en algunas dimensiones
- pueden coexistir resultados utiles con warnings o baja confianza en ciertos campos

### Baja confianza

- no necesariamente bloquea persistencia;
- debe reflejarse en `confidence`;
- puede agregar `qualityFlags`;
- puede gatillar revision humana.

### Datos faltantes

- se expresa mediante `partialReasons`;
- no debe inventarse informacion estructural no respaldada.

### Area no resuelta

- mejor modelar explicitamente la ambiguedad en warnings/partialReasons que esconderla;
- si existe un sentinel como `unresolved_domain_candidate`, debe normalizarse con criterio comun.

### Warnings no bloqueantes

Ejemplos:

- institucion inferida;
- horas estimadas;
- skill detectada implicitamente;
- taxonomia parcial.

### Errores parciales

Si una seccion no pudo resolverse pero el resto si:

- mantener artifact util;
- `status = partial`;
- documentar la razon en `partialReasons`.

## 6. Normalizacion necesaria entre academic y online

Hoy pueden existir diferencias entre outputs de pipelines academicos y online. Antes de persistir o exponer artifacts estables, conviene normalizar al menos estos puntos:

### 6.1 `quality_flags`

Puede aparecer como dict, lista o estructura heterogenea.

Contrato recomendado:

- exponerlo como lista normalizada de codigos estables para consumo general;
- si se necesita detalle extra, guardarlo aparte como trazabilidad.

### 6.2 `skills_detected`

Puede venir como objetos ricos o como strings.

Contrato recomendado:

- exponer `skills` como lista de objetos normalizados;
- si el origen es string simple, adaptarlo antes del artifact estable.

### 6.3 `evidence_map`

Puede venir como estructura rica o simple.

Contrato recomendado:

- exponer una forma comun y versionada;
- permitir evidencia resumida publica y detalle extendido como metadata trazable.

### 6.4 Confianza por skill/area/global

Puede variar el criterio segun pipeline.

Contrato recomendado:

- definir `confidence.global`;
- permitir confianza por item;
- documentar claramente escalas y significado.

### 6.5 `areas_detected`

Puede usar sentinels como `unresolved_domain_candidate` o listas vacias.

Contrato recomendado:

- evitar mezclar sentinels tecnicos con taxonomia final publica sin explicacion;
- usar warnings/partialReasons para incertidumbre;
- reservar arrays de areas para valores taxonomicos consistentes.

### 6.6 Namespace de areas academicas vs online

Debe resolverse una taxonomia comun o una estrategia de mapeo.

### 6.7 `domain_family_detected` y `candidate_domain_family`

Si existen internamente, deben decidirse dos opciones:

- se vuelven parte del artifact estable con semantica clara;
- o quedan como metadata interna/no persistible.

### 6.8 `skills_source`

Si se distingue skill explicita vs inferida, conviene exponerlo como atributo estable, por ejemplo:

- `explicit`
- `inferred`

## 7. Que tipo de dato corresponde a cada capa

## 7.1 Datos publicos normalizados

Son aptos para persistir y eventualmente exponer:

- titulo normalizado;
- areas/skills/concepts normalizados;
- horas;
- institution/provider normalizados;
- `credentialSubjectSuggestion`;
- `qualityFlags` normalizados;
- `warnings`;
- `partialReasons`;
- `confidence`.

## 7.2 Metadatos de trazabilidad

Se pueden persistir si aportan auditoria o debugging controlado:

- `pipelineVersion`
- `taxonomyVersion`
- referencias de documento
- metodo de extraccion
- language
- paginas analizadas
- provider fuente

## 7.3 Debugging interno no persistible

Idealmente no deberia consumirse ni persistirse en backend general:

- prompts internos;
- cadenas intermedias del pipeline;
- estructuras experimentales transitorias;
- tokens o detalles internos del motor;
- artefactos temporales de resolucion.

## 7.4 Debugging persistible solo si realmente hace falta

Si por auditoria se necesita, debe quedar separado de los campos publicos:

- comparativas de candidatos descartados;
- scores internos detallados;
- razonamiento de reconciliacion;
- fragmentos extendidos de evidencia.

## 8. Relacion con el backend actual

## 8.1 Flujo deseado para credenciales

```text
current AI output
-> IA exporter/adapter
-> credential_candidate_v1
-> backend validation
-> POST /credentials/draft
-> reviewable draft
-> issue
-> canonical hash
-> BlockchainRecord
```

## 8.2 Flujo deseado para semantica

```text
current AI output
-> IA exporter/adapter
-> semantic_analysis_v1
-> SemanticAnalysis
-> FormativeProfile snapshot backend local/dev
```

## 8.3 Principio operativo

El backend debe recibir artifacts ya normalizados o, como alternativa transitoria, una capa adaptadora bien encapsulada debe transformar la salida actual antes de tocar DTOs o persistencia.

## 9. Mapping con el backend actual

## 9.1 `CreateCredentialDraftDto`

| Campo backend | Fuente esperada | Hash canonico | Requerido | Estado actual |
| --- | --- | --- | --- | --- |
| `issuerId` | backend/issuer/user | no | si | no debe venir confiado desde IA |
| `subjectUserId` | backend/user | no | si | no debe venir confiado desde IA |
| `type` | IA sugerido + backend valida | no | si | parcialmente disponible |
| `title` | IA | si | si | disponible |
| `description` | IA | si si aplica | no | disponible/inconsistente segun fuente |
| `sourceType` | IA sugerido + backend valida | no | si | disponible pero requiere normalizacion |
| `hours` | IA/contexto | si si aplica | no | variable segun fuente |
| `credentialSubject` | IA sugerido + backend valida | si en campos relevantes | si | hoy no formalizado |
| `metadata` | IA/backend | no | no | posible, pero sin contrato estable |
| `rawData` | IA | no | no | existe conceptualmente, sin contrato formal |
| `academicCourseId` | backend/catalogo | no | no | suele faltar |
| `externalCourseId` | backend/catalogo | no | no | suele faltar |

## 9.2 `Credential`

| Campo entidad | Fuente esperada | Hash canonico | Requerido | Estado actual |
| --- | --- | --- | --- | --- |
| `issuerId` | backend | no | si | backend |
| `subjectUserId` | backend | no | si | backend |
| `type` | draft validado | si indirectamente | si | ok |
| `title` | draft validado | si | si | ok |
| `description` | draft validado | si si aplica | no | ok |
| `sourceType` | draft validado | no | si | ok |
| `status` | backend | no | si | backend |
| `hours` | draft validado | si si aplica | no | ok |
| `credentialSubject` | draft validado | si parcialmente | si | ok |
| `metadata` | draft/IA/backend | no | no | ok |
| `rawData` | draft/IA | no | no | ok |
| `issuedAt` | backend/emision | si | no en draft, si en issued | backend |
| `canonicalHash` | calculado backend | si | no en draft, si en issued | backend |
| `canonicalizationVersion` | calculado backend | si | no en draft, si en issued | backend |

## 9.3 `credentialSubject`

| Campo | Fuente esperada | Hash canonico | Requerido | Estado actual |
| --- | --- | --- | --- | --- |
| `achievement_name` | IA | si | si para emitir | debe formalizarse en candidate |
| `institution_name` | IA/contexto/backend | si | si para emitir | puede faltar en academic u online |
| `program_name` | IA/contexto | no en `canon_v1` actual | no | util como contexto; si alguna vez entra al hash debera hacerse con nueva `canonicalizationVersion` |
| `grade` | IA/contexto | si si aplica | no | frecuentemente faltante |
| `completion_date` | IA/contexto | si si aplica | no | variable |
| otros campos semanticos | IA | depende | no | requiere definicion por version |

## 9.4 `SemanticAnalysis`

| Campo backend | Fuente esperada | Hash canonico | Requerido | Estado actual |
| --- | --- | --- | --- | --- |
| `credentialId` | backend | no | si | backend |
| `status` | IA artifact/backend | no | si | requiere contrato estable |
| `areas` | IA | no | si | disponible pero no formalizado |
| `skills` | IA | no | si | disponible pero heterogeneo |
| `concepts` | IA | no | si | disponible pero heterogeneo |
| `evidenceMap` | IA | no | si | requiere normalizacion |
| `confidence` | IA | no | si | requiere criterio comun |
| `textForEmbedding` | IA | no | si | disponible conceptualmente |
| `warnings` | IA | no | no | util pero no formalizado |
| `partialReasons` | IA | no | no | util pero no formalizado |

## 9.5 `FormativeProfile`

| Campo conceptual | Fuente esperada | Hash canonico | Requerido | Estado actual |
| --- | --- | --- | --- | --- |
| agregados por area | `SemanticAnalysis` persistido | no | si para snapshot | implementado en rebuild backend local/dev |
| agregados por skill | `SemanticAnalysis` persistido | no | si para snapshot | implementado en rebuild backend local/dev |
| concepts/evidence | `SemanticAnalysis` persistido | no | si para snapshot | implementado en `profileJson` con ids trazables |
| coverage/confidence | promedio simple backend | no | si disponible | implementado como `derived` o `unavailable` |
| profile versioning | backend | no | si | `backend_formative_profile_snapshot_v0` en el snapshot actual |

## 10. Campos que no deben venir desde IA

Estos campos deben mantenerse fuera del contrato de confianza del modulo IA:

- `issuerId`
- `subjectUserId`
- identidad DID del holder
- identidad DID del issuer
- autorizacion del issuer
- `canonicalHash`
- `canonicalizationVersion`
- `BlockchainRecord`
- `issuedAt` final
- estado de emision
- estado de revocacion
- datos de sharing
- datos de verification
- permisos/scopes institucionales

## 11. Decisiones pendientes

Antes de implementar integracion real conviene resolver:

1. Si IA generara directamente `credential_candidate_v1` y `semantic_analysis_v1`, o si el backend/adaptador hara esa transformacion.
2. Si estos artifacts tendran JSON Schema formal versionado.
3. Si la validacion estructural se hara con Pydantic en IA, validacion propia del adapter, DTOs backend o una combinacion.
4. Como versionar `pipelineVersion`.
5. Como versionar `taxonomyVersion`.
6. Como representar confianza global de forma consistente.
7. Como manejar `partial` y baja confianza sin perder utilidad.
8. Como tratar faltantes frecuentes en PDFs academicos.
9. Como alinear online y academic sin perder riqueza semantica.
10. Si `SemanticAnalysis` se almacenara como JSONB amplio, parcialmente normalizado o hibrido.
11. Que parte, si alguna, del analisis semantico podria influir alguna vez en el hash canonico.
12. Como preservar auditabilidad sin acoplar backend al formato interno del pipeline.

## 12. Recomendacion final

La recomendacion para esta etapa es:

1. Aprobar este contrato v0 como capa intermedia de integracion.
2. Mantener `semantic_analysis_v1` como artifact offline/aditivo y usar la ingestion local controlada mientras no exista HTTP.
3. Mantener `credential_candidate_v1` documentado, pero sin ingestion real hasta contar con evidencia confiable de holder, completion e issuer.
4. Definir el contrato futuro de `formative_profile_result_v0` sin mezclarlo con el snapshot backend actual.
5. Mantener `canon_v1` protegido y sin mezclarlo con JSON crudos del pipeline IA.

## 13. Criterio operativo para la siguiente iteracion

La siguiente iteracion de integracion deberia enfocarse en:

- definir un ejemplo real de `credential_candidate_v1`;
- definir un ejemplo real de `semantic_analysis_v1`;
- elegir donde vive el adapter/exporter;
- documentar validaciones minimas backend sobre el candidate artifact;
- recien despues exponer endpoints o servicios de ingestion controlados.

Hasta entonces, el backend debe seguir tratando la salida IA actual como input no contractual y no como payload de persistencia directa.

## 14. Addendum: decision de integracion por fases

Luego de revisar la viabilidad real desde el modulo IA, la decision v0 para la integracion queda ajustada de esta forma:

### 14.1 Primera integracion implementable

La primera integracion implementable sera `semantic_analysis_v1` como artifact offline/exportado desde IA.

Esto implica:

- el primer exporter debe vivir del lado IA;
- el exporter debe ser aditivo y de solo lectura sobre los outputs actuales;
- el backend no debe consumir outputs crudos de IA;
- no se crea todavia endpoint HTTP de ingestion;
- el backend recibe el artifact mediante el script local controlado `semantic:ingest:file` y lo persiste en `SemanticAnalysis`;
- no se toca `canon_v1`.

### 14.2 Estado de `credential_candidate_v1`

`credential_candidate_v1` queda documentado como contrato futuro, pero no debe implementarse todavia como integracion real.

Motivo principal:

- los PDFs academicos actuales representan syllabus o definiciones curriculares, no evidencia de aprobacion o completion de un holder;
- el dataset online actual funciona como catalogo de cursos o fuente formativa potencial, no como evidencia de completion del holder;
- hoy no hay holder confiable, issuer confiable, periodo academico, nota ni `completionDate` en las fuentes actuales.

Por eso, `credential_candidate_v1` no debe representar completion si la fuente real solo describe catalogo o syllabus.

Valores prudentes conceptuales para clasificacion sugerida:

- `academic_subject_definition` para PDFs academicos actuales;
- `course_catalog_entry` para cursos online de catalogo.

### 14.3 Relacion con canonicalizacion y hash

Esta decision no cambia el principio central del contrato:

- `semantic_analysis_v1` no participa en `canon_v1`;
- `credential_candidate_v1` no se hashea directamente;
- el hash canonico sigue dependiendo de la representacion normalizada del backend;
- el backend no debe adaptar ni hashear JSONs crudos del pipeline IA.

### 14.4 Confianza y procedencia

Para futuras versiones del exporter o del artifact semantico, conviene poder distinguir la procedencia del valor de confianza. Valores conceptuales aceptables:

- `measured`
- `derived`
- `heuristic`
- `unavailable`

Esto permite diferenciar:

- confianza realmente medida por el pipeline;
- confianza derivada a partir de otros indicadores;
- confianza heuristica agregada por una capa adaptadora;
- ausencia total de confianza disponible en la fuente.

### 14.5 Proximo paso recomendado

El exporter offline/aditivo de `semantic_analysis_v1` ya puede alimentar el backend por el script local controlado. El siguiente paso de integracion debe definir como se validara y entregara `formative_profile_result_v0` externo, sin confundirlo con el snapshot backend actual ni con un payload de frontend.

### 14.6 Estado de perfil formativo en backend

El backend implementa actualmente `GET /me/profile/current` y `POST /me/profile/rebuild` para holder autenticado.

- el rebuild consume solo credenciales `issued` y el ultimo `SemanticAnalysis` por credencial;
- agrega datos ya persistidos sin ejecutar NLP ni Python;
- conserva trazabilidad por `credentialId` y `semanticAnalysisId`;
- crea snapshots `FormativeProfile` y mantiene uno actual mediante transaccion;
- excluye drafts y credenciales revoked del calculo;
- no modifica `Credential`, `SemanticAnalysis`, `BlockchainRecord`, `canonicalHash` ni `canon_v1`.

Este snapshot no equivale todavia a ingestion de `formative_profile_result_v0` producido por IA. Una futura integracion debera decidir si ese artifact externo reemplaza, complementa o se compara con la agregacion deterministica actual.
