r"""Precondicion de entrada product-normalized para fuentes `TEXT`.

El artifact declara `sourceNormalizationApplied = PRODUCT_NFC_LINEENDINGS_TRIM`.
Esa afirmacion no puede ser falsa, asi que F0.3 la VERIFICA en vez de producirla:
recibe el contenido ya persistido y comprueba que sea punto fijo de la
normalizacion productiva. Nunca lo re-normaliza ni lo sustituye.

La distincion importa. Si F0.3 normalizara la entrada, un `content` que no
proviniera del pipeline productivo produciria igual un artifact declarando
`PRODUCT_NFC_LINEENDINGS_TRIM`, y esa declaracion seria una invencion nuestra en
vez de un hecho sobre la fuente. Ademas el `sourceSha256` cubre la forma
persistida: normalizar despues del hash desalinearia el binding.

Semantica congelada del token, en este orden::

    1. Unicode NFC
    2. CRLF / CR  ->  LF
    3. ECMAScript String.prototype.trim

Implementacion productiva de referencia, verificada literalmente::

    services/api/src/text-evidence/text-evidence.validator.ts::normalizeContent
    value.normalize('NFC').replace(/\r\n?/g, '\n').trim()

`str.strip()` de Python NO sirve para el paso 3, y no por un detalle exotico.
Los dos conjuntos difieren en ambas direcciones, verificado ejecutando el
normalizador productivo real en Node::

    U+FEFF  ZWNBSP   ECMAScript SI lo recorta   Python NO
    U+0085  NEL      ECMAScript NO lo recorta   Python SI
    U+001C..U+001F   ECMAScript NO los recorta  Python SI

Usar `strip()` aceptaria contenido con BOM en el borde como si fuera punto fijo
—no lo es— y rechazaria contenido con NEL en el borde que si lo es.

`U+200B ZERO WIDTH SPACE` es el contraejemplo que conviene tener presente: es
categoria `Cf`, no `Zs`, asi que ECMAScript NO lo recorta y un contenido que
empieza con el es punto fijo perfectamente valido.
"""

from __future__ import annotations

import unicodedata

PRODUCT_NFC_LINEENDINGS_TRIM = "PRODUCT_NFC_LINEENDINGS_TRIM"

#: Conjunto de recorte de ECMAScript = WhiteSpace + LineTerminator (ECMA-262).
#: Se declara explicito, no derivado de `unicodedata`, porque es un contrato
#: congelado: si una version futura de Unicode agrega un `Zs`, queremos que un
#: test lo delate en vez de que el conjunto cambie solo. `test_normalization.py`
#: contrasta esta lista contra la categoria `Zs` vigente por ese motivo.
ECMASCRIPT_TRIM_CODE_POINTS = frozenset(
    {
        0x0009,  # TAB
        0x000A,  # LINE FEED           (LineTerminator)
        0x000B,  # VERTICAL TAB
        0x000C,  # FORM FEED
        0x000D,  # CARRIAGE RETURN     (LineTerminator)
        0x0020,  # SPACE
        0x00A0,  # NO-BREAK SPACE      (Zs)
        0x1680,  # OGHAM SPACE MARK    (Zs)
        0x2028,  # LINE SEPARATOR      (LineTerminator)
        0x2029,  # PARAGRAPH SEPARATOR (LineTerminator)
        0x202F,  # NARROW NO-BREAK SPACE       (Zs)
        0x205F,  # MEDIUM MATHEMATICAL SPACE   (Zs)
        0x3000,  # IDEOGRAPHIC SPACE           (Zs)
        0xFEFF,  # ZERO WIDTH NO-BREAK SPACE
    }
    | set(range(0x2000, 0x200B))  # EN QUAD .. HAIR SPACE (Zs)
)

_TRIM_CHARACTERS = "".join(sorted(chr(point) for point in ECMASCRIPT_TRIM_CODE_POINTS))


def ecmascript_trim(text: str) -> str:
    """`String.prototype.trim` de ECMAScript, no `str.strip` de Python."""
    return text.strip(_TRIM_CHARACTERS)


def product_normalize(text: str) -> str:
    """La normalizacion productiva, reproducida para PODER COMPARAR.

    Existe unicamente para decidir si una entrada ya es punto fijo. F0.3 nunca
    sustituye el contenido recibido por su salida: el resultado de esta funcion
    no llega jamas a un artifact.
    """
    composed = unicodedata.normalize("NFC", text)
    line_normalized = composed.replace("\r\n", "\n").replace("\r", "\n")
    return ecmascript_trim(line_normalized)


def is_product_normalized(text: str) -> bool:
    """Si `text` ya es punto fijo de `PRODUCT_NFC_LINEENDINGS_TRIM`."""
    return text == product_normalize(text)


def describe_violation(text: str) -> str:
    """Motivo de la violacion, SIN citar el contenido.

    Devuelve solo el nombre de la etapa que habria cambiado el texto. Nunca el
    texto, ni un fragmento, ni un caracter concreto: el contenido de una
    TextEvidence es dato del holder.
    """
    composed = unicodedata.normalize("NFC", text)
    if composed != text:
        return "not_nfc"
    line_normalized = composed.replace("\r\n", "\n").replace("\r", "\n")
    if line_normalized != composed:
        return "line_endings_not_normalized"
    if ecmascript_trim(line_normalized) != line_normalized:
        return "not_trimmed"
    return "already_normalized"
