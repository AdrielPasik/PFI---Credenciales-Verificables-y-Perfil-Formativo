r"""Texto canonico y segmentacion deterministica por bloques.

TEXTO CANONICO (diseño F0 §4) — la unica transformacion permitida::

    canonical(raw) = raw.replace("\r\n", "\n").replace("\r", "\n")

Nada mas. Sin `normalize_whitespace`, sin `strip`, sin NFC/NFKC, sin colapso de
tabs ni de runs, sin plegado de `\n{3,}`. Los offsets deben referirse a UNA
representacion canonica inmutable, y cualquier diseño de la forma
`extraer -> normalizar despues -> conservar los offsets viejos` viola ese
invariante. La tolerancia a la varianza de citas vive en el aligner, sobre una
proyeccion descartable, no en el texto canonico.

Los fines de linea son la unica excepcion porque `\r\n` contra `\n` es un
artefacto de plataforma del parser, no carga significado documental, y de otro
modo la misma fuente daria offsets distintos en maquinas distintas.

SEGMENTACION (diseño F0 §7.2) — bloques separados por linea en blanco, con
alcance de pagina, deterministica, sin LLM, sin taxonomia y sin dependencia de
configuracion. La segmentacion por secciones quedo rechazada por principio:
dependeria de `section_detector.py`, cuyo comportamiento lo dirigen los patrones
de `config/semantic/*.json`, y eso volveria el propio espacio de direcciones
dependiente de configuracion — una edicion de taxonomia re-direccionaria en
silencio citas ya almacenadas.

IDENTIDAD DE SEGMENTO (diseño F0 §7.3) — derivada de la direccion, nunca
ordinal. El experimento congelado usa `seg-{index}`; un ordinal re-apunta en
silencio si la segmentacion cambia, y toda cita almacenada que lo referencie
queda calladamente equivocada.
"""

from __future__ import annotations

from typing import Any

BLOCK_SEPARATOR = "\n\n"
PAGE_JOIN = "\n\n"


def canonical_text(raw: str) -> str:
    """Normalizacion de fin de linea, y nada mas."""
    return raw.replace("\r\n", "\n").replace("\r", "\n")


def code_point_length(text: str) -> int:
    """Largo en code points Unicode.

    En Python 3 `len(str)` ya lo es. La funcion existe para que el contrato
    quede explicito y para que la contraparte TypeScript de F0.4 no caiga en
    `String.prototype.length`, que cuenta code units UTF-16.
    """
    return len(text)


def has_substantive_text(text: str) -> bool:
    """Si la pagina rindio contenido textual sustantivo.

    Solo clasifica; nunca modifica `canonicalText`. Un texto compuesto solo por
    whitespace NO cuenta como sustantivo — y, criticamente, tampoco habilita
    `OBSERVED_EMPTY`: §6.2 nombra "texto extraido compuesto solo por whitespace"
    como justificacion insuficiente. Cae en el default conservador.
    """
    return text.strip() != ""


def segment_blocks(text: str) -> list[tuple[int, int]]:
    """Spans `(charStart, charEnd)` de los bloques separados por linea en blanco.

    Los offsets se calculan por aritmetica sobre el cursor, no con `str.find`
    como en el experimento: `find` puede re-encontrar un bloque repetido en la
    posicion equivocada, y aca la direccion ES la identidad.

    Se descartan los bloques vacios y los compuestos solo por whitespace. Es una
    restriccion mas estricta que la del experimento, que solo salteaba los
    vacios: un segmento de puro whitespace es una direccion sin contenido
    citable, y emitirlo solo agrega ruido al espacio de direcciones. La
    diferencia es visible unicamente en textos con separadores multiples.
    """
    spans: list[tuple[int, int]] = []
    cursor = 0
    for block in text.split(BLOCK_SEPARATOR):
        start = cursor
        end = start + code_point_length(block)
        if block.strip() != "":
            spans.append((start, end))
        cursor = end + code_point_length(BLOCK_SEPARATOR)
    return spans


def page_segments(page_index: int, text: str) -> list[dict[str, Any]]:
    """Segmentos de una pagina, con offsets RELATIVOS a `page.canonicalText`.

    Lo normativo es relativo al contenedor (diseño §5.1): una direccion relativa
    a la pagina sobrevive cualquier cambio en la convencion de union de paginas;
    una global no.
    """
    return [
        {
            "segmentId": f"p{page_index}:{start}-{end}",
            "pageIndex": page_index,
            "charStart": start,
            "charEnd": end,
            "exactExcerpt": text[start:end],
        }
        for start, end in segment_blocks(text)
    ]


def document_segments(text: str) -> list[dict[str, Any]]:
    """Segmentos de una fuente `TEXT`, con offsets relativos al DOCUMENTO.

    Misma politica de bloques que para PDF —deterministica, sin LLM, sin
    taxonomia, sin configuracion— pero el contenedor es el documento entero,
    porque un TextEvidence no tiene paginas.

    `pageIndex` es `null`, no `0`: cero seria una pagina real y volveria
    direccionable una pagina que no existe.
    """
    return [
        {
            "segmentId": f"d:{start}-{end}",
            "pageIndex": None,
            "charStart": start,
            "charEnd": end,
            "exactExcerpt": text[start:end],
        }
        for start, end in segment_blocks(text)
    ]


def join_pages(page_texts: list[str]) -> str:
    """`documentCanonicalText` para PDF. Campo derivado, no normativo."""
    return PAGE_JOIN.join(page_texts)
