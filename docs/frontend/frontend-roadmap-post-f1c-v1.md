# Roadmap técnico-producto frontend post-F1c v1

## Estado del documento

- **Producto en el snapshot:** Traza.
- **Marca vigente:** Scope. Este documento preserva el corte post-F1c y no
  reescribe su secuencia histórica con capacidades posteriores.
- **Estado:** normativa de planificación posterior a F1c.
- **Fecha de corte:** 2026-07-30.
- **Alcance:** frontend, contratos backend necesarios y secuencia de integración para una entrega demostrable.
- **No es:** una especificación de features futuras ya implementadas ni un reemplazo de los contratos runtime.

Este documento complementa la arquitectura de información, los modelos de vista, el inventario de componentes, las especificaciones de pantallas y las guías visuales vigentes. Ante una diferencia factual, el código y los contratos backend actuales describen el runtime; este documento define la prioridad y los límites de los próximos slices.

> Actualizacion posterior a P4c-b: el despliegue y la integracion IA se ordenan
> normativamente en
> `docs/architecture/deployment-and-ai-roadmap-v0.md`. Este documento conserva
> el snapshot post-F1c para contexto frontend; P4d-P6b prevalece para la
> secuencia de storage, deployment, analisis, trazabilidad y revision humana.

## 1. Estado actual post-F1c

El producto ya disponía de un recorrido operativo real, sin datos de producto simulados:

```text
login
-> resolución de contexto institucional
-> portal del emisor
-> resolución exacta del titular por email
-> creación de Credential draft
-> detalle mínimo real del draft
```

### Capacidades frontend implementadas

- Login real contra NestJS y rehidratación de sesión mediante `/auth/me`.
- Contexto institucional para cero, una o múltiples memberships activas.
- Selección explícita de issuer cuando existe más de un contexto.
- Portal del emisor protegido.
- Frontera autenticada que obtiene el token internamente sin exponerlo en UI o view models.
- Resolución autorizada del titular por email exacto.
- Selección real de `CredentialType`: `academic_subject`, `course`, `certification` o `degree`.
- Institución derivada del issuer seleccionado y presentada como contexto read-only.
- Creación de un draft real usando issuer y holder derivados del contexto autenticado.
- Detalle mínimo del draft cargado desde backend, incluso ante acceso directo o refresh.
- Manejo de sesión vencida, errores HTTP, payloads incompatibles y estados de carga.

### Capacidades backend ya disponibles

- Autenticación demo-grade con JWT, usuario activo y memberships.
- Autorización institucional para crear drafts y emitir.
- Persistencia de `Credential` con estados `draft`, `issued` y `revoked`.
- Hash canónico `canon_v1`.
- Emisión protegida con evidencia mock por defecto o registro real en Anvil cuando el modo se configura explícitamente.
- Persistencia y lectura de `SemanticAnalysis`.
- Integración HTTP con el AI Service para `semantic_analysis_v1` y `formative_profile_result_v0`.
- Perfil formativo current del holder.
- Endpoint público de verificación compuesto.

### Brecha entre capacidad técnica y flujo de producto

La existencia de una capacidad backend no implica que el flujo frontend esté listo. Después de F1c todavía falta una secuencia responsable para:

- completar y editar el contenido del draft;
- distinguir campos faltantes, advertencias y preparación para emitir;
- adjuntar y conservar evidencia documental;
- revisar resultados asistidos por IA antes de modificar contenido canónico;
- emitir sin saltar controles humanos;
- presentar evidencia blockchain y verificación pública de forma segura.

El frontend post-F1c todavía no implementa emisión, evidencia blockchain, carga de PDF ni análisis IA. Estas capacidades no deben aparecer como acciones disponibles hasta que sus slices correspondientes estén cerrados.

## 2. Camino crítico inmediato

El camino crítico recomendado es:

```text
login
-> issuer
-> holder
-> draft
-> completar
-> evidencia documental / análisis IA
-> revisión humana
-> emisión
-> evidencia blockchain visible
```

Este orden evita que la interfaz presente como terminada una credencial incompleta o que un resultado IA modifique implícitamente campos que luego participan en `canon_v1`.

### Capacidades posteriores o paralelas

Las siguientes capacidades son importantes, pero no deben interrumpir el cierre del flujo principal:

