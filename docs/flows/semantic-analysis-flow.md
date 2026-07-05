# Flujo de analisis semantico

## Objetivo

Extraer estructura semantica util de una credencial verificable y consolidarla en un perfil formativo.

## Actores

- Backend API
- AI service
- Base de datos off-chain

## Precondiciones

- la credencial existe y ya fue validada;
- la credencial esta disponible en formato normalizado;
- el AI service expone endpoints HTTP internos.

## Secuencia

1. El backend selecciona una credencial verificable.
2. El backend envia una representacion normalizada al AI service.
3. El AI service limpia y normaliza texto educativo relevante.
4. Detecta areas, skills, conceptos y evidencia textual.
5. Produce un resultado `semantic_analysis_v1`.
6. El backend persiste el analisis vinculado a la credencial.
7. El backend recalcula o actualiza `formative_profile_v1`.
8. El perfil agregado queda disponible para wallet o verificacion autorizada.

## Entradas

- credencial normalizada;
- metadatos de contexto educativo;
- reglas futuras de clasificacion o taxonomias.

## Salidas

- analisis semantico estructurado;
- texto consolidado para embeddings;
- resumen actualizado del perfil formativo.

## Consideraciones

- no ejecutar el pipeline IA como scripts acoplados al backend;
- registrar confianza y flags de calidad;
- preservar trazabilidad entre credencial fuente y evidencia inferida.
