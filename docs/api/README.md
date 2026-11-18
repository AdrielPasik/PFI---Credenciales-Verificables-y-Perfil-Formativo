# API de Scope

La API NestJS concentra autenticación, permisos, emisión, evidencias,
verificación y orquestación del análisis semántico. El código de
`services/api` define el comportamiento vigente; esta documentación explica sus
límites sin sustituir los tipos, controles de acceso ni pruebas versionadas.

## Referencias principales

- [Contratos HTTP](../architecture/api-contracts-v0.md): endpoints por dominio,
  campos admitidos, errores y límites de exposición.
- [Reglas de dominio](../architecture/domain-rules-v0.md): emisión,
  credenciales, evidencias, análisis y perfiles.
- [Autenticación y permisos](../architecture/auth-and-permissions-v0.md):
  actores, autorización institucional y fronteras de acceso.
- [Modelo de datos](../architecture/data-model-v0.md): entidades y relaciones
  relevantes.
- [`services/api/README.md`](../../services/api/README.md): ejecución local,
  módulos y validaciones del servicio.

La API pública de verificación expone solo la información necesaria para
comprobar el estado técnico de una credencial. Los endpoints internos de IA y
los datos de evidencia cruda no se exponen al navegador ni a terceros.