```text
listado institucional
-> verificador público
-> QR
-> reanálisis controlado
```

“Fuera del camino crítico inmediato” no significa “fuera del proyecto”. Significa que estas capacidades dependen de contratos y estados que deben estabilizarse primero.

## 3. Estados persistidos y readiness derivada

### Lifecycle persistido

`Credential.status` conserva únicamente el ciclo de vida durable:

```text
draft | issued | revoked
```

- `draft`: contenido editable y todavía no emitido.
- `issued`: contenido confirmado, hasheado y emitido.
- `revoked`: credencial emitida que dejó de estar vigente.

Estos estados representan hechos de dominio y deben seguir siendo la única fuente persistida del lifecycle de la credencial.

### Readiness derivada

La preparación para avanzar se calcula a partir de datos actuales, permisos, evidencia y validaciones. No reemplaza `Credential.status`.

Vocabulario recomendado:

```text
incomplete
ready_to_review
ready_to_issue
has_warnings
```

Semántica:

- `incomplete`: faltan campos o precondiciones bloqueantes.
- `ready_to_review`: existe contenido mínimo suficiente para revisión humana.
- `ready_to_issue`: la revisión requerida terminó y todas las precondiciones de emisión están satisfechas.
- `has_warnings`: existen advertencias no necesariamente bloqueantes.

`has_warnings` es una señal ortogonal. El contrato recomendado debería modelar:

```text
readiness: incomplete | ready_to_review | ready_to_issue
hasWarnings: boolean
blockingReasons: string[]
warnings: string[]
```

Esto permite, por ejemplo, una credencial `ready_to_review` con advertencias sin inventar un cuarto estado mutuamente excluyente.

### Por qué no persistir nuevos estados todavía

No agregar por ahora `reviewed`, `processing` ni `ready_to_issue` a `CredentialStatus`.

- `processing` describe un job o una request, no el lifecycle de la credencial.
- `ready_to_issue` puede cambiar si se edita un campo, cambia una precondición institucional o se invalida evidencia.
- `reviewed` necesita definir quién revisó, qué versión revisó y qué cambios aceptó; un enum aislado perdería esa trazabilidad.
- Persistir estados derivados introduce riesgo de drift entre datos y etiqueta.

Si más adelante se necesita auditoría de revisión o jobs asíncronos, deben modelarse como recursos específicos, no como nuevos estados ambiguos de `Credential`.

## 4. Slices post-F1c

### P1 — Hardening del detalle institucional

**Objetivo**

Proveer un contrato issuer-facing seguro para leer una credencial con resumen de issuer y holder, autorización institucional y minimización explícita.

**Alcance**

- Proteger la lectura operativa por usuario, membership, rol e issuer autorizado.
- Verificar que la credencial pertenezca al issuer del contexto.
- Devolver un DTO allowlist con datos humanos del holder, incluyendo DID nullable.
- Separar esta lectura institucional del endpoint público de verificación.
- Evitar exposición de `rawData`, metadata interna, objetos Prisma y relaciones completas.
- No exponer IDs técnicos que no sean necesarios para navegación o commands internos.

**Criterio de cierre**

`GET /credentials/:id`, cuando se use desde el Portal del Emisor, deja de funcionar como lectura genérica sin scoping: el detalle F1c pasa a un contrato autenticado, autorizado y con holder summary seguro. Si se separa una ruta issuer-facing para preservar compatibilidad, la decisión y los consumidores deben quedar documentados explícitamente.

**Riesgo principal**

Romper usos demo existentes de `GET /credentials/:id` si se protege sin inventariar consumidores. La solución debe preservar o separar explícitamente el read model público.

**Requiere Prisma**

No debería requerir cambios de schema.

### P2 — Edición de draft y readiness derivada

**Objetivo**

Permitir actualizar un draft con una allowlist por tipo de credencial y obtener validaciones derivadas consistentes.

**Alcance**

- Agregar un `PATCH` protegido para credenciales `draft`.
- No permitir cambiar issuer mediante input libre.
- Definir campos editables y reglas por `CredentialType`.
- Normalizar strings, horas, fechas y estructuras canónicas.
- Calcular `readiness`, `blockingErrors` y `warnings` sin persistir un nuevo lifecycle.
- Considerar concurrencia para evitar sobrescrituras silenciosas.

