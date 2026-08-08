"""
Cobertura transversal de dominios para semantic_builder (IA-Q1 / IA-Q1b).

Usa textos academicos sinteticos y pequenos (no PDFs reales, no datasets de
EXTRACTOR MATERIAS) para validar dos cosas complementarias sobre la
taxonomia ampliada de config/semantic/*.json:

1. Casos POSITIVOS: cuando el texto trae evidencia real en una seccion
   curricular fuerte (minimum_contents_raw / contents_raw, ver
   CORE_CURRICULAR_SECTIONS en semantic_builder.py), las skills nuevas de
   dominios no-STEM (comunicacion, investigacion, gestion, finanzas, datos,
   diseno) SI se detectan, sin romper la deteccion STEM historica
   (control).

2. Casos NEGATIVOS (IA-Q1b): una mencion debil -solo en bibliografia, solo
   en objetivos sin contenidos, o una palabra suelta ambigua sin la frase
   completa- NO debe disparar ninguna de las skills nuevas. Esto ejercita
   directamente el hardening de IA-Q1b: las 41 skills nuevas se agregaron a
   MULTI_DOMAIN_SKILLS_REQUIRING_CORE_EVIDENCE, con el mismo gate que ya
   protegia a Python/SQL/Docker/etc. (evidencia en seccion curricular
   fuerte + modo de deteccion explicito, nunca solo semantic_match_local_*
   ni solo objectives_raw/course_name/keywords).

No mide perfeccion ni cobertura total del motor: solo que el gate de
evidencia fuerte se aplique de forma pareja a las skills nuevas.
"""
from __future__ import annotations

from src.config_loader import load_config
from src.pipeline import process_single_input
from src.api.service import SETTINGS_PATH


def _semantic_final(source_name: str, manual_text: str) -> dict:
    config = load_config(SETTINGS_PATH)
    result = process_single_input(
        config=config,
        source_name=source_name,
        manual_text=manual_text,
    )
    return result.semantic_final


def _skill_labels(semantic_final: dict) -> set[str]:
    return {
        item["skill_label"]
        for item in semantic_final.get("skills_detected", [])
        if isinstance(item, dict) and item.get("skill_label")
    }


def _concepts(semantic_final: dict) -> set[str]:
    return set(semantic_final.get("concepts_detected") or [])


# ─── Positivos: evidencia en seccion curricular fuerte ──────────────────────


def test_control_case_software_skills_still_detected() -> None:
    text = (
        "Objetivos\n"
        "Desarrollar programas aplicando estructuras de control.\n\n"
        "Contenidos minimos\n"
        "Programacion en Python. Consultas SQL sobre bases de datos. "
        "Uso de Git para control de versiones. Contenedores con Docker.\n"
    )
    semantic_final = _semantic_final("control-software.txt", text)
    skills = _skill_labels(semantic_final)

    assert {"Python", "SQL", "Git", "Docker"} <= skills


def test_communication_and_humanities_domain() -> None:
    text = (
        "Objetivos\n"
        "Desarrollar competencias comunicacionales y humanisticas del "
        "estudiante a lo largo de la cursada.\n\n"
        "Contenidos minimos\n"
        "Pensamiento critico y analisis argumentativo de textos "
        "filosoficos. Lectura critica y comprension lectora de textos "
        "academicos. Produccion de textos y redaccion academica. "
        "Investigacion bibliografica sobre epistemologia y validez de "
        "argumentos. Etica aplicada y debate y argumentacion.\n"
    )
    semantic_final = _semantic_final("humanidades.txt", text)
    skills = _skill_labels(semantic_final)
    concepts = _concepts(semantic_final)

    expected_skills = {
        "Pensamiento Crítico",
        "Lectura Crítica",
        "Comunicación Escrita",
        "Análisis Argumentativo",
        "Debate y Argumentación",
        "Producción de Textos",
        "Investigación Bibliográfica",
        "Ética Aplicada",
    }
    assert expected_skills <= skills, f"missing: {expected_skills - skills}"
    assert concepts, "no concept detected for a humanities-heavy text"


