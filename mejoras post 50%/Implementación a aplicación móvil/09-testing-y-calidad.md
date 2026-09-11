# Testing y calidad

## 1. Resultado actual

~~~
Test Suites: 15 passed, 15 total
Tests:      222 passed, 222 total
Time:       ~15 s
~~~

| Verificación | Comando | Resultado |
| --- | --- | --- |
| Tests | `npm test` | 222/222 verde |
| Tipos | `npm run typecheck` | Sin errores |
| Lint | `npm run lint` | Sin errores ni advertencias |
| Expo Doctor | `npm run doctor` | 21/21 |
| Bundle Android | `npm run export` | 3.3 MB `.hbc` |
| Bundle iOS | `npm run export:ios` | 3.1 MB `.hbc` |

## 2. Herramientas

| Pieza | Elección | Por qué |
| --- | --- | --- |
| Runner | `jest-expo` (preset oficial del SDK) | Transformación, mocks nativos y entorno RN listos. |
| Componentes | `@testing-library/react-native` 14 | Consultas accesibles antes que detalles de implementación. |
| Red | Stub propio (`src/test/http.ts`) | **Ningún test toca la red real.** |
| Fixtures | `src/test/fixtures.ts` | Centralizadas: nada de payloads gigantes copiados en veinte archivos. |

> **Trampa de la versión 14 de RNTL:** `render`, `renderHook` y `fireEvent` son
> **asíncronos**. Hay que esperarlos siempre; si no, aparecen `act()` solapados
> y fallos difíciles de leer. Está anotado en `src/test/render.tsx`.

## 3. Estrategia de mocks

`src/test/setup.ts` simula sólo los módulos nativos que el preset no cubre y que
la app usa de verdad: `expo-secure-store` (con un Map en memoria que se limpia
entre tests), `expo-clipboard`, `expo-font`, `@expo-google-fonts/inter` y
`expo-router`.

La red se inyecta:

- `createFetchStub(...)` — secuencial, para los tests del cliente HTTP donde el
  **orden** es lo que se verifica.
- `createRoutedFetchStub({ 'GET /me/credentials': ... })` — enrutado por
  `MÉTODO /ruta`, para los tests de pantalla. No se desincroniza cuando cambia el
  orden de montaje de los hooks ni cuando una consulta se reintenta, y **una ruta
  no declarada devuelve 404**, así que ningún test pasa por accidente contra un
  endpoint que no esperaba.

`renderWithProviders` monta el árbol real de providers (`SafeAreaProvider`,
`AppConfigProvider`, `QueryClientProvider`, `SessionProvider`) con red simulada,
sesión ya autenticada y reintentos desactivados.

## 4. Cobertura por categoría

| Categoría | Suite | Casos |
| --- | --- | --- |
| A — Sesión y autenticación | `lib/auth/session-provider.test.tsx` | 15 |
| B — Protección de navegación | Cubierta en A y en el menú de cuenta | — |
| C — Perfil | `features/profile/profile-screen.test.tsx` | 23 |
| D — Lista de credenciales | `features/credentials/credentials-screen.test.tsx` | 10 |
| E — Detalle de credencial | `features/credentials/credential-detail-screen.test.tsx` | 22 |
| F/G — Compartir perfil y credencial | En C y E, más `features/sharing/share-links.test.ts` | 10 |
| H — Actualizar perfil | En C | 6 |
| I — Estados de error | Repartidos en C, D, E y A | — |
| J — Contenido largo | `lib/adapters/holder.adapter.test.ts` + C + E | — |
| K — Restricción holder-only | `lib/api/scope-api.test.ts` + menú de cuenta | — |
| L — Adaptación de contratos | `lib/adapters/holder.adapter.test.ts` | 38 |
| M — Logout | `features/auth/account-menu-button.test.tsx` | 6 |
| Cliente HTTP | `lib/api/http-client.test.ts` | 14 |
| Inventario de endpoints | `lib/api/scope-api.test.ts` | Incluye `POST /auth/register` |
| Configuración de entorno | `lib/config/app-config.test.ts` | URL pública HTTPS, emulador, LAN, barra final, URL rota y `SET_ME` |
| Formateadores | `lib/format/display.test.ts` | 14 |
| Política de reintentos | `lib/query/query-client.test.ts` | 12 |
| Acceso | `features/auth/login-screen.test.tsx` | 13 |
| Registro Holder | `features/auth/register-screen.test.tsx` | Validación, confirmación local, payload seguro, limpieza de contraseñas y duplicados |
| Conectividad | `lib/api/connectivity-probe.test.ts` | `401` como alcance, timeout y red sin mutar sesión |
| Identidad humana | Perfil, menú de cuenta y detalle de credencial | `displayLabel` canónico, email no duplicado, fallback legacy, contenido largo y sesión tras registro |

