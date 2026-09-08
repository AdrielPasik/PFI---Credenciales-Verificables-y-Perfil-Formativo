# API y contratos

## 1. Frontera

La app móvil habla **exclusivamente** con el backend NestJS de Scope.

| Servicio | ¿La app lo llama? |
| --- | --- |
| `services/api` (NestJS) | **Sí, el único.** |
| `services/ai-service` (FastAPI) | No. Nunca. |
| Blockchain / RPC | No. Nunca. |
| Object storage | No. Nunca. |
| Base de datos | No. Nunca. |
| Terceros | No. Nunca. |

No existe ningún endpoint `/mobile/*`: la app consume exactamente los mismos
endpoints que Holder Web.

Base URL: `EXPO_PUBLIC_API_BASE_URL`. Ninguna pantalla conoce una URL.

## 2. Inventario de endpoints

### 2.1 `POST /auth/login`

| Campo | Valor |
| --- | --- |
| **Propósito** | Autenticar al titular. |
| **Auth** | No (público). |
| **Pantalla** | Acceso. |
| **Tipo** | Mutación (acción explícita). |
| **Request** | `{ email: string, password: string }` — el email se normaliza a minúsculas y sin espacios antes de enviarse. |
| **Response** | `{ accessToken: string, user: { id, email, did \| null, displayLabel, status } }` |
| **Errores** | `400` datos inválidos · `401` credenciales incorrectas · `5xx` servicio no disponible · red / timeout. |
| **Notas** | La contraseña se limpia del formulario tras cada intento y **nunca** se persiste. |

### 2.2 `GET /auth/me`

| Campo | Valor |
| --- | --- |
| **Propósito** | Resolver la sesión al arrancar la app. |
| **Auth** | `Authorization: Bearer <accessToken>` |
| **Pantalla** | Arranque (`app/index.tsx`) y menú de cuenta. |
| **Tipo** | Consulta. |
| **Response** | El usuario **más** `issuerMemberships: []`. |
| **Errores** | `401` sesión vencida → limpia el token y vuelve a acceso · red → se conserva el token y se ofrece reintentar. |
| **Notas** | `issuerMemberships` se **valida** (tiene que ser un array, para detectar un contrato roto) pero **no se expone**: Scope Mobile es holder-only. Hay un test que verifica que el modelo devuelto no contenga la palabra `issuer`. |

### 2.3 `GET /me/credentials`

| Campo | Valor |
| --- | --- |
| **Propósito** | Listar las credenciales del titular. |
| **Auth** | Bearer. |
| **Pantalla** | Perfil (anticipo) y Credenciales (lista completa). |
| **Tipo** | Consulta. |
| **Response** | `Array<{ id, title, type, status, issuerName, issuedAt \| null, hasIntegrityEvidence, hasAnalysis }>` |
| **`type`** | `academic_subject` · `course` · `certification` · `degree` |
| **`status`** | `issued` · `revoked` |
| **Errores** | `404` sin credenciales disponibles · `5xx` · red / timeout · payload incompatible. |

### 2.4 `GET /me/credentials/:id`

| Campo | Valor |
| --- | --- |
| **Propósito** | Detalle completo de una credencial propia. |
| **Auth** | Bearer. |
| **Pantalla** | Detalle de credencial. |
| **Tipo** | Consulta. |
| **Errores** | `403` la credencial no es del titular · `404` no existe · `401` · `5xx` · red · payload incompatible. Los cuatro tienen mensajes distintos. |

Shape relevante de la respuesta:

~~~
{
  id, type, title, description, hours, status,
  issuer:   { name, did },
  subject:  { did, email, displayName, displayLabel },
  issuedAt, revokedAt, revocationReason,
  canonicalHash, canonicalizationVersion,
  credentialSubject: {
    achievementName, institutionName, completionDate, academicPeriod,
    programName, grade, providerName, platformName, modality, level,
    externalUrl, skills[], competencies[], learningOutcomes[]
  },
  documentEvidence: { originalFileName, mimeType, sizeBytes, sha256, uploadedAt } | null,
  textEvidence:     { label, preview, characterCount, sha256, submittedAt }      | null,
  blockchainRecords: [{ network, chainId, txHash, status, registeredAt, revokedAt }],
  latestSemanticAnalysis: {
    status, confidence, areas[], skills[], concepts[], qualityFlags[], analyzedAt
  } | null
}
~~~

### 2.5 `GET /me/profile/current`

| Campo | Valor |
| --- | --- |
| **Propósito** | Perfil formativo vigente. |
| **Auth** | Bearer. |
| **Pantalla** | Perfil. |
| **Tipo** | Consulta. |
| **Response** | `{ currentProfile: {...} \| null }` |
| **Clave** | `currentProfile: null` **no es un error**: significa "todavía no hay perfil". La pantalla muestra un estado vacío explicativo, no una falla. |