**Criterio de cierre**

Un draft puede completarse de forma segura y el backend explica por qué está incompleto, listo para revisión o listo para emitir.

**Riesgo principal**

Modificar campos que participan en `canon_v1` sin una política explícita de edición y confirmación.

**Requiere Prisma**

No necesariamente para el patch básico. Una estrategia fuerte de versionado optimista o auditoría podría requerir migración; debe decidirse antes de implementarla.

### P3 — Completado manual en frontend

**Objetivo**

Construir la experiencia real para completar un draft según su tipo, usando P1 y P2.

**Alcance**

- Formulario por tipo con labels humanos y validaciones coherentes con backend.
- Autosave solo si se define una estrategia segura; por defecto, guardado explícito.
- Presentar blockers y warnings sin inventar readiness local.
- Mantener issuer y holder como contexto read-only.
- Conservar errores recuperables y prevenir doble submit.

**Criterio de cierre**

El issuer puede crear, completar, guardar, refrescar y volver a abrir un draft real sin perder datos ni ver IDs técnicos.

**Riesgo principal**

Duplicar reglas de dominio en frontend. El backend debe seguir siendo la autoridad.

**Requiere Prisma**

No.

### P4 — Evidencia documental PDF

**Objetivo**

Incorporar un PDF como evidencia documental trazable antes del análisis IA.

**Alcance**

- Definir carga, límites, MIME, tamaño y manejo de errores.
- Definir almacenamiento local/demo y referencia persistida.
- Calcular en backend un hash del archivo y definir algoritmo, propósito y persistencia.
- No guardar binarios grandes en `Credential.rawData`.
- No afirmar que el PDF está on-chain.
- No hacer que el análisis IA sea obligatorio para adjuntar evidencia.
- Preparar una referencia estable para análisis y auditoría.

**Criterio de cierre**

El sistema puede demostrar qué archivo fue aportado, por quién, cuándo y qué análisis se originó desde él.

**Riesgo principal**

Confundir hash del archivo con `canonicalHash` de la credencial o perder trazabilidad si el archivo se reemplaza.

**Requiere Prisma**

Probablemente sí, si se modela evidencia documental y versiones correctamente. Debe resolverse en una decisión específica antes del slice.

### P5 — Análisis semántico asistido por IA

**Objetivo**

Integrar en el flujo del portal la capacidad backend ya existente para obtener y persistir `semantic_analysis_v1`.

**Alcance**

- Usar el endpoint NestJS protegido; el frontend nunca llama FastAPI directamente.
- Asociar el análisis al documento y credencial correctos.
- Mostrar loading indeterminado, estado parcial, confidence y warnings.
- Presentar áreas, skills y conceptos como propuestas asistidas.
- No escribir automáticamente sobre campos canónicos.

**Criterio de cierre**

Un issuer puede solicitar análisis de evidencia real, volver a abrir el draft y ver un resultado persistido y explicable.

**Riesgo principal**

Presentar inferencias como hechos o perder la relación entre artifact, documento y versión del draft.

**Requiere Prisma**

El análisis actual ya se persiste. La trazabilidad documental de P4 puede requerir cambios.

### P6 — Revisión humana y aceptación de propuestas

**Objetivo**

Crear el gate humano que transforma propuestas IA o datos manuales en contenido confirmado para emisión.

**Alcance**

- Comparar contenido actual y propuestas.
- Aceptar o rechazar cada propuesta relevante.
- Guardar campos aceptados mediante P2.
- Recalcular readiness después de cada cambio.
- Mostrar advertencias y provenance.
- Definir una confirmación final responsable antes de emitir.

**Criterio de cierre**

Ningún contenido sugerido por IA entra en `canon_v1` sin acción explícita de un usuario autorizado.

**Riesgo principal**

Emitir sobre una versión distinta de la revisada. Debe existir una comprobación de concurrencia o fingerprint de revisión.

**Requiere Prisma**

No para una revisión demo basada en la versión actual del draft. Sí puede requerirlo para auditoría formal de decisiones.

### P7 — Emisión responsable mediante signer backend

**Objetivo**

Conectar la UI al issue flow protegido existente y endurecer sus precondiciones con readiness.

**Alcance**

