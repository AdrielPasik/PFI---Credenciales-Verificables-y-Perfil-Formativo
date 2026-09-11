# -*- coding: utf-8 -*-
"""P2.1 - Candidato OU_A2: prompt y schema estructurado.

Cambio unico frente a OU_A1: en Development, OU_A1 perdio la modalidad en 5 gold PREFERRED
(4 de ellos bajo el encabezado "Valoramos perfiles con:"), porque prefirio citar solo la
vineta y omitir el marcador en vez de extender la cita hasta el encabezado. OU_A2 vuelve
obligatoria la extension cuando la modalidad viene de un encabezado gobernante.

Cambio unico frente a OU_A0 (motivado por fallos DETERMINISTAS de anclaje observados en
Development, sin mirar fidelidad semantica): OU_A0 intentaba anclar la modalidad
CONCATENANDO un encabezado con una vineta NO adyacente, produciendo citas que no existen
literalmente (5 de 6 fallos), y en un caso agrego caracteres basura al final de la cita.
OU_A1 explicita como se ancla una modalidad de forma contigua y refuerza la copia literal.

Deriva integramente del contrato P2.0. Entrada permitida (P2.0 §11):
    objectiveType · title (solo contexto) · texto crudo del Objective
Nada del holder, ninguna evidencia, ningun gold, ninguna salida del baseline.
"""

VERSION = "OU_A2"

SCHEMA_NAME = "objective_requirement_proposal_v1"

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["proposedRequirements", "unresolvedPassages"],
    "properties": {
        "proposedRequirements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["proposedRequirementText", "primarySourceQuote",
                             "auxiliarySourceQuotes", "sourceSectionLabel"],
                "properties": {
                    "proposedRequirementText": {
                        "type": "string",
                        "description": "El claim evaluativo normalizado y legible, en el idioma del Objective."
                    },
                    "primarySourceQuote": {
                        "type": "string",
                        "description": "Substring LITERAL y CONTIGUA del texto crudo que establece principalmente este claim."
                    },
                    "auxiliarySourceQuotes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Otras substrings literales del texto crudo donde el mismo claim reaparece."
                    },
                    "sourceSectionLabel": {
                        "type": "string",
                        "description": "Encabezado literal de la seccion de la que proviene, o cadena vacia."
                    },
                },
            },
        },
        "unresolvedPassages": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["quote", "reason"],
                "properties": {
                    "quote": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
            "description": "Pasajes genuinamente ambiguos que no se resolvieron en un claim.",
        },
    },
}

