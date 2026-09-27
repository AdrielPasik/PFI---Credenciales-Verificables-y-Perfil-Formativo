# Recuperación de paridad: Objetivos y Análisis de trayectoria

> **Fecha:** 2026-09-27.
> **Tipo:** auditoría de deriva + implementación de las capacidades faltantes.
> **Alcance de cambios:** `apps/mobile/**` exclusivamente.
> **Backend / Web / Prisma / migraciones / superficie pública / emisor:** sin
> ningún cambio.

---

## 1. Por qué existió esta deriva

La app móvil se implementó cuando el producto del Titular tenía tres
capacidades: perfil, credenciales y compartir. Después de eso el producto
incorporó dos áreas enteras —**Objetivos** y **Análisis de trayectoria
(ReasoningRun)**— y reorganizó la jerarquía del perfil en Web. Mobile no se
enteró: siguió compilando, siguió pasando sus tests y siguió siendo correcto en
lo que hacía, pero dejó de representar el producto.

Esa es exactamente la falla que el `12-protocolo-de-sincronizacion-holder.md`
existe para evitar. Se documenta acá como caso real.

---

## 2. Mapa de rutas ANTES

~~~
app/
  _layout.tsx
  index.tsx                            arranque / decisión de sesión
  login.tsx
  register.tsx
  (holder)/
    _layout.tsx                        guardia de sesión + stack
    (tabs)/
      _layout.tsx                      Perfil | Credenciales
      index.tsx                        Perfil formativo
      credentials.tsx                  Mis credenciales
    credentials/
      [credentialId].tsx               Detalle de credencial
~~~

Sin ninguna ruta de Objetivos ni de Análisis.

## 3. Mapa de rutas DESPUÉS

~~~
app/
  _layout.tsx
  index.tsx
  login.tsx
  register.tsx
  (holder)/
    _layout.tsx
    (tabs)/
      _layout.tsx                      Perfil | Credenciales  (siguen SIENDO DOS)
      index.tsx                        Perfil formativo
      credentials.tsx                  Mis credenciales
    credentials/
      [credentialId].tsx               Detalle de credencial
    objectives/
      index.tsx                        Mis objetivos                    NUEVO
      new.tsx                          Nuevo objetivo + revisión        NUEVO
      [objectiveId].tsx                Objetivo + análisis              NUEVO
~~~

**No se agregó una tercera pestaña.** Objetivos entra desde una tarjeta en el
Perfil, igual que en Holder Web, y vive en el stack del titular. Tres pestañas
habrían competido con la jerarquía profile-first sin ganar nada: el objetivo se
prepara de a ratos, no se consulta a diario.

**Por qué intake y revisión comparten una ruta:** la revisión depende de un
snapshot que sólo existe en memoria. Navegar a otra ruta y volver lo perdería, y
persistir el texto privado del objetivo en el dispositivo para evitarlo sería
crear una copia de datos privados que nadie pidió.

---

## 4. Grafo de API

### 4.1 ANTES (8 endpoints)

| Método | Ruta | Timeout | Pantalla |
| --- | --- | --- | --- |
| POST | `/auth/login` | 45 s | Acceso |
| POST | `/auth/register` | 45 s | Registro |
| GET | `/auth/me` | 45 s | Arranque |
| GET | `/me/credentials` | 20 s | Perfil, Credenciales |
| GET | `/me/credentials/:id` | 20 s | Detalle |
| GET | `/me/profile/current` | 20 s | Perfil |
| POST | `/me/profile/rebuild` | 20 s | Perfil |
| POST | `/me/profile/share` | 20 s | Perfil |

### 4.2 AGREGADOS (8 endpoints)

| Método | Ruta | Timeout | Pantalla | Tipo |
| --- | --- | --- | --- | --- |
| POST | `/me/objective-requirement-proposals` | **180 s** | Nuevo objetivo | Mutación con proveedor |
| POST | `/me/objectives` | 20 s | Revisión | Mutación |
| GET | `/me/objectives` | 20 s | Mis objetivos | Consulta |
| GET | `/me/objectives/:id` | 20 s | Detalle de objetivo | Consulta |
| GET | `/me/reasoning-runs` | 20 s | Detalle de objetivo | Consulta |
| GET | `/me/reasoning-runs/:id` | 20 s | Detalle de objetivo | Consulta |
| POST | `/me/reasoning-runs` | **180 s** | Detalle de objetivo | Mutación |
| POST | `/me/reasoning-runs/:id/execute` | **180 s** | Detalle de objetivo | Mutación con proveedor |