- Confirmación explícita de una acción irreversible.
- Revalidación backend de membership, issuer, holder DID y campos requeridos.
- Registro en Anvil mediante signer privado del backend cuando el modo esté configurado.
- Preservar modo mock para desarrollo donde corresponda.
- Manejar fallos sin afirmar emisión exitosa antes de confirmación.
- Prevenir doble emisión e idempotencia accidental.

**Criterio de cierre**

Una credencial revisada pasa de `draft` a `issued`, obtiene `canonicalHash` y persiste un único `BlockchainRecord` coherente.

**Riesgo principal**

La transacción DB no puede revertir una transacción blockchain ya minada. La demo debe reconocer la deuda de reconciliación.

**Requiere Prisma**

No para reutilizar el flujo actual. La idempotencia o reconciliación productiva puede requerir cambios futuros.

### P8 — Evidencia blockchain visible

**Objetivo**

Mostrar al issuer el resultado técnico de emisión como evidencia secundaria y comprensible.

**Alcance**

- Estado de registro.
- Red, dirección de contrato, tx hash abreviado, canonicalización y block number.
- Incorporar block number al contrato persistido/read model antes de mostrarlo: el receipt del write client lo conoce, pero `BlockchainRecord` no lo persiste actualmente.
- Presentar el estado técnico con una etiqueta humana y explicación contextual.
- Copiar valores técnicos sin hacerlos identidad principal.
- Diferenciar emisión, evidencia registrada y verificación válida.
- No exponer private key, signer config ni secretos.

**Criterio de cierre**

Después de emitir, la UI explica qué quedó registrado y qué no prueba blockchain por sí sola.

**Riesgo principal**

Convertir blockchain en una promesa visual excesiva o confundir receipt minado con validez integral.

**Requiere Prisma**

Sí. Se necesita agregar `blockNumber`, migrar y poblarlo desde el receipt si se mantiene dentro del alcance visible de P8.

### P9 — Listado institucional simple

**Objetivo**

Permitir al issuer ver sus credenciales reales sin convertir el portal en un dashboard genérico.

**Alcance**

- Listado paginado o limitado, scoping por issuer.
- Campos mínimos: logro, titular seguro, status, fecha relevante y readiness.
- Filtros básicos por status solo si el backend los soporta y el volumen demo los justifica.
- Aplicar readiness principalmente a drafts:
  - `draft`: mostrar readiness calculada;
  - `issued`: readiness no aplica;
  - `revoked`: readiness no aplica.
- No mostrar `ready_to_issue` para una credencial ya emitida o revocada.
- Navegación al detalle.
- Sin métricas inventadas ni búsqueda global de usuarios.

**Criterio de cierre**

El issuer puede recuperar credenciales creadas anteriormente y continuar el flujo.

**Riesgo principal**

Exposición transversal entre issuers o N+1 queries.

**Requiere Prisma**

No debería requerirlo; índices pueden evaluarse según datos reales.

### P10 — Verificador público seguro

**Objetivo**

Convertir la verificación backend existente en una experiencia pública controlada y defendible.

**Alcance**

- Read model público minimizado.
- Para credenciales emitidas con evidencia válida, devolver `valid`.
- Para credenciales emitidas incompletas, devolver `incomplete` o una presentación equivalente a no verificable.
- Para credenciales revocadas, devolver `revoked`.
- Una credencial `draft` nunca está disponible públicamente.
- Una referencia a un draft debe comportarse como inexistente o no publicada, sin confirmar su existencia.
- No mostrar issuer, holder, title ni metadata de drafts.
- Mantener abierta la decisión entre responder `404` o una respuesta pública uniforme como `{ "verificationStatus": "not_available" }`.
- Issuer humano, holder/subject permitido, canonical hash y evidencia.
- Definir si la verificación debe recomputar el hash; no presentarlo como comprobación activa mientras el backend no lo implemente.
- Política explícita de PII visible.
- Manejo de inexistente y enlaces inválidos.
- No mezclar perfil formativo agregado con prueba de validez.
- No exponer el endpoint compuesto actual como contrato público final sin un read model minimizado.
- El frontend público no debe reutilizar directamente el DTO técnico actual.

**Criterio de cierre**

Un tercero puede verificar una credencial mediante una URL estable sin autenticarse y sin acceder a datos internos.

**Riesgo principal**

