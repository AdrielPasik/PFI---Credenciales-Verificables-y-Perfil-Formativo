# Registro de implementación

## 1. Fases ejecutadas

| Fase | Qué se hizo |
| --- | --- |
| 0 — Descubrimiento | Auditoría de sólo lectura del monorepo, Holder Web, contratos del backend, marca y documentación mobile previa. |
| 1 — Fundación | `apps/mobile` con Expo SDK 57, Expo Router, TypeScript estricto, tokens, fuentes, providers, entorno, tests, lint. |
| 2 — Sesión | Restauración, login, registro Holder, guardia de navegación, logout, `expo-secure-store`. |
| 3 — API y contratos | Cliente HTTP, adaptadores, inventario de endpoints, tests de contrato. |
| 4 — Navegación | Pestañas Perfil / Credenciales + stack de detalle. |
| 5 — Perfil | Panel completo, cobertura, taxonomía, procedencia, contenido declarado. |
| 6 — Credenciales | Biblioteca con `FlatList` y detalle completo. |
| 7 — Compartir | Share sheet nativo para perfil y credencial. |
| 8 — Actualizar perfil | Mutación de recomposición + escritura en caché. |
| 9 — Calidad | Contenido largo, errores, vacíos, accesibilidad, tamaños, áreas seguras, teclado. |
| 10 — Expo / EAS | `app.config.ts`, `eas.json`, assets de marca. **Sin acciones en la nube.** |
| 11 — Documentación | Esta carpeta. |
| 12 — Validación | Tests, typecheck, lint, Expo Doctor, export de bundles, diff, codificación. |
| 13 — Auditoría final | Ledger de paridad y brechas. |

## 2. Hallazgos del descubrimiento

| Hallazgo | Consecuencia |
| --- | --- |
| El repo usa **npm workspaces** con `apps/*`. | `apps/mobile` se integró sin tocar el `package.json` de la raíz. |
| La autenticación es **JWT Bearer sin cookies ni CSRF**. | Reutilizable tal cual desde un cliente nativo. Caso A del árbol de decisión. |
| `JWT_EXPIRES_IN` por defecto **`1h`**, sin refresh. | Documentado como límite; no se tocó el backend. |
| `/me/*` sólo exige `AuthGuard`; **no hay rol holder**. | No existe el caso "autenticado sin acceso de titular"; no se inventó una pantalla para él. |
| **Compartir una credencial no tiene endpoint.** Web arma `/verify?credential=<ref>` en el cliente. | Mobile reproduce exactamente la misma semántica. |
| `POST /me/profile/share` devuelve una **ruta**, no una URL. Web la completa con `window.location.origin`. | Mobile necesita `EXPO_PUBLIC_WEB_BASE_URL`. |
| `packages/shared-types` **está vacío** (sólo `package.json` y `README`). | No hay contrato compartido reutilizable; la adaptación se duplicó a propósito. |
| El adaptador de Holder Web contiene **compatibilidades ganadas en incidentes reales**. | Se replicaron todas desde el día uno en Mobile. |
| `mejoras post 50%/` está en `.gitignore`. | La subcarpeta `Implementación a aplicación móvil/**` tiene una excepción explícita y queda versionada; el resto del área continúa ignorado. |
| Existen dos documentos de planificación mobile previos. | Se marcaron en su encabezado como superados por la implementación. |

## 3. Registros de decisión

### ADR-01 — Expo managed en vez de React Native CLI

**Contexto.** Se necesitaba desarrollo local simple, un APK fácil y una ruta
clara a las tiendas, sin mantener proyectos nativos.
**Alternativas.** RN CLI con `android/` e `ios/` versionados; Expo con prebuild
permanente.
**Decisión.** Expo managed con Continuous Native Generation.
**Consecuencias.** Sin carpetas nativas en el repo; `eas build` produce el APK
sin Android Studio; las librerías tienen que ser compatibles con Expo (todas las
elegidas lo son).

### ADR-02 — `react: "~19.2.3"` en vez de `19.2.3` exacto

**Contexto.** Web fija `19.2.8` exacto y Expo SDK 57 fija `19.2.3` exacto. Con
ambos exactos, npm anida una segunda copia de React y los hooks se rompen: se
reprodujo en los tests.
**Alternativas.** `overrides` en la raíz (tocaría Web); dejar la doble copia
(app rota); mover React de Web (fuera de alcance).
**Decisión.** Rango `~19.2.3` + `expo.install.exclude: ["react"]`.
**Consecuencias.** Una sola copia de React (`19.2.8`, dentro del peer `^19.2.3`
de RN 0.86.3). Hay que revisar en cada upgrade de SDK.

### ADR-03 — TanStack Query en vez de un store propio

