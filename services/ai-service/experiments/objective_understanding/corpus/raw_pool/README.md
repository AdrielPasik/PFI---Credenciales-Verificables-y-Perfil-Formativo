# P2.1 — Raw Objective Pool (recolección cruda, Spanish-primary)

**Fecha de captura:** fase 1 el 2026-09-09 · fase 2 (expansión en español) el 2026-09-10
**Estado:** pool crudo cerrado. **No hay gold, no hay Requirements anotados, no hay partición Development/Holdout.**

---

## 1. Propósito

Este directorio contiene un **pool** de Objectives **reales** en lenguaje natural, capturados de
fuentes públicas, para que un agente posterior **seleccione y congele** el corpus experimental
de P2.1 (evaluación de *Objective Understanding*).

El pool es deliberadamente **más grande** que el corpus final previsto en
`objective-understanding-p2.0-contract-and-granularity-design.md` §25.4. La selección **no** forma
parte de esta tarea.

Lo que se buscó maximizar:

```
representatividad en español  ← prioridad, porque Scope se usa en español
diversidad de áreas y carreras
realismo (texto completo del aviso, no una lista de skills)
cobertura de fenómenos lingüísticos que P2.1 debe medir
independencia respecto del extractor
```

Cada archivo conserva el **texto original del Objective** tal como lo publica la fuente.
No hay resúmenes, ni traducciones, ni normalizaciones semánticas.

---

## 2. Política de idioma — la regla que gobierna todo el corpus

```
LANGUAGE_POLICY: preservar el idioma de la fuente   (P2.0 §18)
TRANSLATED_OBJECTIVES: 0
```

P2.0 congeló esta política con una justificación concreta: *«la traducción de modalidad y nivel es
justamente donde se pierden qualifiers»*. Traducir un aviso convertiría a P2.1 en una medición de
la traducción, no de la extracción.

La consecuencia práctica es que **la representatividad en español se consigue capturando más
Objectives publicados originalmente en español**, nunca traduciendo los que están en inglés.
Eso es exactamente lo que hizo la fase 2.

Un Objective cuenta como español **sólo si la fuente lo publicó en español**. No cuentan:

```
un aviso en inglés publicado por una empresa hispanohablante
una traducción automática
una traducción hecha por el agente
```

Verificación: en LinkedIn se aplicó un detector por frecuencia de palabras función que exige
dominancia clara del español; en Get on Board se usó el campo `lang` que la propia API declara.

**Descarte explícito por idioma:** dos avisos del Hospital del Mar Research Institute (Barcelona)
aparecieron en la búsqueda de bioinformática pero están redactados en **catalán**, no en español.
El detector los dejó pasar porque catalán y español comparten muchas palabras función; se
excluyeron a mano.

---

## 3. Totales

| Métrica | Valor |
|---|---|
| Objectives totales | **90** |
| EMPLOYMENT | **72** |
| — en español | **41** (56,9 %) |
| — en inglés | **31** |
| SCHOLARSHIP | **6** (4 ES · 2 EN) |
| ADMISSION | **6** (3 ES · 3 EN) |
| EQUIVALENCE | **6** (4 ES · 2 EN) |
| Organizaciones distintas | 81 |
| Capturas COMPLETE | 89 |
| Capturas PARTIAL | 1 (`ADM_002`) |
| Idioma español (total) | 52 |
| Idioma inglés (total) | 38 |

---

## 4. Distribución por categoría — EMPLOYMENT

| Carpeta | Área | ES | EN | Total |
|---|---|---|---|---|
| `software_informatics` | Software / Informática | 6 | 5 | 11 |
| `cloud_devops_security` | Cloud / DevOps / Seguridad | 6 | 4 | 10 |
| `data_ai` | Data / IA | 5 | 4 | 9 |
| `industrial_engineering` | Ingeniería Industrial | 6 | 4 | 10 |
| `electronics` | Ingeniería Electrónica / automatización | 5 | 3 | 8 |
| `mechanical_engineering` | Ingeniería Mecánica | 4 | 3 | 7 |
| `videogames` | Videojuegos | **0** | 3 | 3 |
| `biotechnology` | Biotecnología / bioinformática / farma | 4 | 2 | 6 |
| `other_engineering` | Otras ingenierías / técnicas | 5 | 3 | 8 |
| **Total** | | **41** | **31** | **72** |

