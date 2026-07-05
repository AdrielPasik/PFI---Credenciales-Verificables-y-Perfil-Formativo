# ADR 0003 - AI Service Separado

## Contexto

El proyecto incluye procesamiento semantico especializado que puede evolucionar con librerias, dependencias y ritmos distintos a los del backend transaccional.

## Decision

Implementar la capacidad de IA como un servicio Python/FastAPI separado, invocado por HTTP interno desde el backend Node.

## Justificacion

- separa cargas transaccionales de cargas analiticas;
- habilita dependencias propias del ecosistema Python;
- facilita iteracion independiente del pipeline semantico;
- reduce acoplamiento tecnico entre backend y modelos de IA.

## Consecuencias

- se deben versionar contratos HTTP y payloads;
- sera necesario monitorear latencia, reintentos y errores entre servicios;
- el backend sigue siendo el punto de orquestacion y control.

## Alternativas descartadas

- scripts Python ejecutados directamente desde Node;
- pipeline de IA incrustado en el backend NestJS;
- procesamiento semantico en el frontend.
