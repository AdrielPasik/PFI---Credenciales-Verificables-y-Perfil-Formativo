# Especificación de pantallas

## 1. Arranque — `app/index.tsx`

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Decidir el destino según el estado de la sesión. |
| **Datos** | Estado de `SessionProvider`. |
| **Acciones** | "Reintentar" y "Cerrar sesión" (sólo en error recuperable). |
| **Carga** | "Validando tu acceso". **Nunca** muestra la pantalla de acceso mientras resuelve. |
| **Error** | Error recuperable → mensaje + reintentar + cerrar sesión. |
| **Navegación** | `authenticated` → `/(holder)/(tabs)` · `unauthenticated` → `/login`. |
| **Diferencia con Web** | Web resuelve la sesión dentro de cada ruta; Mobile tiene una ruta de arranque dedicada, porque una app tiene splash y la web no. |

## 2. Acceso — `app/login.tsx` + `features/auth/login-screen.tsx`

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Autenticar a un titular. |
| **Datos** | Ninguno remoto hasta enviar. |
| **Acciones** | Ingresar · mostrar/ocultar contraseña · Crear cuenta. |
| **Jerarquía** | Lockup Scope → tagline → "Iniciá sesión" → propuesta → formulario → nota de privacidad. |
| **Estados** | Inactivo · validación local · enviando (botón deshabilitado + `busy`) · credenciales incorrectas · red · timeout · servicio no disponible · sesión vencida (aviso al volver). |
| **Accesibilidad** | Campos etiquetados; error anunciado con `accessibilityLiveRegion`; alternador de contraseña con etiqueta y `accessibilityState.selected`. |
| **Teclado** | `KeyboardAvoidingView`; email → contraseña → enviar. |
| **Áreas seguras** | Padding superior e inferior desde los insets. |
| **Diferencia con Web** | Mobile ofrece crear cuenta Holder, pero no incorpora verificación pública ni mensajería institucional. |

**Copy exacto:**

- Tagline: *"Una nueva forma de entender tu trayectoria."*
- Título: *"Iniciá sesión"*
- Propuesta: *"Accedé para consultar tus credenciales y entender tu perfil formativo."*
- Pie: *"Scope es tu espacio personal de credenciales formativas. Sólo vos ves tu perfil, salvo que decidas compartirlo."*

## 2.1 Crear cuenta — `app/register.tsx` + `features/auth/register-screen.tsx`

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Crear una cuenta Holder con el contrato público existente. |
| **Campos** | Nombre · Apellido · Correo electrónico · Contraseña · Repetir contraseña local. |
| **Acción** | `POST /auth/register`; `201` activa la misma sesión segura que login. |
| **Estados** | Validación local · enviando · email ya registrado · 400 · red · timeout · 5xx. |
| **Seguridad** | La repetición no sale del dispositivo; la contraseña se limpia tras el intento y nunca se persiste. |
| **Accesibilidad** | Orden de teclado, campos etiquetados, toggle de contraseña y controles de 44 px o más. |

## 3. Perfil formativo — `(holder)/(tabs)/index.tsx` + `features/profile/`

**Pantalla principal del producto.**

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Que el titular entienda su trayectoria formativa. |
| **Datos** | `GET /auth/me` (identidad de sesión), `GET /me/profile/current` y `GET /me/credentials`. |
| **Acciones** | Compartir perfil · Actualizar perfil · Ver todas · abrir una credencial · pull-to-refresh. |
| **Título de barra** | "Perfil" · **Título de contenido**: "Mi perfil formativo". Sin repeticiones. |

La cabecera conserva el foco profile-first: presenta `displayLabel` como contexto
humano de la sesión, sin convertir la pantalla en una cuenta ni repetir el
correo cuando no aporta información formativa.

**Bloques:** ver `02-arquitectura-de-informacion-mobile.md` §3.

**Estados**

| Estado | Tratamiento |
| --- | --- |
| Carga | Dos bloques de esqueleto (evita el salto de layout). |
| Listo | Panel completo + acciones. |
| Vacío (`currentProfile: null`) | "Tu perfil todavía no está disponible" + explicación + "Actualizar perfil" **sólo si hay credenciales emitidas**. |
| Parcial | Aviso ámbar de cobertura. **No** es un error. |
| Error | Mensaje por categoría + "Reintentar". Las credenciales siguen visibles debajo. |
| Refrescando | `RefreshControl` nativo; la pantalla no se bloquea. |

**Reglas epistemológicas que esta pantalla mantiene**

- La confianza describe la fiabilidad del **análisis**, no el nivel de
  conocimiento de la persona (dicho explícitamente en el resumen).
- Las horas oficiales son la suma de lo declarado, **no** una distribución por
  área (aclarado bajo el dato).
- La cobertura parcial es una limitación de la **evidencia disponible**.
- Lo declarado por la institución y lo interpretado por IA se muestran en
  secciones separadas y nunca se mezclan.
- **Cero puntajes inventados.** Sólo se muestra lo que el backend provee.

**Diferencias con Web:** navy hero de ancho completo → tarjeta de resumen
acotada; grilla de 2 columnas → apilado vertical; panel desplegable de compartir
→ share sheet nativo; fila de 3 tarjetas de contadores → omitida.

## 4. Mis credenciales — `(holder)/(tabs)/credentials.tsx`

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Consultar las credenciales que respaldan la trayectoria. |
| **Datos** | `GET /me/credentials`. |
| **Acciones** | Abrir una credencial · pull-to-refresh. |
| **Implementación** | `FlatList` (no un `map` dentro de un `ScrollView`), para escalar. |

