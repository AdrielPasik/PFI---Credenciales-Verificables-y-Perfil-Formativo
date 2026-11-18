# Scope

> Una nueva forma de entender tu trayectoria.

**Scope: sistema de credenciales educativas verificables con blockchain y
análisis inteligente para interpretar trayectorias formativas.** Es el Proyecto
Final de Ingeniería Informática de Adriel Pasik.

Las credenciales educativas y formativas suelen quedar dispersas entre
instituciones, plataformas, certificados y documentos. Verificar su origen es
importante, pero no alcanza para comprender qué contenidos representa una
trayectoria. Scope reúne ambas dimensiones: permite emitir y consultar
credenciales con evidencia de integridad, y organiza la información formativa
que respaldan para facilitar su interpretación en contextos académicos y
profesionales.

## Alcance del prototipo

Scope no reemplaza la autoridad de las instituciones emisoras ni decide de
manera automática la idoneidad de una persona. El sistema conserva la emisión
institucional como fuente de autoridad, mantiene la evidencia sensible fuera de
la cadena y usa análisis semántico como apoyo interpretativo trazable.

El prototipo incluye:

- Portal institucional para crear borradores, asociar evidencia, emitir y
  revocar credenciales dentro de un contexto autorizado.
- Wallet del titular, disponible en web y aplicación móvil, para consultar
  credenciales, perfil formativo, objetivos y enlaces de compartición cuando
  corresponden.
- Verificación pública de credenciales emitidas o revocadas mediante una
  respuesta allowlisted, sin exponer evidencia cruda ni datos privados.
- Evidencia técnica de integridad basada en una representación canónica, hash,
  firma criptográfica y registros según el modo de blockchain configurado.
- Análisis de contenido formativo para identificar áreas, habilidades y
  conceptos; y razonamiento asistido frente a requisitos de objetivos con
  fuentes direccionables y resultados prudentes.

Los resultados de IA son interpretativos. No certifican competencias, no
modifican por sí solos la credencial oficial y no sustituyen la revisión humana
ni las reglas de dominio.

## Arquitectura

```text
Web Next.js                 Aplicación móvil Expo
      \                           /
       \                         /
        ------ API NestJS -------
                 |       |
          PostgreSQL    FastAPI
                 |       |
        evidencia e     análisis semántico,
        integridad      fuentes y razonamiento
                 |
       registros técnicos de verificabilidad
```

La API NestJS concentra autenticación, permisos, reglas de negocio,
canonicalización y coordinación de integraciones. El navegador y la aplicación
móvil consumen únicamente esa frontera. El servicio FastAPI procesa análisis
internos; no recibe llamadas directas de clientes. La información académica,
documental y de perfil permanece off-chain; la capa de blockchain registra
evidencia técnica mínima y no valida por sí misma el contenido académico.

## Inteligencia artificial y trazabilidad

El análisis semántico de credenciales utiliza normalización de texto, detección
de secciones, taxonomías controladas y reglas determinísticas para producir
áreas, habilidades, conceptos y señales de calidad. Para la interpretación de
evidencia frente a un objetivo, Scope combina etapas asistidas por LLM con
requisitos confirmados por personas, fuentes congeladas, extractos
direccionables, validadores de contratos y una política determinística que
produce estados como soporte, soporte parcial, evidencia insuficiente,
abstención o no evaluable.

Esta separación permite distinguir una relación semántica de una conclusión
epistemológica: que una evidencia sea cercana a un requisito no implica, por sí
sola, que lo respalde. La documentación de IA y los experimentos versionados
describen los límites y controles de este enfoque.

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

## Cómo revisar el proyecto

El repositorio es un monorepo con workspaces npm. Requiere una versión de Node
compatible con los paquetes del workspace; el servicio de IA requiere Python y
los contratos requieren Foundry cuando se ejecutan sus pruebas.

```powershell
npm ci

npm run dev --workspace @credential-intelligence/web
npm run dev --workspace @credential-intelligence/api
npm run dev --workspace @credential-intelligence/ai-service
```

Cada servicio incluye un archivo `.env.example`. No se deben versionar valores
reales de conexión, tokens, claves de firma ni credenciales de infraestructura.
La configuración local, de demo y de producción está separada en los documentos
de arquitectura y en las variables de cada servicio.

## Pruebas y validaciones

Los comandos disponibles se mantienen por workspace para no asumir que todas
las integraciones locales están configuradas.

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

Algunas pruebas de integración requieren las dependencias locales que describen
los respectivos README. Los tests unitarios y contractuales no deben requerir
secretos reales.

## Documentación relevante

- [Arquitectura y decisiones](docs/architecture/README.md)
- [ADRs](docs/decisions/README.md)
- [Servicio y evolución de IA](docs/ai/README.md)
- [Flujos de emisión, análisis y verificación](docs/flows/README.md)

Parte de la documentación registra decisiones y entornos históricos. Cuando
exista una diferencia, el código, los contratos y las pruebas versionadas son
la fuente de verdad para el comportamiento actual.

## Estado y límites

Scope es un prototipo académico en evolución. La verificación técnica no
equivale a una validación académica automática, la IA no certifica capacidades
y los mecanismos de compartición exponen solamente información autorizada. La
documentación de defensa y los ADRs identifican explícitamente las capacidades
implementadas, las dependencias de entorno y el trabajo futuro.