**Videojuegos en español = 0, y es un hallazgo, no un olvido.** Se buscó en LinkedIn (Argentina,
España, México) y en Get on Board con varias formulaciones. Los estudios de videojuegos de la
región publican sus vacantes en inglés; las coincidencias en español eran roles de software
genérico o de la industria del juego de azar, no desarrollo de videojuegos. Se prefirió dejar el
área cubierta por los 3 avisos en inglés antes que forzar avisos mal clasificados.

## 5. Distribución por categoría — CROSS-DOMAIN

| Carpeta | ES | EN | Total | Organizaciones |
|---|---|---|---|---|
| `scholarship` | 4 | 2 | 6 | CONICET, Fulbright Argentina, ANID Chile (×2), Knight-Hennessy, Schwarzman |
| `admission` | 3 | 3 | 6 | ITBA, FIUBA, UPM, Georgia Tech, TU Delft, TUM |
| `equivalence` | 4 | 2 | 6 | UTN FRBA, argentina.gob.ar, UPM-ETSISI, U. de Alicante, Baylor, UNC Charlotte |

---

## 6. Fuentes utilizadas

| Fuente | Objectives | Comentario |
|---|---|---|
| LinkedIn Jobs (páginas públicas de aviso) | 31 | Avisos públicos, sin login |
| Job board oficial de la empresa vía Greenhouse | 25 | Página de careers pública de cada empresa |
| Get on Board (`getonbrd.com`) | 14 | API pública; declara idioma y separa requisitos de deseables |
| Universidades (páginas oficiales) | 13 | Admisión, becas, equivalencias |
| Job board oficial de la empresa vía Ashby | 2 | Página de careers pública |
| Organismos oficiales | 4 | CONICET, argentina.gob.ar, ANID (×2) |
| Fundación binacional | 1 | Comisión Fulbright Argentina |

Cobertura geográfica del bloque en español: **Argentina, España, Chile, Colombia, Perú, Guatemala,
México** y puestos remotos regionales.

**Reglas de acceso respetadas:** sólo páginas y endpoints públicos. **No** se usó cuenta personal,
**no** se evadió login ni rate limits, **no** se completaron formularios, **no** se postuló a
ningún puesto y **no** se modificó ninguna página. Cuando el mismo puesto existía en LinkedIn y en
la página oficial de la empresa, se conservó la versión oficial.

---

## 7. Cobertura de fenómenos lingüísticos

Conteo de Objectives que presentan cada fenómeno (detectores descritos en §9):

| Fenómeno | EMPLOYMENT ES (n=41) | EMPLOYMENT EN (n=31) |
|---|---|---|
| Secciones required / preferred diferenciadas | 31 | 29 |
| Qualifier de años de experiencia | 27 | 23 |
| Requisito de formación académica | 25 | 24 |
| Requisito o preferencia de certificación | 15 | 7 |
| Soft skills | 30 | 37 |
| **Negación o modalidad especial** | 9 | 5 |
| Requisitos repetidos entre secciones | 7 | 7 |

El bloque en español aporta **más certificaciones y más negaciones** que el bloque en inglés, que
es justamente lo que P2.1 necesita medir en el idioma de uso real.

Ejemplos de negación y modalidad **en español**, verificados a mano:

```
EMP_009  "Se valorará (No excluyente)"
EMP_041  "Es deseable, pero no excluyente tener experiencia en ... normas ISO"
EMP_044  "Se considerará como conocimiento deseable (no excluyente): Power BI, Redis, Celery y Linux"
EMP_048  "Certificaciones deseables (no excluyentes)"
EMP_055  "El título no es excluyente. También consideraremos personas con experiencia práctica demostrable"
EMP_060  "Experiencia previa (aprox. 1 año) en roles similares en entorno industrial (no excluyente)"
EMP_064  "Conocimientos valorados – No excluyentes"
EMP_066  "Manejo de software Word y Excel (excluyente); Lab Solutions, Empower; (no excluyente)"
EMP_069  "Otros requisitos: experiencia en manejo de químicos y ensayos de laboratorios (no excluyente)"
SCH_001  "postulantes que deseen finalizar su carrera de doctorado en la Argentina y que no posean una Beca Doctoral del CONICET"
SCH_004  "Se excluyen los programas con práctica clínica directa, como medicina, odontología, enfermería ..."
ADM_005  "Lo anterior, no es excluyente de otras profesiones ..."
EQV_001  "no es necesario si tiene sello de Apostilla de La Haya"
EQV_006  "En los supuestos de simultaneidad de estudios no serán objeto de transferencia los créditos ..."
```

`EMP_066` es especialmente valioso: contrasta **excluyente** y **no excluyente** dentro de la misma
línea, sobre dos grupos de herramientas distintos. Un extractor que pierda ese contraste convierte
un requisito opcional en obligatorio.

Y en inglés (fase 1):

```
EMP_026  "FEA experience is not required, but preferred"
EMP_011  "Even if you don't check every box ... please apply"
ADM_001  "In no case can work experience substitute for having earned an academic degree"
ADM_001  "Applicants who meet the minimum requirements are not guaranteed admission"
SCH_003  "This requirement is waived for applicants who studied ..."
EQV_003  "Courses taken pass/fail will not be eligible for transfer"
```

**Contexto vs. Requirement.** Se buscó deliberadamente dificultad: muchos avisos mencionan
tecnologías, cifras y años sólo en el bloque de presentación de la empresa, en el rango salarial o
en el aviso legal. Por ejemplo `EMP_026` menciona *credentials & certifications* únicamente dentro
del texto de compensación, `EMP_029` menciona *over 30 years* sólo en la descripción de la empresa,
y varios avisos en español abren con párrafos institucionales cargados de tecnologías que **no**
son requisitos. Ese ruido es intencional.

---

## 8. Longitud

Sobre los 72 avisos de empleo:

```
mínimo   2.210 caracteres
mediana  5.024
máximo  10.418
```

Bloque en español (41 avisos):

```
< 3.500 caracteres        21
3.500 - 6.000 caracteres  15
>= 6.000 caracteres        5

mínimo   2.210   mediana 3.494   máximo 7.042
```

El bloque en español es en promedio más corto que el inglés: los avisos de LATAM y España tienden a
ser más concisos que los de las tecnológicas estadounidenses. Es una diferencia real del dominio,
no un artefacto de la captura, y conviene tenerla en cuenta al seleccionar el corpus final.

En cross-domain el rango es mayor (969 a 25.131 caracteres) porque las políticas institucionales de
equivalencia son estructuralmente más largas que un aviso de empleo.

---

## 9. Cómo se completaron las «Observaciones de corpus»

Las banderas de cada archivo se calcularon con **detectores léxicos deterministas bilingües
(ES/EN)**, no con un LLM, y se verificaron a mano por muestreo. Precisiones:

- Las líneas de **boilerplate** (rango salarial, beneficios, igualdad de oportunidades, política de
  privacidad, agencias de reclutamiento, avisos anti-fraude) se **excluyen** del conteo, para que
  «incluye certificaciones» signifique *el Objective pide o valora una certificación* y no *la
  palabra aparece en el texto legal*.
- `Presenta requisitos repetidos entre secciones` es una **heurística**: se segmenta el texto por
  encabezados, se clasifican las secciones en «responsabilidades» y «requisitos», y se marca `Sí`
  cuando al menos 3 términos salientes aparecen en ambos grupos. Es una señal orientativa para la
  selección posterior, **no** una anotación.

