# Semantic Module

Responsabilidad futura:

- integracion con AI service;
- persistencia de `SemanticAnalysis`;
- manejo de artifacts `completed` y `partial`;
- preparacion del slice `Credential issued -> SemanticAnalysis`.

Alcance actual:

- modulo NestJS minimo;
- service con persistencia interna controlada, sin endpoints;
- validator manual para artifacts `semantic_analysis_v1`;
- mapper intermedio para preparar datos conceptuales de `SemanticAnalysis` sin escribir DB;
- persistencia interna controlada para guardar `semantic_analysis_v1` en `SemanticAnalysis`;
- fixtures y tests unitarios del contrato de artifact;
- sin controllers;
- sin cliente HTTP;
- sin pipeline;
- sin analisis mock;
- sin endpoints de ingestion.

Principios:

- `semantic` sera adaptador u orquestador semantico, no dueno de `Credential`;
- no debe consultar ni modificar tablas de credenciales por fuera de contratos de servicio;
- debe evitar dependencias circulares con `credentials`;
- el backend seguira controlando permisos y coordinacion general desde modulos de dominio;
- el backend no debe consumir outputs crudos del pipeline IA;
- `semantic_analysis_v1` no participa de `canon_v1`;
- `credential_candidate_v1` queda fuera de este alcance.
