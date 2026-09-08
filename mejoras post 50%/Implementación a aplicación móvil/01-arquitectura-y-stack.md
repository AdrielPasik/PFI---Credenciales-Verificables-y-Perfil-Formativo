# Arquitectura y stack

## 1. Stack seleccionado

| Pieza | Versión | Por qué |
| --- | --- | --- |
| `expo` | `~57.0.20` | SDK estable más reciente al momento de implementar. |
| `react-native` | `0.86.3` | La versión que fija Expo SDK 57. |
| `react` | `~19.2.3` (resuelve a `19.2.8`) | Ver sección 3. |
| `expo-router` | `~57.0.19` | Enrutado por archivos, alineado al SDK. |
| `typescript` | `~6.0.3` | Misma línea que `apps/web` (`6.0.3`). |
| `@tanstack/react-query` | `5.102.8` | Estado de servidor. |
| `expo-secure-store` | `~57.0.3` | Persistencia segura del token. |
| `expo-clipboard` | `~57.0.1` | Copiar enlaces y valores técnicos. |
| `@expo-google-fonts/inter` | `0.4.2` | Inter, la tipografía de Scope. |
| `@expo/vector-icons` | `^15.0.2` | Familia de iconos única y coherente. |
| `jest-expo` + `@testing-library/react-native` | `~57.0.5` / `14.0.1` | Tests. |

Se eligió **Expo managed / Continuous Native Generation**: no hay carpetas
`android/` ni `ios/` versionadas. `npx expo prebuild` las genera cuando hacen
falta y `.gitignore` las excluye.

### Lo que deliberadamente NO se agregó

- **Redux / Zustand / MobX** — el estado remoto lo maneja TanStack Query y el
  estado local vive en el componente que lo necesita. Un store global sería una
  segunda fuente de verdad sobre datos que ya son del backend.
- **NativeWind / Tailwind** — que Web use Tailwind no obliga a Mobile a usarlo.
  Se prefirió `StyleSheet` + tokens centralizados: menos configuración, mejor
  rendimiento y ningún riesgo de incompatibilidad con el SDK.
- **Librería de UI (Paper, Tamagui, gluestack…)** — traen su propio lenguaje
  visual, que habría que pelear para que parezca Scope.
- **Librería de animaciones decorativas, de toasts o de gráficos** — ninguna
  pantalla las necesita.
- **WebView** — prohibido por diseño de producto.
- **SDK de analytics o de crash reporting** — el proyecto no adoptó ninguno; no
  se introduce uno por el solo hecho de ser mobile.
- **Storybook** — el repo no lo usa.

`react-native-reanimated`, `react-native-worklets`, `react-native-gesture-handler`
y `react-native-screens` **sí** están: son dependencias de la navegación de
Expo Router, no decoración.

## 2. Integración con el monorepo

El repositorio usa **npm workspaces** (`apps/*`, `services/*`, `packages/*`), así
que `apps/mobile` quedó incluido automáticamente: **no hizo falta tocar el
`package.json` de la raíz**.

Expo SDK 52+ detecta monorepos por su cuenta, así que **no hay `metro.config.js`
propio**. El único archivo de build propio es `babel.config.js`, y existe sólo
porque `react-native-reanimated` exige el plugin de `react-native-worklets`.

### Cambios fuera de `apps/mobile`

| Archivo | Cambio |
| --- | --- |
| `package-lock.json` | Se agregaron 769 entradas nuevas (las de mobile). |

**Ninguna dependencia preexistente cambió de versión ni se eliminó.** Está
verificado comparando el lockfile contra una copia previa a la instalación:
0 paquetes modificados, 0 eliminados.

## 3. La decisión de la versión de React (importante)

`apps/web` fija `react: "19.2.8"` exacto. Expo SDK 57 fija `react: 19.2.3`
exacto.

Si `apps/mobile` declarara `19.2.3` exacto, npm instalaría una **segunda copia**
de React anidada en `apps/mobile/node_modules/react`, mientras que
`react-native` (hoisteado en la raíz) seguiría resolviendo la copia `19.2.8`.
Dos instancias de React en la misma app rompen los hooks en runtime: el
dispatcher queda nulo. Esto se reprodujo de verdad durante la implementación
(los tests fallaban con `Cannot read properties of null (reading 'useState')`).

**Solución:** `apps/mobile` declara `react: "~19.2.3"`. El rango arranca en la
versión que pide Expo y admite `19.2.8`, así que npm resuelve **una sola copia**
compartida con Web. `react-native@0.86.3` pide `react: ^19.2.3`, que `19.2.8`
satisface.

Para que `expo-doctor` no reporte esto como desalineación, `package.json`
declara:

```json
"expo": { "install": { "exclude": ["react"] } }
```

> **Al actualizar el SDK de Expo o la versión de React en Web, revisar esta
> decisión.** Si Web y Mobile vuelven a converger en la misma versión exacta, el
> `exclude` se puede quitar. Si divergen de *minor* (no de *patch*), hay que
> resolverlo de otra forma: un `~` no alcanzaría y volvería la doble copia.

## 4. Capas

~~~
Pantalla (src/features/**/…-screen.tsx)
   |  sólo composición y estado de presentación
   v
Hook de feature (use-profile, use-credentials, use-share)
   |  TanStack Query: loading / error / refetch / mutación
   v
src/lib/api/scope-api.ts
   |  inventario de endpoints; devuelve modelos YA adaptados
   v
