# Aplicación de interpretación semántica aprobada (C4b/C5b) — diseño v0.2

Estado: **diseño, no implementado**. Historial: v0 (C4b.0, auditoría +
diseño inicial) → v0.1 (C4b.0.1, hardening de arquitectura/integridad) →
**v0.2 (C4b.0.2, esta versión: corrección focalizada de la comparación de
compatibilidad semántica)**. Sigue siendo exclusivamente auditoría/diseño
— no introduce código funcional, no crea migraciones, no toca
`schema.prisma`, no aplica ningún snapshot.

La dirección general (Alternativa E: tabla dedicada, separación estricta
de `SemanticAnalysis` bruto, sin snapshots vivos, sin tocar
canon/hash/blockchain; explicit post-issuance apply; provenance histórica
congelada; único `active`; idempotencia/reapply; `Credential.
sourceTemplateId` diferido; perfil con provenance por contribución;
privacidad diferenciada issuer/holder/public/verifier) queda **APROBADA y
no se reabre en esta versión**. C4b.0.2 corrige únicamente dos puntos
finales antes de implementar C4b.1a:

1. **`destinationCompatibility`/`templateContentStatus` ahora comparan
   contra la credencial ORIGEN real de la interpretación aprobada, nunca
   contra el estado actual (mutable) del template** — sección 11,
   reescrita.
2. **`sourceApprovalStatus` se renombra a `approvalDriftStatus`, y su
   tercer estado pasa de `newer_approval_available` a
   `different_approval_available`** — porque el código solo comprueba
   desigualdad (`!=`), nunca posterioridad temporal (`>`) — sección 7.

---

## 0. Qué cambió en el hardening v0.1 — resumen visible (histórico; los cambios de C4b.0.2/v0.2 están en la introducción, arriba, y detallados en las secciones 7 y 11)

1. **Momento de congelación:** se evaluaron explícitamente A (durante la
   emisión), B (acción explícita justo antes de emitir) y C (acción
   explícita después de una emisión exitosa). **Se confirma C**, con
   justificación exhaustiva contra A y B (sección 5). *"Credential issued
   sin interpretación aplicada"* queda establecido como **invariante de
   diseño**, no como caso límite tolerado.
2. **Provenance histórica:** se reemplaza la dependencia implícita del
   estado *actual* de `IssuerCourseTemplate` por seis campos `source*`
   copiados y congelados en el momento de aplicar
   (`sourceSemanticAnalysisId`, `sourceCredentialId`,
   `sourceApprovedByUserId`, `sourceApprovedAt`, `sourcePipelineVersion`,
   `sourceTaxonomyVersion`), distintos de `appliedByUserId`/`appliedAt`
   (sección 6).
3. **`sourceTemplateUpdatedAt` queda eliminado** por ambiguo. Se reemplaza
   por `sourceApprovedAt` (copia exacta de
   `IssuerCourseTemplate.approvedSemanticApprovedAt`, nunca
   `template.updatedAt`) y un enum explícito `approvalDriftStatus`
   (`none_applied` / `up_to_date` / `different_approval_available`, nombre
   final tras C4b.0.2 — ver sección 7) en vez del booleano ambiguo
   `possiblyOutdated`.
4. **Único `active` por credencial:** se diseña con un **partial unique
   index** de PostgreSQL (`UNIQUE (credentialId) WHERE status='active'`),
   agregado como SQL explícito en la migración (Prisma no lo expresa en
   `schema.prisma`), más `Serializable` a nivel de transacción como
   primera línea de defensa (sección 8).
5. **Idempotencia y re-aplicación:** ya no se basa en `templateId` (que no
   identifica una aprobación semántica concreta). Se basa en la tupla
   `(sourceSemanticAnalysisId, sourceApprovedAt)` como identidad práctica
   de la aprobación fuente — sin inventar un `revisionId` nuevo ni tocar
   canon/hash (sección 9).
6. **`Credential.sourceTemplateId` queda diferido**, explícitamente fuera
   de C4b.1. El flujo C3c actual (`createDraft` + `PATCH` best-effort) no
   puede garantizar honestamente su significado ("aplicado con éxito", no
   "solo seleccionado") sin scope creep. La migración de C4b.1 se reduce a
   **una sola tabla nueva** (sección 10).
7. **Drift de contenido** se modela como **tres** conceptos separados
   (corregido en C4b.0.2, sección 11): `approvalDriftStatus` (¿la
   aprobación del template cambió?), `templateContentStatus` (¿el
   template actual sigue describiendo lo mismo que su propia fuente
   aprobada? — advertencia editorial, nunca bloquea) y
   `destinationCompatibility` + `changedFields[]` (¿la credencial destino
   es compatible con la credencial que realmente originó la
   interpretación? — el control que gatea `apply`). Las comparaciones de
   contenido siempre son contra la **credencial origen real**, nunca
   contra el estado actual del template, y nunca con `canonicalHash`.
8. **Modelo de perfil corregido:** se descarta un `provenance` escalar por
   área/skill/concept (incorrecto cuando varias credenciales aportan la
   misma etiqueta con proveniencias distintas). Se reemplaza por
   `sources[]` por contribución + `provenanceSummary` agregado liviano
   (sección 12).
9. **Privacidad:** se confirma el patrón de allowlist explícito ya vigente
   en todo el dominio, y se detecta un **riesgo concreto real** en
   `profile-sharing.service.ts` (pass-through por `.slice()` sin
   remapeo campo-a-campo) que debe corregirse **antes** de agregar
   `provenanceSummary` al perfil holder, para no filtrarlo al perfil
   público por accidente (sección 13).
10. **Lifecycle de rebuild de perfil (C5b, a futuro):** se especifica
    reutilizar tal cual el servicio ya existente
    `AutomaticProfileRebuildService.rebuildAfterAutomaticAnalysis`
    (best-effort, nunca revierte, mismo patrón que C2b.4) — sin agregar
    infraestructura nueva (sección 15).
11. **Migración:** sigue siendo **sí**, pero el alcance se reduce respecto
    a v0 — **una sola tabla nueva**, sin columna nueva en `Credential` (ver
    punto 6).

---

## 1. Resumen ejecutivo (revisado)

- **Momento de congelación:** acción explícita del emisor, **después** de
  una emisión exitosa (Alternativa C de la sección 5). Nunca automática,
  nunca dentro de la transacción de emisión.
- **Qué se congela:** copia inmutable de `approvedSemanticSnapshot` más
  seis campos `source*` de provenance histórica — nunca una referencia
  viva al estado actual del template (sección 4, ya confirmado en v0).
- **Arquitectura de almacenamiento:** tabla nueva
  `CredentialReusableSemanticInterpretation` (Alternativa B/E). Se
  descarta `Credential.sourceTemplateId` de este slice.
- **Requiere migración:** sí — una tabla nueva, aditiva. Sin cambios a
  `Credential`, `IssuerCourseTemplate` ni `SemanticAnalysis`.
- **Garantía de integridad:** único `active` por credencial vía partial
  unique index de Postgres, con `Serializable` como defensa adicional.
- **Perfil:** prioridad por credencial (`issuer_reviewed` >
  `ai_inferred` > ninguna), pero la agregación entre credenciales para una
  misma etiqueta preserva la proveniencia por contribución
  (`sources[]`), nunca un escalar único.
- **Compatibilidad semántica (corregida en C4b.0.2):** tanto la
  advertencia editorial sobre el template (`templateContentStatus`) como
  el control que gatea `apply` (`destinationCompatibility`) se calculan
  siempre contra la **credencial origen real** de la interpretación
  aprobada — nunca contra el estado actual del template, que puede haber
  cambiado sin que el template haya sido re-aprobado (sección 11).
- **Canon/hash:** sin cambios, confirmado (sección 14).

---

## 2. Auditoría

*(2.1–2.14 preservados de v0 — auditoría ya verificada con cita
archivo:línea; se agrega 2.15, nueva en este hardening.)*

### 2.1 Cómo se crea hoy una credencial desde un template reutilizable

Flujo actual (C3c), 100% frontend + un `PATCH` best-effort:

1. El emisor busca un template reutilizable (`listCourseTemplates`,
   `searchReusableTemplates` en `new-credential-route.tsx`) y lo selecciona.
2. `createDraft` crea un `Credential` normal (`draft`) llamando al mismo
   endpoint de creación de siempre (`POST .../credentials`) — **sin**
   ninguna referencia al template en el body.
3. `applyTemplateToNewDraft` (`apps/web/src/features/credentials/
   new-credential-route.tsx:120-160`) hace un **segundo** request, un
   `PATCH` del draft recién creado, copiando **valores escalares** del
   template (`description`, `hours`, `externalUrl`, `competencies`, y
   campos específicos de `course`/`certification`) al
   `credentialSubject`/campos del draft.
4. Si ese `PATCH` falla, no se revierte nada — solo se agrega
   `?templateApply=failed` a la URL de redirección para avisar en el
   detalle (`credential-detail-route.tsx`, comentario "C3c fix").

### 2.2 ¿El draft o la credencial guardan alguna referencia al template usado?

**No.** Ni `Credential` (`schema.prisma:240-285`) ni el DTO de creación de
draft persisten un `templateId`/`sourceTemplateId`. `Credential.metadata`
(`Json?`) existe como campo libre, pero el flujo de creación-desde-template
nunca lo escribe.

### 2.3 ¿`IssuerCourseTemplate.createdFromCredentialId` alcanza?

**No — es la dirección opuesta.** Template → credencial de origen
histórico (`createTemplateFromCredentialForIssuer`,
`issuer-course-templates.service.ts:176-215`), nunca "credencial nueva →
template usado".

### 2.4 ¿Dónde vive `approvedSemanticSnapshot`?

Exclusivamente en `IssuerCourseTemplate` (`schema.prisma:541-578`), como
un único slot `Json?` **mutable** — re-aprobar lo sobrescribe sin
versionar el valor anterior (`issuer-course-templates.service.ts:378-533`).
Sin endpoint de revocación/re-aprobación controlada.

### 2.5 Qué contiene `approved_template_semantic_snapshot_v2`

Definido en `issuer-course-templates.helpers.ts:183-197`
(`ReviewedApprovedTemplateSemanticSnapshot`): schema,
`semanticAnalysisSchema`, `sourceSemanticAnalysisId`, `status`,
`originalSummary` (solo conteos), `areas`/`skills`/`concepts` revisados,
`hoursDistribution`, `confidence`, `warnings`, `qualityFlags`,
`review.issuerReviewed`. Excluye explícitamente `analysisJson` crudo,
`evidenceMap`, `textForEmbedding`, storage keys/paths, ids de evidencia,
contenido crudo (`issuer-course-templates.helpers.ts:124-140`).

### 2.6 Cómo se persiste hoy `SemanticAnalysis`

`schema.prisma:287-311`. Fila inmutable por ejecución de IA real, nunca se
actualiza, siempre se crea una nueva.

### 2.7 Cómo se consume hoy `SemanticAnalysis` en `FormativeProfileService`

`formative-profile.service.ts:153-238`. Toma solo la **última**
`SemanticAnalysis` por credencial `issued` para alimentar acumuladores
**inferidos**; `credentialSubject` alimenta acumuladores **emitidos**
completamente separados, sin `confidence`. Ya existen dos fuentes bien
separadas en el JSON de salida.

### 2.8 ¿Existe hoy alguna distinción de "revisado por el emisor"?

**No**, confirmado por lectura completa del servicio.

### 2.9–2.14

Sin cambios respecto a v0 (riesgos de snapshot vivo, edición de draft
antes de emitir, desactualización del snapshot respecto al contenido
final, qué debería ver cada actor, si requiere migración, riesgos de
copiar sin provenance). Ver el detalle completo conservado íntegro más
abajo en las secciones correspondientes de este documento (4, 6, 7, 11,
13, 14), donde cada uno de estos puntos se resuelve con más precisión que
en v0.

### 2.15 (nuevo) Auditoría del issue flow, solo lectura

`services/api/src/credentials/issuer-credential-issue.service.ts:32-98`
(`issueForIssuer`) y `credentials.service.ts:227-330`
(`issueCredential`):