Usar un UUID predecible como única frontera de privacidad o exponer información personal excesiva.

**Requiere Prisma**

No necesariamente. Un identificador público o token de sharing puede requerir migración según la decisión de privacidad.

### P11 — QR hacia verificación

**Objetivo**

Representar una URL pública estable de P10 en un QR interoperable.

**Alcance**

- QR contiene una URL, no JSON crudo ni secretos.
- Fallback textual y copia del enlace.
- Prueba con cámara móvil.
- No introducir wallet ni firma del holder.

**Criterio de cierre**

Escanear el QR abre exactamente la experiencia pública de verificación para esa credencial.

**Riesgo principal**

Versionar un QR antes de estabilizar URL, privacidad y disponibilidad del verificador.

**Requiere Prisma**

No si la URL usa una referencia pública ya establecida por P10.

### P12 — Reanálisis controlado

**Objetivo**

Permitir regenerar análisis sin alterar silenciosamente una credencial emitida.

**Alcance**

- En draft, reanalizar crea un nuevo `SemanticAnalysis` y vuelve a revisión.
- En issued, el análisis posterior es complementario y no canónico.
- Conservar historial, artifact fuente, fecha y versión.
- No recalcular `canonicalHash`.
- No reemitir automáticamente.

**Criterio de cierre**

El sistema distingue claramente análisis actual, historial y efecto permitido según lifecycle.

**Riesgo principal**

Mostrar inferencias posteriores como si hubieran formado parte de la credencial emitida.

**Requiere Prisma**

El modelo append-only actual puede ser suficiente; la trazabilidad documental puede requerir relaciones adicionales.

## 5. Dependencias

| Slice | Depende de | Bloquea | Riesgo dominante | Prioridad |
|---|---|---|---|---|
| P1 Detalle institucional | F1c, auth y memberships | detalle serio, listado seguro y emisión frontend confiable | fuga entre issuers o PII | Crítica |
| P2 Patch + readiness | P1 y contrato de tipos | completado manual, revisión y emisión responsable | drift entre datos y readiness | Crítica |
| P3 Completado manual | P1, P2 | demo de draft completo | duplicación de reglas en UI | Crítica |
| P4 Evidencia PDF | P1, decisión de storage/hash | IA sobre PDF trazable | confundir hash documental y canonical hash | Alta |
| P5 Análisis IA | P4 para PDF real; cliente IA existente | revisión asistida | inferencias presentadas como hechos | Alta |
| P6 Revisión humana | P2, P3 y P5 cuando se usa IA | emisión responsable | emitir otra versión | Crítica |
| P7 Emisión Anvil | P1, P2, P6; issue backend existente | evidencia final, verificador real y QR | DB transaction != blockchain transaction | Crítica |
| P8 Evidencia visible | P7 | cierre demostrable de emisión | sobrepromesa blockchain | Alta |
| P9 Listado issuer | P1; idealmente P2 | recuperación operativa | scoping/N+1 | Media |
| P10 Verificador público | P7 y política de privacidad | QR real | PII y referencia pública | Alta |
| P11 QR | P10 | sharing escaneable | URL inestable | Media |
| P12 Reanálisis | P4, P5, P6 | evolución controlada del análisis | alterar semántica post-emisión | Media |

Relaciones obligatorias:

- P1 bloquea un detalle serio, el listado institucional y una emisión frontend confiable.
- P2 bloquea la edición manual y una readiness defendible.
- P4 bloquea el análisis IA trazable de PDF.
- P6 es el gate de emisión responsable.
- P7 habilita evidencia real para verificador y QR.
- P10 debe estabilizarse antes de generar QR.

## 6. Corte sugerido para una entrega al 50 %

El “50 %” debe representar un recorrido vertical demostrable, no la mitad de una lista de pantallas.

### Compromiso fuerte

- F1a/F1b/F1c estabilizados.
- P1: detalle institucional seguro.
- P2: edición de draft y readiness derivada.
- P3: completado manual real.
- Una demostración IA o documental real:
  - preferencia: P4 básico + P5 usando un PDF liviano; o
  - alternativa controlada: análisis existente ya persistido, con su limitación explícita.
- P6: revisión humana mínima si la IA propone contenido canónico.

### Stretch valioso si el tiempo alcanza

