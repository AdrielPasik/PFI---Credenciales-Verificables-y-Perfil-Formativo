"""Frontera de parseo de PDF, y clasificacion de sus fallos.

Un unico lugar donde se toca pdfplumber o pypdf. Eso es lo que hace testeable
sin PDFs corruptos que "a esta version le pasa esto": una excepcion de pagina se
inyecta con un doble deterministico en esta frontera, no fabricando bytes cuyo
comportamiento depende del parser instalado.

Las funciones devuelven una lista con una entrada por pagina fisica, donde
`None` significa que ESA pagina lanzo excepcion. Las excepciones a nivel de
FUENTE se propagan: la diferencia entre "no pude leer una pagina" y "no pude
abrir el documento" es justamente lo que decide si hay fallback (§8 de la tarea)
y no puede quedar aplanada.
"""

from __future__ import annotations

import io

from .diagnostics import ENCRYPTED_PDF, SOURCE_UNREADABLE, UNSUPPORTED_SOURCE
from .identity import PARSER_PDFPLUMBER, PARSER_PYPDF

#: Se clasifica por NOMBRE DE CLASE recorriendo la cadena de causas, no por el
#: texto del mensaje: los mensajes cambian entre versiones del parser, y una
#: clasificacion que dependa de ellos derivaria en silencio.
_ENCRYPTION_MARKERS = frozenset({
    "PDFPasswordIncorrect",
    "PDFEncryptionError",
    "FileNotDecryptedError",
    "DependencyError",
    "PdfReadError_encryption",
})

_UNSUPPORTED_MARKERS = frozenset({
    "PDFSyntaxError",
    "PdfStreamError",
    "EmptyFileError",
    "PdfReadError",
    "PSSyntaxError",
    "PSEOF",
})

_CAUSE_CHAIN_LIMIT = 8


def exception_chain(error: BaseException) -> list[str]:
    """Nombres de clase de la excepcion y sus causas, de afuera hacia adentro.

    pdfplumber envuelve los errores de pdfminer en `PdfminerException`, asi que
    la causa real solo aparece bajando por la cadena.
    """
    names: list[str] = []
    current: BaseException | None = error
    seen: set[int] = set()
    while current is not None and len(names) < _CAUSE_CHAIN_LIMIT:
        if id(current) in seen:
            break
        seen.add(id(current))
        names.append(type(current).__name__)
        current = current.__cause__ or current.__context__
    return names


def classify_source_failure(error: BaseException) -> str:
    """Diagnostic code a nivel de fuente para un fallo de apertura/parseo.

    El orden importa: cifrado antes que no-soportado. Un PDF cifrado tambien
    falla al parsearse, pero decir `UNSUPPORTED_SOURCE` de el ocultaria la
    propiedad de la fuente que realmente explica el fallo.
    """
    names = set(exception_chain(error))
    if names & _ENCRYPTION_MARKERS:
        return ENCRYPTED_PDF
    if names & _UNSUPPORTED_MARKERS:
        return UNSUPPORTED_SOURCE
    return SOURCE_UNREADABLE


def read_with_pdfplumber(pdf_bytes: bytes) -> list[str | None]:
    import pdfplumber

    pages: list[str | None] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as document:
        for page in document.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                # Fallo con alcance de pagina. La observacion imperfecta es un
                # resultado: el documento sigue teniendo un espacio de
                # direcciones valido, esta pagina simplemente no aporta.
                pages.append(None)
    return pages


def read_with_pypdf(pdf_bytes: bytes) -> list[str | None]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages: list[str | None] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append(None)
    return pages


#: Orden de intento congelado: primario, despues fallback. La seleccion de
#: parser NUNCA puede depender del valor semantico del texto obtenido — eso
#: seria seleccion de evidencia por resultado. Depende solo de si el primario
#: logro producir un espacio de direcciones.
PARSER_CHAIN = (
    (PARSER_PDFPLUMBER, read_with_pdfplumber),
    (PARSER_PYPDF, read_with_pypdf),
)
