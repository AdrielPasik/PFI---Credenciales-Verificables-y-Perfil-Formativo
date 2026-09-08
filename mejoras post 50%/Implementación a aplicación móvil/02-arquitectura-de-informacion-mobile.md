# Arquitectura de información móvil

## 1. Principio rector

**Profile-first.** El inicio del titular es su perfil formativo, no una lista de
credenciales. La promesa del producto es *entender la trayectoria*, no
*almacenar tarjetas*. Después de iniciar sesión, el destino por defecto es
siempre la pestaña **Perfil**.

## 2. Mapa de navegación

~~~
                         ┌─────────────────┐
                         │   app/index     │  restaura la sesión
                         └────────┬────────┘
                    sin sesión    │    con sesión válida
              ┌───────────────────┴───────────────────┐
              v                                       v
       ┌─────────────┐                     ┌───────────────────────┐
       │ app/login   │  ── login OK ──►    │  (holder)/(tabs)      │
       └─────────────┘                     └───────────┬───────────┘
              ▲                                        │
              │  logout / 401                          │
              └────────────────────────────────────────┤
                                                       │
                        ┌──────────────────────────────┴─────┐
                        v                                    v
              ┌───────────────────┐                ┌────────────────────┐
              │  Perfil (index)   │                │   Credenciales     │
              └─────────┬─────────┘                └─────────┬──────────┘
                        │  tocar una tarjeta                 │
                        └──────────────┬─────────────────────┘
                                       v
                     ┌──────────────────────────────────────┐
                     │ (holder)/credentials/[credentialId]  │
                     │  stack anidado, NO una pestaña       │
                     └──────────────────────────────────────┘
~~~

### Por qué dos pestañas y no más

- Un "Home" separado del Perfil sería redundante: el perfil **es** el home.
- Una pestaña "Ajustes" que sólo contenga "Cerrar sesión" es una superficie
  vacía. Cerrar sesión vive en el menú de cuenta del encabezado.
- Un verificador nativo no existe: la verificación pública es una experiencia
  web, y así se mantiene.

### Comportamiento del botón "atrás"

El detalle de credencial es una ruta **anidada en el stack**, no una pestaña.
Volver desde el detalle devuelve a la lista de la que se abrió (perfil o
biblioteca), que es lo que espera cualquier persona en Android e iOS. El botón
físico "atrás" de Android funciona por defecto con Expo Router.

Después de cerrar sesión, la guardia de `(holder)/_layout.tsx` redirige a
`/login` y desmonta la pila protegida: no queda ninguna pantalla accesible
"hacia atrás".

## 3. Jerarquía de la pantalla de Perfil

| # | Bloque | Rol |
| --- | --- | --- |
| A | Encabezado: "Espacio personal" / **Mi perfil formativo** | Identidad de la pantalla. |
| B | Resumen del perfil (superficie navy) | Narrativa, conteo, horas, contexto del análisis. |
| C | Cobertura del perfil (ámbar, sólo si aplica) | Límite epistemológico de la evidencia. |
| D | Áreas principales | Taxonomía + horas estimadas + procedencia. |
| E | Habilidades del perfil | Taxonomía + procedencia. |
| F | Conceptos relevantes | Taxonomía. |
| G | Información declarada por instituciones | Texto largo, nunca chips. |
| H | Cómo se construye este perfil | Confianza, observaciones, fecha. |
| I | Acciones: Compartir perfil / Actualizar perfil | Explícitas y con etiqueta. |
| J | Tus credenciales (anticipo de 2 + "Ver todas") | Puente a la biblioteca. |

D, E y F comparten una sola tarjeta separada por divisores, para no generar una
pila interminable de tarjetas idénticas en una pantalla angosta.

## 4. Jerarquía del detalle de credencial

| # | Bloque | Rol |
| --- | --- | --- |
| A | Estado + tipo + título + emisor | Identidad. |
| B | Aviso de revocación (si aplica) | Estado crítico, arriba de todo. |
| C | Identidad de la credencial | Emisor, titular, fecha, DID. |
| D | Aporte formativo | Datos emitidos por la institución. |
| E | Interpretación asistida por IA | Áreas, habilidades, conceptos, confianza. |
| F | Fuentes de respaldo | Evidencia documental y textual. |
| G | Evidencia de integridad (**plegada**) | Hash canónico, red, transacción. |
| H | Compartir esta credencial | Acción nativa. |

