# Semantic Module

Responsabilidad futura:

- integracion con AI service;
- persistencia de `SemanticAnalysis`;
- manejo de artifacts `completed` y `partial`;
- preparacion del slice `Credential issued -> SemanticAnalysis`.

Alcance actual:

- modulo NestJS minimo;
- service con persistencia interna controlada y lectura read-only del latest analysis;
- validator manual para artifacts `semantic_analysis_v1`;
- mapper intermedio para preparar datos conceptuales de `SemanticAnalysis` sin escribir DB;
- persistencia interna controlada para guardar `semantic_analysis_v1` en `SemanticAnalysis`;
- fixtures y tests unitarios del contrato de artifact;
- controller read-only para exponer el ultimo `SemanticAnalysis` persistido por credencial;
- sin cliente HTTP;
- sin pipeline;
- sin analisis mock;
- sin endpoints de ingestion.

Comando local de ingestion manual:

```bash
npm run semantic:ingest:file --workspace @credential-intelligence/api -- \
  --credentialId <credential-id> \
  --file <path-to-semantic-analysis-v1-json>
```

Este comando:

- crea un Nest application context local;
- resuelve `SemanticService` via DI real del backend;
- lee un archivo `semantic_analysis_v1` desde un path recibido por argumento;
- persiste una fila `SemanticAnalysis` asociada a una credencial existente;
- no crea endpoints ni integra HTTP con el modulo IA.

Endpoint read-only actual:

```text
GET /credentials/:id/semantic-analysis/latest   (JWT + membresia de emisor)
```

Comportamiento:

- exige `AuthGuard`: sin bearer token responde `401`;
- verifica que la credencial exista;
- si no existe, responde `404`;
- exige membresia activa con rol `admin` u `operator` sobre el issuer DE ESA
  credencial, tomado de la fila persistida y nunca de un parametro; si no la
  hay, responde `403`;
- si existe y no tiene analisis, devuelve `latestSemanticAnalysis: null`;
- si existe y tiene analisis, devuelve el mas reciente por `analyzedAt desc`;
- devuelve un RESUMEN con allowlist explicita. Desde F1.5 ya no incluye
  `analysisJson`, `textForEmbedding` ni `evidenceMap`, y esas columnas tampoco
  se cargan desde la base;
- no modifica ninguna tabla ni dispara logica semantica nueva.

Hasta F1.5 esta ruta no tenia `AuthGuard` ni comprobacion de autoridad, y
devolvia el artifact crudo del pipeline: conocer un `credentialId` bastaba para
leerlo. Ver `mejoras post 50%/evidence-reasoning-f1.5-privacy-hardening-record.md`.

Principios:

- `semantic` sera adaptador u orquestador semantico, no dueno de `Credential`;
- no debe consultar ni modificar tablas de credenciales por fuera de contratos de servicio;
- debe evitar dependencias circulares con `credentials`;
- el backend seguira controlando permisos y coordinacion general desde modulos de dominio;
- el backend no debe consumir outputs crudos del pipeline IA;
- `semantic_analysis_v1` no participa de `canon_v1`;
- `credential_candidate_v1` queda fuera de este alcance.
