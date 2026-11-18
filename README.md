# Scope

> Una nueva forma de entender tu trayectoria.

Proyecto Final de Ingeniería Informática - Universidad Argentina de la Empresa,
2026.

Scope es un sistema de credenciales educativas verificables que aborda dos
problemas relacionados: la dificultad para comprobar la autenticidad de una
credencial y la falta de información estructurada para comprender qué
formación representa dentro de una trayectoria.

La propuesta integra la emisión y verificación de credenciales con el análisis
de sus contenidos formativos. A partir de la información declarada y de las
evidencias disponibles, Scope construye perfiles que reúnen áreas de
conocimiento, habilidades y conceptos identificados, y permite relacionar esas
evidencias con requisitos de objetivos académicos o profesionales.

El sistema combina mecanismos de verificabilidad basados en blockchain con
análisis inteligente, manteniendo una distinción entre la validez de una
credencial, la interpretación de su contenido y las conclusiones que pueden
obtenerse a partir de ella.

La aplicación web demostrativa puede consultarse en
[scopeedu.technology](https://scopeedu.technology), según la disponibilidad
del entorno desplegado.

## Alcance del prototipo

Scope permite que instituciones autorizadas creen borradores, incorporen
evidencia, emitan credenciales y gestionen su revocación. Las personas titulares
pueden consultar sus credenciales y su perfil formativo desde la web y la
aplicación móvil Android. Esta última está desarrollada con React Native y Expo
y admite distribución demostrativa mediante un archivo APK instalable; no se
presenta como una publicación comercial en tiendas. Un tercero puede consultar
de forma pública el estado técnico de una credencial emitida o revocada, sin
acceder a datos privados ni a la evidencia en bruto.

El análisis inteligente procesa información formativa para identificar áreas,
habilidades y conceptos. También puede organizar la evidencia disponible frente
a requisitos de un objetivo, indicando si existe soporte, soporte parcial,
evidencia insuficiente, abstención o imposibilidad de evaluación. Estos
resultados orientan la lectura de la trayectoria: no sustituyen las reglas de
dominio, la revisión humana ni la decisión de una institución.

La evidencia de integridad se construye a partir de una representación canónica
de la credencial y se registra mediante el modo de blockchain configurado. La
información académica, documental y personal permanece fuera de la cadena.

## Arquitectura

```text
Scope Web (portal y verificación pública)   Aplicación móvil Android
                    \                           (React Native / Expo)
                     \                                  /
                      ----------- API NestJS -----------
                        |           |           |      \
                        |           |           |       \__ evidencia técnica
                   PostgreSQL  almacenamiento  FastAPI      de integridad
                                de evidencia  análisis
```

La API NestJS concentra autenticación, permisos, reglas de negocio, emisión,
canonicalización y coordinación de integraciones. La web y la aplicación móvil
consumen esta API; no se conectan directamente con el servicio de análisis ni
con la capa de blockchain. FastAPI procesa el análisis semántico interno, y el
almacenamiento documental conserva la evidencia asociada a las credenciales.

## Inteligencia artificial y trazabilidad

El servicio de IA normaliza y analiza contenido formativo proveniente de
documentos, fuentes textuales o datos declarados por el emisor. Su resultado
identifica áreas, habilidades, conceptos y observaciones de calidad. Cuando se
analiza un objetivo, Scope vincula los requisitos con evidencia direccionable y
expone un resultado prudente para cada uno.

El análisis no certifica competencias ni modifica por sí mismo una credencial
emitida. Su finalidad es aportar una interpretación trazable de la información
formativa y hacer visibles sus límites cuando la evidencia no resulta suficiente.

## Componentes del repositorio

| Ruta | Responsabilidad |
| --- | --- |
| `apps/web` | Portal institucional, wallet web, verificación y superficies públicas. |
| `apps/mobile` | Aplicación Expo del titular. |
| `services/api` | API NestJS, Prisma, permisos, emisión, verificación y orquestación. |
| `services/ai-service` | FastAPI, análisis semántico, extracción de fuentes y razonamiento. |
| `contracts` | Contrato Solidity y tooling de evidencia verificable. |
| `packages` | Schemas, tipos y constantes compartidas. |
| `infra/terraform` | Infraestructura AWS y procedimientos de operación versionados. |
| `docs` | Arquitectura, decisiones, contratos, flujos, IA y material de defensa. |

## Tecnologías principales

- TypeScript, Next.js, React y Tailwind CSS para la web.
- Expo y React Native para la aplicación móvil.
- NestJS, Prisma y PostgreSQL para la API y la persistencia.
- Python y FastAPI para análisis semántico, extracción y razonamiento.
- Solidity y Foundry para los contratos de evidencia verificable.
- AWS, Terraform, Docker y GitHub Actions para infraestructura y operación.

## Cómo revisar y ejecutar el proyecto

El repositorio es un monorepo con workspaces npm. Para revisar la web y la API
se necesita una versión de Node compatible con los paquetes del workspace. El
servicio de IA recomienda Python 3.12; las pruebas de contratos requieren
Foundry. Las integraciones que usan base de datos, almacenamiento o servicios
externos requieren la configuración local descrita en cada servicio.

```powershell
npm ci

Set-Location services/ai-service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-api-dev.txt
.\.venv\Scripts\Activate.ps1
Set-Location ../..
```

Con el entorno Python activo, los servicios de desarrollo se inician desde la
raíz del monorepo:

```powershell
npm run dev --workspace @credential-intelligence/web
npm run dev --workspace @credential-intelligence/api
npm run dev --workspace @credential-intelligence/ai-service
```

Cada servicio incluye un archivo `.env.example`. Estos comandos inician los
procesos locales, pero no garantizan un flujo integrado: la API, el
almacenamiento documental y las integraciones externas requieren las variables
y dependencias locales indicadas en sus respectivos README. No se deben
versionar valores reales de conexión, tokens, claves de firma ni credenciales
de infraestructura.

## Pruebas y validaciones

Los comandos se mantienen por workspace para que cada componente pueda
validarse de forma independiente.

```powershell
npm run typecheck --workspace @credential-intelligence/web
npm run lint --workspace @credential-intelligence/web
npm run test --workspace @credential-intelligence/web
npm run build --workspace @credential-intelligence/web

npm run test --workspace @credential-intelligence/api
npm run build --workspace @credential-intelligence/api
npm run prisma:validate --workspace @credential-intelligence/api

npm run test --workspace @credential-intelligence/ai-service
npm run python:check --workspace @credential-intelligence/ai-service
```

Para los contratos:

```powershell
Set-Location contracts
forge test
```

Las pruebas unitarias y contractuales no deben requerir secretos reales. Las
pruebas de integración se ejecutan únicamente cuando su entorno local está
configurado.

## Documentación relevante

- [Arquitectura y decisiones](docs/architecture/README.md)
- [ADRs](docs/decisions/README.md)
- [Servicio y evolución de IA](docs/ai/README.md)
- [Flujos de emisión, análisis y verificación](docs/flows/README.md)

Cuando exista una diferencia entre documentación histórica y comportamiento
actual, el código, los contratos y las pruebas versionadas son la fuente de
verdad.

## Estado y límites

Scope es un prototipo académico en evolución. La validez académica de una
credencial depende de su emisor. La evidencia blockchain registra información
técnica de integridad y el análisis de IA aporta interpretación sobre la
formación disponible; ninguno de los dos mecanismos reemplaza esa autoridad.

La documentación de arquitectura y los ADRs registran las capacidades
implementadas, las dependencias de entorno y las líneas de evolución pendientes.
