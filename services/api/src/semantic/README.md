# Semantic Module

Responsabilidad futura:

- integracion con AI service;
- persistencia de `SemanticAnalysis`;
- manejo de artifacts `completed` y `partial`;
- preparacion del slice `Credential issued -> SemanticAnalysis`.

Alcance actual:

- modulo NestJS minimo;
- service vacio sin metodos de negocio;
- sin controllers;
- sin cliente HTTP;
- sin pipeline;
- sin analisis mock;
- sin queries Prisma.

Principios:

- `semantic` sera adaptador u orquestador semantico, no dueno de `Credential`;
- no debe consultar ni modificar tablas de credenciales por fuera de contratos de servicio;
- debe evitar dependencias circulares con `credentials`;
- el backend seguira controlando permisos y coordinacion general desde modulos de dominio.