Estas banderas son **metadata superficial de selección**. No son gold, no son Requirements, y no
deben usarse como referencia de evaluación.

---

## 10. Criterios de inclusión

```
texto completo del Objective, con sus secciones tal como las publica la fuente
fuente pública, verificable por URL
publicación vigente o reciente a la fecha de captura
idioma original verificado (para el bloque en español)
aporta diversidad de área, país, idioma, longitud o fenómeno lingüístico
organización real e identificable
```

## 11. Criterios de exclusión

```
snippets de resultados de búsqueda o descripciones truncadas
páginas donde el contenido de requisitos se carga por JavaScript y no se pudo recuperar
avisos en un idioma distinto del declarado (caso catalán, §2)
reposts idénticos del mismo aviso por la misma empresa
el mismo Objective publicado en dos fuentes (se conserva la oficial y más completa)
avisos sin sección de requisitos o de responsabilidades
páginas de listado o navegación en lugar del Objective propiamente dicho
```

**Fuentes probadas y descartadas** (registradas para no repetir el intento): `tecnoempleo.com` y la
API de `bumeran.com.ar` devuelven 403; `becas-santander.com` y `ucm.es` cargan el contenido por
JavaScript; la página de convocatoria de Fundación Carolina sólo anuncia una charla informativa;
`robertorocca.org` es institucional y no publica criterios de elegibilidad; `universidades.gob.es`
cortó la conexión; las políticas de transferencia de créditos de Purdue y Western Ontario redirigen
a la home; los boards de Greenhouse y Lever de Glovo, Wallbox, TravelPerk, dLocal, Tenaris,
Grifols, Factorial, Rappi y Mercado Libre devuelven 404.

**Deduplicación:** 81 organizaciones distintas para 90 Objectives, y **ninguna URL repetida**
(verificado automáticamente). Nueve organizaciones aportan dos Objectives cada una (GitLab, Vercel,
Lucid Motors, Formlabs, Cohere, Astranis, Ginkgo Bioworks, Factor IT y ANID), siempre con **roles o
convocatorias materialmente distintas** — por ejemplo Astranis aporta un puesto de hardware SDR y
uno de diseño mecánico, y ANID aporta la beca de doctorado nacional y la de doctorado en el
extranjero, que tienen criterios de elegibilidad diferentes. No hay dos archivos con el mismo texto.

---

## 12. Limpieza aplicada al texto

Se removió **exclusivamente** chrome de sitio:

```
menús y barras de navegación
breadcrumbs
skip-links ("Skip to main content", "Ir al contenido")
banners de cookies o consentimiento
botones y controles de compartir en redes
pies de página del sitio
fragmentos de JS/JSON sueltos que dejan los widgets de algunos sitios institucionales
```

Se **preservó** todo lo demás, incluidos encabezados, viñetas, secciones required/preferred y
deseable/excluyente, puntuación, negaciones, rangos salariales, textos de beneficios y avisos
legales del aviso, porque esa mezcla es justamente lo que P2.1 debe medir.

El texto se convirtió de HTML a texto plano preservando estructura: los encabezados quedan como
`##` o `**...**` según los marcara la fuente, y las viñetas como `-`. No se reordenó, resumió ni
tradujo ningún contenido.

**Los 53 archivos de la fase 1 no se regeneraron.** La limpieza ampliada de la fase 2 se aplicó
únicamente a los Objectives nuevos; el manifest se reconstruye leyendo los `.md` ya escritos, de
modo que las filas de la fase 1 salen idénticas a las originales.

---

## 13. Limitaciones conocidas

1. **`ADM_002` (TU Delft) está marcado `PARTIAL`.** Las secciones plegables del procedimiento de
   solicitud se cargan por JavaScript y no están en el HTML servido. La sección de requisitos
   académicos —el criterio evaluativo del Objective— sí está completa. Es la única captura parcial.
