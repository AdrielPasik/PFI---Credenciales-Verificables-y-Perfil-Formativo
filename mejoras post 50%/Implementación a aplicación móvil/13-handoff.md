# Handoff — continuá desde acá

## 1. Dónde está todo

| Qué | Dónde |
| --- | --- |
| Código de la app | `apps/mobile/` |
| Esta documentación | `mejoras post 50%/Implementación a aplicación móvil/` |
| Backend que consume | `services/api/` (**sólo lectura para este trabajo**) |
| Referencia de producto | `apps/web/src/features/holder/` (**no modificar**) |
| Logos aprobados | `apps/web/public/brand/` |

## 2. Correrla en cinco minutos

**1. Instalar dependencias** (desde la raíz del repo):

```bash
npm install
```

**2. Configurar el entorno:**

```bash
cd apps/mobile && cp .env.example .env
```

Editar `apps/mobile/.env`:

| Escenario | `EXPO_PUBLIC_API_BASE_URL` |
| --- | --- |
| Emulador Android | `http://10.0.2.2:3001` |
| Simulador iOS | `http://127.0.0.1:3001` |
| Teléfono físico | `http://<IP-de-tu-PC>:3001` |
| API pública desplegada | `https://<host-público-del-api>` |

`EXPO_PUBLIC_WEB_BASE_URL` apunta a Scope Web (mismo host, puerto 3000 en local).

**3. Levantar el backend** en otra terminal (`services/api`, puerto 3001). Para
un teléfono físico tiene que escuchar en `0.0.0.0`, no sólo en `127.0.0.1`.

**4. Levantar la app:**

```bash
cd apps/mobile && npm start
```

Para otra red o una LAN bloqueada:

```bash
cd apps/mobile && npm run start:tunnel
```

El tunnel conecta Expo Go con Metro; no reemplaza `EXPO_PUBLIC_API_BASE_URL`.
Antes de probar login contra una API pública se puede ejecutar:

```bash
cd apps/mobile && npm run check:api
```

Un `401` de ese probe sin token significa que la API está alcanzable.

**5. Abrirla:** `a` para Android, `i` para iOS, o escanear el QR con Expo Go.

> Si cambiás `.env`, reiniciá con `npx expo start --clear`: las variables
> `EXPO_PUBLIC_*` se embeben en tiempo de bundling.

## 3. Comandos

Todos desde `apps/mobile/`.

```bash
npm start
```

```bash
npm run start:clear
```

```bash
npm run start:tunnel
```

```bash
npm run check:api
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run doctor
```

```bash
npm run export
```

## 4. Los archivos que importan

Si vas a tocar algo, empezá por estos.

| Archivo | Por qué importa |
| --- | --- |
| `src/lib/theme/tokens.ts` | **Todo** el diseño. Ningún componente escribe un color literal. |
| `src/lib/api/http-client.ts` | Toda la red pasa por acá. No hay `fetch` suelto. |
| `src/lib/api/scope-api.ts` | Inventario completo de endpoints. |
| `src/lib/adapters/holder.adapter.ts` | Adaptación de contratos. **El archivo más delicado.** |
| `src/lib/adapters/contract.ts` | Primitivas de validación y sus tolerancias. |
| `src/lib/auth/session-provider.tsx` | Todo el ciclo de vida de la sesión. |
| `src/lib/config/app-config.ts` | Único lugar que lee `process.env`. |
| `src/lib/query/query-client.ts` | Política de caché y reintentos. |
| `app/(holder)/_layout.tsx` | Guardia de navegación. |
| `src/features/profile/profile-screen.tsx` | Pantalla principal. |
| `src/features/credentials/credential-detail-screen.tsx` | La pantalla más densa. |
| `src/test/fixtures.ts` | Fixtures centralizadas, incluidos los casos límite. |
| `app.config.ts` | Identificadores de tienda (**provisionales**), icono, splash. |
| `eas.json` | Perfiles de build. |

## 5. Cómo agregar una capacidad

1. Leer `12-protocolo-de-sincronizacion-holder.md`.
2. Registrar la ficha de capacidad.
3. Decidir el estado de paridad.
4. Implementar de adentro hacia afuera: tipo → adaptador → endpoint → hook →
   pantalla → ruta.
5. Tests: adaptador + pantalla + regla de producto.
6. Actualizar el ledger y los documentos afectados.

## 6. Reglas que no se negocian

Se rompieron proyectos por menos.

