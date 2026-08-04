# Runbook de base demo Neon v0

## Proposito

Preparar una base PostgreSQL demo/staging de Traza en Neon mediante las
migraciones versionadas, el seed idempotente y una verificacion sanitaria
read-only. Este runbook no crea el proyecto Neon, no provisiona recursos y no
contiene connection strings ni secretos.

## Responsabilidad manual en Neon

Una persona autorizada debe crear el proyecto y la base, elegir una region
compatible con el API y copiar las connection strings desde el panel de Neon.
Nada de eso se versiona. `DATABASE_URL` se configura fuera del repositorio en
la sesion operativa o en el secret manager del servicio.

Neon puede ofrecer connection strings distintas:

- una URL pooled para el runtime de la API;
- una URL directa/unpooled para migraciones y operaciones administrativas.

Seguir la recomendacion vigente del proveedor para Prisma. Si se entregan dos
URLs, ejecutar `migrate deploy` y el seed con la URL administrativa directa y
configurar luego la URL pooled como `DATABASE_URL` del runtime. El schema actual
usa una sola variable `DATABASE_URL`; P4f no agrega `directUrl` ni hardcodea una
segunda URL.

## Datos que nunca se versionan

- connection strings;
- passwords o tokens Neon;
- archivos `.env` reales;
- certificados privados;
- dumps de la base;
- logs que incluyan `DATABASE_URL`.

El archivo `services/api/.env.example` solo documenta nombres y un valor local
ficticio. `.env` permanece ignorado.

## Preparacion local

Desde la raiz del repositorio:

```powershell
npm install
npm run prisma:generate --workspace @credential-intelligence/api
npm run prisma:validate --workspace @credential-intelligence/api
```

Para PostgreSQL Docker local puede usarse el `.env` ignorado y el script
historico `prisma:seed`. Para una variable ya cargada en la sesion, usar
`db:seed`.

## Provision de demo/staging

1. Crear manualmente el proyecto y la base Neon.
2. Obtener la connection string apropiada sin copiarla a archivos versionados.
3. Configurar `DATABASE_URL` fuera del repositorio.
4. Generar Prisma Client.
5. Aplicar migraciones versionadas con `migrate deploy`.
6. Ejecutar el seed/import demo explicito.
7. Ejecutar la verificacion sanitaria read-only.
8. Configurar el API con la URL de runtime apropiada y arrancarlo.
9. Probar health, login, `/auth/me` y catalogo.

Ejemplo de sesion PowerShell una vez que el secret manager o mecanismo aprobado
ya inyecto la variable en el proceso:

```powershell
if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  throw "DATABASE_URL debe configurarse fuera del repositorio antes de continuar."
}

npm run prisma:generate --workspace @credential-intelligence/api
npm run prisma:migrate:status --workspace @credential-intelligence/api
npm run prisma:migrate:deploy --workspace @credential-intelligence/api
npm run db:seed --workspace @credential-intelligence/api
npm run db:verify-demo --workspace @credential-intelligence/api
```

Antes de iniciar el API, reemplazar la variable de la sesion por la URL pooled
de runtime si Neon separa ambos usos. No imprimirla ni incluirla en comandos
guardados, tickets, capturas o bundles.

## Politica de migraciones

En demo/staging solo se usa:

```powershell
npm run prisma:migrate:status --workspace @credential-intelligence/api
npm run prisma:migrate:deploy --workspace @credential-intelligence/api
```

No ejecutar contra Neon:

```text
prisma migrate dev
prisma migrate reset
prisma db push
DROP DATABASE
```

`migrate deploy` aplica exclusivamente migraciones versionadas pendientes. No
genera migraciones nuevas ni resetea datos. Si `migrate status` detecta drift,
historial divergente o una migracion fallida, detener el despliegue y resolver
la causa; no usar reset como reparacion automatica.

## Seed e import academico

El seed actual es explicito e idempotente:

- issuer localizado por DID estable y actualizado mediante `upsert`;
- usuarios localizados por email unico y actualizados mediante `upsert`;
- membership localizada por `userId + issuerId`;
- materias y carreras localizadas por `issuerId + code`;
- curriculas por `programId + versionLabel`;
- relaciones por `curriculumVersionId + academicCourseId`;
- credenciales de autenticacion por `userId`.

La repeticion actualiza el mismo conjunto y no crea duplicados. No borra
credenciales, evidencias, snapshots historicos ni datos ajenos al seed.

```powershell
npm run db:seed --workspace @credential-intelligence/api
npm run db:seed --workspace @credential-intelligence/api
npm run db:verify-demo --workspace @credential-intelligence/api
```

La doble ejecucion es una prueba operativa opcional previa a la demo. No forma
parte del boot automatico de un ambiente productivo.

## Verificacion sanitaria

`db:verify-demo` solo ejecuta lecturas. Busca entidades por DIDs y codigos
estables cuando es posible y no imprime IDs, emails, passwords ni URL de DB.
Comprueba:

- conexion y issuer demo autorizado;
- dos usuarios demo activos con email y auth credential;
- membership admin activa;
- 617 `AcademicCourse`;
- 22 `Program`;
- 22 `CurriculumVersion`;
- 977 `ProgramCourse`;
- programa estable con codigo `3824`;
- lectura disponible de `DocumentEvidence` y `TextEvidence`.

Exit code `0` significa que las invariantes estan satisfechas. Otro codigo
indica que debe revisarse migracion, seed o configuracion; el script no intenta
resetear ni reparar datos.

## Smoke runtime

Con el API configurado para la DB demo:

```powershell
npm run start --workspace @credential-intelligence/api
```

Verificar desde otro proceso:

```text
GET  /health
POST /auth/login
GET  /auth/me
GET  /issuers/:issuerId/catalog/academic-programs?query=3824&limit=20
```

No registrar el JWT, password, URL de DB ni IDs devueltos. El endpoint health
actual comprueba el proceso HTTP; `db:verify-demo` es la comprobacion explicita
de persistencia para este slice.

## Troubleshooting

### SSL

Usar la connection string provista por Neon y sus parametros SSL recomendados.
No eliminar validacion TLS para resolver un error. Verificar que la URL no haya
sido truncada y que el reloj del host sea correcto.

### Pool y limites de conexiones

Usar la URL pooled para el API cuando corresponda. Evitar ejecutar seed,
migraciones y varias instancias del API simultaneamente sobre planes limitados.
Cerrar herramientas administrativas inactivas y revisar el limite del plan.

### Migraciones con URL pooled

Si `migrate deploy` falla mediante el pool, usar la URL administrativa directa
provista por Neon solo durante la operacion y restaurar luego la URL de runtime.

### Conteos inesperados

Confirmar que la URL apunta al ambiente correcto, ejecutar `migrate status`,
repetir el seed idempotente y volver a ejecutar `db:verify-demo`. No resetear ni
borrar filas. Si persiste, inspeccionar drift o datos cargados fuera del seed.

## Rotacion de DATABASE_URL

1. Crear o rotar la credencial en Neon.
2. Actualizar el secret fuera del repo.
3. Reiniciar de forma controlada el API.
4. Ejecutar `migrate status` con la URL administrativa apropiada.
5. Ejecutar `db:verify-demo`.
6. Revocar la credencial anterior cuando el nuevo runtime este verificado.

No registrar ninguno de los dos valores durante la rotacion.

## Checklist previo a defensa/demo

- migraciones en estado aplicado;
- `db:verify-demo` en verde;
- seed repetible sin duplicados;
- API health OK;
- login y `/auth/me` OK;
- busqueda por codigo de programa OK;
- URL del runtime configurada en secret manager;
- backups/branch de Neon revisados segun capacidad del plan;
- ninguna connection string en Git, logs, bundles o capturas;
- no ejecutar reset, migrate dev ni import destructivo.

## Limites

P4f no crea Neon real, no despliega API, no agrega deep health, backup
automatizado, PITR, pooling custom, pipeline CI/CD ni recovery productivo. No
modifica Prisma schema, migraciones, seed, endpoints, S3, IA o blockchain.