- `issueCredential` ejecuta, dentro de un único `$transaction`
  (`credentials.service.ts:305-330`): (1) actualizar `Credential.status`
  a `issued` + `issuedAt` + `canonicalHash` + `canonicalizationVersion`,
  y (2) crear el `BlockchainRecord` correspondiente
  (`blockchainEvidenceService.createRecord`). Es una transacción **crítica
  y minimalista** — solo contiene lo estrictamente necesario para el
  evento de emisión verificable.
- `issueForIssuer` (`issuer-credential-issue.service.ts`) es el
  orquestador que **envuelve** esa llamada y, **fuera** de esa transacción,
  invoca dos análisis automáticos best-effort
  (`automaticDocumentAnalysisService`/`automaticCourseTextAnalysisService`),
  cada uno en su propio `try/catch` con el comentario explícito: *"
  Automatic analysis is best-effort and must never roll back issuance."*
  (líneas 74-76 y 89-91).
- Este es exactamente el patrón arquitectónico ya establecido y ya
  probado que C4b debe seguir: **nunca** tocar la transacción crítica de
  `issueCredential`; cualquier efecto secundario semántico vive
  **después**, desacoplado, sin capacidad de revertir la emisión.
- Este patrón best-effort ya se extiende un paso más:
  `AutomaticDocumentAnalysisService`/`AutomaticCourseTextAnalysisService`
  a su vez llaman, si el análisis completa con éxito,
  `AutomaticProfileRebuildService.rebuildAfterAutomaticAnalysis`
  (`automatic-profile-rebuild.service.ts`) — también best-effort, también
  con su propio `try/catch` documentado (ver sección 15). Esta cadena de
  tres niveles (emisión → análisis automático → rebuild de perfil, cada
  uno best-effort respecto al anterior) es el precedente directo para
  diseñar C4b/C5b.

---

## 3. Snapshot vivo vs. congelado (QUÉ se congela) — confirmado de v0

Sin cambios respecto a v0: **congelado**, nunca vivo. Ver matriz y
justificación completa en la sección 6 (Alternativas) y la matriz final
(sección 18). Este documento distingue explícitamente esta decisión
(**qué** se copia) de la decisión de la sección 5 (**cuándo** se copia) —
son dos ejes independientes que v0 no separaba con suficiente claridad.

---

## 4. Momento de congelación (CUÁNDO) — A/B/C evaluadas explícitamente

Este es el punto central del hardening. v0 asumió post-issuance sin
comparar formalmente contra las otras dos variantes temporales posibles.
Se corrige acá.

### A. Freeze durante la emisión

- **Estabilidad de la credencial:** alta en apariencia (todo aparece
  junto), pero acopla dos conceptos con ciclos de vida distintos.
- **Atomicidad:** solo es realmente "durante la emisión" si se inserta
  dentro del `$transaction` de `issueCredential` (sección 2.15). Fuera de
  esa transacción, cualquier código "inmediatamente después de emitir"
  deja de ser A y pasa a ser C.
- **Interacción con la transacción actual:** **alta** — requeriría tocar
  directamente la transacción crítica de canon/hash/blockchain
  (`credentials.service.ts:305-330`), violando "no modificar el issue
  flow" y contradiciendo el patrón ya establecido en el propio código
  (comentario explícito citado en 2.15).
- **Riesgo blockchain:** alto — un fallo en la lógica semántica (template
  archivado entre `candidate` y emisión, snapshot inexistente, etc.)
  podría abortar la transacción completa, incluyendo el registro
  blockchain.
- **Fallo parcial:** imposible de manejar limpiamente — si se comparte
  transacción, un fallo semántico invalida la emisión completa.
- **UX:** automática, sin revisión — contradice "nunca aprobar/aplicar a
  ciegas", ya establecido como principio explícito por C5.
- **Trazabilidad:** confunde "quién emitió" con "quién aplicó" en un único
  acto sin revisión consciente.
- **Snapshot changes entre candidate y emisión:** no aplicable — no hay
  paso de `candidate` en este flujo.
- **Si la emisión falla:** nada se aplica (todo revierte junto) —
  irrelevante en la práctica porque la interpretación no debería depender
  de la emisión.
- **Si emite pero la aplicación semántica falla:** imposible en este
  diseño — comparten transacción, por lo que un fallo semántico
  invalidaría la emisión, violando la garantía de que un evento crítico
  (con costo de gas/blockchain) nunca debe fallar por una causa
  secundaria.
- **Re-aplicación futura:** mal soportada — de todas formas necesitaría
  un mecanismo post-issuance para reaplicar tras una nueva aprobación del
  template, por lo que A no elimina la necesidad de C, solo agrega un
  camino automático cuestionable encima.
- **Defendibilidad:** baja — mezclar una decisión criptográfica (emisión)
  con una decisión editorial (interpretación semántica) en la misma
  transacción es difícil de justificar y contradice el propio código ya
  existente.

**Descartada.**

### B. Freeze mediante acción explícita inmediatamente antes de emitir

- **Estabilidad:** problemática — el draft sigue siendo 100% editable
  hasta el momento de emitir (sección 2.10). Si el emisor "aplica" la
  interpretación al draft y luego sigue editando (título, descripción,
  competencias) antes de emitir, el snapshot queda desalineado con el
  contenido final — el mismo riesgo de drift que motiva la sección 11, sin
  resolverlo mejor que C (de hecho potencialmente peor: en C la credencial
  ya es inmutable en el momento de aplicar; en B, no).
- **Atomicidad:** exige, o bien materializar la aplicación recién al
  emitir (reintroduce el problema de A), o bien persistir una fila
  asociada a una credencial todavía `draft` — contradice el criterio ya
  usado por C5 ("requiere credencial `issued`") y complica los
  invariantes (¿qué pasa si el draft se elimina o cambia de tipo antes de
  emitir?).
- **Interacción con la transacción actual:** si se materializa al emitir,
  vuelve a tocar la transacción crítica (mismo problema que A). Si se
  mantiene desacoplada, en la práctica es solo "C, pero antes en el ciclo
  de vida" — no resuelve nada adicional.
- **Riesgo blockchain:** bajo si se desacopla, pero entonces deja de ser
  una variante distinta de C, solo cambia CUÁNDO se permite el clic.
- **Fallo parcial:** si emitir falla después de haber aplicado al draft,
  queda una interpretación "aplicada" asociada a una credencial nunca
  emitida (o emitida más tarde, con contenido posiblemente distinto) —
  estado confuso que exige manejo especial.
- **UX:** peor que C — obliga a revisar la interpretación antes de que el
  contenido sea final, cuando el patrón ya validado (C5) siempre revisa
  sobre una credencial `issued`, nunca sobre un draft.
- **Trazabilidad:** peor — "aplicado antes de emitir" no tiene una fecha
  de emisión estable contra la cual anclar el análisis de drift.
- **Snapshot changes entre candidate y emisión:** ventana de drift más
  amplia y menos controlada que en C, porque el draft puede seguir
  cambiando entre "aplicar" y "emitir".
- **Re-aplicación futura:** mismos problemas que A — de todas formas haría
  falta un camino post-issuance para cuando el emisor quiera reaplicar
  tras una nueva aprobación, así que B no elimina la necesidad de C.
- **Defendibilidad:** baja — "revisamos antes de emitir" suena razonable
  en abstracto, pero como el draft sigue editable después de "aplicar", el
  timing no da ninguna garantía real de estabilidad.

**Descartada.**

### C. Freeze mediante acción explícita después de una emisión exitosa (recomendada)

- **Estabilidad:** alta — se aplica sobre contenido ya inmutable
  (`issued`, `canonicalHash` ya fijado). El único drift restante viene del
  template (sección 7) o de que el contenido final diverja del contenido
  que originó el template (sección 11) — ambos ahora explícitamente
  diseñados y comunicados al emisor, nunca aplicados en silencio.
- **Atomicidad:** la operación `apply` es atómica en su propia transacción
  pequeña (insertar `active`, marcar la anterior `superseded`),
  completamente desacoplada de `issueCredential`.
- **Interacción con la transacción actual:** **ninguna** — cero cambios a
  `credentials.service.ts#issueCredential`.
- **Riesgo blockchain:** ninguno — la emisión y el registro blockchain ya
  terminaron y son inmutables antes de que `apply` exista como opción.
- **Fallo parcial:** perfectamente manejable — *"emitido sin
  interpretación aplicada"* es, por diseño, un **estado válido e
  intencional**, no un caso límite. Si `apply` falla, la credencial sigue
  siendo válida y consultable; reintentar no tiene urgencia ni
  acoplamiento temporal.
- **UX:** coherente con el patrón ya validado por C5 (`candidate` →
  revisar → aprobar/aplicar, nunca a ciegas).
- **Trazabilidad:** la mejor de las tres — `appliedAt` tiene sentido
  propio, independiente de `issuedAt`.
- **Snapshot changes entre candidate y aplicación:** puede ocurrir (el
  template podría re-aprobarse entre que el emisor mira `candidate` y hace
  clic en `apply`) — se resuelve re-validando la identidad de aprobación
  fuente en el momento exacto de `apply`, nunca confiando en lo que
  `candidate` devolvió minutos antes (mismo principio que C5 ya aplica:
  nunca aprobar con datos potencialmente obsoletos sin re-chequear).
- **Si la emisión falla:** `apply` ni siquiera es una opción disponible
  todavía (la credencial sigue `draft`) — no hay ningún estado
  inconsistente posible.
- **Si la credencial se emite pero la aplicación semántica falla:**
  exactamente el patrón best-effort ya usado tres veces en el código
  (sección 2.15) — la emisión ya es un éxito consumado e independiente; el
  emisor ve un error claro en la acción de `apply` y puede reintentar sin
  ninguna presión de tiempo.
- **Re-aplicación futura:** nativamente soportada — es solo otra
  invocación de la misma acción, sin complejidad adicional de "cuándo".
- **Defendibilidad:** alta — argumento simple, ya validado por un patrón
  hermano ya implementado (C5): revisar y aplicar contenido semántico es
  una decisión editorial separada de emitir una credencial verificable.

**Recomendación: C, confirmada.**

### Invariante de diseño explícito

> **`Credential.status = issued` sin ninguna fila `active` en
> `CredentialReusableSemanticInterpretation` es un estado completamente
> válido, esperado, y no requiere ninguna acción correctiva.** No es un
> caso de error, no dispara ningún warning bloqueante, y puede persistir
> indefinidamente sin que nada en el sistema lo trate como incompleto. Una
> credencial `course`/`certification` puede no tener nunca una
> interpretación aplicada, y sigue siendo una credencial verificable,
> completa y válida en todo otro sentido.

---

## 5. Alternativas de arquitectura de almacenamiento (A–E) — confirmadas de v0

Sin cambios de fondo respecto a v0 en la evaluación A/B/C/D/E de *dónde*
vive el snapshot congelado (tabla nueva vs. columna vs. reutilizar
`SemanticAnalysis` vs. no persistir). Se mantiene la recomendación E
(tabla nueva + campo informativo de A), con la corrección de la sección
10: el campo de A (`Credential.sourceTemplateId`) queda **diferido**, no
descartado — la tabla nueva (núcleo de B) sigue siendo, sin cambios, la
pieza central de la solución.

Resumen de motivos de descarte de C y D (sin cambios respecto a v0):

- **C (nuevo `SemanticAnalysis` con `sourceType=approved_template_
  snapshot`):** descartada — exige inventar valores para columnas que no
  aplican a una copia revisada, y mezcla en la misma tabla/orden
  (`take:1` por `analyzedAt`) inferencia de IA cruda con revisión humana,
  el riesgo principal marcado explícitamente como motivo de descarte.
- **D (leer snapshot en vivo desde el template):** descartada — sin
  trazabilidad histórica, template puede cambiar, credencial emitida no
  queda estable, perfil puede cambiar retroactivamente sin ninguna acción
  del emisor.

---

## 6. Provenance histórica congelada

### Problema (auditado)

