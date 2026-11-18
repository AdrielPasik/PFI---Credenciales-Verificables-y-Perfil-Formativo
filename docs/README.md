# Documentación de Scope

Esta carpeta reúne la documentación técnica del sistema. Para conocer Scope por
primera vez, conviene comenzar por el [README principal](../README.md) y luego
seguir el recorrido que corresponda al tema de interés.

## Recorrido recomendado

1. [Arquitectura](architecture/README.md): responsabilidades de los
   componentes, reglas de dominio, modelo de datos, contratos y seguridad.
2. [Flujos](flows/README.md): emisión, análisis semántico y verificación de
   credenciales.
3. [Inteligencia artificial](ai/README.md): servicio, contratos, persistencia,
   taxonomía y límites del análisis formativo.
4. [Decisiones arquitectónicas](decisions/README.md): razones y consecuencias
   de las decisiones relevantes del proyecto.

## Documentación por tema

| Tema | Dónde consultarlo |
| --- | --- |
| Arquitectura, dominio y seguridad | `architecture/`, en especial `architecture-v1.md`, `domain-rules-v0.md`, `data-model-v0.md` y `auth-and-permissions-v0.md`. |
| Contratos HTTP y esquemas compartidos | `architecture/api-contracts-v0.md`, `api/README.md` y `packages/schemas/README.md`. |
| IA y perfil formativo | `ai/README.md` y `services/ai-service/README.md`. |
| Credenciales y evidencia blockchain | `blockchain/README.md`, `architecture/canonicalization-and-hashing-v0.md` y `contracts/README.md`. |
| Web y aplicación móvil | `frontend/README.md`, `apps/web/README.md` y `apps/mobile/`. |
| Operación y despliegue | Runbooks y registros en `architecture/`; `infra/terraform/` contiene los procedimientos de infraestructura. |

Algunos documentos conservan versiones de decisiones o implementaciones
anteriores. Cuando un documento se identifique como histórico, el código, los
contratos y las pruebas versionadas describen el comportamiento vigente.