Campos consumidos: `profileVersion`, `credentialsCount`, `totalOfficialHours`
(alias histórico `totalHours`), `credentialsWithoutHours`,
`credentialsWithoutSemanticCoverage`, `credentialsWithReviewedInterpretation`,
`narrative`, `areas[]`, `skills[]`, `concepts[]`, `emittedSkills[]`,
`emittedCompetencies[]`, `emittedLearningOutcomes[]`, `confidence`,
`qualityFlags[]`, `generatedAt`.

### 2.6 `POST /me/profile/rebuild`

| Campo | Valor |
| --- | --- |
| **Propósito** | Recomponer el perfil desde las credenciales emitidas y la semántica ya disponible. |
| **Auth** | Bearer. |
| **Pantalla** | Perfil, botón "Actualizar perfil". |
| **Tipo** | Mutación, **sólo** por acción explícita de la persona. |
| **Response** | El mismo shape que `/me/profile/current` (por eso reusa el mismo adaptador). |
| **Notas** | Es **determinístico y no ejecuta IA**. Por eso el copy dice "Actualizar" y no "Generar" ni "Analizar", y no hay barra de progreso: no hay proceso largo que reportar. |

Nunca se dispara al montar la pantalla ni con pull-to-refresh. Hay tests que lo
verifican.

### 2.7 `POST /me/profile/share`

| Campo | Valor |
| --- | --- |
| **Propósito** | Obtener un enlace público al perfil. |
| **Auth** | Bearer. |
| **Pantalla** | Perfil, acción "Compartir perfil". |
| **Tipo** | Mutación, sólo por acción explícita. |
| **Response** | `{ sharePath: "/share/profile/<token>", expiresAt: string \| null }` |
| **Notas** | Devuelve una **ruta relativa**, no una URL absoluta. Ver sección 4. |

El enlace se genera una sola vez por sesión de pantalla y se reutiliza para
compartir, copiar y abrir la vista pública. Hay un test que verifica que tres
acciones seguidas produzcan **una sola** llamada al endpoint.

## 3. Endpoints que existen y la app NO consume

| Endpoint | Por qué no |
| --- | --- |
| `POST /auth/register` | Crear cuentas desde la app es una decisión de producto no tomada. |
| `POST /me/profile/build-from-ai` | Tampoco tiene CTA en Holder Web. Introducirlo sólo en Mobile crearía una asimetría de producto que nadie decidió. |
| `GET /share/profile/:token` | Es la vista pública; la abre el navegador, no la app. |
| `GET /verify/credentials/*` | Verificación pública: superficie web. |
| `/issuers/**`, `/credentials/**` (emisor) | Scope Mobile es holder-only. |
| `/credentials/:id/semantic-analysis` | El detalle ya trae `latestSemanticAnalysis`. |

## 4. Composición de enlaces públicos

El backend devuelve **rutas**, no URLs absolutas. Holder Web las completa con
`window.location.origin`, que en una app nativa no existe. Por eso Mobile tiene
una segunda variable de entorno.

| Enlace | Composición |
| --- | --- |
| Perfil público | `EXPO_PUBLIC_WEB_BASE_URL` + `sharePath` del backend |
| Credencial pública | `EXPO_PUBLIC_WEB_BASE_URL` + `/verify?credential=<referencia codificada>` |

`sharePath` se valida contra `^/share/profile/[A-Za-z0-9_-]{32,200}$` antes de
usarse: un `sharePath` que no tenga esa forma se rechaza como payload
incompatible, para no convertir la respuesta del servidor en una redirección
arbitraria.

**Nunca** se adivina un dominio ni se construye un token del lado del cliente.

> **Compartir una credencial no tiene endpoint.** Ni en Web ni en Mobile: el
> enlace público es la vista de verificación para esa referencia. Verificado
> leyendo `wallet-credential-detail-route.tsx` y `profile-sharing.controller.ts`.

## 5. Estrategia de adaptación de contratos

### 5.1 Regla

Todo lo que llega del API es **dato no confiable** hasta pasar por
`src/lib/adapters/`. Ninguna pantalla recibe `unknown`, y no hay ningún
`as unknown as` en el código de producción.

Cuando un payload no cumple el contrato se lanza `IncompatiblePayloadError`
con un diagnóstico `{ path, expected, actualCategory }` — por ejemplo
`{ path: 'credentials[0].hasAnalysis', expected: 'boolean', actualCategory: 'string' }`.

### 5.2 Tolerancias que el adaptador implementa a propósito

