# Ledger de paridad Holder Web ↔ Holder Mobile

> **Este es el documento vivo más importante de la carpeta.** Cada vez que
> Holder Web gane una capacidad, hay que volver acá. Ver
> `12-protocolo-de-sincronizacion-holder.md` para el procedimiento.

## 1. Estados posibles

| Estado | Significado |
| --- | --- |
| `PARIDAD` | Misma capacidad de dominio, interacción equivalente. |
| `MOBILE-ADAPTED` | Misma capacidad de dominio, interacción propia de la plataforma. **No es una brecha.** |
| `WEB-ONLY INTENCIONAL` | Existe en Web y se decidió que no corresponde en Mobile. |
| `MOBILE-PENDING` | Debería existir en Mobile y todavía no existe. **Es una brecha.** |

**Paridad no es paridad de píxeles.** Web y Mobile comparten marca, lenguaje,
jerarquía semántica, datos, estados y capacidades. No comparten geometría de
componentes, navegación ni ubicación de acciones.

## 2. Matriz de capacidades

Auditada contra el Holder Web vigente (`apps/web/src/features/holder/**`,
`apps/web/src/features/auth/**`, `apps/web/src/lib/**`).

### 2.1 Sesión

| Capacidad | Web | Mobile | Estado | Notas |
| --- | --- | --- | --- | --- |
| Login con email + contraseña | Sí | Sí | `PARIDAD` | Mismo `POST /auth/login`. |
| Mostrar/ocultar contraseña | Sí | Sí | `PARIDAD` | |
| Restauración de sesión al abrir | Sí (`sessionStorage`) | Sí (`expo-secure-store`) | `MOBILE-ADAPTED` | Web pierde la sesión al cerrar la pestaña; Mobile la conserva entre arranques, que es lo que se espera de una app. |
| Cierre de sesión | Sí (menú de cuenta) | Sí (menú de cuenta del encabezado) | `PARIDAD` | |
| Expiración de sesión (401) | Sí | Sí | `PARIDAD` | Vuelve a acceso con aviso. |
| Reintento ante backend caído sin perder la sesión | Sí | Sí | `PARIDAD` | |
| Registro de cuenta | Sí (`/register`) | No | `WEB-ONLY INTENCIONAL` | El backend expone `POST /auth/register`, pero crear cuentas desde la app es una decisión de producto no tomada. Ver `11-brechas`. |
| Selección de contexto de emisor | Sí | No | `WEB-ONLY INTENCIONAL` | Mobile es holder-only. |

### 2.2 Perfil formativo

| Capacidad | Web | Mobile | Estado | Notas |
| --- | --- | --- | --- | --- |
| Narrativa del perfil | Sí | Sí | `PARIDAD` | |
| Conteo de credenciales | Sí | Sí | `PARIDAD` | |
| Horas oficiales declaradas | Sí | Sí | `PARIDAD` | Con la misma aclaración de que no es una distribución por área. |
| Confianza del análisis | Sí | Sí | `PARIDAD` | Con la misma aclaración de que no mide el conocimiento de la persona. |
| Aviso de cobertura (horas) | Sí | Sí | `PARIDAD` | |
| Aviso de cobertura (semántica) | Sí | Sí | `PARIDAD` | |
| Aviso de interpretación revisada por el emisor | Sí | Sí | `PARIDAD` | |
| Áreas principales + horas estimadas | Sí | Sí | `PARIDAD` | |
| Habilidades del perfil | Sí | Sí | `PARIDAD` | |
| Conceptos relevantes | Sí | Sí | `PARIDAD` | |
| Indicador de procedencia (Emisor / IA) | Sí | Sí | `PARIDAD` | Web usa `title` como refuerzo en desktop; Mobile usa `accessibilityLabel`. El texto visible es idéntico. |
| Leyenda que explica Emisor / IA | Sí | Sí | `PARIDAD` | |
| Información declarada por instituciones | Sí | Sí | `PARIDAD` | Filas de texto multilínea en ambas. |
| Quality flags humanizados | Sí | Sí | `PARIDAD` | |
| Fecha de generación | Sí | Sí | `PARIDAD` | |
| Estado vacío de perfil | Sí | Sí | `PARIDAD` | |
| Estado de error de perfil sin ocultar credenciales | Sí | Sí | `PARIDAD` | |
| Diagnóstico de contrato (modo debug) | Sí (`ContractDiagnostic`) | No | `WEB-ONLY INTENCIONAL` | Herramienta de desarrollo web. En Mobile, el diagnóstico viaja dentro de `IncompatiblePayloadError` y se ve en los tests y en los logs de desarrollo. |

