"""Anclaje determinista de la base de una facet al Requirement — P2.4.

POR QUE EXISTE. El contrato exige que cada `requirementBasisPhrase` sea
subcadena LITERAL del `requirementText`. Eso es una invariante CRUZADA entre dos
campos, y el structured output del proveedor no puede imponerla: solo garantiza
forma. Se delegaba en la obediencia del modelo, y en produccion se rompio —el
Requirement decia "3 años" y el modelo escribio la frase con el numero en
palabra—.

    contextual_facet_basis_not_literal

LA CORRECCION NO ES PEDIRLO MAS FUERTE. Es que el modelo deje de escribir la
frase. Ahora ELIGE UNA POSICION sobre una vista indexada del Requirement, y el
servidor RECORTA el texto de esa posicion. La literalidad deja de ser una
promesa y pasa a ser una consecuencia de recortar.

    texto congelado -> tokenizacion determinista -> vista indexada al modelo
    -> el modelo devuelve rangos -> el servidor valida -> el servidor recorta

NO HAY REPARACION SEMANTICA. Ni distancia de edicion, ni normalizacion de
numeros, ni busqueda de la frase "mas parecida". El modelo elige DONDE; el
servidor dice QUE dice ahi. Si eligio mal, eligio mal — pero lo que se persiste
siempre es texto del Requirement.

CODE POINTS. Python indexa strings por code point, asi que los offsets de este
modulo son code points por construccion. No hay indices UTF-16 y no puede
colarse ninguno: el JavaScript de NestJS nunca ve estas coordenadas.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from src.api.contextual_reasoning.contracts import ProviderInvalidOutputError


class RequirementToken(NamedTuple):
    """Un token con sus limites en el texto ORIGINAL, en code points."""

    index: int
    text: str
    char_start: int
    char_end: int


def tokenize_requirement(requirement_text: str) -> list[RequirementToken]:
    """Segmentacion posicional determinista del Requirement.

    SIN INTELIGENCIA LINGUISTICA, y a proposito: lo unico que se necesita es
    poder reconstruir una subcadena exacta. Tres reglas:

        1. un token es una corrida maximal de caracteres alfanumericos
           —`str.isalnum()` cubre letras acentuadas, digitos y letras de planos
           altos—;
        2. cualquier otro caracter que no sea espacio es UN token propio, para
           que la puntuacion se pueda incluir o excluir de una base;
        3. los espacios NUNCA son token, pero se conservan en el texto: como el
           recorte se hace sobre el ORIGINAL entre dos limites, cualquier
           espaciado interior sobrevive intacto.

    El texto no se normaliza: ni mayusculas, ni acentos, ni numeros, ni
    puntuacion, ni espacios. El string congelado es la autoridad.
    """
    tokens: list[RequirementToken] = []
    position = 0
    length = len(requirement_text)

    while position < length:
        character = requirement_text[position]
        if character.isspace():
            position += 1
            continue
        if character.isalnum():
            start = position
            while position < length and requirement_text[position].isalnum():
                position += 1
            tokens.append(
                RequirementToken(
                    len(tokens), requirement_text[start:position], start, position
                )
            )
            continue
        tokens.append(
            RequirementToken(len(tokens), character, position, position + 1)
        )
        position += 1

    return tokens


def indexed_requirement_view(
    tokens: list[RequirementToken],
) -> list[dict[str, Any]]:
    """La vista que ve el modelo: indice y texto, nada mas.

    NO se le mandan coordenadas de caracter. Que el modelo cuente code points a
    mano seria pedirle aritmetica sobre Unicode —fragil y sin ninguna ventaja—:
    elegir un indice de una lista que tiene delante es una tarea de seleccion,
    no de calculo.
    """
    return [{"index": token.index, "text": token.text} for token in tokens]


def derive_basis_phrase(
    requirement_text: str,
    tokens: list[RequirementToken],
    basis_range: Any,
) -> str:
    """Valida UN rango y devuelve el recorte EXACTO del texto congelado.

    Rango semiabierto `[startTokenIndex, endTokenIndexExclusive)`.

    Nunca se ajusta ni se recorta un rango invalido hacia adentro: un rango
    fuera de contrato es salida invalida del proveedor, no un valor a corregir.
    """
    if not isinstance(basis_range, dict):
        raise ProviderInvalidOutputError("contextual_facet_basis_range_malformed")

    if set(basis_range) != {"startTokenIndex", "endTokenIndexExclusive"}:
        raise ProviderInvalidOutputError("contextual_facet_basis_range_malformed")

    start = basis_range["startTokenIndex"]
    end = basis_range["endTokenIndexExclusive"]

    # `bool` es subclase de `int` en Python: `True` pasaria como 1 sin esto.
    if (
        not isinstance(start, int)
        or not isinstance(end, int)
        or isinstance(start, bool)
        or isinstance(end, bool)
    ):
        raise ProviderInvalidOutputError("contextual_facet_basis_range_malformed")

    if start < 0 or end <= start or end > len(tokens):
        raise ProviderInvalidOutputError("contextual_facet_basis_range_out_of_bounds")

    # EL RECORTE ES SOBRE EL ORIGINAL, entre el inicio del primer token y el
    # final del ultimo. Nunca `" ".join(...)`: eso reescribiria el espaciado,
    # los saltos de linea y el espacio alrededor de la puntuacion, y la frase
    # dejaria de ser subcadena del Requirement.
    return requirement_text[tokens[start].char_start : tokens[end - 1].char_end]


def derive_basis_phrases(
    requirement_text: str,
    tokens: list[RequirementToken],
    basis_ranges: Any,
    *,
    allow_empty: bool = False,
) -> list[str]:
    """Los recortes de una base, en el orden en que el modelo los eligio.

    `allow_empty` existe para NO endurecer el contrato de paso: una facet sin
    base siempre fue invalida, pero la base de continuidad podia venir vacia y
    este cambio no es el lugar para prohibirlo.
    """
    if not isinstance(basis_ranges, list):
        raise ProviderInvalidOutputError("contextual_facet_basis_range_malformed")
    if not basis_ranges and not allow_empty:
        # Mismo subcodigo que antes: una facet sin base no explica por que existe.
        raise ProviderInvalidOutputError("contextual_facet_basis_empty")

    return [
        derive_basis_phrase(requirement_text, tokens, basis_range)
        for basis_range in basis_ranges
    ]