Estas replican las compatibilidades que Holder Web ya tuvo que incorporar tras
incidentes reales de contrato. Mobile las trae desde el día uno.

| Situación | Comportamiento |
| --- | --- |
| Etiqueta semántica como string **o** como descriptor (`{area}`, `{name}`, `{label}`, `{area_label}`, `{areaLabel}`) | Se acepta cualquiera de las dos formas. |
| Alias `camelCase` / `snake_case` en `credentialSubject` | Se lee el vigente y sólo se cae al histórico si el vigente está **ausente** (`undefined`), nunca si vino `null`. |
| `documentEvidence` / `textEvidence` ausentes o `null` | Se tratan como "no hay evidencia", no como error. |
| Contadores de cobertura ausentes (perfil anterior a C2c) | `null` → no se muestra el aviso. Nunca se fabrica un "0". |
| `totalOfficialHours` ausente | Cae a `totalHours`. |
| `narrative` / `concepts` / campos `emitted*` dentro de `profileJson` | Se leen de ahí si no están en el nivel superior. |
| `confidence` como número **o** como `{ score }` | Ambas formas. |
| `emittedCompetencies` como strings **o** como `{ label }` | Ambas formas. |
| Texto declarado de hasta **500** caracteres, hasta **30** entradas | Se acepta completo, sin truncar. |
| Etiquetas semánticas de hasta **160** caracteres | Idem. |
| Quality flag desconocido | Se muestra legible (`flag_nuevo` → "flag nuevo") en vez de descartarse: es información epistemológicamente relevante. |
| `provenanceSummary` malformado | **Degrada a `null`**, no tira abajo el perfil entero. Es un dato secundario. |

### 5.3 Lo que el adaptador rechaza

- Un tipo o estado de credencial desconocido (mostrarlo crudo sería peor).
- Un hash canónico que no sea `0x` + 64 hex.
- Un digest SHA-256 que no sea 64 hex.
- Una URL externa que no sea `http:` o `https:` (bloquea `javascript:`, `file:`).
- Una confianza fuera de `[0, 1]`.
- Más de 30 entradas declaradas, o una entrada de más de 500 caracteres.
- Cualquier cadena con caracteres de control.
- Un usuario cuyo `status` no sea `active`.

## 6. Duplicación con Holder Web (deliberada)

`apps/mobile` **no importa nada** de `apps/web`: eso invertiría la dirección de
dependencia (una app nativa dependiendo del build de Next.js).

No existe hoy un paquete neutral de contratos: `packages/shared-types` sólo tiene
`package.json` y `README.md`, sin código.

Por eso la lógica de adaptación está **duplicada conceptualmente** entre
`apps/web/src/lib/adapters/holder.adapter.ts` y
`apps/mobile/src/lib/adapters/holder.adapter.ts`. Son implementaciones
independientes de las mismas reglas.

**Consecuencia práctica:** cuando el contrato del titular cambie, hay que
actualizar los dos. El `12-protocolo-de-sincronizacion-holder.md` existe
justamente para que eso no se olvide.

**Extracción futura sugerida (no hecha en esta entrega):** mover las primitivas
de `contract.ts` y los modelos a `packages/shared-types`. Requiere convertir ese
paquete en un workspace TypeScript real y ajustar el build de Web, lo que
implicaría tocar Holder Web — explícitamente fuera del alcance de este trabajo.

## 7. Categorías de error

`src/lib/errors/api-error.ts`:

| Categoría | Cuándo | Reintenta |
| --- | --- | --- |
| `network` | `fetch` rechaza | Sí |
| `timeout` | Se supera el timeout (20 s por defecto) | Sí |
| `http` + `5xx` | El servidor falló | Sí |
| `http` + `401` | Sesión vencida | No — vuelve a acceso |
| `http` + `403` | Sin permiso | No |
| `http` + `404` | No encontrado | No |
| `http` + `400` | Datos inválidos | No |
| `invalid-response` | 200 con cuerpo no-JSON | No |
| `IncompatiblePayloadError` | El payload no cumple el contrato | No automáticamente; se ofrece "Reintentar" |

El cuerpo del error del servidor **nunca** se propaga a la UI: podría contener
detalle interno. Sólo se usa el código de estado para elegir el mensaje. Hay un
test que verifica que un mensaje de error del servidor con contenido sensible no
llegue nunca a la superficie.

## 8. Timeouts

`DEFAULT_TIMEOUT_MS = 20_000`, centralizado en el cliente HTTP. Cubre con holgura
las lecturas del titular y la recomposición determinística del perfil. No se usa
un timeout más agresivo: abortar una operación legítima del backend sería peor
que esperar.