**Ni la IA ni la blockchain son protagonistas.** La credencial y su evidencia lo
son. La integridad es la única sección plegada por defecto: es información
importante pero secundaria frente al significado formativo.

## 5. Qué se pliega y qué no

| Contenido | ¿Plegable? | Motivo |
| --- | --- | --- |
| Evidencia de integridad | Sí, cerrada por defecto | Técnica y secundaria. |
| Resumen del perfil | No | Es el mensaje central. |
| Áreas / habilidades / conceptos | No | Es el contenido que se vino a ver. |
| Información declarada | No | Es dato institucional, no un detalle. |
| Aporte formativo de una credencial | No | Es el núcleo del detalle. |
| Interpretación asistida | No | Su ausencia también se explica. |

## 6. Refrescar vs. actualizar (distinción crítica)

| Gesto / acción | Qué hace | Qué NO hace |
| --- | --- | --- |
| **Pull-to-refresh** en Perfil | `refetch` de `/me/profile/current` y `/me/credentials` | No reconstruye el perfil. |
| **Pull-to-refresh** en Credenciales | `refetch` de `/me/credentials` | No muta nada. |
| **Botón "Actualizar perfil"** | `POST /me/profile/rebuild` | No ejecuta IA. |

Confundir estas dos cosas sería un error de producto: refrescar es leer,
actualizar es recomponer. Hay un test que verifica que un refresco no dispare
`/me/profile/rebuild`.

## 7. Estados de cada pantalla

Cada pantalla implementa explícitamente:

| Estado | Tratamiento |
| --- | --- |
| Carga inicial | Esqueleto (perfil) o indicador con etiqueta (listas). |
| Refrescando | `RefreshControl` nativo, sin bloquear la pantalla. |
| Vacío | Explicación de la ausencia, nunca una carencia de la persona. |
| Parcial | Aviso de cobertura, distinto de un error. |
| Error de red | Mensaje propio + "Reintentar". |
| Error de servicio (5xx) | Mensaje propio + "Reintentar". |
| Sesión vencida (401) | Vuelve a acceso con aviso. |
| Sin permiso (403) | Mensaje propio, sin "Reintentar". |
| No encontrado (404) | Mensaje específico por sujeto, sin "Reintentar". |
| Contrato incompatible | Mensaje propio, con "Reintentar". |

**Nunca** se colapsa todo en "No encontrado".

## 8. Decisiones específicamente móviles

| Decisión | Motivo |
| --- | --- |
| Pestañas inferiores en vez de nav superior | Alcanzable con una mano. |
| Tarjeta completa navegable | Un "Ver" chico es un objetivo táctil pobre. |
| Share sheet del sistema en vez del panel desplegable de Web | Es el gesto que la gente ya conoce. |
| Vista pública en el navegador externo | El verificador es y sigue siendo web. |
| Integridad plegada | Recupera espacio vertical para el contenido formativo. |
| Ancho máximo de contenido (640 pt) | En tablet el texto no se estira de borde a borde. |
| Orientación bloqueada en vertical | Ninguna pantalla se beneficia del apaisado en v1. |
| Tema claro fijo | Scope Web no define un tema oscuro completo. |

## 9. Copy y terminología

Se conserva el vocabulario de Scope Web:

- "Mi perfil formativo", "Mis credenciales"
- "Compartir perfil", "Actualizar perfil"
- "Emitida" / "Revocada"
- "Interpretación asistida por IA"
- "Evidencia de integridad"
- "Información declarada por instituciones"
- "Cobertura del perfil"

Idioma: español rioplatense (es-AR), voseo, igual que Web.

**Nunca** aparece: "certificado por IA", "verificado por IA", "puntaje",
"nivel", "score de empleabilidad" ni ninguna métrica que el backend no provea.
Y "sin evidencia suficiente" nunca se presenta como una carencia de la persona.
