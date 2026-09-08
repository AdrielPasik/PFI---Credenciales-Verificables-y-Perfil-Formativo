# Scope Holder Mobile — Índice y estado

> **Estado:** implementación v1 completa y validada localmente.
> **Fecha:** 2026-09-07.
> **Alcance:** aplicación móvil nativa **exclusivamente para el Titular / Holder**.
> **Ubicación del código:** `apps/mobile/`.

---

## 1. Qué es Scope Holder Mobile

Una aplicación nativa (React Native + Expo + TypeScript) que consume el backend
NestJS de Scope y permite a un titular:

- iniciar sesión con su cuenta de Scope;
- entender su **perfil formativo** (narrativa, áreas, habilidades, conceptos,
  cobertura, información declarada por instituciones);
- consultar sus **credenciales** y el detalle de cada una;
- inspeccionar el **aporte formativo**, la **interpretación asistida**, las
  **fuentes de respaldo** y la **evidencia de integridad**;
- **compartir** su perfil y una credencial mediante el share sheet nativo;
- **actualizar** su perfil (recomposición determinística, sin IA);
- cerrar sesión.

No es —y nunca debe convertirse en— un portal de emisor, una app institucional,
un verificador nativo, un WebView de la web, ni una billetera cripto.

## 2. Estado de implementación

| Área | Estado |
| --- | --- |
| Workspace `apps/mobile` integrado al monorepo npm | Implementado |
| Expo SDK 57 + Expo Router + TypeScript estricto | Implementado |
| Autenticación Bearer + `expo-secure-store` | Implementado |
| Capa HTTP centralizada + adaptación de contratos | Implementado |
| Navegación protegida (2 pestañas + stack de detalle) | Implementado |
| Pantalla de acceso | Implementado |
| Perfil formativo | Implementado |
| Biblioteca de credenciales | Implementado |
| Detalle de credencial | Implementado |
| Compartir perfil y credencial (share sheet nativo) | Implementado |
| Actualizar perfil | Implementado |
| Design system nativo (tokens Scope) | Implementado |
| Assets de marca derivados del logo aprobado | Implementado |
| Tests (203, 13 suites) | Verde |
| Typecheck / lint / Expo Doctor | Verde (21/21 doctor) |
| Export de bundle Android e iOS | Verde |
| `eas.json` (development / preview interno: APK Android o ad hoc iOS / production store: AAB Android o IPA iOS) | Configurado, **sin ejecutar** |
| Build en la nube, cuenta EAS, publicación en tiendas | **NO ejecutado** (fuera de alcance) |

**Backend, AI service, Prisma y migraciones: sin ningún cambio.** Holder Web e
Issuer Web: sin ningún cambio.

## 3. Arquitectura en una pantalla

~~~
apps/mobile (Expo / React Native)
        |
        |  HTTPS, Authorization: Bearer <JWT>
        v
services/api (NestJS)  <-- ÚNICO servicio con el que habla la app
        |
        +--> services/ai-service (FastAPI)
        +--> Prisma / PostgreSQL
        +--> Blockchain
        +--> Storage
~~~

La app **nunca** habla con la IA, la blockchain, el storage ni la base de datos.
Todo lo que muestra viene del backend NestJS.

## 4. Navegación

~~~
app/
  _layout.tsx                          providers + fuentes + splash
  index.tsx                            decide destino según la sesión
  login.tsx                            acceso (holder-oriented)
  (holder)/
    _layout.tsx                        guardia de sesión + stack
    (tabs)/
      _layout.tsx                      pestañas: Perfil | Credenciales
      index.tsx                        Perfil formativo  <- inicio del titular
      credentials.tsx                  Mis credenciales
    credentials/
      [credentialId].tsx               Detalle (stack anidado, no pestaña)
~~~

## 5. Comandos principales

Todos desde `apps/mobile/`.

```bash
npm start
```

```bash
npm run android
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

## 6. Por dónde empezar a leer

| Si querés… | Leé |
| --- | --- |
| Correr la app hoy | `13-handoff.md` |
| Entender decisiones técnicas | `01-arquitectura-y-stack.md` |
| Saber qué endpoints se consumen | `04-api-y-contratos.md` |
| Entender la sesión y su seguridad | `05-autenticacion-y-sesion.md` |
| Saber qué existe en Web y qué en Mobile | `03-ledger-de-paridad-web-mobile.md` |
| Generar un APK para la demo del PFI | `10-plan-de-deployment.md` |
| Saber qué falta | `11-brechas-y-trabajo-futuro.md` |
| Agregar una capacidad nueva sin romper la paridad | `12-protocolo-de-sincronizacion-holder.md` |

## 7. Documentos de esta carpeta

| Archivo | Contenido |
| --- | --- |
| `00-indice-y-estado.md` | Este documento. |
| `01-arquitectura-y-stack.md` | Stack, capas, decisiones y sus porqués. |
| `02-arquitectura-de-informacion-mobile.md` | Navegación y jerarquía de información. |
| `03-ledger-de-paridad-web-mobile.md` | Matriz de capacidades Web ↔ Mobile. |
| `04-api-y-contratos.md` | Inventario de endpoints y estrategia de adaptación. |
| `05-autenticacion-y-sesion.md` | Contrato real de auth, persistencia y límites. |
| `06-design-system-mobile.md` | Tokens, componentes y accesibilidad. |
| `07-especificacion-de-pantallas.md` | Especificación pantalla por pantalla. |
| `08-registro-de-implementacion.md` | Bitácora y registros de decisión (ADR). |
| `09-testing-y-calidad.md` | Estrategia de tests y matriz manual. |
| `10-plan-de-deployment.md` | Ciclo completo de entrega, APK, tiendas. |
| `11-brechas-y-trabajo-futuro.md` | Brechas clasificadas por severidad y dueño. |
| `12-protocolo-de-sincronizacion-holder.md` | Cómo mantener Web y Mobile alineados. |
| `13-handoff.md` | "Continuá desde acá". |

## 8. Nota sobre el control de versiones

`mejoras post 50%/` está listado en `.gitignore` (línea 119). Esta documentación
**no queda versionada en git**: vive en el árbol de trabajo local, igual que el
resto de los materiales de esa carpeta. Si en el futuro se decide versionarla,
hay que mover la carpeta fuera de `mejoras post 50%/` (por ejemplo a
`docs/mobile/`) o ajustar el `.gitignore` de forma explícita y consciente.

## 9. Documentos previos que este trabajo supersede

- `docs/frontend/scope-holder-mobile-app-blueprint-v1.md` — planificación.
  Sigue siendo válido como razonamiento de producto; la implementación real es
  la que manda cuando difieren.
- `docs/frontend/scope-holder-mobile-handoff-v0.md` — histórico, ya marcado como
  superseded por el blueprint.

Ninguno de los dos se borró: contienen razonamiento de diseño útil.
