"""
Cobertura de areas para los dominios reforzados en IA-Q1b.

No persigue "confident" a toda costa (esta prohibido forzar ese estado
bajando thresholds o inventando reglas ad-hoc para este slice). Verifica
en cambio la propiedad que SI importa para calidad de producto: que un
texto claramente perteneciente a un dominio reforzado (Comunicacion y
Humanidades, Costos y Contabilidad / Finanzas) resuelva a esa area
concreta -no a un area STEM no relacionada, ni siempre al mismo comodin
generico- y que produzca concepts reales.

Tambien documenta, con un test explicito, que dominios sin area_profiles
dedicado (Gestion y Negocios) todavia no resuelven a un area propia -- es
el comportamiento honesto esperado hasta que se decida crear esa area con
su anchor/context-group/family-gate correspondiente (IA-Q2), no un bug.
"""
from __future__ import annotations

from src.config_loader import load_config
from src.pipeline import process_single_input
from src.api.service import SETTINGS_PATH

UNRESOLVED_SENTINEL = "unresolved_domain_candidate"


def _semantic_final(source_name: str, manual_text: str) -> dict:
    config = load_config(SETTINGS_PATH)
    result = process_single_input(
        config=config,
        source_name=source_name,
        manual_text=manual_text,
    )
    return result.semantic_final


def test_communication_and_humanities_area_resolves_correctly() -> None:
    text = (
        "Objetivos\n"
        "Desarrollar competencias comunicacionales y humanisticas del "
        "estudiante a lo largo de la cursada.\n\n"
        "Contenidos minimos\n"
        "Pensamiento critico y analisis argumentativo de textos "
        "filosoficos. Lectura critica y comprension lectora de textos "
        "academicos. Produccion de textos y redaccion academica. "
        "Investigacion bibliografica sobre epistemologia y validez de "
        "argumentos. Etica aplicada y debate y argumentacion. "
        "Comunicacion efectiva y comunicacion asertiva en contextos "
        "institucionales.\n"
    )
    semantic_final = _semantic_final("humanidades-area.txt", text)
    areas = semantic_final.get("areas_detected") or []
    concepts = semantic_final.get("concepts_detected") or []

    assert "Comunicación y Humanidades" in areas
    assert UNRESOLVED_SENTINEL not in areas
    assert len(concepts) >= 4, f"se esperaba evidencia semantica rica, se obtuvo {concepts}"


def test_finance_and_accounting_area_resolves_correctly() -> None:
    text = (
        "Objetivos\n"
        "Formar competencias de analisis economico-financiero y control "
        "de gestion.\n\n"
        "Contenidos minimos\n"
        "Costos directos y costos indirectos. Costeo ABC y costeo ABM. "
        "Analisis financiero e interpretacion de estados financieros. "
        "Evaluacion de inversiones mediante valor actual neto y tasa "
        "interna de retorno. Presupuesto operativo y flujo de fondos. "
        "Control de gestion e indicadores de costos. Plan de cuentas y "
        "valuacion de inventarios.\n"
    )
    semantic_final = _semantic_final("finanzas-area.txt", text)
    areas = semantic_final.get("areas_detected") or []
    concepts = semantic_final.get("concepts_detected") or []

    assert "Costos y Contabilidad" in areas
    assert UNRESOLVED_SENTINEL not in areas
    assert len(concepts) >= 4, f"se esperaba evidencia semantica rica, se obtuvo {concepts}"


def test_area_resolution_does_not_collapse_unrelated_domains_into_the_same_area() -> None:
    """Un texto de Comunicacion/Humanidades y uno de Finanzas/Costos deben
    resolver a AREAS DISTINTAS, nunca a la misma area generica -- prueba
    directa de la regla "no hacer que todo caiga en una misma area
    generica"."""
    humanidades_text = (
        "Objetivos\nFormar competencias humanisticas.\n\n"
        "Contenidos minimos\n"
        "Pensamiento critico, comprension lectora y comunicacion efectiva. "
        "Etica aplicada y epistemologia.\n"
    )
    finanzas_text = (
        "Objetivos\nFormar competencias financieras.\n\n"
        "Contenidos minimos\n"
        "Costos directos, costos indirectos y costeo ABC. Plan de cuentas "
        "y valuacion.\n"
    )

    humanidades_areas = _semantic_final(
        "humanidades-vs-finanzas-a.txt", humanidades_text
    ).get("areas_detected") or []
    finanzas_areas = _semantic_final(
        "humanidades-vs-finanzas-b.txt", finanzas_text
    ).get("areas_detected") or []

    assert "Comunicación y Humanidades" in humanidades_areas
    assert "Costos y Contabilidad" in finanzas_areas
    assert set(humanidades_areas).isdisjoint(set(finanzas_areas))


def test_management_and_business_domain_has_no_dedicated_area_yet() -> None:
    """Documenta un limite conocido y deliberado de IA-Q1b: 'Gestion y
    Negocios' tiene skills (IA-Q1) y concepts (IA-Q1) pero NO tiene un
    area_profiles.json dedicado -- crear una area nueva requiere ademas
    anchors/context-group/family-gate (semantic_ontology.py) que este
    hardening conservador no toca. Un texto puramente de gestion/negocios
    generico (sin ninguna senal de otra area STEM ya existente) no debe
    resolver a un area falsa: debe quedar sin area confirmada
    (unresolved_domain_candidate) en vez de caer en un area no relacionada
    como "Gestion de Proyectos Tecnologicos" (que es especifica del curso
    de proyecto integrador final, no de gestion general)."""
    text = (
        "Objetivos\n"
        "Formar competencias de gestion aplicadas a proyectos y "
        "organizaciones.\n\n"
        "Contenidos minimos\n"
        "Gestion de proyectos y trabajo en equipo. Toma de decisiones y "
        "resolucion de problemas. Planificacion estrategica y mejora de "
        "procesos. Gestion organizacional.\n"
    )
    semantic_final = _semantic_final("gestion-sin-area.txt", text)
    areas = semantic_final.get("areas_detected") or []

    assert "Gestión de Proyectos Tecnológicos" not in areas, (
        "un texto de gestion generica no deberia caer en el area "
        "especifica del proyecto integrador final"
    )