### 4.3 La categoría de timeout nueva, y por qué hacía falta

`LONG_OPERATION_TIMEOUT_MS = 180_000`.

El límite general de la app era de 20 s, pensado para lecturas del titular. La
ejecución de un análisis es **síncrona en el backend** y hace **una llamada al
proveedor por cada Requirement**: un objetivo de 12 requisitos puede tardar
minutos. Con 20 s el cliente habría abortado una ejecución válida mientras el
servidor seguía trabajando — y esa llamada al proveedor ya estaba pagada.

No es "sin límite": una petición colgada tiene que terminar. Y cuando se agota,
el copy **no** ofrece reintentar a ciegas: dice que la operación pudo haber
seguido en el servidor y sugiere volver a abrir el objetivo antes de iniciar uno
nuevo. Reintentar ahí habría duplicado el gasto.

### 4.4 Endpoints que existen y Mobile NO consume

| Endpoint | Motivo |
| --- | --- |
| `POST /me/objectives/:id/revisions` | Holder Web tampoco lo expone: su semántica frente a los análisis está deliberadamente diferida. Exponerlo sólo en Mobile congelaría una decisión de producto sin su consumidor. |
| `GET /me/objectives?objectiveType=` | El filtro existe, pero Web no lo usa y el volumen esperado no lo justifica todavía. |

---

## 5. Matriz de paridad

### 5.1 ANTES

| Capacidad | Backend | Web | Mobile | Contrato | Estado |
| --- | --- | --- | --- | --- | --- |
| Login / registro / sesión / logout | Sí | Sí | Sí | vigente | `FULL_PARITY` |
| Identidad canónica (`displayLabel`) | Sí | Sí | Sí | vigente | `FULL_PARITY` |
| Perfil: resumen, narrativa, horas, confianza | Sí | Sí | Sí | vigente | `FULL_PARITY` |
| Perfil: avisos de cobertura | Sí | Sí | Sí | vigente | `FULL_PARITY` |
| Perfil: áreas y habilidades | Sí | Resumen + detalle | **Todo de entrada** | vigente | `PARTIAL_PARITY` |
| Perfil: conceptos | Sí | En el detalle | **Nivel superior** | vigente | `PARTIAL_PARITY` |
| Perfil: información declarada | Sí | En el detalle | **Nivel superior** | vigente | `PARTIAL_PARITY` |
| Perfil: procedencia Emisor / IA | Sí | Sí | Sí | vigente | `FULL_PARITY` |
| Perfil: actualizar y compartir | Sí | Sí | Sí | vigente | `FULL_PARITY` |
| Credenciales: lista, detalle, compartir | Sí | Sí | Sí | vigente | `FULL_PARITY` |
| **Objetivos: entrada / descubrimiento** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: historial** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: carga del texto** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: propuesta de requisitos** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: revisión (editar/agregar/eliminar/deshacer/reordenar)** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: fragmento exacto del origen** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: ver en el objetivo completo** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: confirmar** | Sí | Sí | **No** | vigente | `MISSING` |
| **Objetivos: detalle persistido** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: historial y selección de run** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: crear run** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: ejecutar run** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: pending / running / failed / completed** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: los cinco estados finales** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: `supportedWeakerClaim`** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: evidencia proyectada** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: navegar a la credencial** | Sí | Sí | **No** | vigente | `MISSING` |
| **Análisis: síntesis del objetivo** | Sí | Sí | **No** | vigente | `MISSING` |
| Verificador público | Sí | Sí | No | vigente | `NOT_APPLICABLE_NATIVE` |
| Superficies de emisor | Sí | Sí | No | vigente | `NOT_APPLICABLE_NATIVE` |
| Revisiones de objetivo | Sí | No | No | vigente | `DEFERRED_BY_PRODUCT` |

**Recuento ANTES:** `FULL_PARITY` 15 · `PARTIAL_PARITY` 3 · `MISSING` 18 ·
`STALE_CONTRACT` 0 · `NOT_APPLICABLE_NATIVE` 2 · `DEFERRED_BY_PRODUCT` 1.

### 5.2 DESPUÉS

Las 18 filas `MISSING` pasaron a `FULL_PARITY` o `MOBILE_ADAPTED`. Las 3
`PARTIAL_PARITY` del perfil pasaron a `FULL_PARITY`.

**Recuento DESPUÉS:** `FULL_PARITY` 30 · `MOBILE_ADAPTED` 6 ·
`PARTIAL_PARITY` 0 · `MISSING` 0 · `STALE_CONTRACT` 0 ·
`NOT_APPLICABLE_NATIVE` 2 · `DEFERRED_BY_PRODUCT` 1.