### 2.3 Credenciales

| Capacidad | Web | Mobile | Estado | Notas |
| --- | --- | --- | --- | --- |
| Lista de credenciales propias | Sí | Sí | `PARIDAD` | |
| Los 4 tipos (asignatura, curso, certificación, título) | Sí | Sí | `PARIDAD` | |
| Estado emitida / revocada | Sí | Sí | `PARIDAD` | |
| Indicador de evidencia de integridad | Sí | Sí | `PARIDAD` | |
| Indicador de análisis disponible | Sí | Sí | `PARIDAD` | |
| Contadores de resumen (emitidas / revocadas / con análisis) | Sí | No | `WEB-ONLY INTENCIONAL` | En Web ocupan una fila de 3 tarjetas; en una pantalla angosta serían tres bloques que empujan el contenido real hacia abajo sin agregar información que la lista no muestre ya. |
| Anticipo de credenciales en el perfil | Sí (2) | Sí (2) | `PARIDAD` | |
| Grilla de 2 columnas | Sí | No | `MOBILE-ADAPTED` | Lista vertical con `FlatList`. |
| Navegación al detalle | Enlace "Ver credencial" | Tarjeta completa | `MOBILE-ADAPTED` | Objetivo táctil mayor. |
| Estado vacío | Sí | Sí | `PARIDAD` | Sin acciones de emisor en ninguna de las dos. |
| Búsqueda / filtros | No | No | `PARIDAD` | Ninguna de las dos lo tiene. |

### 2.4 Detalle de credencial

| Capacidad | Web | Mobile | Estado | Notas |
| --- | --- | --- | --- | --- |
| Identidad (estado, tipo, título, emisor) | Sí | Sí | `PARIDAD` | |
| DID institucional | Sí | Sí | `PARIDAD` | |
| Titular y fecha de emisión | Sí | Sí | `PARIDAD` | |
| Aviso de revocación con motivo | Sí | Sí | `PARIDAD` | Mobile agrega además la fecha de revocación. |
| Datos emitidos (programa, período, calificación, horas…) | Sí | Sí | `PARIDAD` | |
| Descripción | Sí | Sí | `PARIDAD` | |
| Habilidades / competencias / resultados declarados | Sí | Sí | `PARIDAD` | Texto multilínea en ambas, hasta 500 caracteres. |
| Datos declarados de curso (plataforma, modalidad, URL) | Sí | Sí | `PARIDAD` | |
| Apertura de la URL declarada | `<a target=_blank>` | `Linking.openURL` | `MOBILE-ADAPTED` | |
| Interpretación asistida (áreas / habilidades / conceptos) | Sí | Sí | `PARIDAD` | |
| Estado del análisis (completo / parcial) | Sí | Sí | `PARIDAD` | |
| Confianza del análisis | Sí | Sí | `PARIDAD` | |
| Observaciones (quality flags) | Sí | Sí | `PARIDAD` | |
| Ausencia de análisis explicada | Sí | Sí | `PARIDAD` | |
| Evidencia documental (nombre, tipo, tamaño, huella, fecha) | Sí | Sí | `PARIDAD` | |
| Evidencia textual (etiqueta, vista previa, huella, fecha) | Sí | Sí | `PARIDAD` | Mobile además muestra el conteo de caracteres, que el contrato ya provee. |
| Vista previa textual recortada a 4 líneas | Sí (`line-clamp-4`) | No | `MOBILE-ADAPTED` | En Mobile el texto fluye completo: no hay hover ni "ver más" que lo revele. |
| Huella canónica y versión de canonicalización | Sí | Sí | `PARIDAD` | |
| Registro de blockchain (red, chainId, estado, tx, fecha) | Sí | Sí | `PARIDAD` | |
| Integridad plegable | No (siempre visible) | Sí (plegada) | `MOBILE-ADAPTED` | Recupera espacio vertical. |
| Copiar valores técnicos | No | Sí | `MOBILE-ADAPTED` | En Web se seleccionan con el mouse; en táctil eso es incómodo. |
| Distinción 404 / 403 / 401 / red / contrato | Sí | Sí | `PARIDAD` | |
| Apertura del documento de evidencia | No | No | `PARIDAD` | El contrato del titular no expone una URL de descarga. Ver `11-brechas`. |