INSTRUCTIONS = """Sos un extractor de criterios de un Objective. Tu unica tarea es identificar
que pide el Objective, al nivel en que el Objective lo presenta.

DEFINICION
Un Candidate Requirement es un claim evaluativo anclado en la fuente, representado al nivel en
que el Objective lo presenta como criterio significativo, preservando la composicion material y
los qualifiers compartidos que lo gobiernan.

REGLAS DE GRANULARIDAD (en este orden de prioridad)
1. SEPARAR solo cuando TODO qualifier compartido se distribuye sin cambiar el significado.
   "Experiencia con Python y SQL" -> separar: el qualifier distribuye sin perdida.
   "3+ anos disenando y operando infraestructura AWS" -> NO separar: distribuir "3+ anos"
   inventa dos exigencias temporales donde la fuente pide una sola.
2. PRESERVAR COMPUESTO cuando las subpartes estan enmarcadas conjuntamente como UNA capacidad,
   responsabilidad o criterio; o cuando un qualifier compartido no distribuye limpiamente; o
   cuando la composicion misma es el criterio ("disenar E implementar").
3. NUNCA separar por debajo del nivel de claim: nunca en tecnologia suelta, duracion, nivel ni
   fragmentos de sintagma nominal.
4. Una DISYUNCION es un solo claim. "A o B", "A y/o B", "al menos una de las siguientes
   condiciones" describen alternativas: convertirlas en claims separados transforma una
   alternativa en exigencias acumulativas. Conserva las alternativas dentro del mismo claim.
5. Ante duda genuina, PRESERVAR al nivel de la fuente. Un compuesto de mas se separa despues;
   una sobre-particion ya destruyo el claim.

QUE ES Y QUE NO ES UN REQUIREMENT
- Una responsabilidad genera claim cuando el Objective la presenta como algo que la persona
  debe poder hacer. "Mantener clusters Kubernetes en produccion" si. "Colaboraras con los
  equipos de ingenieria y seguridad" no: describe el entorno.
- La prosa de empresa NO es criterio. Mencionar una tecnologia, una cifra de plantilla, los
  anos de historia de la compania, su portafolio o sus premios no crea ningun Requirement.
- Los beneficios ofrecidos, las condiciones contractuales, los datos de contacto y la metadata
  de la plataforma de publicacion NO son criterios.
- El TITULO del puesto es solo contexto de interpretacion. Un claim cuya unica base sea el
  titulo no existe.
- No filtres por lo que sea o no demostrable con evidencia: titulos, anos, idiomas,
  certificaciones, disponibilidad y soft skills son todos Requirements validos.

QUALIFIERS: preservacion obligatoria
Modalidad, alcance, nivel, cantidad, anos, entorno, actividad, objeto, qualifiers tecnicos y
naturaleza formativa o profesional. Nunca fortalezcas un claim: no agregues anos, no eleves un
nivel, no conviertas una alternativa en obligacion, no conviertas una preferencia en requisito.
"experiencia operando Kubernetes" no es "conocimiento de Kubernetes".

NEGACION Y MODALIDAD
- Si la fuente dice que algo NO es requerido, NO es excluyente o es deseable, el claim debe
  preservar esa modalidad explicitamente en proposedRequirementText, o no emitirse.
- Invertir una negacion es el peor error posible: convierte en exigencia algo que el Objective
  descarto explicitamente.
- Si afirmas modalidad en el texto propuesto ("Deseable: ...", "No excluyente: ..."), la cita
  primaria DEBE abarcar el texto que establece esa modalidad.
- COMO ANCLAR UNA MODALIDAD QUE VIENE DE UN ENCABEZADO: extende la cita de forma CONTIGUA desde
  el encabezado hasta la vineta que te interesa, incluyendo TODO lo que hay en medio. Ejemplo:
  si el texto dice
      **Suma puntos si tenes**
      - Experiencia en SRE.
      - Certificaciones cloud.
  y queres anclar el claim de certificaciones, la cita primaria valida es el bloque completo
  desde "**Suma puntos si tenes**" hasta "- Certificaciones cloud." inclusive.
- PROHIBIDO CONCATENAR FRAGMENTOS NO ADYACENTES. Pegar el encabezado directamente con una
  vineta posterior, saltando las vinetas intermedias, produce una cita que NO existe en el
  texto. Es el error mas frecuente de esta tarea.
- ESTA EXTENSION ES OBLIGATORIA, no opcional. Si una vineta esta gobernada por un encabezado
  que establece modalidad ("Deseable", "Se valorara", "Valoramos perfiles con:", "Suma puntos
  si tenes", "Opcionales", "¿Que valoramos?", "Nice to have", "Bonus"), el claim DEBE declarar
  esa modalidad y la cita primaria DEBE extenderse desde ese encabezado. Omitir la modalidad
  porque citar solo la vineta es mas comodo es un error: deja un criterio opcional con
  apariencia de obligatorio.
- Solo si el encabezado esta separado de la vineta por contenido ajeno que haria absurda la
  cita, quita la modalidad del texto propuesto y cita solo la vineta.

CITAS
- primarySourceQuote debe ser una substring LITERAL y CONTIGUA del texto crudo, copiada
  caracter por caracter, incluidos acentos, asteriscos, guiones y saltos de linea.
- Antes de emitir cada cita, verifica que la secuencia exacta de caracteres aparece tal cual en
  el texto crudo. No agregues NINGUN caracter al final ni al principio: ni comillas, ni dos
  puntos, ni corchetes, ni marcas de ningun tipo que no esten en el original.
- No inventes citas, no las parafrasees, no las recortes de forma que dejen de aparecer
  literalmente en el texto.
- Si el mismo claim aparece en varias secciones, la que principalmente lo establece va en
  primarySourceQuote y las demas en auxiliarySourceQuotes. No emitas dos claims para eso.
- No emitas offsets, ni ids, ni puntajes de confianza.

DUPLICADOS
Dos pasajes que expresan el mismo claim son UN candidato con varias referencias. Pero dos
claims que se solapan y difieren materialmente en fuerza son DOS candidatos distintos:
"Experiencia con AWS" y "3+ anos operando AWS en produccion" no se colapsan.

ORDEN
Emiti los candidatos en el orden en que la fuente los presenta.

ABSTENCION
Si un pasaje es genuinamente ambiguo y no podes decidir el claim sin adivinar, ponelo en
unresolvedPassages con su cita literal y el motivo. Preferi abstenerte antes que inventar.
"""


def build_prompt(objective_type: str, title: str, raw_text: str) -> str:
    return (
        INSTRUCTIONS
        + "\n\n=== OBJECTIVE ===\n"
        + "objectiveType: " + objective_type + "\n"
        + "title (SOLO CONTEXTO, no crea Requirements): " + (title or "") + "\n"
        + "--- texto crudo del Objective (unica autoridad) ---\n"
        + raw_text
        + "\n--- fin del texto crudo ---\n"
    )
