import json
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple


EXTENDED_AREA_PROFILES: Dict[str, Dict[str, List[str]]] = {
    "Termodinámica y Transferencia de Calor": {
        "strong": ["termodinamica", "termodinámica", "transferencia de calor", "ciclos térmicos", "ciclos termicos"],
        "medium": ["entalpia", "entalpía", "entropia", "entropía", "conduccion", "conveccion", "radiacion", "calorimetria"],
        "light": ["intercambiadores", "balance de energia", "balance de energía", "difusion termica", "difusión térmica"],
    },
    "Resistencia de Materiales y Mecánica del Sólido": {
        "strong": ["resistencia de materiales", "mecanica del solido", "mecánica del sólido", "esfuerzos", "deformaciones"],
        "medium": ["fatiga", "fractura", "elasticidad", "plasticidad", "estabilidad estructural", "diagramas de fase"],
        "light": ["torsion", "torsión", "flexion", "flexión", "pandeo"],
    },
    "Automatización y Control Industrial": {
        "strong": ["automatizacion industrial", "automatización industrial", "control industrial", "control automatico", "control automático"],
        "medium": ["pid", "realimentacion", "realimentación", "instrumentacion", "instrumentación", "plc", "scada"],
        "light": ["sensores", "actuadores", "lazo cerrado", "sintonizacion", "sintonización"],
    },
    "Robótica y Sistemas Autónomos": {
        "strong": ["robotica", "robótica", "sistemas autonomos", "sistemas autónomos"],
        "medium": ["cinematica", "cinemática", "planificacion de trayectorias", "planificación de trayectorias", "control de robots"],
        "light": ["vision artificial", "visión artificial", "slam", "navegacion autonoma", "navegación autónoma"],
    },
    "Manufactura y CAD/CAM": {
        "strong": ["manufactura", "cad", "cam", "prototipado", "manufactura aditiva"],
        "medium": ["mecanizado", "impresion 3d", "impresión 3d", "tolerancias", "metrologia"],
        "light": ["diseño para manufactura", "diseño para ensamble", "proceso de fabricacion", "proceso de fabricación"],
    },
    "Logística y Cadena de Abastecimiento": {
        "strong": ["logistica", "logística", "cadena de abastecimiento", "supply chain"],
        "medium": ["inventarios", "mrp", "layout", "distribucion", "distribución", "transporte"],
        "light": ["pronostico de demanda", "pronóstico de demanda", "almacenamiento", "ultima milla", "última milla"],
    },
    "Gestión de Operaciones y Calidad Industrial": {
        "strong": ["gestion de operaciones", "gestión de operaciones", "control de produccion", "control de producción", "calidad industrial"],
        "medium": ["productividad", "balance de linea", "balance de línea", "tiempos y movimientos", "costos de no calidad"],
        "light": ["mejora continua", "lean", "seis sigma", "capacidad de proceso"],
    },
    "Química Orgánica y Biológica": {
        "strong": ["quimica organica", "química orgánica", "quimica biologica", "química biológica"],
        "medium": ["enlace covalente", "orbitales", "grupos funcionales", "biomoleculas", "biomoléculas"],
        "light": ["reacciones organicas", "reacciones orgánicas", "isomeria", "isomería"],
    },
    "Fisicoquímica y Química Analítica": {
        "strong": ["fisicoquimica", "fisicoquímica", "quimica analitica", "química analítica"],
        "medium": ["equilibrio acido base", "equilibrio ácido-base", "buffers", "calorimetria", "cromatografia", "espectrofotometria"],
        "light": ["electroquimica", "electroquímica", "titulacion", "titulación", "analisis instrumental", "análisis instrumental"],
    },
    "Bromatología y Nutrición": {
        "strong": ["bromatologia", "bromatología", "nutricion", "nutrición", "toxicologia alimentaria", "toxicología alimentaria"],
        "medium": ["composicion de alimentos", "composición de alimentos", "etiquetado nutricional", "inocuidad alimentaria"],
        "light": ["perfil sensorial", "evaluacion sensorial", "evaluación sensorial", "fortificacion", "fortificación"],
    },
    "Instrumentación y Mediciones": {
        "strong": ["instrumentacion", "instrumentación", "mediciones", "metrologia", "metrología"],
        "medium": ["incertidumbre", "calibracion", "calibración", "sensores", "adquisicion de datos", "adquisición de datos"],
        "light": ["error sistematico", "error sistemático", "trazabilidad", "resolucion", "resolución"],
    },
    "Antenas, Propagación y Microondas": {
        "strong": ["antenas", "microondas", "rf", "propagacion electromagnetica", "propagación electromagnética"],
        "medium": ["lineas de transmision", "líneas de transmisión", "fibras opticas", "fibras ópticas", "guia de ondas", "guía de ondas", "enlaces de microondas", "comunicacion satelital", "comunicación satelital"],
        "light": ["patron de radiacion", "patrón de radiación", "impedancia de antena", "perdidas de propagacion", "pérdidas de propagación"],
    },
    "Recursos Hídricos y Gestión Ambiental": {
        "strong": ["recursos hidricos", "recursos hídricos", "gestion ambiental", "gestión ambiental", "impacto ambiental"],
        "medium": ["evaluacion de impacto", "evaluación de impacto", "remediacion", "remediación", "residuos", "calidad de agua"],
        "light": ["biodiversidad", "ecosistemas acuaticos", "ecosistemas acuáticos", "huella hidrica", "huella hídrica"],
    },
    "Agro y Producción Agropecuaria": {
        "strong": ["produccion agropecuaria", "producción agropecuaria", "agroindustrias", "agricultura"],
        "medium": ["suelos", "riego", "agricultura de precision", "agricultura de precisión", "sig"],
        "light": ["fertilidad", "erosion", "erosión", "manejo de cultivos", "ecosistemas"],
    },
    "Diseño y Desarrollo de Videojuegos": {
        "strong": ["videojuegos", "game design", "diseño de videojuegos", "diseno de videojuegos", "programacion grafica", "programación gráfica"],
        "medium": ["level design", "narrativa interactiva", "motores graficos", "motores gráficos", "renderizado", "animacion 2d", "animación 2d", "animacion 3d", "animación 3d"],
        "light": ["ux", "ui", "arte digital", "sonido interactivo", "fisicas", "físicas"],
    },
}


