/**
 * Vocabulario de AuditLog para el plano de plataforma -- slice S2.
 *
 * POR QUE UNA CONSTANTE Y NO UN LITERAL EN EL CALL SITE. `AuditLog.action` y
 * `AuditLog.resourceType` son columnas `String` LIBRES (ver `schema.prisma`):
 * no hay enum que las restrinja. Y hasta S2 la tabla no tenia NINGUN writer en
 * todo el repo, asi que tampoco habia una convencion previa que copiar
 * (verificado al abrir S2: 0 ocurrencias de `auditLog` en `src/` y `prisma/`).
 * Centralizar los literales es lo que impide que S5a/S5b inventen una segunda
 * ortografia del mismo hecho y que una consulta de auditoria tenga que conocer
 * dos vocabularios.
 *
 * DE DONDE SALE CADA FORMA -- derivado del repo, no elegido por gusto:
 *
 *   `resourceType` = el nombre del modelo Prisma VERBATIM. Esta columna va
 *   siempre junto a `resourceId` (un UUID de PK) bajo
 *   `@@index([resourceType, resourceId])`, indice que existe para preguntar
 *   "que le paso a esta entidad". El nombre del modelo es el unico
 *   identificador de "tipo de entidad" que ya existe en el sistema; cualquier
 *   transformacion (`platform_admin`) seria una invencion.
 *
 *   `action` = snake_case, que es la forma de TODO string persistido y de todos
 *   los valores de enum del repo (`credential_v1`, `blockchain_record_v1`,
 *   `semantic_analysis_v1`, `issuer_admin`, `academic_subject`). No existe
 *   ninguna convencion dotted en el repositorio.
 *
 * Este archivo es deliberadamente solo literales: no importa Prisma, no hace
 * ninguna llamada, y por lo tanto no convierte a `src/` en un writer de
 * `PlatformAdmin` (ver `__guards__/platform-admin-write-surface.test.ts`). El
 * unico writer vive fuera de `src/`, en `prisma/bootstrap-platform-admin.ts`.
 *
 * Vive aca y no en `prisma/` porque S5a/S5b van a escribir AuditLog desde
 * servicios de `src/platform-admin/`, y `prisma/` importando de `src/` ya es un
 * patron del repo (`seed.ts` importa `hashPassword` de `../src/auth/...`),
 * mientras que lo inverso no ocurre en ningun lado.
 */

/** Entidad afectada por un grant de plataforma: el nombre del modelo. */
export const PLATFORM_ADMIN_RESOURCE_TYPE = 'PlatformAdmin';

/**
 * Se otorgo la capacidad de administracion de plataforma a un User.
 *
 * Se registra UNA SOLA VEZ, en la transaccion que realmente crea la fila
 * `PlatformAdmin`. Una ejecucion idempotente posterior del bootstrap NO
 * escribe un segundo AuditLog: no hubo un nuevo hecho que auditar.
 */
export const PLATFORM_ADMIN_GRANTED_ACTION = 'platform_admin_granted';

/** Entidad afectada por un grant institucional: el nombre del modelo. */
export const ISSUER_MEMBERSHIP_RESOURCE_TYPE = 'IssuerMembership';

/**
 * Un PlatformAdmin asigno un User existente a un Issuer existente.
 *
 * S5a lo escribe en la MISMA transaccion que crea la fila `IssuerMembership`,
 * con `resourceId` = el id de esa fila y `actorType = system_admin` (un
 * PlatformAdmin humano actuando por HTTP, a diferencia del `system` del
 * bootstrap de S2, que no tiene actor en una request).
 *
 * Vive aca y no como literal en el service por el mismo motivo que las dos
 * constantes de arriba: `AuditLog.action` y `resourceType` son columnas
 * `String` libres, sin enum que las restrinja, y centralizarlas es lo que
 * impide que un slice futuro invente una segunda ortografia del mismo hecho.
 */
export const ISSUER_MEMBERSHIP_GRANTED_ACTION = 'issuer_membership_granted';
