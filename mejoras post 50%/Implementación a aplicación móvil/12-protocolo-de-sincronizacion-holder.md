# Protocolo de sincronización Holder Web ↔ Holder Mobile

## 1. El problema que este documento resuelve

Scope va a seguir evolucionando. Cada capacidad nueva del titular se va a
implementar primero en algún lado —normalmente en Web— y **el riesgo real es que
nadie se acuerde de Mobile hasta que un usuario lo note**.

Este protocolo existe para que la paridad no dependa de que alguien se acuerde.

## 2. Regla base

> **Toda capacidad de dominio del titular debe tener una fila en
> `03-ledger-de-paridad-web-mobile.md`, con uno de los cuatro estados. Sin
> excepciones.**

Que una capacidad esté marcada `WEB-ONLY INTENCIONAL` está perfecto. Que **no
esté** en el ledger es el problema: significa que nadie decidió nada.

## 3. Disparadores

Volver a este documento cuando ocurra cualquiera de estas cosas:

| Disparador | Por qué |
| --- | --- |
| Se agrega una pantalla o acción al Holder Web | Candidata a paridad. |
| Cambia un DTO de `/me/**` o `/auth/**` | Los dos adaptadores tienen que aceptarlo. |
| Se agrega un endpoint bajo `/me/**` | Mobile podría necesitar consumirlo. |
| Cambia el copy de un concepto de dominio | La terminología tiene que coincidir. |
| Cambian los tokens de marca en `globals.css` | `tokens.ts` los replica a mano. |
| Cambia el flujo de autenticación | La sesión de Mobile lo asume tal cual está. |
| Cambia la semántica de compartir | Mobile compone los enlaces con las mismas reglas. |
| Se sube el SDK de Expo o React en Web | Revisar el ADR-02 de la versión de React. |

## 4. Procedimiento para una capacidad nueva

### Paso 1 — Registrar la capacidad

Copiar esta ficha al PR o al registro de la capacidad:

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
DOCS ACTUALIZADAS:
~~~

### Paso 2 — Decidir el estado

~~~
¿La capacidad tiene sentido para alguien con el teléfono en la mano?
        │
        ├── NO  ──► WEB-ONLY INTENCIONAL
        │           Registrar el motivo en el ledger. Fin.
        │
        └── SÍ
             │
             ¿La interacción de Web se traduce bien a táctil?
                   │
                   ├── SÍ ──► PARIDAD          (misma capacidad, misma interacción)
                   └── NO ──► MOBILE-ADAPTED   (misma capacidad, gesto nativo)
                              Registrar POR QUÉ difiere.
~~~

Si se decide implementarla pero todavía no hay tiempo: `MOBILE-PENDING`, con
fecha y responsable. **`MOBILE-PENDING` es deuda visible, no un estado neutro.**

### Paso 3 — Implementar en Mobile

Orden habitual:

1. `src/types/**` — modelo, si aparece un dato nuevo.
2. `src/lib/adapters/**` — adaptación y validación del payload.
3. `src/lib/api/scope-api.ts` — el endpoint, si es nuevo.
4. `src/features/<dominio>/use-*.ts` — hook de datos.
5. `src/features/<dominio>/*-screen.tsx` — la pantalla.
6. `app/**` — la ruta, si hace falta (mínima: sólo orquesta).
7. Tests.

### Paso 4 — Tests obligatorios

| Tipo | Qué |
| --- | --- |
| Adaptador | Payload válido, campos opcionales ausentes, payload inválido rechazado. |
| Pantalla | Estado listo, vacío, error y (si aplica) parcial. |
| Regla de producto | Que **no** haga lo que no debe (ver §6). |

### Paso 5 — Actualizar el ledger

Agregar o modificar la fila en `03-ledger-de-paridad-web-mobile.md` y actualizar
los totales del resumen.

### Paso 6 — Actualizar la documentación afectada

| Cambió… | Actualizar |
| --- | --- |
| Un endpoint | `04-api-y-contratos.md` |
| Autenticación | `05-autenticacion-y-sesion.md` |
| Tokens o componentes | `06-design-system-mobile.md` |
| Una pantalla | `07-especificacion-de-pantallas.md` |
| Una decisión relevante | `08-registro-de-implementacion.md` (nuevo ADR) |
| Estrategia de tests | `09-testing-y-calidad.md` |
| Build o entrega | `10-plan-de-deployment.md` |
| Apareció una limitación | `11-brechas-y-trabajo-futuro.md` |

## 5. Cambios de contrato (el caso más peligroso)

Mientras `packages/shared-types` siga vacío, **la adaptación está duplicada** en
Web y en Mobile. Un cambio de contrato aplicado en un solo lado rompe el otro en
silencio, y probablemente en producción.

### Lista de verificación

- [ ] ¿El campo nuevo es opcional en el contrato? Si sí, el adaptador de Mobile
      debe tratar su **ausencia** como válida, no como error.
- [ ] ¿Se renombró un campo? Entonces hace falta un **alias**: leer el nombre
      vigente y caer al histórico **sólo si el vigente está `undefined`**, nunca
      si vino `null`.