EXTENDED_DOMAIN_CONCEPT_LEXICON: Dict[str, List[str]] = {
    "Arquitectura y Organización de Computadores": ["CPU", "ALU", "caché", "DMA", "paginación", "segmentación", "memoria virtual", "sincronización", "ensamblador"],
    "Algoritmos y Estructuras de Datos": ["TDA", "pila", "cola", "ABB", "AVL", "grafo", "complejidad", "punteros", "memoria dinámica", "procesos", "hilos"],
    "Ingeniería de Software": ["UML", "requerimientos funcionales", "requerimientos no funcionales", "trazabilidad", "validación", "elicitación", "testing", "arquitectura de software"],
    "Comunicación y Humanidades": ["epistemología", "lógica proposicional", "lógica de predicados", "validez", "falacias", "inducción", "deducción", "argumentación", "ética deontológica", "utilitarismo", "relativismo moral", "filosofía", "axiología"],
    "Termodinámica y Transferencia de Calor": ["termodinámica", "entalpía", "entropía", "ciclos térmicos", "transferencia de calor", "conducción", "convección", "radiación"],
    "Resistencia de Materiales y Mecánica del Sólido": ["fatiga", "fractura", "esfuerzos", "deformaciones", "elasticidad", "plasticidad", "estabilidad estructural", "diagramas de fase"],
    "Automatización y Control Industrial": ["PID", "PLC", "SCADA", "realimentación", "lazo cerrado", "instrumentación", "sensores", "actuadores"],
    "Robótica y Sistemas Autónomos": ["robótica", "cinemática", "planificación de trayectorias", "visión artificial", "SLAM", "navegación autónoma"],
    "Manufactura y CAD/CAM": ["CAD", "CAM", "prototipado", "manufactura aditiva", "impresión 3D", "mecanizado", "metrología"],
    "Logística y Cadena de Abastecimiento": ["supply chain", "cadena de abastecimiento", "inventarios", "MRP", "layout", "programación de la producción", "balance de línea"],
    "Gestión de Operaciones y Calidad Industrial": ["productividad", "control de producción", "costos de no calidad", "tiempos y movimientos", "lean", "seis sigma"],
    "Química Orgánica y Biológica": ["enlace covalente", "orbitales", "química orgánica", "química biológica", "grupos funcionales", "biomoléculas"],
    "Fisicoquímica y Química Analítica": ["equilibrio ácido-base", "buffers", "calorimetría", "cinética", "reacciones redox", "espectrofotometría", "cromatografía"],
    "Bromatología y Nutrición": ["bromatología", "toxicología alimentaria", "nutrición", "composición de alimentos", "evaluación sensorial"],
    "Instrumentación y Mediciones": ["instrumentación", "mediciones", "metrología", "calibración", "incertidumbre", "adquisición de datos"],
    "Antenas, Propagación y Microondas": ["modulación digital", "codificación", "canales", "antenas", "propagación electromagnética", "microondas", "fibras ópticas", "enlaces de microondas", "comunicación satelital"],
    "Recursos Hídricos y Gestión Ambiental": ["recursos hídricos", "impacto ambiental", "biodiversidad", "ecosistemas acuáticos", "remediación", "evaluación de impacto ambiental"],
    "Agro y Producción Agropecuaria": ["suelos", "riego", "agricultura de precisión", "SIG", "producción agropecuaria", "agroindustrias"],
    "Diseño y Desarrollo de Videojuegos": ["game design", "level design", "narrativa interactiva", "UX", "UI", "motores gráficos", "renderizado", "animación 2D/3D", "sonido interactivo"],
    "Microbiología": ["HACCP", "GMP", "GLP", "coliformes", "Salmonella", "Listeria", "micotoxinas", "actividad de agua", "pH", "patógenos"],
    "Estadística": ["ANOVA", "estimadores", "intervalo de predicción", "tamaño muestral", "potencia estadística", "Fisher-Snedecor", "regresión múltiple"],
    "Electrotecnia y Circuitos Eléctricos": ["Kirchhoff", "Thevenin", "Norton", "impedancia", "potencia reactiva", "circuitos trifásicos", "Faraday", "Joule"],
}