2. **Videojuegos en español = 0.** Explicado en §4. El área queda cubierta sólo en inglés.
3. **Los avisos en español son más cortos.** Ver §8: la mediana en español es 3.494 caracteres
   frente a 5.024 del pool completo. Si el corpus final se arma sólo con avisos en español, tendrá
   menos Requirements por Objective que lo que asumía el diseño original de P2.1.
4. **Concentración por país en el bloque en español:** Argentina y Chile aportan la mayoría; España
   aporta mecánica, telecomunicaciones y civil; México, Colombia, Perú y Guatemala aportan un aviso
   cada uno. No es una muestra balanceada de LATAM.
5. **Sesgo de plataforma:** Get on Board es un board de perfiles tecnológicos, así que el español de
   software/cloud/data viene mayoritariamente de ahí, mientras que industrial, mecánica,
   electrónica y biotecnología vienen de LinkedIn. Los dos estilos de redacción son distintos.
6. **Los avisos de empleo caducan.** La URL y la fecha de captura quedan registradas para
   trazabilidad, pero el texto conservado acá es la única copia estable.
7. Las banderas de `Observaciones de corpus` son heurísticas (§9) y pueden tener falsos positivos o
   negativos residuales. No sustituyen la lectura del texto.

---

## 14. Nota para la partición posterior de P2.1

La partición **no** se hizo acá. Pero el pool se construyó sabiendo que la selección final debe ser
**Spanish-primary**: el español es la evaluación principal y el inglés queda como control de
robustez. Con 41 avisos en español y 11 cross-domain en español hay margen suficiente para armar esa
selección sin tocar el bloque en inglés.

Recordatorio del diseño congelado: **la unidad de partición es el Objective completo**, nunca el
Requirement, y las variantes near-duplicate del mismo aviso deben quedar en la misma partición.

---

## 15. Estructura

```
raw_pool/
├── employment/
│   ├── software_informatics/      EMP_001 002 009 010 011 012 · 042 043 044 045 046
│   ├── cloud_devops_security/     EMP_003 004 008 013 014 039 · 047 048 049 050
│   ├── data_ai/                   EMP_005 015 016 017 018 · 051 052 053 054
│   ├── industrial_engineering/    EMP_006 019 020 021 040 041 · 056 057 058 059
│   ├── electronics/               EMP_022 023 024 025 · 055 063 064 065
│   ├── mechanical_engineering/    EMP_007 026 027 028 · 060 061 062
│   ├── videogames/                EMP_029 030 031
│   ├── biotechnology/             EMP_032 033 034 · 066 067 068
│   └── other_engineering/         EMP_035 036 037 038 · 069 070 071 072
│
├── cross_domain/
│   ├── scholarship/               SCH_001 002 003 004 005 006
│   ├── admission/                 ADM_001 002 003 004 005 006
│   └── equivalence/               EQV_001 002 003 004 005 006
│
├── manifest.jsonl                 una línea JSON por Objective (sin el texto)
└── README.md
```

Los IDs `EMP_001`–`EMP_041` y los cross-domain `_001`–`_004` son de la fase 1 y **no se
renumeraron**. La expansión en español continúa desde `EMP_042`, `SCH_005`, `ADM_005` y `EQV_005`.

---

## 16. Uso y derechos

Material **experimental interno** del Proyecto Final de Ingeniería Informática. Los textos son
propiedad de sus respectivas organizaciones y se conservan únicamente para evaluar el comportamiento
del extractor de Requirements. **No se publican, no se redistribuyen y no se reproducen masivamente
en documentos públicos.** Cada archivo conserva URL, fuente y fecha de captura para trazabilidad.

---

## 17. Lo que este directorio NO contiene

```
gold requirements
candidate requirements
listas de skills
expected outputs
etiquetas Development / Holdout
traducciones
salidas de ningún proveedor de LLM
```

Ninguna de esas cosas se produjo en esta tarea. La anotación y la partición corresponden a pasos
posteriores, sobre este pool.