**Contexto.** Perfil, credenciales y detalle son estado remoto con carga, error,
refetch e invalidación.
**Alternativas.** `useState` + `useEffect` (como Holder Web); Redux.
**Decisión.** TanStack Query.
**Consecuencias.** Menos código repetido, caché entre pantallas, política de
reintento explícita. Una dependencia más.

### ADR-04 — `StyleSheet` + tokens en vez de NativeWind

**Contexto.** Web usa Tailwind.
**Decisión.** `StyleSheet` con tokens centralizados.
**Consecuencias.** Cero configuración de build extra y ningún riesgo de
incompatibilidad con el SDK. Los valores de marca se replican en `tokens.ts` y
hay que sincronizarlos a mano si la marca cambia.

### ADR-05 — Share sheet nativo en vez del panel de Web

**Contexto.** Holder Web despliega un panel con campos de sólo lectura y botones
de copiar.
**Decisión.** Botón que abre el share sheet del sistema, más "Copiar enlace" y
"Ver vista pública" como acciones secundarias.
**Consecuencias.** Interacción que la gente ya conoce. Es `MOBILE-ADAPTED`, no
una brecha de paridad.

### ADR-06 — Adaptación de contratos duplicada

**Contexto.** `apps/mobile` no puede importar de `apps/web`, y no existe un
paquete neutral.
**Decisión.** Reimplementar la adaptación en Mobile, replicando todas las
tolerancias probadas de Web.
**Consecuencias.** Dos lugares que actualizar ante un cambio de contrato. Se
mitiga con el protocolo de sincronización y con la batería de tests de tortura.

### ADR-07 — Tema claro únicamente en v1

**Contexto.** Scope Web no define un tema oscuro completo.
**Decisión.** `userInterfaceStyle: 'light'`.
**Consecuencias.** Consistencia garantizada. El modo oscuro queda como trabajo
futuro con su propio diseño.

### ADR-08 — Integridad plegable

**Contexto.** El detalle es denso y en una pantalla angosta los bloques técnicos
empujan el contenido formativo fuera de vista.
**Decisión.** Plegar **sólo** la evidencia de integridad, cerrada por defecto.
**Consecuencias.** Ninguna información formativa queda escondida; lo técnico
sigue disponible a un toque.

### ADR-09 — Sin registro de cuenta en la app (**supersedido por ADR-10**)

**Contexto.** `POST /auth/register` existe y funciona.
**Decisión.** No exponerlo en Mobile en v1.
**Consecuencias.** Una persona nueva necesita la web para crear su cuenta.

### ADR-10 — Registro Holder nativo y timeout de autenticación acotado

**Decisión.** Mobile consume el contrato existente `POST /auth/register` con
nombre, apellido, email y contraseña; el `201` activa la misma sesión
SecureStore que login. La confirmación de contraseña es sólo local.

**Conectividad.** La URL pública del API se obtuvo del bundle público de Scope
Web. Una medición de `GET /auth/me` sin token confirmó `401` tras 22,755 ms en
frío y 234/226 ms luego. Por eso autenticación usa 45 s y el resto del Holder
mantiene 20 s. No se modificó el backend.

**Consecuencia.** Se agrega el gap de borrado de cuenta antes de tiendas; no
bloquea la demo ni Expo Go.
Registrado como brecha de PRODUCTO, no técnica.

### ADR-11 — `forceExit` en Jest

**Contexto.** El runtime de React Native que monta `jest-expo` deja handles
abiertos y Jest se cuelga tras reportar resultados. `--detectOpenHandles` no
identifica el origen. Sólo ocurre en suites que montan componentes.
**Alternativas.** Dejar que cuelgue (rompe CI); perseguir el handle dentro de
`react-native`/`jest-expo` (fuera de alcance).
**Decisión.** `forceExit: true` en `jest.config.js`, comentado.
**Consecuencias.** Es un artefacto de **teardown**: no afecta resultados ni
oculta fallos. Registrado como brecha POLISH.

### ADR-12 — Presentar la identidad humana mediante `displayLabel`

**Contexto.** El contrato de auth y el detalle de credencial ya entregan una
proyección canónica `displayLabel`, pero Mobile no la presentaba en el Perfil y
el detalle priorizaba el correo.
**Decisión.** Consumir `displayLabel` sin recomputarlo: contexto breve en Perfil,
jerarquía `displayLabel` → email → DID en menú y `subject.displayLabel` primario
en el detalle de credencial.
**Consecuencias.** Los usuarios legacy sin nombre siguen viendo el correo una
sola vez; completar su identidad requiere un endpoint futuro de autoedición.

## 4. Bitácora de problemas y soluciones