EXTENDED_NAME_AREA_HINTS: Dict[str, List[str]] = {
    "fundamentos de informatica": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "fundamentos de informática": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "introduccion a la programacion": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "introducción a la programación": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programacion i": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programación i": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programacion ii": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programación ii": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programacion iii": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programación iii": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programacion avanzada": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programación avanzada": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "ingenieria de requerimientos": ["Ingeniería de Software"],
    "ingeniería de requerimientos": ["Ingeniería de Software"],
    "algoritmos y estructuras de datos": ["Algoritmos y Estructuras de Datos", "Ingeniería de Software"],
    "estructura de datos": ["Algoritmos y Estructuras de Datos"],
    "sistemas operativos": ["Arquitectura y Organización de Computadores", "Ingeniería de Software"],
    "arquitectura y sistemas operativos": ["Arquitectura y Organización de Computadores", "Ingeniería de Software"],
    "termodinamica": ["Termodinámica y Transferencia de Calor"],
    "termodinámica": ["Termodinámica y Transferencia de Calor"],
    "transferencia de calor": ["Termodinámica y Transferencia de Calor"],
    "resistencia de materiales": ["Resistencia de Materiales y Mecánica del Sólido"],
    "mecanica del solido": ["Resistencia de Materiales y Mecánica del Sólido"],
    "mecánica del sólido": ["Resistencia de Materiales y Mecánica del Sólido"],
    "automatizacion y control": ["Automatización y Control Industrial"],
    "automatización y control": ["Automatización y Control Industrial"],
    "robotica": ["Robótica y Sistemas Autónomos"],
    "robótica": ["Robótica y Sistemas Autónomos"],
    "manufactura": ["Manufactura y CAD/CAM"],
    "cad": ["Manufactura y CAD/CAM"],
    "cam": ["Manufactura y CAD/CAM"],
    "logistica": ["Logística y Cadena de Abastecimiento"],
    "logística": ["Logística y Cadena de Abastecimiento"],
    "cadena de abastecimiento": ["Logística y Cadena de Abastecimiento"],
    "quimica organica": ["Química Orgánica y Biológica"],
    "química orgánica": ["Química Orgánica y Biológica"],
    "fisicoquimica": ["Fisicoquímica y Química Analítica"],
    "fisicoquímica": ["Fisicoquímica y Química Analítica"],
    "quimica analitica": ["Fisicoquímica y Química Analítica"],
    "química analítica": ["Fisicoquímica y Química Analítica"],
    "bromatologia": ["Bromatología y Nutrición"],
    "bromatología": ["Bromatología y Nutrición"],
    "nutricion": ["Bromatología y Nutrición"],
    "nutrición": ["Bromatología y Nutrición"],
    "instrumentacion": ["Instrumentación y Mediciones"],
    "instrumentación": ["Instrumentación y Mediciones"],
    "antenas": ["Antenas, Propagación y Microondas"],
    "microondas": ["Antenas, Propagación y Microondas"],
    "recursos hidricos": ["Recursos Hídricos y Gestión Ambiental"],
    "recursos hídricos": ["Recursos Hídricos y Gestión Ambiental"],
    "gestion ambiental": ["Recursos Hídricos y Gestión Ambiental"],
    "gestión ambiental": ["Recursos Hídricos y Gestión Ambiental"],
    "agricultura de precision": ["Agro y Producción Agropecuaria"],
    "agricultura de precisión": ["Agro y Producción Agropecuaria"],
    "agro": ["Agro y Producción Agropecuaria"],
    "videojuegos": ["Diseño y Desarrollo de Videojuegos"],
    "game design": ["Diseño y Desarrollo de Videojuegos"],
    "programacion grafica": ["Diseño y Desarrollo de Videojuegos"],
    "programación gráfica": ["Diseño y Desarrollo de Videojuegos"],
}