### 2.5 Acciones

| Capacidad | Web | Mobile | Estado | Notas |
| --- | --- | --- | --- | --- |
| Actualizar perfil (`POST /me/profile/rebuild`) | Sí | Sí | `PARIDAD` | Mismo endpoint, mismo copy, misma condición (sólo con credenciales emitidas). |
| Compartir perfil (`POST /me/profile/share`) | Panel desplegable con campos y botones de copiar | Share sheet nativo + copiar + ver vista pública | `MOBILE-ADAPTED` | Misma capacidad de dominio, misma API, interacción de plataforma. |
| Compartir credencial | Panel desplegable con enlace y código | Share sheet nativo + copiar + ver vista pública | `MOBILE-ADAPTED` | Ninguna de las dos llama a un endpoint: el enlace es `/verify?credential=<ref>`. |
| Mostrar el "código de credencial" al compartir | Sí | No | `WEB-ONLY INTENCIONAL` | En Web se ofrece para pegarlo a mano en el verificador. En Mobile el share sheet ya entrega el enlace completo; un segundo campo copiable competiría con la acción principal. Reevaluar si aparece un flujo de verificación por código. |
| Vista pública del perfil | Ruta web propia | Se abre en el navegador | `MOBILE-ADAPTED` | El verificador es y sigue siendo web (nunca WebView embebido). |
| Verificación pública de credenciales | Sí (`/verify`) | No nativo | `WEB-ONLY INTENCIONAL` | Superficie pública, no del titular. |
| Emisión de credenciales | No (es del emisor) | No | `PARIDAD` | |

### 2.6 Capacidades específicamente móviles

| Capacidad | Web | Mobile | Estado |
| --- | --- | --- | --- |
| Pull-to-refresh | No aplica | Sí | `MOBILE-ADAPTED` |
| Persistencia segura de sesión entre arranques | No | Sí | `MOBILE-ADAPTED` |
| Manejo de teclado en el formulario de acceso | No aplica | Sí | `MOBILE-ADAPTED` |
| Áreas seguras (notch, home indicator) | No aplica | Sí | `MOBILE-ADAPTED` |
| Icono de app, splash y esquema `scope://` | No aplica | Sí | `MOBILE-ADAPTED` |

## 3. Resumen

| Estado | Cantidad |
| --- | --- |
| `PARIDAD` | 48 |
| `MOBILE-ADAPTED` | 14 |
| `WEB-ONLY INTENCIONAL` | 6 |
| `MOBILE-PENDING` | **0** |

**No hay ninguna capacidad del Holder Web que Mobile deba tener y no tenga.**
Las seis diferencias `WEB-ONLY INTENCIONAL` están justificadas arriba una por
una, y ninguna oculta funcionalidad que el titular necesite en el teléfono.

## 4. Plantilla para una capacidad nueva

Copiar esta ficha al agregar cualquier capacidad al Holder:

~~~
CAPACIDAD:
CAPACIDAD DE DOMINIO:
CAMBIO EN BACKEND:            (sí / no — cuál)
CAMBIO EN WEB:                (sí / no — dónde)
CAMBIO EN MOBILE:             (sí / no — dónde)
ESTADO DE PARIDAD:            PARIDAD | MOBILE-ADAPTED | WEB-ONLY INTENCIONAL | MOBILE-PENDING
CONTRATO DE API:              (método, ruta, shape relevante)
TESTS WEB:
TESTS MOBILE:
DOCS ACTUALIZADAS:            (qué archivos de esta carpeta)
~~~
