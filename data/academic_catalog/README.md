# Catalogo academico demo

`demo-academic-courses-v0.json` es un catalogo plano derivado de la fuente
local provista para el PFI durante P3.1a.

La preparacion del archivo aplica estas reglas:

- corrige la corrupcion sintactica ubicada despues de `Ingenieria Electromecanica`;
- conserva las 617 entradas de `materias` con su codigo y nombre;
- no deduplica por nombre;
- valida que no existan codigos repetidos;
- mantiene las materias separadas del contexto curricular;
- no inventa descripcion, horas, skills, competencias ni resultados de aprendizaje.

El seed asocia todas las entradas al issuer demo y usa la restriccion unica
`issuerId + code` para mantener la importacion idempotente.

`demo-academic-curriculum-v0.json` completa P3.1b con las 22 carreras y las
977 relaciones carrera-materia de la misma fuente. Cada carrera conserva su
codigo institucional aunque su nombre coincida con el de otra carrera. Las
relaciones apuntan por `programCode + courseCode` al catalogo plano, no
contienen referencias rotas ni duplicados y no replican los datos de las 617
materias.

El dataset es local/demo para el PFI. La fuente no aporta descripcion, horas,
skills, competencias ni resultados de aprendizaje, por lo que esos datos no
se inventan.