EXTENDED_AREA_ANCHORS: Dict[str, List[str]] = {
    "Arquitectura y Organización de Computadores": ["arquitectura de computadores", "cpu", "alu", "memoria cache", "ensamblador"],
    "Algoritmos y Estructuras de Datos": ["algoritmos", "estructuras de datos", "tda", "pila", "cola"],
    "Ingeniería de Software": ["ingenieria de software", "desarrollo de software", "uml", "testing", "requerimientos"],
    "Comunicación y Humanidades": ["pensamiento critico", "argumentacion", "epistemologia", "logica proposicional", "etica deontologica"],
    "Termodinámica y Transferencia de Calor": ["termodinamica", "transferencia de calor", "entalpia", "entropia"],
    "Resistencia de Materiales y Mecánica del Sólido": ["resistencia de materiales", "esfuerzos", "deformaciones"],
    "Automatización y Control Industrial": ["control industrial", "pid", "plc", "scada"],
    "Robótica y Sistemas Autónomos": ["robotica", "cinematica", "vision artificial", "slam"],
    "Manufactura y CAD/CAM": ["cad", "cam", "manufactura", "prototipado"],
    "Logística y Cadena de Abastecimiento": ["logistica", "cadena de abastecimiento", "supply chain", "inventarios"],
    "Fisicoquímica y Química Analítica": ["fisicoquimica", "quimica analitica", "cromatografia", "espectrofotometria"],
    "Bromatología y Nutrición": ["bromatologia", "nutricion", "toxicologia alimentaria"],
    "Antenas, Propagación y Microondas": ["antenas", "microondas", "rf", "propagacion electromagnetica", "propagación electromagnética", "satelital"],
    "Recursos Hídricos y Gestión Ambiental": ["recursos hidricos", "impacto ambiental", "remediacion"],
    "Agro y Producción Agropecuaria": ["suelos", "riego", "agricultura de precision", "sig"],
    "Diseño y Desarrollo de Videojuegos": ["game design", "motores graficos", "renderizado", "ux", "ui"],
    # IA-Q1b (hardening): "gestion de proyectos"/"cronograma"/"riesgos" son
    # demasiado genericos como anchor -- cualquier curso de gestion/negocios
    # generico (dominio nuevo de IA-Q1, sin area_profiles propia) los
    # contiene y terminaba resolviendo falsamente a esta area, que en
    # realidad es especifica del curso de proyecto integrador final (PFI).
    # Se tightening a anchors que si son distintivos de ESE curso puntual.
    # "gestion de proyectos" sigue funcionando como keyword de scoring
    # normal (area_profiles.json strong), solo se retira como ANCHOR.
    "Gestión de Proyectos Tecnológicos": ["proyecto integrador final", "defensa oral", "normativa e instructivo de pfi", "gestion del alcance del proyecto"],
}


EXTENDED_AREA_CONTEXT_GROUP: Dict[str, str] = {
    "Arquitectura y Organización de Computadores": "software",
    "Sistemas Digitales y Hardware": "software",
    "Termodinámica y Transferencia de Calor": "mechanical",
    "Resistencia de Materiales y Mecánica del Sólido": "mechanical",
    "Automatización y Control Industrial": "industrial_automation",
    "Robótica y Sistemas Autónomos": "industrial_automation",
    "Manufactura y CAD/CAM": "mechanical",
    "Logística y Cadena de Abastecimiento": "industrial_operations",
    "Gestión de Operaciones y Calidad Industrial": "industrial_operations",
    "Química Orgánica y Biológica": "chemistry",
    "Fisicoquímica y Química Analítica": "chemistry",
    "Bromatología y Nutrición": "food_sciences",
    "Instrumentación y Mediciones": "electrical",
    "Antenas, Propagación y Microondas": "telecom_advanced",
    "Recursos Hídricos y Gestión Ambiental": "environmental",
    "Agro y Producción Agropecuaria": "agro",
    "Diseño y Desarrollo de Videojuegos": "interactive_media",
}


EXTENDED_INCOMPATIBLE_CONTEXT_GROUPS: Set[frozenset[str]] = {
    frozenset({"interactive_media", "chemistry"}),
    frozenset({"interactive_media", "life_sciences"}),
    frozenset({"agro", "interactive_media"}),
    frozenset({"telecom_advanced", "food_sciences"}),
}