src/lib/adapters/*.adapter.ts
   |  valida y proyecta el payload; ninguna pantalla ve datos crudos
   v
src/lib/api/http-client.ts
   |  base URL, Bearer, JSON, timeout, categorización de errores
   v
Scope API (NestJS)
~~~

No hay ningún `fetch` suelto fuera de `http-client.ts`.

## 5. Mapa de archivos

~~~
apps/mobile/
  app/                                 rutas de Expo Router (sólo orquestan)
  assets/                              iconos, splash y lockups derivados
  scripts/generate-brand-assets.js     derivación determinística de assets
  src/
    app-shell/
      providers.tsx                    árbol de providers
      config-error-screen.tsx          arranque mal configurado
    components/ui/                     primitivas de diseño genéricas
      badge.tsx  button.tsx  content-lists.tsx  screen.tsx
      states.tsx  surfaces.tsx  text.tsx  text-field.tsx
    features/
      auth/        login-screen, account-menu-button
      profile/     profile-screen, profile-panel, use-profile
      credentials/ credentials-screen, credential-detail-screen,
                   credential-card, use-credentials, holder-error-mapper
      sharing/     share-action, share-links, use-share
    lib/
      adapters/    contract.ts (primitivas), holder / auth / profile-sharing
      api/         http-client.ts, scope-api.ts
      auth/        session-provider, session-storage, auth-error-mapper
      config/      app-config, app-config-provider
      format/      display.ts (fechas, números, etiquetas de dominio)
      errors/      api-error.ts
      query/       query-client.ts
      theme/       tokens.ts
    types/         auth.ts, holder.ts, sharing.ts
    test/          setup, fixtures, http (stubs), render (helper)
  app.config.ts  babel.config.js  eas.json  eslint.config.mjs
  jest.config.js  package.json  tsconfig.json  .env.example
~~~

### Reglas de organización

- **Las rutas orquestan, no implementan.** Ninguna ruta de `app/` pasa de ~30
  líneas; la lógica de pantalla vive en `src/features` para que se pueda testear
  sin montar el router.
- **`src/components/ui` es genérico**; nada ahí sabe de credenciales ni perfiles.
- **`src/features/<dominio>`** contiene lo específico de cada capacidad.

## 6. Estado de servidor

`TanStack Query` con estos valores por defecto (`src/lib/query/query-client.ts`):

| Opción | Valor | Motivo |
| --- | --- | --- |
| `staleTime` | 60 s | Cambiar de pestaña no dispara peticiones nuevas. |
| `gcTime` | 5 min | Volver atrás desde un detalle es instantáneo. |
| `refetchOnWindowFocus` | `false` | Evita ráfagas al volver del segundo plano. |
| `refetchOnReconnect` | `true` | Recuperar conexión sí justifica refrescar. |
| `retry` (queries) | red / timeout / 5xx, máx. 2 | Ver abajo. |
| `retry` (mutaciones) | `false` | Nunca repetir un efecto que nadie pidió dos veces. |

`shouldRetry` **no reintenta** 401, 403, 404, errores de validación ni payloads
incompatibles: insistir no arregla ninguno de esos casos y multiplica peticiones.

Claves de consulta (`queryKeys`):

- perfil: `['holder', 'profile', 'current']`
- lista: `['holder', 'credentials']`
- detalle: `['holder', 'credentials', <referencia>]`

Al cerrar sesión se ejecuta `queryClient.clear()`: los datos personales del
titular no sobreviven al logout.

## 7. Estado local

`useState` dentro del componente para: la sección de integridad plegada, la
visibilidad del menú de cuenta, la visibilidad de la contraseña, los inputs del
formulario y el feedback transitorio de "copiado".

## 8. Configuración de entorno

`src/lib/config/app-config.ts` es el **único** lugar del proyecto que lee
`process.env`. Valida las dos variables con el mismo criterio que Scope Web
(http/https, sin credenciales, sin query, sin fragmento) y las expone por
contexto.

| Variable | Para qué |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Backend NestJS. Único servicio que consume la app. |
| `EXPO_PUBLIC_WEB_BASE_URL` | Base pública de Scope Web, para armar enlaces compartibles. |

Si falta o es inválida, la app arranca en `ConfigErrorScreen`: en desarrollo
muestra la variable y el motivo exactos; en producción, un mensaje genérico.
**Nunca** cae en silencio a `localhost`.

Cambiar de proveedor de hosting en el futuro (Render, AWS, lo que sea) sólo
requiere cambiar estas variables. Ninguna pantalla conoce una URL.

## 9. Árbol de providers

~~~
SafeAreaProvider        insets de notch / barra de estado / home indicator
  AppConfigProvider     URLs ya validadas
    QueryClientProvider estado de servidor
      SessionProvider   sesión (necesita el QueryClient para limpiarlo al salir)
        Stack (Expo Router)
~~~

El orden importa: `SessionProvider` va **dentro** de `QueryClientProvider`
porque el logout limpia la caché de consultas.

## 10. Seguridad

- La app no contiene **ningún** secreto. `EXPO_PUBLIC_*` es configuración
  pública por definición y queda embebida en el bundle.
- Sin claves privadas, sin firmante de blockchain, sin claves de proveedor de
  IA, sin credenciales de base de datos ni de storage.
- La contraseña **nunca** se persiste. El token va a `expo-secure-store`
  (Keychain / Keystore), nunca a `AsyncStorage`.
- Ni el perfil ni las credenciales se persisten en disco: viven sólo en la
  caché en memoria de TanStack Query.
- La app no pide **ningún** permiso de dispositivo. Compartir una URL no lo
  requiere.
- Regla de lint: `no-console` como error (se permiten `warn` y `error`), para
  que no se filtren tokens ni datos personales a los logs de producción.
