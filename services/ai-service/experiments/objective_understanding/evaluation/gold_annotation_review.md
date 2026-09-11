# P2.1 — Artefacto de revisión de anotación del gold

Generado desde los archivos `gold/*.gold.json` congelados antes de la primera llamada al
proveedor. Cada excerpt fue verificado mecánicamente como substring literal del texto crudo
congelado; la fidelidad semántica y la granularidad son juicio humano y se auditan aquí.

**Totales: 311 gold Requirements, de los cuales 16 marcados AMBIGUO.**

Convenciones: `[AMBIGUO]` marca los casos que NO se resolvieron en la dirección que
facilitaría el scoring y quedan explícitamente señalados.


---

## Partición: development

### EMP_044 — Desarrollador Full-Stack Django + Next.JS (ExpressDent, software_informatics, 2868 car.)

**Nota de anotación:** Aviso junior chileno con dos secciones que repiten las mismas tecnologias (Requisitos y Funciones) y una lista de deseables repetida con proposito por item. La modalidad atenuada ('interes y/o experiencia', 'conocimiento o interes', 'con acompanamiento') es material en casi todos los claims.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Interés y/o experiencia en desarrollo con Django. | modalidad atenuada: 'interés y/o experiencia' (no exige experiencia); actividad: desarrollo; objeto: Django; rol: backend (auxiliar) | `- Interés y/o experiencia en desarrollo con **Django** y **Next.js**.` |
| g02 | REQUIRED | Interés y/o experiencia en desarrollo con Next.js. | modalidad atenuada: 'interés y/o experiencia'; actividad: desarrollo; objeto: Next.js; rol: frontend (auxiliar) | `- Interés y/o experiencia en desarrollo con **Django** y **Next.js**.` |
| g03 | REQUIRED | Conocimientos de PostgreSQL. | nivel: conocimientos; objeto: PostgreSQL | `- Conocimientos de **PostgreSQL** y **SQL**.` |
| g04 | REQUIRED | Conocimientos de SQL. | nivel: conocimientos; objeto: SQL | `- Conocimientos de **PostgreSQL** y **SQL**.` |
| g05 | PREFERRED | Deseable (no excluyente): conocimiento de Power BI. | modalidad: deseable, no excluyente; objeto: Power BI | `- Se considerará como conocimiento deseable (no excluyente): **Power BI**, **Redis**, **Celery** y **Linux**.` |
| g06 | PREFERRED | Deseable (no excluyente): conocimiento de Redis. | modalidad: deseable, no excluyente; objeto: Redis | `- Se considerará como conocimiento deseable (no excluyente): **Power BI**, **Redis**, **Celery** y **Linux**.` |
| g07 | PREFERRED | Deseable (no excluyente): conocimiento de Celery. | modalidad: deseable, no excluyente; objeto: Celery | `- Se considerará como conocimiento deseable (no excluyente): **Power BI**, **Redis**, **Celery** y **Linux**.` |
| g08 [AMBIGUO] | PREFERRED | Deseable (no excluyente): conocimiento de Linux. | modalidad: deseable, no excluyente; objeto: Linux | `- Se considerará como conocimiento deseable (no excluyente): **Power BI**, **Redis**, **Celery** y **Linux**.` |
| g09 | REQUIRED | Conocimiento o interés en trabajo bajo prácticas ágiles (Scrum), con disposición a aprender. | modalidad atenuada: 'conocimiento o interés'; marco: prácticas ágiles / Scrum; condicion adicional: disposición a aprender | `- Conocimiento o interés en trabajo bajo prácticas ágiles (**Scrum**), con disposición a aprender.` |
| g10 [AMBIGUO] | REQUIRED | Disponibilidad para modalidad presencial en Quilicura y horario full time. | modalidad de trabajo: presencial; ubicacion: Quilicura; jornada: full time | `- Disponibilidad para modalidad **presencial en Quilicura** y horario de **full time**.` |
| g11 | REQUIRED | Pensamiento analítico y crítico para resolver problemas y depurar. | capacidad: pensamiento analítico y crítico; aplicacion: resolver problemas y depurar | `- Pensamiento analítico y crítico para resolver problemas y depurar.` |
| g12 | REQUIRED | Actitud proactiva: avanzar con iniciativa y pedir ayuda cuando corresponda. | actitud: proactiva; conducta esperada: iniciativa y pedido de ayuda | `- Actitud proactiva: avanzar con iniciativa y pedir ayuda cuando corresponda.` |
| g13 [AMBIGUO] | REQUIRED | Colaboración con el equipo y respeto por el proceso. | soft skill: colaboración; soft skill: respeto por el proceso | `- Colaboración con el equipo y respeto por el proceso.` |
| g14 | REQUIRED | Comunicación clara del progreso y de los riesgos/bloqueos. | nivel: comunicación clara; objeto: progreso y riesgos/bloqueos | `- Comunicación clara del progreso y de los riesgos/bloqueos.` |
| g15 | REQUIRED | Curiosidad técnica y aprendizaje continuo. | soft skill: curiosidad técnica; soft skill: aprendizaje continuo | `- Curiosidad técnica y aprendizaje continuo.` |
| g16 | REQUIRED | Responsabilidad y autonomía en las tareas asignadas, con acompañamiento del equipo. | alcance: tareas asignadas; atenuante: con acompañamiento del equipo | `- Responsabilidad y autonomía en las tareas asignadas, con acompañamiento del equipo.` |
| g17 | REQUIRED | Implementar y consumir APIs, integrando lógica de negocio. | actividad: implementar y consumir; objeto: APIs; alcance: integrar lógica de negocio | `- Implementar y consumir APIs, integrando lógica de negocio.` |
| g18 | REQUIRED | Apoyar la calidad del código mediante revisión, pruebas funcionales y buenas prácticas. | objetivo: calidad del código; medios: revisión, pruebas funcionales, buenas prácticas | `- Apoyar la calidad del código: revisión, pruebas funcionales y buenas prácticas.` |
| g19 | PREFERRED | Se valora tener base en SQL y curiosidad por mejorar consultas, rendimiento y calidad de datos. | modalidad: valorado; objeto: base en SQL; objeto: curiosidad por mejorar consultas, rendimiento y calidad de datos | `Además, valoramos que tengas base en **SQL** y curiosidad por mejorar consultas, rendimiento y calidad de datos.` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Separado de Next.js por §4.1: el qualifier compartido 'Interés y/o experiencia en desarrollo con' distribuye sobre dos objetos distintos sin alterar cantidad ni modalidad.
- `g02` — Ver g01.
- `g03` — Separado de SQL por §4.1: 'Conocimientos de' distribuye sin perdida.
- `g04` — Ver g03. La funcion 'Escribir y optimizar consultas SQL' es referencia auxiliar del mismo claim.
- `g05` — Separado en cuatro por §4.1: 'conocimiento deseable (no excluyente)' distribuye sobre cuatro tecnologias independientes, confirmadas como independientes por la seccion posterior que asigna un proposito distinto a cada una.
- `g06` — Ver g05.
- `g07` — Ver g05.
- `g08` — Ver g05.
- `g08` **[AMBIGUO]** — Tension real de la fuente: Linux figura como deseable NO excluyente en Requisitos, pero la seccion Funciones lo presenta como tarea efectiva ('Utilizar entornos Linux para despliegue y soporte basico'). Se anota con la modalidad que la seccion de requisitos establece explicitamente; un anotador razonable podria sostener que la funcion lo eleva a requerido. No se resuelve en la direccion que facilite el scoring.
- `g09` — Compuesto preservado: 'con disposicion a aprender' es parte del mismo criterio y no distribuye como claim independiente.
- `g10` — Compuesto preservado por default de nivel de fuente.
- `g10` **[AMBIGUO]** — Lectura compuesta vs separada difieren: 'Disponibilidad para' gobierna dos dimensiones distintas (modalidad y jornada) y no dos objetos del mismo tipo. Se aplica el default de nivel de fuente (§4.2 AMBIGUO): la fuente lo presenta como una sola condicion de disponibilidad.
- `g11` — 'Pensamiento analitico y critico' es un unico sintagma nominal: §4.2 prohibe partirlo en sus modificadores.
- `g13` — Compuesto preservado por default de nivel de fuente.
- `g13` **[AMBIGUO]** — Sin qualifier compartido que distribuir; las dos partes son independientes pero la fuente las presenta en una sola vineta de soft skills. Default de nivel de fuente.
- `g14` — Compuesto preservado: 'Comunicacion clara de' gobierna objetos del mismo acto comunicativo.
- `g16` — El atenuante 'con acompanamiento del equipo' es material: rebaja el nivel de autonomia exigido y no puede eliminarse.
- `g17` — Compuesto preservado (§5): 'implementar y consumir APIs' es una capacidad integrada; separarla emitiria dos estados finales donde la fuente pide uno.
- `g18` — Los tres medios son la enumeracion de un unico criterio de calidad; preservados como compuesto.
- `g19` — Solapa con g04 (SQL requerido) pero difiere materialmente en fuerza y agrega un objeto nuevo; §17 prohibe colapsarlos.

**No-requisitos explícitos (6):**

- `Si tienes conocimiento parcial, ¡no pasa nada! Podemos enseñarte y acompañarte en metodologías como **Scrum** …` → Declaracion de modalidad que ATENUA los requisitos: el conocimiento parcial es aceptable. No genera Requirement y no debe invertirse en exigencia.
- `**Prácticas profesionales:** se aceptan postulaciones de personas en etapa de prácticas profesionales.…` → Amplia la elegibilidad; no es un criterio que la persona deba satisfacer.
- `**Beneficios**…` → Encabezado de beneficios ofrecidos por la empresa, no criterios.
- `- Trabajo en proyectos reales con impacto directo…` → Beneficio ofrecido, no requisito.
- `- Bus de acercamiento…` → Beneficio ofrecido, no requisito.
- `Como Desarrollador/a Fullstack Junior, nos enfocamos en que aprendas rápido y avances con acompañamiento en un…` → Prosa de encuadre del rol; describe el entorno, no un criterio evaluable.

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `- Utilizar entornos Linux para despliegue y soporte básico.…` → Convive con Linux marcado como deseable no excluyente en Requisitos. Ver g08.

### EMP_008 — Cloud Platform Engineer (AWS / DevOps) (Centro de e-Learning UTN FRBA, cloud_devops_security, 2210 car.)

**Nota de anotación:** Aviso corto (2.210 car.) con separacion limpia entre responsabilidades ('Que vas a hacer'), requisitos ('Que buscamos') y preferencias ('Suma puntos si tenes'). Contiene metadata de plataforma al pie que no es texto del empleador.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Más de 4 años de experiencia en roles de Cloud, DevOps o SRE. | cantidad: +4 años; alcance: roles de Cloud / DevOps / SRE (alternativos) | `- +4 años en roles de Cloud / DevOps / SRE.` |
| g02 | REQUIRED | Experiencia sólida en AWS (VPC, IAM, EC2, ECS/EKS, S3, RDS, CloudWatch). | nivel: sólida; objeto: AWS; alcance: VPC, IAM, EC2, ECS/EKS, S3, RDS, CloudWatch | `- Experiencia sólida en AWS (VPC, IAM, EC2, ECS/EKS, S3, RDS, CloudWatch).` |
| g03 | REQUIRED | Manejo de Terraform (u otras herramientas de infraestructura como código). | objeto: Terraform; alternativa admitida: otras herramientas IaC | `- Manejo de Terraform (u otras herramientas IaC).` |
| g04 [AMBIGUO] | REQUIRED | Experiencia con Docker y plataformas de ejecución. | objeto: Docker; objeto: plataformas de ejecución | `- Experiencia con Docker y plataformas de ejecución.` |
| g05 | REQUIRED | Experiencia en CI/CD (GitHub Actions, Jenkins, etc.). | objeto: CI/CD; ejemplos de herramienta: GitHub Actions, Jenkins | `- Experiencia en CI/CD (GitHub Actions, Jenkins, etc.).` |
| g06 | REQUIRED | Conocimientos en observabilidad. | nivel: conocimientos; objeto: observabilidad | `- Conocimientos en observabilidad y seguridad cloud.` |
| g07 | REQUIRED | Conocimientos en seguridad cloud. | nivel: conocimientos; objeto: seguridad cloud | `- Conocimientos en observabilidad y seguridad cloud.` |
| g08 | REQUIRED | Scripting (Bash / Python). | actividad: scripting; lenguajes admitidos: Bash / Python | `- Scripting (Bash / Python).` |
| g09 | PREFERRED | Suma puntos: experiencia en SRE (SLO/SLI). | modalidad: suma puntos (no requerido); objeto: SRE; alcance: SLO/SLI | `**Suma puntos si tenés** ⏎  ⏎ - Experiencia en SRE (SLO/SLI).` |
| g10 | PREFERRED | Suma puntos: certificaciones cloud. | modalidad: suma puntos (no requerido); objeto: certificaciones cloud | `**Suma puntos si tenés** ⏎  ⏎ - Experiencia en SRE (SLO/SLI). ⏎ - Certificaciones cloud.` |
| g11 | PREFERRED | Suma puntos: uso de IA aplicada a operaciones. | modalidad: suma puntos (no requerido); objeto: IA aplicada a operaciones | `**Suma puntos si tenés** ⏎  ⏎ - Experiencia en SRE (SLO/SLI). ⏎ - Certificaciones cloud. ⏎ - Uso de IA aplicada a operaciones.` |
| g12 | REQUIRED | Diseñar y administrar infraestructura cloud (AWS), asegurando disponibilidad, seguridad y performance. | actividad: diseñar y administrar; entorno: infraestructura cloud (AWS); atributos de calidad: disponibilidad, seguridad y performance | `- Diseñar y administrar infraestructura cloud (AWS), asegurando disponibilidad, seguridad y performance.` |
| g13 | REQUIRED | Gestionar networking (VPC, routing, DNS, balanceo, seguridad). | actividad: gestionar; objeto: networking; alcance: VPC, routing, DNS, balanceo, seguridad | `- Gestionar networking (VPC, routing, DNS, balanceo, seguridad).` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Compuesto preservado por §4.1: distribuir '+4 anos' sobre los tres roles inventaria tres exigencias temporales donde la fuente pide una sola.
- `g02` — La lista entre parentesis delimita el alcance del mismo claim; §4.2 prohibe partir el sintagma nominal en sus modificadores.
- `g03` — La alternativa 'u otras herramientas IaC' amplia el objeto y es material: eliminarla fortaleceria el claim.
- `g04` — Compuesto preservado.
- `g04` **[AMBIGUO]** — 'plataformas de ejecucion' es una categoria generica que subsume a Docker, asi que la lectura separada duplicaria parcialmente el claim. Se preserva compuesto por default de nivel de fuente; un anotador razonable podria separarlo.
- `g06` — Separado por §4.1: 'Conocimientos en' distribuye sobre dos dominios independientes.
- `g07` — Ver g06.
- `g08` — Bash y Python aparecen como alternativas dentro del mismo parentesis; no son dos criterios.
- `g09` — El excerpt primario abarca el encabezado de modalidad y la vineta de forma contigua (§12 P2.0).
- `g10` — Excerpt contiguo desde el encabezado de modalidad hasta la vineta correspondiente.
- `g11` — Excerpt contiguo desde el encabezado de modalidad hasta la vineta correspondiente.
- `g12` — Capacidad integrada (§5): disenar-y-administrar con tres atributos de calidad gobernados conjuntamente. Solapa con g02 pero difiere materialmente en fuerza y actividad; §17 prohibe colapsarlos.

**No-requisitos explícitos (8):**

- `- Colaborar con equipos de producto para mejorar despliegues y operación.…` → Describe el entorno de trabajo, no una capacidad evaluable (§6 P2.0, caso 'colaborar con equipos').
- `- Modalidad 100% remota…` → Beneficio ofrecido por la empresa, no criterio del holder.
- `- Acceso a formación académica.…` → Beneficio ofrecido, no requisito de formación.
- `¡Con la educación estamos formando el futuro! Somos Centro de e-Learning y desarrollamos ofertas educativas in…` → Prosa institucional de la empresa (§7).
- `## Seniority level ⏎  ⏎ Mid-Senior level…` → Metadata de la plataforma LinkedIn, no texto de criterio del empleador.
- `## Employment type ⏎  ⏎ Full-time…` → Metadata de la plataforma LinkedIn.
- `## Industries ⏎  ⏎ Higher Education…` → Metadata de la plataforma LinkedIn; el sector no es un requisito del holder.
- `En el **Centro de eLearning** buscamos sumar un/a **Cloud Platform Engineer** para diseñar, operar y evolucion…` → Encuadre del puesto; la mencion de AWS aqui es contexto, el criterio se establece en la seccion de requisitos (§7 y §8).

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `- Trabajar con contenedores (Docker, ECS/Kubernetes).…` → Introduce ECS/Kubernetes, que no aparecen como criterio propio en la seccion de requisitos salvo dentro del alcance de AWS (ECS/EKS). Se trata como referencia auxiliar de g04 y no como Requirement nuevo.

### EMP_052 — Ingeniero de Datos y Analítica (AGENCIA DE ADUANAS FELIPE SERRANO, data_ai, 5417 car.)