## 5. Tests de tortura de contrato

Existen para que Mobile no repita el incidente de contrato que tuvo Holder Web.

| Caso | Verificado |
| --- | --- |
| Competencia declarada de **exactamente 500** caracteres | Se conserva íntegra y se renderiza sin `numberOfLines`. |
| Resultado de aprendizaje de 500 caracteres | Idem. |
| Hash canónico largo | Se conserva completo; la abreviatura es sólo presentación. |
| DID largo (117 caracteres) | Se conserva íntegro. |
| `txHash` largo | Se conserva completo (necesario para copiarlo). |
| Descriptores semánticos como objeto (`{area}`, `{skill_label}`, `{name}`) | Aceptados junto a los strings, mezclados en el mismo array. |
| Evidencia documental **ausente** del payload | Tratada como "no hay", no como error. |
| Evidencia textual ausente | Idem. |
| Evidencia declarada explícitamente `null` | Idem. |
| Alias `snake_case` en `credentialSubject` | Leídos correctamente. |
| Alias vigente en `null` | **No** cae al histórico. |
| `areasSummary` / `skillsSummary` (perfil histórico) | Leídos. |
| `narrative` / `concepts` / `emitted*` dentro de `profileJson` | Leídos. |
| `confidence` como `{ score }` | Leído. |
| `emittedCompetencies` como `{ label }` | Leído. |
| Contadores de cobertura ausentes | `null`, sin fabricar un "0". |
| `provenanceSummary` malformado | Degrada a `null` sin tirar abajo el perfil. |
| 31 entradas declaradas | Rechazado. |
| Entrada de 501 caracteres | Rechazado. |
| Tipo o estado de credencial desconocido | Rechazado. |
| Hash con formato inválido | Rechazado. |
| URL externa `javascript:` | Rechazada. |
| Confianza fuera de `[0, 1]` | Rechazada. |
| Usuario con `status` distinto de `active` | Rechazado. |
| Los 4 tipos de credencial | Los 4 se muestran. |
| Credencial revocada | Legible y navegable, con su contenido intacto. |

## 6. Tests de reglas de producto

Además de "funciona", se verifica que **no** haga cosas que no debe:

| Regla | Test |
| --- | --- |
| No se inventan puntajes | Se verifica que no aparezcan "puntaje", "nivel experto" ni "empleabilidad". |
| La confianza es del análisis, no de la persona | Se verifica el copy exacto. |
| No hay acciones de emisor | Ni "crear credencial" ni "emitir" en ningún estado vacío. |
| No hay superficies institucionales | El menú de cuenta no muestra membresías de emisor aunque existan. |
| El modelo de usuario no filtra datos de emisor | Se verifica que no contenga la cadena `issuer`. |
| El acceso es holder-only | Registro Holder nativo, sin recuperación de contraseña, SSO ni mensajería institucional. |

## Actualización 01.3 — conectividad y registro

Las suites de registro y conectividad ya están integradas en la tabla de
cobertura. El probe usa `GET /auth/me` sin token: un `401` confirma alcance sin
alterar la sesión.

| Regla | Test |
| --- | --- |
| Actualizar perfil no se dispara solo | Ni al montar, ni al refrescar. |
| Compartir no se dispara solo | No se genera un enlace al montar la pantalla. |
| Compartir no duplica el share | Tres acciones → una sola llamada. |
| Compartir una credencial no llama al backend | Se verifica que el conteo de peticiones no cambie. |
| La contraseña nunca se persiste | Se verifica el almacenamiento tras el login. |
| La contraseña se limpia del formulario | Se verifica tras cada intento. |
| Un 403 no cierra la sesión | Se verifica que el token sobreviva. |
| Un error de red no destruye la sesión | Se verifica que el token sobreviva. |
| El error del servidor no se filtra a la UI | Se verifica con un cuerpo que contiene datos sensibles. |
| El contenido largo no se trunca | Se verifica que `numberOfLines` sea `undefined`. |
| La vista pública se abre afuera | Se verifica la llamada a `Linking.openURL`. |
| Sólo se abren URLs http(s) | `javascript:` y `file:` rechazadas. |

## 7. Matriz de prueba manual

Estos son los casos que **no** cubre la suite automática. Ejecutar antes de una
demo o una release.

### Android (dispositivo físico)

