# Scope: Holder mobile handoff v0

## Propósito

Preparar la futura evolución de la experiencia Titular de Scope hacia mobile sin implementar una aplicación móvil ni elegir framework. Este documento describe jerarquía, patrones y contratos reutilizables; no crea rutas, endpoints ni capacidades nuevas.

## Principio mobile-first

El perfil formativo es el centro de la experiencia personal. Las credenciales funcionan como fuentes de evidencia del perfil, no como una tabla de control. La navegación debe favorecer lectura progresiva, acciones táctiles alcanzables y retorno claro entre perfil, credenciales y detalle.

## Correspondencia conceptual web -> móvil

| Ruta web actual | Pantalla móvil conceptual | Rol |
| --- | --- | --- |
| `/wallet` | Mi perfil formativo | Inicio personal y lectura agregada. |
| `/wallet/credentials` | Mis credenciales | Evidencia disponible, con estados reales. |
| `/wallet/credentials/[credentialId]` | Detalle de credencial | Fuente, estado y acceso a verificación cuando exista. |
| `/login` | Acceso | Autenticación y recuperación de sesión bajo contrato actual. |

La ruta `/wallet/profile` no existe en el frontend actual y no debe aparecer en
este handoff como destino. Sharing solo aparece cuando el grant/enlace público
real esté disponible.

## Jerarquía de información

1. perfil y resumen prudente de trayectoria;
2. áreas principales;
3. habilidades y conceptos con cobertura disponible;
4. credenciales emitidas como fuentes;
5. detalle de una fuente, evidencia de integridad y estado;
6. acciones de sharing solo si son reales y autorizadas.

La vista no debe volcar artifacts técnicos, listas ilimitadas, tablas densas, hashes como identidad, métricas decorativas ni información de otras personas.

## Estados a soportar

| Estado | Tratamiento mobile |
| --- | --- |
| Loading | Esqueleto o indicador breve que preserve estructura. |
| Empty | Explicar ausencia sin sugerir que la persona no tiene capacidades. |
| Error | Mensaje recuperable, acción clara y sin detalle técnico. |
| `partial` | Interpretación disponible con cobertura limitada explicada. |
| `issued` | Credencial vigente emitida, presentada como evidencia. |
| `revoked` | Estado visible; no ocultar historia ni presentarla como vigente. |
| Confidence unavailable | Copy prudente, no score inventado. |

## Patrones reutilizables conceptualmente

- summaries allowlisted de perfil, credencial y verificación;
- `StatusBadge`, feedback accesible, cards de evidencia y agrupaciones por áreas/habilidades/conceptos;
- formatos es-AR de fechas y horas;
- distinción entre horas oficiales declaradas e inferencias disponibles;
- navegación de detalle mediante una referencia interna segura;
- link a verificación pública solo para una credential elegible.

No trasladar literalmente desde desktop sidebars, grids de varias columnas, paneles institucionales, tablas de emisión, bloques de edición ni acciones de emisor. En desktop, la wallet puede usar espacio adicional, pero su arquitectura de información debe seguir siendo transferible a una pantalla vertical.

## Reglas táctiles y accesibilidad

- objetivos táctiles cómodos y separados;
- acciones principales en zonas alcanzables sin depender de hover;
- orden de foco equivalente al orden visual;
- labels y estados no solo por color;
- anuncios de loading/error sin autofocus agresivo;
- soporte de zoom, texto ampliado y contraste;
- respetar reducción de movimiento;
- no esconder información esencial detrás de gestos no descubiertos.

## Contratos actuales reutilizables

Pueden reutilizarse los read models holder-safe de credenciales propias, `/me/profile/current`, estados `issued`/`revoked`, respuestas de perfil y el verificador público ya allowlisted. La app móvil futura debe conservar la frontera: browser/app cliente -> NestJS; nunca FastAPI, storage, blockchain, tokens internos ni artifacts crudos.

## Capacidades que requieren backend antes de mobile

- sharing de perfil basado en token opaco y reglas de vigencia;
- paginación o estrategia de volumen para credenciales y conceptos extensos;
- contextual analysis, requirements, evidence matching, gaps y explicación;
- notificaciones, offline, deep links o APIs mobile dedicadas si se justifican;
- cualquier mutación de perfil, evidencia o credencial que hoy no tenga endpoint seguro.

## Fuera de alcance

No decide React Native, Flutter, Expo, PWA ni framework móvil. Tampoco implementa sharing nuevo, QR, wallet blockchain, análisis directo, perfiles inventados, matching contextual ni sincronización offline.

## Handoff visual futuro

Cuando el redesign Scope se estabilice, transferir primero tokens, assets y principios de `frontend-brand-and-design-system-v1.md`; luego validar la jerarquía con pantallas de perfil y credencial reales. No replicar motivos decorativos de desktop: el logo ya expresa la metáfora de integración y el contenido debe conservar la prioridad.