**Nota de anotación:** Objective en prosa corrida (no viñetas) con requisitos, funciones y opcionales bien separados por seccion. Alto riesgo de confundir contexto con requisito: la empresa declara 'mas de 40 anos de trayectoria' y menciona tecnologias dentro de las funciones.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Perfil senior con experiencia práctica construyendo soluciones de datos en ambientes productivos. | nivel: senior; naturaleza: experiencia práctica; entorno: ambientes productivos | `Buscamos un perfil senior con experiencia práctica construyendo soluciones de datos en ambientes productivos.` |
| g02 | REQUIRED | Haber participado en el diseño y operación de data warehouses o datamarts, integrando información desde múltiples fuentes y resolviendo problemas reales de calidad, consi | actividad integrada: diseño y operación; objeto: data warehouses o datamarts; alcance: múltiples fuentes; alcance: calidad, consistencia y trazabilida | `Debes haber participado en el diseño y operación de data warehouses o datamarts, integrando información desde múltiples fuentes y resolviendo problema…` |
| g03 | REQUIRED | Dominio avanzado de SQL. | nivel: avanzado; objeto: SQL | `Necesitamos dominio avanzado de SQL y experiencia desarrollando pipelines de extracción, transformación y carga de datos.` |
| g04 | REQUIRED | Experiencia desarrollando pipelines de extracción, transformación y carga de datos. | naturaleza: experiencia desarrollando; objeto: pipelines de extracción, transformación y carga | `Necesitamos dominio avanzado de SQL y experiencia desarrollando pipelines de extracción, transformación y carga de datos.` |
| g05 | REQUIRED | Capacidad de modelar información. | capacidad: modelar información | `Esperamos que puedas modelar información, optimizar consultas, implementar cargas incrementales y diseñar estructuras que sean mantenibles y reutiliza…` |
| g06 | REQUIRED | Capacidad de optimizar consultas. | capacidad: optimizar consultas | `Esperamos que puedas modelar información, optimizar consultas, implementar cargas incrementales y diseñar estructuras que sean mantenibles y reutiliza…` |
| g07 | REQUIRED | Capacidad de implementar cargas incrementales. | capacidad: implementar cargas incrementales | `Esperamos que puedas modelar información, optimizar consultas, implementar cargas incrementales y diseñar estructuras que sean mantenibles y reutiliza…` |
| g08 | REQUIRED | Capacidad de diseñar estructuras mantenibles y reutilizables. | capacidad: diseñar estructuras; atributos exigidos: mantenibles y reutilizables | `Esperamos que puedas modelar información, optimizar consultas, implementar cargas incrementales y diseñar estructuras que sean mantenibles y reutiliza…` |
| g09 | REQUIRED | Es requisito contar con experiencia práctica utilizando dbt para desarrollar y mantener transformaciones de datos. | modalidad explícita: es requisito; naturaleza: experiencia práctica; objeto: dbt; actividad: desarrollar y mantener transformaciones de datos | `Es requisito contar con experiencia práctica utilizando dbt para desarrollar y mantener transformaciones de datos.` |
| g10 | REQUIRED | Estar acostumbrado a desarrollar soluciones de datos aplicando buenas prácticas de ingeniería de software (modelos, dependencias, pruebas, documentación, control de versi | habito: acostumbrada a; marco: buenas prácticas de ingeniería de software; alcance: modelos, dependencias, pruebas, documentación, control de versione | `El rol requerirá trabajar con modelos, dependencias, pruebas, documentación, control de versiones y despliegues, por lo que buscamos una persona acost…` |
| g11 | REQUIRED | Experiencia trabajando con plataformas de datos en cloud. | objeto: plataformas de datos en cloud | `Debes tener experiencia trabajando con plataformas de datos en cloud y con al menos un motor o data warehouse como Amazon Redshift, Snowflake, Postgre…` |
| g12 | REQUIRED | Experiencia con al menos un motor o data warehouse como Amazon Redshift, Snowflake, PostgreSQL o equivalente. | cantidad: al menos uno; objeto: motor o data warehouse; alternativas: Amazon Redshift, Snowflake, PostgreSQL o equivalente | `Debes tener experiencia trabajando con plataformas de datos en cloud y con al menos un motor o data warehouse como Amazon Redshift, Snowflake, Postgre…` |
| g13 | REQUIRED | Experiencia integrando fuentes mediante APIs, bases de datos, archivos y herramientas o servicios de extracción de datos en AWS u otras plataformas cloud. | actividad: integrar fuentes; medios: APIs, bases de datos, archivos, herramientas/servicios de extracción; entorno: AWS u otras plataformas cloud | `También esperamos experiencia integrando fuentes mediante APIs, bases de datos, archivos y herramientas o servicios de extracción de datos en AWS u ot…` |
| g14 | REQUIRED | Poder utilizar Python para extracción, automatización, procesamiento o validación de datos. | objeto: Python; usos alternativos: extracción, automatización, procesamiento o validación | `Python será el principal lenguaje de programación complementario a SQL, por lo que debes poder utilizarlo para extracción, automatización, procesamien…` |
| g15 | REQUIRED | Conocimientos de modelamiento dimensional. | objeto: modelamiento dimensional | `El cargo requiere conocimientos de modelamiento dimensional y capacidad para diseñar modelos orientados al análisis, comprendiendo conceptos como tabl…` |
| g16 | REQUIRED | Capacidad para diseñar modelos orientados al análisis, comprendiendo tablas de hechos, dimensiones, granularidad y relaciones entre entidades. | capacidad: diseñar modelos orientados al análisis; alcance conceptual: tablas de hechos, dimensiones, granularidad, relaciones entre entidades | `El cargo requiere conocimientos de modelamiento dimensional y capacidad para diseñar modelos orientados al análisis, comprendiendo conceptos como tabl…` |
| g17 [AMBIGUO] | REQUIRED | Experiencia aplicando controles de calidad, documentación, seguridad y trazabilidad de datos. | actividad: aplicar; objetos: controles de calidad, documentación, seguridad, trazabilidad | `También buscamos experiencia aplicando controles de calidad, documentación, seguridad y trazabilidad de datos.` |
| g18 | REQUIRED | Criterio para manejar datos responsablemente, considerando acceso, confidencialidad y tratamiento de información. | criterio: manejo responsable de datos; alcance: acceso, confidencialidad, tratamiento | `esperamos criterio para manejar datos responsablemente y considerar aspectos de acceso, confidencialidad y tratamiento de información` |
| g19 [AMBIGUO] | REQUIRED | Autonomía técnica: ser capaz de tomar un problema poco estructurado, comprender el proceso con usuarios de negocio, proponer una solución y llevarla a producción. | capacidad integrada: extremo a extremo del problema a produccion; alcance: problema poco estructurado, usuarios de negocio, propuesta, puesta en produ | `Valoramos especialmente la autonomía técnica: deberás ser capaz de tomar un problema poco estructurado, comprender el proceso con usuarios de negocio,…` |
| g20 | REQUIRED | Comunicar bien las decisiones a públicos técnicos y no técnicos. | capacidad: comunicar decisiones; audiencia: técnicos y no técnicos | `Necesitamos una persona que comunique bien sus decisiones a públicos técnicos y no técnicos, documente su trabajo y privilegie soluciones simples, sos…` |
| g21 | REQUIRED | Documentar su trabajo. | conducta: documentar el propio trabajo | `Necesitamos una persona que comunique bien sus decisiones a públicos técnicos y no técnicos, documente su trabajo y privilegie soluciones simples, sos…` |
| g22 | REQUIRED | Privilegiar soluciones simples, sostenibles y orientadas a generar valor incremental. | criterio de diseño: simples, sostenibles, valor incremental | `Necesitamos una persona que comunique bien sus decisiones a públicos técnicos y no técnicos, documente su trabajo y privilegie soluciones simples, sos…` |
| g23 | REQUIRED | Formación universitaria o técnica en Informática, Computación, Estadística, Ciencia de Datos o carrera afín. | nivel: universitaria o técnica; areas admitidas: Informática, Computación, Estadística, Ciencia de Datos o afín | `Se requiere formación universitaria o técnica en Informática, Computación, Estadística, Ciencia de Datos o una carrera afín.` |
| g24 | PREFERRED | Plus: experiencia específica en AWS y servicios de integración o procesamiento de datos. | modalidad: será un plus; objeto: AWS y servicios de integración o procesamiento de datos | `Será un plus contar con experiencia específica en AWS y servicios de integración o procesamiento de datos, así como experiencia profunda con Amazon Re…` |
| g25 | PREFERRED | Plus: experiencia profunda con Amazon Redshift o Snowflake. | modalidad: será un plus; nivel: profunda; objeto: Amazon Redshift o Snowflake (alternativos) | `Será un plus contar con experiencia específica en AWS y servicios de integración o procesamiento de datos, así como experiencia profunda con Amazon Re…` |
| g26 | PREFERRED | Valorado: conocimientos de Power BI y modelamiento semántico. | modalidad: valoraremos; objeto: Power BI y modelamiento semántico | `También valoraremos conocimientos de Power BI y modelamiento semántico; Git, CI/CD y prácticas de DataOps; monitoreo y observabilidad de pipelines; go…` |
| g27 | PREFERRED | Valorado: Git, CI/CD y prácticas de DataOps. | modalidad: valoraremos; objeto: Git, CI/CD, DataOps | `También valoraremos conocimientos de Power BI y modelamiento semántico; Git, CI/CD y prácticas de DataOps; monitoreo y observabilidad de pipelines; go…` |
| g28 | PREFERRED | Valorado: monitoreo y observabilidad de pipelines. | modalidad: valoraremos; objeto: monitoreo y observabilidad de pipelines | `También valoraremos conocimientos de Power BI y modelamiento semántico; Git, CI/CD y prácticas de DataOps; monitoreo y observabilidad de pipelines; go…` |
| g29 | PREFERRED | Valorado: gobierno, catálogo y linaje de datos. | modalidad: valoraremos; objeto: gobierno, catálogo y linaje de datos | `También valoraremos conocimientos de Power BI y modelamiento semántico; Git, CI/CD y prácticas de DataOps; monitoreo y observabilidad de pipelines; go…` |
| g30 | PREFERRED | Valorado: experiencia preparando datasets para analítica avanzada, machine learning o inteligencia artificial. | modalidad: valoraremos; actividad: preparar datasets; destinos alternativos: analítica avanzada, machine learning o IA | `También valoraremos conocimientos de Power BI y modelamiento semántico; Git, CI/CD y prácticas de DataOps; monitoreo y observabilidad de pipelines; go…` |
| g31 | PREFERRED | Suma: experiencia en organizaciones con procesos transaccionales o regulatorios complejos, especialmente en logística, comercio exterior o agencias de aduana. | modalidad: sumará; entorno: procesos transaccionales o regulatorios complejos; sectores preferidos: logística, comercio exterior, agencias de aduana | `Sumará experiencia en organizaciones con procesos transaccionales o regulatorios complejos y, especialmente, en logística, comercio exterior o agencia…` |
| g32 | PREFERRED | Valorado: conocimiento de seguridad de la información. | modalidad: será valorado; objeto: seguridad de la información | `También será valorado el conocimiento de seguridad de la información y normativa de protección de datos personales.` |
| g33 | PREFERRED | Valorado: conocimiento de normativa de protección de datos personales. | modalidad: será valorado; objeto: normativa de protección de datos personales | `También será valorado el conocimiento de seguridad de la información y normativa de protección de datos personales.` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g02` — Capacidad integrada (§5): 'diseno y operacion' con dos alcances gobernados conjuntamente; separar duplicaria el objeto.
- `g03` — Separado del pipeline ETL por §4.1: los dos claims tienen qualifiers gobernantes distintos ('dominio avanzado' vs 'experiencia desarrollando').
- `g04` — Ver g03. Las tres fases del pipeline son el alcance de un unico objeto, no tres criterios.
- `g05` — Separado por §4.1: 'Esperamos que puedas' distribuye sobre cuatro capacidades independientes sin alterar cantidad ni modalidad.
- `g06` — Ver g05.
- `g07` — Ver g05.
- `g08` — Ver g05. Los dos atributos califican a un mismo objeto y no se separan.
- `g10` — La enumeracion es el alcance del mismo criterio; preservada como compuesto.
- `g11` — Separado por §4.1: 'Debes tener experiencia trabajando con' distribuye sobre dos objetos distintos.
- `g12` — El cuantificador 'al menos un' es material: separar por motor convertiria una alternativa en tres exigencias.
- `g13` — Los medios son el alcance de una unica capacidad de integracion.
- `g14` — Los cuatro usos van unidos por 'o' (alternativos): separar convertiria una disyuncion en cuatro exigencias.
- `g15` — Separado de la capacidad de diseno por §4.1: los qualifiers gobernantes son distintos ('conocimientos de' vs 'capacidad para').
- `g16` — Ver g15.
- `g17` — Compuesto preservado por default de nivel de fuente.
- `g17` **[AMBIGUO]** — 'experiencia aplicando' distribuye sobre cuatro objetos, lo que habilitaria la separacion; pero la fuente los presenta como las facetas de una misma practica de gobierno de datos. Se aplica el default de nivel de fuente.
- `g19` — Los cuatro pasos describen un unico recorrido de autonomia; separarlos rompe la capacidad integrada (§5).
- `g19` **[AMBIGUO]** — Modalidad mixta en la misma oracion: 'Valoramos especialmente' sugiere preferencia y 'deberas ser capaz de' impone obligacion. Se anota REQUIRED porque la obligacion es explicita, pero un anotador razonable podria leer PREFERRED.
- `g20` — Separado por §4.1: 'Necesitamos una persona que' distribuye sobre tres conductas independientes.
- `g21` — Ver g20.
- `g22` — Ver g20. Los tres atributos califican a un mismo objeto.
- `g23` — Disyuncion de titulaciones admitidas: separar convertiria alternativas en exigencias acumulativas.
- `g24` — Separado del claim de Redshift/Snowflake por 'asi como', que introduce un segundo criterio con su propio qualifier ('experiencia profunda').
- `g26` — La fuente separa los grupos con punto y coma; cada grupo se toma como un claim.
- `g27` — Ver g26.
- `g28` — Ver g26.
- `g29` — Ver g26.
- `g30` — Ver g26.
- `g31` — El 'especialmente' refina el mismo claim y no crea un criterio separado.
- `g32` — Separado por §4.1: 'el conocimiento de' distribuye sobre dos dominios normativos distintos.
- `g33` — Ver g32.

**No-requisitos explícitos (5):**

- `Como Ingeniero/a de Datos y Analítica trabajarás en la Subgerencia de Tecnología y Procesos, colaborando con e…` → Describe la ubicacion organizacional y el entorno de colaboracion; no es criterio evaluable (§6).
- `Es un rol técnico senior, sin personas a cargo, con espacio para influir en decisiones de arquitectura y en la…` → Caracterizacion del puesto, no criterio del holder.
- `Formar parte de una empresa con más de 40 años de trayectoria y sólida reputación en el mercado nacional, cert…` → Condiciones ofrecidas y prosa institucional. 'mas de 40 anos' es antiguedad de la empresa, NO experiencia exigida al holder; invertirlo seria una alucinacion material.
- `Una vez pases a contrato indefinido, podrás optar al sistema de incentivos de la organización por cumplimiento…` → Condicion contractual ofrecida, no requisito.
- `Oportunidad para desarrollarse en un entorno innovador, con tecnologías modernas y proyectos desafiantes que a…` → Prosa de oferta.

**Pasajes ambiguos registrados (2) — no penalizan ni cuentan como omisión:**

- `Además, participarás en la operación y evolución de los pipelines, monitoreo y resolución de incidentes, imple…` → Funcion que solapa con g04, g17 y g30. Un anotador razonable podria emitir claims propios de operacion de pipelines y resolucion de incidentes; aqui se trata como funcion que reitera criterios ya establecidos.
- `También desarrollarás o habilitarás modelos de datos para reportes, indicadores, paneles y modelos semánticos …` → Podria leerse como criterio propio de construccion de modelos semanticos; solapa con g26 (Power BI y modelamiento semantico, deseable) con fuerza distinta.

### EMP_017 — Data Scientist [SSr/Sr] (etermax, data_ai, 3494 car.)

**Nota de anotación:** Caso deliberado de modalidad indecidible a nivel de seccion: un encabezado dice 'requeridos' y el siguiente dice '¿Que valoramos?'. Solo tres viñetas traen modalidad propia ('Valoraremos positivamente', 'condicion excluyente', 'Valoramos'). El parrafo institucional enumera muchas tecnologias que NO son criterios.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | UNSPECIFIED | Desarrollar modelos predictivos y segmentaciones para predecir y entender el comportamiento de los usuarios y optimizar productos y procesos (incluye Lifetime Value, reco | actividad: desarrollar; objetos: modelos predictivos y segmentaciones; finalidad: predecir/entender comportamiento y optimizar productos y procesos; a | `- Desarrollar modelos predictivos y segmentaciones en pos de predecir y entender el comportamiento de nuestros usuarios y optimizar nuestros productos…` |
| g02 | UNSPECIFIED | Ejecutar proyectos periódicos end-to-end desde la exploración hasta la productivización y mantenimiento. | alcance: end-to-end; fases: exploración, productivización, mantenimiento; cadencia: periódicos | `- Ejecutar proyectos periódicos end-to-end desde la exploración hasta la productivización y mantenimiento.` |
| g03 [AMBIGUO] | UNSPECIFIED | Aportar soluciones estratégicas para el roadmap definido por producto, colaborando con el desarrollo del área de Data. | aporte: soluciones estratégicas; marco: roadmap definido por producto | `- Colaborar con el desarrollo del área de Data, aportando soluciones estratégicas para el roadmap definido por producto.` |
| g04 | UNSPECIFIED | Orientarse a las necesidades del producto en un entorno de cambio, experimentación y novedad, interiorizando en los desarrollos vigentes para identificar problemáticas y  | orientación: necesidades del producto; entorno: cambio, experimentación y novedad; conducta: identificar problemáticas y acercar insights | `- Orientarse a las necesidades del producto en un entorno de cambio, experimentación y novedad. Interiorizando en los desarrollos vigentes para identi…` |
| g05 | UNSPECIFIED | Dominio técnico y conocimientos en SQL. | nivel: dominio técnico y conocimientos; objeto: SQL | `- Dominio técnico y conocimientos en: SQL, Python, AWS, modelos predictivos, redes neuronales, simulaciones numéricas y modelado estadístico.` |
| g06 | UNSPECIFIED | Dominio técnico y conocimientos en Python. | nivel: dominio técnico y conocimientos; objeto: Python | `- Dominio técnico y conocimientos en: SQL, Python, AWS, modelos predictivos, redes neuronales, simulaciones numéricas y modelado estadístico.` |
| g07 | UNSPECIFIED | Dominio técnico y conocimientos en AWS. | nivel: dominio técnico y conocimientos; objeto: AWS | `- Dominio técnico y conocimientos en: SQL, Python, AWS, modelos predictivos, redes neuronales, simulaciones numéricas y modelado estadístico.` |
| g08 | UNSPECIFIED | Dominio técnico y conocimientos en modelos predictivos. | nivel: dominio técnico y conocimientos; objeto: modelos predictivos | `- Dominio técnico y conocimientos en: SQL, Python, AWS, modelos predictivos, redes neuronales, simulaciones numéricas y modelado estadístico.` |
| g09 | UNSPECIFIED | Dominio técnico y conocimientos en redes neuronales. | nivel: dominio técnico y conocimientos; objeto: redes neuronales | `- Dominio técnico y conocimientos en: SQL, Python, AWS, modelos predictivos, redes neuronales, simulaciones numéricas y modelado estadístico.` |
| g10 | UNSPECIFIED | Dominio técnico y conocimientos en simulaciones numéricas. | nivel: dominio técnico y conocimientos; objeto: simulaciones numéricas | `- Dominio técnico y conocimientos en: SQL, Python, AWS, modelos predictivos, redes neuronales, simulaciones numéricas y modelado estadístico.` |
| g11 | UNSPECIFIED | Dominio técnico y conocimientos en modelado estadístico. | nivel: dominio técnico y conocimientos; objeto: modelado estadístico | `- Dominio técnico y conocimientos en: SQL, Python, AWS, modelos predictivos, redes neuronales, simulaciones numéricas y modelado estadístico.` |
| g12 | UNSPECIFIED | Dominio técnico en tecnologías agénticas como Cursor, Claude o Antigravity. | nivel: dominio técnico; objeto: tecnologías agénticas; ejemplos alternativos: Cursor, Claude, Antigravity | `- Dominio técnico en tecnologías agénticas como Cursor, Claude o Antigravity y en modelos de lenguaje masivos.` |
| g13 | UNSPECIFIED | Dominio técnico en modelos de lenguaje masivos. | nivel: dominio técnico; objeto: modelos de lenguaje masivos | `- Dominio técnico en tecnologías agénticas como Cursor, Claude o Antigravity y en modelos de lenguaje masivos.` |
| g14 | PREFERRED | Valorado positivamente: experiencia con Spark. | modalidad: valorado positivamente; naturaleza: experiencia; objeto: Spark | `- Valoraremos positivamente experiencia con Spark, conocimientos en NLP, sistemas de recomendación y maestrías relacionadas a Ciencias de Datos.` |
| g15 | PREFERRED | Valorado positivamente: conocimientos en NLP. | modalidad: valorado positivamente; nivel: conocimientos; objeto: NLP | `- Valoraremos positivamente experiencia con Spark, conocimientos en NLP, sistemas de recomendación y maestrías relacionadas a Ciencias de Datos.` |
| g16 | PREFERRED | Valorado positivamente: conocimientos en sistemas de recomendación. | modalidad: valorado positivamente; nivel: conocimientos; objeto: sistemas de recomendación | `- Valoraremos positivamente experiencia con Spark, conocimientos en NLP, sistemas de recomendación y maestrías relacionadas a Ciencias de Datos.` |
| g17 | PREFERRED | Valorado positivamente: maestrías relacionadas a Ciencias de Datos. | modalidad: valorado positivamente; credencial: maestría; área: Ciencias de Datos | `- Valoraremos positivamente experiencia con Spark, conocimientos en NLP, sistemas de recomendación y maestrías relacionadas a Ciencias de Datos.` |
| g18 | UNSPECIFIED | Mindset orientado a ownership sobre objetivos y responsabilidad sobre entregables de alta calidad. | actitud: ownership sobre objetivos; actitud: responsabilidad sobre entregables; nivel exigido: alta calidad | `- Mindset orientado a ownership sobre objetivos y responsabilidad sobre entregables de alta calidad.` |
| g19 | UNSPECIFIED | Mindset orientado a producto con proactividad para proponer e investigar. | actitud: orientación a producto; conducta: proactividad para proponer e investigar | `- Mindset orientado a producto con proactividad para proponer e investigar.` |
| g20 | UNSPECIFIED | Buenas herramientas humanas. | soft skill: herramientas humanas | `- Buenas herramientas humanas, y que el trabajo en equipo sea una condición excluyente.` |
| g21 | REQUIRED | Trabajo en equipo como condición excluyente. | modalidad explícita: condición excluyente; objeto: trabajo en equipo | `- Buenas herramientas humanas, y que el trabajo en equipo sea una condición excluyente.` |
| g22 | UNSPECIFIED | Ambición por descubrir y explorar nuevas formas de hacer las cosas, incluyendo desafiar el status quo de la tecnología. | actitud: ambición exploratoria; alcance: desafiar el status quo tecnológico | `- Ambición por descubrir y explorar nuevas formas de hacer las cosas, lo que incluiría desafiar el status quo de la tecnología en general.` |
| g23 | PREFERRED | Valorado: el estudio, la investigación y la exploración de herramientas, novedades e innovaciones en ciencia de datos, estadística e Inteligencia Artificial. | modalidad: valoramos; conductas: estudio, investigación, exploración; áreas: ciencia de datos, estadística, IA | `- Valoramos el estudio, la investigación y la exploración de herramientas, novedades e innovaciones en el área de la ciencia de datos, la estadística …` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Los ejemplos ('Entre otras cosas, se incluyen...') delimitan el alcance del mismo claim, no criterios separados.
- `g02` — Capacidad integrada extremo a extremo (§5); separar por fase destruiria el alcance.
- `g03` **[AMBIGUO]** — El verbo principal es 'Colaborar', que §6 trata como descripcion de entorno; sin embargo 'aportando soluciones estrategicas' si es una capacidad evaluable. Se anota como Requirement por esa segunda parte.
- `g05` — Separado por §4.1: el qualifier 'Dominio tecnico y conocimientos en' distribuye sobre una lista de objetos independientes.
- `g06` — Ver g05.
- `g07` — Ver g05.
- `g08` — Ver g05.
- `g09` — Ver g05.
- `g10` — Ver g05.
- `g11` — Ver g05.
- `g12` — Los tres productos son ejemplos alternativos del mismo objeto y no se separan; el segundo objeto de la vineta (LLM) si es independiente.
- `g13` — Ver g12.
- `g14` — Separado porque los items de la vineta llevan qualifiers distintos ('experiencia con' / 'conocimientos en' / 'maestrias').
- `g15` — Ver g14.
- `g16` — Ver g14.
- `g17` — Ver g14.
- `g20` — Separado del trabajo en equipo porque este ultimo lleva su propia modalidad explicita ('condicion excluyente') y el primero no.
- `g21` — Unico claim del aviso con modalidad obligatoria explicita; perderla convertiria un excluyente en un simple valorado.
- `g23` — Una sola disposicion hacia el aprendizaje; las tres areas son su alcance.

**No-requisitos explícitos (6):**

- `Seguimos innovando y revolucionando la industria de la tecnología, ¡nos gustaría que te sumes como **Data Scie…` → Encabezado de convocatoria; el titulo del puesto es contexto y no crea Requirements (§8).
- `En **etermax** trabajamos sobre los pilares de la innovación y la mejora continua para proporcionar valor a un…` → Prosa de cultura de empresa colocada bajo un encabezado de 'habilidades requeridas'; no enuncia ningun criterio del holder (§7).
- `**etermax** es líder mundial en la industria de la tecnología del entretenimiento.…` → Prosa institucional (§7).
- `Con la creación de marcas emblemáticas como Preguntados (Trivia Crack) y Apalabrados (Word Crack), su equipo d…` → Lista de tecnologias de la empresa mencionadas como contexto: realidad aumentada, realidad virtual, streaming, TV conectada, etc. NO son criterios (§7). Es el caso de ruido mas peligroso del aviso.
- `## Seniority level ⏎  ⏎ Mid-Senior level…` → Metadata de la plataforma LinkedIn.
- `## Industries ⏎  ⏎ Entertainment Providers…` → Metadata de la plataforma LinkedIn.

**Pasajes ambiguos registrados (3) — no penalizan ni cuentan como omisión:**

- `**Habilidades y conocimientos requeridos para este desafío:**…` → Encabezado que anuncia requisitos pero cuyo contenido inmediato es prosa de cultura; las viñetas efectivas cuelgan del encabezado posterior '¿Que valoramos?'. Por eso la mayoria de los claims se anotan con modality UNSPECIFIED en lugar de forzar REQUIRED o PREFERRED.
- `**¿Qué valoramos?**…` → Encabezado de preferencia que gobierna viñetas que la seccion anterior habia anunciado como requeridas. Modalidad genuinamente indecidible a nivel de seccion; solo se anota modalidad donde la viñeta la establece por si misma.
- `**Lugar de trabajo:** Villa Urquiza (Híbrido).…` → Condicion de lugar y modalidad enunciada como dato informativo, no como exigencia dirigida al postulante. No se emite Requirement; tampoco se penaliza si el extractor emite uno.

### EMP_041 — Ingeniero/a en Excelencia Operacional (Eramet, industrial_engineering, 3224 car.)

**Nota de anotación:** Aviso industrial argentino con la negacion modal mas limpia del corpus ('Es deseable, pero no excluyente'). Contiene dos cifras de contexto ('hace 12 anos', 'mas de un 90%') que son trampas de contexto-vs-requisito. La seccion 'Su Perfil' mezcla formacion, experiencia, soft skills, idioma y herramientas.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Estudios universitarios completos de ingeniería industrial o química, o no adeudar más del 10% de la carrera. | nivel: estudios universitarios completos; alternativa admitida: no adeudar más del 10% de la carrera; carreras: ingeniero industrial o químico | `- Estudios universitarios completos, o no adeudar más del 10% de la carrera de ingeniero industrial o químico.` |
| g02 | PREFERRED | Deseable, pero no excluyente: experiencia en puestos de gestión operativa o de normas ISO. | modalidad explícita: deseable, pero no excluyente; naturaleza: experiencia; objetos alternativos: gestión operativa o normas ISO | `- Es deseable, pero no excluyente tener experiencia en puestos de gestión operativa o de normas ISO.` |
| g03 | REQUIRED | Pensamiento analítico, iniciativa proactiva y autonomía. | actitudes: pensamiento analítico, iniciativa proactiva, autonomía | `- Pensamiento analítico, iniciativa proactiva y autonomía. Capacidad para trabajar en entornos multidisciplinarios y jerárquicos.` |
| g04 | REQUIRED | Capacidad para trabajar en entornos multidisciplinarios y jerárquicos. | capacidad: trabajo en entornos multidisciplinarios y jerárquicos | `- Pensamiento analítico, iniciativa proactiva y autonomía. Capacidad para trabajar en entornos multidisciplinarios y jerárquicos.` |
| g05 | REQUIRED | Habilidades interpersonales y de comunicación efectiva. | soft skill: habilidades interpersonales; soft skill: comunicación efectiva | `- Habilidades interpersonales y de comunicación efectiva.` |
| g06 | REQUIRED | Creatividad. | atributo: creatividad | `- Creatividad.` |
| g07 | REQUIRED | Inglés nivel intermedio - avanzado. | idioma: inglés; nivel: intermedio - avanzado | `- Inglés nivel intermedio - avanzado` |
| g08 | REQUIRED | Office MS. | herramienta: Office MS | `- Office MS, power Bi,` |
| g09 | REQUIRED | Power BI. | herramienta: Power BI | `- Office MS, power Bi,` |
| g10 [AMBIGUO] | REQUIRED | Metodologías Lean, mejora continua y gestión visual. | marco: Lean; marco: mejora continua; marco: gestión visual | `- Metodologías Lean, mejora continua y gestión visual. Estándares operativos, análisis de procesos y herramientas de diagnóstico.` |
| g11 [AMBIGUO] | REQUIRED | Estándares operativos, análisis de procesos y herramientas de diagnóstico. | objeto: estándares operativos; objeto: análisis de procesos; objeto: herramientas de diagnóstico | `- Metodologías Lean, mejora continua y gestión visual. Estándares operativos, análisis de procesos y herramientas de diagnóstico.` |
| g12 | REQUIRED | Implementar y dar soporte a metodologías de mejora continua como 5S, rutinas de gestión, análisis de causa raíz, control visual, estandarización de procesos y gestión por | actividad integrada: implementar y dar soporte; alcance: 5S, rutinas de gestión, análisis de causa raíz, control visual, estandarización, gestión por  | `- Implementar y dar soporte a metodologías de mejora continua como 5S, rutinas de gestión, análisis de causa raíz, control visual, estandarización de …` |
| g13 | REQUIRED | Acompañar a líderes, gerentes y directores operativos en el desarrollo de sus funciones diarias, promoviendo buenas prácticas de liderazgo y gestión de equipos. | actividad: acompañar; audiencia: líderes, gerentes y directores operativos; alcance: buenas prácticas de liderazgo y gestión de equipos | `- Acompañar a líderes, gerentes y directores operativos en el desarrollo de sus funciones diarias, promoviendo buenas prácticas de liderazgo y gestión…` |
| g14 [AMBIGUO] | REQUIRED | Colaborar en la revisión, mejora y estandarización de procedimientos e instructivos de trabajo. | actividad: revisión, mejora y estandarización; objeto: procedimientos e instructivos de trabajo | `- Colaborar en la revisión, mejora y estandarización de procedimientos e instructivos de trabajo.` |
| g15 | REQUIRED | Participar en proyectos de mejora enfocados en eficiencia operativa, seguridad, calidad y reducción de costos. | objeto: proyectos de mejora; focos: eficiencia operativa, seguridad, calidad, reducción de costos | `- Participar en proyectos de mejora enfocados en eficiencia operativa, seguridad, calidad y reducción de costos.` |
| g16 | REQUIRED | Apoyar el fortalecimiento de la cultura de excelencia mediante facilitación de herramientas, sesiones de trabajo, capacitaciones y seguimiento de iniciativas. | objetivo: cultura de excelencia; medios: facilitación de herramientas, sesiones de trabajo, capacitaciones, seguimiento | `- Apoyar el fortalecimiento de la cultura de excelencia mediante la facilitación de herramientas, sesiones de trabajo, capacitaciones y seguimiento de…` |
| g17 | REQUIRED | Contribuir al diseño e implementación de sistemas de gestión documental y estructuración de la información de soporte operativo. | actividad integrada: diseño e implementación; objeto: sistemas de gestión documental y estructuración de información de soporte operativo | `- Contribuir al diseño e implementación de sistemas de gestión documental y estructuración de la información de soporte operativo.` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Disyuncion con umbral cuantitativo ('no adeudar mas del 10%'): separar convertiria una alternativa en dos exigencias y perderia el umbral.
- `g02` — Modalidad negada explicita ('no excluyente'): convertirla en requisito seria una inversion de negacion. Los dos objetos van unidos por 'o' (alternativos).
- `g03` — Tres atributos enumerados en una misma oracion sin qualifier gobernante que distribuir; se preservan al nivel en que la fuente los presenta.
- `g04` — Separado de g03 porque la fuente lo enuncia como oracion propia con su propio verbo ('Capacidad para').
- `g07` — El nivel es un qualifier material: 'ingles' a secas debilitaria el claim.
- `g08` — Separado por §4.1: la vineta enumera dos herramientas independientes sin qualifier compartido que se altere.
- `g09` — Ver g08.
- `g10` — Separacion al nivel de las dos oraciones que la fuente delimita con punto.
- `g10` **[AMBIGUO]** — La vineta agrupa dos oraciones nominales sin verbo; podria leerse como un unico bloque de conocimientos o como seis items. Se separa en las dos oraciones que la fuente puntua, sin descender a cada termino.
- `g11` — Ver g10.
- `g11` **[AMBIGUO]** — Ver g10.
- `g12` — Capacidad integrada (§5). La enumeracion tras 'como' es alcance ejemplificado, no criterios separados. Solapa con g10 pero con actividad distinta (§17).
- `g14` **[AMBIGUO]** — El verbo principal es 'Colaborar en', que §6 trata como entorno; sin embargo el objeto (revision/mejora/estandarizacion de procedimientos) es una capacidad evaluable propia del rol.
- `g17` — 'diseno e implementacion' es capacidad integrada (§5).

**No-requisitos explícitos (8):**

- `Eramine Sudamérica SA es una subsidiaria de Eramet, un grupo minero y metalúrgico global francés. Está ubicada…` → Prosa institucional y geografica (§7). La altitud y la ubicacion no son criterios del holder.
- `Las actividades de exploración tuvieron inicio hace 12 años y a fines de 2019 comenzó a operar nuestra planta …` → Contexto de la empresa con cifras ('hace 12 anos', 'mas de un 90%') que NO son qualifiers de ningun requisito. Convertir '12 anos' en experiencia exigida seria una alucinacion material.
- `El ingeniero de excelencia operacional es un agente critico y participativo para involucrarse con los gerentes…` → Descripcion del proposito del puesto; el contenido evaluable se enuncia en Responsabilidades y Su Perfil.
- `Esta posición reporta a: Coordinador de Excelencia Operacional…` → Linea de reporte organizacional, no criterio.
- `Ubicación: Proyecto Centenario-Ratones Salta, Argentina.…` → Dato de ubicacion del puesto, no exigencia dirigida al postulante.
- `Presente en los cinco continentes y con empleados de más de 70 nacionalidades, Eramet es por naturaleza un gru…` → Declaracion de diversidad corporativa (§7).
- `## Seniority level ⏎  ⏎ Not Applicable…` → Metadata de la plataforma LinkedIn.
- `## Industries ⏎  ⏎ Mining…` → Metadata de la plataforma LinkedIn.

### EMP_056 — Ingeniero de Manufactura (Abbott, industrial_engineering, 5691 car.)

**Nota de anotación:** Aviso largo de multinacional farmaceutica con tres bloques que repiten el mismo contenido: resumen del rol en prosa, 'Que haras' en viñetas y 'Cualificaciones requeridas'. La unica modalidad explicita es '(excluyente)' aplicada al ingles intermedio.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Título de Ingeniero Industrial, Químico, Mecánico o Farmacéutico, o carreras afines. | nivel: titulación de ingeniería/farmacia; carreras alternativas: Industrial, Químico, Mecánico, Farmacéutico o afines | `- Educación : Ingeniero Industrial, Químico, Mecánico o Farmacéutico, o carreras afines.` |
| g02 | REQUIRED | Paquete Office. | herramienta: Paquete Office | `- Conocimientos específicos : Paquete Office, Excel Intermedio, Power BI, Ingles Intermedio (excluyente).` |
| g03 | REQUIRED | Excel nivel intermedio. | herramienta: Excel; nivel: intermedio | `- Conocimientos específicos : Paquete Office, Excel Intermedio, Power BI, Ingles Intermedio (excluyente).` |
| g04 | REQUIRED | Power BI. | herramienta: Power BI | `- Conocimientos específicos : Paquete Office, Excel Intermedio, Power BI, Ingles Intermedio (excluyente).` |
| g05 | REQUIRED | Inglés nivel intermedio (excluyente). | idioma: inglés; nivel: intermedio; modalidad explícita: excluyente | `- Conocimientos específicos : Paquete Office, Excel Intermedio, Power BI, Ingles Intermedio (excluyente).` |
| g06 | REQUIRED | Mínimo de 2 años de experiencia en producción, Supply Chain, Ingeniería Industrial o mejora continua. | cantidad: mínimo 2 años; áreas alternativas: producción, Supply Chain, Ingeniería Industrial, mejora continua | `- Experiencia : contar con un mínimo de 2 años de experiencia en producción, Supply Chain, Ingeniería Industrial o mejora continua. Debe tener conocim…` |
| g07 | REQUIRED | Conocimiento en regulaciones de Calidad y los estándares que afectan la industria farmacéutica. | objeto: regulaciones de Calidad; objeto: estándares de la industria farmacéutica; modalidad: 'Debe tener' | `- Experiencia : contar con un mínimo de 2 años de experiencia en producción, Supply Chain, Ingeniería Industrial o mejora continua. Debe tener conocim…` |
| g08 | REQUIRED | Monitorear y analizar indicadores de producción, productividad, eficiencia, OEE y utilización de recursos, identificando desvíos y proponiendo acciones de mejora. | actividad integrada: monitorear y analizar; objeto: indicadores de producción, productividad, eficiencia, OEE, utilización de recursos; resultado espe | `- Monitorear y analizar indicadores de producción, productividad, eficiencia, OEE y utilización de recursos, identificando desvíos y proponiendo accio…` |
| g09 | REQUIRED | Realizar el cierre y análisis de órdenes de producción, evaluando consumos, rendimientos, mano de obra y costos asociados. | actividad: cierre y análisis de órdenes de producción; alcance: consumos, rendimientos, mano de obra, costos | `- Realizar el cierre y análisis de órdenes de producción, evaluando consumos, rendimientos, mano de obra y costos asociados.` |
| g10 | REQUIRED | Generar reportes e información de gestión para la toma de decisiones de Producción, Finanzas y Planificación. | actividad: generar reportes e información de gestión; destinatarios: Producción, Finanzas, Planificación | `- Generar reportes e información de gestión para la toma de decisiones de las áreas de Producción, Finanzas y Planificación.` |
| g11 | REQUIRED | Asegurar el cumplimiento de procedimientos, normativas de calidad, regulaciones, requisitos de seguridad, medio ambiente y estándares corporativos. | actividad: asegurar cumplimiento; alcance: procedimientos, normativas de calidad, regulaciones, seguridad, medio ambiente, estándares corporativos | `- Asegurar el cumplimiento de procedimientos, normativas de calidad, regulaciones, requisitos de seguridad, medio ambiente y estándares corporativos.` |
| g12 | REQUIRED | Gestionar documentación productiva, procedimientos operativos, instrucciones de manufactura y procesos de Management of Change (MoC). | actividad: gestionar; objetos: documentación productiva, procedimientos operativos, instrucciones de manufactura, MoC | `- Gestionar documentación productiva, procedimientos operativos, instrucciones de manufactura y procesos de Management of Change (MoC).` |
| g13 | REQUIRED | Coordinar y administrar los entrenamientos del personal, detectando necesidades de capacitación y promoviendo el desarrollo de competencias. | actividad integrada: coordinar y administrar entrenamientos; alcance: detectar necesidades y promover desarrollo de competencias | `- Coordinar y administrar los entrenamientos del personal, detectando necesidades de capacitación y promoviendo el desarrollo de competencias.` |
| g14 | REQUIRED | Participar en proyectos de mejora continua orientados a optimizar procesos, reducir costos e incrementar la eficiencia operativa. | objeto: proyectos de mejora continua; objetivos: optimizar procesos, reducir costos, incrementar eficiencia | `- Participar en proyectos de mejora continua orientados a optimizar procesos, reducir costos e incrementar la eficiencia operativa.` |
| g15 | REQUIRED | Definir y actualizar estándares de producción, rutas de fabricación (Routings) y listas de materiales (BOMs) para productos nuevos y existentes. | actividad integrada: definir y actualizar; objetos: estándares de producción, Routings, BOMs; alcance: productos nuevos y existentes | `- Definir y actualizar estándares de producción, rutas de fabricación (Routings) y listas de materiales (BOMs) para productos nuevos y existentes.` |
| g16 | REQUIRED | Colaborar en la elaboración de presupuestos, análisis financieros, proyecciones de ahorro y control de costos del área. | actividad: elaboración presupuestaria y control de costos; objetos: presupuestos, análisis financieros, proyecciones de ahorro, control de costos | `- Colaborar en la elaboración de presupuestos, análisis financieros, proyecciones de ahorro y control de costos del área.` |
| g17 | REQUIRED | Gestionar requisiciones de compra y coordinar proveedores para la ejecución de trabajos y proyectos en planta. | actividad: gestionar requisiciones y coordinar proveedores; alcance: trabajos y proyectos en planta | `- Gestionar requisiciones de compra y coordinar proveedores para la ejecución de trabajos y proyectos en planta.` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Disyuncion de titulaciones admitidas; separar convertiria alternativas en exigencias acumulativas.
- `g02` — Separado por §4.1: la vineta enumera cuatro conocimientos independientes, cada uno con su propio nivel.
- `g03` — Ver g02. El nivel 'Intermedio' es qualifier material.
- `g04` — Ver g02.
- `g05` — Ver g02. 'excluyente' aparece al final de la vineta y aplica al ingles; es la unica modalidad obligatoria marcada explicitamente del aviso.
- `g06` — Compuesto preservado por §4.1: distribuir 'minimo de 2 anos' sobre las cuatro areas inventaria cuatro exigencias temporales.
- `g07` — Separado de g06 porque la fuente lo enuncia en oracion propia con verbo deontico distinto ('Debe tener').
- `g08` — Capacidad integrada (§5).
- `g11` — La enumeracion es el alcance de un unico deber de cumplimiento.

**No-requisitos explícitos (9):**

- `Abbott es líder mundial en cuidado de la salud, que crea ciencia innovadora para mejorar la salud de las perso…` → Prosa institucional (§7).
- `- Desarrollo profesional con una empresa internacional donde podrás hacer crecer la carrera que sueñas.…` → Beneficio ofrecido bajo 'Trabajando en Abbott'; no es criterio del holder.
- `- Una compañía reconocida como mejor lugar para trabajar en docenas de países alrededor del mundo y nombrada u…` → Prosa de reputacion corporativa.
- `Esta posición está ubicada en nuestra planta de producción en Florencio Varela, Buenos Aires en la división EP…` → Ubicacion del puesto, no exigencia.
- `Nuestro amplio portafolio de medicamentos genéricos de marca diferenciada y de alta calidad abarca múltiples á…` → Descripcion del portafolio de la empresa: las areas terapeuticas NO son requisitos de conocimiento (§7).
- `- Trabajar de manera transversal con Producción, Ingeniería, Mantenimiento, Calidad, Supply Chain y Finanzas p…` → Describe el entorno de trabajo transversal (§6, caso 'colaborar con equipos').
- `Abbott es un empleador de igualdad de oportunidades, comprometido con la diversidad de los empleados.…` → Declaracion de igualdad de oportunidades.
- `Conéctese con nosotros en www.abbott.com, en Facebook en www.facebook.com/Abbott y en Twitter @AbbottNews y @A…` → Enlaces de redes corporativas.
- `## Seniority level ⏎  ⏎ Not Applicable…` → Metadata de la plataforma LinkedIn.

**Pasajes ambiguos registrados (2) — no penalizan ni cuentan como omisión:**

- `Como **Ingeniero/a de Manufactura**, serás responsable de brindar soporte técnico, operativo y financiero a la…` → Resumen del rol que anticipa lo que la seccion 'Que haras' detalla en viñetas. Un anotador razonable podria emitir un claim de 'soporte tecnico, operativo y financiero'; aqui se trata como encuadre que las viñetas concretan.
- `Analizarás el desempeño de los procesos, identificarás oportunidades de mejora y participarás en la implementa…` → Reitera en prosa lo que g08 y g14 establecen en viñetas; solapamiento de la misma capacidad en dos secciones.

### EMP_065 — Técnico/a Ingeniería de Telecomunicaciones (Redeia, electronics, 7042 car.)

**Nota de anotación:** Objective mas largo de Development (7.042 car.), espanol de Espana, con numeracion de secciones embebida en el texto. Distingue con claridad requerido / deseable / se valorara, e incluye nivel de idioma certificable (B2-C1) y disponibilidad de viajes acotada ('de modo puntual en el ano').

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Titulación en Ingeniería de Telecomunicación o titulación equivalente. | modalidad: titulación requerida; titulación: Ingeniería de Telecomunicación; alternativa admitida: titulación equivalente | `**Requisitos** 1. Titulación requerida: Ingeniería de Telecomunicación o titulación equivalente.` |
| g02 | PREFERRED | Formación deseable: certificaciones o formación específica en redes IP, transmisión óptica, sincronización de red, automatización industrial o tecnologías del sector eléc | modalidad explícita: formación deseable; objetos alternativos: redes IP, transmisión óptica, sincronización de red, automatización industrial, tecnolo | `Formación deseable: certificaciones o formación específica en redes IP, transmisión óptica, sincronización de red, automatización industrial o tecnolo…` |
| g03 | PREFERRED | Se valorarán certificaciones en tecnologías IP y redes (CCNA, CCNP o equivalentes). | modalidad: se valorarán; objeto: certificaciones en tecnologías IP y redes; ejemplos alternativos: CCNA, CCNP o equivalentes | `Se valorarán certificaciones en tecnologías IP y redes (CCNA, CCNP o equivalentes), así como formación o certificación en IEC 61850 y/o PTP.` |
| g04 | PREFERRED | Se valorará formación o certificación en IEC 61850 y/o PTP. | modalidad: se valorarán; objeto: formación o certificación; normas: IEC 61850 y/o PTP | `Se valorarán certificaciones en tecnologías IP y redes (CCNA, CCNP o equivalentes), así como formación o certificación en IEC 61850 y/o PTP.` |
| g05 | REQUIRED | Experiencia de al menos 3 años en funciones similares. | cantidad: al menos 3 años; alcance: funciones similares | `Experiencia de al menos 3 años en funciones similares.` |
| g06 | REQUIRED | Experiencia consolidada en redes de telecomunicaciones, preferiblemente en entornos industriales o infraestructuras críticas. | nivel: consolidada; objeto: redes de telecomunicaciones; entorno preferido (no obligatorio): industriales o infraestructuras críticas | `Experiencia consolidada en redes de telecomunicaciones, preferiblemente en entornos industriales o infraestructuras críticas.` |
| g07 | REQUIRED | Experiencia en redes de misión crítica y servicios de alta disponibilidad. | objeto: redes de misión crítica; objeto: servicios de alta disponibilidad | `Experiencia en redes de misión crítica y servicios de alta disponibilidad.` |
| g08 | REQUIRED | Participación en proyectos de evolución tecnológica y coordinación transversal con distintas áreas y proveedores. | objeto: proyectos de evolución tecnológica; alcance: coordinación transversal con áreas y proveedores | `Participación en proyectos de evolución tecnológica y coordinación transversal con distintas áreas y proveedores.` |
| g09 | PREFERRED | Se valorará experiencia en transmisión, voz, sincronismo de red, entornos de subestaciones o tecnologías asociadas al sector eléctrico. | modalidad: se valorará; objetos alternativos: transmisión, voz, sincronismo de red, subestaciones, sector eléctrico | `Se valorará experiencia en transmisión, voz, sincronismo de red, entornos de subestaciones o tecnologías asociadas al sector eléctrico.` |
| g10 | PREFERRED | Se valorará experiencia en soporte técnico avanzado y en análisis de soluciones con alto componente tecnológico. | modalidad: se valorará; objeto: soporte técnico avanzado; objeto: análisis de soluciones con alto componente tecnológico | `Se valorará experiencia en soporte técnico avanzado y en análisis de soluciones con alto componente tecnológico.` |
| g11 | REQUIRED | Perfil tecnólogo: interés real por la tecnología, curiosidad técnica y motivación por aprender y profundizar en nuevas soluciones de telecomunicaciones. | actitud: interés real por la tecnología; actitud: curiosidad técnica; actitud: motivación por aprender en telecomunicaciones | `Perfil tecnólogo: interés real por la tecnología, curiosidad técnica y motivación por aprender y profundizar en nuevas soluciones de telecomunicacione…` |
| g12 | REQUIRED | Capacidad de diseño y análisis: criterio técnico para evaluar alternativas, estructurar soluciones y defender propuestas de evolución tecnológica. | capacidad integrada: diseño y análisis; alcance: evaluar alternativas, estructurar soluciones, defender propuestas | `Capacidad de diseño y análisis: criterio técnico para evaluar alternativas, estructurar soluciones y defender propuestas de evolución tecnológica.` |
| g13 | REQUIRED | Rigor técnico y foco en continuidad de servicio: orientación a la fiabilidad, robustez y disponibilidad en entornos de misión crítica. | atributo: rigor técnico; foco: continuidad de servicio; entorno: misión crítica | `Rigor técnico y foco en continuidad de servicio: orientación a la fiabilidad, robustez y disponibilidad en entornos de misión crítica.` |
| g14 [AMBIGUO] | REQUIRED | Colaboración transversal: capacidad para trabajar de forma coordinada con otras áreas, proveedores y fabricantes en entornos multidisciplinares. | capacidad: coordinación transversal; interlocutores: áreas, proveedores, fabricantes; entorno: multidisciplinar | `Colaboración transversal: capacidad para trabajar de forma coordinada con otras áreas, proveedores y fabricantes en entornos multidisciplinares.` |
| g15 | REQUIRED | Autonomía y comunicación clara: capacidad para desenvolverse con independencia en entornos técnicos complejos y explicar con claridad los aspectos clave de una solución. | capacidad: autonomía en entornos técnicos complejos; capacidad: comunicación clara de soluciones | `Autonomía y comunicación clara: capacidad para desenvolverse con independencia en entornos técnicos complejos y explicar con claridad los aspectos cla…` |
| g16 | REQUIRED | Orientación a la evolución y mejora continua: actitud proactiva para identificar oportunidades de modernización y aportar valor técnico. | actitud: proactiva; objetivo: identificar oportunidades de modernización y aportar valor técnico | `Orientación a la evolución y mejora continua: actitud proactiva para identificar oportunidades de modernización y aportar valor técnico al desarrollo …` |
| g17 | REQUIRED | Nivel alto de inglés (B2-C1), para documentación técnica e interlocución con fabricantes y/o ponencias públicas en el extranjero. | idioma: inglés; nivel: alto (B2-C1); usos: documentación técnica, interlocución con fabricantes, ponencias públicas | `4. Nivel alto de inglés (B2-C1), especialmente para documentación técnica e interlocución con fabricantes y/o ponencias públicas en el extranjero.` |
| g18 | REQUIRED | Disponibilidad para colaboración transversal y participación en proyectos con componente técnico relevante. | disponibilidad: colaboración transversal y proyectos técnicos | `Disponibilidad para colaboración transversal y participación en proyectos con componente técnico relevante.` |
| g19 | REQUIRED | Disponibilidad para viajes nacionales e internacionales de modo puntual en el año. | disponibilidad: viajes nacionales e internacionales; frecuencia: puntual en el año | `Disponibilidad para viajes nacionales e internacionales de modo puntual en el año.` |
| g20 | REQUIRED | Participar en el diseño, revisión y evolución de las redes de telecomunicaciones corporativas y operativas, asegurando coherencia técnica, adecuación a entornos de misión | actividad integrada: diseño, revisión y evolución; objeto: redes corporativas y operativas; criterios: coherencia técnica, misión crítica, alineación  | `**Funciones básicas** 1. Diseño y evolución de redes de telecomunicaciones: participar en el diseño, revisión y evolución de las redes de telecomunica…` |
| g21 | REQUIRED | Elaborar, analizar y presentar proyectos técnicos de nuevas tecnologías de telecomunicaciones (redes IP, transmisión óptica y otras), valorando viabilidad técnica, impact | actividad integrada: elaborar, analizar y presentar; objeto: proyectos técnicos; alcance: redes IP, transmisión óptica y otras soluciones avanzadas; c | `2. Desarrollo de proyectos de evolución tecnológica: elaborar, analizar y presentar proyectos técnicos con especial foco en nuevas tecnologías de tele…` |
| g22 | REQUIRED | Dar soporte técnico especializado a redes y sistemas de telecomunicaciones de misión crítica, incluidas subestaciones eléctricas, apoyando en la resolución de incidencias | nivel: soporte técnico especializado; entorno: misión crítica, subestaciones eléctricas; alcance: incidencias complejas y continuidad del servicio | `3. Soporte técnico experto a infraestructuras críticas: dar soporte técnico especializado a redes y sistemas de telecomunicaciones de misión crítica, …` |
| g23 | REQUIRED | Elaborar y revisar especificaciones técnicas, documentación de diseño y criterios de implantación, y participar en la evaluación técnica de soluciones, ofertas y propuest | actividad integrada: elaborar y revisar; objetos: especificaciones, documentación de diseño, criterios de implantación; alcance adicional: evaluación  | `4. Especificaciones técnicas y evaluación de soluciones: elaborar y revisar especificaciones técnicas, documentación de diseño y criterios de implanta…` |
| g24 | REQUIRED | Coordinar actuaciones técnicas con fabricantes, integradores, operadores y otras áreas internas, asegurando una implantación ordenada, robusta y alineada con los estándar | actividad: coordinar actuaciones técnicas; interlocutores: fabricantes, integradores, operadores, áreas internas; criterios: implantación ordenada, ro | `Coordinar actuaciones técnicas con fabricantes, integradores, operadores y otras áreas internas, favoreciendo una visión transversal de los proyectos …` |
| g25 | REQUIRED | Contribuir a la definición de estándares, buenas prácticas y criterios técnicos del Departamento, aportando visión sobre transmisión, voz, sincronismo y evolución de rede | actividad: contribuir a definir estándares y criterios técnicos; alcance: transmisión, voz, sincronismo, evolución de redes | `Contribuir a la definición de estándares, buenas prácticas y criterios técnicos del Departamento, aportando una visión tecnóloga y proactiva sobre sol…` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — La alternativa 'o titulacion equivalente' amplia el objeto y es material.
- `g02` — Los objetos van unidos por 'o' (alternativos) bajo un unico marcador de preferencia; separar convertiria una disyuncion deseable en cinco preferencias independientes.
- `g03` — Separado del claim IEC 61850/PTP porque 'asi como' introduce un segundo objeto de certificacion distinto.
- `g04` — Ver g03. 'y/o' preserva la disyuncion inclusiva.
- `g06` — Modalidad mixta dentro del mismo claim: la experiencia es requerida y el entorno solo 'preferiblemente'. Perder ese 'preferiblemente' fortaleceria el claim.
- `g14` **[AMBIGUO]** — Colinda con el caso 'colaborar con equipos' que §6 trata como entorno; aqui la fuente lo enuncia explicitamente como 'capacidad' dentro de la seccion de soft skills exigidas, por eso se anota como Requirement.
- `g17` — El nivel certificable (B2-C1) es qualifier material.
- `g19` — 'de modo puntual en el ano' limita la exigencia; eliminarlo la fortaleceria.
- `g20` — Capacidad integrada (§5).

**No-requisitos explícitos (8):**

- `Nacimos como el primer TSO del mundo. Hoy somos un gestor global de infraestructuras esenciales de electricida…` → Prosa institucional (§7).
- `Una red compuesta por cinco marcas, más de 2.100 profesionales y millones de personas unidas por el valor de l…` → Cifras corporativas ('2.100 profesionales') que NO son qualifiers de ningun requisito.
- `En Red eléctrica, empresa de Redeia, más de 1.200 personas estamos pendientes de un gesto tuyo, para llevarte …` → Prosa institucional con cifra de plantilla; trampa de contexto-vs-requisito.
- `Estamos buscando incorporar un/a Técnico/a Ingeniería de Telecomunicaciones para formar parte del equipo Dp. T…` → Enunciado del puesto; el titulo es contexto y no crea Requirements (§8).
- `- Un empleo estable y de calidad, donde la empleabilidad y la movilidad funcional son palancas clave de crecim…` → Beneficio ofrecido.
- `- Un modelo de compensación justo y competitivo con el mercado, orientado a disminuir la brecha salarial entre…` → Politica de compensacion ofrecida, no criterio.
- `En Redeia celebramos el talento y la diversidad y apostamos por una cultura inclusiva, donde las personas empl…` → Compromisos corporativos; 'respeto, integridad, sostenibilidad' son valores de la empresa, no requisitos del holder.
- `## Industries ⏎  ⏎ Renewable Energy Semiconductor Manufacturing, Oil and Gas, and Telecommunications…` → Metadata de la plataforma LinkedIn.

**Pasajes ambiguos registrados (2) — no penalizan ni cuentan como omisión:**

- `Coordinación transversal y relación con terceros.…` → Encabezado de funcion que quedo embebido en el parrafo 4 tras la conversion; su contenido se anota en g24.
- `Impulso de buenas prácticas y evolución tecnológica del área.…` → Idem: encabezado embebido cuyo contenido se anota en g25.

### EMP_060 — Ingeniero/a de Confiabilidad (Louis Dreyfus Company, mechanical_engineering, 3806 car.)

**Nota de anotación:** Caso central de negacion del bloque de Development: '(no excluyente)' al final de la unica linea de experiencia. Ademas contiene un nivel de idioma acotado por habilidad ('Ingles intermedio (lectura)') y un encabezado de preferencia ('Valoramos perfiles con:') que gobierna cuatro viñetas.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Graduado/a de Ingeniería Mecánica. | nivel: graduado; carrera: Ingeniería Mecánica | `- Graduado/a de Ingeniería Mecánica` |
| g02 | PREFERRED | Experiencia previa de aproximadamente 1 año en roles similares en entorno industrial (no excluyente). | modalidad explícita: no excluyente; cantidad aproximada: aprox. 1 año; alcance: roles similares; entorno: industrial | `- Experiencia previa (aprox. 1 año) en roles similares en entorno industrial (no excluyente)` |
| g03 | REQUIRED | Inglés intermedio (lectura). | idioma: inglés; nivel: intermedio; habilidad acotada: lectura | `- Inglés intermedio (lectura).` |
| g04 | REQUIRED | Manejo de Office. | objeto: Office | `- Manejo de herramientas: Office, SAP, CAD, SolidWorks.` |
| g05 | REQUIRED | Manejo de SAP. | objeto: SAP | `- Manejo de herramientas: Office, SAP, CAD, SolidWorks.` |
| g06 | REQUIRED | Manejo de CAD. | objeto: CAD | `- Manejo de herramientas: Office, SAP, CAD, SolidWorks.` |
| g07 | REQUIRED | Manejo de SolidWorks. | objeto: SolidWorks | `- Manejo de herramientas: Office, SAP, CAD, SolidWorks.` |
| g08 | PREFERRED | Valorado: capacidad analítica y orientación a resolución de problemas. | modalidad: valoramos; capacidad: analítica; orientación: resolución de problemas | `Valoramos perfiles con: ⏎  ⏎ - Capacidad analítica y orientación a resolución de problemas.` |
| g09 | PREFERRED | Valorado: buenas habilidades de comunicación y trabajo en equipo. | modalidad: valoramos; soft skill: comunicación; soft skill: trabajo en equipo | `Valoramos perfiles con: ⏎  ⏎ - Capacidad analítica y orientación a resolución de problemas. ⏎ - Buenas habilidades de comunicación y trabajo en equipo…` |
| g10 | PREFERRED | Valorado: proactividad, dinamismo y autonomía. | modalidad: valoramos; actitudes: proactividad, dinamismo, autonomía | `Valoramos perfiles con: ⏎  ⏎ - Capacidad analítica y orientación a resolución de problemas. ⏎ - Buenas habilidades de comunicación y trabajo en equipo…` |
| g11 | PREFERRED | Valorado: capacidad para gestionar múltiples tareas y priorizar. | modalidad: valoramos; capacidad: gestionar múltiples tareas y priorizar | `Valoramos perfiles con: ⏎  ⏎ - Capacidad analítica y orientación a resolución de problemas. ⏎ - Buenas habilidades de comunicación y trabajo en equipo…` |
| g12 | REQUIRED | Analizar fallas mecánicas y realizar Análisis de Causa Raíz (ACR) para definir acciones correctivas. | actividad integrada: analizar fallas y realizar ACR; finalidad: definir acciones correctivas | `- Analizar fallas mecánicas y realizar ACR (Análisis de Causa Raíz) para definir acciones correctivas.` |
| g13 | REQUIRED | Liderar proyectos de mejora y CAPEX, incluyendo definición técnica, compras y ejecución. | actividad: liderar; objetos: proyectos de mejora y CAPEX; alcance: definición técnica, compras, ejecución | `- Liderar proyectos de mejora y CAPEX, incluyendo definición técnica, compras y ejecución.` |
| g14 | REQUIRED | Proponer e implementar mejoras en sistemas y equipos para optimizar la operación. | actividad integrada: proponer e implementar; objeto: sistemas y equipos; finalidad: optimizar la operación | `- Proponer e implementar mejoras en sistemas y equipos para optimizar la operación.` |
| g15 | REQUIRED | Gestionar información técnica de activos (planos, manuales, materiales) en SAP. | objeto: información técnica de activos; alcance: planos, manuales, materiales; sistema: SAP | `- Gestionar información técnica de activos (planos, manuales, materiales) en SAP.` |
| g16 | REQUIRED | Administrar procedimientos de mantenimiento y documentación técnica. | objeto: procedimientos de mantenimiento; objeto: documentación técnica | `- Administrar procedimientos de mantenimiento y documentación técnica.` |
| g17 | REQUIRED | Asegurar el cumplimiento de estándares de seguridad, calidad y medio ambiente durante la ejecución de trabajos. | actividad: asegurar cumplimiento; estándares: seguridad, calidad, medio ambiente; momento: ejecución de trabajos | `- Asegurar el cumplimiento de estándares de seguridad, calidad y medio ambiente durante la ejecución de trabajos.` |
| g18 | REQUIRED | Realizar seguimiento de órdenes de compra y servicios asociados a su gestión. | actividad: seguimiento; objetos: órdenes de compra y servicios asociados | `- Realizar seguimiento de órdenes de compra y servicios asociados a su gestión.` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g02` — La marca '(no excluyente)' convierte todo el claim en preferencia: tratarlo como requisito seria una inversion de negacion. La cantidad es aproximada ('aprox.') y ese matiz es material.
- `g03` — '(lectura)' acota la habilidad exigida; eliminarlo fortaleceria el claim a dominio general del idioma.
- `g04` — Separado por §4.1: 'Manejo de herramientas' distribuye sobre cuatro herramientas independientes.
- `g05` — Ver g04.
- `g06` — Ver g04.
- `g07` — Ver g04.
- `g08` — El excerpt abarca de forma contigua el encabezado de modalidad y la vineta (§12 P2.0).
- `g09` — Excerpt contiguo desde el encabezado de modalidad.
- `g10` — Excerpt contiguo desde el encabezado de modalidad.
- `g11` — Excerpt contiguo desde el encabezado de modalidad.
- `g12` — Capacidad integrada (§5): el ACR es el metodo del analisis de fallas.
- `g14` — Capacidad integrada (§5): proponer sin implementar no satisface el criterio tal como la fuente lo enuncia.

**No-requisitos explícitos (9):**

- `Louis Dreyfus Company es una empresa líder en la comercialización y transformación de productos agrícolas.…` → Prosa institucional (§7).
- `Estructurada como una organización matricial de seis regiones geográficas y diez plataformas, Louis Dreyfus Co…` → Cifras corporativas ('mas de 100 paises', '18.000 personas') que no son qualifiers de requisito.
- `El propósito del rol es asegurar la confiabilidad de los equipos y procesos, garantizando su funcionamiento co…` → Proposito del puesto; el contenido evaluable se detalla en las viñetas de responsabilidades.
- `Se trata de una posición con fuerte foco en análisis técnico, mejora continua y optimización de activos indust…` → Caracterizacion del puesto, no criterio.
- `- Salario y Beneficios Competitivos.…` → Beneficio ofrecido.
- `- Licencia por Maternidad y Paternidad Extendida.…` → Beneficio ofrecido.
- `LDC es una empresa que ofrece igualdad de oportunidades y se compromete a proporcionar un entorno de trabajo q…` → Declaracion de igualdad de oportunidades. Contiene 'valore' pero no marca preferencia sobre ningun criterio del holder.
- `El valor sustentable está en el centro de nuestro propósito como empresa.…` → Prosa de sostenibilidad corporativa.
- `## Seniority level ⏎  ⏎ Not Applicable…` → Metadata de la plataforma LinkedIn.

### EMP_067 — Analista de Desarrollo Galénico (Biosintex Laboratorio, biotechnology, 2870 car.)

**Nota de anotación:** Aviso farmaceutico argentino con seccion de requisitos muy compacta y tres modalidades distintas en cuatro lineas: '(excluyente)', 'Se valorara' y '(deseable)'. El bloque institucional posterior esta lleno de cifras de la empresa ('mas de 25 anos', 'mas de 200 personas', 'mas de 50 marcas') que son trampas de contexto-vs-requisito.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Formación de Farmacéutico/a, Lic. en Química, Ingeniería Química o afines. | titulaciones alternativas: Farmacéutico/a, Lic. en Química, Ingeniería Química o afines | `- Farmacéutico/a, Lic. en Química, Ingeniería Química o afines` |
| g02 | REQUIRED | Experiencia en desarrollo galénico (excluyente). | modalidad explícita: excluyente; naturaleza: experiencia; objeto: desarrollo galénico | `- Experiencia en desarrollo galénico (excluyente)` |
| g03 | PREFERRED | Se valorará experiencia previa en áreas analíticas. | modalidad: se valorará; naturaleza: experiencia previa; objeto: áreas analíticas | `- Se valorará experiencia previa en áreas analíticas` |
| g04 [AMBIGUO] | REQUIRED | Formulación de sólidos y/o líquidos, siendo deseables otras formas farmacéuticas. | objeto: formulación de sólidos y/o líquidos; alcance ampliado deseable: otras formas farmacéuticas | `- Formulación de sólidos y/o líquidos (deseable otras formas)` |
| g05 | REQUIRED | Buen manejo de documentación y normativas (GMP). | nivel: buen manejo; objeto: documentación; objeto: normativas GMP | `- Buen manejo de documentación y normativas (GMP)` |
| g06 | PREFERRED | Inglés técnico (deseable). | modalidad explícita: deseable; idioma: inglés; alcance: técnico | `- Inglés técnico (deseable)` |
| g07 | REQUIRED | Desarrollar y optimizar formulaciones de distintas formas farmacéuticas. | actividad integrada: desarrollar y optimizar; objeto: formulaciones; alcance: distintas formas farmacéuticas | `- Desarrollar y optimizar formulaciones de distintas formas farmacéuticas` |
| g08 | REQUIRED | Elaborar lotes a escala laboratorio y piloto. | actividad: elaborar lotes; escalas: laboratorio y piloto | `- Elaborar lotes a escala laboratorio y piloto` |
| g09 | REQUIRED | Definir y ejecutar protocolos de desarrollo. | actividad integrada: definir y ejecutar; objeto: protocolos de desarrollo | `- Definir y ejecutar protocolos de desarrollo` |
| g10 | REQUIRED | Realizar ensayos farmacotécnicos y analizar resultados. | actividad integrada: realizar ensayos y analizar resultados; objeto: ensayos farmacotécnicos | `- Realizar ensayos farmacotécnicos y analizar resultados` |
| g11 | REQUIRED | Registrar y documentar ensayos conforme a normativas vigentes. | actividad: registrar y documentar; objeto: ensayos; restricción: conforme a normativas vigentes | `- Registrar y documentar ensayos conforme a normativas vigentes` |
| g12 | REQUIRED | Participar en el escalado y seguimiento de lotes en planta productiva. | actividad: escalado y seguimiento de lotes; entorno: planta productiva | `- Participar en el escalado y seguimiento de lotes en planta productiva` |
| g13 | REQUIRED | Colaborar en la confección de documentación técnica (guías de manufactura, reportes, etc.). | objeto: documentación técnica; alcance ejemplificado: guías de manufactura, reportes | `- Colaborar en la confección de documentación técnica (guías de manufactura, reportes, etc.)` |
| g14 [AMBIGUO] | REQUIRED | Coordinar actividades con Producción, Control de Calidad y otras áreas. | actividad: coordinar; interlocutores: Producción, Control de Calidad, otras áreas | `- Coordinar actividades con Producción, Control de Calidad y otras áreas` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Disyuncion de titulaciones admitidas; separar convertiria alternativas en exigencias acumulativas.
- `g02` — Unico requisito marcado como excluyente; la marca es material y debe sobrevivir.
- `g04` — 'y/o' preserva la disyuncion inclusiva entre solidos y liquidos.
- `g04` **[AMBIGUO]** — Modalidad mixta en una misma vineta: la formulacion de solidos y/o liquidos se presenta sin marca (requerida por posicion en la seccion de Conocimientos) mientras que 'otras formas' lleva marca de preferencia. Se anota el claim principal como REQUIRED y se registra el alcance deseable como qualifier, en lugar de emitir dos claims con modalidades distintas sobre el mismo objeto.
- `g06` — 'tecnico' acota el alcance del idioma y es material.
- `g07` — Capacidad integrada (§5).
- `g08` — Las dos escalas delimitan el alcance de una misma actividad.
- `g09` — Capacidad integrada (§5): definir sin ejecutar no satisface el criterio tal como se enuncia.
- `g14` **[AMBIGUO]** — Colinda con el caso 'colaborar con equipos' de §6; se anota como Requirement porque 'coordinar actividades' es una capacidad operativa y no una mera descripcion del entorno.

**No-requisitos explícitos (7):**

- `Somos un laboratorio farmacéutico argentino de especialidades medicinales con más de 25 años de trayectoria en…` → Prosa institucional. 'mas de 25 anos' es antiguedad de la empresa, NO experiencia exigida; confundirlo seria una alucinacion material.
- `El espíritu emprendedor y la creatividad de las más de 200 personas que trabajan día a día para llegar a todas…` → Prosa institucional con cifra de plantilla.
- `Hoy, con 2 plantas farmacéuticas G.M.P (Good Manufacturing Practices), más de 4500m2 ubicados en Capital Feder…` → Contexto de la empresa. Menciona GMP como caracteristica de sus plantas, no como requisito; el requisito GMP se establece por separado en Conocimientos (g05).
- `Nuestro alcance global llegando a más de 7 países nos motiva y desafía más allá de nuestros límites.…` → Prosa institucional.
- `l reconocimiento de nuestras más de 50 marcas está validado por miles de familias que eligen cada día Bucoangi…` → Catalogo de marcas de la empresa; ninguna es un criterio del holder.
- `Valoramos la proactividad y el esfuerzo personal hacia la mejora continua y el conocimiento enriquecido a part…` → Declaracion de valores corporativos ubicada fuera de la seccion de requisitos. Caso limite deliberado: usa el verbo 'Valoramos' pero se enuncia sobre la organizacion, no como criterio de seleccion. Se registra tambien como pasaje ambiguo.
- `## Job function ⏎  ⏎ Business Development and Sales…` → Metadata de la plataforma LinkedIn, ademas incorrecta respecto del puesto real.

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `Valoramos la proactividad y el esfuerzo personal hacia la mejora continua y el conocimiento enriquecido a part…` → Un anotador razonable podria emitir un Requirement PREFERRED de proactividad y mejora continua. Aqui se trata como prosa de valores por su ubicacion fuera del bloque de Requisitos. No se penaliza si el extractor lo emite.

### EMP_070 — Ingeniero Senior de Procesos (SAXUM, other_engineering, 3005 car.)

**Nota de anotación:** Caso deliberado de contradiccion interna de modalidad sobre la misma credencial (QP): 'Se valorara la condicion de (QP)' en tareas vs 'Certificacion vigente y credenciales profesionales para actuar formalmente como QP' en experiencia. Ambos claims se conservan. Ademas contiene el umbral de experiencia mas alto del bloque ('Mas de 10 anos') y un '(excluyente)' sobre el ingles.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Título universitario en Ingeniería Química, Ingeniería Metalúrgica o una disciplina técnica estrechamente relacionada. | nivel: título universitario; carreras alternativas: Ingeniería Química, Ingeniería Metalúrgica o disciplina técnica relacionada | `- Título universitario en Ingeniería Química, Ingeniería Metalúrgica o una disciplina técnica estrechamente relacionada.` |
| g02 | REQUIRED | Más de 10 años de experiencia sólida en el diseño y operación de procesos de extracción de litio, salmueras, metales y minerales. | cantidad: más de 10 años; nivel: sólida; actividad integrada: diseño y operación; alcance: extracción de litio, salmueras, metales y minerales | `- Mas de 10 años de experiencia sólida en el diseño y operación de procesos de extracción de litio, salmueras, metales y minerales.` |
| g03 [AMBIGUO] | REQUIRED | Certificación vigente y credenciales profesionales para actuar formalmente como Persona Calificada (QP) en la industria minera. | estado: vigente; objeto: certificación y credenciales profesionales; habilitación: actuar formalmente como QP; ámbito: industria minera | `- Certificación vigente y credenciales profesionales para actuar formalmente como Persona Calificada (QP) en la industria minera.` |
| g04 | REQUIRED | Dominio avanzado del idioma inglés (excluyente) para redacción de reportes y comunicación con equipos globales. | modalidad explícita: excluyente; idioma: inglés; nivel: dominio avanzado; usos: redacción de reportes, comunicación fluida con equipos globales | `- Dominio avanzado del idioma inglés (excluyente) para la redacción de reportes y comunicación fluida con equipos globales.` |
| g05 | REQUIRED | Disponibilidad para realizar viajes a los proyectos o trabajar bajo esquemas de rotación en zonas remotas. | disponibilidad: viajes a proyectos; alternativa: esquemas de rotación en zonas remotas | `- Disponibilidad para realizar viajes a los proyectos o trabajar bajo esquemas de rotación en zonas remotas.` |
| g06 | REQUIRED | Conocimiento de Software de Simulación de Procesos y Validación de Modelos. | objeto: software de simulación de procesos; objeto: validación de modelos | `- Conocimiento de Software de Simulación de Procesos y Validación de Modelos.` |
| g07 | REQUIRED | Liderar el diseño conceptual, básico y de detalle para plantas de procesamiento de litio y manejo de salmueras. | actividad: liderar el diseño; fases: conceptual, básico y de detalle; objeto: plantas de procesamiento de litio y manejo de salmueras | `- Liderar el diseño conceptual, básico y de detalle para plantas de procesamiento de litio y manejo de salmueras.` |
| g08 | REQUIRED | Optimizar los procesos químicos y metalúrgicos para maximizar la recuperación de recursos y la eficiencia operativa diaria. | actividad: optimizar; objeto: procesos químicos y metalúrgicos; objetivos: recuperación de recursos y eficiencia operativa diaria | `- Optimizar los procesos químicos y metalúrgicos para maximizar la recuperación de recursos y la eficiencia operativa diaria.` |
| g09 | REQUIRED | Brindar soporte experto durante las fases de pruebas, comisionamiento y puesta en marcha de las plantas de procesamiento. | nivel: soporte experto; fases: pruebas, comisionamiento, puesta en marcha; objeto: plantas de procesamiento | `- Brindar soporte experto durante las fases de pruebas, comisionamiento y puesta en marcha de las plantas de procesamiento.` |
| g10 [AMBIGUO] | PREFERRED | Se valorará la condición de Persona Calificada (QP) para proyectos de envergadura. | modalidad: se valorará; condición: QP; alcance: proyectos de envergadura | `- Se valorará la condición de (QP) para proyectos de envergadura` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Disyuncion de titulaciones admitidas.
- `g02` — Compuesto preservado por §4.1: distribuir 'mas de 10 anos' sobre diseno y operacion, o sobre los cuatro materiales, duplicaria la exigencia temporal.
- `g03` — 'Certificacion vigente y credenciales profesionales' es el objeto unico de una habilitacion formal.
- `g03` **[AMBIGUO]** — Contradiccion real dentro del mismo aviso: la seccion de tareas dice 'Se valorara la condicion de (QP)' (preferencia) y la seccion de experiencia la enuncia sin marca, en una lista encabezada por 'La experiencia que aportaras'. Se anotan AMBOS claims (g03 y g10) porque difieren materialmente en fuerza y §17 prohibe colapsar solapamientos de distinta fuerza. No se resuelve la contradiccion en la direccion que facilite el scoring.
- `g05` — Las dos modalidades van unidas por 'o' (alternativas): separar convertiria una disyuncion en dos exigencias.
- `g07` — Las tres fases de diseno delimitan el alcance de una unica responsabilidad de liderazgo tecnico.
- `g10` — Solapa con g03 con fuerza distinta; §17 prohibe colapsarlos.
- `g10` **[AMBIGUO]** — Ver g03: el mismo aviso presenta la condicion QP como valorada en una seccion y como credencial requerida en otra. Se conservan los dos claims con sus modalidades respectivas.

**No-requisitos explícitos (9):**

- `Con oficinas en Australia, Canadá, EE. UU., Sudáfrica, Ghana, Filipinas, Argentina y Perú, SAXUM (una empresa …` → Prosa institucional y geografica (§7). Los sectores listados son los de la empresa, no requisitos del holder.
- `SAXUM se encuentra actualmente en la búsqueda de un Ingeniero Senior de Procesos para unirse a nuestro crecien…` → Enunciado del puesto; el titulo es contexto (§8).
- `Reportando al Chief Operating Officer, el Ingeniero Senior de Procesos se encargará de liderar el diseño, la o…` → Linea de reporte y resumen del rol que las viñetas de tareas concretan; se registra ademas como pasaje ambiguo.
- `- Colaborar estrechamente con equipos multidisciplinarios e internacionales para garantizar la correcta implem…` → Descripcion del entorno de trabajo colaborativo (§6, caso 'colaborar con equipos').
- `- Trabajar en proyectos internacionales de alto impacto en minería, infraestructura y procesos industriales.…` → Beneficio ofrecido bajo '¿Por que unirse a SAXUM?'.
- `- Disfrutar de oportunidades de crecimiento profesional, aprendizaje continuo y exposición global.…` → Beneficio ofrecido.
- `Como parte de nuestro compromiso de brindar la mejor atención y servicio posible a ti como candidato, nos comp…` → Compromiso del proceso de seleccion, no criterio.
- `Por favor, envía tu CV haciendo clic en el botón 'Apply'.…` → Instruccion de postulacion.
- `## Industries ⏎  ⏎ Engineering Services…` → Metadata de la plataforma LinkedIn.

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `Reportando al Chief Operating Officer, el Ingeniero Senior de Procesos se encargará de liderar el diseño, la o…` → Introduce 'evaluacion tecnica de los procesos', que no reaparece en las viñetas de tareas. Un anotador razonable podria emitir un claim propio; aqui se trata como resumen del rol.


---

## Partición: holdout

### EMP_043 — Full-Stack Developer (Secretaria de Gobierno Digital, software_informatics, 5075 car.)

**Nota de anotación:** HOLDOUT. Aviso de sector publico chileno, largo (5.075 car.), con requisitos tecnicos en viñetas densas, requisitos formales del cargo publico, funciones que repiten el stack y una seccion de opcionales con negacion explicita ('Suman, pero no son excluyentes'). Contiene la trampa de contexto-vs-requisito mas peligrosa del Holdout: una condicion de tramo salarial redactada con anos de experiencia y grado academico.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Backend con Node.js, Express o similares, Python (Django, Flask o FastAPI) y/o Java (Spring Boot). | capa: backend; tecnologías alternativas: Node.js/Express, Python (Django, Flask, FastAPI), Java (Spring Boot); conector: 'y/o' (disyuncion inclusiva) | `- **Backend** con Node.js, Express o similares, Python (Django, Flask o FastAPI) y/o Java (Spring Boot); **frontend** con React, Angular, Vue.js o fra…` |
| g02 | REQUIRED | Frontend con React, Angular, Vue.js o frameworks equivalentes. | capa: frontend; tecnologías alternativas: React, Angular, Vue.js o equivalentes | `- **Backend** con Node.js, Express o similares, Python (Django, Flask o FastAPI) y/o Java (Spring Boot); **frontend** con React, Angular, Vue.js o fra…` |
| g03 | REQUIRED | Diseño, implementación y consumo de APIs REST y GraphQL en arquitecturas de microservicios, documentadas con OpenAPI/Swagger o equivalentes. | actividad integrada: diseño, implementación y consumo; objeto: APIs REST y GraphQL; entorno: arquitecturas de microservicios; estándar de documentació | `- **Diseño, implementación y consumo de APIs** REST y GraphQL en arquitecturas de microservicios, documentadas con OpenAPI/Swagger o equivalentes.` |
| g04 | REQUIRED | Arquitecturas de microservicios: integración por mensajería y eventos, patrones de diseño, principios SOLID y desarrollo orientado a dominios (DDD). | objeto: arquitecturas de microservicios; alcance: mensajería y eventos, patrones de diseño, SOLID, DDD | `- **Arquitecturas de microservicios**: integración por mensajería y eventos, patrones de diseño, principios SOLID y desarrollo orientado a dominios (D…` |
| g05 | REQUIRED | Bases de datos relacionales y NoSQL (PostgreSQL, MySQL, MongoDB, Amazon RDS, Redis o equivalentes) en diseño, desarrollo y optimización. | objetos: bases de datos relacionales y NoSQL; motores alternativos: PostgreSQL, MySQL, MongoDB, Amazon RDS, Redis o equivalentes; actividades: diseño, | `- **Bases de datos relacionales y NoSQL**: PostgreSQL, MySQL, MongoDB, Amazon RDS, Redis o equivalentes, en diseño, desarrollo y optimización.` |
| g06 | REQUIRED | Desarrollo e integración de aplicaciones desplegadas en plataformas cloud, preferentemente AWS, con servicios administrados y buenas prácticas de escalabilidad, resilienc | actividad integrada: desarrollo e integración; entorno: plataformas cloud; preferencia interna (no obligatoria): AWS; buenas prácticas: escalabilidad, | `- **Cloud**: desarrollo e integración de aplicaciones desplegadas en plataformas cloud, preferentemente AWS, con servicios administrados y buenas prác…` |
| g07 | REQUIRED | Contenedores y DevOps: Docker, Kubernetes y CI/CD con GitLab CI/CD, GitHub Actions, Jenkins, Argo CD o equivalentes. | objetos: Docker, Kubernetes; objeto: CI/CD; herramientas alternativas de CI/CD: GitLab CI/CD, GitHub Actions, Jenkins, Argo CD o equivalentes | `- **Contenedores y DevOps**: Docker, Kubernetes y CI/CD con GitLab CI/CD, GitHub Actions, Jenkins, Argo CD o equivalentes.` |
| g08 | REQUIRED | Desarrollo asistido por IA: uso de asistentes de programación y herramientas de desarrollo agéntico para programar, revisar código, documentar y automatizar, manteniendo  | objeto: asistentes de programación y herramientas agénticas; usos: programar, revisar código, documentar, automatizar; restricción material: supervisi | `- **Desarrollo asistido por IA**: asistentes de programación y herramientas de desarrollo agéntico para programar, revisar código, documentar y automa…` |
| g09 | REQUIRED | Desarrollo seguro y gestión de vulnerabilidades: OWASP Top 10, OWASP ASVS, Secure by Design, ISO/IEC 27001 y NIST Cybersecurity Framework. | objeto: desarrollo seguro y gestión de vulnerabilidades; marcos: OWASP Top 10, OWASP ASVS, Secure by Design, ISO/IEC 27001, NIST CSF | `- **Desarrollo seguro y gestión de vulnerabilidades**: OWASP Top 10, OWASP ASVS, Secure by Design, ISO/IEC 27001 y NIST Cybersecurity Framework.` |
| g10 | REQUIRED | Pruebas y aseguramiento de calidad: JUnit, JUnit 5, Jest, PyTest, Selenium, Cypress, Postman, Insomnia o equivalentes. | objeto: pruebas y aseguramiento de calidad; herramientas alternativas: JUnit, JUnit 5, Jest, PyTest, Selenium, Cypress, Postman, Insomnia o equivalent | `- **Pruebas y aseguramiento de calidad**: JUnit, JUnit 5, Jest, PyTest, Selenium, Cypress, Postman, Insomnia o equivalentes.` |
| g11 | REQUIRED | Control de versiones con Git sobre GitHub, GitLab o equivalentes, con flujos colaborativos (GitFlow, Trunk Based Development o similares). | objeto: Git; plataformas alternativas: GitHub, GitLab o equivalentes; flujos alternativos: GitFlow, Trunk Based Development o similares | `- **Control de versiones** con Git sobre GitHub, GitLab o equivalentes, con flujos colaborativos (GitFlow, Trunk Based Development o similares).` |
| g12 | REQUIRED | Documentación técnica: diagramas de arquitectura, especificaciones funcionales y documentación de APIs con Swagger/OpenAPI, Markdown o plataformas equivalentes. | objetos: diagramas de arquitectura, especificaciones funcionales, documentación de APIs; herramientas alternativas: Swagger/OpenAPI, Markdown o equiva | `- **Documentación técnica**: diagramas de arquitectura, especificaciones funcionales y documentación de APIs con Swagger/OpenAPI, Markdown o plataform…` |
| g13 | REQUIRED | Protección de datos personales: controles técnicos que contribuyan al cumplimiento de la Ley N° 21.719, con privacidad desde el diseño (Privacy by Design) y minimización  | objeto: controles técnicos de protección de datos; norma: Ley N° 21.719; principios: Privacy by Design, minimización de datos | `- **Protección de datos personales**: controles técnicos que contribuyan al cumplimiento de la Ley N° 21.719, con privacidad desde el diseño (Privacy …` |
| g14 | REQUIRED | Título profesional de una carrera de ingeniería en computación, informática, telecomunicaciones, electrónica o afín, de al menos 10 semestres de duración. | nivel: título profesional; carreras alternativas: computación, informática, telecomunicaciones, electrónica o afín; duración mínima de la carrera: al  | `- Título profesional de una carrera de ingeniería en computación, informática, telecomunicaciones, electrónica o afín, de al menos 10 semestres de dur…` |
| g15 | REQUIRED | Al menos 5 años de experiencia en desarrollo de software. | cantidad: al menos 5 años; objeto: desarrollo de software | `- Al menos 5 años de experiencia en desarrollo de software.` |
| g16 | REQUIRED | Diseñar, desarrollar y evolucionar componentes backend, frontend y servicios de ClaveÚnica, resguardando seguridad, disponibilidad, escalabilidad y continuidad operaciona | actividad integrada: diseñar, desarrollar y evolucionar; objetos: componentes backend, frontend, servicios de ClaveÚnica; atributos: seguridad, dispon | `- Diseñar, desarrollar y evolucionar componentes **backend, frontend y servicios de ClaveÚnica**, resguardando seguridad, disponibilidad, escalabilida…` |
| g17 | REQUIRED | Participar en el análisis, diseño, integración, pruebas y mantenimiento correctivo, adaptativo y evolutivo de las soluciones, según los estándares de la Secretaría. | fases: análisis, diseño, integración, pruebas, mantenimiento; tipos de mantenimiento: correctivo, adaptativo, evolutivo; restricción: según los estánd | `- Participar en el análisis, diseño, integración, pruebas y mantenimiento correctivo, adaptativo y evolutivo de las soluciones, según los estándares d…` |
| g18 | REQUIRED | Implementar mecanismos de autenticación, autorización y control de acceso, integrados con las plataformas de identidad digital del Estado. | objetos: autenticación, autorización, control de acceso; integración: plataformas de identidad digital del Estado | `- Implementar mecanismos de **autenticación, autorización y control de acceso**, integrados con las plataformas de identidad digital del Estado.` |
| g19 | REQUIRED | Participar en el despliegue, la estabilización y el soporte de postproducción, resolviendo incidentes que afecten la continuidad de las plataformas. | fases: despliegue, estabilización, soporte de postproducción; alcance: incidentes que afecten la continuidad | `- Participar en el despliegue, la estabilización y el **soporte de postproducción**, resolviendo incidentes que afecten la continuidad de las platafor…` |
| g20 | REQUIRED | Participar en revisiones de código, definición de estándares técnicos y transferencia de conocimiento en el equipo. | actividades: revisiones de código, definición de estándares, transferencia de conocimiento | `- Participar en **revisiones de código**, definición de estándares técnicos y transferencia de conocimiento en el equipo.` |
| g21 | REQUIRED | Preparar demos, prototipos y presentaciones técnicas de las soluciones. | objetos: demos, prototipos, presentaciones técnicas | `- Preparar demos, prototipos y presentaciones técnicas de las soluciones.` |
| g22 | PREFERRED | Opcional (suma pero no excluyente): desarrollo de aplicaciones móviles con Kotlin/Java para Android, Swift para iOS, React Native o Flutter. | modalidad explícita: suman, pero no son excluyentes; objeto: desarrollo de aplicaciones móviles; tecnologías alternativas: Kotlin/Java (Android), Swif | `**Opcionales** ⏎  ⏎ Suman, pero no son excluyentes. ⏎  ⏎ - Desarrollo de **aplicaciones móviles**: Kotlin/Java para Android, Swift para iOS, React Nat…` |
| g23 | PREFERRED | Opcional (suma pero no excluyente): observabilidad y monitoreo con Grafana, Kibana, New Relic y/o Wazuh. | modalidad explícita: suman, pero no son excluyentes; objeto: observabilidad y monitoreo; herramientas alternativas: Grafana, Kibana, New Relic, Wazuh | `**Opcionales** ⏎  ⏎ Suman, pero no son excluyentes. ⏎  ⏎ - Desarrollo de **aplicaciones móviles**: Kotlin/Java para Android, Swift para iOS, React Nat…` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Separado de frontend por §4.1: la fuente usa punto y coma para delimitar dos capas independientes. Dentro de cada capa las tecnologias van unidas por 'o'/'y/o' y NO se separan: convertirlas en claims individuales transformaria alternativas en exigencias acumulativas.
- `g02` — Ver g01.
- `g03` — Capacidad integrada (§5): el smoke de F3.5 mostro que 'diseno e implementacion de APIs REST' se resuelve como UN claim con facets.
- `g04` — La enumeracion tras los dos puntos delimita el alcance del mismo dominio de conocimiento.
- `g05` — Los motores van cerrados por 'o equivalentes' (alternativos); las tres actividades califican al mismo objeto.
- `g06` — Modalidad mixta interna: la plataforma cloud es requerida y AWS solo 'preferentemente'. Perder ese matiz fortaleceria el claim.
- `g08` — La clausula de supervision humana es un qualifier material del claim, no un adorno: elimina la lectura de uso autonomo de IA.
- `g14` — El umbral de duracion ('al menos 10 semestres') es un qualifier material que califica a todas las carreras admitidas; separar por carrera lo duplicaria.
- `g16` — El condicional 'cuando corresponda' atenua la exigencia sobre moviles y es material.
- `g22` — Excerpt contiguo desde el encabezado de modalidad hasta la vineta (§12 P2.0).
- `g23` — Excerpt contiguo desde el encabezado de modalidad.

**No-requisitos explícitos (8):**

- `**Renta.** $4.020.000 bruto mensual. Para acceder a este monto se debe acreditar **10 años de experiencia labo…` → TRAMPA CENTRAL DEL AVISO: los '10 anos de experiencia laboral, o 5 anos mas grado de magister o doctor' NO son un requisito del cargo sino la condicion para acceder al tramo superior de renta bajo el instructivo fiscal. El requisito real de experiencia es 'Al menos 5 anos' (g15). Emitir un Requirement de 10 anos o de magister/doctorado a partir de este pasaje es una alucinacion material.
- `- Calidad jurídica **Honorarios**.…` → Condicion contractual del puesto, no criterio del holder.
- `- 44 horas semanales, lunes a viernes, **presencial** en Teatinos 92, piso 9, Santiago centro.…` → Condiciones de jornada y lugar enunciadas como informacion del puesto en la seccion de beneficios y condiciones, no como exigencia dirigida al postulante. Se registra ademas como pasaje ambiguo.
- `- Permisos administrativos.…` → Beneficio ofrecido.
- `- Sala cuna.…` → Beneficio ofrecido.
- `- Capacitación y desarrollo profesional.…` → Beneficio ofrecido; no es un requisito de formacion.
- `- Oficina a pasos del metro, en pleno centro de Santiago.…` → Beneficio ofrecido.
- `- Colaborar con arquitectos, líderes técnicos y los equipos de **DevSecOps, SRE, QA y UX** en el diseño, la co…` → Describe el entorno de colaboracion (§6, caso 'colaborar con equipos').

**Pasajes ambiguos registrados (2) — no penalizan ni cuentan como omisión:**

- `- 44 horas semanales, lunes a viernes, **presencial** en Teatinos 92, piso 9, Santiago centro.…` → Un anotador razonable podria emitir un Requirement de disponibilidad presencial y de jornada. Aqui se trata como condicion informativa del puesto por su ubicacion en 'Beneficios y condiciones'. No se penaliza si el extractor lo emite.
- `- Velar por la calidad, mantenibilidad, rendimiento y seguridad del código, con **patrones de diseño y princip…` → Reitera el alcance de g04 desde la seccion de funciones; podria sostenerse como claim propio de calidad de codigo.

### EMP_048 — DevOps Engineer — Infra y Ciberseguridad (ZiYU, cloud_devops_security, 3471 car.)

**Nota de anotación:** HOLDOUT. Aviso chileno de DevOps/ciberseguridad escrito en parrafos sin viñetas en la mitad tecnica. Contiene tres marcadores de negacion o atenuacion distintos: 'deseable, no el centro del rol', 'Certificaciones deseables (no excluyentes)' y el condicional 'solo si se busca dar mas peso al cumplimiento'. Ademas dos preferencias internas dentro de claims requeridos ('idealmente PostgreSQL', 'Python es ideal').

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Linux (Ubuntu) avanzado: administración, scripting (Bash), systemd, logs. | nivel: avanzado; objeto: Linux (Ubuntu); alcance: administración, scripting Bash, systemd, logs | `Linux (Ubuntu) avanzado: administración, scripting (Bash), systemd, logs.` |
| g02 | REQUIRED | Cloud: DigitalOcean y/o AWS (VPC, security groups, IAM). | objetos alternativos: DigitalOcean y/o AWS; alcance: VPC, security groups, IAM | `Cloud: DigitalOcean y/o AWS (VPC, security groups, IAM).` |
| g03 | REQUIRED | Infraestructura como código: Terraform (o Pulumi/CloudFormation). | objeto: infraestructura como código; herramientas alternativas: Terraform, Pulumi, CloudFormation | `Infraestructura como código: Terraform (o Pulumi/CloudFormation).` |
| g04 | REQUIRED | Contenedores y orquestación: Docker y Kubernetes. | objeto: Docker; objeto: Kubernetes | `Contenedores y orquestación: Docker y Kubernetes.` |
| g05 | REQUIRED | CI/CD: GitHub Actions, GitLab CI o similar, con seguridad integrada. | objeto: CI/CD; herramientas alternativas: GitHub Actions, GitLab CI o similar; restricción material: con seguridad integrada | `CI/CD: GitHub Actions, GitLab CI o similar, con seguridad integrada.` |
| g06 | REQUIRED | Redes y seguridad de red: firewalls (UFW/iptables), TLS/certificados, segmentación. | objeto: redes y seguridad de red; alcance: firewalls, TLS/certificados, segmentación | `Redes y seguridad de red: firewalls (UFW/iptables), TLS/certificados, segmentación.` |
| g07 | REQUIRED | Gestión de secretos: Vault, AWS Secrets Manager, 1Password u otro. | objeto: gestión de secretos; herramientas alternativas: Vault, AWS Secrets Manager, 1Password u otro | `Gestión de secretos: Vault, AWS Secrets Manager, 1Password u otro.` |
| g08 | REQUIRED | Bases de datos, idealmente PostgreSQL, y su monitoreo. | objeto: bases de datos; preferencia interna (no obligatoria): PostgreSQL; alcance: monitoreo | `Bases de datos, idealmente PostgreSQL, y su monitoreo.` |
| g09 | REQUIRED | Git y buenas prácticas de versionado. | objeto: Git; alcance: buenas prácticas de versionado | `Git y buenas prácticas de versionado.` |
| g10 | REQUIRED | Al menos un lenguaje de scripting/programación, siendo Python el ideal por su uso en automatización. | cantidad: al menos uno; objeto: lenguaje de scripting/programación; preferencia interna (no obligatoria): Python | `Al menos un lenguaje de scripting/programación (Python es ideal por su uso en automatización).` |
| g11 | REQUIRED | Hardening por estándares CIS/NIST. | objeto: hardening; estándares: CIS/NIST | `Hardening por estándares CIS/NIST.` |
| g12 | REQUIRED | DevSecOps: escaneo de código y dependencias, gestión de vulnerabilidades, SLA de remediación. | objeto: DevSecOps; alcance: escaneo de código y dependencias, gestión de vulnerabilidades, SLA de remediación | `DevSecOps: escaneo de código y dependencias, gestión de vulnerabilidades, SLA de remediación.` |
| g13 | REQUIRED | Gestión de identidades y accesos, principio de mínimo privilegio, MFA. | objeto: gestión de identidades y accesos; principios: mínimo privilegio, MFA | `Gestión de identidades y accesos, principio de mínimo privilegio, MFA.` |
| g14 | REQUIRED | Respuesta a incidentes y forense básico. | objeto: respuesta a incidentes; objeto: forense; nivel: básico | `Respuesta a incidentes y forense básico.` |
| g15 | REQUIRED | Nociones de gestión de riesgos y de los marcos ISO 27001 / NIST CSF. | nivel atenuado: nociones; objetos: gestión de riesgos, ISO 27001, NIST CSF | `Nociones de gestión de riesgos y de los marcos ISO 27001 / NIST CSF.` |
| g16 | REQUIRED | Autonomía total: será el área de infraestructura y seguridad, sin equipo debajo. | nivel: autonomía total; contexto material: sin equipo debajo | `Autonomía total: será el área de infraestructura y seguridad, sin equipo debajo.` |
| g17 | REQUIRED | Mentalidad de automatización: resolver una vez y dejarlo automatizado, no apagar incendios manualmente. | actitud: automatización; contraste explícito: no apagar incendios manualmente | `Mentalidad de automatización: resolver una vez y dejarlo automatizado, no apagar incendios manualmente.` |
| g18 | REQUIRED | Buena comunicación y capacidad de documentar con claridad. | soft skill: buena comunicación; soft skill: documentar con claridad; énfasis: la empresa lo valora especialmente | `Buena comunicación y capacidad de documentar con claridad (ZIYU valora especialmente esto).` |
| g19 | REQUIRED | Criterio para equilibrar velocidad de entrega y seguridad. | criterio: equilibrio entre velocidad de entrega y seguridad | `Criterio para equilibrar velocidad de entrega y seguridad.` |
| g20 | REQUIRED | Administrar y automatizar la infraestructura cloud (DigitalOcean, AWS): aprovisionamiento, escalamiento, redes, disponibilidad. | actividad integrada: administrar y automatizar; objeto: infraestructura cloud; alcance: aprovisionamiento, escalamiento, redes, disponibilidad | `Administrar y automatizar la infraestructura cloud (DigitalOcean, AWS): aprovisionamiento, escalamiento, redes, disponibilidad.` |
| g21 | REQUIRED | Operar backups, restauración y continuidad (RTO/RPO). | objetos: backups, restauración, continuidad; métricas: RTO/RPO | `Operar backups, restauración y continuidad (RTO/RPO).` |
| g22 | REQUIRED | Mantener el observability stack: monitoreo, alertas y detección de anomalías (Grafana, Sentry, PGHero o equivalentes). | objeto: observability stack; alcance: monitoreo, alertas, detección de anomalías; herramientas alternativas: Grafana, Sentry, PGHero o equivalentes | `Mantener el observability stack: monitoreo, alertas y detección de anomalías (Grafana, Sentry, PGHero o equivalentes).` |
| g23 | REQUIRED | Liderar la respuesta técnica a incidentes y, cuando corresponda, apoyar la notificación a la ANCI dentro de plazos. | actividad: liderar respuesta a incidentes; condicional: cuando corresponda; obligación regulatoria: notificación a la ANCI dentro de plazos | `Liderar la respuesta técnica a incidentes y, cuando corresponda, apoyar la notificación a la ANCI dentro de plazos.` |
| g24 | REQUIRED | Mantener vigentes y aplicar los procedimientos de ciberseguridad; ser la contraparte técnica en auditorías y cumplimiento (Ley 21.663 y 21.719). | actividad: mantener y aplicar procedimientos de ciberseguridad; rol: contraparte técnica en auditorías; normas: Ley 21.663 y 21.719 | `Mantener vigentes y aplicar los procedimientos de ciberseguridad; ser la contraparte técnica en auditorías y cumplimiento (Ley 21.663 y 21.719).` |
| g25 | PREFERRED | Deseable (no el centro del rol): familiaridad con la Ley 21.663 de ciberseguridad y el rol de la ANCI, y con la Ley 21.719 de datos personales; si no se tiene de entrada, | modalidad explícita: deseable, no el centro del rol; objetos: Ley 21.663 y rol de la ANCI, Ley 21.719; clausula sustitutiva material: si no la tiene,  | `**Cumplimiento (deseable, no el centro del rol)** ⏎  ⏎ Familiaridad con la Ley 21.663 de ciberseguridad y el rol de la ANCI, y con la Ley 21.719 de da…` |
| g26 | PREFERRED | Certificaciones deseables (no excluyentes) técnicas/cloud: AWS Certified DevOps Engineer o Solutions Architect, Certified Kubernetes Administrator (CKA). | modalidad explícita: deseables, no excluyentes; certificaciones alternativas: AWS Certified DevOps Engineer, AWS Solutions Architect, CKA | `Certificaciones deseables (no excluyentes) ⏎  ⏎ Técnicas/cloud: AWS Certified DevOps Engineer o Solutions Architect, Certified Kubernetes Administrato…` |
| g27 | PREFERRED | Certificaciones deseables (no excluyentes) de seguridad práctica: AWS Security Specialty, o alguna de seguridad ofensiva. | modalidad explícita: deseables, no excluyentes; certificaciones alternativas: AWS Security Specialty o de seguridad ofensiva; condicional: si se quier | `Certificaciones deseables (no excluyentes) ⏎  ⏎ Técnicas/cloud: AWS Certified DevOps Engineer o Solutions Architect, Certified Kubernetes Administrato…` |
| g28 | PREFERRED | Certificación deseable (no excluyente) de gobierno: ISO 27001, sólo si se busca dar más peso al cumplimiento. | modalidad explícita: deseables, no excluyentes; certificación: ISO 27001; condicional material: sólo si se busca dar más peso al cumplimiento | `Certificaciones deseables (no excluyentes) ⏎  ⏎ Técnicas/cloud: AWS Certified DevOps Engineer o Solutions Architect, Certified Kubernetes Administrato…` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — El nivel 'avanzado' gobierna toda la enumeracion; separar por componente lo duplicaria.
- `g02` — 'y/o' es una disyuncion inclusiva: separar en dos claims convertiria una alternativa en dos exigencias.
- `g05` — 'con seguridad integrada' es un qualifier material: un CI/CD sin controles de seguridad no satisface el claim.
- `g08` — Modalidad mixta interna: la base de datos es requerida y PostgreSQL solo 'idealmente'. Convertir PostgreSQL en obligatorio fortaleceria el claim.
- `g10` — El cuantificador 'al menos un' y la preferencia interna por Python son ambos materiales.
- `g11` — Separado por §4.1: el parrafo de conocimientos de seguridad enumera dominios independientes delimitados por punto.
- `g12` — Ver g11.
- `g13` — Ver g11.
- `g14` — Ver g11. El nivel 'basico' aplicado al forense es material: perderlo fortaleceria el claim.
- `g15` — Ver g11. 'Nociones' rebaja el nivel exigido y es material.
- `g20` — Capacidad integrada (§5). Solapa con g02 con actividad distinta; §17 prohibe colapsarlos.
- `g25` — El excerpt abarca el encabezado de modalidad de forma contigua. La clausula 'Si no la tiene de entrada, debe poder aprenderla rapido' ATENUA el requisito y debe sobrevivir: tratar la familiaridad como obligatoria seria una inversion de modalidad.
- `g26` — Excerpt contiguo desde el encabezado de modalidad (§12 P2.0).
- `g27` — Excerpt contiguo desde el encabezado de modalidad.
- `g28` — Excerpt contiguo desde el encabezado de modalidad. El condicional 'solo si' es material y no puede eliminarse.

**No-requisitos explícitos (3):**

- `- Giftcard de Navidad 🎄…` → Beneficio ofrecido.
- `- Día libre de cumpleaños…` → Beneficio ofrecido.
- `- Oportunidades de crecimiento profesional y aprendizaje continuo 📚🚀…` → Beneficio ofrecido; no es un requisito de aprendizaje.

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `Si no la tiene de entrada, debe poder aprenderla rápido; el cuerpo de procedimientos ya existente le sirve de …` → Contiene un 'debe poder' que podria leerse como Requirement propio de capacidad de aprendizaje rapido. Aqui se anota como clausula atenuante dentro de g25.

### EMP_025 — Ingeniero/a de Radiofrecuencia (INVAP, electronics, 2390 car.)

**Nota de anotación:** HOLDOUT. Aviso argentino corto (2.390 car.) de INVAP. Su rasgo distintivo es el encabezado 'requisitos valorables', que no es ni 'requeridos' ni 'deseables'; se documenta como ambiguedad de modalidad a nivel de seccion. Contiene ademas una preferencia interna ('preferentemente ADS') y una alternativa de naturaleza de experiencia ('academica o laboral') sin cuantificador de anos.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Ingeniería Electrónica, Telecomunicaciones o carreras afines. | titulaciones alternativas: Ingeniería Electrónica, Telecomunicaciones o afines | `- Ingeniería Electrónica, Telecomunicaciones o carreras afines.` |
| g02 | REQUIRED | Experiencia académica o laboral en actividades relacionadas con el puesto. | naturaleza alternativa: académica o laboral; alcance: actividades relacionadas con el puesto | `- Experiencia académica o laboral en actividades relacionadas con el puesto.` |
| g03 | REQUIRED | Conocimientos de simulación eléctrica/electromagnética, preferentemente ADS. | objeto: simulación eléctrica/electromagnética; preferencia interna (no obligatoria): ADS | `- Conocimientos de simulación eléctrica/electromagnética, preferentemente ADS.` |
| g04 | REQUIRED | Manejo de Altium Designer o herramientas equivalentes de diseño de PCB de RF. | objeto: Altium Designer; alternativa admitida: herramientas equivalentes; dominio: diseño de PCB de RF | `- Manejo de Altium Designer o herramientas equivalentes de diseño de PCB de RF.` |
| g05 | REQUIRED | Manejo de instrumental de laboratorio de RF: VNA, generadores de señal y analizadores de espectro. | objeto: instrumental de laboratorio de RF; alcance: VNA, generadores de señal, analizadores de espectro | `- Manejo de instrumental de laboratorio de RF: VNA, generadores de señal y analizadores de espectro.` |
| g06 | REQUIRED | Destrezas de planificación de tareas y recursos. | capacidad: planificación; objetos: tareas y recursos | `- Destrezas de planificación de tareas y recursos.` |
| g07 | REQUIRED | Flexibilidad y trabajo en equipo. | soft skill: flexibilidad; soft skill: trabajo en equipo | `- Flexibilidad y trabajo en equipo.` |
| g08 | REQUIRED | Relaciones interpersonales y capacidades de comunicación. | soft skill: relaciones interpersonales; soft skill: comunicación | `- Relaciones interpersonales y capacidades de comunicación.` |
| g09 | REQUIRED | Visión sistémica, pensamiento crítico y capacidad analítica. | capacidades: visión sistémica, pensamiento crítico, capacidad analítica | `- Visión sistémica, pensamiento crítico y capacidad analítica.` |
| g10 | REQUIRED | Inglés B1/B2. | idioma: inglés; nivel: B1/B2 | `- Inglés B1/B2.` |
| g11 | REQUIRED | Diseño y desarrollo de hardware de RF: transceivers, módulos de transmisión/recepción de sistemas radar, amplificadores de potencia, receptores, entre otros. | actividad integrada: diseño y desarrollo; objeto: hardware de RF; alcance ejemplificado: transceivers, módulos T/R de radar, amplificadores de potenci | `- Diseño y desarrollo de hardware de RF: transceivers, módulos de transmisión/recepción de sistemas radar, amplificadores de potencia, receptores, ent…` |
| g12 | REQUIRED | Elaboración de esquemáticos, diagramas funcionales, selección de componentes y definición de ruteo de PCB. | objetos: esquemáticos, diagramas funcionales, selección de componentes, ruteo de PCB | `- Elaboración de esquemáticos, diagramas funcionales, selección de componentes y definición de ruteo de PCB.` |
| g13 | REQUIRED | Simulación eléctrica y electromagnética. | actividad: simulación eléctrica y electromagnética | `- Simulación eléctrica y electromagnética.` |
| g14 | REQUIRED | Elaboración de documentación técnica de diseño, fabricación y ensayo. | objeto: documentación técnica; alcance: diseño, fabricación y ensayo | `- Elaboración de documentación técnica de diseño, fabricación y ensayo.` |
| g15 | REQUIRED | Verificación y puesta a punto en laboratorio. | actividad integrada: verificación y puesta a punto; entorno: laboratorio | `- Verificación y puesta a punto en laboratorio.` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Disyuncion de titulaciones admitidas; separar convertiria alternativas en exigencias acumulativas.
- `g02` — La alternativa 'academica o laboral' es material: admite trayectoria formativa sin experiencia profesional. Eliminarla fortaleceria el claim. No hay cuantificador de anos.
- `g03` — Modalidad mixta interna: el conocimiento de simulacion es exigido y la herramienta ADS solo 'preferentemente'. Convertir ADS en obligatorio fortaleceria el claim.
- `g04` — 'o herramientas equivalentes' amplia el objeto y es material.
- `g05` — La enumeracion delimita el alcance del mismo instrumental.
- `g10` — El nivel certificable es qualifier material.
- `g11` — Capacidad integrada (§5). 'entre otros' marca que la enumeracion es abierta y ejemplificada.
- `g13` — Solapa con g03 (conocimientos) con actividad distinta; §17 prohibe colapsarlos.

**No-requisitos explícitos (9):**

- `**¡En INVAP seguimos creciendo y te proponemos que nos acompañes!**…` → Encabezado de convocatoria.
- `Nos encontramos en la búsqueda de un/a **Ingeniero/a de Radiofrecuencia** para sumarse a nuestro equipo de Ele…` → Enunciado del puesto y del equipo; el titulo es contexto y no crea Requirements (§8).
- `- Trabajar en una empresa referente en proyectos tecnológicos a nivel mundial y protagonista del desarrollo en…` → Oportunidad ofrecida por la empresa, no criterio del holder.
- `- Una carrera profesional de primer nivel, donde vas a poder materializar tus conocimientos.…` → Oportunidad ofrecida. Contiene 'carrera' y 'conocimientos' pero no enuncia ningun requisito de formacion; es una trampa lexica.
- `- Contratación directa.…` → Condicion contractual ofrecida.
- `- Medicina prepaga para el grupo familiar primario.…` → Beneficio ofrecido.
- `Formá parte del desarrollo tecnológico que mejora el día a día de las personas.…` → Cierre motivacional.
- `¡Conocenos! www.paraquehacemosloquehacemos.com.ar…` → Enlace institucional.
- `## Job function ⏎  ⏎ Engineering…` → Metadata de la plataforma LinkedIn.

**Pasajes ambiguos registrados (2) — no penalizan ni cuentan como omisión:**

- `**¿Cuáles son los requisitos valorables para desarrollar este rol?**…` → Encabezado que califica TODA la lista como 'requisitos valorables', una formula intermedia entre requerido y deseable. Se anotan los claims con modality REQUIRED porque es la unica seccion de requisitos del aviso y no hay una lista requerida alternativa, pero un anotador razonable podria anotarlos todos como PREFERRED. Esta decision NO se toma en la direccion que facilite el scoring: se documenta y se tolera la lectura alternativa en la adjudicacion de modalidad.
- `**Lugar de trabajo: Bariloche, modalidad presencial.**…` → Condicion de lugar y modalidad enunciada como dato del puesto. No se emite Requirement; tampoco se penaliza si el extractor emite uno de disponibilidad presencial en Bariloche.

### EMP_066 — Analista de Desarrollo Analítico - Turno mañana (Laboratorio Elea, biotechnology, 3385 car.)

**Nota de anotación:** HOLDOUT. Aviso farmaceutico argentino con el caso de negacion mas exigente del corpus: una sola linea que contrasta '(excluyente)' y '(no excluyente)' sobre dos grupos de software distintos. Ademas el ingles avanzado se marca '(deseable)' pese al nivel alto, y la formacion admite 'Estudiante o graduado'. Tres modalidades explicitas distintas conviven en la seccion de requisitos.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Estudiante o graduado/a de Farmacia, Bioquímica, Lic. en Química, o carreras afines. | estado alternativo: estudiante o graduado; titulaciones alternativas: Farmacia, Bioquímica, Lic. en Química o afines | `- Estudiante o graduado/a de Farmacia, Bioquímica, Lic en Química, o carreras afines.` |
| g02 | REQUIRED | Conocimientos normativos (GMP, GLP, GXP, normativas nacionales e internacionales de industria farmacéutica). | objeto: conocimientos normativos; alcance: GMP, GLP, GXP, normativas nacionales e internacionales | `- Conocimientos normativos (GMP, GLP, GXP, normativas nacionales e internacionales de industria farmacéutica).` |
| g03 | REQUIRED | Conocimientos sobre procesos, equipos e instrumental de laboratorios en la industria farmacéutica. | objetos: procesos, equipos, instrumental de laboratorio; sector: industria farmacéutica | `- Conocimientos sobre procesos, equipos e instrumental de laboratorios en la industria farmacéutica.` |
| g04 | REQUIRED | Experiencia mínima de 2 años en Desarrollo Analítico dentro de la industria farmacéutica. | cantidad: mínima de 2 años; área: Desarrollo Analítico; sector: industria farmacéutica | `- Experiencia mínima de 2 años en Desarrollo Analítico dentro de la industria farmacéutica.` |
| g05 | REQUIRED | Manejo de software Word y Excel (excluyente). | modalidad explícita: excluyente; objetos: Word y Excel | `- Manejo de software Word y Excel (excluyente); Lab Solutions, Empower; (no excluyente).` |
| g06 | PREFERRED | Manejo de software Lab Solutions y Empower (no excluyente). | modalidad explícita: no excluyente; objetos: Lab Solutions, Empower | `- Manejo de software Word y Excel (excluyente); Lab Solutions, Empower; (no excluyente).` |
| g07 | PREFERRED | Inglés avanzado, oral y escrito (deseable). | modalidad explícita: deseable; idioma: inglés; nivel: avanzado; habilidades: oral y escrito | `- Idiomas inglés avanzado, oral y escrito (deseable).` |
| g08 | PREFERRED | Valorado: orientación al logro y resolución de problemas. | modalidad: valoramos; actitud: orientación al logro; capacidad: resolución de problemas | `💡**¿Qué valoramos?** ⏎  ⏎ - Orientación al logro, resolución de problemas.` |
| g09 | PREFERRED | Valorado: capacidad de planificación y análisis para gestionar múltiples tareas. | modalidad: valoramos; capacidad: planificación y análisis; alcance: múltiples tareas | `💡**¿Qué valoramos?** ⏎  ⏎ - Orientación al logro, resolución de problemas. ⏎ - Capacidad de planificación y análisis para gestionar múltiples tareas.` |
| g10 | PREFERRED | Valorado: capacidad de trabajo en equipo. | modalidad: valoramos; soft skill: trabajo en equipo | `💡**¿Qué valoramos?** ⏎  ⏎ - Orientación al logro, resolución de problemas. ⏎ - Capacidad de planificación y análisis para gestionar múltiples tareas. …` |
| g11 | PREFERRED | Valorado: proactividad y buena comunicación. | modalidad: valoramos; actitud: proactividad; soft skill: buena comunicación | `💡**¿Qué valoramos?** ⏎  ⏎ - Orientación al logro, resolución de problemas. ⏎ - Capacidad de planificación y análisis para gestionar múltiples tareas. …` |
| g12 | REQUIRED | Desarrollar nuevas técnicas analíticas y adecuar técnicas vigentes de materia prima y producto terminado. | actividad integrada: desarrollar nuevas y adecuar vigentes; objeto: técnicas analíticas; alcance: materia prima y producto terminado | `- Desarrollar nuevas técnicas analíticas y adecuar técnicas vigentes de materia prima y producto terminado.` |
| g13 | REQUIRED | Analizar fisicoquímicamente (FQ) productos en desarrollo. | actividad: análisis fisicoquímico; objeto: productos en desarrollo | `- Analizar (FQ) productos en desarrollo.` |
| g14 | REQUIRED | Hacer seguimiento de los proyectos a cargo. | actividad: seguimiento; objeto: proyectos a cargo | `- Hacer seguimiento de los proyectos a cargo.` |
| g15 | REQUIRED | Generar y ejecutar protocolos de validación de técnicas analíticas y redactar los informes de validación correspondientes. | actividad integrada: generar y ejecutar protocolos; objeto: validación de técnicas analíticas; producto adicional: informes de validación | `- Generar y ejecutar protocolos de validación de técnicas analíticas. Redactar los correspondientes informes de validación.` |
| g16 | REQUIRED | Generar técnicas analíticas de nuevos excipientes e IFA's, subirlas al sistema documental electrónico y realizar el seguimiento hasta su publicación. | actividad integrada: generar, cargar y seguir hasta publicación; objetos: técnicas analíticas de nuevos excipientes e IFA; sistema: documental electró | `- Generar técnicas analíticas de nuevos excipientes e IFA´s, subirlas al sistema documental electrónico y realizar el seguimiento hasta su publicación…` |
| g17 | REQUIRED | Ejecutar transferencias de técnicas analíticas de producto terminado con Control de Calidad. | actividad: ejecutar transferencias; objeto: técnicas analíticas de producto terminado; contraparte: Control de Calidad | `- Ejecutar transferencias de técnicas analíticas de producto terminado con Control de Calidad.` |
| g18 | REQUIRED | Realizar las actividades relacionadas con los equipos a cargo. | objeto: equipos a cargo | `- Realizar las actividades relacionadas con los equipos a cargo.` |
| g19 | REQUIRED | Realizar búsqueda bibliográfica USP-NF; BPh; EPh, ICH, FDA. | actividad: búsqueda bibliográfica; fuentes: USP-NF, BPh, EPh, ICH, FDA | `- Realizar búsqueda bibliográfica USP-NF; BPh; EPh, ICH, FDA.` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — La alternativa 'Estudiante o graduado' es material: admite formacion en curso. Eliminarla fortaleceria el claim a titulacion completa.
- `g02` — La enumeracion entre parentesis delimita el alcance del mismo conocimiento normativo.
- `g04` — Compuesto preservado: el area y el sector acotan una unica exigencia temporal.
- `g05` — CASO CENTRAL DE NEGACION DEL HOLDOUT: la misma linea contrasta '(excluyente)' para Word/Excel y '(no excluyente)' para Lab Solutions/Empower. Se emiten dos claims con modalidades opuestas y el mismo excerpt primario; colapsarlos o uniformar la modalidad seria una inversion de negacion.
- `g06` — Ver g05.
- `g07` — Tratar este claim como requisito seria una inversion de modalidad: el aviso lo marca deseable pese al nivel alto exigido.
- `g08` — Excerpt contiguo desde el encabezado de modalidad (§12 P2.0).
- `g09` — Excerpt contiguo desde el encabezado de modalidad.
- `g10` — Excerpt contiguo desde el encabezado de modalidad.
- `g11` — Excerpt contiguo desde el encabezado de modalidad.
- `g12` — Capacidad integrada (§5): desarrollar-y-adecuar sobre el mismo objeto.
- `g15` — La fuente enuncia las dos oraciones dentro de la misma vineta y encadenadas por el mismo objeto (la validacion); se preservan como un unico criterio.
- `g16` — Capacidad integrada de extremo a extremo (§5): separar por paso destruiria el alcance 'hasta su publicacion'.

**No-requisitos explícitos (7):**

- `Es una gran oportunidad para profesionales que quieran desarrollarse en uno de los laboratorios más importante…` → Prosa de oferta. Menciona 'profesionales de alta calidad' refiriendose al equipo de la empresa, no al holder.
- `- Obra social Luis Pasteur…` → Beneficio ofrecido.
- `- Convenios académicos con Universidades de primer nivel para formarte…` → Beneficio ofrecido. Trampa lexica: menciona universidades y formacion pero no exige ninguna credencial.
- `- 📆3 semanas de vacaciones…` → Beneficio ofrecido.
- `Somos un Laboratorio Argentino, que desde 1939 investiga y desarrolla medicamentos confiables para diversas es…` → Prosa institucional. 'desde 1939' es antiguedad de la empresa, no experiencia exigida.
- `Respaldados por unidades de negocios con marcas líderes, proyectos propios de Investigación y Desarrollo, lice…` → Prosa institucional (§7).
- `## Job function ⏎  ⏎ Business Development and Sales…` → Metadata de la plataforma LinkedIn, ademas incorrecta respecto del puesto real.

### EMP_069 — INGENIERO PROCESOS y CONTROL (YPF, other_engineering, 7015 car.)

**Nota de anotación:** HOLDOUT. Objective mas largo de la seleccion (7.015 car.). Rasgo dominante: TODA la seccion de credenciales esta gobernada por '¿Que Valoramos?', de modo que formacion, experiencia y herramientas son PREFERRED y no REQUIRED; ademas una vineta rotulada 'Otros requisitos' termina en '(no excluyente)'. El aviso no contiene ningun cuantificador de anos de experiencia, pero si menciona 'mas de cien anos de historia' de la empresa. Doce tareas numeradas muy extensas con finalidad encadenada ('con el fin de...').

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | PREFERRED | Valorado: formación académica de Ingeniero Químico o Electrónico. | modalidad: ¿Qué Valoramos?; titulaciones alternativas: Ingeniero Químico o Electrónico | `**¿Qué Valoramos?** ⏎  ⏎ - **Formación académica:** Ingeniero Químico o Electrónico.` |
| g02 | PREFERRED | Valorado: experiencia previa en proyectos, Ingeniería de control e Instrumentación, dimensionamientos y cálculos de equipos de procesos. | modalidad: ¿Qué Valoramos?; naturaleza: experiencia previa; objetos: proyectos, Ingeniería de control e Instrumentación, dimensionamientos y cálculos  | `**¿Qué Valoramos?** ⏎  ⏎ - **Formación académica:** Ingeniero Químico o Electrónico. ⏎ - **Experiencia profesional:** Experiencia previa en proyectos,…` |
| g03 | PREFERRED | Valorado: manejo del software Hysys. | modalidad: ¿Qué Valoramos?; herramienta: Hysys | `**¿Qué Valoramos?** ⏎  ⏎ - **Formación académica:** Ingeniero Químico o Electrónico. ⏎ - **Experiencia profesional:** Experiencia previa en proyectos,…` |
| g04 | PREFERRED | Valorado: manejo del software Autocad. | modalidad: ¿Qué Valoramos?; herramienta: Autocad | `**¿Qué Valoramos?** ⏎  ⏎ - **Formación académica:** Ingeniero Químico o Electrónico. ⏎ - **Experiencia profesional:** Experiencia previa en proyectos,…` |
| g05 | PREFERRED | Experiencia en manejo de químicos y ensayos de laboratorios (no excluyente). | modalidad explícita: no excluyente; objetos: manejo de químicos, ensayos de laboratorios | `- **Otros requisitos:** experiencia en manejo de químicos y ensayos de laboratorios (no excluyente).` |
| g06 | REQUIRED | Profesional de Ingeniería proactivo, autónomo y con sólidas habilidades de liderazgo de proyectos, trabajo en equipo y adaptación al cambio. | perfil: profesional de Ingeniería; actitudes: proactivo, autónomo; nivel: sólidas habilidades; objetos: liderazgo de proyectos, trabajo en equipo, ada | `Un profesional de Ingeniería proactivo, autónomo y con sólidas habilidades de liderazgo de proyectos, trabajo en equipo y adaptación al cambio, orient…` |
| g07 | REQUIRED | Disponibilidad para viajar eventualmente. | disponibilidad: viajar; frecuencia atenuada: eventualmente | `**Disponibilidad para viajar:** si, eventualmente` |
| g08 | REQUIRED | Controlar las variables operativas y equipos de procesos de todas las instalaciones de procesamiento y transporte de fluidos de la Región asignada, asegurando la operació | actividad: controlar variables operativas y equipos; alcance: instalaciones de procesamiento y transporte de fluidos; ámbito: Región asignada; objetiv | `1.Controlar las variables operativas y equipos de procesos de todas las instalaciones de procesamiento y transporte de fluidos de la Región asignada c…` |
| g09 | REQUIRED | Dimensionar, revisar y validar las lógicas de control de procesos, enclavamientos e interlocks de seguridad (SIS/ESD), alarmas críticas e instrumentación de campo, garant | actividad integrada: dimensionar, revisar y validar; objetos: lógicas de control, enclavamientos e interlocks SIS/ESD, alarmas críticas, instrumentaci | `2.Dimensionar, revisar y validar las lógicas de control de procesos, los enclavamientos e interlocks de seguridad (SIS/ESD), alarmas críticas e instru…` |
| g10 | REQUIRED | Integrar análisis operativos, simulaciones de proceso, estudios de capacidad, eficiencia energética, gestión de riesgos, calidad de fluidos y sistemas de control e instru | actividad: integrar disciplinas; alcance: análisis operativos, simulaciones, capacidad, eficiencia energética, riesgos, calidad de fluidos, control e  | `3.Integrar los análisis operativos, simulaciones de proceso, estudios de capacidad, eficiencia energética, gestión de riesgos, calidad de fluidos, sis…` |
| g11 | REQUIRED | Controlar los indicadores de calidad (KPIs) de procesos para identificar desvíos, alertar condiciones inseguras y/o incumplimientos de calidad e impulsar acciones correct | actividad: controlar KPIs de procesos; finalidades: identificar desvíos, alertar, impulsar acciones correctivas | `4.Controlar los indicadores de calidad (KPIs) de procesos, con el fin de identificar desvíos, alertar condiciones inseguras y/o incumplimientos de cal…` |
| g12 | REQUIRED | Controlar los parámetros fisicoquímicos de los fluidos, verificando condiciones de entrega y variabilidad en los ingresos. | actividad: controlar parámetros fisicoquímicos; objeto: fluidos; alcance: condiciones de entrega y variabilidad en los ingresos | `5.Controlar los parámetros fisicoquímicos de los fluidos, verificando condiciones de entrega y variabilidad en los ingresos, a fin de monitorear desví…` |
| g13 | REQUIRED | Desarrollar y actualizar la simulación de todas las facilidades de procesamiento y transporte utilizando Simuladores de Proceso. | actividad integrada: desarrollar y actualizar; objeto: simulación de facilidades; herramienta: Simuladores de Proceso | `6.Desarrollar y actualizar la simulación de todas las facilidades de procesamiento y transporte, utilizando Simuladores de Proceso, con el fin de cont…` |
| g14 | REQUIRED | Identificar cuellos de botella en las instalaciones, manteniendo información actualizada de las capacidades instaladas e impulsando modificaciones cuando resulten inconsi | actividad: identificar cuellos de botella; alcance: capacidades instaladas; condicional: cuando resulten inconsistentes con el plan de producción | `7.Identificar cuellos de botella en las instalaciones, con el fin de mantener información actualizada de las capacidades instaladas, e impulsar modifi…` |
| g15 | REQUIRED | Resguardar la documentación clave de las instalaciones, procurando su respaldo y actualización para asegurar el cumplimiento de los requisitos normativos de la compañía. | actividad: resguardar documentación; alcance: respaldo y actualización; finalidad: cumplimiento normativo de la compañía | `8.Resguardar la documentación clave de las instalaciones, procurando su respaldo y actualización, con el fin de asegurar el cumplimiento de los requis…` |
| g16 | REQUIRED | Medir la eficiencia energética de los procesos y gestionar el Uso de la Energía Upstream, conociendo usos, disposiciones y costos asociados y buscando optimizaciones. | actividad integrada: medir y gestionar; objeto: eficiencia energética y Uso de la Energía Upstream; alcance: usos, disposiciones y costos asociados | `9.Medir la eficiencia energética de los procesos y gestionar el Uso de la Energía Upstream, a fin de lograr un conocimiento certero de todos los usos …` |
| g17 | REQUIRED | Liderar y controlar los estudios de riesgos de instalaciones existentes y las acciones definidas en dichos estudios. | actividad integrada: liderar y controlar; objeto: estudios de riesgos de instalaciones existentes; alcance: acciones definidas en los estudios | `10.Liderar y controlar los estudios de riesgos de instalaciones existentes y las acciones definidas en dichos estudios, con el fin de mantener la oper…` |
| g18 | REQUIRED | Asesorar en aspectos relativos a la especialidad, participando en investigaciones de incidentes y búsqueda de fallas. | actividad: asesorar; alcance: investigaciones de incidentes y búsqueda de fallas; condicional: donde se requiera | `11.Asesorar en aspectos relativos a la especialidad, participando en las investigaciones de incidentes y búsqueda de fallas donde se requiera, con el …` |
| g19 | REQUIRED | Asesorar en las paradas de planta programadas, colaborando en planes de consignación, programación de actividades e inspección de tareas. | actividad: asesorar; objeto: paradas de planta programadas; alcance: planes de consignación, programación de actividades, inspección de tareas | `12.Asesorar en las paradas de planta programadas, colaborando en los planes de consignación, programación de actividades e inspección de tareas, con e…` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Excerpt contiguo desde el encabezado de modalidad (§12 P2.0). La seccion completa de credenciales del aviso esta gobernada por '¿Que Valoramos?', no por un encabezado de requisitos: tratarla como requerida seria fortalecer la modalidad.
- `g02` — Excerpt contiguo desde el encabezado de modalidad. No hay cuantificador de anos en todo el aviso.
- `g03` — Separado de Autocad por §4.1: 'manejo del software' distribuye sobre dos herramientas independientes.
- `g04` — Ver g03.
- `g05` — Marca de negacion explicita dentro de una vineta rotulada 'Otros requisitos': el rotulo dice requisito pero el parentesis lo desmiente. Tratarlo como exigencia seria una inversion de negacion.
- `g06` — Unico bloque del aviso enunciado bajo '¿Que buscamos?' sin marca de preferencia. Compuesto preservado: 'solidas habilidades de' gobierna las tres capacidades y distribuirlo duplicaria el nivel exigido.
- `g07` — 'eventualmente' limita la exigencia y es material; perderlo la fortaleceria a disponibilidad permanente.
- `g09` — Capacidad integrada (§5): las tres actividades gobiernan la misma lista de objetos de seguridad funcional.
- `g10` — El criterio es justamente la INTEGRACION de las disciplinas: separarlo por disciplina destruiria el claim (§4.2 'la composicion misma es el criterio').
- `g13` — Solapa con g03 (Hysys, valorado) con fuerza distinta: aqui la simulacion es tarea del rol y alli la herramienta concreta es valorada. §17 prohibe colapsarlos.

**No-requisitos explícitos (12):**

- `Sumá tu energía a la compañía que contribuye al desarrollo de nuestro país.…` → Encabezado motivacional.
- `Con más de cien años de historia, somos la compañía energética líder de la Argentina, impulsando el desarrollo…` → Prosa institucional. 'mas de cien anos' es antiguedad de la empresa, NO experiencia exigida; es la trampa de contexto-vs-requisito principal del aviso.
- `¡Sumarte a YPF es unirte a un proyecto que combina experiencia, pasión y la energía necesaria para seguir cons…` → Prosa motivacional. Usa la palabra 'experiencia' referida al proyecto, no al holder.
- `Serás responsable de controlar el desempeño de las instalaciones de superficie y su operación, con el objetivo…` → Resumen del desafio del rol que las doce tareas numeradas concretan; se registra ademas como pasaje ambiguo.
- `**Reporte directo:** JEFE INGENIERIA PROCESOS Y CONTROL…` → Linea de reporte organizacional.
- `**Lugar de trabajo:** BASE YPF LOMA CAMPANA…` → Ubicacion del puesto, no exigencia dirigida al postulante.
- `**Encuadre gremial:** Fuera de convenio…` → Condicion contractual del puesto.
- `- Trabaja con excelencia y profesionalismo.…` → Bloque 'Si sos una persona que:' con perfil aspiracional de cultura; se registra como pasaje ambiguo por su lectura alternativa.
- `- Promueve un buen clima de trabajo, con empatía, escucha activa y respeto.…` → Idem: perfil cultural aspiracional.
- `- Descuentos especiales en universidades orientados a impulsar estudios de especialización y posgrado.…` → Beneficio ofrecido. Trampa lexica: menciona posgrado y especializacion pero NO exige ninguna credencial.
- `- Cobertura médica para vos y tu familia.…` → Beneficio ofrecido.
- `## Seniority level ⏎  ⏎ Associate…` → Metadata de la plataforma LinkedIn.

**Pasajes ambiguos registrados (2) — no penalizan ni cuentan como omisión:**

- `Si sos una persona que:…` → Encabeza seis viñetas de perfil cultural ('Trabaja con excelencia', 'valora la meritocracia', 'Disfruta del trabajo en equipo', etc.). Un anotador razonable podria emitirlas como Requirements de soft skills; aqui se tratan como perfil aspiracional de marca empleadora porque estan fuera de la seccion de criterios y redactadas como autodescripcion del lector. No se penalizan si el extractor las emite, ni se cuentan como omision si no las emite.
- `Serás responsable de controlar el desempeño de las instalaciones de superficie y su operación, con el objetivo…` → Resumen del rol que anticipa g08; podria sostenerse como claim propio de responsabilidad general.


---

## Partición: crossDomain

### SCH_005 — Beca de Doctorado Nacional, Año Académico 2026 (ANID — Agencia Nacional de Investigación y Desarrollo, Chile, scholarship, 8992 car.)

**Nota de anotación:** CROSS-DOMAIN (beca). Objective de organismo publico chileno. Prueba clave del contrato fuera de empleo: el criterio de excelencia academica es una DISYUNCION explicita con umbrales cuantitativos (5,0/7,0 o 30% superior del ranking), y el texto agrega una nota que impide inferir que cumplir una condicion exime de documentacion. Contiene ademas dos clausulas que amplian elegibilidad en vez de restringirla.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Poseer el grado académico de Licenciado(a) o Título Profesional o su equivalente (en el caso de estudios de pregrado realizados en el extranjero), otorgado por institucio | credenciales alternativas: Licenciado, Título Profesional o equivalente extranjero; emisor admitido: instituciones de educación superior chilenas o ex | `- Poseer el grado académico de Licenciado(a) o Título Profesional o su equivalente en el caso de los estudios de pregrado realizados en el extranjero,…` |
| g02 | REQUIRED | Encontrarse en proceso de postulación formal, admitido/a o con calidad de alumno/a regular en un programa de Doctorado acreditado conforme a la Ley N° 20.129 e impartido  | estados alternativos: en postulación formal, admitido o alumno regular; objeto: programa de Doctorado acreditado (Ley N° 20.129); emisor: universidad  | `- Encontrarse en proceso de postulación formal, admitido(a) o tener la calidad de alumno o alumna regular en un programa de Doctorado acreditado en co…` |
| g03 | REQUIRED | Acreditar excelencia académica cumpliendo al menos uno de dos requisitos: promedio de pregrado igual o superior a 5,0 sobre 7,0, o ubicarse en el 30% superior del ranking | cuantificador: al menos uno de los siguientes; objeto: excelencia académica; alternativa 1: promedio >= 5,0 sobre 7,0; alternativa 2: 30% superior del | `- Acreditar excelencia académica a través de, al menos, uno de los siguientes requisitos:` |
| g04 | REQUIRED | Presentar obligatoriamente los documentos señalados en los numerales 8.9.5 y 8.9.6, aun cuando se cumpla sólo una de las dos condiciones de excelencia académica. | modalidad explícita: deberán presentar obligatoriamente; objeto: documentos de los numerales 8.9.5 y 8.9.6; aclaración material: la suficiencia de una | `- Si bien es suficiente que los y las postulantes cumplan con una de las dos condiciones señaladas precedentemente, **deberán presentar obligatoriamen…` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — Disyuncion de credenciales admitidas; separar convertiria alternativas en exigencias acumulativas.
- `g02` — Los tres estados son alternativos y el momento de verificacion es un qualifier temporal material.
- `g03` — CASO CENTRAL DE GRANULARIDAD CROSS-DOMAIN: el criterio es una disyuncion explicita ('al menos uno de los siguientes'). Emitir las dos alternativas como Requirements independientes convertiria una condicion satisfacible por una via en dos exigencias acumulativas, que es exactamente la sobre-particion que §4.1 prohibe. Se conserva UN claim con las dos alternativas como qualifiers.
- `g04` — Claim documental independiente que ADEMAS corrige una inferencia erronea posible sobre g03; perder la clausula 'si bien es suficiente... deberan presentar obligatoriamente' invertiria la carga documental.

**No-requisitos explícitos (8):**

- `Esta beca tiene por objetivo apoyar financieramente los estudios de doctorado en todas las áreas del conocimie…` → Objetivo y alcance del beneficio ofrecido. El 'plazo maximo de cuatro anos' es la duracion de la beca, NO un requisito del postulante; convertirlo en exigencia seria una alucinacion material.
- `Además, en caso de que corresponda, una extensión de los beneficios de mantenimiento, por un máximo de seis me…` → Beneficio ofrecido, no criterio.
- `Al concurso podrán postular personas chilenas o extranjeras, con o sin permanencia definitiva en Chile.…` → Clausula de NO restriccion por nacionalidad ni residencia: amplia la elegibilidad en vez de exigir algo. Emitir un Requirement de nacionalidad o residencia a partir de este pasaje seria una inversion de negacion.
- `Con el objetivo de evaluar tus posibilidades de obtener esta beca, a modo de referencia, puedes consultar el P…` → Herramienta informativa de referencia. Menciona nota y ranking, que si son criterios reales, pero aqui como dato historico consultable, no como exigencia.
- `Este aporte **no requiere una nueva postulación**, dado que la OEA efectúa la selección en forma directa, cons…` → Beneficio adicional de un tercero (OEA) con criterios propios de priorizacion que NO son requisitos de esta beca. Contiene ademas una negacion explicita ('no requiere una nueva postulacion').
- `Para la presente convocatoria, se entregarán **65 nuevos aportes.**…` → Cupo del beneficio OEA, no criterio.
- `**Publicación de bases e inicio del periodo de postulación:** jueves 25 de septiembre de 2025.…` → Fecha del calendario del concurso, no criterio del postulante.
- `Concurso Adjudicado…` → Estado administrativo de la convocatoria.

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `Revisa los programas acreditados en el sitio web de la Comisión Nacional de Acreditación CNA.…` → Instruccion operativa que remite a la lista de programas acreditados; la exigencia de acreditacion ya esta capturada en g02.

### ADM_005 — Maestría en Construcción y Diseño Estructural — Requisitos para el ingreso (Facultad de Ingeniería, Universidad de Buenos Aires (FIUBA), admission, 1948 car.)

**Nota de anotación:** CROSS-DOMAIN (admision). Texto integramente de criterio, sin prosa institucional. Es el caso mas puro de disyuncion del corpus: 'al menos una (1) de las siguientes condiciones' con cuatro vias, una de ellas con obligacion adicional propia, mas una negacion de exclusividad de perfil y una via de excepcion. Objective mas corto de la seleccion (1.948 car.).

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Cumplir con al menos una de cuatro condiciones de titulación de origen para solicitar la admisión: graduado de FIUBA con carrera de 4 años mínimo; graduado de carrera afí | modalidad explícita: requisito obligatorio; cuantificador: al menos una (1) de las siguientes condiciones; alternativa 1: graduado FIUBA, carrera de 4 | `Es requisito obligatorio para solicitar la admisión cumplir con al menos una (1) de las siguientes condiciones, de acuerdo a la Res. (CS) Nro. 5284/20…` |
| g02 | REQUIRED | La cuarta vía de admisión (egresado de nivel superior no universitario) exige además completar los prerrequisitos que determine la Comisión de Maestría, para asegurar for | condición adicional: completar prerrequisitos determinados por la Comisión de Maestría; alcance: aplica sólo a la vía de nivel superior no universitar | `. Ser egresado/a con estudios de nivel superior no universitario de cuatro (4) años de duración como mínimo, con formación en un área de la ingeniería…` |
| g03 | PREFERRED | La orientación a ingenieros/as civiles o en construcciones no es excluyente de otras profesiones: en el proceso de admisión se corrobora si el postulante tiene formación  | modalidad explícita: no es excluyente de otras profesiones; perfil preferido: profesionales de la construcción, en particular ingenieros civiles o en  | `La Maestría en Construcción y Diseño Estructural está dirigida a profesionales de la construcción, en particular, a ingenieros/as civiles o en constru…` |
| g04 [AMBIGUO] | UNSPECIFIED | Excepcionalmente pueden ser admitidas personas con antecedentes relevantes en investigación o profesionales aun cuando no cumplan los requisitos reglamentarios, con recom | vía excepcional: antecedentes relevantes en investigación o profesionales; condición negada: aun cuando no cumplan los requisitos reglamentarios; auto | `Aquellas personas que cuenten con antecedentes relevantes en investigación o profesionales, aun cuando no cumplan con los requisitos reglamentarios ci…` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — CASO CENTRAL DE GRANULARIDAD: la fuente enuncia explicitamente 'al menos una (1) de las siguientes condiciones'. Emitir las cuatro vias como Requirements independientes convertiria una disyuncion en cuatro exigencias acumulativas y haria inadmisible a casi cualquier postulante. Se conserva UN claim con las cuatro vias como qualifiers alternativos.
- `g02` — Se emite como claim propio porque impone una obligacion ADICIONAL que no comparten las otras tres vias: fundirlo en g01 haria perder una exigencia asimetrica.
- `g03` — Claim de modalidad negada: el perfil se enuncia como orientacion preferente y se niega explicitamente su caracter excluyente. Emitirlo como requisito de ser ingeniero civil seria una inversion de negacion.
- `g04` — Se emite como claim propio porque introduce condiciones adicionales (recomendacion y aprobacion) que no aparecen en ningun otro pasaje.
- `g04` **[AMBIGUO]** — HALLAZGO DE CONTRATO: no es un requisito, ni una preferencia, ni una no-exigencia. Es una clausula de DISPENSA que relaja g01 bajo autorizacion de dos organos. El contrato V1 (§12 P2.0) solo distingue requerido / preferido / no requerido, y ninguna de las tres etiquetas representa fielmente una via de excepcion. Se anota UNSPECIFIED en lugar de forzar una etiqueta que afirmaria una modalidad que la fuente no establece. Se documenta como limitacion del contrato, no como defecto de anotacion.

**No-requisitos explícitos (1):**

- `## Maestría en Construcción y Diseño Estructural - Requisitos para el ingreso…` → Titulo de la pagina; el titulo es contexto y no crea Requirements (§8).

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `Aquellas personas que cuenten con antecedentes relevantes en investigación o profesionales, aun cuando no cump…` → Clausula de dispensa. El contrato V1 solo distingue requerido / preferido / no requerido y no tiene una categoria para 'via de excepcion que relaja los requisitos'. Se anota como g04 con modality PREFERRED y se registra la limitacion.

### EQV_005 — Reconocimiento y transferencia de créditos por estudios internacionales (ETS de Ingeniería de Sistemas Informáticos, Universidad Politécnica de Madrid (UPM), equivalence, 5069 car.)

**Nota de anotación:** CROSS-DOMAIN (equivalencia). Objective de universidad espanola con estructura normativa: elegibilidad definida por una condicion NEGATIVA (no haber homologado), lista documental con exigencias de formalidad, cadena de legalizacion con cuantificador 'todos y cada uno' y orden obligatorio, y una clausula de SUSTITUCION (apostilla de La Haya) que exime del requisito anterior. Prueba dos fenomenos que el bloque de empleo casi no tiene: criterios del evaluador frente a criterios del solicitante, y clausulas de sustitucion condicional.

| gold | modalidad | claim normalizado | qualifiers materiales | excerpt primario |
|---|---|---|---|---|
| g01 | REQUIRED | Haber realizado estudios universitarios extranjeros, parciales o totales, sin haber obtenido la homologación de la titulación en España, y haber seguido el proceso de adm | condición: estudios universitarios extranjeros, parciales o totales; condición negativa material: NO haber obtenido la homologación en España; condici | `Los estudiante que habiendo realizado e**studios universitarios extranjeros, parciales o totales, que no hayan obtenido la homologación de su titulaci…` |
| g02 | REQUIRED | Quienes no hayan obtenido resolución de reconocimiento de al menos 30 créditos de materia básica y obligatoria deberán solicitar el reconocimiento de créditos a la E.T.S. | umbral cuantitativo: al menos 30 créditos de materia básica y obligatoria; condicional negativo: si NO han obtenido resolución de reconocimiento; dest | `Continuando con el proceso de admisión a estudios oficiales de grado con estudios universitarios extranjeros, si no han obtenido resolución de reconoc…` |
| g03 | REQUIRED | Presentar certificación académica oficial de los estudios realizados, con las calificaciones obtenidas en las asignaturas impartidas y su correspondiente nota media aprob | documento: certificación académica oficial; contenido exigido: calificaciones por asignatura y nota media aprobatoria | `- Certificación académica oficial de los estudios realizados, en la que consten las calificaciones obtenidas en las asignaturas impartidas, con su cor…` |
| g04 | REQUIRED | Presentar el programa de las asignaturas aprobadas, con el contenido y la carga lectiva, sellado y diligenciado por el centro en todas y cada una de sus hojas, detallando | documento: programa de asignaturas aprobadas; contenido exigido: contenido y carga lectiva; formalidad: sellado y diligenciado en todas y cada una de  | `- Programa de las asignaturas aprobadas, en el que conste el contenido y la carga lectiva. Deberá estar sellado y diligenciado por el centro donde se …` |
| g05 | REQUIRED | Presentar pasaporte o DNI/NIE; los estudiantes extranjeros pueden presentar en su lugar una certificación de los Servicios Consulares de su país en España con nacionalida | documentos alternativos: pasaporte, DNI/NIE; sustituto admitido para extranjeros: certificación de Servicios Consulares | `- Pasaporte, DNI/ NIE. (Los estudiantes extranjeros pueden presentar una certificación de los Servicios Consulares de su país en España, en la que fig…` |
| g06 | REQUIRED | Presentar el resguardo de haber solicitado plaza. | documento: resguardo de solicitud de plaza | `- Resguardo de haber solicitado plaza.` |
| g07 | REQUIRED | Los documentos deben ser oficiales, expedidos por las autoridades competentes y legalizados por vía diplomática. | carácter: oficiales; emisor: autoridades competentes; formalidad: legalizados por vía diplomática | `- Serán **oficiales**, expedidos por las **autoridades competentes y legalizados** por vía diplomática.` |
| g08 | REQUIRED | La legalización por vía diplomática exige presentar los documentos, en ese orden, ante el Ministerio de Educación del país de origen, el Ministerio de Asuntos Exteriores  | cuantificador: todos y cada uno de los organismos; restricción material: por el orden que se cita; organismos: Ministerio de Educación de origen, Mini | `- Para legalización de documentos por vía diplomática, deberán ser presentados en todos y cada uno de los siguientes organismos, por el orden que se c…` |
| g09 | REQUIRED | Para documentos procedentes de países acogidos al Convenio de La Haya, la legalización por vía diplomática se sustituye por la apostilla, efectuada por la autoridad compe | condición: países acogidos al Convenio de La Haya; efecto material: SUSTITUYE los requisitos de legalización diplomática; ejecutor: autoridad competen | `- Para la legalización de los documentos procedentes de los países acogidos al “Convenio de La Haya”, los requisitos citados con anterioridad para una…` |
| g10 | REQUIRED | Los documentos deben ir acompañados de su correspondiente traducción oficial al castellano, realizada por representación diplomática o consular española en el extranjero, | objeto: traducción oficial al castellano; condicional: en su caso; vías alternativas: representación diplomática/consular española, representación del | `Los documentos deberán ir acompañados, en su caso, de su **correspondiente traducción oficial al castellano**, que podrá hacerse:` |

**Justificaciones de separación / preservación y ambigüedades:**

- `g01` — La condicion negativa es constitutiva de la elegibilidad: quien SI obtuvo homologacion no puede solicitar este reconocimiento. Convertirla en positiva invertiria el criterio.
- `g02` — El umbral de 30 creditos y el condicional negativo son ambos materiales.
- `g03` — Separado por §4.1: la lista documental enumera piezas independientes, cada una con sus propias exigencias de contenido.
- `g04` — Ver g03. Las exigencias de formalidad son qualifiers materiales del mismo documento.
- `g05` — Ver g03. El sustituto consular es una alternativa material, no un documento adicional.
- `g06` — Ver g03.
- `g08` — Compuesto preservado: 'todos y cada uno' y 'por el orden que se cita' son qualifiers que NO distribuyen; emitir un Requirement por organismo perderia la exigencia de secuencia y de completitud.
- `g09` — Claim que EXIME de g08 bajo una condicion. Tratarlo como una exigencia adicional acumulativa seria un error material de modalidad.
- `g10` — Las cuatro vias van introducidas por 'podra hacerse' (alternativas): separar convertiria una disyuncion en cuatro exigencias. El 'en su caso' condiciona la exigencia y es material.

**No-requisitos explícitos (9):**

- `Cuando la titulación universitaria de origen no esté regulada por la vigente ley de educación universitaria es…` → Define el criterio que aplica la UNIVERSIDAD al resolver, no una exigencia dirigida al solicitante. Distincion clave del dominio de equivalencias: hay criterios del evaluador y criterios del solicitante.
- `Este reconocimiento supondrá para el alumno la exención de cursar dichas asignaturas.…` → Efecto del reconocimiento, no requisito.
- `**Normativa de Reconocimiento y Transferencia de Créditos de la UPM**…` → Referencia normativa enlazada.
- `Una vez remitida la solicitud, junto con la documentación indicada, el centro le enviará la **carta de pago de…` → Paso procedimental posterior a la solicitud; se registra como pasaje ambiguo porque contiene un 'debe remitir'.
- `La documentación será evaluada por la Subdirección de Ordenación Académica, los departamentos y secciones depa…` → Describe el circuito de evaluacion interno de la universidad.
- `La Resolución concediendo o denegando los reconocimientos de créditos será adoptada por la CRTC.…` → Organo resolutor; no es criterio del solicitante.
- `Se deberá remitir una solicitud de reconocimiento de créditos para alumnos con estudios extranjeros junto con …` → Instruccion de canal y datos de contacto.
- `Los plazos para el reconocimiento de créditos por estudios internacionales vienen especificados en el siguient…` → Remision a otro documento; no enuncia el plazo.
- `## Jefatura de Estudios…` → Encabezado de la unidad administrativa de la pagina.

**Pasajes ambiguos registrados (1) — no penalizan ni cuentan como omisión:**

- `Una vez remitida la solicitud, junto con la documentación indicada, el centro le enviará la **carta de pago de…` → Contiene una obligacion del solicitante ('debe remitir al centro el resguardo del abono') dentro de un pasaje mayoritariamente procedimental. Un anotador razonable podria emitir un Requirement documental. No se penaliza si el extractor lo emite.