EXTENDED_SKILL_EVIDENCE_PATTERNS: Dict[str, List[str]] = {
    "Unreal": ["unreal engine", "unreal"],
    "Unity": ["unity", "unity3d"],
    "MATLAB": ["matlab"],
    "LabVIEW": ["labview"],
    # Fase 2B (multi-dominio, ver reports/pdf_skills_coverage_patch_v1_review.md):
    # patterns elegidos con evidencia real en output_json/ y controles negativos
    # explicitos (ej. 'cultivo' solo -> colisiona con cultivo agropecuario; se usa
    # 'cultivo celular' para evitarlo). Todas requieren evidencia en seccion
    # curricular fuerte -- ver SKILLS_REQUIRING_CORE_EVIDENCE en semantic_builder.py.
    "Scrum": ["scrum"],
    "UML": ["uml", "lenguaje unificado de modelado"],
    "Machine Learning": ["machine learning", "aprendizaje automatico"],
    "PCR": ["pcr", "reaccion en cadena de la polimerasa"],
    "Electroforesis": ["electroforesis"],
    "Cultivo Celular": ["cultivo celular", "cultivo de celulas", "cultivos celulares"],
    "Esterilización": ["esterilizacion"],
    "Cromatografía": ["cromatografia"],
    "Osciloscopio": ["osciloscopio"],
    "Microcontroladores": ["microcontrolador", "microcontroladores"],
    "VHDL": ["vhdl"],
    "AutoCAD": ["autocad"],
    "SolidWorks": ["solidworks"],
    "Six Sigma": ["six sigma"],
    "Control Estadístico de Procesos": ["control estadistico de procesos", "control estadistico de proceso"],
    "Evaluación de Impacto Ambiental": ["evaluacion de impacto ambiental", "estudio de impacto ambiental"],
}


EXTENDED_CONCEPT_CANONICAL_PATTERNS: List[Tuple[str, str]] = [
    ("termodinamica", "termodinámica"),
    ("entalpia", "entalpía"),
    ("entropia", "entropía"),
    ("transferencia de calor", "transferencia de calor"),
    ("conduccion", "conducción"),
    ("conveccion", "convección"),
    ("radiacion", "radiación"),
    ("esfuerzos", "esfuerzos"),
    ("deformaciones", "deformaciones"),
    ("fatiga", "fatiga"),
    ("fractura", "fractura"),
    ("diagramas de fase", "diagramas de fase"),
    ("pid", "PID"),
    ("plc", "PLC"),
    ("scada", "SCADA"),
    ("instrumentacion", "instrumentación"),
    ("metrologia", "metrología"),
    ("calibracion", "calibración"),
    ("modulacion digital", "modulación digital"),
    ("codificacion", "codificación"),
    ("antenas", "antenas"),
    ("propagacion", "propagación"),
    ("microondas", "microondas"),
    ("fibras opticas", "fibras ópticas"),
    ("supply chain", "supply chain"),
    ("cadena de abastecimiento", "cadena de abastecimiento"),
    ("mrp", "MRP"),
    ("balance de linea", "balance de línea"),
    ("enlace covalente", "enlace covalente"),
    ("enlace ionico", "enlace iónico"),
    ("orbitales", "orbitales"),
    ("equilibrio acido base", "equilibrio ácido-base"),
    ("buffers", "buffers"),
    ("calorimetria", "calorimetría"),
    ("reacciones redox", "reacciones redox"),
    ("espectrofotometria", "espectrofotometría"),
    ("cromatografia", "cromatografía"),
    ("biorreactores", "biorreactores"),
    ("ingenieria metabolica", "ingeniería metabólica"),
    ("cultivos celulares", "cultivos celulares"),
    ("diagnostico molecular", "diagnóstico molecular"),
    ("agricultura de precision", "agricultura de precisión"),
    ("sig", "SIG"),
    ("game design", "game design"),
    ("level design", "level design"),
    ("narrativa interactiva", "narrativa interactiva"),
    ("motores graficos", "motores gráficos"),
    ("renderizado", "renderizado"),
    ("animacion", "animación"),
    ("sonido interactivo", "sonido interactivo"),
]


EXTENDED_PAIR_PRIORITY: Dict[str, str] = {
    "Termodinámica y Transferencia de Calor": "Mecánica de Fluidos y Termofluidos",
    "Resistencia de Materiales y Mecánica del Sólido": "Manufactura y CAD/CAM",
    "Automatización y Control Industrial": "Instrumentación y Mediciones",
    "Robótica y Sistemas Autónomos": "Automatización y Control Industrial",
    "Logística y Cadena de Abastecimiento": "Gestión de Operaciones y Calidad Industrial",
    "Química Orgánica y Biológica": "Fisicoquímica y Química Analítica",
    "Bromatología y Nutrición": "Tecnología de Alimentos",
    "Antenas, Propagación y Microondas": "Telecomunicaciones de Datos",
    "Recursos Hídricos y Gestión Ambiental": "Ambiente y Sostenibilidad",
    "Agro y Producción Agropecuaria": "Recursos Hídricos y Gestión Ambiental",
    "Diseño y Desarrollo de Videojuegos": "Ingeniería de Software",
}


