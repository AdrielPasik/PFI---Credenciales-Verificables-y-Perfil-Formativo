# Autenticación y sesión

> Todo lo de este documento fue **inspeccionado en el código real del backend**,
> no supuesto. Referencias: `services/api/src/auth/auth.controller.ts`,
> `auth.service.ts`, `jwt-config.ts`, `me/me.controller.ts`,
> `profiles/profiles.controller.ts`, `profile-sharing/profile-sharing.controller.ts`.

## 1. Auditoría del contrato real

| Pregunta | Respuesta |
| --- | --- |
| ¿La autenticación es por token Bearer? | **Sí.** JWT firmado con `JWT_SECRET`. |
| ¿Es por cookie de sesión? | **No.** No hay cookies en el flujo. |
| ¿El login devuelve un token? | **Sí.** `{ accessToken, user }`. |
| ¿Hay refresh token? | **No.** No existe endpoint de refresh. |
| ¿Hay CSRF? | **No aplica**: no hay cookies. |
| ¿Se requiere `credentials: 'include'`? | **No.** |
| ¿Hay algún mecanismo exclusivo del navegador? | **No.** |
| ¿`fetch` nativo soporta el flujo tal cual? | **Sí, completamente.** |
| Vencimiento del token | `JWT_EXPIRES_IN`, por defecto **`1h`** (`auth/jwt-config.ts`). |

**Conclusión: CASO A del árbol de decisión — existe un contrato de token
reutilizable directamente desde un cliente nativo.** No hizo falta ninguna
adaptación del backend, ningún WebView, ningún hack. Esto es una buena noticia
de arquitectura: el backend ya estaba listo para clientes nativos.

## 2. Autorización del titular

`/me/credentials`, `/me/credentials/:id`, `/me/profile/current`,
`/me/profile/rebuild` y `/me/profile/share` están protegidos **sólo** por
`AuthGuard`. No existe un "rol holder".

**Toda cuenta autenticada es titular de sus propias credenciales.** Las
membresías de emisor (`issuerMemberships` en `/auth/me`) son una dimensión
aparte: una persona puede ser titular *y* operar para una institución.

### Qué significa para Scope Mobile

- **No existe el caso "cuenta autenticada sin acceso a capacidades de titular".**
  No hace falta —y sería incorrecto inventar— una pantalla de "esta app es sólo
  para titulares".
- Si la cuenta tiene membresías de emisor, la app **las ignora** y le muestra su
  perfil de titular, que es exactamente lo correcto: Mobile permite el acceso de
  titular siempre que las capacidades de titular sean válidas.
- Un test verifica que el modelo de usuario que la app expone no contenga nada
  del emisor, ni siquiera la palabra `issuer`.

### La UI no es autorización

Ocultar un botón es **presentación**. La autoridad es el backend: cada petición
viaja con su Bearer y el servidor decide. La guardia de navegación de
`(holder)/_layout.tsx` mejora la experiencia; no protege datos.

## 3. Implementación en Mobile

### 3.1 Almacenamiento

`src/lib/auth/session-storage.ts`