`IssuerCourseTemplate.approvedSemanticApprovedByUserId`,
`.approvedSemanticApprovedAt`, `.approvedSemanticAnalysisId`,
`.approvedSemanticPipelineVersion`, `.approvedSemanticTaxonomyVersion`,
`.approvedSemanticSourceCredentialId` son el **estado actual** de
aprobación del template (sección 2.4: un único slot mutable, sobrescrito
en cada re-aprobación). Consultarlos transitivamente vía `templateId`
**no** responde correctamente a preguntas históricas una vez que el
template se re-aprueba — exactamente el problema que v0 no resolvía del
todo al decir "se referencia transitivamente, sin duplicar".

### Solución: seis campos `source*` copiados en el momento de aplicar

| Campo nuevo (en la fila aplicada) | Copiado de (en el momento de `apply`) | Responde |
|---|---|---|
| `sourceSemanticAnalysisId` | `IssuerCourseTemplate.approvedSemanticAnalysisId` | ¿qué `SemanticAnalysis` originó esta interpretación? |
| `sourceCredentialId` | `IssuerCourseTemplate.approvedSemanticSourceCredentialId` | ¿qué credencial originó ese análisis? |
| `sourceApprovedByUserId` | `IssuerCourseTemplate.approvedSemanticApprovedByUserId` | ¿quién aprobó originalmente esta interpretación? |
| `sourceApprovedAt` | `IssuerCourseTemplate.approvedSemanticApprovedAt` | ¿cuándo la aprobó? |
| `sourcePipelineVersion` | `IssuerCourseTemplate.approvedSemanticPipelineVersion` | ¿con qué versión de pipeline de IA? |
| `sourceTaxonomyVersion` | `IssuerCourseTemplate.approvedSemanticTaxonomyVersion` | ¿con qué versión de taxonomía? |

Más, sin cambios de nombre respecto a v0, los dos campos de la propia
**aplicación** (distintos conceptualmente de la aprobación fuente):

| Campo | Responde |
|---|---|
| `appliedByUserId` | ¿quién aplicó esta interpretación a *esta* credencial? |
| `appliedAt` | ¿cuándo se aplicó? |

### Diferenciación explícita: APROBACIÓN vs. APLICACIÓN

- **Aprobación de la interpretación** (ya implementada, C4a.1/C5): ocurre
  sobre el **template**, la ejecuta quien revisa/edita las etiquetas, y
  puede repetirse (re-aprobación) sobreescribiendo el estado actual del
  template. Sigue viviendo exclusivamente en `IssuerCourseTemplate`, sin
  cambios.
- **Aplicación a una credencial** (C4b, este diseño): ocurre sobre una
  **credencial concreta ya `issued`**, la ejecuta quien decide usar esa
  interpretación para esa credencial, y cada aplicación es una fila
  propia e inmutable en `CredentialReusableSemanticInterpretation` — nunca
  sobrescribe nada.

No se duplica el snapshot allowlisted en sí (`approvedSnapshot`, un solo
campo `Json`), pero sí se duplican los **seis escalares** de contexto —
es la única forma de que una fila aplicada, leída meses después de una
re-aprobación del template, pueda responder correctamente "qué se aprobó,
quién, cuándo y con qué versión" sin depender del estado mutable actual
del template.

---

## 7. `sourceApprovedAt` y `approvalDriftStatus` (reemplaza `possiblyOutdated`; renombrado en C4b.0.2)

### Ambigüedad detectada (correcta, según lo señalado)

v0 usaba `sourceTemplateUpdatedAt` mezclando dos ideas: a veces
`approvedSemanticApprovedAt` (versión de la aprobación semántica), a veces
`template.updatedAt` (cualquier edición del template, incluso no
semántica — título, modalidad, plataforma, etc.).

### Definición final

- **`sourceApprovedAt`** (sección 6): copia exacta de
  `IssuerCourseTemplate.approvedSemanticApprovedAt` en el momento de
  aplicar. **Nunca** se usa `template.updatedAt` para detectar staleness
  semántica — cualquier edición no semántica del template (cambiar el
  título, la modalidad, el `externalUrl`) modificaría `updatedAt` sin que
  la interpretación aprobada haya cambiado en absoluto, generando un falso
  positivo garantizado.
- **`approvalDriftStatus`** (calculado en `candidate`/lectura, **nunca
  persistido**, siempre recalculado contra el estado actual del template).
  Este es el concepto **A** de los tres drift separados de la sección 11
  ("approval drift") — responde exclusivamente *"¿la aprobación semántica
  actual del template es la misma que ya está aplicada?"*, sin mezclar
  contenido declarativo:

  ```
  none_applied                -- no existe fila `active` para esta credencial
  up_to_date                  -- existe fila `active` y
                                  active.sourceApprovedAt == template.approvedSemanticApprovedAt (actual)
  different_approval_available -- existe fila `active` y
                                  active.sourceApprovedAt != template.approvedSemanticApprovedAt (actual)
  ```

  Comparación por **igualdad exacta** de timestamp, no por "mayor que" —
  evita asumir monotonía de reloj en escenarios no estándar (tests con
  reloj mockeado, correcciones manuales de datos), aunque en producción
  siempre será estrictamente posterior.

### Corrección de naming (C4b.0.2)

v0.1 llamaba a este tercer estado `newer_approval_available`, lo cual
afirma más de lo que la comparación realmente demuestra: la condición es
`!=` (desigualdad de timestamp), nunca `>` — nunca se compara temporalidad,
solo identidad. "Newer" implica una relación de orden que el código no
verifica. Se renombra a **`different_approval_available`**, que describe
exactamente lo que se comprobó (la aprobación actual del template es
*distinta* de la que está aplicada) sin afirmar que sea necesariamente
posterior en el tiempo. `none_applied`/`up_to_date` se mantienen sin
cambios — ya eran exactos. Este nombre se usa de forma consistente en todo
el documento, en los endpoints (sección 17), en la matriz (sección 18) y
en el Anexo.

Esto reemplaza completamente el booleano `possiblyOutdated` de v0 por un
enum de tres estados sin ambigüedad, y deja completamente separado (ver
sección 11) el concepto de "la aprobación del template cambió" (esta
sección, **approval drift**) de los otros dos conceptos de drift
("template content drift" y "destination compatibility", sección 11).

---

## 8. Garantía de base de datos: un único `active` por credencial

### Problema

`@@index([credentialId, status])` (v0) es solo un índice de performance —
no impide dos filas `active` para la misma credencial.

### Solución: partial unique index de PostgreSQL

```sql
CREATE UNIQUE INDEX credential_reusable_semantic_interpretation_one_active_per_credential
  ON "CredentialReusableSemanticInterpretation" ("credentialId")
  WHERE "status" = 'active';
```

- **Cómo se representa en `schema.prisma`:** **no se puede** — Prisma no
  tiene sintaxis declarativa para índices únicos parciales (`WHERE`) en el
  DSL del schema, a la fecha. El `schema.prisma` solo declara el índice de
  performance normal (`@@index([credentialId, status])`) y dos
  comentarios: uno explicando que la unicidad real vive en SQL manual
  dentro de la migración, y una nota para futuros mantenedores.
- **Qué requiere SQL explícito en la migration:** exactamente ese
  `CREATE UNIQUE INDEX ... WHERE`. Flujo de trabajo estándar de Prisma
  para features no soportadas nativamente: generar la migración con
  `prisma migrate dev --create-only`, editar el archivo `.sql` generado
  para agregar el índice parcial a mano, y recién entonces aplicar. Prisma
  Client sigue funcionando sin cambios — el índice actúa puramente a nivel
  de motor de base de datos, invisible para el código de aplicación salvo
  cuando se viola (excepción de constraint).
- **Cómo se testearía (dos niveles, en slices distintos — ver sección
  21):** (1) **C4b.1a, nivel constraint puro:** test de integración
  contra Postgres real (no mockeable con un ORM en memoria) — insertar
  directamente una fila `active` para una credencial, intentar insertar
  directamente una segunda fila `active` para la **misma** credencial (sin
  pasar por ningún servicio, porque `apply()` todavía no existe en este
  slice), verificar que la base rechaza con una violación de unique
  constraint. (2) **C4b.1b, nivel servicio:** invocar `apply()` dos veces
  con `Promise.all` (simulando concurrencia real) y verificar que el
  resultado final es exactamente una fila `active`, nunca dos, sin
  importar cuál "ganó" — este test requiere que el servicio de aplicación
  ya exista, por eso pertenece a C4b.1b, no a C4b.1a.
- **Comportamiento ante dos `apply` concurrentes:** ambos leen "no existe
  `active`" (posible bajo cualquier nivel de aislamiento salvo
  `Serializable` estricto), ambos intentan `INSERT ... status=active`. El
  índice parcial garantiza que la base solo acepte uno. El perdedor recibe
  el código de conflicto de Prisma (`P2002`, normalización del `23505` de
  Postgres) **dentro** de su propia transacción.
- **Isolation level:** `Serializable` — mismo nivel ya usado en el
  repositorio para operaciones sensibles de "leer estado, decidir, escribir"
  (`formative-profile.service.ts` ya usa
  `Prisma.TransactionIsolationLevel.Serializable` para el rebuild de
  perfil). Con `Serializable`, Postgres puede además abortar una de las
  dos transacciones concurrentes con un *serialization failure* (código
  `40001`) incluso antes de llegar al `INSERT` — el código de aplicación
  debe capturar ese código específico y **reintentar automáticamente una
  vez** (patrón estándar "retry on serialization failure"), no propagarlo
  como error genérico al cliente. El índice parcial queda como **red de
  seguridad final**, independiente del nivel de aislamiento, por si algún
  camino de código futuro no respetara `Serializable` correctamente.
- **Cómo se manejaría el conflicto sin filtrar información sensible:**
  capturar específicamente `Prisma.PrismaClientKnownRequestError` con
  código `P2002` (nunca inspeccionar el mensaje de texto crudo de
  Postgres/Prisma), y responder releyendo el estado actual (`active`
  existente) para aplicar la regla de idempotencia de la sección 9 como si
  la request perdedora hubiera llegado después — nunca un `500` crudo,
  nunca el mensaje interno de la base de datos propagado al cliente.

### Invariante final

```
Credential
  → 0..1 fila con status = active   (garantizado por el partial unique index)
  → 0..N filas con status = superseded
```

---

## 9. Idempotencia y re-aplicación

### Por qué `templateId` no alcanza (correcto, según lo señalado)

El mismo `templateId` puede tener múltiples aprobaciones a lo largo del
tiempo (`Template T / Approval v1 → aplicado a Credential C`, luego
`Template T / Approval v2` debe poder aplicarse también). Responder solo
por `templateId` (v0: `409` si ya existe una aplicación `active` con el
mismo `templateId`) bloquearía incorrectamente la re-aplicación de una
aprobación genuinamente nueva.

### Identidad de la aprobación fuente: `(sourceSemanticAnalysisId, sourceApprovedAt)`

Se evaluaron tres opciones:

1. **`approvedSemanticAnalysisId` solo:** insuficiente — el enunciado
   señala correctamente que el emisor podría re-aprobar el **mismo**
   `SemanticAnalysis` dos veces con revisiones de etiquetas distintas
   (`reviewedInput` es arbitrario en cada llamada a
   `approveTemplateSemanticAnalysisForIssuer`/
   `approveCredentialSemanticAnalysisForIssuer`) — el id de origen no
   cambiaría entre esas dos aprobaciones.
2. **Tupla `(sourceSemanticAnalysisId, sourceApprovedAt)` — elegida.**
   Cada aprobación completa (`issuer-course-templates.service.ts:404-416`,
   `519-531`) escribe atómicamente las seis columnas relacionadas de
   `IssuerCourseTemplate` en un único `update`, incluyendo un
   `approvedSemanticApprovedAt: new Date()` fresco — nunca hay un estado
   intermedio donde el snapshot y el timestamp queden desincronizados
   entre sí. Justificación explícita de los cuatro puntos pedidos:
   - **Precisión:** columna `DateTime` de Prisma → `timestamp(3)` en
     Postgres (milisegundos), generada server-side en cada request.
   - **Estabilidad:** una vez escrito, no cambia salvo por una nueva
     aprobación completa (que también cambia el snapshot que le
     corresponde) — nunca cambia "solo" el timestamp.
   - **Comportamiento ante dos aprobaciones consecutivas:** cada una es un
     `update` atómico de las seis columnas juntas — no hay ventana donde
     queden desincronizadas.
   - **Facilidad de comparación transaccional:** comparar dos timestamps
     es trivial y barato, sin necesidad de calcular ni comparar JSON.
   - **Riesgo residual:** colisión de timestamp bajo concurrencia
     extrema — prácticamente descartable dado que el patrón de uso real es
     un humano revisando y aprobando manualmente (nunca un loop
     automatizado sobre el mismo template).