EXTENDED_APPLIED_PRIORITY_AREAS: Set[str] = {
    "Termodinámica y Transferencia de Calor",
    "Resistencia de Materiales y Mecánica del Sólido",
    "Automatización y Control Industrial",
    "Robótica y Sistemas Autónomos",
    "Manufactura y CAD/CAM",
    "Logística y Cadena de Abastecimiento",
    "Gestión de Operaciones y Calidad Industrial",
    "Química Orgánica y Biológica",
    "Fisicoquímica y Química Analítica",
    "Bromatología y Nutrición",
    "Instrumentación y Mediciones",
    "Antenas, Propagación y Microondas",
    "Recursos Hídricos y Gestión Ambiental",
    "Agro y Producción Agropecuaria",
    "Diseño y Desarrollo de Videojuegos",
}


EXTENDED_CORE_EXACT_DOMAIN_AREAS: Set[str] = set(EXTENDED_AREA_PROFILES.keys())


EXTENDED_CONTEXT_GENERIC_BLOCKLIST: Dict[str, Set[str]] = {
    "mechanical": {"base", "control", "funciones", "conjuntos", "matrices"},
    "industrial_operations": {"funciones", "base", "matrices", "conjuntos"},
    "chemistry": {"control", "funciones", "base", "conjuntos", "matrices"},
    "food_sciences": {"control", "funciones", "base", "conjuntos", "matrices"},
    "environmental": {"funciones", "base", "matrices", "conjuntos"},
    "agro": {"funciones", "base", "matrices", "conjuntos"},
    "interactive_media": {"control", "base", "conjuntos", "matrices"},
    "telecom_advanced": {"funciones", "base", "conjuntos", "matrices"},
    "humanities": {"control", "funciones", "base", "matrices", "conjuntos", "optimizacion", "simulacion", "mecatronica"},
}


DOMAIN_FAMILY_BY_CONTEXT_GROUP: Dict[str, str] = {
    "software": "software_family",
    "humanities": "generic_academic_family",
    "networks": "telecom_family",
    "telecom_advanced": "telecom_family",
    "electrical": "electrical_family",
    "fluids": "mechanical_family",
    "mechanical": "mechanical_family",
    "physics_foundational": "physical_sciences_family",
    "chemistry": "chemical_family",
    "chemistry_foundational": "chemical_family",
    "statistics": "mathematical_family",
    "math_foundational": "mathematical_family",
    "life_sciences": "life_sciences_family",
    "food_sciences": "life_sciences_family",
    "industrial_costs": "industrial_family",
    "industrial_operations": "industrial_family",
    "industrial_automation": "industrial_family",
    "legal_regulatory": "legal_management_family",
    "environmental": "environmental_family",
    "agro": "agro_family",
    "interactive_media": "interactive_media_family",
    "mathematical_modeling": "mathematical_family",
    "representation_graphics": "mechanical_family",
}


DOMAIN_FAMILY_HINTS: Dict[str, List[str]] = {
    "software_family": ["programacion", "programación", "software", "algoritmos", "estructuras de datos", "requerimientos", "sistemas operativos", "bases de datos", "ingenieria de datos", "ingeniería de datos", "arquitectura de software", "arquitectura de aplicaciones", "uml", "sql", "testing", "microservicios", "pipeline", "ciberseguridad", "seguridad informatica", "seguridad informática"],
    "generic_academic_family": ["etica", "ética", "filosofia", "filosofía", "pensamiento critico", "pensamiento crítico", "argumentacion", "argumentación", "comunicacion", "comunicación", "epistemologia", "epistemología"],
    "mechanical_family": ["mecanica", "termodinamica", "materiales", "manufactura", "cad", "cam"],
    "mathematical_family": ["algebra", "cálculo", "calculo", "probabilidad", "estadistica", "simulacion", "optimización", "ecuaciones diferenciales"],
    "life_sciences_family": ["biotecnologia", "microbiologia", "genomica", "proteomica", "alimentos", "biorreactores"],
    "industrial_family": ["produccion", "logistica", "operaciones", "calidad", "inventarios", "supply chain"],
    "environmental_family": ["ambiente", "impacto ambiental", "remediacion", "residuos", "recursos hidricos", "desarrollo sustentable", "desarrollo sostenible", "sustentabilidad", "sostenibilidad", "agenda 2030", "triple impacto", "economia ecologica", "economía ecológica", "servicios ambientales"],
    "interactive_media_family": ["videojuegos", "ux", "ui", "narrativa interactiva", "renderizado", "arte digital"],
    "chemical_family": ["quimica", "fisicoquimica", "quimica analitica", "orbitales", "cromatografia"],
    "telecom_family": ["telecomunicaciones", "señales y sistemas", "senales y sistemas", "antenas", "microondas", "modulacion", "modulación", "propagacion", "propagación", "codificacion", "codificación", "sistemas de comunicación", "sistemas de comunicacion"],
    "electrical_family": ["electrotecnia", "circuitos", "kirchhoff", "thevenin", "norton", "impedancia", "potencia reactiva", "electronica", "electrónica", "semiconductores", "diodos", "transistores", "maquinas electricas", "máquinas eléctricas", "electrónica de potencia", "electronica de potencia"],
    "legal_management_family": ["derecho", "regulacion", "patentes", "privacidad", "propiedad intelectual"],
    "agro_family": ["agricultura", "riego", "suelos", "sig", "agro"],
}