- [ ] ¿Cambió el tipo de un campo (string → objeto descriptor)? Aceptar **las
      dos formas**, como ya se hace con las etiquetas semánticas.
- [ ] ¿Cambió un límite de longitud? Actualizar `DECLARED_ARRAY_ITEM_MAX_LENGTH`
      o `SEMANTIC_LABEL_MAX_LENGTH` en `src/lib/adapters/contract.ts`.
- [ ] ¿Apareció un valor nuevo en un enum (tipo o estado de credencial)?
      Agregarlo a `CREDENTIAL_TYPES` / `CREDENTIAL_STATUSES` **y** a
      `TYPE_LABELS`. Si no, el adaptador rechaza el payload entero.
- [ ] Agregar una fixture del caso nuevo en `src/test/fixtures.ts`.
- [ ] Agregar el caso a los tests de tortura.

### Regla de oro del adaptador

> **Un dato principal inválido rechaza el payload. Un dato secundario malformado
> degrada a "no mostrar".**

Ejemplo vigente: `provenanceSummary` degrada a `null` sin tirar abajo el perfil;
en cambio un `profileVersion` inválido sí lo rechaza.

## 6. Reglas de producto que ninguna capacidad nueva puede romper

Estas están cubiertas por tests. Si una capacidad nueva las viola, los tests
fallan — que es exactamente lo que se busca.

| Regla | Test que la protege |
| --- | --- |
| Nunca se muestra un puntaje, nivel o métrica que el backend no provea | `profile-screen.test.tsx` |
| La confianza describe el **análisis**, no a la persona | `profile-screen.test.tsx` |
| "Sin evidencia suficiente" ≠ "la persona no tiene la capacidad" | Copy verificado |
| Lo declarado por la institución y lo interpretado por IA nunca se mezclan | `profile-screen.test.tsx`, `credential-detail-screen.test.tsx` |
| Nunca aparece "certificado por IA" ni "verificado por IA" | `credential-detail-screen.test.tsx` |
| Ninguna superficie de emisor, en ningún estado | `login-screen.test.tsx`, `account-menu-button.test.tsx` |
| El modelo de usuario no filtra datos de emisor | `scope-api.test.ts` |
| Actualizar perfil sólo por acción explícita | `profile-screen.test.tsx` |
| Compartir sólo por acción explícita, sin duplicar | `profile-screen.test.tsx` |
| El contenido declarado nunca se trunca | `profile-screen.test.tsx`, `credential-detail-screen.test.tsx` |
| Los errores se distinguen entre sí | `holder-error-mapper` vía las pantallas |
| La contraseña nunca se persiste | `session-provider.test.tsx` |
| Un 403 no cierra la sesión | `session-provider.test.tsx` |
| El error del servidor no se filtra a la UI | `http-client.test.ts` |
| Sólo se abren URLs http(s) | `share-links.test.ts` |

## 7. Cambios de marca

Los tokens de Mobile **replican** los de Web; no los importan. Si cambia
`apps/web/src/app/globals.css`:

1. Actualizar `apps/mobile/src/lib/theme/tokens.ts`.
2. Si cambió el logo, regenerar los assets:
   `node scripts/generate-brand-assets.js`
3. Actualizar `06-design-system-mobile.md`.

## 8. Cambios de versión

| Cambio | Acción en Mobile |
| --- | --- |
| React en `apps/web` | **Revisar el ADR-02.** Si Web y Mobile convergen en la misma versión exacta, se puede quitar `expo.install.exclude`. Si divergen de *minor*, hay que resolverlo de otra forma: volvería la doble copia de React. |
| SDK de Expo | `npx expo install --fix`, después `npm run doctor`, tests, typecheck y export. |
| TypeScript | Verificar que `apps/web` y `apps/mobile` sigan resolviendo una sola copia. |

## 9. Revisión periódica

Aunque no haya cambios, revisar cada dos o tres meses:

- [ ] ¿El ledger sigue reflejando el Holder Web real?
- [ ] ¿Hay filas `MOBILE-PENDING` sin dueño ni fecha?
- [ ] ¿Los tests siguen en verde?
- [ ] ¿`npm run doctor` sigue en 21/21?
- [ ] ¿Salió una versión nueva del SDK de Expo?
- [ ] ¿Las brechas de `11-brechas-y-trabajo-futuro.md` siguen bien clasificadas?

## 10. Qué NO es paridad

Para que nadie pierda tiempo persiguiendo el objetivo equivocado:

| No es paridad | Es paridad |
| --- | --- |
| Misma geometría de componentes | Misma capacidad de dominio |
| Misma navegación | Misma jerarquía semántica |
| Mismos gestos | Mismos datos y estados |
| Mismo layout | Mismo lenguaje y terminología |
| Mismo código | Mismos contratos |

Un share sheet nativo y un panel desplegable son **la misma capacidad**. Un
perfil que en Web muestra la procedencia y en Mobile no, **no lo es**.