| Regla | Por qué |
| --- | --- |
| **No importar nada de `apps/web`** | Invertiría la dirección de dependencia. |
| **No modificar el backend desde este trabajo** | Regla explícita del encargo. |
| **No hardcodear una URL en una pantalla** | Todo pasa por `app-config`. |
| **No persistir la contraseña, nunca** | Ni "para recordar el usuario". |
| **No poner secretos en `EXPO_PUBLIC_*`** | Quedan legibles en el APK. |
| **No renderizar contenido declarado como chip** | Llega a 500 caracteres. Es el bug que Web ya tuvo. |
| **No inventar puntajes ni métricas** | Sólo se muestra lo que el backend provee. |
| **No mezclar lo declarado con lo interpretado por IA** | Es el núcleo epistemológico del producto. |
| **No agregar superficies de emisor** | Scope Mobile es holder-only. |
| **No usar WebView** | La verificación pública se abre en el navegador. |
| **No llamar a la IA, la blockchain o el storage** | Sólo se habla con Scope API. |
| **No colapsar los errores en "No encontrado"** | Cada categoría tiene su mensaje. |
| **No confundir refrescar con actualizar** | Refrescar lee; actualizar recompone. |

## 7. Lo primero que hay que hacer

En orden.

**1. Generar el APK para la demo** (bloqueado sólo por configuración, ver
`10-plan-de-deployment.md` §I):

```bash
npm install --global eas-cli
```

```bash
eas login
```

```bash
cd apps/mobile && eas init
```

Después reemplazar los `"SET_ME"` del perfil `preview` en `eas.json` y:

```bash
cd apps/mobile && eas build --platform android --profile preview
```

**2. Probar en un Android real** con la matriz de `09-testing-y-calidad.md`.

**3. Confirmar el identificador de tienda.** `com.scope.holder` es
**PROVISIONAL** y después de publicar no se puede cambiar.

**4. Resolver el borrado de cuenta antes de publicar en tiendas** (`11-brechas`, P-01). El registro Holder nativo ya está disponible.

**5. Evaluar la vida del JWT** (`11-brechas`, B-01): 1 h sin refresh es molesto
en una app.

## 8. Estado de verificación

| Verificación | Resultado |
| --- | --- |
| Tests de mobile | 222/222 en 15 suites; incluye registro, conectividad e identidad humana. |
| Typecheck de mobile | Sin errores |
| Lint de mobile | Sin errores ni advertencias |
| Expo Doctor | 21/21 |
| Export Android | 3.3 MB `.hbc` |
| Export iOS | 3.1 MB `.hbc` |
| Typecheck de Web | Sin errores |
| Tests de Web | 830/832 — los 2 fallos son **preexistentes** en tests de plantillas reutilizables del emisor, sin relación con este trabajo |
| Backend / AI / Prisma / migraciones | **Sin ningún cambio** |
| Holder Web / Issuer Web | **Sin ningún cambio** |
| Dependencias preexistentes | **0 cambiadas, 0 eliminadas** |

## 9. Documentación relacionada

| Documento | Para qué |
| --- | --- |
| `docs/frontend/scope-holder-mobile-app-blueprint-v1.md` | Razonamiento de producto previo. Vale como contexto; la implementación manda cuando difieren. |
| `docs/frontend/scope-holder-mobile-handoff-v0.md` | Histórico. |
| `docs/frontend/frontend-brand-and-design-system-v1.md` | Marca compartida. |
| `docs/frontend/scope-product-positioning-v1.md` | Posicionamiento. |

## 10. Preguntas frecuentes

**¿Por qué no hay carpetas `android/` ni `ios/`?**
Expo las genera cuando hacen falta (`npx expo prebuild`). Versionarlas obligaría
a mantener código nativo a mano.

**¿Por qué `react` está en `~19.2.3` si Expo pide `19.2.3`?**
Para que el monorepo resuelva **una sola** copia de React. Ver ADR-02 en
`08-registro-de-implementacion.md`. Es la decisión más sutil de toda la entrega.

**¿Por qué Jest usa `forceExit`?**
El runtime de RN deja handles abiertos al terminar. Es un artefacto de teardown
que no afecta a los resultados. Ver `11-brechas`, M-01.

**¿Por qué compartir una credencial no llama a ningún endpoint?**
Porque no existe. El enlace público es la vista de verificación de Scope Web para
esa referencia, exactamente como en Holder Web.

**¿Por qué la app necesita dos URLs?**
`/me/profile/share` devuelve una **ruta**, no una URL. Web la completa con
`window.location.origin`, que en una app nativa no existe.

**¿Por qué no hay modo oscuro?**
Scope Web no define uno completo. Un modo oscuro a medias es peor que ninguno.

**¿Puedo usar Expo Go para la demo?**
Sí, todo funciona. Pero se ve como "Expo" en el lanzador: sin icono ni splash de
Scope. Para eso hace falta el APK de preview.

**¿Se puede publicar en las tiendas hoy?**
No. Faltan identificadores confirmados, cuentas, fichas, política de privacidad y
QA en dispositivos reales. Ver `10-plan-de-deployment.md` §X.
