r"""`MINIMAL_DETERMINISTIC_JSON_V1` - implementacion productiva independiente.

Esta es la implementacion PRODUCTORA. Es deliberadamente independiente del
modulo de referencia solo-tests de F0.1, que vive bajo `tests/contracts/`: si
ambas derivaran del mismo codigo, la igualdad byte a byte entre ellas no
probaria nada. El criterio de aceptacion es que este modulo produzca exactamente los
mismos bytes de preimage y el mismo SHA-256 que el golden vector congelado en
F0.1.

Por el mismo motivo NO se usa `json.dumps`. La especificacion congelada en
`packages/schemas/README.md` define los BYTES; `json.dumps(..., sort_keys=True,
ensure_ascii=False, separators=(",", ":"))` es la implementacion de referencia,
no la definicion. Este serializador recursivo implementa las reglas escritas.

Reglas (congeladas en F0.1, ver `packages/schemas/README.md`)::

  claves de objeto   ordenadas ascendente por code point Unicode
  whitespace         ninguno
  enteros            decimal, sin ceros a la izquierda, sin exponente
  booleanos          true / false
  null               null
  arrays             orden preservado (es semanticamente significativo)
  encoding final     UTF-8
  hash               SHA-256, hex minuscula

Escaping de strings, caracter por caracter::

  U+0022  ->  \"        U+005C  ->  \\        U+0008  ->  \b
  U+0009  ->  \t        U+000A  ->  \n        U+000C  ->  \f
  U+000D  ->  \r
  todo otro U+0000..U+001F   ->  \u00xx  con los digitos hex en MINUSCULA
  U+007F                     ->  literal, NO escapado
  cualquier no-ASCII         ->  literal, UTF-8 al final, NUNCA \uXXXX
  surrogates UTF-16 sueltos  ->  ENTRADA INVALIDA

La forma larga en minuscula y la misma forma en mayuscula son el mismo JSON
semanticamente, pero producen preimages distintos y por lo tanto fingerprints
distintos. Solo vale la minuscula (\u001f, nunca \u001F).
"""

from __future__ import annotations

import hashlib
from typing import Any

from .errors import CanonicalJsonError

CANONICALIZATION = "MINIMAL_DETERMINISTIC_JSON_V1"
FINGERPRINT_HASH = "SHA-256"
FINGERPRINT_PREIMAGE_ENCODING = "UTF-8"

_QUOTE = chr(0x22)
_BACKSLASH = chr(0x5C)

_SHORT_ESCAPES = {
    0x22: _BACKSLASH + _QUOTE,
    0x5C: _BACKSLASH + _BACKSLASH,
    0x08: _BACKSLASH + "b",
    0x09: _BACKSLASH + "t",
    0x0A: _BACKSLASH + "n",
    0x0C: _BACKSLASH + "f",
    0x0D: _BACKSLASH + "r",
}

_LONG_ESCAPE_PREFIX = _BACKSLASH + "u"


def _encode_string(value: str) -> str:
    parts = [_QUOTE]
    for char in value:
        code_point = ord(char)
        if 0xD800 <= code_point <= 0xDFFF:
            raise CanonicalJsonError(
                f"lone_surrogate: U+{code_point:04X} no puede serializarse a UTF-8"
            )
        short = _SHORT_ESCAPES.get(code_point)
        if short is not None:
            parts.append(short)
        elif code_point < 0x20:
            # Forma larga. `%04x` es lo que congela los digitos en minuscula.
            parts.append(_LONG_ESCAPE_PREFIX + "%04x" % code_point)
        else:
            parts.append(char)
    parts.append(_QUOTE)
    return "".join(parts)


def _encode(value: Any) -> str:
    # `bool` es subclase de `int` en Python, asi que va antes que el caso entero.
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _encode_string(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(_encode(item) for item in value) + "]"
    if isinstance(value, dict):
        members = []
        for key in sorted(value):
            if not isinstance(key, str):
                raise CanonicalJsonError(f"non_string_object_key: {key!r}")
            members.append(_encode_string(key) + ":" + _encode(value[key]))
        return "{" + ",".join(members) + "}"
    # Los floats se rechazan a proposito: la material projection no contiene
    # ninguno, y la serializacion de numeros de punto flotante es justamente la
    # parte de JCS que esta canonicalizacion evita tener que definir.
    raise CanonicalJsonError(f"unsupported_type: {type(value).__name__}")


def canonical_json(payload: Any) -> str:
    """Serializa `payload` bajo `MINIMAL_DETERMINISTIC_JSON_V1`."""
    return _encode(payload)


def canonical_preimage(payload: Any) -> bytes:
    return canonical_json(payload).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fingerprint(payload: Any) -> str:
    return sha256_hex(canonical_preimage(payload))