FAMILY_COVERAGE_GATE: Dict[str, Dict[str, float]] = {
    "software_family": {"min_hits": 2, "min_ratio": 0.25},
    "telecom_family": {"min_hits": 2, "min_ratio": 0.25},
    "industrial_family": {"min_hits": 2, "min_ratio": 0.30},
    "mechanical_family": {"min_hits": 3, "min_ratio": 0.35},
    "mathematical_family": {"min_hits": 3, "min_ratio": 0.35},
    "life_sciences_family": {"min_hits": 3, "min_ratio": 0.35},
    "chemical_family": {"min_hits": 3, "min_ratio": 0.35},
    "electrical_family": {"min_hits": 3, "min_ratio": 0.35},
    "environmental_family": {"min_hits": 2, "min_ratio": 0.3},
    "agro_family": {"min_hits": 2, "min_ratio": 0.3},
    "interactive_media_family": {"min_hits": 2, "min_ratio": 0.3},
    "legal_management_family": {"min_hits": 2, "min_ratio": 0.3},
    "agro_family": {"min_hits": 2, "min_ratio": 0.3},
}


ONTOLOGY_OVERRIDE_PATHS = {
    "area_profiles": Path("config/semantic/area_profiles.json"),
    "domain_concept_lexicon": Path("config/semantic/domain_concept_lexicon.json"),
    "name_area_hints": Path("config/semantic/name_area_hints.json"),
    "area_anchor_requirements": Path("config/semantic/area_anchor_requirements.json"),
    "area_context_group": Path("config/semantic/area_context_group.json"),
    "skill_evidence_patterns": Path("config/semantic/skill_evidence_patterns.json"),
    "concept_canonical_patterns": Path("config/semantic/concept_canonical_patterns.json"),
    "family_coverage_gate": Path("config/semantic/family_coverage_gate.json"),
}


def _dedupe_preserve(items: List[Any]) -> List[Any]:
    seen = set()
    result: List[Any] = []
    for item in items:
        marker = json.dumps(item, ensure_ascii=False, sort_keys=True) if isinstance(item, (dict, list, tuple)) else str(item)
        if marker in seen:
            continue
        seen.add(marker)
        result.append(item)
    return result


def _merge_profile_map(base: Dict[str, Dict[str, List[str]]], extra: Dict[str, Dict[str, List[str]]]) -> Dict[str, Dict[str, List[str]]]:
    merged = {k: {kk: list(vv) for kk, vv in v.items()} for k, v in base.items()}
    for area, profile in extra.items():
        if area not in merged:
            merged[area] = {"strong": [], "medium": [], "light": []}
        for bucket in ("strong", "medium", "light"):
            merged[area][bucket] = _dedupe_preserve(merged[area].get(bucket, []) + list(profile.get(bucket, [])))
    return merged


def _merge_list_map(base: Dict[str, List[str]], extra: Dict[str, List[str]]) -> Dict[str, List[str]]:
    merged = {k: list(v) for k, v in base.items()}
    for key, values in extra.items():
        merged[key] = _dedupe_preserve(merged.get(key, []) + list(values))
    return merged


def _merge_name_hints(base: Dict[str, List[str]], extra: Dict[str, List[str]]) -> Dict[str, List[str]]:
    merged = {k: list(v) for k, v in base.items()}
    for signal, areas in extra.items():
        merged[signal] = _dedupe_preserve(merged.get(signal, []) + list(areas))
    return merged


def _merge_context_blocklist(base: Dict[str, Set[str]], extra: Dict[str, Set[str]]) -> Dict[str, Set[str]]:
    merged: Dict[str, Set[str]] = {k: set(v) for k, v in base.items()}
    for group, terms in extra.items():
        merged[group] = merged.get(group, set()).union(set(terms))
    return merged