3. **Fingerprint interno del snapshot (`sourceSnapshotFingerprint`,
   ej. SHA-256 del JSON):** evaluado y **descartado por redundancia** —
   la tupla del punto 2 ya es una identidad suficiente, barata y sin
   ambigüedad práctica; agregar un fingerprint sería complejidad
   innecesaria (YAGNI) sin resolver ningún problema real adicional. Si en
   el futuro se detectara un caso real de colisión, podría agregarse como
   columna nullable sin romper nada de lo diseñado acá. **Aclaración
   explícita:** de usarse alguna vez, sería estrictamente un fingerprint
   técnico interno de la revisión semántica — **nunca** `canonicalHash`,
   **nunca** relacionado con `canon_v1`, **nunca** un "canon_v2", **nunca**
   presentado al usuario como huella de credencial.
4. **`sourceApprovalRevisionId` opaco generado en cada aprobación:**
   evaluado — requeriría una migración **adicional** sobre
   `IssuerCourseTemplate` (agregar una columna, o peor, una tabla de
   historial de aprobaciones), lo cual está fuera de alcance de este
   slice (C4a.1/C5 no se tocan). Se descarta por costo/beneficio frente a
   la opción 2, que ya es suficiente con datos que **ya existen**.

### Regla de `apply` (idempotencia/supersede/conflicto)

Dado `(credentialId, templateId)` más la identidad resuelta
`(sourceSemanticAnalysisId, sourceApprovedAt)` = valores **actuales** del
template en el momento del request:

1. Buscar la fila `active` existente para `credentialId` (a lo sumo una,
   garantizado por la sección 8).
2. **Si existe y su `(sourceSemanticAnalysisId, sourceApprovedAt)`
   coincide exactamente** con la identidad actual → **idempotente**: no se
   escribe nada nuevo, se devuelve la fila `active` existente tal cual.
   `200 OK`, sin nuevo `appliedAt`, con un campo explícito
   `changed: false` en la respuesta.
3. **Si existe pero la identidad NO coincide** (el template fue
   re-aprobado desde la última aplicación) → **supersede**: en una única
   transacción, marcar la fila existente `superseded`
   (`supersededAt`/`supersededByUserId`) e insertar la fila `active`
   nueva con la identidad actual. `200 OK`, con
   `changed: true, supersededPreviousApplication: true`.
4. **Si no existe ninguna fila `active`** → insertar la primera fila
   `active`. `201 Created`.
5. **`409`** queda reservado exclusivamente para una condición de carrera
   genuina no resuelta automáticamente por 1-4 (dos requests concurrentes
   compitiendo, ver sección 8) — nunca por reintentar la misma
   aplicación con la misma aprobación fuente (eso es el caso 2,
   idempotente, no un conflicto).

### Cómo `candidate` comunica una aprobación distinta

`candidate` (sección 17) siempre recalcula `approvalDriftStatus`
(sección 7) comparando la fila `active` existente (si hay) contra el
estado actual del template — nunca a partir de un valor persistido ni
cacheado.

---

## 10. `Credential.sourceTemplateId` — decisión final: diferido

### El problema de significado (correcto, según lo señalado)

El flujo C3c actual es `createDraft` (endpoint genérico) → `PATCH`
best-effort (puede fallar sin revertir el draft). Escribir
`sourceTemplateId` en cualquiera de esos dos pasos, sin cambiarlos,
produce una ambigüedad real:

- Si se escribe durante `createDraft`: solo significaría *"el usuario
  seleccionó este template"* (el `PATCH` de aplicación de campos todavía
  no corrió) — el significado A, explícitamente prohibido como único
  significado por el enunciado.
- Si se escribe durante el `PATCH` best-effort actual: ese es un endpoint
  **genérico** de edición de draft (`PATCH /credentials/:id/draft`),
  reutilizado para *cualquier* edición posterior del usuario, no solo la
  aplicación inicial. Permitir que ese mismo PATCH también pueda escribir
  `sourceTemplateId` abriría la puerta a que se envíe en un PATCH
  posterior no relacionado con "aplicar template", rompiendo la
  invariante write-once/significado exacto que se busca.

### Opciones evaluadas (A–E del enunciado)

| Opción | Descripción | Veredicto |
|---|---|---|
| A. Enviarlo durante `createDraft` | Fácil, pero solo puede significar "seleccionado", nunca "aplicado con éxito" | Rechazada — significado incorrecto |
| B. Escribirlo solo tras aplicar con éxito (desde el `PATCH` best-effort actual) | Requiere que ese endpoint genérico acepte y valide un campo especial, riesgo de reuso indebido en PATCHes posteriores no relacionados | Rechazada — compromete la invariante write-once/significado exacto |
| C. Command backend específico (endpoint dedicado que solo escribe el campo) | Mejor semántica, pero no garantiza por sí solo que los datos del template realmente se hayan aplicado — dos pasos, dos puntos de fallo | Insuficiente sola |
| D. Backend crea/aplica el template de forma atómica (endpoint dedicado que aplica campos **y** escribe el campo en una única operación) | Única opción que garantiza el significado exacto por construcción | La correcta **si** se implementa, pero requiere reemplazar el `PATCH` best-effort actual del frontend — scope creep real para C4b.1 |
| E. No agregar `sourceTemplateId` en C4b.1; diferir a un slice futuro | Cero scope creep sobre C3c ya implementado; C4b.1 no depende de esto en absoluto | **Elegida** |

### Decisión final

**Se difiere `Credential.sourceTemplateId` fuera de C4b.1.** C4b.1 no lo
necesita: el emisor selecciona manualmente el `templateId` al invocar
`candidate`/`apply` sobre la credencial ya `issued` (sin ninguna
preselección automática) — funcionalmente completo sin esta provenance de
creación.

Si en el futuro se decide implementarlo (posible C4b.2-provenance,
separado de C4b.2 tal como se lo entendía en v0 — ver plan revisado,
sección 21), debe hacerse mediante la **Opción D**: un endpoint backend
dedicado que aplique los campos del template al draft **y** escriba
`sourceTemplateId` en una única operación server-side atómica,
reemplazando el `PATCH` best-effort actual del frontend — nunca los dos
pasos desacoplados de hoy.

### Si se implementara en el futuro (D): requisitos ya definidos

- **Invariante buscada:** `sourceTemplateId != null` debe significar
  *siempre y únicamente* "este template fue aplicado exitosamente como
  origen del draft" — nunca "el usuario lo seleccionó".
- **Validar issuer:** el template debe pertenecer al mismo `issuerId` que
  el draft — nunca cross-issuer.
- **Validar `credentialType`:** el `credentialType` del template debe
  coincidir con el tipo del draft — nunca aplicar un template
  `certification` a un draft `course` o viceversa.
- **Write-once:** una vez establecido, nunca se reescribe (ni siquiera si
  el draft se sigue editando después) — describe el origen, no el estado
  actual.
- **Lifecycle draft/issued:** solo escribible mientras la credencial es
  `draft` (en el momento de creación); permanece de solo lectura para
  siempre después, incluyendo tras emitir.
- **FK vs. referencia informativa:** **referencia informativa, sin FK
  dura** — mismo patrón ya usado por `createdFromCredentialId`/
  `approvedSemanticSourceCredentialId` en `IssuerCourseTemplate`.
  Justificación: acoplar `Credential` (tabla central, con reglas de
  integridad propias de emisión/canon/hash) al ciclo de vida de
  `IssuerCourseTemplate` mediante una FK dura introduciría una dependencia
  de borrado/arquitectura que no se justifica para un campo puramente
  informativo — el mismo criterio ya aplicado consistentemente en el resto
  del dominio para referencias de este tipo.
- **Nunca usable desde el frontend para asociar cross-issuer/tipo
  incompatible:** las validaciones de issuer/tipo viven exclusivamente en
  el backend (el command atómico de la Opción D), nunca confiando en un
  valor enviado libremente desde el cliente.

### Impacto en la migración de C4b.1

Con esta decisión, la migración de C4b.1 se reduce a **una única tabla
nueva** (`CredentialReusableSemanticInterpretation`) — **sin ningún
cambio a `Credential`**.

---

## 11. Drift de contenido — corregido en C4b.0.2: tres conceptos separados

### El error de v0.1 (confirmado y corregido)

v0.1 comparaba la credencial destino contra el **estado declarativo
ACTUAL de `IssuerCourseTemplate`**. Eso no responde la pregunta que
importa: *"¿la interpretación semántica aprobada que estoy por aplicar
sigue siendo compatible con el contenido de esta credencial?"* El template
actual es mutable **independientemente** de su aprobación semántica — se
puede editar título/descripción/competencias sin volver a aprobar nada.

**Escenario que v0.1 no detectaba (confirmado como el caso a corregir):**
credencial origen A = "Introducción a UX", se aprueba una interpretación
sobre esos datos; luego se edita el propio `IssuerCourseTemplate` a
"Marketing digital" **sin re-aprobar**; se crea y emite una credencial
destino B = "Marketing digital". Con la comparación de v0.1, B coincide
con el template *actual* → `unchanged` — pero el snapshot aprobado sigue
describiendo UX. Aplicarlo sería semánticamente incorrecto, y v0.1 no lo
hubiera bloqueado.

### Confirmación de la fuente de verdad correcta (auditoría acotada)

`IssuerCourseTemplate.approvedSemanticSourceCredentialId` se escribe en
`issuer-course-templates.service.ts`:
- `approveTemplateSemanticAnalysisForIssuer` (línea ~413):
  `approvedSemanticSourceCredentialId: semanticAnalysis.credentialId`,
  donde `semanticAnalysis` es exactamente el `SemanticAnalysis` que se
  está aprobando (resuelto por `resolveApprovableSemanticAnalysis`).
- `approveCredentialSemanticAnalysisForIssuer` (línea ~528):
  `approvedSemanticSourceCredentialId: credential.id`, donde `credential`
  es la credencial cuyo `SemanticAnalysis` se está aprobando (resuelta por
  `resolveCredentialSemanticAnalysis`).

**Confirmado por código, no solo por comentario:** en ambos caminos de
aprobación (C4a.1 vía template, C5 vía credencial), `approvedSemantic
SourceCredentialId` es, sin excepción, **la credencial cuyo
`SemanticAnalysis` originó el snapshot aprobado** — nunca el template en
sí, nunca una credencial arbitraria. `CredentialReusableSemanticInterpretation.
sourceCredentialId` (sección 6) hereda exactamente ese mismo significado,
congelado en el momento de aplicar. Esta es, por lo tanto, la **credencial
origen** ("source Credential") correcta para cualquier comparación de
compatibilidad semántica.

**La referencia primaria pasa a ser:**

```
Credential destino  vs.  Credential origen de la interpretación aprobada
```

**Nunca:**

```
Credential destino  vs.  IssuerCourseTemplate actual
```

### Tres conceptos de drift, deliberadamente separados

#### A. Approval drift — "¿la aprobación actual es la misma que está aplicada?"

Ya diseñado en la sección 7 como `approvalDriftStatus`
(`none_applied`/`up_to_date`/`different_approval_available`). Compara
identidad de aprobación: `(active.sourceSemanticAnalysisId,
active.sourceApprovedAt)` vs. `(template.approvedSemanticAnalysisId,
template.approvedSemanticApprovedAt)` actuales. **Nunca** mezcla
contenido declarativo — es puramente sobre identidad de la aprobación.

#### B. Template content drift — "¿el template actual sigue describiendo lo mismo que la fuente aprobada?"