- P7: emisión local en Anvil con signer backend.
- P8: evidencia blockchain visible.
- P9: listado institucional simple.
- P10: verificador público mínimo, solo después de cerrar privacidad.

P7 y P8 son stretch respecto del corte de la Entrega 50 %, pero forman parte obligatoria del vertical objetivo del producto. No se consideran fuera del alcance y permanecen dentro de su camino crítico.

### Deseable, pero no condiciona el corte

- P11: QR.
- P12: reanálisis controlado.
- Refinamientos de filtros, paginación y recuperación.

### Fuera del corte inmediato

- MetaMask y firma desde navegador.
- Wallet cripto visible para el holder.
- Superadmin completo.
- KMS/HSM y custodia productiva.
- Mobile nativo completo.
- Verificador avanzado con auditoría.
- Sharing avanzado, expiración y permisos finos.
- UI avanzada de revocación y reconciliación.

Estos puntos quedan fuera del corte inmediato, no fuera del producto.

### Exclusiones de arquitectura de esta versión

No son backlog válido para esta arquitectura:

- private keys, mnemonics o configuración del signer en frontend;
- firma blockchain obligatoria del holder;
- uso de una wallet personal del desarrollador como signer institucional;
- llamadas directas del frontend al AI Service;
- aceptación automática de inferencias IA dentro de contenido canónico;
- exposición de DTOs crudos, objetos Prisma, artifacts completos o secretos;
- datos fake presentados como credenciales, perfiles o evidencia real.

MetaMask podría evaluarse en el futuro como opción issuer-side, pero no como dependencia del holder ni como parte de este roadmap inmediato.

## 7. Reglas de prioridad

1. Cerrar un recorrido vertical antes de ampliar navegación.
2. Resolver seguridad y scoping backend antes de embellecer una vista.
3. No crear UI para un contrato que todavía no representa el dominio necesario.
4. No emitir antes de completar, revisar y revalidar.
5. No copiar propuestas IA a campos canónicos sin aceptación humana.
6. No generar QR antes de estabilizar el verificador y su política de PII.
7. No introducir blockchain en frontend; el signer permanece en backend.
8. No usar mocks cuando existe un flujo real disponible.
9. Mantener `draft|issued|revoked` como lifecycle y calcular readiness.
10. Priorizar trazabilidad y estados recuperables sobre animaciones o métricas.

## 8. Riesgos actuales y mitigaciones

### Detalle genérico

El read actual de credencial es útil para demo, pero no es el contrato issuer-facing final. No incluye un resumen personal seguro del holder y su scoping debe endurecerse.

**Mitigación:** P1 con endpoint o read model institucional protegido y allowlist.

### Nombre institucional enviado por frontend

El draft actual recibe `institution_name` dentro de datos construidos por frontend. Aunque F1c lo deriva de la sesión, el backend debe validarlo o derivarlo del issuer persistido.

**Mitigación:** resolver en P2 sin permitir que el cliente cambie identidad institucional.

### Ausencia de readiness

Hoy `draft` no distingue un registro recién creado de uno completo y revisable.

**Mitigación:** readiness derivada con blockers y warnings.

### Contrato canónico

`canon_v1` incluye campos confirmados como issuer/subject DID, título, descripción, horas y propiedades de `credentialSubject`, entre ellas achievement, institution, competencies, grade y skills.

**Mitigación:** todos los cambios canónicos ocurren antes de emitir; después de emitir no se recalcula el hash.

### IA y contenido canónico

`SemanticAnalysis` es complementario y no modifica `Credential`.

**Mitigación:** P6 exige aceptación humana antes de copiar una propuesta al draft. El artifact IA nunca es autoridad de emisión.

### Evidencia PDF

El endpoint IA puede recibir un PDF, pero eso no equivale por sí solo a evidencia documental persistida.

**Mitigación:** P4 define storage, referencia, hash y versiones antes de prometer trazabilidad.

### Signer

El write client y `BlockchainEvidenceService` usan configuración backend.

**Mitigación:** nunca exponer private key, signer ni `ethers` al frontend. El holder no firma transacciones.

### Atomicidad blockchain

Una transacción on-chain minada no puede revertirse si después falla la persistencia DB.

**Mitigación:** para demo, error explícito y operación controlada; para producto, idempotencia, reconciliación u outbox equivalente.

