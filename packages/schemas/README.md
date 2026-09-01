# Schemas

Contratos de datos iniciales del proyecto definidos con JSON Schema Draft 2020-12.

## Objetivo

Establecer un lenguaje comun entre backend, frontend, AI service y futuros procesos de validacion o versionado.

## Schemas iniciales

- `credential_v1.schema.json`
- `semantic_analysis_v1.schema.json`
- `formative_profile_result_v0.schema.json`
- `formative_profile_v1.schema.json`
- `blockchain_record_v1.schema.json`
- `source_extraction_v1.schema.json`

## Criterios

- versionar cada contrato;
- evitar acoplar la forma de datos a una sola tecnologia;
- permitir evolucion controlada entre modulos.

## Validacion

`semantic_analysis_v1.schema.json` describe el artifact camelCase producido
por el modulo IA. La asociacion con `credentialId` y el timestamp
`analyzedAt` pertenecen al contexto de persistencia del backend y no forman
parte del artifact.

`formative_profile_result_v0.schema.json` describe el perfil agregado real
producido por `Extractor Materias/profile_builder` a partir de artifacts
`semantic_analysis_v1`. No incluye una identidad confiable del holder: el
backend debe asociarlo externamente y validar la pertenencia de sus fuentes.
Tampoco es payload de frontend, prueba de finalizacion, evidencia blockchain
ni parte de `canon_v1`.

Este contrato no debe confundirse con
`backend_formative_profile_snapshot_v0`, el fallback deterministico que el
backend reconstruye con
`generationMethod = backend_deterministic_aggregation_v0`. Son artifacts
distintos y no comparten schema.

El workspace todavia no tiene un validador JSON Schema automatizado. Como
proximo paso, conviene agregar un test liviano compatible con Draft 2020-12
que valide contra este schema los examples `completed`, `partial` y
`online_course_catalog` de `semantic_analysis_v1`. Para
`formative_profile_result_v0`, conviene versionar fixtures standalone chicos:
uno academico, uno mixto con catalogo online y su warning de no-finalizacion,
y uno sin confidence numerica disponible.


## `source_extraction_v1`

Artifact de extraccion source-addressable: texto canonico direccionable de una
fuente productiva, con identidad de extraccion, coverage de observacion,
segmentos direccionables y diagnosticos estructurados. Contrato congelado por
`mejoras post 50%/evidence-reasoning-f0-source-addressability-design.md`
(`F0_EPISTEMIC_CONTRACT: FROZEN_FOR_IMPLEMENTATION`), slice F0.1.

Es deliberadamente **no semantico**: no contiene EvidenceUnit, area, skill,
concept, confidence, Requirement, relacion ni estado de razonamiento. Produce
texto direccionable, nada interpretativo.

No reemplaza a `semantic_analysis_v1` ni lo modifica. El extractor productivo
actual (`services/ai-service/src/io_utils.py`) permanece intacto: F0 construye
un camino **paralelo** (decision D1).

### Invariante de alineamiento

```text
container.canonicalText[charStart : charEnd] == exactExcerpt

container = pages[pageIndex]  si pageIndex != null
          = el documento      si pageIndex == null
```

Los indices son **code points Unicode** (`offsetUnit = "UNICODE_CODE_POINT"`),
no bytes UTF-8 ni code units UTF-16. En TypeScript la verificacion debe usar
slicing consciente de code points, nunca `String.prototype.slice`.

### Fingerprint

```text
FINGERPRINT_HASH:              SHA-256
FINGERPRINT_PREIMAGE_ENCODING: UTF-8
FINGERPRINT_CANONICALIZATION:  MINIMAL_DETERMINISTIC_JSON_V1
```

`MINIMAL_DETERMINISTIC_JSON_V1` — la especificacion define los BYTES. Python es
la implementacion de referencia, no la definicion.

Estructura: claves de objeto ordenadas ascendente por code point Unicode; sin
whitespace; enteros decimales sin ceros a la izquierda, sin signo, sin exponente;
`true` / `false` / `null`; orden de array preservado; encoding final UTF-8.

Escaping de strings, congelado caracter por caracter:

| Caracter | Forma canonica |
|---|---|
| U+0022 QUOTATION MARK | `\"` |
| U+005C REVERSE SOLIDUS | `\\` |
| U+0008 BACKSPACE | `\b` |
| U+0009 TAB | `\t` |
| U+000A LINE FEED | `\n` |
| U+000C FORM FEED | `\f` |
| U+000D CARRIAGE RETURN | `\r` |
| todo otro U+0000..U+001F | `\u00xx` |

Los digitos hexadecimales de la forma larga **deben ir en minuscula**:

```text
U+0000  ->  \u0000
U+0001  ->  \u0001
U+001E  ->  \u001e
U+001F  ->  \u001f          (nunca \u001F)
```

`\u001f` y `\u001F` son el mismo JSON semanticamente pero producen preimages
distintos y por lo tanto fingerprints distintos. Solo vale la minuscula.

Fuera del rango de control:

- **U+007F DELETE** — caracter literal, no escapado.
- **Cualquier no-ASCII** — literal, serializado como UTF-8 al final, nunca `\uXXXX`.
- **Surrogates UTF-16 sueltos** — entrada invalida; el artifact se rechaza.

Estas reglas resultan implementadas por
`json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))`,
pero esa llamada es la implementacion de referencia y no la especificacion. El
golden vector byte-a-byte contra el que F0.4 debe demostrar igualdad esta en
`services/ai-service/tests/contracts/fixtures/source_extraction_v1/canonical-json-golden-vector.json`.

`artifactContentFingerprint` se excluye de su propio preimage, igual que los ids
de fila, timestamps, UUIDs, `diagnostic.detail` y los campos derivados
(`documentCanonicalText`, `pageOffsetStart`, `pageOffsetEnd`), cuya consistencia
se valida por invariante en vez de por hash.

### Lo que el schema no puede expresar

JSON Schema cubre la forma; los invariantes derivados requieren computo entre
campos y deben hacerse cumplir por validador:

- `documentCanonicalText` == el join de `pages[].canonicalText` con la convencion congelada de dos saltos de linea, para PDF;
- `pageNumber == pageIndex + 1`;
- `pageOffsetStart` / `pageOffsetEnd` derivados de los largos en code points;
- `segmentId` derivado de su propia direccion, nunca ordinal;
- el invariante de alineamiento de arriba;
- `coverageStatus` consistente con los `pageObservationStatus`.

La referencia de F0.1 vive en
`services/ai-service/tests/contracts/source_extraction_reference.py` y es
**solo para tests**: las implementaciones productivas independientes en Python
y TypeScript son entregable de F0.4.

### Fixtures

`services/ai-service/tests/contracts/fixtures/source_extraction_v1/`

- `valid/` — artifacts validos que ademas satisfacen los invariantes;
- `invalid-schema/` — rechazados por JSON Schema;
- `invalid-invariant/` — schema-validos a proposito, rechazados por invariante;
- `sources/` — fuentes deterministicas para F0.2;
- `source-fixture-manifest.json` — inventario, incluidas las fuentes diferidas a
  F0.2 con su caso previsto.
