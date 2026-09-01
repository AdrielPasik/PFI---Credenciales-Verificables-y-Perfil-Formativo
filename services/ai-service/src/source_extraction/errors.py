"""Errores del extractor source-addressable de F0.

La linea de fallo congelada (diseño F0 §15) es:

    bytes legibles + identidad de fuente establecida
      -> la extraccion imperfecta PRODUCE artifact (coverage degradado)

    bytes ilegibles / identidad no establecible
      -> NO se produce artifact

Por eso estas condiciones son excepciones y no un `coverageStatus`: un artifact
con coverage FAILED y la ausencia de artifact son cosas distintas, y el llamador
no debe poder confundirlas por descuido.
"""

from __future__ import annotations


class SourceExtractionError(Exception):
    """Raiz de los fallos del extractor F0."""


class LocalSourceShaMismatch(SourceExtractionError):
    """Los bytes recibidos no son los que el llamador declaro.

    Chequeo LOCAL. No reemplaza la autoridad de dominio de NestJS (F0.5) ni
    establece pertenencia: solo garantiza que el artifact que FastAPI afirma
    haber producido esta criptograficamente ligado a los bytes que realmente
    proceso.
    """

    def __init__(self, *, declared: str, computed: str) -> None:
        super().__init__("LOCAL_SOURCE_SHA_MISMATCH")
        self.declared = declared
        self.computed = computed


class DependencyFingerprintUnavailable(SourceExtractionError):
    """Falta una dependencia exigida por la especificacion del fingerprint.

    El contrato prohibe inventar `UNKNOWN`, `null`, un hash ficticio u omitir la
    dependencia: sin las versiones exactas resueltas, la extraction identity no
    es atribuible, y un artifact con identidad no atribuible es peor que ninguno.
    """

    def __init__(self, package: str) -> None:
        super().__init__(f"DEPENDENCY_FINGERPRINT_UNAVAILABLE: {package}")
        self.package = package


class ProductNormalizationPreconditionViolated(SourceExtractionError):
    """El contenido recibido no es punto fijo de `PRODUCT_NFC_LINEENDINGS_TRIM`.

    Un artifact `TEXT` DECLARA `sourceNormalizationApplied =
    PRODUCT_NFC_LINEENDINGS_TRIM`. Si el contenido no viene ya en esa forma, esa
    declaracion seria falsa, asi que no se produce artifact en vez de producir
    uno que miente sobre su propia fuente.

    F0.3 no arregla la entrada normalizandola: el `sourceSha256` cubre la forma
    persistida, y normalizar despues del hash desalinearia el binding.

    `stage` nombra el paso que habria cambiado el texto. Nunca lleva el
    contenido, ni un fragmento, ni el caracter ofensor.
    """

    def __init__(self, stage: str) -> None:
        super().__init__(f"PRODUCT_NORMALIZATION_PRECONDITION_VIOLATED: {stage}")
        self.stage = stage


class ArtifactInvariantViolation(SourceExtractionError):
    """Un invariante local del artifact no se cumple.

    Es un bug del extractor, no una propiedad de la fuente. Se levanta antes de
    devolver nada para que un artifact "casi valido" no pueda salir del modulo.
    """


class CanonicalJsonError(SourceExtractionError):
    """Entrada no serializable bajo MINIMAL_DETERMINISTIC_JSON_V1."""