def test_research_and_social_sciences_domain() -> None:
    text = (
        "Objetivos\n"
        "Formar competencias de investigacion aplicada a problemas "
        "sociales.\n\n"
        "Contenidos minimos\n"
        "Diseno metodologico aplicado a la metodologia de investigacion. "
        "Marco teorico y relevamiento de informacion. Revision "
        "bibliografica. Analisis cualitativo y analisis cuantitativo de "
        "datos. Elaboracion de informes y estudio de casos. Diseno de "
        "instrumentos de recoleccion.\n"
    )
    semantic_final = _semantic_final("investigacion.txt", text)
    skills = _skill_labels(semantic_final)

    expected_skills = {
        "Metodología de Investigación",
        "Análisis Cualitativo",
        "Análisis Cuantitativo",
        "Elaboración de Informes",
        "Análisis de Casos",
        "Diseño de Instrumentos",
    }
    assert expected_skills <= skills, f"missing: {expected_skills - skills}"


def test_management_and_business_domain() -> None:
    text = (
        "Objetivos\n"
        "Formar competencias de gestion aplicadas a proyectos y "
        "organizaciones.\n\n"
        "Contenidos minimos\n"
        "Gestion de proyectos y trabajo en equipo. Toma de decisiones y "
        "resolucion de problemas. Planificacion estrategica y mejora de "
        "procesos. Gestion organizacional.\n"
    )
    semantic_final = _semantic_final("gestion.txt", text)
    skills = _skill_labels(semantic_final)

    expected_skills = {
        "Gestión de Proyectos",
        "Trabajo en Equipo",
        "Toma de Decisiones",
        "Resolución de Problemas",
        "Planificación Estratégica",
        "Gestión Organizacional",
    }
    assert expected_skills <= skills, f"missing: {expected_skills - skills}"


def test_finance_and_administration_domain() -> None:
    text = (
        "Objetivos\n"
        "Formar competencias de analisis economico-financiero.\n\n"
        "Contenidos minimos\n"
        "Analisis financiero e interpretacion de estados financieros. "
        "Evaluacion de inversiones mediante valor actual neto y tasa "
        "interna de retorno. Presupuestacion y elaboracion de "
        "presupuestos. Control de gestion e indicadores de gestion. "
        "Analisis de costos y costeo abc.\n"
    )
    semantic_final = _semantic_final("finanzas.txt", text)
    skills = _skill_labels(semantic_final)

    expected_skills = {
        "Análisis Financiero",
        "Evaluación de Inversiones",
        "Presupuestación",
        "Control de Gestión",
        "Análisis de Costos",
    }
    assert expected_skills <= skills, f"missing: {expected_skills - skills}"


def test_data_and_technology_domain_gap_fill() -> None:
    text = (
        "Objetivos\n"
        "Formar competencias de manejo y analisis de informacion "
        "digital.\n\n"
        "Contenidos minimos\n"
        "Modelado de bases de datos y diseno de bases de datos "
        "relacionales. Analisis de datos y ciencia de datos. Testing de "
        "software y pruebas unitarias. Integracion continua y despliegue "
        "continuo con DevOps.\n"
    )
    semantic_final = _semantic_final("datos.txt", text)
    skills = _skill_labels(semantic_final)

    expected_skills = {
        "Bases de Datos",
        "Análisis de Datos",
        "Testing de Software",
        "DevOps",
    }
    assert expected_skills <= skills, f"missing: {expected_skills - skills}"


def test_design_and_product_domain() -> None:
    text = (
        "Objetivos\n"
        "Formar competencias de diseno de producto orientadas al "
        "usuario final.\n\n"
        "Contenidos minimos\n"
        "Diseno centrado en el usuario e investigacion de usuarios. "
        "Prototipado y evaluacion de usabilidad. Diseno de interfaces y "
        "comunicacion visual.\n"
    )
    semantic_final = _semantic_final("diseno.txt", text)
    skills = _skill_labels(semantic_final)

    expected_skills = {
        "Diseño Centrado en Usuario",
        "Investigación de Usuarios",
        "Prototipado",
        "Evaluación de Usabilidad",
        "Diseño de Interfaces",
        "Comunicación Visual",
    }
    assert expected_skills <= skills, f"missing: {expected_skills - skills}"