Compara **el contenido declarativo ACTUAL del template** (sus propias
columnas `title`/`description`/`competencies`/`learningOutcomes`/`skills`)
contra **el contenido declarativo de la credencial origen** (la que
originó el `SemanticAnalysis` aprobado — nunca la credencial destino).

Es una **advertencia editorial**: *"el contenido reutilizable cambió
desde que se aprobó esta interpretación"*. Puramente informativo:

- **Nunca** altera retroactivamente ninguna fila ya aplicada.
- **Nunca** muta el `approvedSnapshot` congelado.
- **Nunca**, por sí sola, bloquea ni condiciona `apply` — es contexto para
  que el emisor entienda por qué el template pudo desviarse de su propia
  base semántica, independientemente de cualquier credencial destino
  concreta.

Resultado expuesto:

```
templateContentStatus: 'matches_approved_source' | 'differs_from_approved_source' | 'unknown'
```

#### C. Destination compatibility — "¿la credencial destino es compatible con la fuente real de la interpretación?" (el control que importa antes de `apply`)

Compara **la credencial destino** (la credencial `issued` a la que se
quiere aplicar la interpretación) contra **la credencial origen** de la
interpretación aprobada — **nunca** contra el template actual. Este es el
control que efectivamente previene el escenario de la introducción: aunque
el template actual coincida con la credencial destino, si el template
actual ya no coincide con su propia fuente aprobada (drift B), y la
credencial destino tampoco coincide con esa fuente, `destinationCompatibility`
lo detecta correctamente comparando directamente contra la fuente — nunca
transitivamente a través del template.

**Regla explícita (corrige el punto exacto que v0.1 permitía por error):**
una coincidencia `Credential destino == IssuerCourseTemplate actual`
**nunca** puede transformarse en "compatible" cuando
`IssuerCourseTemplate actual != Credential origen`. El template actual
**no** es autoridad transitiva — la comparación siempre se hace
directamente contra la credencial origen, sin pasar por el template como
intermediario.

Resultado expuesto:

```
destinationCompatibility: 'compatible' | 'modified' | 'unknown'
changedFields: Array<'title' | 'description' | 'competencies' | 'learningOutcomes' | 'skills' | 'hours'>
```

### Qué se compara (campos declarativos, por tipo — sin cambios de alcance respecto a v0.1, solo cambia CONTRA QUÉ se compara)

**`course`:** `achievementName`/título, `description`, `competencies`,
`learningOutcomes` ("contenido e información adicional"). `hours` se
incluye como señal blanda (una diferencia grande puede indicar alcance
distinto) pero **no descalifica por sí sola**. `modality` se excluye — no
afecta el contenido semántico interpretado.

**`certification`:** `achievementName`/título, `description`, `skills`,
`competencies`. `certificationCode`, `providerName`, `level` se excluyen
por defecto — cambiar el código o el proveedor no cambia qué se enseñó o
evaluó.

`platformName`/`externalUrl` quedan explícitamente **excluidos** — nada en
el código auditado (`issuer-course-templates.helpers.ts`,
`formative-profile.service.ts`) los trata como parte material de la
interpretación semántica (el propio comentario de diseño de C4a.1 en
`issuer-course-templates.helpers.ts:134-139` documenta que
`competencies`/`learningOutcomes` son los únicos campos declarativos que
alimentan el snapshot aprobado además del `SemanticAnalysis` mismo).

**Extracción de campos:** tanto para B (template actual) como para C
(credencial destino), el lado "credencial origen" de la comparación se
lee con las **mismas funciones puras ya existentes**
`readSubjectText`/`readSubjectStringArray`
(`issuer-course-templates.helpers.ts:23-73`, ya usadas hoy para construir
un template *desde* una credencial) — nunca una extracción nueva
reinventada. El lado template (para B) usa directamente las columnas
escalares de `IssuerCourseTemplate`. El lado credencial destino (para C)
usa `title`/`description` (columnas top-level de `Credential`) +
`credentialSubject.competencies`/`.learning_outcomes`/`.skills`.

### Normalización (sin cambios respecto a v0.1)

Texto (`título`, `description`): trim + colapso de espacios + comparación
case-insensitive (mismo patrón ya usado por
`normalizeTitleForComparison`). Arrays (`competencies`,
`learningOutcomes`, `skills`): comparación de **conjuntos** normalizados
(mismo patrón de deduplicación ya usado por `readSubjectStringArray`),
order-independiente. Regla binaria: cualquier diferencia después de
normalizar → `modified`/`differs_from_approved_source`; sin diferencias →
`compatible`/`matches_approved_source`. Sin tolerancia difusa/porcentual,
sin embeddings, sin fuzzy matching, sin IA, sin ningún hash nuevo.

- `changedFields` (solo para C, `destinationCompatibility`) lista
  únicamente **nombres de campo** allowlisted — nunca el contenido real
  (ni el valor viejo ni el nuevo).
- `unknown`/`differs_from_approved_source` con causa "fuente no
  disponible" se trata en la sección 11.1 (nueva).

### Regla de `apply` ante `compatible` / `modified` / `unknown` (sección corregida)

`candidate` y `apply` **siempre** recalculan `destinationCompatibility` en
vivo, nunca confiando en un resultado previo del frontend (mismo principio
ya aplicado a `approvalDriftStatus`, sección 9).

- **`compatible`** → puede aplicarse normalmente, sin ninguna confirmación
  adicional.
- **`modified`** → **nunca se aplica en silencio**. `apply` acepta un
  flag explícito opcional `acknowledgeDestinationDrift: boolean`. Si
  `destinationCompatibility === 'modified'` y el flag está ausente o es
  `false` → `422`, con mensaje claro dirigiendo a revisar `candidate`
  primero. Si el flag es `true` → se permite continuar. Justificación
  (sin cambios respecto a v0.1): (1) la comparación de texto es una
  heurística, puede haber falsos positivos de wording; (2) el emisor ya es
  un actor de confianza, filtrado por membership/rol; (3) un rechazo duro
  dejaría al emisor sin salida razonable; (4) mismo criterio ya validado
  por C5: nunca a ciegas, pero siempre permitir avanzar tras ver la
  advertencia explícita.