#### Las seis capacidades `MOBILE_ADAPTED` de esta entrega

| Capacidad | Web | Mobile | Por qué difiere |
| --- | --- | --- | --- |
| Reordenar requisitos | Botones de mover | Botones "Subir" / "Bajar" con etiqueta accesible | Ninguna de las dos usa arrastrar y soltar. En Mobile se descartó explícitamente: exigiría una dependencia nueva y no es operable con lector de pantalla sin trabajo extra. |
| Fragmento del origen | Diálogo modal | Hoja inferior nativa con dos niveles | Mismo contenido; gesto de plataforma. |
| Detalle del objetivo | Secciones con `<details>` | Secciones plegables nativas | Misma jerarquía, misma decisión de qué se pliega. |
| Aviso de salida durante la revisión | `beforeunload` del navegador | Aviso en pantalla + descarte explícito | No existe `beforeunload` en nativo; ver §9. |
| Detalle del perfil | `<details>` anidados | Disclosure nativo con el mismo contenido | Mismos límites (6 áreas / 12 habilidades). |
| Ejecución larga | "No cierres esta página" | "No cierres la aplicación mientras tanto" | Misma limitación, lenguaje de plataforma. |

---

## 6. Contratos: ninguno estaba obsoleto

`STALE_CONTRACT = 0`. Los 8 endpoints que Mobile ya consumía siguen vigentes y
sus DTO no cambiaron de forma incompatible. La deriva fue de **capacidades
ausentes**, no de contratos rotos.

Se auditaron contra el código real del backend:

- `services/api/src/objectives/dto/objective.dto.ts`
- `services/api/src/objective-requirement-proposal/dto/…`
- `services/api/src/reasoning-run/dto/reasoning-run.dto.ts`
- `services/api/src/reasoning-run/reasoning-run-api.errors.ts`
- `services/api/src/objectives/objective-definition.types.ts`
- `services/api/src/objective-requirement-proposal/…contract.ts`

Constantes verificadas, no supuestas: `MAX_OBJECTIVE_CHARACTERS = 60_000`
(code points), `MAX_TITLE_LENGTH = 500`, límite de cuerpo 102 400 bytes (default
de body-parser, porque `main.ts` no configura uno).

---

## 7. Síntesis contextual del objetivo

**`CONTEXTUAL_OBJECTIVE_SYNTHESIS: AVAILABLE_AND_IMPLEMENTED`.**

El backend YA expone `synthesis` en el detalle del run
(`ObjectiveSynthesisV1ResponseDto`, `schemaVersion: objective_synthesis_v1`):
recuentos por estado, requisitos con su estado final, conclusiones positivas con
su `supportedWeakerClaim`, y las credenciales que aportan respaldo con las
referencias de requisito que sostienen.

Mobile lo **consume tal cual**. No recalcula recuentos, no deriva "fortalezas",
no escribe conclusiones nuevas y no infiere lo que falta. El único texto que se
compone en el cliente es el párrafo de encabezado, y se deriva de forma
determinista SÓLO de los recuentos que entrega el servidor — el mismo criterio
que usa Web.

Si el campo llega ausente (API anterior) o `null` (run no completado), colapsa a
`null` y no se dibuja: nunca se fabrica una síntesis.

---

## 8. Lo que se implementó

### 8.1 Núcleos puros (portables y testeables sin montar pantalla)

| Archivo | Qué resuelve |
| --- | --- |
| `features/objectives/review-draft.ts` | Conteo por code points, longitud UTF-8, corte y resaltado seguros, bandera monotónica, **la única regla de procedencia**, los dos guards de tamaño. |
| `features/objectives/use-objective-flow.ts` | Máquina de estados de la revisión (reducer puro). |
| `features/reasoning/reasoning-run-selection.ts` | Qué run mostrar, deduplicación por identidad, reconciliación del historial. |
| `features/reasoning/evidence-presentation.ts` | Qué significa la evidencia bajo cada estado final. |

### 8.2 Adaptación de contratos

`lib/adapters/verbatim.ts` aporta primitivas **verbatim**: a diferencia de
`contract.ts` (que normaliza espacios, correcto para etiquetas de perfil), acá
no se toca el contenido. `exactExcerpt`, `sourceOriginalText` y `excerpt` son
material anclado: colapsar un espacio convertiría una cita válida en una que el
servidor rechaza, o cambiaría la cita que la persona lee respecto de la que el
razonador usó.

### 8.3 Pantallas

