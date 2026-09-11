"""Prompt productivo de Objective Understanding — slice P2.2.

EL CUERPO DE INSTRUCCIONES ES BYTE-IDENTICO AL DEL CANDIDATO `OU_A2` QUE PASO EL
HOLDOUT DE P2.1. No se reescribio, no se pulio el estilo y no se agrego ninguna
regla nueva — en particular, NINGUNA instruccion de deduplicacion semantica.

Por que literal y no "equivalente". P2.1 midio un texto concreto. Reescribirlo
"sin cambiar el significado" es exactamente la clase de afirmacion que nadie puede
verificar: cualquier reformulacion produce un candidato que la evaluacion nunca
observo. La unica equivalencia demostrable es la igualdad, y por eso el test de
contrato fija el hash del cuerpo.

    OU_A2_INSTRUCTIONS_SHA256 = "bd0c888c0dd5c56bd2f859cec08b3defc453ae7d057cc646c2fa9cb14a2302e2"

MAPEO INVESTIGACION -> PRODUCTO. La correspondencia es la identidad para el cuerpo
de reglas; lo unico propio del producto es la identidad de version del prompt,
que NO reutiliza el nombre del ancestro:

    regla OU_A2                          regla productiva
    ------------------------------------ ------------------------------------
    claim evaluativo a nivel de fuente   identica (byte a byte)
    qualifiers compartidos / §4.1        identica
    preservacion de compuestos           identica
    frontera P2 vs facets de F3.5        identica
    modalidad de encabezado gobernante   identica
    extension contigua de la cita        identica
    required / preferred en el texto     identica
    negacion                             identica
    contexto vs Requirement              identica
    titulo solo como contexto            identica
    idioma de la fuente preservado       identica
    pasajes no resueltos                 identica
    orden de la fuente                   identica
    ------------------------------------ ------------------------------------
    prompts_v3.OU_A2 (investigacion)     product_objective_understanding_v1

IDIOMA. El prompt no pide traducir nada y no menciona ningun idioma de salida: el
claim propuesto queda en el idioma de la fuente. No hay capa de traduccion en
P2.2. La localizacion de la UI es un problema distinto y posterior.
"""

from __future__ import annotations

#: Cuerpo de instrucciones congelado. Cualquier edicion de esta constante rompe
#: `test_objective_understanding_contract.py::test_instructions_hash_matches_ou_a2`
#: a proposito: seria un candidato distinto del evaluado.
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

#: Hash del cuerpo tal como lo congelo P2.1. Vive en el modulo para que el guard
#: no dependa de que el arbol experimental este presente en el despliegue.
OU_A2_INSTRUCTIONS_SHA256 = "bd0c888c0dd5c56bd2f859cec08b3defc453ae7d057cc646c2fa9cb14a2302e2"


def build_objective_understanding_prompt(
    *,
    objective_type: str,
    title: str,
    raw_objective_text: str,
) -> str:
    """Arma el prompt exactamente como lo armaba el candidato evaluado.

    El sobre tambien es literal: el orden de los campos, los rotulos y los
    delimitadores son los que OU_A2 uso en Development, Holdout y cross-domain.

    `title` viaja SOLO como contexto de interpretacion y el rotulo lo dice en el
    propio prompt. La autoridad sobre que Requirements existen es unicamente
    `raw_objective_text`.
    """
    return (
        INSTRUCTIONS
        + "\n\n=== OBJECTIVE ===\n"
        + "objectiveType: " + objective_type + "\n"
        + "title (SOLO CONTEXTO, no crea Requirements): " + (title or "") + "\n"
        + "--- texto crudo del Objective (unica autoridad) ---\n"
        + raw_objective_text
        + "\n--- fin del texto crudo ---\n"
    )
