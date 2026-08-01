# Catalogo academico demo

`demo-academic-courses-v0.json` es un catalogo plano derivado de la fuente
local provista para el PFI durante P3.1a.

La preparacion del archivo aplica estas reglas:

- corrige la corrupcion sintactica ubicada despues de `Ingenieria Electromecanica`;
- conserva las 617 entradas de `materias` con su codigo y nombre;
- no deduplica por nombre;
- valida que no existan codigos repetidos;
- excluye `carreras` y `carrera_materias`;
- no inventa descripcion, horas, skills, competencias ni resultados de aprendizaje.

El seed asocia todas las entradas al issuer demo y usa la restriccion unica
`issuerId + code` para mantener la importacion idempotente.
