# Brechas y trabajo futuro

## Clasificación

| Severidad | Significado |
| --- | --- |
| `BLOCKER` | Impide una capacidad requerida. |
| `IMPORTANTE` | Degrada la experiencia o la operación de forma perceptible. |
| `POLISH` | Mejora de calidad, sin impacto funcional. |
| `FUTURO` | Capacidad nueva, no una carencia. |

Dueños: `MOBILE` · `WEB` · `BACKEND` · `INFRA` · `PRODUCTO`.

---

## 1. Brechas de backend

### B-01 — El JWT vence en 1 hora y no hay refresh token
**Severidad:** `IMPORTANTE` · **Dueño:** `BACKEND / AUTH`

`JWT_EXPIRES_IN` es `1h` por defecto y no existe endpoint de refresh. En una web
esto es tolerable (sesiones cortas). En una app que se abre y cierra a lo largo
del día, obliga a reingresar la contraseña varias veces por jornada.

Mobile lo maneja con corrección: el primer `401` limpia la sesión y devuelve a
acceso con el aviso "Tu sesión venció". No hay pantallas colgadas ni estados
raros.

**Resolución sugerida:** refresh token rotativo, o un `JWT_EXPIRES_IN` más largo
para clientes nativos. **Requiere un cambio de backend que no está en el alcance
de este trabajo.**

### B-02 — El logout no revoca el token del lado del servidor
**Severidad:** `IMPORTANTE` · **Dueño:** `BACKEND / AUTH`

Cerrar sesión borra el token del dispositivo, pero el JWT sigue siendo válido
hasta que vence. Un token exfiltrado antes del logout sirve hasta 1 hora.

**Resolución sugerida:** lista de revocación o versionado de token por usuario.

### B-03 — La evidencia documental no expone una URL accesible
**Severidad:** `POLISH` · **Dueño:** `BACKEND`

`GET /me/credentials/:id` devuelve el nombre, el tipo MIME, el tamaño y el
digest del documento, pero **no** una URL para abrirlo o descargarlo.

**Consecuencia:** Mobile muestra los metadatos y nada más, exactamente igual que
Holder Web. No es una diferencia de paridad.

**Por qué no se resolvió en el cliente:** habría que inventar un endpoint. Fuera
de alcance por regla explícita.

**Resolución sugerida:** un endpoint que devuelva una URL firmada de corta vida,
autorizada para el titular. Recién entonces tendría sentido evaluar en Mobile si
se abre con `Linking` o con un visor.

### B-04 — La lista de credenciales no está paginada
**Severidad:** `POLISH` · **Dueño:** `BACKEND`

`GET /me/credentials` devuelve todo. Con decenas de credenciales sigue estando
bien (Mobile usa `FlatList`, que virtualiza), pero con cientos el payload y el
tiempo de adaptación crecen linealmente.

**Resolución sugerida:** paginación por cursor, si algún titular llega a ese
volumen. No es un problema hoy.

---

## 2. Brechas de producto

### P-01 — No se puede crear una cuenta desde la app
**Severidad:** `IMPORTANTE` · **Dueño:** `PRODUCTO`

`POST /auth/register` existe y funciona. La app **no** lo expone.

**Por qué:** no se puede inventar una decisión de producto. Que Web ofrezca
registro no implica que la app deba: hay preguntas abiertas (¿verificación de
correo? ¿términos y condiciones dentro de la app? ¿tiendas que exigen borrado de
cuenta si hay creación de cuenta?) que corresponden a producto, no a la
implementación.

**Consecuencia:** una persona nueva necesita la web para crear su cuenta. Para el
PFI es aceptable: las cuentas de demo se crean antes.

> **Nota importante para la publicación en tiendas:** si la app llega a permitir
> crear cuentas, tanto Google Play como App Store exigen ofrecer también el
> borrado de cuenta desde la app o desde una URL accesible.

### P-02 — El "código de credencial" no se ofrece al compartir
**Severidad:** `POLISH` · **Dueño:** `PRODUCTO`

Holder Web ofrece copiar el identificador de la credencial además del enlace,
para pegarlo a mano en el verificador. Mobile no: el share sheet ya entrega el
enlace completo y un segundo campo copiable competiría con la acción principal.

**Reevaluar** si aparece un flujo de verificación por código en el que el
identificador suelto sea realmente útil.

---

## 3. Brechas de mobile

### M-01 — Jest necesita `forceExit`
**Severidad:** `POLISH` · **Dueño:** `MOBILE`