Historial de objetivos, carga + revisión, hoja de fragmento, detalle del
objetivo, panel de análisis, tarjeta de resultado por requisito, lista de
evidencia, síntesis, y la tarjeta de entrada desde el perfil.

### 8.4 Perfil: jerarquía actualizada

- Áreas: 6 de entrada; habilidades: 12. El resto, más conceptos, información
  declarada y "Acerca de este perfil", pasan a un disclosure.
- **No hay filtrado semántico, ni ranking, ni deduplicación.** Se muestra todo,
  en el orden autoritativo del backend, en dos niveles.
- Entrada a Objetivos entre el perfil y las credenciales.
- Credenciales presentadas como "base de evidencia".

---

## 9. Decisiones nativas y sus porqués

### 9.1 El cerrojo del mismo tick

`state.phase === 'executing'` sólo se aplica en el render siguiente. Dos toques
rápidos podrían disparar dos creaciones de run — y cada una congela evidencia y
compra llamadas al proveedor. Por eso hay un `useRef` booleano que se consulta y
se marca **sincrónicamente**, antes de cualquier `setState`. Lo mismo en
"Analizar objetivo" y en "Confirmar objetivo".

Hay un test que invoca el handler dos veces en el mismo tick y verifica que sólo
se produzca **una** creación y **una** ejecución.

### 9.2 El turno de petición

Una lectura que resuelve tarde no puede pisar un resultado más nuevo. Abortar no
alcanza porque no toda capa de red honra la señal, así que cada operación saca
un turno y sólo se acepta el vigente.

### 9.3 Salir de la revisión

En Web, recargar durante la revisión dispara el diálogo nativo de
`beforeunload`. En nativo eso no existe, y **no se persiste el borrador**: la
propuesta es transitoria por contrato, y guardar el texto privado del objetivo
en el dispositivo sería crear una copia de datos privados que nadie pidió.

Lo que sí se hace: el descarte es explícito ("Volver a editar el texto") y está
avisado en pantalla. Si la aplicación se cierra durante la revisión, la revisión
se pierde. Está en las limitaciones aceptadas, §12.

### 9.4 Ejecución síncrona

El backend no tiene cola, worker ni job runner. **No se inventó** un polling, un
websocket ni una ejecución en segundo plano: se muestra un estado largo honesto,
sin porcentaje (no hay señal de progreso real que mostrar) y sin nombres de
etapas ni del proveedor.

Un run que quedó `running` no se rescata: el backend no puede distinguir "en
curso en otro dispositivo" de "interrumpido", y no admite reclamarlo. La app lo
dice y ofrece iniciar uno nuevo. No reintenta sola.

---

## 10. Frontera de privacidad

La UI nativa nunca muestra —y los modelos nunca transportan—:

`src_NN`, `eu_NN`, `sourceId`, `evidenceUnitId`, `charStart`, `charEnd`,
`sourceSha256`, `segmentId`, `artifactBlobSha256`, `storageKey`,
`selectedAnalysisRunSourceId`, `policyTrace`, `executionMetadata`, nombre del
proveedor, modelo, prompt, esfuerzo de razonamiento, `FORMATIVE_EVIDENCE`,
`failureCode` interno, ni `explanation`.

Está protegido por tests, no sólo por convención:

- el modelo adaptado se serializa y se compara contra una lista de tokens
  prohibidos;
- se inyecta un `explanation` con `src_03` y `eu_07` en la respuesta y se
  verifica que no sobreviva a la adaptación;
- se inyectan `executionMetadata` y `policyTrace` y se verifica lo mismo;
- se verifica que la pantalla completada no renderice ninguno de esos tokens;
- la categoría de fallo se traduce a lenguaje de producto y se verifica que el
  token `EVIDENCE_PREPARATION_BLOCKED` no aparezca.

---

## 11. Reglas epistemológicas, con test

| Regla | Cómo se verifica |
| --- | --- |
| Los cinco estados finales se preservan exactos; un sexto se rechaza | Adapter |
| Nunca hay porcentaje de compatibilidad, puntaje ni ranking | Pantalla completada |
| Nunca se usa lenguaje de déficit sobre la persona | Pantalla completada |
| `NOT_ASSESSABLE` **oculta** la evidencia aunque el backend la proyecte | Presentación + pantalla |
| Ningún estado de no-respaldo usa el verbo "respalda" | Presentación |
| `supportedWeakerClaim` se copia exacto y nunca se infiere | Adapter + pantalla |
| La evidencia se agrupa SÓLO por `credentialReference` | Adapter (dos credenciales con mismo título y emisor no se fusionan) |
| El estado de la credencial se presenta como ACTUAL, nunca como histórico | Pantalla |
| Editar un requisito le quita la cita, para siempre | Núcleo + pantalla |
| Reordenar no altera la procedencia | Núcleo + reducer |
| El cuerpo de creación usa el snapshot, no el formulario | Núcleo + pantalla |