def _load_json_if_exists(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def load_ontology_overrides() -> Dict[str, Any]:
    loaded: Dict[str, Any] = {}
    for key, rel_path in ONTOLOGY_OVERRIDE_PATHS.items():
        payload = _load_json_if_exists(rel_path)
        if payload is not None:
            loaded[key] = payload
    return loaded


def apply_semantic_ontology(
    area_profiles: Dict[str, Dict[str, List[str]]],
    domain_concept_lexicon: Dict[str, List[str]],
    name_area_hints: Dict[str, List[str]],
    area_anchor_requirements: Dict[str, List[str]],
    area_context_group: Dict[str, str],
    incompatible_context_groups: Set[frozenset[str]],
    concept_canonical_patterns: List[Tuple[str, str]],
    skill_evidence_patterns: Dict[str, List[str]],
    core_exact_domain_areas: Set[str],
    pair_priority: Dict[str, str],
    applied_priority_areas: Set[str],
    context_generic_blocklist: Dict[str, Set[str]],
) -> Dict[str, Any]:
    merged_area_profiles = _merge_profile_map(area_profiles, EXTENDED_AREA_PROFILES)
    merged_lexicon = _merge_list_map(domain_concept_lexicon, EXTENDED_DOMAIN_CONCEPT_LEXICON)
    merged_hints = _merge_name_hints(name_area_hints, EXTENDED_NAME_AREA_HINTS)
    merged_anchors = _merge_list_map(area_anchor_requirements, EXTENDED_AREA_ANCHORS)
    merged_context_group = dict(area_context_group)
    merged_context_group.update(EXTENDED_AREA_CONTEXT_GROUP)

    merged_incompat = set(incompatible_context_groups).union(EXTENDED_INCOMPATIBLE_CONTEXT_GROUPS)
    merged_patterns = _dedupe_preserve(concept_canonical_patterns + EXTENDED_CONCEPT_CANONICAL_PATTERNS)
    merged_skills = _merge_list_map(skill_evidence_patterns, EXTENDED_SKILL_EVIDENCE_PATTERNS)
    merged_core_areas = set(core_exact_domain_areas).union(EXTENDED_CORE_EXACT_DOMAIN_AREAS)
    merged_pair_priority = dict(pair_priority)
    merged_pair_priority.update(EXTENDED_PAIR_PRIORITY)
    merged_applied = set(applied_priority_areas).union(EXTENDED_APPLIED_PRIORITY_AREAS)
    merged_blocklist = _merge_context_blocklist(context_generic_blocklist, EXTENDED_CONTEXT_GENERIC_BLOCKLIST)

    overrides = load_ontology_overrides()
    if overrides.get("area_profiles"):
        merged_area_profiles = _merge_profile_map(merged_area_profiles, overrides["area_profiles"])
    if overrides.get("domain_concept_lexicon"):
        merged_lexicon = _merge_list_map(merged_lexicon, overrides["domain_concept_lexicon"])
    if overrides.get("name_area_hints"):
        merged_hints = _merge_name_hints(merged_hints, overrides["name_area_hints"])
    if overrides.get("area_anchor_requirements"):
        merged_anchors = _merge_list_map(merged_anchors, overrides["area_anchor_requirements"])
    if overrides.get("area_context_group") and isinstance(overrides["area_context_group"], dict):
        merged_context_group.update(overrides["area_context_group"])
    if overrides.get("skill_evidence_patterns"):
        merged_skills = _merge_list_map(merged_skills, overrides["skill_evidence_patterns"])
    if overrides.get("concept_canonical_patterns") and isinstance(overrides["concept_canonical_patterns"], list):
        extra_patterns = [tuple(item) for item in overrides["concept_canonical_patterns"] if isinstance(item, list) and len(item) == 2]
        merged_patterns = _dedupe_preserve(merged_patterns + extra_patterns)

    merged_family_gate = dict(FAMILY_COVERAGE_GATE)
    if overrides.get("family_coverage_gate") and isinstance(overrides["family_coverage_gate"], dict):
        for family, cfg in overrides["family_coverage_gate"].items():
            if isinstance(cfg, dict):
                merged_family_gate[family] = {
                    "min_hits": float(cfg.get("min_hits", merged_family_gate.get(family, {}).get("min_hits", 2))),
                    "min_ratio": float(cfg.get("min_ratio", merged_family_gate.get(family, {}).get("min_ratio", 0.3))),
                }

    return {
        "area_profiles": merged_area_profiles,
        "domain_concept_lexicon": merged_lexicon,
        "name_area_hints": merged_hints,
        "area_anchor_requirements": merged_anchors,
        "area_context_group": merged_context_group,
        "incompatible_context_groups": merged_incompat,
        "concept_canonical_patterns": merged_patterns,
        "skill_evidence_patterns": merged_skills,
        "core_exact_domain_areas": merged_core_areas,
        "pair_priority": merged_pair_priority,
        "applied_priority_areas": merged_applied,
        "context_generic_blocklist": merged_blocklist,
        "domain_family_by_context": DOMAIN_FAMILY_BY_CONTEXT_GROUP,
        "domain_family_hints": DOMAIN_FAMILY_HINTS,
        "family_coverage_gate": merged_family_gate,
    }