| Problema | Causa | Solución |
| --- | --- | --- |
| `Cannot read properties of null (reading 'useState')` en los tests | Dos copias de React en el monorepo | ADR-02. |
| `npm dedupe` cambió 21 paquetes preexistentes (incluido `zod` de v4 a v3) | `dedupe` reescribe resoluciones de todo el árbol | Se restauró el lockfile original y se reinstaló limpio. Resultado: **0 paquetes preexistentes modificados**. |
| `edgeToEdgeEnabled` y `newArchEnabled` rechazados por el typecheck | En SDK 57 el edge-to-edge y la Nueva Arquitectura son el comportamiento único | Se eliminaron ambas claves. |
| `StatusBar backgroundColor` rechazado | La API de `expo-status-bar` cambió | Se quitó la prop. |
| `@expo/vector-icons` no resolvía | En SDK 57 es un paquete aparte | `npx expo install @expo/vector-icons`. |
| `result` indefinido en `renderHook` | En RNTL 14 `render` y `renderHook` son **asíncronos** | Se esperan siempre. |
| `You seem to have overlapping act() calls` | En RNTL 14 `fireEvent` también es asíncrono | Todo `fireEvent` se espera. |
| Stubs de red desincronizados al reintentar una consulta | El stub secuencial dependía del orden de montaje | Se agregó `createRoutedFetchStub`, enrutado por `MÉTODO /ruta`. |
| Caracteres de control literales en `contract.ts` | La regex se escribió con los bytes reales | Se reescribió con secuencias de escape. Verificado: 0 bytes de control en el archivo. |
| `expo-doctor` reportaba React desalineado | ADR-02 | `expo.install.exclude: ["react"]`. Doctor: **21/21**. |
| Tipos de Jest ausentes en el typecheck | `expo/tsconfig.base` acota `types` | `"types": ["jest", "node"]`. |
| `__dirname` marcado como indefinido por ESLint | `eslint-config-expo` asume runtime RN | Override para `scripts/**/*.js`. |

## 5. Archivos creados

**Configuración (10):** `package.json`, `tsconfig.json`, `app.config.ts`,
`babel.config.js`, `jest.config.js`, `eslint.config.mjs`, `eas.json`,
`.gitignore`, `.env.example`, `scripts/generate-brand-assets.js`; y tooling de
conectividad: `scripts/check-connectivity.js` y `scripts/start-tunnel.js`.

**Rutas (9):** `app/_layout.tsx`, `app/index.tsx`, `app/login.tsx`, `app/register.tsx`,
`app/(holder)/_layout.tsx`, `app/(holder)/(tabs)/_layout.tsx`,
`app/(holder)/(tabs)/index.tsx`, `app/(holder)/(tabs)/credentials.tsx`,
`app/(holder)/credentials/[credentialId].tsx`.

**Fuente:** incluye `features/auth/register-screen.tsx`, el probe de
conectividad y la extensión de sesión/API para registro, además de las capas
preexistentes.

**Tests (15 suites, 222 casos)** y utilidades de test (4), incluidos registro,
conectividad.

**Assets (6):** icono, icono adaptativo, splash, dos lockups y el manifiesto de
procedencia.

## 6. Archivos modificados fuera de `apps/mobile`

| Archivo | Cambio |
| --- | --- |
| `package-lock.json` | +769 entradas nuevas. **0 preexistentes modificadas o eliminadas.** |
| `docs/frontend/scope-holder-mobile-app-blueprint-v1.md` | Nota de estado en el encabezado apuntando a esta carpeta. |
| `docs/frontend/scope-holder-mobile-handoff-v0.md` | Nota de estado en el encabezado apuntando a esta carpeta. |

**Sin cambios:** `services/api/**`, `services/ai-service/**`, Prisma, migraciones,
`apps/web/src/**`, `packages/**`, `README.md` de la raíz y `package.json` de la
raíz. `.gitignore` se ajustó únicamente para versionar la excepción documental
Mobile dentro de un área que sigue ignorada en general.

## 7. Dependencias agregadas

**Runtime (20):** `expo`, `expo-router`, `expo-constants`, `expo-linking`,
`expo-splash-screen`, `expo-status-bar`, `expo-system-ui`, `expo-font`,
`expo-secure-store`, `expo-clipboard`, `@expo/vector-icons`,
`@expo-google-fonts/inter`, `@tanstack/react-query`, `react`, `react-native`,
`react-native-safe-area-context`, `react-native-screens`,
`react-native-gesture-handler`, `react-native-reanimated`,
`react-native-worklets`.

**Desarrollo (9):** `typescript`, `@types/react`, `@types/jest`, `jest`,
`jest-expo`, `@testing-library/react-native`, `eslint`, `eslint-config-expo` y
`expo-doctor`.

Todas verificadas como compatibles con Expo SDK 57 (`expo-doctor` 21/21).