# ─── Negativos (IA-Q1b): evidencia debil NO debe disparar skills ───────────


def test_bibliography_only_mention_does_not_trigger_skill() -> None:
    """La bibliografia es una seccion irrelevante (irrelevant_section_patterns
    en config/settings.json): section_detector.py nunca la incorpora a
    raw_sections. Una skill mencionada solo ahi no debe detectarse, aunque
    el resto del curso si tenga evidencia real de otra skill de control."""
    text = (
        "Objetivos\n"
        "Desarrollar competencias basicas de programacion.\n\n"
        "Contenidos minimos\n"
        "Variables, estructuras de control y funciones en Python.\n\n"
        "Bibliografia\n"
        "Bibliografia sobre comunicacion oral y tecnicas de presentacion "
        "efectiva.\n"
    )
    semantic_final = _semantic_final("solo-bibliografia.txt", text)
    skills = _skill_labels(semantic_final)

    assert "Python" in skills, "el control STEM con evidencia real debe seguir detectandose"
    assert "Comunicación Oral" not in skills, (
        "una mencion solo en bibliografia (seccion irrelevante) no debe "
        f"disparar la skill, pero se detecto: {skills}"
    )


def test_objectives_only_mention_without_core_content_does_not_trigger_skill() -> None:
    """objectives_raw no es una CORE_CURRICULAR_SECTION. Una skill nueva
    mencionada solo en objetivos, sin ningun respaldo en contenidos, no debe
    pasar el gate de evidencia fuerte (mismo criterio que ya se le exige a
    Python/SQL/Docker historicamente)."""
    text = (
        "Objetivos\n"
        "Fomentar la gestion de proyectos y la toma de decisiones como "
        "actitud transversal en el aula.\n\n"
        "Contenidos minimos\n"
        "Fundamentos de programacion: variables, tipos de datos y "
        "estructuras de control en Python.\n"
    )
    semantic_final = _semantic_final("solo-objetivos.txt", text)
    skills = _skill_labels(semantic_final)

    assert "Python" in skills, "el control STEM con evidencia en contenidos debe seguir detectandose"
    assert "Gestión de Proyectos" not in skills, (
        "una mencion solo en objetivos, sin evidencia en contenidos, no "
        f"debe disparar la skill, pero se detecto: {skills}"
    )
    assert "Toma de Decisiones" not in skills, (
        "una mencion solo en objetivos, sin evidencia en contenidos, no "
        f"debe disparar la skill, pero se detecto: {skills}"
    )


def test_ambiguous_single_word_without_full_phrase_does_not_trigger_skill() -> None:
    """Ninguna skill nueva depende de una palabra suelta como "analisis" o
    "gestion": todos los patrones son frases de 2+ palabras especificas. Un
    texto que solo usa esas palabras sueltas, sin la frase completa que
    identifica a una skill concreta, no debe disparar ninguna."""
    text = (
        "Objetivos\n"
        "Desarrollar capacidades generales de analisis y gestion en el "
        "estudiante.\n\n"
        "Contenidos minimos\n"
        "Analisis de sistemas y gestion basica de la informacion "
        "institucional, sin profundizar en tecnicas o herramientas "
        "especificas de ningun dominio.\n"
    )
    semantic_final = _semantic_final("palabra-suelta.txt", text)
    skills = _skill_labels(semantic_final)

    ambiguous_prone_skills = {
        "Análisis Financiero",
        "Análisis Cualitativo",
        "Análisis Cuantitativo",
        "Análisis de Datos",
        "Análisis de Casos",
        "Análisis de Costos",
        "Análisis Argumentativo",
        "Gestión de Proyectos",
        "Gestión Organizacional",
        "Control de Gestión",
    }
    triggered = ambiguous_prone_skills & skills
    assert not triggered, (
        "una palabra suelta ambigua ('analisis'/'gestion') sin la frase "
        f"completa no deberia disparar ninguna skill, pero se detecto: {triggered}"
    )