| # | Caso | Esperado |
| --- | --- | --- |
| 1 | Abrir con sesión válida | Splash → Perfil, sin destello de acceso. |
| 2 | Abrir sin sesión | Splash → Acceso. |
| 3 | Login correcto | Va a Perfil. |
| 4 | Login incorrecto | Mensaje de credenciales; la contraseña se limpia. |
| 5 | Login sin conexión | Mensaje de red, distinto del anterior. |
| 6 | Pull-to-refresh en Perfil | Refresca; **no** reconstruye. |
| 7 | Actualizar perfil | Indicador y perfil actualizado. |
| 8 | Compartir perfil | Se abre el share sheet de Android. |
| 9 | Copiar enlace | Confirmación "Enlace copiado." |
| 10 | Ver vista pública | Abre el navegador con la vista pública. |
| 11 | Abrir una credencial | Va al detalle. |
| 12 | Botón físico "atrás" | Vuelve a la lista de origen. |
| 13 | Desplegar integridad | Muestra hash, red y transacción. |
| 14 | Copiar el hash | Confirmación; el valor pegado es el completo. |
| 15 | Compartir credencial | Share sheet con la URL `/verify?credential=…`. |
| 16 | Credencial revocada | Aviso visible; contenido legible. |
| 17 | Cerrar sesión | Vuelve a acceso; "atrás" no reingresa. |
| 18 | Modo avión | Estado de red con reintento. |
| 19 | Volver del segundo plano tras >1 h | La sesión venció: vuelve a acceso con aviso. |
| 20 | Fuente del sistema al máximo | Sin recortes ni desbordes. |
| 21 | TalkBack en Perfil | Orden lógico; todo botón anunciado. |
| 22 | TalkBack en una tarjeta | Anuncia título, tipo, emisor, estado y fecha. |
| 23 | Teléfono chico (360 dp) | Sin desborde horizontal. |
| 24 | Rotar el dispositivo | Se mantiene vertical (bloqueado). |

### iOS (simulador o dispositivo)

Repetir 1-24. Además:

| # | Caso | Esperado |
| --- | --- | --- |
| 25 | Notch / Dynamic Island | Sin contenido tapado. |
| 26 | Gesto de deslizar para volver | Funciona en el detalle. |
| 27 | Indicador de home | Sin contenido tapado. |
| 28 | VoiceOver | Equivalente a TalkBack. |
| 29 | Autorrelleno de contraseña | El llavero ofrece las credenciales. |

### Datos

| # | Caso | Esperado |
| --- | --- | --- |
| 30 | Titular sin credenciales | Estado vacío; sin "Actualizar perfil". |
| 31 | Titular con credenciales pero sin perfil | Vacío + "Actualizar perfil". |
| 32 | Perfil con cobertura parcial | Aviso ámbar. |
| 33 | Credencial de cada uno de los 4 tipos | Todas se muestran. |
| 34 | Credencial sin análisis | Ausencia explicada. |
| 35 | Credencial sin evidencia de blockchain | Ausencia explicada. |
| 36 | Competencia de 500 caracteres | Completa y multilínea. |

## 8. Áreas sin cobertura automática

| Área | Por qué | Mitigación |
| --- | --- | --- |
| Renderizado en dispositivo real | Jest no dibuja píxeles | Matriz manual. |
| Gestos (pull-to-refresh real, deslizar para volver) | No simulables con fidelidad | Matriz manual. |
| Share sheet real del sistema | `Share.share` está simulado | Casos 8 y 15. |
| Portapapeles real | `expo-clipboard` está simulado | Casos 9 y 14. |
| SecureStore real (Keychain / Keystore) | Simulado en memoria | Casos 1 y 19. |
| Escalado de fuente | No aplicado en el entorno de test | Caso 20. |
| Lectores de pantalla | Se verifican las props, no el lector | Casos 21, 22, 28. |
| Rendimiento con muchas credenciales | Sin dataset grande | Ver `11-brechas`. |
| E2E (Detox / Maestro) | No configurado | Ver `11-brechas`. |

## 9. Nota sobre `forceExit`

`jest.config.js` declara `forceExit: true`. El runtime de React Native que monta
`jest-expo` deja handles abiertos al terminar y Jest se cuelga tras reportar los
resultados; `--detectOpenHandles` no identifica el origen. Es un artefacto de
**teardown**: no afecta a los resultados ni oculta fallos. Registrado como
brecha POLISH en `11-brechas-y-trabajo-futuro.md`.

## 10. Regresión de Web

El único cambio compartido fue la adición de entradas al `package-lock.json`.
Verificado por comparación programática contra una copia previa a la instalación:

~~~
Paquetes preexistentes con versión cambiada:  0
Paquetes preexistentes eliminados:            0
Entradas nuevas (dependencias de mobile):     769
~~~

Como ninguna dependencia de Web cambió de versión, no hay superficie de regresión
para Web derivada de este trabajo.