---

## 12. Limitaciones aceptadas

| Limitación | Consecuencia | Dueño |
| --- | --- | --- |
| La revisión de requisitos no sobrevive a un cierre de la app | Hay que volver a analizar. Es el costo de no persistir texto privado. | `PRODUCTO` |
| La ejecución es síncrona: si la app se cierra durante el análisis, la petición se corta | El run puede quedar `running` y no se puede reclamar. La app lo explica y ofrece uno nuevo. | `BACKEND` |
| Sin ejecución en segundo plano ni notificación al terminar | Hay que mantener la app abierta. Requeriría cola + push, que el backend no tiene. | `BACKEND` + `PRODUCTO` |
| Sin compartir objetivos ni análisis | No existe contrato público para eso, y no se inventó uno. | `PRODUCTO` |
| Sin filtro por tipo de objetivo | El backend lo soporta; Web no lo usa y el volumen no lo pide. | `PRODUCTO` |
| Sin revisiones de objetivo | Diferido por producto, igual que en Web. | `PRODUCTO` |
| `expo-doctor` reporta 9 paquetes desactualizados | **Preexistente**, no de esta entrega: son parches de SDK 57 publicados después de fijar las versiones. `apps/mobile/package.json` no se tocó. | `MOBILE` |

---

## 13. Hallazgo de auditoría: tipos de ruta contaminados

`.expo/types/router.d.ts` estaba **obsoleto y contaminado**: databa del 11 de
septiembre y listaba archivos fuente de `apps/web` como si fueran rutas
(`/../../web/src/features/holder/objectives/...`). Es decir, la seguridad de
tipos de `typedRoutes` llevaba tiempo siendo incorrecta.

`expo export` **no** regenera ese archivo; lo regenera el servidor de
desarrollo. Se regeneró y quedó limpio: 4 rutas de objetivos reconocidas, 0
referencias a `apps/web`.

**Para quien siga:** si `tsc` se queja de una ruta que existe, el archivo está
viejo. Se arregla levantando `npm start` una vez.

---

## 14. Validación

| Verificación | Resultado |
| --- | --- |
| Tests de mobile | **398 / 398** en 24 suites (antes: 203 en 13) |
| Tests nuevos | **195** |
| Typecheck | Sin errores |
| Lint | Sin errores ni advertencias |
| Expo Doctor | 20 / 21 — el único fallo son los 9 parches desactualizados preexistentes |
| Rutas de Expo Router | Regeneradas y válidas |
| Export Android | 3.5 MB `.hbc` |
| Export iOS | 3.2 MB `.hbc` |
| `git diff --check` | Limpio |
| Escaneo de codificación | 0 problemas |
| Llamadas reales al proveedor | **0** |
| Acciones remotas / EAS | **0** |
| Operaciones de git | **0** |

### Alcance verificado

Comparado contra el estado del árbol al comenzar: **el único archivo modificado
fuera de `apps/mobile` es ninguno**. `package.json` y `package-lock.json` de la
raíz: sin cambios. `apps/mobile/package.json`: sin cambios —
`NEW_DEPENDENCIES = 0`.

---

## 15. Próximo paso recomendado

**Smoke controlado en dispositivo.** Todo lo automatizable está verde, pero
nada de esto se ejecutó contra el proveedor real ni se vio en un teléfono.

Orden sugerido:

1. Levantar el backend y apuntar `EXPO_PUBLIC_API_BASE_URL` a él.
2. `npm start` en `apps/mobile`, abrir con Expo Go.
3. Perfil → "Analizar un objetivo" → pegar una búsqueda laboral real.
4. Revisar los requisitos: editar uno, agregar uno, eliminar y deshacer,
   reordenar, abrir el fragmento y "Ver en el objetivo completo".
5. Confirmar y verificar que el detalle persistido coincide.
6. "Analizar mi trayectoria" y observar el estado largo hasta el resultado.
7. Verificar los estados finales, la síntesis, la evidencia y el salto a la
   credencial.
8. Probar el caso de app en segundo plano durante la ejecución, para confirmar
   que la limitación documentada se comporta como se describe.

Este paso consume llamadas reales al proveedor: conviene hacerlo una vez, con
un objetivo representativo.