| Qué | Dónde | Por qué |
| --- | --- | --- |
| `accessToken` | `expo-secure-store`, clave `scope.session.accessToken`, con `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | Keychain en iOS, EncryptedSharedPreferences/Keystore en Android. |
| Contraseña | **Nunca, en ningún lado.** | |
| Perfil y credenciales | Sólo en memoria (caché de TanStack Query) | Son datos personales; el beneficio de cachearlos en disco no justifica el riesgo en v1. |

`AsyncStorage` **no se usa para nada sensible**. De hecho, la app no lo usa.

Si `SecureStore` falla al leer (dispositivo sin bloqueo configurado, backend de
seguridad no disponible), se trata como "no hay sesión" en vez de dejar a la
persona atrapada en el arranque.

### 3.2 Ciclo de vida

~~~
Arranque
  └─ leer token de SecureStore
       ├─ no hay        → 'unauthenticated'          → /login
       └─ hay           → GET /auth/me
                            ├─ 200                    → 'authenticated'  → Perfil
                            ├─ 401                    → borrar token, 'unauthenticated'
                            │                            con aviso "Tu sesión venció"
                            └─ red / 5xx              → 'recoverable-error'
                                                         (el token NO se borra)
                                                         → "Reintentar" o "Cerrar sesión"

Login
  └─ POST /auth/login
       ├─ 200  → guardar token, limpiar caché, 'authenticated'
       │          (el usuario viene en la respuesta: no hace falta un segundo
       │           viaje a /auth/me para entrar)
       ├─ 401  → "El correo o la contraseña son incorrectos."
       ├─ 400  → "Revisá los datos ingresados…"
       ├─ 5xx  → "Scope no está disponible en este momento…"
       └─ red  → "No pudimos conectar con Scope…"

Petición autenticada
  └─ Bearer inyectado por SessionProvider
       ├─ 401 → borrar token + limpiar caché → /login con aviso
       ├─ 403 → NO expira la sesión: es falta de permiso, no sesión vencida
       └─ otros → los maneja la pantalla

Logout
  └─ borrar token + queryClient.clear() → 'unauthenticated' → /login
~~~

### 3.3 Distinción crítica: 401 vs. 403

Un `403` **no** cierra la sesión. Significa "esta credencial no es tuya", no
"tu sesión venció". Confundirlos expulsaría a la persona por tocar un recurso
ajeno. Hay un test dedicado a esto.

### 3.4 Arranque sin parpadeo

El splash se mantiene hasta que cargan las fuentes. Mientras la sesión se
restaura, `app/index.tsx` muestra "Validando tu acceso" — **no** la pantalla de
acceso. Quien ya tiene sesión válida nunca ve un destello de login.

Si las fuentes no cargan, la app **igual arranca** con la tipografía del
sistema: una fuente que no baja no debe dejar la app en el splash para siempre.

### 3.5 Fallo de restauración

Si hay token pero el servidor lo rechaza (`401`), se borra y se vuelve a acceso
con el aviso. Si el servidor no responde (red/5xx), el token **se conserva** y
se ofrece reintentar: un problema de conectividad no debería costarle la sesión
a nadie. En ningún caso la persona queda atrapada en una pantalla de carga.

### 3.6 Identidad humana de presentación

`POST /auth/login`, `POST /auth/register` y `GET /auth/me` entregan
`user.displayLabel`. Es una proyección canónica del backend construida con
`buildHolderDisplayLabel`: `displayName` normalizado, luego `firstName +
lastName`, luego cada nombre disponible, luego email y finalmente el fallback
seguro del servidor. Mobile transporta ese valor sin recalcularlo y lo presenta
en el Perfil y el menú de cuenta. Si el label ya coincide con el email, el email
no se duplica visualmente.

No existe un endpoint de autoedición de `displayName`, `firstName` o `lastName`
para el usuario autenticado. Por eso un Holder legacy cuyo `displayLabel` cae al
email no puede completar su identidad desde Mobile todavía; ver P-03 en
`11-brechas-y-trabajo-futuro.md`.

## 4. Prevención de envíos duplicados

- El botón de acceso se deshabilita (`accessibilityState.disabled` y `busy`)
  mientras hay una petición en curso.
- `submit()` retorna temprano si ya está enviando: cubre el doble toque y el
  "enviar" del teclado.
- El botón "Actualizar perfil" retorna temprano si la mutación está pendiente.
- El enlace para compartir se cachea por sesión de pantalla: tres acciones
  seguidas producen **una sola** llamada al backend.

## 5. Límites conocidos

| Límite | Impacto | Dueño |
| --- | --- | --- |
| **Sin refresh token.** Con `JWT_EXPIRES_IN=1h`, a la hora la persona tiene que volver a iniciar sesión. | Molesto en uso prolongado. Aceptable para el PFI. | BACKEND / AUTH |
| **Sin revocación del lado del servidor.** El logout borra el token localmente; el JWT sigue siendo válido hasta que vence. | Un token exfiltrado sirve hasta 1 h. | BACKEND / AUTH |
| **Sin biometría.** No se implementó Face ID / huella. | Ninguno hoy. Es trabajo futuro razonable *después* de que exista un contrato de sesión estable. | MOBILE |
| **Sin bloqueo de capturas de pantalla.** | Ninguno hoy; agregarlo implicaría código nativo sin un requisito real. | MOBILE |
| **Sin borrado de cuenta.** Mobile ya permite alta mediante `POST /auth/register`, pero no existe un endpoint Holder de borrado propio inspeccionado en el backend. | No bloquea Expo Go, APK privado ni demo; bloquea una publicación real en tiendas hasta ofrecer borrado desde app o una URL accesible. | PRODUCTO / BACKEND |

Ninguno de estos límites bloquea la entrega. Están registrados en
`11-brechas-y-trabajo-futuro.md` con su severidad.

## 6. Lo que NO se hizo (a propósito)

- **No se tocó el backend**, ni siquiera donde habría sido fácil (agregar un
  refresh token es un cambio chico). Fuera de alcance por regla explícita.
- **No hay login por WebView.** Habría sido un hack innecesario, y además el
  contrato nativo funciona perfectamente.
- **No hay autenticación local falsa** ni modo demo escondido.
- **No se guarda la contraseña** en ningún almacenamiento, ni siquiera "para
  recordar el usuario".
- **No se registran en logs** tokens, encabezados de autorización, enlaces
  compartidos ni contenido de credenciales. La regla de lint `no-console` como
  error lo hace difícil de romper por accidente.