## 9. Decisiones que requieren validación con tutor

| Decisión | Alternativas | Recomendación inicial | Impacto |
|---|---|---|---|
| ¿Puede emitirse sin DID del holder? | exigir DID / permitir referencia interna | Mantener DID obligatorio para emitir | Canon, identidad y UX |
| ¿El PDF es obligatorio? | siempre / por tipo / opcional | Definir por tipo de credencial | P2, P4 y readiness |
| ¿El hash del PDF participa en `canon_v1`? | incluir / evidencia separada | Mantenerlo separado en v1 salvo cambio versionado del canon | Compatibilidad de hashes |
| ¿La IA modifica contenido emitible? | automática / propuesta revisable / solo complementaria | Propuesta revisable, nunca automática | P5 y P6 |
| ¿Verificador y QR entran en el corte del 50 %? | ambos / solo verifier / ninguno | Verifier mínimo como stretch; QR después | Alcance de entrega |
| ¿Qué PII puede ver el issuer y qué PII ve un verificador? | holder summary institucional / titular público limitado / DID / sin PII | Allowlist distinta por audiencia y mínimo explícitamente aprobado | P1, P10 y privacidad |
| ¿Reanálisis post-emisión? | prohibido / complementario / reemisión | Complementario y no canónico | P12 |
| ¿Cómo se prueba review sobre una versión? | `updatedAt` / versión / fingerprint | Definir control de concurrencia antes de P6 | Integridad |

Estas decisiones no deben resolverse silenciosamente dentro de un componente.

## 10. Convenciones para cada slice

Cada prompt e implementación futura debe:

- limitarse a un único slice y declarar fuera de alcance;
- inspeccionar contratos reales antes de codificar;
- mantener backend response → adapter allowlist → view model → feature → presentación;
- no importar DTOs backend ni objetos Prisma en componentes;
- no mostrar IDs técnicos, JWT, hashes completos o secretos como identidad;
- evitar datos fake y capacidades visuales no implementadas;
- incluir tests unitarios útiles y validación runtime real cuando el entorno lo permita;
- revisar responsive en mobile, tablet y desktop;
- mantener accesibilidad, foco, labels, errores y loading real;
- confirmar aislamiento de IA, blockchain y canon;
- generar review bundle ignorado cuando se solicite;
- dejar cambios separados y revisables;
- no hacer commit ni push desde Codex salvo pedido explícito posterior.

## 11. Orden recomendado de ejecución

### Tramo A — Base operativa

```text
P1 -> P2 -> P3
```

Resultado: el issuer recupera, completa y entiende la readiness de un draft real.

### Tramo B — Evidencia y asistencia

```text
P4 -> P5 -> P6
```

Resultado: existe evidencia trazable, análisis persistido y revisión humana antes de emitir.

### Tramo C — Emisión demostrable

```text
P7 -> P8
```

Resultado: la credencial se emite con hash real, evidencia Anvil y presentación técnica segura.

### Tramo D — Recuperación y verificación

```text
P9
P10 -> P11
P12
```

Resultado: operación cotidiana, verificación pública, QR y evolución controlada del análisis.

P9 puede avanzar en paralelo después de P1 si no retrasa P2-P8.

## 12. Próximo slice exacto

El próximo slice recomendado es:

```text
P1 — Hardening del detalle institucional y holder summary seguro
```

Debe comenzar con una inspección acotada del uso actual de `GET /credentials/:id` y una decisión explícita entre:

- proteger y adaptar ese endpoint sin romper verificación; o
- crear un read model issuer-facing separado y mantener el endpoint público donde corresponda.

El resultado mínimo debe incluir autorización por contexto institucional, scoping por issuer, DTO allowlist y holder summary seguro. No debe implementar todavía patch, readiness, PDF, IA ni emisión frontend.

## 13. Fuentes inspeccionadas

Este roadmap se elaboró contrastando:

- design system y marca;
- arquitectura de información;
- modelos de datos y view models frontend;
- inventario de componentes;
- especificación del Portal del Emisor;
- roadmap frontend v0;
- handoff UI/UX;
- guías de implementación visual;
- schema Prisma;
- módulos backend de credentials, issuers, semantic, profiles, verification y blockchain;
- `CredentialRegistry.sol`.

No se modificó ningún contrato runtime para redactar este documento.