- **`unknown`** → **se bloquea (Opción A), no se ofrece un
  acknowledgment reforzado.** Elegida sobre la alternativa de "confirmación
  reforzada" porque, a diferencia de `modified` (donde SÍ existe
  información concreta para que el emisor tome una decisión informada:
  "sabemos que cambió esto"), `unknown` significa que **no hay datos
  suficientes para comparar en absoluto** — pedirle al emisor que
  "confirme" algo que ni el propio sistema pudo determinar sería solo
  teatro de seguridad, dando una falsa sensación de decisión informada
  donde no la hay. Bloquear con un error explícito y explicable ("no
  pudimos verificar la compatibilidad semántica; contactá soporte o
  revisá la credencial origen") prioriza seguridad semántica y
  explicabilidad sobre conveniencia, tal como se pide explícitamente.
  Ver el caso concreto que produce `unknown` en la sección 11.1.

**Explícitamente prohibido, para los tres conceptos (A/B/C) por igual:**
`canonicalHash`, `canon_v1`, cualquier `canon_v2`, o cualquier variante de
hash relacionado con integridad criptográfica de la credencial — todas
las comparaciones de drift son comparaciones de datos declarativos en
memoria, sin ninguna relación con el sistema de canonicalización/hash/
blockchain.

### 11.1 Comportamiento si la credencial origen no está disponible

`sourceCredentialId` es una referencia informativa, sin FK dura (sección
6) — puede apuntar a una credencial que, por algún motivo, ya no puede
recuperarse en el momento de calcular B o C.

- **Nunca se inventa compatibilidad.** Si la credencial origen no se
  puede leer (no existe, o pertenece a otro `issuerId` — se revalida el
  scoping de issuer en cada lectura, nunca se asume del dato congelado),
  `candidate` devuelve explícitamente
  `destinationCompatibility: 'unknown'` (y análogamente
  `templateContentStatus: 'unknown'`), nunca `'compatible'` ni
  `'matches_approved_source'` por omisión.
- **`apply` se bloquea** en este caso — mismo criterio que la regla
  general de `unknown` de esta sección (11), sin una variante especial:
  no hay ninguna confirmación que el emisor pueda dar de buena fe sobre
  contenido que nadie, ni el sistema, puede ver.
- **Privacidad:** `sourceCredentialId` es un id interno — nunca se expone
  al frontend, ni siquiera issuer-facing, en ningún DTO (la comparación
  ocurre íntegramente server-side; el resultado expuesto es únicamente el
  enum `destinationCompatibility`/`templateContentStatus` +
  `changedFields`, nunca el id de la credencial origen ni su contenido
  crudo). Esto es consistente con la lista de "nunca exponer" ya
  establecida en la sección 13.

---

## 12. Modelo de provenance del perfil (corregido)

### El bug de diseño detectado en v0 (correcto, según lo señalado)

Un `provenance` escalar único en `ProfileArea`/`ProfileSkill`/
`ProfileConcept` es incorrecto porque los acumuladores actuales
(`formative-profile.service.ts:682-838`) **fusionan** la misma etiqueta
proveniente de **múltiples credenciales**. Ejemplo obligatorio del
enunciado: `Credential A → "Gestión de proyectos" → issuer_reviewed`,
`Credential B → "Gestión de proyectos" → ai_inferred` — ambas terminan en
un único `ProfileSkill` agregado. Un escalar `provenance: issuer_reviewed`
mentiría sobre la contribución de B.

### Solución: proveniencia por contribución, no por etiqueta agregada

Se extiende `ProfileEvidence` (interfaz ya compartida por área/skill/
concept) con una lista de **fuentes por credencial contribuyente**, en vez
de listas planas de ids sin contexto:

```ts
interface ProfileEvidenceSource {
  credentialId: string;
  provenance: 'issuer_reviewed' | 'ai_inferred';
  // exactamente uno de los dos campos siguientes, según `provenance`:
  reusableInterpretationId?: string; // id de la fila CredentialReusableSemanticInterpretation
  semanticAnalysisId?: string;       // id del SemanticAnalysis propio de esta credencial
}

interface ProfileEvidence {
  sources: ProfileEvidenceSource[];  // una entrada por credencial contribuyente
  evidenceCount: number;             // = sources.length (compatible con el conteo actual)
  credentialIds: string[];           // = sources.map(credentialId).sort() -- se mantiene por compatibilidad de lectura
  semanticAnalysisIds: string[];     // SOLO ids de SemanticAnalysis propios (provenance='ai_inferred') -- ver corrección abajo
}
```

Resumen agregado liviano en cada `ProfileArea`/`ProfileSkill`/
`ProfileConcept` (evita que la UI tenga que iterar `sources[]` para lo
más común, sin inflar el DTO público con el detalle completo):

```ts
provenanceSummary: {
  issuerReviewedCount: number; // cuántas credenciales contribuyentes son issuer_reviewed
  aiInferredCount: number;     // cuántas son ai_inferred
}
```

Esto resuelve el ejemplo obligatorio sin ambigüedad: `sources` mantiene
`[{credentialId: A, provenance: 'issuer_reviewed', ...}, {credentialId: B,
provenance: 'ai_inferred', ...}]`, y `provenanceSummary = {
issuerReviewedCount: 1, aiInferredCount: 1 }` — nunca se colapsa a un
escalar engañoso. **No infla innecesariamente el DTO público**: `sources`
completo queda disponible para el `profileJson` interno (issuer/debug), y
el contrato mínimo pensado para UI de holder es únicamente
`provenanceSummary` (dos enteros).

### IDs guardados cuando la fuente es una interpretación aplicada

`reusableInterpretationId` = el `id` propio de la fila
`CredentialReusableSemanticInterpretation` — **nunca**
`sourceSemanticAnalysisId` (que pertenece conceptualmente a la credencial
**origen del template**, no a la credencial cuyo perfil se está
construyendo — mezclar ambos violaría exactamente la regla pedida: *"NO
poner el `SemanticAnalysis` de la credencial origen del template dentro
de `semanticAnalysisIds` como si fuera el `SemanticAnalysis` propio de la
credencial destino"*).

### `generatedFrom` (top-level del perfil)

```ts
generatedFrom: {
  credentialIds: string[];
  semanticAnalysisIds: string[];               // sin cambios de significado -- solo ai_inferred
  reusableSemanticInterpretationIds: string[];  // NUEVO -- ids de filas active que participaron
}
```

Aditivo — no rompe el shape actual (`credentialIds`/`semanticAnalysisIds`
se mantienen, solo se agrega una clave nueva).

### Redefiniciones de contadores (retrocompatibles)

- **`analyzedCredentialsCount`:** se redefine (mismo nombre, definición
  ampliada de forma retrocompatible — hoy es subconjunto exacto porque
  `issuer_reviewed` todavía no existe) como *cantidad de credenciales
  `issued` con al menos una fuente semántica (`issuer_reviewed` **o**
  `ai_inferred`)*, no exclusivamente `SemanticAnalysis` bruto. Evita que
  una credencial con una interpretación revisada de alta calidad se cuente
  incorrectamente como "no analizada".
- **`credentialsWithoutSemanticCoverage`:** simétricamente, *credenciales
  `issued` sin ninguna fuente semántica (ni revisada ni IA cruda)*.
- **`credentialsWithReviewedInterpretation`** (nuevo, aditivo): cuenta
  credenciales `issued` cuya fuente elegida fue `issuer_reviewed`. No
  reemplaza ningún contador existente.

### Confianza global, warnings y quality flags

- **Confidence:** `approved_template_semantic_snapshot_v2` ya conserva un
  campo `confidence` heredado del `SemanticAnalysis` origen (sección 2.5)
  — se sigue incluyendo en el promedio global leyendo
  `approvedSnapshot.confidence` en vez de `semanticAnalysis.confidence`
  cuando la fuente elegida es `issuer_reviewed`, sin inventar nada nuevo.
  Se documenta explícitamente que ese valor describe la confianza del
  análisis de IA **original** (antes de revisión humana) — la UI nunca
  debe presentarlo como si fuera "confianza en la revisión del emisor".
- **Warnings/qualityFlags:** mismo criterio — `approvedSnapshot.warnings`/
  `.qualityFlags` (ya existen en el shape v2) se traducen con las mismas
  funciones ya existentes (`humanSemanticNotes`), sin inventar nada.

### Lo que permanece completamente sin cambios

- `Credential.hours` / `totalOfficialHours`: 100% declarado, separado, sin
  ninguna interacción con esta lógica.
- `emittedSkills`/`emittedCompetencies`/`emittedLearningOutcomes`: siguen
  viniendo únicamente de `credentialSubject`, nunca de la interpretación
  aplicada (que además, por diseño, nunca contiene `competencies`/
  `learningOutcomes` — sección 2.5).

### Regla principal reafirmada

**Por credencial:** interpretación aplicada `issuer_reviewed` > propio
`SemanticAnalysis` `ai_inferred` > ninguna fuente inferida (solo datos
declarados). **Entre credenciales**, para una misma etiqueta agregada, se
preservan **todas** las contribuciones con su proveniencia individual en
`sources[]` — la fusión de etiquetas iguales entre credenciales distintas
ya funciona hoy (misma normalización de claves) y no cambia; lo que cambia
es que ahora cada contribución individual queda identificable.

---

## 13. Privacidad y read models

### Regla general (ya vigente, confirmada como aplicable acá)

Todo el dominio ya sigue un patrón consistente de **allowlist explícito
campo-a-campo** en cada mapper de lectura — nunca `spread`/clonado ciego
de una fila de Prisma o de un `Json` interno. Ejemplos ya auditados:
`buildApprovedSemanticSnapshotSummary`, `toApprovalCandidate`,
`mapHolderCurrentProfileResponse` (`holder-current-profile.mapper.ts` —
cada campo del DTO holder se construye con una función extractora
dedicada, `labelFrom`/`number`/`confidenceNumber`, nunca un spread). El
diseño de C4b/C5b debe seguir exactamente ese patrón, sin excepciones.

### Confirmación explícita por actor

- **Issuer-facing** (`candidate`/`apply`/lectura de la sección 17): puede
  recibir un resumen allowlisted — incluye nombres/labels resueltos
  (nunca ids crudos) de quién aprobó/aplicó, fechas, conteos,
  `approvalDriftStatus`, `templateContentStatus`,
  `destinationCompatibility`/`changedFields`. Nunca `approvedSnapshot`
  completo sin sanear, nunca ids crudos de usuario, nunca
  `sourceCredentialId` (sección 11.1).
- **Holder (wallet):** únicamente `provenanceSummary` (dos enteros) por
  área/skill/concept — nunca `sources[]` completo, nunca
  `reusableInterpretationId`/`semanticAnalysisId`, nunca metadata de quién
  aprobó/aplicó.
- **Perfil público compartido:** **nada** de esto — ni siquiera
  `provenanceSummary`. Mismo alcance ya establecido por V2/V3 (sin email,
  sin evidencias crudas, sin distinciones técnicas de fuente).
- **Verificador público (`/verify`):** sin cambios, no aplica.

### Riesgo concreto detectado en esta auditoría (nuevo hallazgo de v0.1)

`services/api/src/profile-sharing/profile-sharing.service.ts:108-146`
(`getPublicProfileShareForToken` o equivalente) **reutiliza directamente**
`mapHolderCurrentProfileResponse(...)` y luego hace:

```ts
areas: mapped.areas.slice(0, 6),
skills: mapped.skills.slice(0, 12),
concepts: mapped.concepts.slice(0, 20),
```

`.slice()` trunca el **array**, pero **no reconstruye cada elemento** —
si en el futuro (C5b.2) se agrega `provenanceSummary` a los objetos que
produce `mapHolderCurrentProfileResponse` para `areas`/`skills` (sección
12), esos mismos objetos, con `provenanceSummary` incluido, **pasarían
automáticamente al perfil público** a través de este `.slice()`, sin que
nadie lo haya decidido explícitamente. Hoy esto no es un problema porque
`mapped.areas`/`mapped.skills` solo tienen `{label, estimatedHours}`/
`{label, confidence}` (ya mínimos) — pero es una bomba de tiempo concreta
para el momento en que se implemente C5b.

**Corrección requerida, documentada como tarea explícita de C5b.2 (sección
21), a aplicar ANTES o en el mismo cambio que agregue `provenanceSummary`
al perfil holder:** reemplazar el pass-through por un remapeo explícito
campo-a-campo en `profile-sharing.service.ts`, por ejemplo:

```ts
areas: mapped.areas.slice(0, 6).map(({ label, estimatedHours }) => ({ label, estimatedHours })),
skills: mapped.skills.slice(0, 12).map(({ label, confidence }) => ({ label, confidence })),
```

Esto es exactamente el mismo patrón de allowlist explícito ya vigente en
el resto del dominio, aplicado también en el borde entre el mapper holder
y el mapper público — hoy son el mismo objeto por accidente de
implementación, no por diseño, y no deberían seguir siéndolo una vez que
el mapper holder cargue campos que el perfil público no debe exponer.

### Lista de "nunca exponer" (confirmada)

`approvedSnapshot` crudo, `sourceApprovedByUserId`/`appliedByUserId`
internos (ids, no nombres), ids de `SemanticAnalysis`, ids de template,
`pipelineVersion`/`taxonomyVersion`, `review note` interno — salvo, para
los datos de identidad, un endpoint issuer-facing con razón explícita
(sección 17) que resuelva nombre/label en vez de exponer el id crudo.

---

## 14. Canon/hash — confirmación explícita (sin cambios)

- La interpretación aprobada/aplicada **no** entra en `canon_v1` ni en
  ningún cálculo de `canonicalHash`.
- Aplicar (o no aplicar) una interpretación **no** modifica
  `Credential.canonicalHash` ni dispara un nuevo `BlockchainRecord`.
- Una credencial sigue siendo verificable en `/verify` exactamente igual
  con o sin interpretación aplicada.
- La comparación de drift (sección 11) es una comparación de datos
  declarativos en memoria — nunca usa ni genera ningún hash relacionado
  con integridad criptográfica.
- La identidad de aprobación fuente (sección 9) es una tupla de datos ya
  persistidos (`id` + `timestamp`) — nunca un hash nuevo, nunca
  relacionado con `canon_v1`/`canon_v2`.

---

## 15. Lifecycle de rebuild de `FormativeProfile` (objetivo para C5b, no implementado ahora)

### Precedente ya implementado (auditado en 2.15)

`AutomaticProfileRebuildService.rebuildAfterAutomaticAnalysis`
(`automatic-profile-rebuild.service.ts:37-50`) ya resuelve exactamente
este problema para el caso de análisis automático post-emisión (C2b.4):
recibe `{ credentialId, holderUserId, analysisRunId? }`, llama
`FormativeProfileService.rebuildForUser(holderUserId)` dentro de un
`try/catch` que **nunca** relanza, devuelve `{status: 'rebuilt'} |
{status: 'failed', errorCode: 'formative_profile_rebuild_failed'}`, y
loguea el fallo de forma segura (sin contenido, sin secretos, solo ids).

### Opciones evaluadas

- **A. Rebuild síncrono después del commit — recomendada.** Llamar al
  servicio **ya existente**, sin modificarlo, inmediatamente después de
  que la transacción de `apply` (sección 9) confirme — dentro del mismo
  request HTTP, pero en una llamada separada (nunca anidada en la misma
  transacción de base de datos que persiste la interpretación aplicada).
- **B. Best-effort asíncrono (fire-and-forget):** reduce latencia
  percibida, pero complica testing/observabilidad (difícil de asegurar
  determinísticamente en tests que el rebuild ocurrió) y exige manejo
  cuidadoso de rechazos de promesas no gestionados. No hay evidencia en
  el código actual de que el dominio use este patrón en ningún lugar.
- **C. Queue/mecanismo eventual:** requeriría infraestructura nueva (cola
  de trabajos) que **no existe hoy** en el repositorio (el propio patrón
  C2b.4 ya resuelve el mismo problema sin cola, de forma síncrona
  best-effort). Se descarta explícitamente por la instrucción de no
  agregar infraestructura nueva si no es necesaria — y no lo es, dado que
  A ya tiene un precedente funcional y probado.

**Recomendación: A**, reutilizando **sin modificar**
`AutomaticProfileRebuildService.rebuildAfterAutomaticAnalysis` tal cual
existe hoy (la interfaz ya es genérica: `analysisRunId` es opcional, se
omite en la llamada desde `apply`).

### Garantía principal

> La transacción que persiste la interpretación aplicada (sección 9) **no
> se revierte** porque falle posteriormente el rebuild del perfil. Si
> `apply` ✅ y el rebuild del perfil ❌, la interpretación aplicada sigue
> siendo válida y persistida; el fallo del rebuild queda observable
> (mismo log seguro ya usado por C2b.4) y reintentable — el emisor puede
> simplemente volver a intentar `apply` (idempotente, sección 9, no crea
> una fila nueva) para disparar un nuevo intento de rebuild, o el holder
> puede usar `POST /me/profile/rebuild` (ya existente) directamente.

### Reglas de reapply respecto al perfil

- Supersede una interpretación anterior → insertar la nueva `active` →
  reconstruir el perfil usando **exclusivamente** la nueva fila `active`
  (el `rebuildForUser` ya recalcula todo desde cero leyendo el estado
  actual de la base — nunca mezcla la fila `superseded` vieja con la
  `active` nueva, por construcción, ya que solo hay una `active` por
  credencial en el momento del rebuild).
- El holder **nunca** necesita ejecutar nada manualmente para que esto
  ocurra — el rebuild se dispara automáticamente como parte del flujo de
  `apply` del emisor, exactamente como hoy el análisis automático
  post-emisión ya dispara su propio rebuild sin que el holder haga nada.

Este comportamiento queda **documentado como requisito objetivo de C5b**
en este documento — no se implementa en C4b.0.1 ni en C4b.1 (que
explícitamente no dispara ningún rebuild, ver sección 17), pero el diseño
de C4b.1 debe dejar el `apply` estructurado de forma que enchufar esta
llamada en C5b sea un cambio pequeño y aislado (una línea adicional
después del commit de la transacción, con su propio try/catch).

---

## 16. Modelo de datos final (no implementado, sin migración generada)

### 16.1 `CredentialReusableSemanticInterpretation` (tabla nueva, única)

```prisma
enum CredentialSemanticInterpretationStatus {
  active
  superseded
}

enum CredentialSemanticInterpretationSource {
  issuer_reviewed_template_snapshot
}

// La unicidad "a lo sumo una fila active por credencial" NO se expresa acá
// -- ver migration.sql manual: CREATE UNIQUE INDEX ... WHERE status='active'
// (Prisma no soporta partial unique indexes en el DSL del schema).
model CredentialReusableSemanticInterpretation {
  id     String @id @default(uuid())

  credentialId String
  templateId   String

  // --- Provenance histórica de la APROBACIÓN fuente (congelada, nunca se
  // relee del estado actual de IssuerCourseTemplate una vez escrita) ---
  sourceSemanticAnalysisId String   // referencia informativa, sin FK
  sourceCredentialId       String   // referencia informativa, sin FK
  sourceApprovedByUserId   String   // referencia informativa, sin FK
  sourceApprovedAt         DateTime
  sourcePipelineVersion    String
  sourceTaxonomyVersion    String

  // --- Snapshot congelado ---
  approvedSnapshot Json
  snapshotVersion  String

  provenance CredentialSemanticInterpretationSource @default(issuer_reviewed_template_snapshot)
  status     CredentialSemanticInterpretationStatus @default(active)

  // --- Provenance de la APLICACIÓN a esta credencial (distinta de la
  // aprobación fuente) ---
  appliedByUserId String
  appliedAt       DateTime @default(now())

  supersededAt       DateTime?
  supersededByUserId String?

  credential Credential           @relation(fields: [credentialId], references: [id], onDelete: Cascade)
  template   IssuerCourseTemplate @relation(fields: [templateId], references: [id], onDelete: Restrict)
  appliedBy  User                 @relation("CredentialSemanticInterpretationApplier", fields: [appliedByUserId], references: [id], onDelete: Restrict)

  @@index([credentialId])
  @@index([credentialId, status])
  @@index([templateId])
  @@index([appliedAt])
}
```

### 16.2 Decisiones FK vs. referencia informativa (justificadas)

| Campo | FK / informativa | Justificación |
|---|---|---|
| `credentialId` | FK, `onDelete: Cascade` | Mismo patrón que `SemanticAnalysis`/`DocumentEvidence`/`TextEvidence` — historial de interpretaciones deja de tener sentido si la credencial deja de existir. |
| `templateId` | FK, `onDelete: Restrict` | Mismo patrón que referencias a dimensiones (`Issuer`, `AcademicCourse`) — nunca se permite borrar un template con aplicaciones vinculadas; hoy tampoco existe endpoint de borrado de templates (solo archivado por `status`). |
| `appliedByUserId` | FK, `onDelete: Restrict` | Actor obligatorio de la fila (siempre una persona real, nunca `system` — sección 4). Mismo patrón que `DocumentEvidence.uploadedBy`/`TextEvidence.submittedBy` (actor obligatorio → `Restrict`). |
| `supersededByUserId` | Sin FK, nullable | Opcional por naturaleza (solo aplica si la fila fue superseded); se mantiene informativo para no forzar una relación obligatoria en un campo que la mayoría de las filas nunca completan. |
| `sourceSemanticAnalysisId`, `sourceCredentialId`, `sourceApprovedByUserId` | Sin FK, informativas | Mismo patrón ya usado por `IssuerCourseTemplate.approvedSemanticSourceCredentialId`/`.approvedSemanticApprovedByUserId` (comentario explícito ya existente en el schema: "referencias informativas sin FK"). Referencian entidades que pueden pertenecer a un contexto distinto (la credencial/usuario que originó el template, no necesariamente relacionados con integridad referencial fuerte respecto a esta fila). |

### 16.3 Invariantes

- `Credential → 0..1 active, 0..N superseded` (garantizado por el partial
  unique index, sección 8).
- Una fila nunca se actualiza salvo la transición `active → superseded`
  (solo escribe `status`/`supersededAt`/`supersededByUserId`) — el resto
  de los campos son inmutables desde su inserción.
- `appliedByUserId` nunca es un usuario de sistema — siempre una persona
  real autenticada (consistente con la sección 4: `apply` es siempre una
  acción manual).
- Re-aplicar con la misma identidad de aprobación fuente
  (`sourceSemanticAnalysisId`, `sourceApprovedAt`) es idempotente — nunca
  crea una fila `superseded` innecesaria (sección 9).

### 16.4 Qué entra en JSON y qué no

**Entra (`approvedSnapshot`):** copia exacta del shape ya existente y ya
saneado `approved_template_semantic_snapshot_v2` (sección 2.5) —
reutilizando `buildReviewedApprovedTemplateSemanticSnapshot`/
`buildApprovedTemplateSemanticSnapshot`, nunca reimplementado.

**Nunca entra:** `analysisJson` crudo, `evidenceMap`, `textForEmbedding`,
storage keys/paths, ids de `DocumentEvidence`/`TextEvidence`, contenido de
evidencia, datos de blockchain, datos privados del holder.

### 16.5 Por qué no se modifica `Credential`, `IssuerCourseTemplate` ni `SemanticAnalysis`

- `Credential`: sin cambios (sección 10 — `sourceTemplateId` diferido).
- `IssuerCourseTemplate`: sigue siendo el único lugar donde se **aprueba**
  (sin cambios).
- `SemanticAnalysis`: sigue siendo exclusivamente el artefacto crudo de
  una ejecución de IA real (sin cambios, evita el riesgo de la
  Alternativa C).

---

## 17. Endpoints finales (no implementados)

Todos issuer-scoped, mismo patrón de autorización que C4a.1/C4a.2/C5
(membership `active`, rol `admin|operator`, issuer `authorized`).

```
GET  /issuers/:issuerId/credentials/:credentialId/reusable-semantic-interpretation/candidate?templateId=...
```
- Solo lectura, nunca escribe nada. Requiere credencial `issued`, tipo
  `course`/`certification`, template del mismo `issuerId` con
  `approvedSemanticSnapshot` no nulo.
- Recalcula, siempre en vivo, nunca cacheado, contra la **credencial
  origen real** de la interpretación aprobada (sección 11 — nunca contra
  el template actual):
  - `approvalDriftStatus` (`none_applied`/`up_to_date`/
    `different_approval_available`, sección 7).
  - `templateContentStatus` (`matches_approved_source`/
    `differs_from_approved_source`/`unknown`, sección 11.B — informativo,
    nunca bloquea).
  - `destinationCompatibility`/`changedFields` (`compatible`/`modified`/
    `unknown`, sección 11.C — el control que gatea `apply`).
- Si la credencial origen no puede leerse (sección 11.1),
  `templateContentStatus`/`destinationCompatibility` devuelven
  explícitamente `unknown` — nunca `matches_approved_source`/`compatible`
  por omisión.
- Devuelve el mismo tipo de resumen allowlisted que ya usa `candidate` en
  C4a.2 (`schema`, `status`, counts, `warnings`/`qualityNotes` humanas),
  más: título del template, nombre resuelto (no id) de quién aprobó
  originalmente, `sourceApprovedAt`. **Nunca** `sourceCredentialId`
  (sección 11.1).
- Errores: `401`, `403`, `404` (credencial/template no encontrados o
  cross-issuer), `422` (template sin snapshot aprobado, credencial no
  `issued`/tipo incompatible).

```
POST /issuers/:issuerId/credentials/:credentialId/reusable-semantic-interpretation/apply
Body: { templateId: string, acknowledgeDestinationDrift?: boolean }
```
- Requiere credencial `issued`, tipo `course`/`certification`, template
  con snapshot aprobado, mismo `issuerId`.
- Recalcula `destinationCompatibility` de forma independiente (nunca
  confía en lo que `candidate` devolvió antes), siempre contra la
  credencial origen real (sección 11) — nunca contra el template actual.
- Regla de la sección 11: `compatible` → aplica normalmente; `modified` →
  `422` sin `acknowledgeDestinationDrift: true`, permite continuar con el
  flag; `unknown` (incluida la causa "credencial origen no disponible",
  sección 11.1) → **siempre bloquea**, sin ningún flag de confirmación
  que lo sortee.
- Aplica la regla de idempotencia/supersede de la sección 9 (basada en
  `approvalDriftStatus`/identidad de aprobación fuente, nunca en
  `templateId` solo): `200` (idempotente, `changed: false`) / `200`
  (supersede, `changed: true, supersededPreviousApplication: true`) /
  `201` (primera aplicación).
- Después de confirmar la transacción, intenta el rebuild de perfil
  best-effort (sección 15) — **no implementado en C4b.1** (ver plan
  incremental, sección 21); el campo de respuesta
  `profileRebuildStatus` queda reservado/documentado para cuando C5b lo
  active, pero en C4b.1 la respuesta simplemente no lo incluye.
- Errores: `401`, `403`, `404`, `409` (conflicto de concurrencia real, no
  resuelto por idempotencia — sección 8/9), `422` (template sin snapshot,
  credencial no `issued`/tipo incompatible, `destinationCompatibility:
  modified` sin confirmación explícita, o `destinationCompatibility:
  unknown` — nunca sorteable).

```
GET  /issuers/:issuerId/credentials/:credentialId/reusable-semantic-interpretation
```
- Solo lectura. Devuelve la fila `active` actual (si existe) con el mismo
  resumen allowlisted que `candidate`, más `appliedAt`/nombre resuelto de
  quién aplicó, y los mismos `approvalDriftStatus`/`templateContentStatus`/
  `destinationCompatibility` recalculados en vivo.
- Se integra al `GET` de detalle de credencial existente como un bloque
  opcional (`reusableSemanticInterpretation: {...} | null`), mismo patrón
  ya usado para `documentEvidence`/`textEvidence`.

**Explícitamente fuera de alcance de C4b.1** (documentado como pendiente,
mismo criterio que la revocación de aprobación de template en
C4a.1/C4a.2): endpoint para **desaplicar** (`status: active → revoked`).

---

## 18. Matriz final de decisiones

| Criterio | B sola | E (v0, original) | **E revisada (v0.1)** | Freeze at issuance (A, sección 5) | Explicit post-issuance apply (C, sección 5) |
|---|---|---|---|---|---|
| Trazabilidad histórica | Buena, pero snapshot vivo del contexto de aprobación (sin `source*`) | Buena, misma limitación | **Completa** (campos `source*` congelados) | N/A — no distinguible de la emisión | Completa (igual a E revisada) |
| Atomicidad | Propia, aislada | Propia, aislada | Propia, aislada, con partial unique index | Acoplada a la transacción crítica de emisión | Propia, aislada |
| Impacto en el issue flow | Ninguno | Ninguno | **Ninguno, confirmado por auditoría (2.15)** | **Alto** — modifica la transacción crítica | Ninguno |
| Riesgo de fallo parcial | Manejable | Manejable | Manejable, con regla de idempotencia explícita | Alto — un fallo semántico podría invalidar la emisión | Manejable, mismo patrón best-effort ya usado 3 veces en el código |
| Complejidad backend | Media | Media | Media-alta (idempotencia + partial index + drift), pero sin tocar `Credential` | Alta (además, viola "no modificar el issue flow") | Media-alta, igual a E revisada |
| Complejidad frontend | Media | Media | Media (candidate/apply + estados nuevos) | Baja (automático, sin acción del usuario) | Media |
| Integridad DB | Sin garantía explícita de único activo | Sin garantía explícita de único activo | **Garantizada** (partial unique index + Serializable) | N/A | Garantizada (igual a E revisada) |
| Estabilidad del perfil | Alta si se implementa bien | Alta | **Alta, con reglas explícitas de agregación entre credenciales** | Alta pero acoplada a un evento no reversible | Alta |
| Defendibilidad tesis/demo | Media-alta | Alta | **Muy alta** — cada decisión tiene justificación explícita y precedente en el código existente | Baja — difícil de justificar por qué se acopla a emisión | Alta |
| **Recomendación** | Base insuficiente sin provenance histórica | Base correcta, con ambigüedades sin resolver | **Elegida** | Descartada | Confirmada (es la variante temporal de E) |

---

## 19. Riesgos (actualizados)

- Cualquier automatización futura de `apply` reintroduciría el riesgo de
  "cambio invisible" descartado en la sección 5 — cualquier propuesta de
  automatizarlo debe revisarse explícitamente contra esa sección antes de
  implementarse.
- `destinationCompatibility`/`templateContentStatus` son heurísticas de
  comparación textual — detectan *que* algo cambió, no *cuánto*
  semánticamente importa; pueden generar falsos positivos con
  reescrituras triviales (mitigado, para `destinationCompatibility`, por
  permitir continuar con confirmación explícita; `templateContentStatus`
  nunca bloquea, es puramente informativo — sección 11).
- Depender de la credencial origen (`sourceCredentialId`) en vez del
  template actual es más correcto semánticamente, pero introduce una
  dependencia de lectura adicional (la credencial origen debe seguir
  siendo legible) — mitigado explícitamente por el estado `unknown`/
  bloqueo de la sección 11.1 en vez de asumir compatibilidad por defecto.
- `approvalDriftStatus` depende de que las seis columnas de aprobación de
  `IssuerCourseTemplate` se actualicen siempre juntas y atómicamente — ya
  es así hoy (auditado en sección 9), pero cualquier cambio futuro a C4a.1
  que rompa esa atomicidad invalidaría esta garantía y debe revisarse en
  conjunto.
- El hallazgo de la sección 13 (`profile-sharing.service.ts` con
  pass-through por `.slice()`) es un riesgo de privacidad **latente**, no
  activo hoy — se vuelve real recién cuando C5b.2 agregue
  `provenanceSummary` al mapper holder sin aplicar la corrección
  documentada.
- Volumen de filas históricas por re-aplicación: no se anticipa problema
  de escala para este dominio; no se descarta revisarlo si se
  implementa.
- Acoplamiento con el shape de C5: `snapshotVersion` se modela como campo
  propio (no un valor fijo asumido) para poder convivir con futuras
  versiones del snapshot sin migración adicional.

---

## 20. Pendientes

- Implementación real de todos los slices del plan incremental (sección
  21) — este documento sigue siendo solo diseño.
- `Credential.sourceTemplateId` (sección 10) — diferido, sin fecha fija.
- Endpoint de desaplicar/revocar una interpretación aplicada.
- Rebuild automático de perfil (diseñado en la sección 15, no
  implementado hasta C5b).
- Migración real de Prisma (no generada).
- Cambios de copy/tests reales en frontend (no aplicados).

---

## 21. Plan incremental revisado

El hardening confirma que conviene separar "foundation" de "aplicación" en
backend, y separar "creación de provenance" de "consumo por el emisor" en
frontend — slices más chicos y revisables que la propuesta original de v0.

- **C4b.1a — persistence foundation + invariants (persistence-only,
  confirmado sin reabrir):** migración (**solo** la tabla
  `CredentialReusableSemanticInterpretation` + sus dos enums; **sin**
  cambios a `Credential`, ver sección 10), relaciones, índices normales,
  el partial unique index (SQL manual en la migración, sección 8),
  validación de `prisma validate`. Tests de este slice: **únicamente**
  integridad de base de datos a nivel de constraint —
  insertar directamente (sin pasar por ningún servicio) una fila `active`
  y verificar que una segunda fila `active` para la misma credencial es
  rechazada por el índice. **No** incluye tests de `Promise.all` sobre
  `apply()`, `Serializable`/retry, idempotencia, ni ningún endpoint HTTP —
  ese servicio todavía no existe en este slice; esos tests pertenecen a
  C4b.1b, que sí ejercita el servicio real de aplicación bajo
  concurrencia.
- **C4b.1b — issuer candidate/apply/read (servicio de aplicación):** los
  tres endpoints de la sección 17, con las reglas de idempotencia/
  supersede (sección 9), `approvalDriftStatus` (sección 7),
  `templateContentStatus`/`destinationCompatibility` (sección 11), la
  lectura defensiva de la credencial origen (sección 11.1),
  `Serializable` + retry ante `serialization failure`, y los tests de
  concurrencia real sobre `apply()` (`Promise.all`, manejo de `P2002`)
  diferidos desde C4b.1a. El `apply` queda estructurado para que enchufar
  el rebuild de perfil (sección 15) en C5b.1 sea un cambio pequeño y
  aislado. Sin UI todavía.
- **C4b.2 — create-from-template provenance + issuer UX:** dos partes,
  explícitamente desacopladas:
  - *Provenance de creación* (`Credential.sourceTemplateId`, Opción D de
    la sección 10): solo si en ese momento se decide que vale la pena el
    scope de reemplazar el `PATCH` best-effort actual por un command
    atómico — puede quedar diferido más allá incluso de C4b.2 si no se
    justifica.
  - *UX de aplicación* (independiente de lo anterior): UI de "aplicar
    interpretación revisada" en el detalle issuer-facing (candidate +
    apply, mismo patrón visual que `SemanticApprovalSection`), badges de
    `approvalDriftStatus`/`templateContentStatus`/
    `destinationCompatibility`, selección manual de template si no hay
    provenance de creación disponible todavía.
- **C5b.1 — profile selection/provenance (backend):**
  `FormativeProfileService` prioriza la interpretación aplicada según la
  sección 12 (`sources[]`, `provenanceSummary`, `generatedFrom`
  extendido, contadores redefinidos/nuevos); se enchufa el rebuild
  best-effort de la sección 15 reutilizando
  `AutomaticProfileRebuildService` sin modificarlo.
- **C5b.2 — holder/public projection hardening:** `mapHolderCurrentProfileResponse`
  agrega `provenanceSummary` a `areas`/`skills`/`concepts`; **en el mismo
  cambio**, se corrige `profile-sharing.service.ts` (sección 13) para
  remapear explícitamente en vez de pasar los objetos del mapper holder
  sin modificar; tests que confirman que el perfil público nunca expone
  `provenanceSummary` ni ningún id interno.

---

## 22. Confirmación

No commit. No push. No deploy. No se generó ninguna migración de Prisma.
No se aplicó ningún snapshot. No se modificó `schema.prisma`, `contracts`,
blockchain, canon/hash, reglas de emisión, taxonomía IA, el issue flow, ni
`FormativeProfileService`. No se modificó UI de producción — este
documento y su Anexo (sección propuesta para `domain-rules-v0.md`, sin
aplicar) son los únicos artefactos de C4b.0.1.

---

## Anexo — sección propuesta para `domain-rules-v0.md` (borrador, NO aplicada)

Este bloque es el texto que se agregaría como sección "21. C4b/C5b —
Aplicación de interpretación semántica aprobada" **recién cuando C4b.1a/
C4b.1b se implementen**, no antes. Actualizado respecto al Anexo de v0
para reflejar las decisiones de este hardening.

> ## 21. C4b/C5b — Aplicación de interpretación semántica aprobada
>
> C4b/C5b aplican, de forma explícita y congelada, una interpretación
> semántica ya aprobada por el emisor (C4a.1/C5, snapshot
> `approved_template_semantic_snapshot_v2` en `IssuerCourseTemplate`) a una
> credencial `issued` concreta, y la priorizan en la reconstrucción del
> perfil formativo del holder.
>
> - **Snapshot congelado, nunca vivo:** aplicar una interpretación copia
>   `IssuerCourseTemplate.approvedSemanticSnapshot` y su contexto de
>   aprobación (`sourceSemanticAnalysisId`, `sourceCredentialId`,
>   `sourceApprovedByUserId`, `sourceApprovedAt`, `sourcePipelineVersion`,
>   `sourceTaxonomyVersion`) a una fila nueva de
>   `CredentialReusableSemanticInterpretation` en el momento de la acción.
>   Una re-aprobación posterior del template **no** afecta aplicaciones ya
>   existentes.
> - **Acción explícita y posterior a la emisión (nunca durante, nunca
>   antes de emitir):** aplicar requiere que la credencial esté `issued` y
>   es siempre una acción manual del emisor (`appliedByUserId` es siempre
>   una persona real). Nunca ocurre dentro de la transacción de emisión ni
>   automáticamente al crear el draft. **`Credential.status = issued` sin
>   ninguna interpretación aplicada es un estado completamente válido y
>   esperado.**
> - **Historial, nunca sobrescritura:** re-aplicar (porque el template fue
>   re-aprobado, identificado por la tupla `(sourceSemanticAnalysisId,
>   sourceApprovedAt)`, nunca por `templateId` solo) marca la fila
>   anterior `superseded` y crea una fila `active` nueva — nunca se hace
>   `UPDATE` sobre un snapshot ya aplicado. A lo sumo una fila `active` por
>   credencial, garantizado por un índice único parcial de PostgreSQL.
>   Re-aplicar con la misma aprobación fuente es idempotente.
> - **Tres tipos de drift, deliberadamente separados:** (a)
>   `approvalDriftStatus` — ¿la aprobación actual del template es distinta
>   de la que está aplicada?; (b) `templateContentStatus` — ¿el template
>   actual sigue describiendo lo mismo que la credencial que realmente
>   originó la interpretación aprobada? (advertencia editorial, nunca
>   bloquea, nunca muta nada); (c) `destinationCompatibility`/
>   `changedFields` — ¿la credencial destino es compatible con esa misma
>   credencial origen? (el control que gatea `apply`). Las comparaciones
>   de contenido (b y c) siempre son contra la **credencial origen real**
>   de la interpretación aprobada — **nunca** contra el estado actual
>   (mutable) del template, que no es autoridad transitiva. Si la
>   credencial origen no puede leerse, ambos estados son `unknown` y
>   `apply` se bloquea sin excepción. Nunca se aplica en silencio sobre
>   contenido divergente o desconocido sin confirmación explícita del
>   emisor (y nunca hay confirmación posible para `unknown`).
> - **`Credential.sourceTemplateId` diferido:** no forma parte de
>   C4b.1 — se evaluará por separado si conviene implementarlo mediante un
>   command backend atómico, nunca reutilizando el `PATCH` best-effort
>   genérico actual de C3c.
> - **Prioridad de fuente en el perfil (`FormativeProfileService`)**, por
>   credencial: (1) interpretación aplicada `active` si existe; (2) si no,
>   último `SemanticAnalysis`; (3) si no, solo datos emitidos. Nunca se
>   combinan (1) y (2) para la misma credencial. Entre credenciales
>   distintas, la agregación por etiqueta preserva la proveniencia de cada
>   contribución individual (`sources[]`/`provenanceSummary`), nunca un
>   escalar único que borre la distinción cuando varias credenciales
>   aportan la misma etiqueta con proveniencias distintas.
> - **Sin cambios en canon/hash/blockchain/emisión:** la interpretación
>   aplicada es una capa semántica/off-chain estrictamente posterior a la
>   emisión; no participa en `canonicalHash`, no crea `BlockchainRecord`,
>   no modifica reglas de emisión ni taxonomía IA. La detección de drift y
>   la identidad de aprobación fuente nunca usan ni generan ningún hash
>   relacionado con integridad criptográfica.
> - **Rebuild de perfil:** un `apply`/reapply exitoso dispara,
>   best-effort, el mismo `AutomaticProfileRebuildService` ya usado por
>   C2b.4 — nunca revierte la interpretación aplicada si el rebuild falla.
> - **Privacidad:** issuer-facing recibe un resumen allowlisted (nombres
>   resueltos, nunca ids crudos); holder recibe únicamente
>   `provenanceSummary` (conteos, sin ids); perfil público compartido no
>   expone esta procedencia en absoluto; verificador público no cambia.
> - **Copy obligatorio:** "interpretación revisada por el emisor" (nunca
>   "IA certificó", "aprobación automática" ni "certificación de
>   competencias por IA").
> - Pendiente, explícitamente fuera de alcance de C4b.1/C4b.2/C5b: endpoint
>   de revocación/desaplicación de una interpretación ya aplicada.
>
> Ver `docs/architecture/approved-semantic-interpretation-application-v0.md`
> para el diseño completo, alternativas evaluadas y justificación.