El runtime de React Native que monta `jest-expo` deja handles abiertos al
terminar; Jest se cuelga después de reportar los resultados.
`--detectOpenHandles` no identifica el origen. Sólo pasa en las suites que montan
componentes; las de lógica pura terminan limpias.

**Mitigación:** `forceExit: true` en `jest.config.js`, con su comentario.

**Impacto real:** ninguno sobre los resultados. Es un artefacto de teardown.

**Resolución sugerida:** revisar en el próximo upgrade de SDK; suele arreglarse
solo aguas arriba.

### M-02 — Sin tests end-to-end
**Severidad:** `POLISH` · **Dueño:** `MOBILE`

Hay 203 tests de unidad e integración, pero ninguno E2E en dispositivo.

**Mitigación:** la matriz de prueba manual de `09-testing-y-calidad.md`.

**Resolución sugerida:** Maestro (más simple, YAML) o Detox. Recién vale la pena
cuando exista un entorno de demo estable contra el que correrlos.

### M-03 — Sin modo oscuro
**Severidad:** `FUTURO` · **Dueño:** `MOBILE` + `PRODUCTO`

`userInterfaceStyle: 'light'`. Deliberado: Scope Web no define un tema oscuro
completo, y un modo oscuro a medias sería peor que ninguno.

**Resolución sugerida:** definir primero la paleta oscura de Scope (decisión de
marca), después implementarla en `tokens.ts` y en `app.config.ts`.

### M-04 — Sin autenticación biométrica
**Severidad:** `FUTURO` · **Dueño:** `MOBILE`

**Por qué no ahora:** la biometría sólo tiene sentido sobre un contrato de sesión
estable. Con un JWT de 1 h sin refresh, desbloquear con la huella igual llevaría
a reingresar la contraseña. **Resolver B-01 primero.**

### M-05 — Sin caché offline
**Severidad:** `FUTURO` · **Dueño:** `MOBILE`

Los datos viven en la caché en memoria de TanStack Query. Al reiniciar la app sin
red, no hay nada que mostrar.

**Deliberado:** persistir el perfil y las credenciales del titular en disco es
guardar datos personales; el beneficio no justifica el riesgo en v1.

**Resolución sugerida (si se pide):** persistencia cifrada y selectiva, con
política de expiración y borrado en el logout. Nunca `AsyncStorage` en claro.

### M-06 — Sin notificaciones push
**Severidad:** `FUTURO` · **Dueño:** `PRODUCTO`

