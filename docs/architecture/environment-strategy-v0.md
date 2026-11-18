# Estrategia de ambientes v0

> **Vigencia.** Se conserva esta ruta por continuidad documental. La estrategia
> se alinea con la arquitectura AWS definida en el repositorio; el estado de
> cada entorno desplegado requiere comprobación externa.

## Proposito

Separar desarrollo local, infraestructura definida para AWS y antecedentes de
demo, evitando que variables, secretos o servicios de un entorno se usen como
fallback silencioso en otro.

## Decision

| Capacidad | Desarrollo local | Infraestructura AWS definida | Estado externo por comprobar |
| --- | --- | --- | --- |
| Web | Next.js local. | El repositorio no fija el proveedor de alojamiento web. Vercel puede participar en previews o hosting. | Hosting, dominio y origen CORS efectivos. |
| API | NestJS local. | Imagen en ECR y tarea ECS/Fargate detrás de ALB. | Imagen seleccionada, tarea saludable, listener y DNS. |
| IA | FastAPI local. | Imagen en ECR y tarea ECS/Fargate separada, comunicada internamente por la API. | Capacidad, conectividad interna y configuración activa. |
| Datos | PostgreSQL local o de prueba. | RDS PostgreSQL. | Instancia, migraciones, backups y credenciales operativas. |
| Evidencia documental | Storage local o S3 configurado. | S3 privado consumido por la API. | Bucket, permisos por prefijo y ciclo de vida. |
| Secretos | `.env` no versionado. | SSM y Secrets Manager, entregados a tareas por roles acotados. | Valores cargados y permisos efectivos. |
| Observabilidad | Logs locales. | CloudWatch Logs y alarmas habilitables. | Retención, alarmas y monitoreo activos. |
| Blockchain | `mock` o Anvil. | Target configurable independiente de la infraestructura AWS. | RPC, contrato, signer y evidencia on-chain. |

## Reglas

- No copiar secretos entre entornos ni publicarlos mediante `NEXT_PUBLIC_*`.
- La API es la única frontera de dominio para web, móvil, IA y blockchain.
- Las tareas solo reciben los secretos que necesitan; Terraform declara nombres
  y permisos, no valores secretos.
- Las migraciones no forman parte del arranque de API o AI Service. El workflow
  de migración y sus pasos requieren revisión operativa.
- El estado `mock`, Anvil o Base Sepolia no se infiere de la existencia de
  código o manifests; depende de la configuración y verificación del entorno.

## Variables por responsabilidad

Frontend solo conoce la URL pública de API. NestJS conoce DB, S3, FastAPI y
signer del ambiente. FastAPI conoce su JWT interno y configuración analítica,
pero no credenciales de usuarios, DB de dominio, S3 o blockchain.

## Alcance

- matriz de servicios, secretos y responsabilidades;
- frontera de variables públicas/privadas;
- distinción entre configuración versionada y estado externo.

## Fuera de alcance

- archivos `.env` reales;
- secretos, manifests o pipelines ejecutables;
- disaster recovery productivo;
- multi-region o alta disponibilidad.

## Impacto en modulos actuales

Los módulos leen configuración explícita. `DOCUMENT_STORAGE_PROVIDER=local|s3`
evita instanciar AWS durante desarrollo local. API y AI Service validan su
configuración antes de atender solicitudes; una configuración incompleta falla
de forma controlada y no debe degradar a otro proveedor.

## Riesgos

- drift de schema, secretos o imágenes entre el código y el entorno;
- CORS de previews u orígenes de web no confirmados;
- conectividad interna o capacidad insuficiente del AI Service;
- confundir configuración declarada con recursos activos;
- confundir variables públicas con secretos.

## Proximos slices relacionados

La revisión de runbooks demo, migraciones SQL y documentación blockchain se
mantiene como trabajo posterior.