**Tarjeta de credencial**

- Franja de estado (teal / rojo) a la izquierda.
- Insignia de estado con **texto** + tipo.
- Título y "Emitida por …".
- Fecha · "Integridad" · "Con análisis" (sólo si aplican).
- Chevron indicando navegación.
- **La tarjeta entera es el objetivo táctil**, con etiqueta accesible completa.

**Estados:** carga · listo · vacío ("Todavía no tenés credenciales formativas",
sin ninguna acción de emisor) · error por categoría · refrescando.

Una credencial revocada se marca con claridad pero **no** se atenúa hasta
volverse ilegible: sigue siendo información consultable.

**Diferencias con Web:** lista vertical en vez de grilla; sin contadores de
resumen; tarjeta completa navegable en vez de enlace "Ver credencial".

## 5. Detalle de credencial — `(holder)/credentials/[credentialId].tsx`

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Inspeccionar una credencial: significado, evidencia e integridad. |
| **Datos** | `GET /me/credentials/:id`. |
| **Acciones** | Compartir · copiar enlace · ver vista pública · plegar/desplegar integridad · copiar valores técnicos · abrir la URL declarada. |
| **Navegación** | Ruta anidada en el stack; "atrás" vuelve a la lista de origen. |

**Bloques:** ver `02-arquitectura-de-informacion-mobile.md` §4.

**Contenido largo**

- Competencias y resultados de aprendizaje (hasta 500 caracteres) →
  `DeclaredTextList`, multilínea, sin truncar.
- Hash canónico, DID y txHash → `TechnicalValue`, monoespaciada, envuelven,
  con acción de copiar. El valor **completo** se conserva; la abreviatura es
  sólo presentación.

**Identidad del titular:** `subject.displayLabel` es el valor primario de la
fila "Titular". Si el correo del contrato difiere, se muestra como texto
secundario; si coincide, aparece una sola vez. No se deriva nombre desde el
contenido de la credencial ni se inventa uno para usuarios legacy.

**Adaptación por tipo:** la sección "Información declarada del curso"
(plataforma, modalidad, URL) aparece **sólo** en `course` y sólo si hay algún
dato. En un curso no se muestran `skills` declaradas, igual que en Web. No se
inventa ningún campo por tipo.

**Estados**

| Estado | Tratamiento |
| --- | --- |
| Carga | Esqueletos + "Cargando credencial". |
| Listo | Detalle completo. |
| Revocada | Aviso ámbar con motivo y fecha; el contenido sigue visible. |
| 404 | "No encontramos esta credencial en tu espacio personal." Sin reintentar. |
| 403 | "No tenés acceso a esta información." Sin reintentar. |
| 401 | "Tu sesión ya no está disponible." La sesión ya volvió a acceso. |
| 5xx / red / timeout | Mensaje por categoría + "Reintentar". |
| Contrato incompatible | "La información no tiene el formato esperado" + "Reintentar". |
| Sin análisis | "No hay análisis disponible para esta credencial." |
| Sin evidencia | Bloque punteado explicando la ausencia. |
| Sin evidencia técnica | Explicación dentro de la sección plegable. |

**Diferencias con Web:** integridad plegable; vista previa textual completa (Web
la recorta a 4 líneas); acción de copiar valores técnicos; share sheet nativo.

## 6. Menú de cuenta — `features/auth/account-menu-button.tsx`

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Mostrar la identidad y ofrecer cerrar sesión. |
| **Ubicación** | `headerRight` de las pestañas. |
| **Datos** | `displayLabel`, `email`, `did` de la sesión. |
| **Acciones** | Cerrar sesión. |
| **Presentación** | Hoja inferior modal, cerrable tocando el fondo o con "atrás" en Android. |
| **Accesibilidad** | Botón etiquetado "Cuenta de {displayLabel}" con pista; el fondo es un botón etiquetado "Cerrar el menú de cuenta". |
| **Reglas** | Jerarquía `displayLabel` → email (sólo si difiere) → DID. Se muestra **sólo** lo que el API provee: nunca se infiere un nombre del correo. El DID no aparece si es `null`. Ninguna superficie institucional, aunque la cuenta tenga membresías de emisor. |

## 7. Configuración inválida — `app-shell/config-error-screen.tsx`

| Aspecto | Detalle |
| --- | --- |
| **Propósito** | Falla explícita cuando falta configuración de entorno. |
| **Desarrollo** | Muestra la variable exacta, el motivo y cómo arreglarlo. |
| **Producción** | Mensaje genérico, sin detalle técnico. |
| **Regla** | **Nunca** cae en silencio a `localhost`. |

## 8. Matriz de estados por pantalla

| Pantalla | Carga | Vacío | Error | Parcial | Refresco |
| --- | --- | --- | --- | --- | --- |
| Arranque | Sí | n/a | Sí | n/a | n/a |
| Acceso | Botón en carga | n/a | Sí (5 categorías) | n/a | n/a |
| Perfil | Esqueleto | Sí | Sí (6 categorías) | Sí | Pull-to-refresh |
| Credenciales | Indicador | Sí | Sí (5 categorías) | n/a | Pull-to-refresh |
| Detalle | Esqueleto | n/a | Sí (7 categorías) | Sí (análisis parcial) | Reintentar |