No hay ningún caso de uso del titular que las justifique hoy (¿"te emitieron una
credencial"? Requeriría infraestructura de backend que no existe). Pedir permiso
de notificaciones sin tener qué notificar es una mala práctica.

### M-07 — Sin deep links más allá del esquema propio
**Severidad:** `FUTURO` · **Dueño:** `MOBILE` + `INFRA`

Está configurado `scheme: "scope"`, suficiente para el enrutado de Expo. **No**
hay App Links (Android) ni Universal Links (iOS): requieren servir
`assetlinks.json` y `apple-app-site-association` desde el dominio de Scope Web,
que hoy no está definido.

**Consecuencia:** abrir un enlace `/share/profile/<token>` desde WhatsApp abre el
navegador, no la app. Es el comportamiento correcto: la vista pública **es** web.

### M-08 — Sin monitoreo de errores en producción
**Severidad:** `IMPORTANTE` para producción, `POLISH` para el PFI · **Dueño:** `MOBILE` + `PRODUCTO`

No hay Sentry ni Crashlytics. **Deliberado:** el proyecto no adoptó ninguna de las
dos y no corresponde introducir una herramienta con implicancias de privacidad
por decisión de implementación.

**Resolución sugerida:** decidirlo a nivel producto antes de publicar. Si se
adopta, declararlo en los cuestionarios de privacidad de las tiendas.

### M-09 — Sin analítica
**Severidad:** `FUTURO` · **Dueño:** `PRODUCTO`

Mismo razonamiento que M-08.

### M-10 — Sin optimización para tablet
**Severidad:** `POLISH` · **Dueño:** `MOBILE`

La app **no se rompe** en tablet: el contenido se centra con `maxWidth: 640`.
Pero no aprovecha el espacio (no hay dos columnas ni master-detail).

**Deliberado:** optimizar para tablet antes de validar en teléfono sería invertir
las prioridades.

### M-11 — Duplicación de la lógica de contratos con Holder Web
**Severidad:** `IMPORTANTE` (de mantenimiento) · **Dueño:** `MOBILE` + `WEB`

`apps/web/src/lib/adapters/holder.adapter.ts` y
`apps/mobile/src/lib/adapters/holder.adapter.ts` implementan las mismas reglas
por separado, porque Mobile no puede importar de Web y `packages/shared-types`
está vacío.

**Consecuencia:** un cambio de contrato hay que aplicarlo en dos lugares.

**Mitigación:** `12-protocolo-de-sincronizacion-holder.md` y la batería de tests
de tortura, que fallarían ante una divergencia.

**Resolución sugerida:** convertir `packages/shared-types` en un workspace
TypeScript real con las primitivas de contrato y los modelos del titular.
**Implicaría tocar Holder Web**, explícitamente fuera del alcance de este
trabajo, y Holder Web viene de una estabilización reciente que no conviene
perturbar.

### M-12 — El identificador de tienda es provisional
**Severidad:** `BLOCKER` **para publicar** · **Dueño:** `PRODUCTO`

`com.scope.holder` en `app.config.ts` está marcado como **PROVISIONAL**. No se
encontró ningún identificador oficial en el repositorio y no se registró ningún
servicio externo.

**Después de publicar, cambiarlo es imposible sin crear una app nueva.** Hay que
confirmarlo antes del primer envío a tienda.

---

## 4. Brechas de infraestructura

### I-01 — No hay proyecto EAS
**Severidad:** `BLOCKER` **para generar el APK** · **Dueño:** `INFRA`

`eas.json` está listo, pero `extra.eas.projectId` está vacío: no se creó ninguna
cuenta ni proyecto en la nube (fuera de alcance por regla explícita).

**Resolución:** `eas login` + `eas init`. Ver `10-plan-de-deployment.md` §I.

### I-02 — Las URLs de `eas.json` son marcadores
**Severidad:** `BLOCKER` **para generar el APK** · **Dueño:** `INFRA`

Los perfiles llevan `"SET_ME"` en `EXPO_PUBLIC_API_BASE_URL` y
`EXPO_PUBLIC_WEB_BASE_URL`. Es intencional: poner una URL inventada haría que la
app apuntara silenciosamente a la nada. Con `"SET_ME"`, la app falla de forma
ruidosa y explícita.

### I-03 — Sin CI
**Severidad:** `POLISH` · **Dueño:** `INFRA`

El repositorio no tiene pipeline. Flujo recomendado en
`10-plan-de-deployment.md` §T.

### I-04 — Sin política de privacidad ni URL de soporte publicadas
**Severidad:** `BLOCKER` **para publicar** · **Dueño:** `PRODUCTO` + `INFRA`

Ambas tiendas las exigen.

---

## 5. Resumen

| Severidad | Cantidad | ¿Bloquea el PFI? |
| --- | --- | --- |
| `BLOCKER` | 4 (M-12, I-01, I-02, I-04) | Sólo I-01 e I-02, y se resuelven en minutos. |
| `IMPORTANTE` | 5 (B-01, B-02, P-01, M-08, M-11) | No. |
| `POLISH` | 8 | No. |
| `FUTURO` | 6 | No. |

**Ninguna brecha impide entregar la aplicación funcionando contra el API real.**

Para el PFI hace falta resolver **I-01** (crear el proyecto EAS) e **I-02**
(poner las URLs reales). Ambas son configuración, no desarrollo.

---

## 6. PFI-ready vs. production-ready

### Suficiente para el PFI

- [x] App nativa funcional contra el API real
- [x] Login y sesión persistente
- [x] Perfil formativo completo
- [x] Credenciales y detalle
- [x] Compartir perfil y credencial
- [x] Actualizar perfil
- [x] Estados de error, vacío y parcial
- [x] Accesibilidad básica
- [x] Marca Scope (icono, splash, tipografía, colores)
- [x] 203 tests, typecheck, lint y Expo Doctor en verde
- [ ] Proyecto EAS creado (**I-01**)
- [ ] URLs de entorno configuradas (**I-02**)
- [ ] APK generado y probado en un dispositivo real

### Pendiente para producción

Todo lo anterior, más: identificadores confirmados, cuentas de tienda, fichas,
política de privacidad, URL de soporte, cuestionarios de datos, QA en
dispositivos reales, pasada de accesibilidad con lectores de pantalla, revisión
de seguridad del bundle, decisión sobre monitoreo y analítica, separación de
entornos, versionado, CI y estrategia de updates.
