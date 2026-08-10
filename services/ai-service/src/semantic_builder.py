import re
from typing import Any, Dict, List, Optional, Set, Tuple

from .models import CourseCandidate
from .semantic_ontology import apply_semantic_ontology
from .text_utils import normalize_for_match, normalize_whitespace, split_bullets_or_lines, split_sentences


GENERIC_OBJECTIVE_PREFIXES = [
    "que el estudiante sea capaz de",
    "al finalizar el curso el alumno sera capaz de",
    "al finalizar el curso el alumno será capaz de",
    "se espera que el estudiante",
    "objetivos de aprendizaje",
    "objetivos",
    "propositos",
    "propósitos",
]


NOISE_PATTERNS = [
    "evaluacion",
    "evaluación",
    "asistencia",
    "promocion",
    "promoción",
    "regimen",
    "régimen",
    "cronograma",
    "bibliografia",
    "bibliografía",
    "observaciones",
    "acta",
    "firma",
    "docente",
    "definiciones",
    "conceptos clave",
    "conceptos claves",
    "ejes transversales",
    "aporte",
    "responsabilidad social",
    "trabajo en equipo",
    "innovacion y creatividad",
    "innovación y creatividad",
    "comunicacion efectiva",
    "comunicación efectiva",
]


TRANSVERSAL_PATTERNS = [
    "ejes transversales",
    "etica",
    "ética",
    "responsabilidad social",
    "trabajo en equipo",
    "comunicacion",
    "comunicación",
    "colaboracion",
    "colaboración",
]


INSTITUTIONAL_CUTOFF_PATTERNS = [
    r"\bii\.\s*aporte a los ejes transversales\b",
    r"\baporte a los ejes transversales\b",
    r"\bejes transversales\b",
    r"\bfundamentaci[oó]n\b",
    r"\baporte a la carrera\b",
    r"\baporte al perfil del egresado\b",
    r"\bperfil del egresado\b",
]


AREA_PROFILES = {
    "Arquitectura y Organización de Computadores": {
        "strong": [
            "arquitectura de computadores",
            "organizacion de computadores",
            "organización de computadores",
            "arquitectura de computadoras",
            "organizacion y arquitectura de los computadores",
        ],
        "medium": [
            "cpu",
            "alu",
            "uc",
            "pipeline",
            "microprocesadores",
            "lenguaje ensamblador",
            "cisc",
            "risc",
            "epic",
        ],
        "light": ["clock", "interrupciones", "von neumann", "harvard"],
    },
    "Sistemas Digitales y Hardware": {
        "strong": ["logica digital", "lógica digital", "compuertas logicas", "compuertas lógicas"],
        "medium": ["buses", "dma", "memoria cache", "ram", "rom", "dram", "sram", "ssd", "hdd"],
        "light": ["entrada salida", "dispositivos de entrada salida", "circuitos secuenciales"],
    },
    "Derecho y Regulación": {
        "strong": ["patentes", "jurisprudencia", "responsabilidad civil", "responsabilidad penal", "propiedad industrial"],
        "medium": ["privacidad genetica", "privacidad genética", "daño ambiental", "bioseguridad", "protocolo de cartagena"],
        "light": ["normativa", "regulacion", "regulación", "licencias", "cumplimiento"],
    },
    "Bioética y Bioseguridad": {
        "strong": ["bioetica", "bioética", "bioseguridad"],
        "medium": ["consentimiento informado", "riesgo biologico", "riesgo biológico", "comite de etica", "comité de ética"],
        "light": ["dignidad", "confidencialidad", "bienestar animal"],
    },
    "Biotecnología": {
        "strong": ["biotecnologia", "biotecnología", "ingenieria genetica", "ingeniería genética"],
        "medium": ["fermentacion", "fermentación", "enzimas", "cultivo celular", "recombinante"],
        "light": ["bioproceso", "bioprocesos", "bioinsumos"],
    },
    "Genómica y Proteómica": {
        "strong": ["genoma", "transcriptomica", "transcriptómica", "proteomica", "proteómica"],
        "medium": ["glicomica", "glicómica", "metabolomica", "metabolómica", "snp", "microarreglos", "sage"],
        "light": ["interactoma", "biologia de sistemas", "biología de sistemas", "q pcr", "pcr cuantitativa"],
    },
    "Bioinformática": {
        "strong": ["bioinformatica", "bioinformática"],
        "medium": ["secuenciacion", "secuenciación", "alineamiento", "anotacion", "anotación", "genoma"],
        "light": ["algoritmos de alineamiento", "bases de datos biologicas", "bases de datos biológicas"],
    },
    "Tecnología de Alimentos": {
        "strong": ["leche", "pasteurizacion", "pasteurización", "esterilizacion", "esterilización", "uht", "yogur", "quesos"],
        "medium": ["suero", "membranas", "cip", "envasado", "enologia", "enología", "viticultura", "carbonatacion", "carbonatación"],
        "light": ["microbiologia lactea", "microbiología láctea", "lacteos", "lácteos"],
    },
    "Microbiología": {
        "strong": ["microbiologia", "microbiología", "microorganismos"],
        "medium": [
            "fermentacion",
            "fermentación",
            "cultivo",
            "cepas",
            "bacterias",
            "hongos",
            "haccp",
            "coliformes",
            "salmonella",
            "listeria",
            "micotoxinas",
            "actividad de agua",
            "patogenos",
            "patógenos",
        ],
        "light": ["patogenicidad", "inocuidad", "esterilidad", "gmp", "glp", "ph"],
    },
    "Procesos de Alimentos y Bebidas": {
        "strong": ["pasteurizacion", "pasteurización", "uht", "esterilizacion", "esterilización"],
        "medium": ["cip", "homogeneizacion", "homogeneización", "envasado", "carbonatacion", "carbonatación"],
        "light": ["procesamiento", "tratamiento termico", "tratamiento térmico", "conservacion"],
    },
    "Máquinas Eléctricas y Conversión Electromecánica": {
        "strong": ["transformadores", "motores asincronicos", "motores asíncronos", "maquina sincronica", "máquina sincrónica"],
        "medium": ["corriente continua", "rectificadores", "diodos", "transistores", "campos rotativos", "cupla"],
        "light": ["electromotores", "induccion", "bobinados", "potencia mecanica", "potencia mecánica"],
    },
    "Electrónica y Dispositivos": {
        "strong": ["electrónica", "dispositivos", "semiconductores", "circuitos"],
        "medium": ["diodos", "transistores", "amplificadores", "filtros", "sensores"],
        "light": ["voltaje", "corriente", "resistencia"],
    },
    "Señales y Sistemas": {
        "strong": ["series de fourier", "transformada de fourier", "transformada de laplace", "transformada z", "convolucion", "convolución"],
        "medium": ["sistemas lti", "lti", "dft", "fft", "diagramas de bode", "polos y ceros"],
        "light": ["respuesta en frecuencia", "muestreo", "estabilidad", "sistema lineal"],
    },
    "Arquitectura de Aplicaciones": {
        "strong": ["arquitectura de aplicaciones"],
        "medium": ["arquitectura de software", "arquitectura", "patrones arquitectonicos", "patrones arquitectónicos", "gestion de proyectos", "gestión de proyectos", "gerenciamiento de proyectos", "wbs", "project charter"],
        "light": ["escalabilidad", "despliegue", "integracion de sistemas", "integración de sistemas", "planificacion", "planificación", "cronograma", "riesgos", "calidad"],
    },
    "Cloud Computing": {
        "strong": ["cloud computing", "computacion en la nube", "computación en la nube"],
        "medium": ["nube", "aws", "azure", "gcp", "microservicios", "contenedores", "kubernetes"],
        "light": ["serverless", "orquestacion", "orquestación"],
    },
    "Desarrollo de Aplicaciones Móviles": {
        "strong": ["aplicaciones moviles", "aplicaciones móviles", "desarrollo movil", "desarrollo móvil"],
        "medium": ["android", "ios", "react native", "flutter"],
        "light": ["mobile", "kotlin", "swift"],
    },
    "Algoritmos y Estructuras de Datos": {
        "strong": ["estructuras de datos", "tipos de datos abstractos", "tdas", "algoritmos"],
        "medium": ["complejidad", "grafos", "divide y conquista", "eficiencia de algoritmos"],
        "light": ["listas", "pilas", "colas", "arboles", "árboles"],
    },
    "Inteligencia Artificial": {
        "strong": ["inteligencia artificial"],
        "medium": ["aprendizaje automatico", "aprendizaje profundo", "deep learning", "redes neuronales"],
        "light": ["agentes", "inferencia", "razonamiento"],
    },
    "Machine Learning": {
        "strong": ["machine learning", "aprendizaje automatico"],
        "medium": ["clustering", "arboles de decision", "regresion logistica", "clasificacion"],
        "light": ["prediccion", "entrenamiento", "modelo supervisado"],
    },
    "Ingeniería de Datos": {
        "strong": ["ingenieria de datos", "etl", "pipeline de datos", "big data"],
        "medium": ["data warehouse", "data warehousing", "olap", "procesamiento distribuido"],
        "light": ["calidad de datos", "ingesta", "orquestacion"],
    },
    "Bases de Datos": {
        "strong": ["bases de datos", "base de datos", "sql", "nosql"],
        "medium": ["modelo relacional", "normalizacion", "transacciones", "persistencia"],
        "light": ["consultas", "indice", "modelo entidad relacion"],
    },
    "Datos": {
        "strong": ["analisis de datos", "mineria de datos", "data mining", "ciencia de datos"],
        # "analitica" alone removed: too broad, matches "geometría analítica", "química analítica", etc.
        # Replaced with context-anchored phrases that unambiguously refer to data analytics.
        "medium": ["analitica de datos", "analítica de datos", "analytics", "analisis exploratorio", "visualizacion de datos"],
        "light": ["kpi", "metricas", "muestra"],
    },
    "Ingeniería de Software": {
        "strong": ["ingenieria de software", "desarrollo de software", "proceso de desarrollo", "calidad de software"],
        "medium": ["patrones de diseno", "solid", "grasp", "arquitectura de software", "arquitectura de aplicaciones", "testing", "pytest", "git", "github", "gitlab"],
        "light": ["requerimientos", "refactorizacion", "metodologias agiles", "documentacion", "versionado"],
    },
    "Redes de Datos": {
        "strong": ["redes de datos", "teleinformatica", "teleinformática", "protocolos de red", "tcp ip"],
        "medium": ["routing", "switching", "internet", "lan", "wan"],
        "light": ["enrutamiento", "direccionamiento ip", "capas osi"],
    },
    "Telecomunicaciones": {
        "strong": ["telecomunicaciones", "señales", "senales", "modulacion", "modulación"],
        "medium": ["transmision", "transmisión", "espectro", "canal", "antenas"],
        "light": ["ruido", "ancho de banda", "propagacion"],
    },
    "Redes y Comunicaciones": {
        "strong": ["redes", "comunicaciones", "tcp ip", "modelo tcp ip", "modelo osi"],
        "medium": ["routing", "ruteo", "subredes", "wan", "vpn", "voip", "dns", "dhcp", "http", "smtp", "imap", "ldap"],
        "light": ["sockets", "servidores", "snmp", "virtualizacion", "virtualización"],
    },
    "Redes de Computadoras y Servicios de Red": {
        "strong": ["servicios de red", "cliente servidor", "cliente-servidor", "protocolos de aplicacion", "protocolos de aplicación"],
        "medium": ["tcp", "udp", "dns", "dhcp", "smtp", "imap", "http", "ftp", "tftp", "nfs", "vpn", "firewalls"],
        "light": ["sockets", "wireshark", "snmp", "intranet", "virtualizacion"],
    },
    "Telecomunicaciones de Datos": {
        "strong": ["telecomunicaciones de datos", "transmision de datos", "transmisión de datos"],
        "medium": ["tcp", "udp", "ruteo", "wan", "acceso inalámbrico", "acceso inalambrico", "voip"],
        "light": ["encapsulado", "tunelizacion", "tunelización", "protocolos"],
    },
    "Costos y Contabilidad": {
        "strong": ["contabilidad", "costos industriales", "plan de cuentas", "estados contables"],
        "medium": ["costo directo", "costos directos", "costos indirectos", "costeo abc", "costo abc", "valuacion", "valuación", "costos de producción"],
        "light": ["balance", "asientos", "libro mayor", "indicadores economicos", "indicadores económicos"],
    },
    "Gestión Económica Industrial": {
        "strong": ["costos", "gestión de costos", "gestion de costos", "economia industrial", "economía industrial"],
        "medium": ["evaluacion economica", "evaluación económica", "costeo", "análisis marginal", "analisis marginal"],
        "light": ["planificacion financiera", "planificación financiera", "costos de no calidad"],
    },
    "Ingeniería Industrial y Gestión de Costos": {
        "strong": ["costos y sistemas contables", "costos industriales", "gestion industrial", "gestión industrial"],
        "medium": ["produccion", "producción", "control de costos", "reducción de costos", "reduccion de costos"],
        "light": ["procesos productivos", "valuación económica", "valuacion economica"],
    },
    "Mecánica de Fluidos y Termofluidos": {
        "strong": ["mecánica de los fluidos", "mecanica de los fluidos", "navier stokes", "bernoulli", "reynolds"],
        "medium": ["vorticidad", "capa límite", "capa limite", "flujo compresible", "mach", "tuberias", "tuberías"],
        "light": ["hidraulica", "hidráulica", "termofluidos", "canales abiertos", "moody"],
    },
    "Hidráulica y Neumática": {
        "strong": ["hidraulica", "hidráulica", "neumatica", "neumática"],
        "medium": ["presion", "presión", "caudal", "tuberias", "bombas", "compresores"],
        "light": ["pérdida de carga", "perdida de carga", "radio hidráulico", "canales"],
    },
    "Electrotecnia y Circuitos Eléctricos": {
        "strong": ["electrotecnia", "circuitos eléctricos", "circuitos electricos", "ley de ohm", "kirchhoff"],
        "medium": ["impedancia", "potencia reactiva", "circuitos magnéticos", "faraday", "joule", "thevenin", "norton"],
        "light": ["corriente alterna", "corriente continua", "cos fi", "componentes simétricas", "componentes simetricas"],
    },
    "Ingeniería Eléctrica y Potencia": {
        "strong": ["ingenieria electrica", "ingeniería eléctrica", "electromagnetismo", "energía eléctrica", "energia electrica"],
        "medium": ["trifásica", "trifasica", "factor de potencia", "transformadores", "distribución eléctrica", "distribucion electrica"],
        "light": ["armonicas", "armónicas", "potencia activa", "potencia aparente"],
    },
    "Electrónica": {
        "strong": ["electronica", "electrónica", "circuitos", "analogica", "digital"],
        "medium": ["semiconductores", "amplificadores", "filtros"],
        "light": ["voltaje", "corriente", "resistencia"],
    },
    "Ciberseguridad": {
        "strong": ["seguridad informatica", "seguridad de la informacion", "ciberseguridad", "criptografia"],
        "medium": ["protocolos de seguridad", "integridad", "confidencialidad", "autenticacion"],
        "light": ["amenazas", "vulnerabilidades", "cifrado"],
    },
    "Gestión de Proyectos Tecnológicos": {
        "strong": ["gestion de proyectos", "gerenciamiento de proyectos", "direccion de proyectos", "project charter"],
        "medium": ["planificacion", "gestion del alcance", "alcance del proyecto", "cronograma", "riesgos", "costo", "pmbok"],
        "light": ["stakeholders", "control y seguimiento", "cierre de proyecto"],
    },
    "Sistemas de Información y Negocio": {
        "strong": ["sistemas de informacion", "procesos de negocio", "negocio"],
        "medium": ["empresa", "planeamiento", "analisis organizacional", "estrategia"],
        "light": ["gestion empresarial", "cadena de valor"],
    },
    "Innovación Tecnológica": {
        "strong": ["tendencias tecnologicas", "tendencias tecnológicas", "innovacion tecnologica", "innovación tecnológica"],
        "medium": ["tecnologias emergentes", "tecnologías emergentes", "transformacion digital", "transformación digital"],
        "light": ["adopcion tecnologica", "adopción tecnológica"],
    },
    "Ambiente y Sostenibilidad": {
        "strong": ["medio ambiente", "sostenibilidad", "impacto ambiental"],
        "medium": ["recursos naturales", "gestion ambiental", "cambio climatico"],
        "light": ["huella", "energia sostenible", "energía sostenible"],
    },
    "Derecho Informático": {
        "strong": ["derecho informatico", "derecho informático"],
        "medium": ["proteccion de datos", "protección de datos", "propiedad intelectual", "normativa"],
        "light": ["privacidad", "habeas data", "delitos informaticos", "delitos informáticos"],
    },
    "Comunicación y Humanidades": {
        "strong": ["pensamiento critico", "pensamiento crítico", "ingles", "inglés", "comunicacion efectiva", "comunicación efectiva"],
        "medium": ["expresion oral", "expresión oral", "argumentacion", "argumentación", "comprension lectora", "comprensión lectora"],
        "light": ["discurso", "texto", "debate"],
    },
    "Matemática": {
        "strong": ["algebra", "álgebra", "geometria", "geometría", "matrices", "sistemas lineales"],
        "medium": ["determinantes", "traza", "rango", "espacios vectoriales", "transformaciones lineales", "autovalores", "diagonalizacion", "cónicas", "cuádricas"],
        "light": ["ecuaciones", "análisis matemático", "vectores", "subespacios", "base", "dimension"],
    },
    "Estadística": {
        "strong": [
            "estadistica",
            "estadística",
            "probabilidad",
            "inferencia estadistica",
            "inferencia estadística",
            "pruebas de hipotesis",
            "pruebas de hipótesis",
            "regresion",
            "regresión",
            "anova",
            "chi cuadrado",
        ],
        "medium": [
            "distribuciones",
            "hipotesis",
            "hipótesis",
            "muestreo",
            "intervalos de confianza",
            "estimadores",
            "poisson",
            "distribucion normal",
            "distribución normal",
            "fisher",
            "bernoulli",
        ],
        "light": ["varianza", "desvio", "desvío", "correlacion", "correlación", "p valor", "muestra"],
    },
    "Física": {
        "strong": ["fisica", "física", "mecanica", "mecánica", "electromagnetismo"],
        "medium": ["termodinamica", "termodinámica", "cinematica", "cinemática"],
        "light": ["energia", "energía", "fuerza"],
    },
    "Química": {
        "strong": ["quimica", "química", "enlaces quimicos", "enlaces químicos"],
        "medium": [
            "estequiometria",
            "estequiometría",
            "compuestos",
            "reacciones",
            "atomo",
            "átomo",
            "tabla periodica",
            "tabla periódica",
            "cinetica quimica",
            "cinética química",
            "equilibrio quimico",
            "equilibrio químico",
            "oxidacion",
            "oxidación",
            "neutralizacion",
            "neutralización",
        ],
        "light": ["mol", "soluciones", "ph", "gases", "avogadro", "isotopos", "isótopos"],
    },
    "Ciencia de Materiales": {
        "strong": ["ciencia de materiales", "materiales", "propiedades de materiales"],
        "medium": ["microestructura", "ensayos de materiales", "fatiga", "fractura"],
        "light": ["aleaciones", "ceramicos", "cerámicos", "polimeros", "polímeros"],
    },
}


PAIR_PRIORITY = {
    "Arquitectura y Organización de Computadores": "Sistemas Digitales y Hardware",
    "Sistemas Digitales y Hardware": "Arquitectura y Organización de Computadores",
    "Arquitectura de Aplicaciones": "Ingeniería de Software",
    "Cloud Computing": "Ingeniería de Software",
    "Desarrollo de Aplicaciones Móviles": "Ingeniería de Software",
    "Algoritmos y Estructuras de Datos": "Ingeniería de Software",
    "Ciberseguridad": "Redes de Datos",
    "Gestión de Proyectos Tecnológicos": "Ingeniería de Software",
    "Sistemas de Información y Negocio": "Gestión de Proyectos Tecnológicos",
    "Innovación Tecnológica": "Ingeniería de Software",
    "Derecho Informático": "Comunicación y Humanidades",
    "Inteligencia Artificial": "Machine Learning",
    "Machine Learning": "Inteligencia Artificial",
    "Datos": "Inteligencia Artificial",
    "Ingeniería de Software": "Arquitectura de Aplicaciones",
    "Ingeniería de Datos": "Bases de Datos",
    "Bases de Datos": "Ingeniería de Datos",
    "Química": "Ciencias Básicas",
    "Física": "Ciencias Básicas",
    "Redes y Comunicaciones": "Redes de Computadoras y Servicios de Red",
    "Redes de Computadoras y Servicios de Red": "Telecomunicaciones de Datos",
    "Telecomunicaciones de Datos": "Redes y Comunicaciones",
    "Costos y Contabilidad": "Ingeniería Industrial y Gestión de Costos",
    "Gestión Económica Industrial": "Costos y Contabilidad",
    "Ingeniería Industrial y Gestión de Costos": "Costos y Contabilidad",
    "Mecánica de Fluidos y Termofluidos": "Hidráulica y Neumática",
    "Hidráulica y Neumática": "Mecánica de Fluidos y Termofluidos",
    "Electrotecnia y Circuitos Eléctricos": "Ingeniería Eléctrica y Potencia",
    "Ingeniería Eléctrica y Potencia": "Electrotecnia y Circuitos Eléctricos",
}


MATH_STATS_AREAS = {"Matemática", "Estadística"}
FOUNDATIONAL_AREAS = {"Matemática", "Estadística", "Física", "Química"}
APPLIED_PRIORITY_AREAS = {
    "Mecánica de Fluidos y Termofluidos",
    "Hidráulica y Neumática",
    "Electrotecnia y Circuitos Eléctricos",
    "Ingeniería Eléctrica y Potencia",
    "Redes y Comunicaciones",
    "Redes de Computadoras y Servicios de Red",
    "Telecomunicaciones de Datos",
    "Costos y Contabilidad",
    "Gestión Económica Industrial",
    "Ingeniería Industrial y Gestión de Costos",
}
MATH_NAME_SIGNALS = ["calculo", "cálculo", "algebra", "álgebra", "matematica", "matemática", "estadistica", "estadística", "probabilidad"]
CORE_EXACT_DOMAIN_AREAS = {
    "Arquitectura y Organización de Computadores",
    "Sistemas Digitales y Hardware",
    "Arquitectura de Aplicaciones",
    "Cloud Computing",
    "Desarrollo de Aplicaciones Móviles",
    "Algoritmos y Estructuras de Datos",
    "Inteligencia Artificial",
    "Machine Learning",
    "Ingeniería de Datos",
    "Bases de Datos",
    "Datos",
    "Ingeniería de Software",
    "Redes de Datos",
    "Telecomunicaciones",
    "Electrónica",
    "Ciberseguridad",
    "Gestión de Proyectos Tecnológicos",
    "Sistemas de Información y Negocio",
    "Innovación Tecnológica",
    "Ambiente y Sostenibilidad",
    "Derecho Informático",
    "Derecho y Regulación",
    "Bioética y Bioseguridad",
    "Biotecnología",
    "Genómica y Proteómica",
    "Bioinformática",
    "Tecnología de Alimentos",
    "Microbiología",
    "Procesos de Alimentos y Bebidas",
    "Máquinas Eléctricas y Conversión Electromecánica",
    "Electrónica y Dispositivos",
    "Señales y Sistemas",
    "Control y Automatización",
    "Energía y Potencia",
    "Redes y Comunicaciones",
    "Redes de Computadoras y Servicios de Red",
    "Telecomunicaciones de Datos",
    "Costos y Contabilidad",
    "Gestión Económica Industrial",
    "Ingeniería Industrial y Gestión de Costos",
    "Mecánica de Fluidos y Termofluidos",
    "Hidráulica y Neumática",
    "Electrotecnia y Circuitos Eléctricos",
    "Ingeniería Eléctrica y Potencia",
}

AREA_ANCHOR_REQUIREMENTS = {
    "Arquitectura de Aplicaciones": ["arquitectura de aplicaciones", "arquitectura de software", "patrones arquitectonicos"],
    "Machine Learning": ["machine learning", "aprendizaje automatico", "aprendizaje profundo"],
    "Telecomunicaciones": ["telecomunicaciones", "modulacion", "antenas", "espectro", "series de fourier", "transformada de fourier", "laplace"],
    "Datos": ["datos", "data", "analisis de datos", "ciencia de datos", "mineria de datos", "data mining"],
    "Máquinas Eléctricas y Conversión Electromecánica": ["transformadores", "motores asincronicos", "maquina sincronica", "electromecanica"],
    "Redes de Computadoras y Servicios de Red": ["tcp", "udp", "dns", "dhcp", "smtp", "imap", "http", "sockets"],
    "Costos y Contabilidad": ["costos", "contabilidad", "plan de cuentas", "estados contables"],
    "Mecánica de Fluidos y Termofluidos": ["reynolds", "navier stokes", "vorticidad", "mach", "flujo compresible", "capa limite"],
    "Electrotecnia y Circuitos Eléctricos": ["electrotecnia", "ley de ohm", "kirchhoff", "thevenin", "norton", "impedancia"],
}


AREA_CONTEXT_GROUP = {
    "Matemática": "math_foundational",
    "Estadística": "statistics",
    "Física": "physics_foundational",
    "Química": "chemistry_foundational",
    "Mecánica de Fluidos y Termofluidos": "fluids",
    "Hidráulica y Neumática": "fluids",
    "Electrotecnia y Circuitos Eléctricos": "electrical",
    "Ingeniería Eléctrica y Potencia": "electrical",
    "Redes y Comunicaciones": "networks",
    "Redes de Computadoras y Servicios de Red": "networks",
    "Telecomunicaciones de Datos": "networks",
    "Telecomunicaciones": "telecom_advanced",
    "Costos y Contabilidad": "industrial_costs",
    "Gestión Económica Industrial": "industrial_costs",
    "Ingeniería Industrial y Gestión de Costos": "industrial_costs",
    "Derecho y Regulación": "legal_regulatory",
    "Derecho Informático": "legal_regulatory",
    "Biotecnología": "life_sciences",
    "Genómica y Proteómica": "life_sciences",
    "Bioinformática": "life_sciences",
    "Microbiología": "life_sciences",
    "Tecnología de Alimentos": "life_sciences",
    "Procesos de Alimentos y Bebidas": "life_sciences",
    "Arquitectura y Organización de Computadores": "software",
    "Sistemas Digitales y Hardware": "software",
    "Ingeniería de Software": "software",
    "Sistemas de Información y Negocio": "software",
    "Arquitectura de Aplicaciones": "software",
    "Cloud Computing": "software",
    "Desarrollo de Aplicaciones Móviles": "software",
    "Algoritmos y Estructuras de Datos": "software",
    "Inteligencia Artificial": "software",
    "Machine Learning": "software",
    "Ingeniería de Datos": "software",
    "Bases de Datos": "software",
    "Datos": "software",
    "Comunicación y Humanidades": "humanities",
}


INCOMPATIBLE_CONTEXT_GROUPS = {
    frozenset({"statistics", "fluids"}),
    frozenset({"statistics", "electrical"}),
    frozenset({"statistics", "networks"}),
    frozenset({"legal_regulatory", "software"}),
}


CONTEXT_GENERIC_BLOCKLIST = {
    "statistics": {"matrices", "conjuntos", "algebra", "calculo", "eficiencia", "energia", "potencia"},
    "electrical": {"algebra", "calculo", "conjuntos", "matrices", "eficiencia", "base"},
    "fluids": {"algebra", "calculo", "conjuntos", "matrices", "eficiencia", "base"},
    "life_sciences": {"control", "funciones", "calculo", "base", "calidad", "eficiencia", "soluciones"},
    "software": {"soluciones", "planificacion", "planificación", "cronograma", "riesgos", "alcance", "stakeholders"},
    "legal_regulatory": {"soluciones"},
    "humanities": {"planificacion", "planificación", "cronograma", "riesgos", "costos", "inventarios", "stakeholders"},
}


NAME_AREA_HINTS = {
    "arquitectura de computadores": ["Arquitectura y Organización de Computadores", "Sistemas Digitales y Hardware"],
    "organizacion de computadores": ["Arquitectura y Organización de Computadores", "Sistemas Digitales y Hardware"],
    "organización de computadores": ["Arquitectura y Organización de Computadores", "Sistemas Digitales y Hardware"],
    "sistemas digitales": ["Sistemas Digitales y Hardware", "Arquitectura y Organización de Computadores"],
    "arquitectura de computadoras": ["Arquitectura y Organización de Computadores", "Sistemas Digitales y Hardware"],
    "arquitectura de aplicaciones": ["Arquitectura de Aplicaciones", "Ingeniería de Software"],
    "desarrollo de aplicaciones": ["Ingeniería de Software", "Desarrollo de Aplicaciones Móviles"],
    "programacion": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "programación": ["Ingeniería de Software", "Algoritmos y Estructuras de Datos"],
    "algoritmos": ["Algoritmos y Estructuras de Datos", "Ingeniería de Software"],
    "teleinformatica": ["Redes de Datos"],
    "teleinformática": ["Redes de Datos"],
    "redes": ["Redes de Datos"],
    "telecomunicaciones": ["Telecomunicaciones"],
    "inteligencia artificial": ["Inteligencia Artificial", "Machine Learning"],
    "ciencia de datos": ["Datos", "Inteligencia Artificial"],
    "ingenieria de datos": ["Ingeniería de Datos", "Bases de Datos"],
    "ingeniería de datos": ["Ingeniería de Datos", "Bases de Datos"],
    "base de datos": ["Bases de Datos", "Ingeniería de Datos"],
    "seguridad": ["Ciberseguridad"],
    "sistemas de informacion": ["Sistemas de Información y Negocio"],
    "sistemas de información": ["Sistemas de Información y Negocio"],
    "direccion de proyectos": ["Gestión de Proyectos Tecnológicos"],
    "dirección de proyectos": ["Gestión de Proyectos Tecnológicos"],
    "evaluacion de proyectos": ["Gestión de Proyectos Tecnológicos"],
    "evaluación de proyectos": ["Gestión de Proyectos Tecnológicos"],
    "tendencias tecnologicas": ["Innovación Tecnológica"],
    "tendencias tecnológicas": ["Innovación Tecnológica"],
    "tecnologia e innovacion": ["Innovación Tecnológica"],
    "tecnología e innovación": ["Innovación Tecnológica"],
    "medio ambiente": ["Ambiente y Sostenibilidad"],
    "derecho informatico": ["Derecho Informático"],
    "derecho informático": ["Derecho Informático"],
    "ingles": ["Comunicación y Humanidades"],
    "inglés": ["Comunicación y Humanidades"],
    "pensamiento critico": ["Comunicación y Humanidades"],
    "pensamiento crítico": ["Comunicación y Humanidades"],
    "calculo": ["Matemática"],
    "cálculo": ["Matemática"],
    "algebra": ["Matemática"],
    "álgebra": ["Matemática"],
    "matematica": ["Matemática"],
    "matemática": ["Matemática"],
    "estadistica": ["Estadística"],
    "estadística": ["Estadística"],
    "probabilidad": ["Estadística"],
    "fisica": ["Física"],
    "física": ["Física"],
    "quimica": ["Química", "Ciencias Básicas"],
    "química": ["Química", "Ciencias Básicas"],
    "ciencia de materiales": ["Ciencia de Materiales"],
    "derecho y regulacion": ["Derecho y Regulación"],
    "derecho y regulación": ["Derecho y Regulación"],
    "bioetica": ["Bioética y Bioseguridad"],
    "bioética": ["Bioética y Bioseguridad"],
    "biotecnologia": ["Biotecnología"],
    "biotecnología": ["Biotecnología"],
    "genomica": ["Genómica y Proteómica", "Bioinformática"],
    "genómica": ["Genómica y Proteómica", "Bioinformática"],
    "proteomica": ["Genómica y Proteómica"],
    "proteómica": ["Genómica y Proteómica"],
    "bioinformatica": ["Bioinformática", "Genómica y Proteómica"],
    "bioinformática": ["Bioinformática", "Genómica y Proteómica"],
    "tecnologia de alimentos": ["Tecnología de Alimentos", "Procesos de Alimentos y Bebidas"],
    "tecnología de alimentos": ["Tecnología de Alimentos", "Procesos de Alimentos y Bebidas"],
    "microbiologia": ["Microbiología", "Biotecnología"],
    "microbiología": ["Microbiología", "Biotecnología"],
    "maquinas electricas": ["Máquinas Eléctricas y Conversión Electromecánica"],
    "máquinas eléctricas": ["Máquinas Eléctricas y Conversión Electromecánica"],
    "señales y sistemas": ["Señales y Sistemas", "Telecomunicaciones"],
    "senales y sistemas": ["Señales y Sistemas", "Telecomunicaciones"],
    "control y automatizacion": ["Control y Automatización", "Electrónica y Dispositivos"],
    "control y automatización": ["Control y Automatización", "Electrónica y Dispositivos"],
    "energia y potencia": ["Energía y Potencia", "Máquinas Eléctricas y Conversión Electromecánica"],
    "energía y potencia": ["Energía y Potencia", "Máquinas Eléctricas y Conversión Electromecánica"],
    "sistemas de comunicación": ["Redes y Comunicaciones", "Telecomunicaciones de Datos"],
    "sistemas de comunicacion": ["Redes y Comunicaciones", "Telecomunicaciones de Datos"],
    "redes de computadoras": ["Redes de Computadoras y Servicios de Red", "Redes y Comunicaciones"],
    "servicios de red": ["Redes de Computadoras y Servicios de Red", "Redes y Comunicaciones"],
    "costos y sistemas contables": ["Costos y Contabilidad", "Ingeniería Industrial y Gestión de Costos"],
    "costos industriales": ["Costos y Contabilidad", "Gestión Económica Industrial"],
    "mecanica de los fluidos": ["Mecánica de Fluidos y Termofluidos", "Hidráulica y Neumática"],
    "mecánica de los fluidos": ["Mecánica de Fluidos y Termofluidos", "Hidráulica y Neumática"],
    "electrotecnia": ["Electrotecnia y Circuitos Eléctricos", "Ingeniería Eléctrica y Potencia"],
    "teoria de redes": ["Redes y Comunicaciones", "Redes de Computadoras y Servicios de Red"],
}


DISTINCTIVE_TERMS = [
    "arquitectura de computadores",
    "cpu",
    "alu",
    "uc",
    "pipeline",
    "buses",
    "memoria cache",
    "lenguaje ensamblador",
    "logica digital",
    "procesamiento distribuido",
    "multiprocesamiento",
    "computacion en la nube",
    "inteligencia artificial",
    "tpus",
    "nosql",
    "data mining",
    "data warehouse",
    "machine learning",
    "analisis exploratorio de datos",
    "modelos dimensionales",
    "olap",
    "clustering",
    "arboles de decision",
    "regresion logistica",
    "redes neuronales",
    "patrones de diseno",
    "solid",
    "grasp",
    "arquitectura de software",
    "diseno orientado a objetos",
    "sistemas operativos",
    "teleinformatica",
    "seguridad informatica",
    "algebra",
    "calculo",
    "probabilidad",
    "estadistica",
]


DOMAIN_CONCEPT_LEXICON = {
    "Derecho y Regulación": [
        "patentes",
        "jurisprudencia",
        "responsabilidad civil",
        "responsabilidad penal",
        "propiedad industrial",
        "privacidad genética",
        "daño ambiental",
        "bioseguridad",
        "protocolo de cartagena",
    ],
    "Bioética y Bioseguridad": ["bioética", "bioseguridad", "consentimiento informado", "riesgo biológico", "comité de ética"],
    "Biotecnología": ["biotecnología", "ingeniería genética", "fermentación", "enzimas", "cultivo celular"],
    "Genómica y Proteómica": ["genoma", "transcriptómica", "proteómica", "glicómica", "metabolómica", "SNP", "microarreglos", "SAGE", "PCR cuantitativa", "espectrometría de masas", "interactoma", "biología de sistemas"],
    "Bioinformática": ["bioinformática", "secuenciación", "alineamiento", "anotación", "algoritmos de alineamiento", "bases de datos biológicas"],
    "Tecnología de Alimentos": ["leche", "microbiología láctea", "pasteurización", "esterilización", "UHT", "yogur", "quesos", "suero", "membranas", "CIP", "viticultura", "enología", "carbonatación", "envasado"],
    "Química": [
        "átomo",
        "tabla periódica",
        "estequiometría",
        "mol",
        "gases",
        "soluciones",
        "cinética química",
        "equilibrio químico",
        "oxidación",
        "neutralización",
        "avogadro",
        "molaridad",
        "fracción molar",
        "reactivo limitante",
        "ley de le chatelier",
        "van der waals",
    ],
    "Microbiología": [
        "microbiología",
        "microorganismos",
        "fermentación",
        "cepas",
        "bacterias",
        "hongos",
        "inocuidad",
        "HACCP",
        "GMP",
        "GLP",
        "coliformes",
        "Salmonella",
        "Listeria",
        "micotoxinas",
        "actividad de agua",
        "patógenos",
        "pH",
        "conservación",
    ],
    "Procesos de Alimentos y Bebidas": ["pasteurización", "esterilización", "UHT", "CIP", "homogeneización", "envasado", "carbonatación", "tratamiento térmico"],
    "Máquinas Eléctricas y Conversión Electromecánica": ["transformadores", "motores asincrónicos", "máquina sincrónica", "corriente continua", "rectificadores", "diodos", "transistores", "campos rotativos", "cupla", "rendimiento"],
    "Electrónica y Dispositivos": ["semiconductores", "diodos", "transistores", "amplificadores", "filtros", "sensores"],
    "Señales y Sistemas": ["series de Fourier", "transformada de Fourier", "transformada de Laplace", "transformada Z", "convolución", "sistemas LTI", "DFT", "FFT", "diagramas de Bode", "polos y ceros"],
    "Redes y Comunicaciones": ["TCP/IP", "UDP", "sockets", "DNS", "DHCP", "HTTP", "SMTP", "IMAP", "VPN", "virtualización", "VoIP", "ruteo", "subredes"],
    "Redes de Computadoras y Servicios de Red": ["cliente-servidor", "protocolos de aplicación", "DNS", "DHCP", "HTTP", "SMTP", "IMAP", "NFS", "SNMP", "Firewalls"],
    "Telecomunicaciones de Datos": ["TCP", "UDP", "WAN", "RTP", "RTCP", "encapsulado", "tunelización", "servicios de red"],
    "Costos y Contabilidad": ["contabilidad", "plan de cuentas", "estados contables", "costos industriales", "costeo directo", "costeo ABC", "costos de producción", "valuación"],
    "Gestión Económica Industrial": ["costos", "costo directo", "costos indirectos", "análisis marginal", "reducción de costos", "procesos productivos"],
    "Mecánica de Fluidos y Termofluidos": ["Bernoulli", "Reynolds", "Navier-Stokes", "vorticidad", "capa límite", "Mach", "flujo compresible", "tuberías", "Moody", "canales abiertos"],
    "Hidráulica y Neumática": ["hidráulica", "neumática", "caudal", "presión", "pérdida de carga", "bombas", "compresores", "radio hidráulico"],
    "Electrotecnia y Circuitos Eléctricos": ["ley de Ohm", "Kirchhoff", "impedancia", "potencia reactiva", "circuitos magnéticos", "Faraday", "Joule", "Thevenin", "Norton", "corriente alterna", "corriente continua"],
    "Ingeniería Eléctrica y Potencia": ["factor de potencia", "trifásica", "armónicas", "potencia activa", "potencia aparente", "distribución eléctrica"],
    "Estadística": [
        "inferencia estadística",
        "intervalos de confianza",
        "pruebas de hipótesis",
        "chi-cuadrado",
        "regresión",
        "ANOVA",
        "Poisson",
        "distribución normal",
        "muestreo",
        "estimadores",
        "Fisher",
        "Bernoulli",
        "p-valor",
    ],
    "Control y Automatización": ["control", "automatización", "realimentación", "lazo cerrado", "lazo abierto", "estabilidad"],
    "Energía y Potencia": ["potencia", "energía", "eficiencia", "rendimiento", "circuito de potencia"],
    "Derecho Informático": ["derecho informático", "privacidad", "propiedad intelectual", "protección de datos"],
}


SKILL_EVIDENCE_PATTERNS = {
    "Python": ["python"],
    "Java": ["java"],
    "C": ["programacion en c", "programación en c", "lenguaje c", "ansi c"],
    "C++": ["c++"],
    "SQL": [" sql ", "base de datos", "consulta sql"],
    "Git": ["git", "control de versiones"],
    "Docker": ["docker", "docker compose", "dockerfile", "contenedor docker"],
    "Kubernetes": ["kubernetes", "k8s"],
    "TensorFlow": ["tensorflow"],
    "PyTorch": ["pytorch"],
    "Assembler": ["ensamblador", "assembly"],
}


STRICT_TEXTUAL_SOFTWARE_SKILLS = {"Docker", "TensorFlow", "PyTorch", "Kubernetes"}


SECTION_PRIORITY_FOR_EVIDENCE = [
    "minimum_contents_raw",
    "conceptual_contents_raw",
    "procedural_contents_raw",
    "contents_raw",
    "objectives_raw",
    "course_name",
    "keywords",
]


SECTION_EVIDENCE_WEIGHT = {
    "minimum_contents_raw": 1.0,
    "conceptual_contents_raw": 0.95,
    "procedural_contents_raw": 0.9,
    "contents_raw": 0.85,
    "objectives_raw": 0.75,
    "course_name": 0.95,
    "keywords": 0.6,
}


CANONICAL_TERM_LABELS = {
    "cpu": "CPU",
    "alu": "ALU",
    "uc": "UC",
    "ram": "RAM",
    "rom": "ROM",
    "dram": "DRAM",
    "sram": "SRAM",
    "ssd": "SSD",
    "hdd": "HDD",
    "dma": "DMA",
    "git": "Git",
    "github": "GitHub",
    "gitlab": "GitLab",
    "python": "Python",
    "java": "Java",
    "sql": "SQL",
    "nosql": "NoSQL",
    "api": "API",
    "c": "C",
    "c++": "C++",
    "aws": "AWS",
    "gcp": "GCP",
    "k8s": "K8s",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "tpus": "TPUs",
}


SKILL_STRONG_LOCAL_CONCEPT_SUPPORT = {
    "Git": ["control de versiones", "repositorios", "GitHub", "GitLab"],
    "Assembler": ["lenguaje ensamblador", "arquitectura de computadores", "microprocesadores"],
}


SOFTWARE_SKILLS = {"Python", "C", "C++", "Java", "SQL", "TensorFlow", "PyTorch", "Docker", "Kubernetes"}


# Fase 2B (multi-dominio): skills agregadas en EXTENDED_SKILL_EVIDENCE_PATTERNS
# (src/semantic_ontology.py) que tambien deben exigir evidencia en seccion
# curricular fuerte -- mismo criterio conservador que SOFTWARE_SKILLS, extendido
# a mas dominios (bio/lab, quimica, electronica, mecanica/CAD, industrial,
# ambiental) para no sesgar la exigencia de evidencia solo a software. Ver
# reports/pdf_skills_coverage_patch_v1_review.md para el diagnostico y los
# controles negativos que motivaron esta lista.
MULTI_DOMAIN_SKILLS_REQUIRING_CORE_EVIDENCE = {
    "Scrum", "UML", "Machine Learning",
    "PCR", "Electroforesis", "Cultivo Celular", "Esterilización",
    "Cromatografía",
    "Osciloscopio", "Microcontroladores", "VHDL",
    "AutoCAD", "SolidWorks",
    "Six Sigma", "Control Estadístico de Procesos",
    "Evaluación de Impacto Ambiental",

    # IA-Q1b (hardening): las 41 skills multi-dominio agregadas en IA-Q1
    # (config/semantic/skill_evidence_patterns.json) quedaban sin el gate de
    # evidencia fuerte -- se detectaban con solo aparecer en objectives_raw/
    # course_name/keywords, a diferencia de SOFTWARE_SKILLS. Se agregan aca
    # con el mismo criterio conservador: exigen evidencia en
    # CORE_CURRICULAR_SECTIONS y modo de deteccion explicito (nunca solo
    # semantic_match_local_*). Ver
    # ia-q1-general-semantic-quality-upgrade-review-bundle.txt seccion 12.
    "Pensamiento Crítico", "Lectura Crítica", "Comunicación Escrita",
    "Comunicación Oral", "Análisis Argumentativo", "Debate y Argumentación",
    "Producción de Textos", "Interpretación Conceptual", "Ética Aplicada",
    "Investigación Bibliográfica",
    "Metodología de Investigación", "Análisis Cualitativo",
    "Análisis Cuantitativo", "Relevamiento de Información",
    "Elaboración de Informes", "Análisis de Casos", "Diseño de Instrumentos",
    "Gestión de Proyectos", "Trabajo en Equipo", "Toma de Decisiones",
    "Resolución de Problemas", "Planificación Estratégica",
    "Gestión Organizacional", "Mejora de Procesos",
    "Análisis Financiero", "Evaluación de Inversiones", "Presupuestación",
    "Control de Gestión", "Análisis de Costos",
    "Bases de Datos", "Análisis de Datos", "Testing de Software", "DevOps",
    "Cloud Computing", "Seguridad Informática",
    "Diseño Centrado en Usuario", "Investigación de Usuarios",
    "Prototipado", "Evaluación de Usabilidad", "Diseño de Interfaces",
    "Comunicación Visual",
}

# Union usada en detect_skills() para decidir que skills exigen evidencia en
# CORE_CURRICULAR_SECTIONS (nunca solo keywords/course_name) y modo de deteccion
# explicito (nunca solo semantic_match_local_*). No renombra SOFTWARE_SKILLS
# (sigue usandose tal cual en otros puntos del codigo/tests) -- solo generaliza
# el gate de evidencia para que aplique parejo a todos los dominios nuevos.
SKILLS_REQUIRING_CORE_EVIDENCE = SOFTWARE_SKILLS | MULTI_DOMAIN_SKILLS_REQUIRING_CORE_EVIDENCE


GENERIC_LOW_VALUE_CONCEPTS = {
    "funciones",
    "control",
    "calculo",
    "cálculo",
    "base",
    "calidad",
    "integración",
    "integracion",
    "estabilidad",
    "seguridad",
    "rendimiento",
}


CONCEPT_STOPWORDS = {
    "unidad",
    "tema",
    "modulo",
    "módulo",
    "introduccion",
    "introducción",
    "conceptos",
    "basicos",
    "básicos",
}


CONCEPT_STARTING_VERBS = {
    "usar",
    "utilizar",
    "comprender",
    "aprender",
    "conocer",
    "resolver",
    "implementar",
    "integrar",
    "manejar",
    "identificar",
    "relacionar",
    "incluir",
    "incluye",
    "incluyen",
    "anadir",
    "añadir",
}


CONCEPT_CONNECTOR_STARTS = {"y", "o", "u", "con", "sin", "para", "entre"}


MIN_CONCEPT_CONFIDENCE = 0.36


CORE_CURRICULAR_SECTIONS = {
    "minimum_contents_raw",
    "conceptual_contents_raw",
    "procedural_contents_raw",
    "contents_raw",
}


SECONDARY_SECTIONS = {"objectives_raw"}


SECTION_EVIDENCE_PRIORITY = {
    "minimum_contents_raw": "core_curricular_section",
    "conceptual_contents_raw": "core_curricular_section",
    "procedural_contents_raw": "core_curricular_section",
    "contents_raw": "core_curricular_section",
    "objectives_raw": "secondary_section",
    "course_name": "secondary_section",
    "keywords": "secondary_section",
}


SECTION_EVIDENCE_CONFIDENCE = {
    "core_curricular_section": 1.0,
    "secondary_section": 0.65,
    "transversal_institutional_section": 0.35,
}


SECTION_CURRICULAR_WEIGHTS = {
    "minimum_contents_raw": 1.0,
    "conceptual_contents_raw": 0.95,
    "procedural_contents_raw": 0.9,
    "contents_raw": 0.85,
    "objectives_raw": 0.4,
    "course_name": 0.55,
    "keywords": 0.5,
}


CONCEPT_CANONICAL_PATTERNS = [
    ("matriz", "matrices"),
    ("arreglos bidimensionales", "arreglos bidimensionales"),
    ("arreglo bidimensional", "arreglos bidimensionales"),
    ("funcion", "funciones"),
    ("lista", "listas"),
    ("slicing", "slicing"),
    ("expresiones regulares", "expresiones regulares"),
    ("expresion regular", "expresiones regulares"),
    ("excepciones", "excepciones"),
    ("pytest", "pytest"),
    ("json", "archivos JSON"),
    ("recursiv", "recursividad"),
    ("diccionario", "diccionarios"),
    ("tupla", "tuplas"),
    ("conjunto", "conjuntos"),
    ("recursion", "recursividad"),
    ("archivo", "archivos"),
    ("cpu", "CPU"),
    ("alu", "ALU"),
    ("pipeline", "pipeline"),
    ("von neumann", "arquitectura von neumann"),
    ("harvard", "arquitectura harvard"),
    ("memoria cache", "memoria caché"),
    ("ensamblador", "lenguaje ensamblador"),
    ("sistema lineal", "sistemas lineales"),
    ("sistemas lineales", "sistemas lineales"),
    ("determinante", "determinantes"),
    ("traza", "traza"),
    ("rango", "rango"),
    ("espacio vectorial", "espacios vectoriales"),
    ("espacios vectoriales", "espacios vectoriales"),
    ("subespacio", "subespacios"),
    ("independencia lineal", "independencia lineal"),
    ("base y dimension", "base y dimension"),
    ("base", "base"),
    ("dimension", "dimension"),
    ("transformacion lineal", "transformaciones lineales"),
    ("transformaciones lineales", "transformaciones lineales"),
    ("nucleo", "nucleo"),
    ("imagen", "imagen"),
    ("autovalor", "autovalores"),
    ("autovalores", "autovalores"),
    ("diagonalizacion", "diagonalizacion"),
    ("cónica", "cónicas"),
    ("conica", "cónicas"),
    ("cónicas", "cónicas"),
    ("cuádrica", "cuádricas"),
    ("cuadrica", "cuádricas"),
    ("cuádricas", "cuádricas"),
    ("matriz asociada", "matriz asociada"),
    ("cambio de base", "cambio de base"),
    ("ecuaciones lineales", "ecuaciones lineales"),
    ("ciclo de vida de los proyectos", "ciclo de vida de proyectos"),
    ("ciclo de vida de proyectos", "ciclo de vida de proyectos"),
    ("gestion del alcance", "gestión del alcance"),
    ("alcance del proyecto", "alcance del proyecto"),
    ("definicion de alcance", "definición de alcance"),
    ("wbs", "WBS"),
    ("planificacion", "planificación"),
    ("planificación", "planificación"),
    ("cronograma", "cronograma"),
    ("costos", "costos"),
    ("riesgos", "riesgos"),
    ("requerimientos", "requerimientos"),
    ("escalabilidad", "escalabilidad"),
    ("integracion", "integración"),
    ("integración", "integración"),
    ("gestion de proyectos", "gestión de proyectos"),
    ("gerenciamiento de proyectos", "gerenciamiento de proyectos"),
    ("proyecto charter", "project charter"),
    ("project charter", "project charter"),
    ("administracion de contratos", "administración de contratos"),
    ("gestion de la integración", "gestión de la integración"),
    ("patentes", "patentes"),
    ("jurisprudencia", "jurisprudencia"),
    ("responsabilidad civil", "responsabilidad civil"),
    ("responsabilidad penal", "responsabilidad penal"),
    ("propiedad industrial", "propiedad industrial"),
    ("bioseguridad", "bioseguridad"),
    ("protocolo de cartagena", "protocolo de cartagena"),
    ("leche", "leche"),
    ("pasteurizacion", "pasteurización"),
    ("esterilizacion", "esterilización"),
    ("uht", "UHT"),
    ("yogur", "yogur"),
    ("quesos", "quesos"),
    ("suero", "suero"),
    ("membranas", "membranas"),
    ("cip", "CIP"),
    ("viticultura", "viticultura"),
    ("enologia", "enología"),
    ("carbonatacion", "carbonatación"),
    ("genoma", "genoma"),
    ("transcriptomica", "transcriptómica"),
    ("proteomica", "proteómica"),
    ("glicomica", "glicómica"),
    ("metabolomica", "metabolómica"),
    ("snp", "SNP"),
    ("microarreglos", "microarreglos"),
    ("sage", "SAGE"),
    ("pcr cuantitativa", "PCR cuantitativa"),
    ("espectrometria de masas", "espectrometría de masas"),
    ("interactoma", "interactoma"),
    ("biologia de sistemas", "biología de sistemas"),
    ("transformadores", "transformadores"),
    ("motores asincronos", "motores asincrónicos"),
    ("maquina sincronica", "máquina sincrónica"),
    ("corriente continua", "corriente continua"),
    ("rectificadores", "rectificadores"),
    ("diodos", "diodos"),
    ("campos rotativos", "campos rotativos"),
    ("cupla", "cupla"),
    ("rendimiento", "rendimiento"),
    ("series de fourier", "series de Fourier"),
    ("transformada de fourier", "transformada de Fourier"),
    ("transformada de laplace", "transformada de Laplace"),
    ("transformada z", "transformada Z"),
    ("convolucion", "convolución"),
    ("sistemas lti", "sistemas LTI"),
    ("dft", "DFT"),
    ("fft", "FFT"),
    ("diagramas de bode", "diagramas de Bode"),
    ("polos y ceros", "polos y ceros"),
    ("tcp ip", "TCP/IP"),
    ("tcp", "TCP"),
    ("udp", "UDP"),
    ("sockets", "sockets"),
    ("dns", "DNS"),
    ("dhcp", "DHCP"),
    ("http", "HTTP"),
    ("smtp", "SMTP"),
    ("imap", "IMAP"),
    ("vpn", "VPN"),
    ("voip", "VoIP"),
    ("virtualizacion", "virtualización"),
    ("bernoulli", "Bernoulli"),
    ("reynolds", "Reynolds"),
    ("navier stokes", "Navier-Stokes"),
    ("vorticidad", "vorticidad"),
    ("capa limite", "capa límite"),
    ("numero de mach", "número de Mach"),
    ("flujo compresible", "flujo compresible"),
    ("tuberias", "tuberías"),
    ("ley de ohm", "ley de Ohm"),
    ("kirchhoff", "leyes de Kirchhoff"),
    ("impedancia", "impedancia"),
    ("potencia reactiva", "potencia reactiva"),
    ("circuitos magneticos", "circuitos magnéticos"),
    ("faraday", "Faraday"),
    ("joule", "Joule"),
    ("thevenin", "Thevenin"),
    ("norton", "Norton"),
    ("contabilidad", "contabilidad"),
    ("plan de cuentas", "plan de cuentas"),
    ("estados contables", "estados contables"),
    ("costos industriales", "costos industriales"),
    ("costo directo", "costo directo"),
    ("costeo abc", "costeo ABC"),
    ("costos de produccion", "costos de producción"),
    ("valuacion", "valuación"),
    ("inferencia estadistica", "inferencia estadística"),
    ("inferencia", "inferencia estadística"),
    ("intervalos de confianza", "intervalos de confianza"),
    ("pruebas de hipotesis", "pruebas de hipótesis"),
    ("prueba de hipotesis", "pruebas de hipótesis"),
    ("chi cuadrado", "chi-cuadrado"),
    ("chi-cuadrado", "chi-cuadrado"),
    ("regresion", "regresión"),
    ("anova", "ANOVA"),
    ("poisson", "Poisson"),
    ("distribucion normal", "distribución normal"),
    ("fisher", "Fisher"),
    ("estimadores", "estimadores"),
    ("muestreo", "muestreo"),
    ("p valor", "p-valor"),
    ("intervalo de prediccion", "intervalo de predicción"),
    ("intervalo de predicción", "intervalo de predicción"),
    ("tamano muestral", "tamaño muestral"),
    ("tamaño muestral", "tamaño muestral"),
    ("potencia estadistica", "potencia estadística"),
    ("potencia estadística", "potencia estadística"),
    ("fisher snedecor", "Fisher-Snedecor"),
    ("regresion multiple", "regresión múltiple"),
    ("regresión múltiple", "regresión múltiple"),
    ("tda", "TDA"),
    ("abb", "ABB"),
    ("avl", "AVL"),
    ("grafo", "grafo"),
    ("complejidad", "complejidad"),
    ("memoria dinamica", "memoria dinámica"),
    ("punteros", "punteros"),
    ("procesos", "procesos"),
    ("hilos", "hilos"),
    ("paginacion", "paginación"),
    ("segmentacion", "segmentación"),
    ("memoria virtual", "memoria virtual"),
    ("sincronizacion", "sincronización"),
    ("uml", "UML"),
    ("elicitacion", "elicitación"),
    ("validacion", "validación"),
    ("trazabilidad", "trazabilidad"),
    ("requisitos funcionales", "requisitos funcionales"),
    ("requisitos no funcionales", "requisitos no funcionales"),
    ("epistemologia", "epistemología"),
    ("logica proposicional", "lógica proposicional"),
    ("logica de predicados", "lógica de predicados"),
    ("validez", "validez"),
    ("falacias", "falacias"),
    ("induccion", "inducción"),
    ("deduccion", "deducción"),
    ("argumentacion", "argumentación"),
    ("etica deontologica", "ética deontológica"),
    ("utilitarismo", "utilitarismo"),
    ("relativismo moral", "relativismo moral"),
    ("filosofia", "filosofía"),
    ("axiologia", "axiología"),
    ("atomo", "átomo"),
    ("tabla periodica", "tabla periódica"),
    ("estequiometria", "estequiometría"),
    ("reactivo limitante", "reactivo limitante"),
    ("avogadro", "número de Avogadro"),
    ("molaridad", "molaridad"),
    ("fraccion molar", "fracción molar"),
    ("cinetica quimica", "cinética química"),
    ("equilibrio quimico", "equilibrio químico"),
    ("oxidacion", "oxidación"),
    ("neutralizacion", "neutralización"),
    ("van der waals", "van der Waals"),
    ("haccp", "HACCP"),
    ("gmp", "GMP"),
    ("glp", "GLP"),
    ("coliformes", "coliformes"),
    ("salmonella", "Salmonella"),
    ("listeria", "Listeria"),
    ("micotoxinas", "micotoxinas"),
    ("actividad de agua", "actividad de agua"),
    ("patogenos", "patógenos"),
    ("ph", "pH"),
    ("codigo alimentario argentino", "Código Alimentario Argentino"),
]


ONTOLOGY_DATA = apply_semantic_ontology(
    area_profiles=AREA_PROFILES,
    domain_concept_lexicon=DOMAIN_CONCEPT_LEXICON,
    name_area_hints=NAME_AREA_HINTS,
    area_anchor_requirements=AREA_ANCHOR_REQUIREMENTS,
    area_context_group=AREA_CONTEXT_GROUP,
    incompatible_context_groups=INCOMPATIBLE_CONTEXT_GROUPS,
    concept_canonical_patterns=CONCEPT_CANONICAL_PATTERNS,
    skill_evidence_patterns=SKILL_EVIDENCE_PATTERNS,
    core_exact_domain_areas=CORE_EXACT_DOMAIN_AREAS,
    pair_priority=PAIR_PRIORITY,
    applied_priority_areas=APPLIED_PRIORITY_AREAS,
    context_generic_blocklist=CONTEXT_GENERIC_BLOCKLIST,
)

AREA_PROFILES = ONTOLOGY_DATA["area_profiles"]
DOMAIN_CONCEPT_LEXICON = ONTOLOGY_DATA["domain_concept_lexicon"]
NAME_AREA_HINTS = ONTOLOGY_DATA["name_area_hints"]
AREA_ANCHOR_REQUIREMENTS = ONTOLOGY_DATA["area_anchor_requirements"]
AREA_CONTEXT_GROUP = ONTOLOGY_DATA["area_context_group"]
INCOMPATIBLE_CONTEXT_GROUPS = ONTOLOGY_DATA["incompatible_context_groups"]
CONCEPT_CANONICAL_PATTERNS = ONTOLOGY_DATA["concept_canonical_patterns"]
SKILL_EVIDENCE_PATTERNS = ONTOLOGY_DATA["skill_evidence_patterns"]
CORE_EXACT_DOMAIN_AREAS = ONTOLOGY_DATA["core_exact_domain_areas"]
PAIR_PRIORITY = ONTOLOGY_DATA["pair_priority"]
APPLIED_PRIORITY_AREAS = ONTOLOGY_DATA["applied_priority_areas"]
CONTEXT_GENERIC_BLOCKLIST = ONTOLOGY_DATA["context_generic_blocklist"]
DOMAIN_FAMILY_BY_CONTEXT = ONTOLOGY_DATA["domain_family_by_context"]
DOMAIN_FAMILY_HINTS = ONTOLOGY_DATA["domain_family_hints"]
FAMILY_COVERAGE_GATE = ONTOLOGY_DATA["family_coverage_gate"]


GENERIC_SINGLE_WORDS = {
    "conceptos",
    "objetos",
    "analisis",
    "análisis",
    "diseno",
    "diseño",
    "metodologias",
    "metodologías",
    "perspectivas",
}


SEMANTIC_V16_THRESHOLDS: Dict[str, float] = {
    "secondary_validated_min": 7.5,
    "secondary_validated_min_high_noise": 9.2,
    "secondary_validated_min_very_high_noise": 10.5,
    "secondary_ratio_min": 0.68,
    "secondary_ratio_min_high_noise": 0.76,
    "relative_gap_min": 4.4,
    "relative_gap_min_high_noise": 5.8,
    "family_anchor_protection_min": 0.64,
}


GENERIC_SIGNAL_TERMS: Set[str] = {
    "componentes",
    "procesos",
    "sistemas",
    "digital",
    "digitales",
    "proyecto",
    "proyectos",
    "planificacion",
    "planificación",
    "cronograma",
    "gestion",
    "gestión",
    "metodologia",
    "metodologías",
}


PROJECT_COURSE_PATTERNS: List[str] = [
    "proyecto final",
    "proyecto integrador",
    "trabajo final",
    "seminario",
    "taller",
    "proyecto de",
]


PROJECT_OPERATIONAL_AREAS: Set[str] = {
    "Gestión de Proyectos Tecnológicos",
    "Gestión Económica Industrial",
    "Ingeniería Industrial y Gestión de Costos",
    "Sistemas de Información y Negocio",
}


AMBIGUOUS_SIGNAL_RULES: Dict[str, Dict[str, Any]] = {
    "canal": {
        "specificity_level": "low",
        "ambiguity_risk": "high",
        "requires_cooccurrence_with": ["transmision", "modulacion", "señales", "senales", "antenas", "espectro", "tcp", "udp"],
        "forbidden_contexts": ["canales de riego", "canales ionicos", "biologia", "microbiologia", "alimentos"],
        "disciplinary_affinity": ["Telecomunicaciones", "Redes y Comunicaciones", "Telecomunicaciones de Datos", "Redes de Computadoras y Servicios de Red"],
        "generic_signal_penalty": 0.42,
    },
    "canales": {
        "specificity_level": "low",
        "ambiguity_risk": "high",
        "requires_cooccurrence_with": ["transmision", "modulacion", "señales", "senales", "antenas", "espectro", "tcp", "udp"],
        "forbidden_contexts": ["canales de riego", "canales ionicos", "biologia", "microbiologia", "alimentos"],
        "disciplinary_affinity": ["Telecomunicaciones", "Redes y Comunicaciones", "Telecomunicaciones de Datos", "Redes de Computadoras y Servicios de Red"],
        "generic_signal_penalty": 0.42,
    },
    "harvard": {
        "specificity_level": "medium",
        "ambiguity_risk": "high",
        "requires_cooccurrence_with": ["arquitectura", "cpu", "memoria", "von neumann", "computadores"],
        "forbidden_contexts": ["negociacion", "liderazgo", "management", "caso harvard"],
        "disciplinary_affinity": ["Arquitectura y Organización de Computadores", "Sistemas Digitales y Hardware"],
        "generic_signal_penalty": 0.35,
    },
    "proyecto": {
        "specificity_level": "low",
        "ambiguity_risk": "high",
        "requires_cooccurrence_with": ["integrador", "disciplina", "laboratorio", "implementacion", "implementación", "prototipo"],
        "forbidden_contexts": ["stakeholders", "pmbok", "alcance", "costos", "cronograma"],
        "disciplinary_affinity": [],
        "generic_signal_penalty": 0.32,
    },
    "planificacion": {
        "specificity_level": "low",
        "ambiguity_risk": "medium",
        "requires_cooccurrence_with": ["disciplina", "tecnico", "técnico", "implementacion", "implementación"],
        "forbidden_contexts": ["pmbok", "stakeholders", "alcance", "wbs"],
        "disciplinary_affinity": [],
        "generic_signal_penalty": 0.28,
    },
    "cronograma": {
        "specificity_level": "low",
        "ambiguity_risk": "medium",
        "requires_cooccurrence_with": ["disciplina", "tecnico", "técnico", "implementacion", "implementación"],
        "forbidden_contexts": ["pmbok", "stakeholders", "alcance", "wbs"],
        "disciplinary_affinity": [],
        "generic_signal_penalty": 0.28,
    },
    "componentes": {
        "specificity_level": "low",
        "ambiguity_risk": "medium",
        "requires_cooccurrence_with": [],
        "forbidden_contexts": [],
        "disciplinary_affinity": [],
        "generic_signal_penalty": 0.22,
    },
    "procesos": {
        "specificity_level": "low",
        "ambiguity_risk": "medium",
        "requires_cooccurrence_with": [],
        "forbidden_contexts": [],
        "disciplinary_affinity": [],
        "generic_signal_penalty": 0.2,
    },
    "sistemas": {
        "specificity_level": "low",
        "ambiguity_risk": "medium",
        "requires_cooccurrence_with": [],
        "forbidden_contexts": [],
        "disciplinary_affinity": [],
        "generic_signal_penalty": 0.2,
    },
}


def is_project_course(name: str, source_file: str) -> bool:
    joined = normalize_for_match(" ".join([name or "", source_file or ""]))
    return any(normalize_for_match(pattern) in joined for pattern in PROJECT_COURSE_PATTERNS)


def merge_unique_flags(base: List[str], extra: List[str]) -> List[str]:
    merged = list(base)
    for item in extra:
        if item and item not in merged:
            merged.append(item)
    return merged


def build_objectives(raw_sections: Dict[str, str], max_items: int) -> List[str]:
    core_objectives, _ = split_objectives_sections(raw_sections.get("objectives_raw", ""))
    text = repair_line_breaks(core_objectives)
    if not text:
        return []

    candidates = split_sentences(text)
    if len(candidates) <= 1:
        candidates = split_bullets_or_lines(text)

    cleaned: List[str] = []
    for item in candidates:
        objective = clean_objective_item(item)
        if objective:
            cleaned.append(objective)

    return dedupe_and_trim(cleaned, max_items)


def build_contents(raw_sections: Dict[str, str], max_items: int) -> List[str]:
    contents_keys = [
        "minimum_contents_raw",
        "conceptual_contents_raw",
        "procedural_contents_raw",
        "attitudinal_contents_raw",
        "contents_raw",
    ]

    merged = build_curricular_contents_text(raw_sections, contents_keys)
    if not merged:
        return []

    literal_phrases = extract_keyword_phrases(merged, max_phrase_words=9)
    distinctive_candidates = find_distinctive_terms(merged)
    merged_candidates = [format_canonical_label(item) for item in distinctive_candidates] + literal_phrases

    return dedupe_and_trim([c for c in merged_candidates if not is_noise_text(c)], max_items)


def build_detected_concepts(raw_sections: Dict[str, str], max_items: int, keywords: Optional[List[str]] = None) -> List[str]:
    contents_keys = [
        "minimum_contents_raw",
        "conceptual_contents_raw",
        "procedural_contents_raw",
        "attitudinal_contents_raw",
        "contents_raw",
    ]
    merged = build_curricular_contents_text(raw_sections, contents_keys)
    if not merged:
        return []

    lexicon = build_concept_lexicon()
    concepts_with_score: List[Tuple[str, float]] = []
    merged_norm = normalize_for_match(merged)
    contextual_areas = infer_context_areas_from_text(merged_norm)
    contextual_term_norm = build_contextual_term_set(contextual_areas)
    contextual_groups = {AREA_CONTEXT_GROUP.get(area, "") for area in contextual_areas if AREA_CONTEXT_GROUP.get(area, "")}
    blocked_norm = build_context_generic_blocklist(contextual_groups)
    generic_norm = {normalize_for_match(item) for item in GENERIC_LOW_VALUE_CONCEPTS}

    for signal, label in CONCEPT_CANONICAL_PATTERNS:
        signal_norm = normalize_for_match(signal)
        if len(signal_norm) < 3:
            continue
        if re.search(build_word_boundary_pattern(signal_norm), merged_norm):
            label_norm = normalize_for_match(label)
            score = 0.74
            if label_norm in contextual_term_norm:
                score += 0.18
            score += concept_specificity_bonus(label)
            if label_norm in generic_norm:
                score -= 0.35
            if label_norm in blocked_norm:
                score -= 0.35
            concepts_with_score.append((label, min(0.98, score)))

    for norm_term, label in lexicon.items():
        pattern = build_word_boundary_pattern(norm_term)
        hits = len(re.findall(pattern, merged_norm))
        if hits > 0:
            score = min(0.98, 0.45 + 0.10 * hits)
            if norm_term in contextual_term_norm:
                score += 0.2
            score += concept_specificity_bonus(label)
            if norm_term in generic_norm:
                score -= 0.35
            if norm_term in blocked_norm:
                score -= 0.35
            concepts_with_score.append((label, score))

    ranked: List[str] = []
    seen_norm = set()
    for concept, score in sorted(concepts_with_score, key=lambda item: item[1], reverse=True):
        norm = normalize_for_match(concept)
        if not norm or norm in seen_norm:
            continue
        if score < MIN_CONCEPT_CONFIDENCE:
            continue
        if not is_clean_concept(concept):
            continue
        seen_norm.add(norm)
        ranked.append(concept)
        if len(ranked) >= max_items:
            break

    return filter_ranked_concepts_by_context(ranked, contextual_term_norm, blocked_norm)


def detect_skills(raw_sections: Dict[str, str], course_name: str, keywords: List[str], concepts_detected: List[str]) -> List[Dict[str, Any]]:
    objectives_core, objectives_transversal = split_objectives_sections(raw_sections.get("objectives_raw", ""))
    corpora_norm = {
        "course_name": normalize_for_match(course_name),
        "objectives_raw": normalize_for_match(objectives_core),
        "minimum_contents_raw": normalize_for_match(raw_sections.get("minimum_contents_raw", "")),
        "conceptual_contents_raw": normalize_for_match(raw_sections.get("conceptual_contents_raw", "")),
        "procedural_contents_raw": normalize_for_match(raw_sections.get("procedural_contents_raw", "")),
        "contents_raw": normalize_for_match(raw_sections.get("contents_raw", "")),
        "keywords": normalize_for_match(" ".join(keywords)),
    }
    corpora_raw = {
        "course_name": course_name,
        "objectives_raw": objectives_core,
        "minimum_contents_raw": raw_sections.get("minimum_contents_raw", ""),
        "conceptual_contents_raw": raw_sections.get("conceptual_contents_raw", ""),
        "procedural_contents_raw": raw_sections.get("procedural_contents_raw", ""),
        "contents_raw": raw_sections.get("contents_raw", ""),
        "keywords": " ".join(keywords),
    }
    local_concepts_norm = [normalize_for_match(item) for item in concepts_detected if item.strip()]

    source_weight = {
        "course_name": 2,
        "objectives_raw": 2,
        "minimum_contents_raw": 3,
        "conceptual_contents_raw": 3,
        "procedural_contents_raw": 2,
        "contents_raw": 2,
        "keywords": 1,
    }

    detected: List[Dict[str, Any]] = []
    for skill_label, patterns in SKILL_EVIDENCE_PATTERNS.items():
        exact_term = normalize_for_match(skill_label)
        score = 0
        evidence_sources: List[str] = []
        evidence_count = 0
        best_span = ""
        best_source = ""
        matched_signal = ""
        detection_mode = "semantic_match"

        for pattern in patterns:
            pattern_raw = pattern.strip()
            target = normalize_for_match(pattern_raw)
            if not target and skill_label != "C++":
                continue

            for source_name, corpus_norm in corpora_norm.items():
                corpus_raw = corpora_raw.get(source_name, "")
                if not corpus_norm and not corpus_raw:
                    continue
                count_here = skill_pattern_hit_count(skill_label, pattern_raw, corpus_raw, corpus_norm)
                if count_here <= 0:
                    continue

                evidence_count += count_here
                score += source_weight.get(source_name, 1) * count_here
                evidence_sources.append(source_name)
                if not matched_signal:
                    matched_signal = pattern_raw

                if source_name in {"minimum_contents_raw", "conceptual_contents_raw", "procedural_contents_raw", "contents_raw", "objectives_raw", "course_name"}:
                    source_raw = raw_sections.get(source_name, "") if source_name in raw_sections else (course_name if source_name == "course_name" else "")
                    span = find_evidence_span(source_raw or corpus_raw, target)
                    if span and (not best_span or len(span) > len(best_span)):
                        best_span = span
                        best_source = source_name

                if is_explicit_exact_skill_match(skill_label, pattern_raw):
                    detection_mode = "explicit_exact_match"
                elif detection_mode != "explicit_exact_match":
                    detection_mode = "explicit_alias_match"

        if evidence_count == 0:
            if skill_label in SKILLS_REQUIRING_CORE_EVIDENCE:
                local_support = None
            else:
                local_support = skill_has_local_concept_support(skill_label, local_concepts_norm, corpora_norm)
            if local_support:
                detection_mode = local_support[0]
                evidence_count = local_support[1]
                score = local_support[2]
                best_source = local_support[3]
                matched_signal = local_support[4]

        if evidence_count == 0:
            continue

        if skill_label in SKILLS_REQUIRING_CORE_EVIDENCE:
            has_core_evidence = any(source in CORE_CURRICULAR_SECTIONS for source in evidence_sources)
            if not has_core_evidence:
                continue
            if detection_mode not in {"explicit_exact_match", "explicit_alias_match"}:
                continue

        if skill_label in STRICT_TEXTUAL_SOFTWARE_SKILLS:
            signal_norm = normalize_for_match(matched_signal or "")
            skill_norm = normalize_for_match(skill_label)
            if not signal_norm or skill_norm not in signal_norm:
                continue
            if evidence_count < 1:
                continue

        base_confidence = 0.30 + (score * 0.07)
        if detection_mode in {"semantic_match_local_strong", "multiple_local_concept_support"}:
            base_confidence = max(base_confidence, 0.58)
        confidence = min(0.98, max(0.20, base_confidence))
        is_core = evidence_count >= 2 and confidence >= 0.68 and detection_mode != "semantic_match_local_strong"
        weight = confidence * (0.95 if is_core else 0.55)

        detected.append(
            {
                "skill": skill_label,
                "skill_id": canonical_id("skill", skill_label),
                "skill_label": skill_label,
                "detection_mode": detection_mode,
                "matched_signal": matched_signal or skill_label,
                "source_sections": dedupe_and_trim(evidence_sources + ([best_source] if best_source else []), 5),
                "evidence_source_section": best_source or "unknown",
                "evidence_text_span": best_span,
                "evidence_count": evidence_count,
                "confidence": round(confidence, 2),
                "is_core_skill_in_course": is_core,
                "skill_weight_in_course": round(min(1.0, weight), 2),
            }
        )

    detected.sort(key=lambda item: (item["confidence"], item["evidence_count"]), reverse=True)
    return detected[:10]


def estimate_hours_distribution(hours_total: Any, area_evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(hours_total, int) or hours_total <= 0 or not area_evidence:
        return {
            "distribution_method": "insufficient_data",
            "distribution_rationale": [],
            "by_area": [],
        }

    if area_evidence[0].get("area") == "unresolved_domain_candidate" or float(area_evidence[0].get("evidence_strength", 0.0)) < 0.5:
        return {
            "distribution_method": "insufficient_evidence_for_confident_area_assignment",
            "distribution_rationale": [],
            "by_area": [],
        }

    if len(area_evidence) == 1:
        area = area_evidence[0]
        return {
            "distribution_method": "single_area_assignment",
            "distribution_rationale": [
                {
                    "area_id": area["area_id"],
                    "area": area["area_label"],
                    "reason": "La evidencia semantica se concentra en una sola area dominante.",
                }
            ],
            "by_area": [
                {
                    "area": area["area_label"],
                    "area_id": area["area_id"],
                    "estimated_hours": hours_total,
                    "weight": 1.0,
                }
            ],
        }

    strengths = [max(0.05, float(item.get("evidence_strength", 0.4))) for item in area_evidence[:2]]
    strengths = [
        strength * (1.0 if item.get("evidence_section_kind") == "core_curricular_section" else 0.72 if item.get("evidence_section_kind") == "secondary_section" else 0.45)
        for strength, item in zip(strengths, area_evidence[:2])
    ]
    total_strength = sum(strengths)
    normalized_weights = [round(value / total_strength, 2) for value in strengths]

    # Keep weighted sum equal to total hours.
    first_hours = int(round(hours_total * normalized_weights[0]))
    second_hours = max(1, hours_total - first_hours)
    first_hours = max(1, first_hours)

    by_area = []
    rationale = []
    for idx, area in enumerate(area_evidence[:2]):
        est_hours = first_hours if idx == 0 else second_hours
        by_area.append(
            {
                "area": area["area_label"],
                "area_id": area["area_id"],
                "estimated_hours": est_hours,
                "weight": normalized_weights[idx],
            }
        )
        rationale.append(
            {
                "area_id": area["area_id"],
                "area": area["area_label"],
                "reason": build_distribution_reason(area),
            }
        )

    by_area[0]["estimated_hours"] = hours_total - by_area[1]["estimated_hours"]
    by_area[0]["weight"] = round(by_area[0]["estimated_hours"] / hours_total, 2)
    by_area[1]["weight"] = round(by_area[1]["estimated_hours"] / hours_total, 2)

    return {
        "distribution_method": "rule_based_weighting_from_area_signals",
        "distribution_rationale": rationale,
        "by_area": by_area,
    }


def build_quality_flags(
    candidate: CourseCandidate,
    objectives: List[str],
    concepts_detected: List[str],
    keywords: List[str],
    evidence_map: Dict[str, Any],
    skills_detected: List[Dict[str, Any]],
    hours_distribution_estimate: Dict[str, Any],
) -> Dict[str, Any]:
    section_count = len([key for key, value in candidate.raw_sections.items() if value.strip()])
    semantic_text = " ".join(objectives + concepts_detected)
    density = min(1.0, len(semantic_text) / 2200) if semantic_text else 0.0

    if section_count >= 3:
        sections_status = "rich"
    elif section_count >= 1:
        sections_status = "partial"
    else:
        sections_status = "missing"

    if candidate.title_quality_status in {"as_extracted", "recovered_from_filename", "recovered_from_header"} and density >= 0.3:
        semantic_status = "high"
    elif density >= 0.18:
        semantic_status = "medium"
    else:
        semantic_status = "low"

    core_objectives, transversal_objectives = split_objectives_sections(candidate.raw_sections.get("objectives_raw", ""))
    curricular_text = " ".join([
        candidate.raw_sections.get("minimum_contents_raw", ""),
        candidate.raw_sections.get("conceptual_contents_raw", ""),
        candidate.raw_sections.get("procedural_contents_raw", ""),
        candidate.raw_sections.get("contents_raw", ""),
        core_objectives,
    ])
    curricular_norm = normalize_for_match(curricular_text)
    concept_norm = {normalize_for_match(item) for item in concepts_detected if item.strip()}
    matched_concepts = 0
    for concept in concept_norm:
        if concept and concept in curricular_norm:
            matched_concepts += 1
    concept_coverage = matched_concepts / max(1, len(concept_norm)) if concept_norm else 0.0

    curricular_signal_strength = 0.0
    for section_name in ["minimum_contents_raw", "conceptual_contents_raw", "procedural_contents_raw", "contents_raw"]:
        section_norm = normalize_for_match(candidate.raw_sections.get(section_name, ""))
        if section_norm:
            curricular_signal_strength += min(1.0, len(section_norm) / 1500)
    curricular_signal_strength = min(1.0, curricular_signal_strength / 3.0)

    transversal_noise_risk = build_transversal_noise_risk(candidate.raw_sections.get("objectives_raw", ""))

    concepts_cleanliness = 0.0
    if concepts_detected:
        clean_count = len([concept for concept in concepts_detected if is_clean_concept(concept)])
        concepts_cleanliness = clean_count / len(concepts_detected)

    concept_norm = {normalize_for_match(item) for item in concepts_detected if item.strip()}
    keyword_norm = {normalize_for_match(item) for item in keywords if item.strip()}
    overlap = concept_norm.intersection(keyword_norm)
    redundancy = (len(overlap) / max(1, len(keyword_norm))) if keyword_norm else 0.0

    evidence_items = (evidence_map.get("areas") or []) + (evidence_map.get("skills") or [])
    traceable = 0
    for item in evidence_items:
        has_core_fields = bool(item.get("matched_signal")) and bool(item.get("evidence_source_section")) and bool(item.get("evidence_strength"))
        if has_core_fields:
            traceable += 1
    evidence_traceability = traceable / max(1, len(evidence_items)) if evidence_items else 0.0

    if skills_detected:
        reliability_values = []
        for skill in skills_detected:
            mode = skill.get("detection_mode", "semantic_match")
            mode_factor = 1.0 if mode in {"explicit_exact_match", "explicit_alias_match"} else (0.85 if mode == "semantic_match" else 0.65)
            count_factor = min(1.0, float(skill.get("evidence_count", 0)) / 3.0)
            reliability_values.append(float(skill.get("confidence", 0.0)) * mode_factor * count_factor)
        skills_reliability = sum(reliability_values) / len(reliability_values)
    else:
        skills_reliability = 0.0

    by_area = hours_distribution_estimate.get("by_area", []) if isinstance(hours_distribution_estimate, dict) else []
    if not by_area:
        hours_reliability = 0.0
    elif len(by_area) == 1:
        hours_reliability = 0.9
    else:
        strong_split = min(float(by_area[0].get("weight", 0.0)), float(by_area[1].get("weight", 0.0)))
        hours_reliability = min(0.95, 0.55 + strong_split)

    area_labels = [item.get("area_label", "") for item in (evidence_map.get("areas") or []) if item.get("area_label")]
    family = infer_candidate_domain_family(
        areas=area_labels,
        area_evidence=evidence_map.get("areas") or [],
        course_name=candidate.title_normalized or candidate.name or "",
        objectives=objectives,
        concepts=concepts_detected,
        keywords=keywords,
        transversal_noise_risk=transversal_noise_risk,
        is_project_course_flag=is_project_course(candidate.title_normalized or candidate.name or "", candidate.source_file),
    )
    family_gate = evaluate_family_coverage_gate(family, concepts_detected)

    area_assignment_status, confidence_reason = decide_area_assignment_status(
        area_evidence=evidence_map.get("areas") or [],
        family=family,
        family_gate=family_gate,
        concepts_detected=concepts_detected,
        concept_coverage=concept_coverage,
        curricular_signal_strength=curricular_signal_strength,
    )

    return {
        "title_quality_status": candidate.title_quality_status,
        "sections_detected_status": sections_status,
        "content_density_score": round(density, 3),
        "semantic_quality_status": semantic_status,
        "concepts_cleanliness_score": round(concepts_cleanliness, 3),
        "redundancy_score": round(redundancy, 3),
        "evidence_traceability_score": round(evidence_traceability, 3),
        "skills_detection_reliability": round(skills_reliability, 3),
        "hours_distribution_reliability": round(hours_reliability, 3),
        "concept_coverage_score": round(concept_coverage, 3),
        "curricular_signal_strength": round(curricular_signal_strength, 3),
        "transversal_noise_risk": round(transversal_noise_risk, 3),
        "area_assignment_status": area_assignment_status,
        "confidence_reason": confidence_reason,
        "domain_family_detected": family,
        "family_signal_sufficiency_status": family_gate["status"],
        "family_signal_hits": family_gate["hits"],
        "family_signal_expected_min_hits": family_gate["min_hits"],
        "family_signal_ratio": family_gate["ratio"],
        "family_signal_expected_min_ratio": family_gate["min_ratio"],
        "coverage_gate_triggered": family_gate["status"] in {"weak", "insufficient_concepts"},
    }


def decide_area_assignment_status(
    area_evidence: List[Dict[str, Any]],
    family: str,
    family_gate: Dict[str, Any],
    concepts_detected: List[str],
    concept_coverage: float,
    curricular_signal_strength: float,
) -> Tuple[str, str]:
    if not area_evidence:
        return "unresolved_domain_candidate", "no_area_evidence"

    top_area = area_evidence[0]
    if top_area.get("area") == "unresolved_domain_candidate":
        return "unresolved_domain_candidate", "explicit_unresolved_area"

    top_strength = float(top_area.get("evidence_strength", 0.0))
    second_strength = float(area_evidence[1].get("evidence_strength", 0.0)) if len(area_evidence) > 1 else 0.0
    strength_gap = top_strength - second_strength
    concept_count = len(concepts_detected)

    top_group = AREA_CONTEXT_GROUP.get(str(top_area.get("area_label", "")), "")
    second_group = ""
    if len(area_evidence) > 1:
        second_group = AREA_CONTEXT_GROUP.get(str(area_evidence[1].get("area_label", "")), "")
    same_track_dual_peak = bool(
        len(area_evidence) > 1
        and top_group
        and top_group == second_group
        and top_strength >= 0.9
        and second_strength >= 0.85
    )

    has_strong_local_signal = top_strength >= 0.76
    has_reasonable_local_signal = top_strength >= 0.58
    has_clear_primary_area = strength_gap >= 0.08 or len(area_evidence) == 1 or same_track_dual_peak

    gate_status = str(family_gate.get("status", "unknown"))
    gate_pass_or_na = gate_status in {"pass", "not_applicable"}

    has_semantic_sufficiency = (
        (concept_count >= 4 or concept_coverage >= 0.4)
        and (concept_count >= 3 or curricular_signal_strength >= 0.25)
        and curricular_signal_strength >= 0.2
    )

    if gate_pass_or_na and has_strong_local_signal and has_clear_primary_area and has_semantic_sufficiency:
        return "confident", "base_rule_confident"

    # Conservative V1.2 family calibration: only for gate=pass to avoid reopening confidence-gate inconsistency.
    calibrated_confident = False
    if gate_status == "pass" and has_clear_primary_area:
        if family == "mathematical_family":
            calibrated_confident = (
                (top_strength >= 0.76 and concept_coverage >= 0.60 and concept_count >= 3)
                or (top_strength >= 0.66 and concept_count >= 5 and concept_coverage >= 0.75 and curricular_signal_strength >= 0.14)
            )
        elif family == "industrial_family":
            calibrated_confident = (
                top_strength >= 0.92
                and strength_gap >= 0.12
                and concept_count >= 8
                and concept_coverage >= 0.75
                and curricular_signal_strength >= 0.18
            )
        elif family == "life_sciences_family":
            calibrated_confident = (
                top_strength >= 0.82
                and concept_count >= 9
                and concept_coverage >= 0.80
                and curricular_signal_strength >= 0.20
            )

    if calibrated_confident:
        # Non-negotiable invariant: never emit confident when gate is not pass/not_applicable.
        if gate_status not in {"pass", "not_applicable"}:
            return "low_confidence_multi_candidate", "gate_guard_prevents_confident"
        return "confident", "calibrated_family_override"

    if has_reasonable_local_signal:
        return "low_confidence_multi_candidate", "local_signal_without_semantic_sufficiency"

    return "insufficient_evidence_for_confident_area_assignment", "insufficient_local_evidence"


def skill_has_local_concept_support(
    skill_label: str,
    local_concepts_norm: List[str],
    corpora: Dict[str, str],
) -> Optional[Tuple[str, int, int, str, str]]:
    support_terms = SKILL_STRONG_LOCAL_CONCEPT_SUPPORT.get(skill_label, [])
    if not support_terms or not local_concepts_norm:
        return None

    support_matches = 0
    matched_signal = ""
    best_source = ""

    for concept_norm in local_concepts_norm:
        if not concept_norm:
            continue
        for support in support_terms:
            support_norm = normalize_for_match(support)
            if not support_norm:
                continue
            if support_norm == concept_norm or re.search(build_word_boundary_pattern(support_norm), concept_norm):
                support_matches += 1
                if not matched_signal:
                    matched_signal = support
                if not best_source:
                    best_source = "concepts_detected"

    if support_matches >= 2:
        return ("multiple_local_concept_support", support_matches, min(0.88, 0.44 + 0.12 * support_matches), best_source or "concepts_detected", matched_signal or skill_label)

    local_text = " ".join(corpora.values())
    for support in support_terms:
        support_norm = normalize_for_match(support)
        if not support_norm:
            continue
        pattern = build_word_boundary_pattern(support_norm)
        if re.search(pattern, local_text):
            matched_span = find_evidence_span(local_text, support_norm)
            if matched_span:
                return ("semantic_match_local_strong", 1, 1, "curricular_text", support)

    return None


def drop_generic_concepts_if_domain_specific_present(concepts: List[str]) -> List[str]:
    if not concepts:
        return []

    generic_norm = {normalize_for_match(item) for item in GENERIC_LOW_VALUE_CONCEPTS}
    non_generic = [item for item in concepts if normalize_for_match(item) not in generic_norm]
    if len(non_generic) >= 3:
        return non_generic
    return concepts


def build_context_generic_blocklist(contextual_groups: Set[str]) -> Set[str]:
    blocked: Set[str] = set()
    for group in contextual_groups:
        for term in CONTEXT_GENERIC_BLOCKLIST.get(group, set()):
            norm = normalize_for_match(term)
            if norm:
                blocked.add(norm)
    return blocked


def filter_ranked_concepts_by_context(concepts: List[str], contextual_term_norm: Set[str], blocked_norm: Set[str]) -> List[str]:
    if not concepts:
        return []

    base_filtered = drop_generic_concepts_if_domain_specific_present(concepts)
    if not blocked_norm:
        return base_filtered

    specific_count = 0
    for concept in base_filtered:
        if normalize_for_match(concept) in contextual_term_norm:
            specific_count += 1

    filtered = [concept for concept in base_filtered if normalize_for_match(concept) not in blocked_norm]
    if not filtered:
        return base_filtered

    # If we already have enough alternatives, drop blocked generic terms aggressively.
    if len(base_filtered) >= 3:
        return filtered

    if specific_count >= 4:
        return filtered

    return base_filtered


def sanitize_concepts_for_validated_areas(concepts: List[str], validated_areas: List[str]) -> List[str]:
    if not concepts:
        return []
    if not validated_areas:
        return concepts

    contextual_term_norm = build_contextual_term_set(validated_areas)
    contextual_groups = {
        AREA_CONTEXT_GROUP.get(area, "")
        for area in validated_areas
        if AREA_CONTEXT_GROUP.get(area, "")
    }
    blocked_norm = build_context_generic_blocklist(contextual_groups)
    return filter_ranked_concepts_by_context(concepts, contextual_term_norm, blocked_norm)


def build_evidence_map(area_evidence: List[Dict[str, Any]], skills: List[Dict[str, Any]]) -> Dict[str, Any]:
    skill_evidence = [
        {
            "skill": item["skill"],
            "skill_id": item["skill_id"],
            "skill_label": item["skill_label"],
            "matched_signal": item.get("matched_signal", item["skill"]),
            "detection_mode": item.get("detection_mode", "semantic_match"),
            "evidence_source_section": item.get("evidence_source_section", "unknown"),
            "evidence_section_kind": SECTION_EVIDENCE_PRIORITY.get(item.get("evidence_source_section", ""), "secondary_section"),
            "evidence_text_span": item.get("evidence_text_span", ""),
            "evidence_strength": item.get("confidence", 0.0),
            "evidence_count": item.get("evidence_count", 0),
            "confidence": item.get("confidence", 0.0),
        }
        for item in skills
    ]

    return {
        "areas": area_evidence,
        "skills": skill_evidence,
    }


def build_summary(name: str, concepts: List[str], areas: List[str], contents: List[str]) -> str:
    clean_name = strip_code_from_name(name) or "La materia"
    technical_topics = concepts[:4] if concepts else [format_canonical_label(item) for item in contents[:4]]
    if technical_topics:
        summary = f"{clean_name}: {', '.join(technical_topics)}."
    else:
        summary = f"{clean_name}: contenidos tecnicos del area."

    if areas:
        summary = f"{summary} Areas predominantes: {', '.join(areas[:2])}."

    summary = normalize_whitespace(summary)
    if len(summary) > 240:
        summary = summary[:237].rstrip() + "..."
    return summary


def build_text_for_embedding(
    name: str,
    summary: str,
    contents: List[str],
    concepts: List[str],
    keywords: List[str],
    areas: List[str],
    skills: List[str],
) -> str:
    parts = [name.strip(), summary.strip()]
    if contents:
        parts.append("Contenidos: " + ", ".join(contents[:6]))
    if concepts:
        parts.append("Conceptos normalizados: " + ", ".join(concepts[:14]))
    if keywords:
        concept_norm = {normalize_for_match(item) for item in concepts}
        clean_keywords = [item for item in keywords if normalize_for_match(item) not in concept_norm]
        if clean_keywords:
            parts.append("Keywords extraidas: " + ", ".join(clean_keywords[:8]))
    if areas:
        parts.append("Areas: " + ", ".join(areas))
    if skills:
        parts.append("Skills detectadas: " + ", ".join(skills))
    text = ". ".join(part for part in parts if part)
    return normalize_whitespace(text)


def build_semantic_output(candidate: CourseCandidate, max_objectives: int, max_contents: int) -> Dict[str, object]:
    objectives = build_objectives(candidate.raw_sections, max_objectives)
    contents = build_contents(candidate.raw_sections, max_contents)
    preliminary_keywords = build_keywords(candidate.raw_sections, objectives, contents, concepts=[])
    concepts_detected_raw = build_detected_concepts(
        candidate.raw_sections,
        max_items=max(max_contents * 2, 20),
        keywords=preliminary_keywords,
    )
    keywords = build_keywords(candidate.raw_sections, objectives, contents, concepts=concepts_detected_raw)

    transversal_noise_risk = build_transversal_noise_risk(candidate.raw_sections.get("objectives_raw", ""))
    area_inference = infer_areas_with_validation(
        candidate.name or "",
        candidate.source_file,
        objectives,
        concepts_detected_raw,
        keywords,
        transversal_noise_risk=transversal_noise_risk,
    )
    areas = area_inference.get("areas", ["unresolved_domain_candidate"])
    disciplinary_anchor = area_inference.get("disciplinary_anchor", {})
    area_validation_map = area_inference.get("area_validation_map", {})

    concepts_detected = sanitize_concepts_for_validated_areas(concepts_detected_raw, areas)
    area_evidence = build_area_evidence(areas, candidate.raw_sections, candidate.name or "", area_validation_map=area_validation_map)
    summary = build_summary(candidate.name or "Materia", concepts_detected, areas, contents)
    skills_detected = detect_skills(candidate.raw_sections, candidate.name or "", keywords, concepts_detected)
    hours_distribution_estimate = estimate_hours_distribution(candidate.hours_total, area_evidence)
    evidence_map = build_evidence_map(area_evidence, skills_detected)
    quality_flags = build_quality_flags(
        candidate,
        objectives,
        concepts_detected,
        keywords,
        evidence_map,
        skills_detected,
        hours_distribution_estimate,
    )
    areas_detected_detail = [
        {
            "area_id": item["area_id"],
            "area_label": item["area_label"],
            "evidence_strength": item["evidence_strength"],
        }
        for item in area_evidence
    ]

    clean_name = (candidate.title_normalized or candidate.name or "").strip()
    embedding_text = build_text_for_embedding(
        clean_name,
        summary,
        contents,
        concepts_detected,
        keywords,
        areas,
        [item["skill_label"] for item in skills_detected],
    )

    semantic_output = {
        "course_code": candidate.course_code,
        "name": clean_name,
        "title_extracted": candidate.title_extracted,
        "title_normalized": candidate.title_normalized,
        "title_quality_status": candidate.title_quality_status,
        "hours_total": candidate.hours_total,
        "objectives": objectives,
        "summary": summary,
        "contents": contents,
        "concepts_detected": concepts_detected,
        "keywords": keywords,
        "areas": areas,
        "areas_detected": areas,
        "areas_detected_detail": areas_detected_detail,
        "skills_detected": skills_detected,
        "hours_distribution_estimate": hours_distribution_estimate,
        "evidence_map": evidence_map,
        "quality_flags": quality_flags,
        "semantic_quality_status": quality_flags["semantic_quality_status"],
        "text_for_embedding": embedding_text,
        "source_file": candidate.source_file,
        "extraction_status": "ok",
    }

    if quality_flags.get("area_assignment_status") != "confident":
        semantic_output["candidate_domain_family"] = infer_candidate_domain_family(
            areas=areas,
            area_evidence=area_evidence,
            course_name=clean_name,
            objectives=objectives,
            concepts=concepts_detected,
            keywords=keywords,
            disciplinary_anchor=disciplinary_anchor,
            transversal_noise_risk=transversal_noise_risk,
            is_project_course_flag=is_project_course(clean_name, candidate.source_file),
        )

    return semantic_output


def clean_objective_item(text: str) -> str:
    cleaned = normalize_whitespace(text)
    if not cleaned:
        return ""

    low = normalize_for_match(cleaned)
    for prefix in GENERIC_OBJECTIVE_PREFIXES:
        norm_prefix = normalize_for_match(prefix)
        if low.startswith(norm_prefix):
            cleaned = cleaned[len(prefix):].strip(" :.-")
            low = normalize_for_match(cleaned)
            break

    cleaned = re.sub(r"^[a-z]\)\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\d+\.\s*", "", cleaned)
    cleaned = re.sub(r"^(ii|iii|iv|v)\.\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" .,:;\t")

    if len(cleaned) < 14:
        return ""
    if cleaned.lower().startswith("que el estudiante sea capaz de"):
        return ""
    if has_transversal_content(cleaned):
        return ""
    if is_noise_text(cleaned):
        return ""
    return cleaned


def merge_broken_content_fragments(items: List[str]) -> List[str]:
    merged: List[str] = []
    for item in items:
        token_count = len(item.split())
        if merged and token_count <= 3 and item[:1].islower():
            merged[-1] = normalize_whitespace(f"{merged[-1]} {item}")
            continue
        if merged and (merged[-1].endswith("-") or merged[-1].endswith("/")):
            merged[-1] = normalize_whitespace(f"{merged[-1].rstrip('-/')} {item}")
            continue
        merged.append(item)
    return merged


def is_noise_text(text: str) -> bool:
    normalized = normalize_for_match(text)
    return any(normalize_for_match(pattern) in normalized for pattern in NOISE_PATTERNS)


def build_keywords(
    raw_sections: Dict[str, str],
    objectives: List[str],
    contents: List[str],
    concepts: List[str],
) -> List[str]:
    seed_text = "\n".join(
        [
            raw_sections.get("minimum_contents_raw", ""),
            raw_sections.get("conceptual_contents_raw", ""),
            sanitize_contents_section(raw_sections.get("contents_raw", "")),
            " ".join(contents),
        ]
    )
    literal_keywords = extract_keyword_phrases(seed_text, max_phrase_words=8)
    distinctive = [format_canonical_label(term) for term in find_distinctive_terms(seed_text)]
    candidates = dedupe_and_trim(distinctive + literal_keywords, 20)

    concept_norm = {normalize_for_match(item) for item in concepts}
    selected: List[str] = []
    overlap_budget = max(2, int(len(candidates) * 0.35))
    overlap_count = 0

    for item in candidates:
        norm = normalize_for_match(item)
        if norm in concept_norm:
            if overlap_count >= overlap_budget:
                continue
            overlap_count += 1
        selected.append(item)
        if len(selected) >= 12:
            break

    return selected


def infer_disciplinary_anchor(
    course_name: str,
    source_file: str,
    objectives: List[str],
    contents: List[str],
    keywords: List[str],
    name_hints: List[str],
) -> Dict[str, Any]:
    source_name_clean = normalize_whitespace(source_file.replace("_", " ").replace(".pdf", "").replace(".PDF", ""))
    sources = {
        "name": normalize_for_match(course_name),
        "source_file": normalize_for_match(source_name_clean),
        "objectives": normalize_for_match(" ".join(objectives)),
        "contents": normalize_for_match(" ".join(contents)),
        "keywords": normalize_for_match(" ".join(keywords)),
    }
    source_weight = {
        "name": 4,
        "source_file": 3,
        "objectives": 2,
        "contents": 3,
        "keywords": 1,
    }

    scored: List[Tuple[str, float]] = []
    for area, profile in AREA_PROFILES.items():
        score = 0.0
        for signal in profile.get("strong", []):
            score += 1.8 * source_match_weight(signal, sources, source_weight) if appears_in_sources(signal, sources) else 0.0
        for signal in profile.get("medium", []):
            score += 1.2 * source_match_weight(signal, sources, source_weight) if appears_in_sources(signal, sources) else 0.0

        for signal in DOMAIN_CONCEPT_LEXICON.get(area, []):
            norm_signal = normalize_for_match(signal)
            if len(norm_signal) < 3:
                continue
            if re.search(build_word_boundary_pattern(norm_signal), sources["contents"]):
                score += 0.9
            elif re.search(build_word_boundary_pattern(norm_signal), sources["objectives"]):
                score += 0.55

        if area in name_hints:
            score += 7.5 if name_hints.index(area) == 0 else 5.0

        if score >= 2.0:
            scored.append((area, score))

    if not scored:
        return {
            "anchor_area": "",
            "anchor_group": "",
            "anchor_family": "",
            "anchor_score": 0.0,
            "anchor_confidence": 0.0,
        }

    scored.sort(key=lambda item: item[1], reverse=True)
    anchor_area, anchor_score = scored[0]
    second_score = scored[1][1] if len(scored) > 1 else 0.0
    confidence = anchor_score / max(anchor_score + second_score, 1e-6)
    anchor_group = AREA_CONTEXT_GROUP.get(anchor_area, "")
    anchor_family = DOMAIN_FAMILY_BY_CONTEXT.get(anchor_group, "")

    return {
        "anchor_area": anchor_area,
        "anchor_group": anchor_group,
        "anchor_family": anchor_family,
        "anchor_score": round(anchor_score, 3),
        "anchor_confidence": round(min(1.0, confidence), 3),
    }


def collect_signal_quality_metrics(area: str, profile: Dict[str, List[str]], sources: Dict[str, str]) -> Dict[str, Any]:
    all_text = " ".join(value for value in sources.values() if value)
    generic_hits = 0
    ambiguous_hits = 0
    ambiguous_missing_context = 0
    ambiguous_forbidden_context = 0
    affinity_mismatch_hits = 0
    high_specific_hits = 0
    medium_specific_hits = 0
    low_specific_hits = 0
    matched_signals: List[str] = []

    for bucket, signals in profile.items():
        for signal in signals:
            signal_norm = normalize_for_match(signal)
            if not signal_norm:
                continue
            if not re.search(build_word_boundary_pattern(signal_norm), all_text):
                continue

            matched_signals.append(signal_norm)
            if signal_norm in GENERIC_SIGNAL_TERMS:
                generic_hits += 1

            rule = AMBIGUOUS_SIGNAL_RULES.get(signal_norm)
            if rule:
                ambiguous_hits += 1
                required = [normalize_for_match(item) for item in rule.get("requires_cooccurrence_with", []) if normalize_for_match(item)]
                if required and not any(re.search(build_word_boundary_pattern(term), all_text) for term in required):
                    ambiguous_missing_context += 1

                forbidden = [normalize_for_match(item) for item in rule.get("forbidden_contexts", []) if normalize_for_match(item)]
                if forbidden and any(re.search(build_word_boundary_pattern(term), all_text) for term in forbidden):
                    ambiguous_forbidden_context += 1

                affinity = rule.get("disciplinary_affinity", []) or []
                if affinity and area not in affinity:
                    affinity_mismatch_hits += 1

            specificity_level = "medium"
            if signal_norm in GENERIC_SIGNAL_TERMS:
                specificity_level = "low"
            elif bucket == "strong" and len(signal_norm) >= 8 and " " in signal_norm:
                specificity_level = "high"
            elif bucket == "light":
                specificity_level = "low"

            if specificity_level == "high":
                high_specific_hits += 1
            elif specificity_level == "medium":
                medium_specific_hits += 1
            else:
                low_specific_hits += 1

    return {
        "generic_hits": generic_hits,
        "ambiguous_hits": ambiguous_hits,
        "ambiguous_missing_context": ambiguous_missing_context,
        "ambiguous_forbidden_context": ambiguous_forbidden_context,
        "affinity_mismatch_hits": affinity_mismatch_hits,
        "high_specific_hits": high_specific_hits,
        "medium_specific_hits": medium_specific_hits,
        "low_specific_hits": low_specific_hits,
        "matched_signals": matched_signals,
    }


def infer_areas_with_validation(
    name: str,
    source_file: str,
    objectives: List[str],
    contents: List[str],
    keywords: List[str],
    transversal_noise_risk: float = 0.0,
) -> Dict[str, Any]:
    source_name_clean = normalize_whitespace(source_file.replace("_", " ").replace(".pdf", "").replace(".PDF", ""))
    sources = {
        "name": normalize_for_match(name),
        "source_file": normalize_for_match(source_name_clean),
        "objectives": normalize_for_match(" ".join(objectives)),
        "contents": normalize_for_match(" ".join(contents)),
        "keywords": normalize_for_match(" ".join(keywords)),
    }
    source_weight = {
        "name": 3,
        "source_file": 3,
        "objectives": 2,
        "contents": 3,
        "keywords": 2,
    }

    name_hints = infer_name_hints(sources["name"])
    source_hints = infer_name_hints(sources["source_file"])
    for area in source_hints:
        if area not in name_hints:
            name_hints.append(area)

    anchor = infer_disciplinary_anchor(
        course_name=name,
        source_file=source_file,
        objectives=objectives,
        contents=contents,
        keywords=keywords,
        name_hints=name_hints,
    )
    anchor_group = anchor.get("anchor_group", "")
    anchor_area = anchor.get("anchor_area", "")
    anchor_family = anchor.get("anchor_family", "")
    is_project_like = is_project_course(name, source_file)

    candidates: List[Dict[str, Any]] = []
    for area, profile in AREA_PROFILES.items():
        raw_score, strong_hits, total_hits = score_area_profile(profile, sources, source_weight)
        context_unique, context_total_hits, context_section_hits = collect_area_context_support(area, sources)
        if area in AREA_ANCHOR_REQUIREMENTS and not has_area_anchor_support(area, sources):
            continue

        coherence_bonus = min(12, (2 * context_unique) + context_section_hits + min(3, context_total_hits // 2))
        isolation_penalty = 8 if context_unique <= 1 and strong_hits <= 1 and total_hits <= 2 else 0
        raw_area_signal_score = float(raw_score + coherence_bonus - isolation_penalty)
        if area in name_hints:
            raw_area_signal_score += 12 if name_hints.index(area) == 0 else 8

        if strong_hits == 0 and total_hits < 2 and raw_area_signal_score < 8 and (area != "Machine Learning" or raw_area_signal_score < 5):
            continue
        if area in MATH_STATS_AREAS and not name_has_math_signal(sources["name"]) and raw_area_signal_score < 10:
            continue
        if raw_area_signal_score < 4:
            continue

        quality = collect_signal_quality_metrics(area, profile, sources)
        contextual_consistency = min(1.0, (context_unique * 0.28) + (strong_hits * 0.2) + (context_section_hits * 0.12))
        area_group = AREA_CONTEXT_GROUP.get(area, "")
        anchor_alignment_factor = 1.0
        if anchor_group and area_group and area_group == anchor_group:
            anchor_alignment_factor = 0.78

        generic_penalty_base = quality["generic_hits"] * (3.3 + (1.7 * transversal_noise_risk))
        generic_penalty = generic_penalty_base * (1.0 - (0.38 * contextual_consistency)) * anchor_alignment_factor

        ambiguity_missing_base = quality["ambiguous_missing_context"] * (4.7 + (1.9 * transversal_noise_risk))
        ambiguity_missing_penalty = ambiguity_missing_base * (1.0 - (0.34 * contextual_consistency)) * anchor_alignment_factor
        ambiguity_penalty = (
            ambiguity_missing_penalty
            + quality["ambiguous_forbidden_context"] * 7.5
            + quality["affinity_mismatch_hits"] * 4.0
        )
        specificity_bonus = (quality["high_specific_hits"] * 1.6) + (quality["medium_specific_hits"] * 0.8) - (quality["low_specific_hits"] * 0.35)

        anchor_alignment_bonus = 0.0
        anchor_mismatch_penalty = 0.0
        if anchor_group and area_group:
            if area_group == anchor_group:
                anchor_alignment_bonus += 6.0
            elif frozenset({anchor_group, area_group}) in INCOMPATIBLE_CONTEXT_GROUPS:
                anchor_mismatch_penalty += 8.0
            else:
                anchor_mismatch_penalty += 3.0

        title_coherence_bonus = 0.0
        if area in name_hints:
            title_coherence_bonus += 8.0 if name_hints.index(area) == 0 else 4.0
        elif anchor_area and area == anchor_area:
            title_coherence_bonus += 3.0

        project_drift_penalty = 0.0
        if is_project_like and area in PROJECT_OPERATIONAL_AREAS and anchor_family and anchor_family != "industrial_family":
            project_drift_penalty = 8.0

        validated_area_score = raw_area_signal_score + specificity_bonus + anchor_alignment_bonus + title_coherence_bonus
        validated_area_score -= generic_penalty + ambiguity_penalty + anchor_mismatch_penalty + project_drift_penalty

        validation_flags: List[str] = []
        if generic_penalty > 0:
            validation_flags.append("generic_term_penalty_applied")
        if ambiguity_penalty > 0:
            validation_flags.append("ambiguous_context_penalty_applied")
        if project_drift_penalty > 0:
            validation_flags.append("project_discipline_preservation_penalty")
        if anchor_alignment_bonus > 0:
            validation_flags.append("disciplinary_anchor_alignment_bonus")

        candidates.append(
            {
                "area": area,
                "raw_area_signal_score": round(raw_area_signal_score, 3),
                "validated_area_score": round(float(validated_area_score), 3),
                "strong_hits": strong_hits,
                "total_hits": total_hits,
                "context_unique": context_unique,
                "context_section_hits": context_section_hits,
                "generic_hits": quality["generic_hits"],
                "ambiguous_missing_context": quality["ambiguous_missing_context"],
                "ambiguous_forbidden_context": quality["ambiguous_forbidden_context"],
                "validation_flags": validation_flags,
            }
        )

    if not candidates:
        fallback = name_hints[:2] if name_hints else ["unresolved_domain_candidate"]
        return {
            "areas": fallback,
            "ranked_candidates": [],
            "disciplinary_anchor": anchor,
            "area_validation_map": {},
        }

    candidates.sort(
        key=lambda item: (item["validated_area_score"], item["raw_area_signal_score"], item["context_unique"], item["strong_hits"]),
        reverse=True,
    )
    primary = candidates[0]
    primary_area = primary["area"]
    primary_score = float(primary["validated_area_score"])

    if primary_area in FOUNDATIONAL_AREAS:
        applied_candidate = next(
            (
                item
                for item in candidates
                if item["area"] in APPLIED_PRIORITY_AREAS
                and (float(item["validated_area_score"]) >= float(primary_score * 0.75) or int(item["strong_hits"]) >= 1)
            ),
            None,
        )
        if applied_candidate:
            primary = applied_candidate
            primary_area = applied_candidate["area"]
            primary_score = float(applied_candidate["validated_area_score"])

    result = [primary_area]
    secondary_min = SEMANTIC_V16_THRESHOLDS["secondary_validated_min"]
    secondary_ratio_min = SEMANTIC_V16_THRESHOLDS["secondary_ratio_min"]
    secondary_gap_min = SEMANTIC_V16_THRESHOLDS["relative_gap_min"]
    if transversal_noise_risk >= 0.72:
        secondary_min = SEMANTIC_V16_THRESHOLDS["secondary_validated_min_very_high_noise"]
        secondary_ratio_min = SEMANTIC_V16_THRESHOLDS["secondary_ratio_min_high_noise"]
        secondary_gap_min = SEMANTIC_V16_THRESHOLDS["relative_gap_min_high_noise"]
    elif transversal_noise_risk >= 0.55:
        secondary_min = SEMANTIC_V16_THRESHOLDS["secondary_validated_min_high_noise"]
        secondary_ratio_min = SEMANTIC_V16_THRESHOLDS["secondary_ratio_min_high_noise"]
        secondary_gap_min = SEMANTIC_V16_THRESHOLDS["relative_gap_min_high_noise"]

    for item in candidates[1:]:
        if len(result) >= 2:
            break
        area = item["area"]
        score = float(item["validated_area_score"])

        if score < secondary_min:
            continue
        if not allow_secondary_area(primary_area, area, score, primary_score, sources["name"]):
            continue

        strong_secondary_evidence = (
            (int(item["strong_hits"]) >= 2 and int(item["context_unique"]) >= 3)
            or (int(item["strong_hits"]) >= 1 and int(item["context_unique"]) >= 2 and int(item["context_section_hits"]) >= 2)
        )
        if score < (primary_score * secondary_ratio_min) and not strong_secondary_evidence and area not in name_hints:
            continue
        if (primary_score - score) > secondary_gap_min and not strong_secondary_evidence and area not in name_hints:
            continue

        result.append(area)

    preferred_pair = PAIR_PRIORITY.get(primary_area)
    if preferred_pair and preferred_pair not in result and len(result) < 2:
        pair_item = next((item for item in candidates if item["area"] == preferred_pair), None)
        if pair_item and float(pair_item["validated_area_score"]) >= secondary_min:
            result.append(preferred_pair)

    if len(result) == 1:
        promoted = try_promote_general_specific_pair(
            result[0],
            [(item["area"], float(item["validated_area_score"]), int(item["strong_hits"]), int(item["total_hits"])) for item in candidates],
        )
        if promoted and promoted not in result:
            promoted_item = next((item for item in candidates if item["area"] == promoted), None)
            if promoted_item and float(promoted_item["validated_area_score"]) >= secondary_min:
                result.append(promoted)

    result = post_filter_inconsistent_pairs(result, name_hints)
    if not result:
        result = ["unresolved_domain_candidate"]

    area_validation_map = {
        item["area"]: {
            "raw_area_signal_score": item["raw_area_signal_score"],
            "validated_area_score": item["validated_area_score"],
            "validation_flags": item["validation_flags"],
            "generic_hits": item["generic_hits"],
            "ambiguous_missing_context": item["ambiguous_missing_context"],
            "ambiguous_forbidden_context": item["ambiguous_forbidden_context"],
        }
        for item in candidates
    }

    return {
        "areas": result[:2],
        "ranked_candidates": candidates,
        "disciplinary_anchor": anchor,
        "area_validation_map": area_validation_map,
    }


def infer_areas(
    name: str,
    source_file: str,
    objectives: List[str],
    contents: List[str],
    keywords: List[str],
) -> List[str]:
    return infer_areas_with_validation(name, source_file, objectives, contents, keywords).get("areas", ["unresolved_domain_candidate"])


def infer_candidate_domain_family(
    areas: List[str],
    area_evidence: List[Dict[str, Any]],
    course_name: str,
    objectives: List[str],
    concepts: List[str],
    keywords: List[str],
    disciplinary_anchor: Optional[Dict[str, Any]] = None,
    transversal_noise_risk: float = 0.0,
    is_project_course_flag: bool = False,
) -> str:
    weak_signal_markers = {"name_or_context_match", "name or context match", "unknown"}
    protected_name_hint_areas = {
        "Arquitectura de Aplicaciones",
        "Ingeniería de Software",
        "Algoritmos y Estructuras de Datos",
        "Telecomunicaciones",
        "Redes y Comunicaciones",
        "Redes de Computadoras y Servicios de Red",
        "Telecomunicaciones de Datos",
        "Gestión de Proyectos Tecnológicos",
        "Gestión Económica Industrial",
    }

    area_strength_by_label: Dict[str, float] = {}
    for evidence in area_evidence:
        area_label = str(evidence.get("area_label", "")).strip()
        if not area_label or area_label == "unresolved_domain_candidate":
            continue
        strength = max(float(evidence.get("evidence_strength", 0.0)), float(evidence.get("validated_area_score", 0.0)) / 40.0)
        if strength > area_strength_by_label.get(area_label, 0.0):
            area_strength_by_label[area_label] = strength

    if disciplinary_anchor is None:
        disciplinary_anchor = infer_disciplinary_anchor(
            course_name=course_name,
            source_file="",
            objectives=objectives,
            contents=concepts,
            keywords=keywords,
            name_hints=infer_name_hints(normalize_for_match(course_name)),
        )
    anchor_area = str(disciplinary_anchor.get("anchor_area", ""))
    anchor_group = str(disciplinary_anchor.get("anchor_group", ""))
    anchor_family = str(disciplinary_anchor.get("anchor_family", ""))
    anchor_confidence = float(disciplinary_anchor.get("anchor_confidence", 0.0))

    top_family = ""
    top_strength = 0.0
    top_area = ""
    if area_evidence:
        top = area_evidence[0]
        top_area = top.get("area_label", "")
        top_group = AREA_CONTEXT_GROUP.get(top_area, "")
        top_family = DOMAIN_FAMILY_BY_CONTEXT.get(top_group, "")
        top_strength = max(float(top.get("evidence_strength", 0.0)), float(top.get("validated_area_score", 0.0)) / 40.0)

    # Protective lock: if the course name strongly hints a stable disciplinary area,
    # keep that family when evidence is close to the top candidate.
    name_hint_areas = infer_name_hints(normalize_for_match(course_name))
    for hinted_area in name_hint_areas:
        if hinted_area not in protected_name_hint_areas:
            continue
        hinted_strength = area_strength_by_label.get(hinted_area, 0.0)
        hinted_group = AREA_CONTEXT_GROUP.get(hinted_area, "")
        hinted_family = DOMAIN_FAMILY_BY_CONTEXT.get(hinted_group, "")
        if not hinted_family:
            continue
        if hinted_strength < 0.72:
            continue
        if top_family and hinted_family != top_family and hinted_strength < (top_strength * 0.9):
            continue
        return hinted_family

    # Rule E: keep non-generic family if title-anchor is strong and there is no hard contradiction.
    top_group = AREA_CONTEXT_GROUP.get(top_area, "")
    if anchor_family and anchor_family != "generic_academic_family" and anchor_confidence >= SEMANTIC_V16_THRESHOLDS["family_anchor_protection_min"]:
        compatible_top = (not top_group) or (not anchor_group) or (top_group == anchor_group)
        hard_contradiction = bool(top_group and anchor_group and frozenset({top_group, anchor_group}) in INCOMPATIBLE_CONTEXT_GROUPS and top_strength >= 0.86)
        content_override = bool(top_family and top_family != "generic_academic_family" and top_family != anchor_family and top_strength >= 0.8)
        if compatible_top and not hard_contradiction:
            if (top_family == "generic_academic_family" or top_family == "") and not content_override:
                return anchor_family

    # Rule F: project courses should preserve mother-discipline family over operational management drift.
    if is_project_course_flag and anchor_family and anchor_family != "industrial_family":
        if top_family == "industrial_family" and anchor_confidence >= 0.55:
            return anchor_family

    # Strong area evidence should dominate family selection to avoid collateral-family drift.
    if area_evidence:
        top = area_evidence[0]
        top_area = top.get("area_label", "")
        top_group = AREA_CONTEXT_GROUP.get(top_area, "")
        top_family = DOMAIN_FAMILY_BY_CONTEXT.get(top_group, "")
        top_strength = max(float(top.get("evidence_strength", 0.0)), float(top.get("validated_area_score", 0.0)) / 40.0)
        top_signal = normalize_for_match(str(top.get("matched_signal", "")))
        if top_family and top_strength >= 0.78 and top_signal not in weak_signal_markers:
            return top_family

    semantic_text = normalize_for_match(
        " ".join([
            course_name,
            " ".join(objectives),
            " ".join(concepts),
            " ".join(keywords),
        ])
    )
    if not semantic_text:
        if top_family and top_family != "generic_academic_family" and top_strength >= 0.65:
            return top_family
        return "generic_academic_family"

    family_scores: Dict[str, float] = {}

    for evidence in area_evidence:
        area_label = evidence.get("area_label", "")
        if not area_label or area_label == "unresolved_domain_candidate":
            continue
        context_group = AREA_CONTEXT_GROUP.get(area_label, "")
        family = DOMAIN_FAMILY_BY_CONTEXT.get(context_group, "")
        if not family:
            continue

        strength = max(float(evidence.get("evidence_strength", 0.0)), float(evidence.get("validated_area_score", 0.0)) / 40.0)
        if strength <= 0:
            continue

        matched_signal = normalize_for_match(str(evidence.get("matched_signal", "")))
        source_section = str(evidence.get("evidence_source_section", ""))
        source_boost = 1.0 if source_section in CORE_CURRICULAR_SECTIONS else (0.72 if source_section in SECONDARY_SECTIONS else 0.58)

        if matched_signal in weak_signal_markers and strength < 0.5:
            # Weak name-only matches should not determine the family on their own.
            family_scores[family] = family_scores.get(family, 0.0) + (strength * 0.28)
            continue

        area_boost = 1.22 if area_label in CORE_EXACT_DOMAIN_AREAS else 0.88
        signal_boost = 1.0 if matched_signal not in weak_signal_markers else 0.7
        anchor_boost = 1.0
        if anchor_group and context_group == anchor_group:
            anchor_boost = 1.18
        elif anchor_group and context_group and frozenset({anchor_group, context_group}) in INCOMPATIBLE_CONTEXT_GROUPS:
            anchor_boost = 0.62

        family_scores[family] = family_scores.get(family, 0.0) + (strength * area_boost * source_boost * signal_boost * anchor_boost)

    for family, terms in DOMAIN_FAMILY_HINTS.items():
        for term in terms:
            term_norm = normalize_for_match(term)
            if len(term_norm) < 3:
                continue
            if re.search(build_word_boundary_pattern(term_norm), semantic_text):
                term_bonus = 0.16 if len(term_norm) <= 4 else 0.24 if " " not in term_norm else 0.34
                noise_penalty = 0.9 if transversal_noise_risk >= 0.6 else 1.0
                family_scores[family] = family_scores.get(family, 0.0) + (term_bonus * noise_penalty)

    if anchor_family and anchor_confidence >= 0.6:
        family_scores[anchor_family] = family_scores.get(anchor_family, 0.0) + (0.34 + 0.22 * min(anchor_confidence, 1.0))

    if not family_scores:
        if top_family and top_family != "generic_academic_family" and top_strength >= 0.65:
            return top_family
        return "generic_academic_family"

    ranked = sorted(family_scores.items(), key=lambda item: (item[1], len(item[0])), reverse=True)
    best_family, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0

    if best_score < 0.9:
        if top_family and top_family != "generic_academic_family" and top_strength >= 0.72:
            return top_family
        return "generic_academic_family"
    required_margin = 1.15 if transversal_noise_risk < 0.55 else 1.22
    if second_score > 0 and best_score < (second_score * required_margin) and best_score < 1.45:
        if top_family and top_family != "generic_academic_family" and top_strength >= 0.74:
            return top_family
        return "generic_academic_family"

    if best_family == "generic_academic_family" and anchor_family and anchor_confidence >= 0.62:
        return anchor_family

    return best_family


def build_family_expected_terms(family: str) -> Set[str]:
    expected: Set[str] = set()

    for area, group in AREA_CONTEXT_GROUP.items():
        mapped_family = DOMAIN_FAMILY_BY_CONTEXT.get(group, "")
        if mapped_family != family:
            continue
        for term in DOMAIN_CONCEPT_LEXICON.get(area, []):
            norm = normalize_for_match(term)
            if len(norm) >= 3:
                expected.add(norm)

    for term in DOMAIN_FAMILY_HINTS.get(family, []):
        norm = normalize_for_match(term)
        if len(norm) >= 3:
            expected.add(norm)

    return expected


def evaluate_family_coverage_gate(family: str, concepts_detected: List[str]) -> Dict[str, Any]:
    gate_cfg = FAMILY_COVERAGE_GATE.get(family, {"min_hits": 2.0, "min_ratio": 0.3})
    min_hits = int(gate_cfg.get("min_hits", 2))
    min_ratio = float(gate_cfg.get("min_ratio", 0.3))

    if family in {"generic_academic_family", "unresolved_or_unknown_family", "generic_academic"}:
        return {
            "status": "not_applicable",
            "hits": 0,
            "min_hits": min_hits,
            "ratio": 0.0,
            "min_ratio": round(min_ratio, 3),
        }

    if not concepts_detected:
        return {
            "status": "insufficient_concepts",
            "hits": 0,
            "min_hits": min_hits,
            "ratio": 0.0,
            "min_ratio": round(min_ratio, 3),
        }

    expected_terms = build_family_expected_terms(family)
    concept_norm = [normalize_for_match(item) for item in concepts_detected if item.strip()]
    hits = sum(1 for term in concept_norm if term in expected_terms)
    ratio = hits / max(1, len(concept_norm))
    status = "pass" if hits >= min_hits and ratio >= min_ratio else "weak"

    return {
        "status": status,
        "hits": hits,
        "min_hits": min_hits,
        "ratio": round(ratio, 3),
        "min_ratio": round(min_ratio, 3),
    }


def try_promote_general_specific_pair(primary: str, scored: List[tuple[str, float, int, int]]) -> str:
    if primary in {"Ingeniería de Software", "Datos", "Inteligencia Artificial"}:
        ordered_candidates = {
            "Ingeniería de Software": ["Arquitectura de Aplicaciones", "Cloud Computing", "Desarrollo de Aplicaciones Móviles"],
            "Datos": ["Inteligencia Artificial", "Machine Learning", "Ingeniería de Datos", "Bases de Datos"],
            "Inteligencia Artificial": ["Machine Learning", "Datos"],
        }.get(primary, [])

        for candidate in ordered_candidates:
            item = next((entry for entry in scored if entry[0] == candidate), None)
            if item and item[1] >= 3:
                return candidate

    if primary in {"Arquitectura de Aplicaciones", "Cloud Computing", "Desarrollo de Aplicaciones Móviles"}:
        return "Ingeniería de Software"

    return ""


def infer_name_hints(normalized_name: str) -> List[str]:
    hints: List[str] = []
    for signal, areas in NAME_AREA_HINTS.items():
        signal_norm = normalize_for_match(signal)
        if not signal_norm:
            continue
        # Word-boundary match (not plain substring): un signal corto como
        # "cam" (hint de "Manufactura y CAD/CAM") no debe matchear dentro de
        # "bootcamp". Mismo criterio que appears_in_sources/
        # build_word_boundary_pattern usan para el resto de los signals de
        # area — infer_name_hints era la unica ruta que todavia comparaba
        # por "in" plano.
        if re.search(build_word_boundary_pattern(signal_norm), normalized_name):
            for area in areas:
                if area not in hints:
                    hints.append(area)
    return hints[:2]


def has_area_anchor_support(area: str, sources: Dict[str, str]) -> bool:
    anchors = AREA_ANCHOR_REQUIREMENTS.get(area, [])
    if not anchors:
        return True

    joined_sources = " ".join(sources.values())
    for anchor in anchors:
        anchor_norm = normalize_for_match(anchor)
        if not anchor_norm:
            continue
        if re.search(build_word_boundary_pattern(anchor_norm), joined_sources):
            return True

    return False


def post_filter_inconsistent_pairs(areas: List[str], name_hints: List[str]) -> List[str]:
    if not areas:
        return areas

    filtered = list(areas)

    # If a strong name hint exists, prioritize it over unrelated math/stat labels.
    if name_hints:
        primary_hint = name_hints[0]
        if primary_hint in CORE_EXACT_DOMAIN_AREAS:
            filtered = [a for a in filtered if a not in MATH_STATS_AREAS or a in name_hints]
            if primary_hint not in filtered:
                filtered.insert(0, primary_hint)

    deduped: List[str] = []
    for area in filtered:
        if area not in deduped:
            deduped.append(area)

    return deduped[:2]


def allow_secondary_area(primary: str, candidate: str, candidate_score: float, primary_score: float, name_source: str) -> bool:
    if candidate == primary:
        return False

    if candidate in MATH_STATS_AREAS and primary in CORE_EXACT_DOMAIN_AREAS and not name_has_math_signal(name_source):
        return False

    if primary in {"Inteligencia Artificial", "Ingeniería de Datos", "Redes de Datos", "Telecomunicaciones"} and candidate == "Matemática":
        return False

    if primary in APPLIED_PRIORITY_AREAS and candidate in FOUNDATIONAL_AREAS and candidate_score < int(primary_score * 0.9):
        return False

    if candidate_score < int(primary_score * 0.55):
        return False

    return True


def name_has_math_signal(name_source: str) -> bool:
    return any(normalize_for_match(signal) in name_source for signal in MATH_NAME_SIGNALS)


def score_area_profile(
    profile: Dict[str, List[str]],
    sources: Dict[str, str],
    source_weight: Dict[str, int],
) -> tuple[int, int, int]:
    score = 0
    strong_hits = 0
    total_hits = 0

    for signal in profile.get("strong", []):
        if appears_in_sources(signal, sources):
            strong_hits += 1
            total_hits += 1
            score += 4 * source_match_weight(signal, sources, source_weight)

    for signal in profile.get("medium", []):
        if appears_in_sources(signal, sources):
            total_hits += 1
            score += 2 * source_match_weight(signal, sources, source_weight)

    for signal in profile.get("light", []):
        if appears_in_sources(signal, sources):
            total_hits += 1
            score += source_match_weight(signal, sources, source_weight)

    return score, strong_hits, total_hits


def appears_in_sources(signal: str, sources: Dict[str, str]) -> bool:
    target = normalize_for_match(signal)
    if not target:
        return False

    # Word-boundary style matching in normalized text prevents accidental partial matches.
    pattern = r"(?<![a-z0-9])" + re.escape(target) + r"(?![a-z0-9])"
    return any(re.search(pattern, corpus) for corpus in sources.values() if corpus)


def source_match_weight(signal: str, sources: Dict[str, str], source_weight: Dict[str, int]) -> int:
    target = normalize_for_match(signal)
    pattern = r"(?<![a-z0-9])" + re.escape(target) + r"(?![a-z0-9])"
    weight = 1
    for source_name, corpus in sources.items():
        if re.search(pattern, corpus):
            weight = max(weight, source_weight.get(source_name, 1))
    return weight


def collect_area_context_support(area: str, sources: Dict[str, str]) -> Tuple[int, int, int]:
    profile = AREA_PROFILES.get(area, {})
    context_terms = set(profile.get("strong", []) + profile.get("medium", []) + DOMAIN_CONCEPT_LEXICON.get(area, []))

    unique_hits = 0
    total_hits = 0
    section_hits = 0

    for source_name, corpus in sources.items():
        if not corpus:
            continue
        source_hit = False
        for term in context_terms:
            norm_term = normalize_for_match(term)
            if len(norm_term) < 3:
                continue
            pattern = build_word_boundary_pattern(norm_term)
            hits = len(re.findall(pattern, corpus))
            if hits <= 0:
                continue
            total_hits += hits
            source_hit = True
        if source_hit:
            section_hits += 1

    all_text = " ".join(sources.values())
    for term in context_terms:
        norm_term = normalize_for_match(term)
        if len(norm_term) < 3:
            continue
        if re.search(build_word_boundary_pattern(norm_term), all_text):
            unique_hits += 1

    return unique_hits, total_hits, section_hits


def infer_context_areas_from_text(normalized_text: str) -> List[str]:
    if not normalized_text:
        return []

    scored: List[Tuple[str, int, int]] = []
    for area in AREA_PROFILES.keys():
        terms = set(AREA_PROFILES.get(area, {}).get("strong", []) + AREA_PROFILES.get(area, {}).get("medium", []) + DOMAIN_CONCEPT_LEXICON.get(area, []))
        unique_hits = 0
        total_hits = 0
        for term in terms:
            norm_term = normalize_for_match(term)
            if len(norm_term) < 3:
                continue
            pattern = build_word_boundary_pattern(norm_term)
            hits = len(re.findall(pattern, normalized_text))
            if hits > 0:
                unique_hits += 1
                total_hits += hits
        if unique_hits >= 2:
            score = (2 * unique_hits) + min(5, total_hits)
            scored.append((area, score, unique_hits))

    if scored:
        scored.sort(key=lambda item: (item[1], item[2]), reverse=True)
        return [item[0] for item in scored[:2]]

    fallback: List[Tuple[str, int, int]] = []
    for area in AREA_PROFILES.keys():
        terms = set(AREA_PROFILES.get(area, {}).get("strong", []) + AREA_PROFILES.get(area, {}).get("medium", []))
        unique_hits = 0
        total_hits = 0
        for term in terms:
            norm_term = normalize_for_match(term)
            if len(norm_term) < 3:
                continue
            pattern = build_word_boundary_pattern(norm_term)
            hits = len(re.findall(pattern, normalized_text))
            if hits > 0:
                unique_hits += 1
                total_hits += hits
        if unique_hits >= 1 and total_hits >= 2:
            fallback.append((area, total_hits + unique_hits, unique_hits))

    fallback.sort(key=lambda item: (item[1], item[2]), reverse=True)
    return [item[0] for item in fallback[:2]]


def build_contextual_term_set(areas: List[str]) -> Set[str]:
    contextual_terms: Set[str] = set()
    for area in areas:
        for term in DOMAIN_CONCEPT_LEXICON.get(area, []):
            norm = normalize_for_match(term)
            if len(norm) >= 3:
                contextual_terms.add(norm)
    return contextual_terms


def concept_specificity_bonus(concept_label: str) -> float:
    norm = normalize_for_match(concept_label)
    if not norm:
        return 0.0

    bonus = 0.0
    words = norm.split()
    if len(words) >= 2:
        bonus += 0.08
    if len(norm) >= 12:
        bonus += 0.05
    if re.search(r"\b(anova|chi cuadrado|navier stokes|reynolds|transformada de fourier|tcp ip|dns|dhcp|thevenin|norton)\b", norm):
        bonus += 0.1
    return bonus


def repair_line_breaks(text: str) -> str:
    text = normalize_whitespace(text)
    if not text:
        return ""

    # Join wrapped lines while preserving clear paragraph breaks.
    text = re.sub(r"\n(?=[a-záéíóúñ])", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<![\.:;])\n(?=[A-Za-zÁÉÍÓÚÑáéíóúñ])", " ", text)
    return normalize_whitespace(text)


def has_transversal_content(text: str) -> bool:
    normalized = normalize_for_match(text)
    return any(normalize_for_match(pattern) in normalized for pattern in TRANSVERSAL_PATTERNS)


def extract_concepts(text: str) -> List[str]:
    normalized = repair_line_breaks(text)
    if not normalized:
        return []

    chunks = re.split(r"\.|;|:|\n|\(|\)", normalized)
    concepts: List[str] = []

    for chunk in chunks:
        cleaned_chunk = normalize_whitespace(chunk)
        if not cleaned_chunk:
            continue
        cleaned_chunk = re.sub(
            r"^(unidad|tema|modulo|módulo)\s*([ivxlcdm]+|\d+)?\s*[:\.-]?\s*",
            "",
            cleaned_chunk,
            flags=re.IGNORECASE,
        )
        for piece in re.split(r",|/", cleaned_chunk):
            concept = normalize_whitespace(piece).strip(" .,:;\t-")
            concept = re.sub(r"^(de|del|la|el|los|las)\s+", "", concept, flags=re.IGNORECASE)
            if not concept:
                continue
            if len(concept) < 4 or len(concept) > 80:
                continue
            if len(concept.split()) == 1 and normalize_for_match(concept) in GENERIC_SINGLE_WORDS:
                continue
            if len(concept.split()) > 12:
                continue
            if re.search(r"\b(aplicacion|aplicación|introduccion|introducción|resolucion|resolución|problemas?)\b", concept, flags=re.IGNORECASE):
                continue
            if has_transversal_content(concept) or is_noise_text(concept):
                continue
            concepts.append(concept)

    return dedupe_and_trim(merge_broken_content_fragments(concepts), 50)


def select_distinctive_concepts(contents: List[str]) -> List[str]:
    all_text = " ".join(contents)
    norm_all = normalize_for_match(all_text)
    selected: List[str] = []

    for term in DISTINCTIVE_TERMS:
        normalized_term = normalize_for_match(term)
        if len(normalized_term) <= 2:
            continue
        pattern = r"(?<![a-z0-9])" + re.escape(normalized_term) + r"(?![a-z0-9])"
        if re.search(pattern, norm_all):
            selected.append(term)

    if selected:
        return dedupe_and_trim(selected, 6)

    return contents[:6]


def strip_code_from_name(name: str) -> str:
    cleaned = normalize_whitespace(name)
    cleaned = re.sub(r"\s+[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$", "", cleaned)
    return cleaned


def canonical_id(prefix: str, label: str) -> str:
    normalized_label = label.replace("C++", "cpp").replace("c++", "cpp")
    slug = normalize_for_match(normalized_label).replace(" ", "_")
    slug = re.sub(r"_+", "_", slug).strip("_")
    return f"{prefix}_{slug}" if slug else f"{prefix}_unknown"


def build_word_boundary_pattern(normalized_term: str) -> str:
    return r"(?<![a-z0-9])" + re.escape(normalized_term) + r"(?![a-z0-9])"


def is_explicit_exact_skill_match(skill_label: str, pattern_raw: str) -> bool:
    if skill_label == "C++":
        return pattern_raw.strip().lower() == "c++"
    return normalize_for_match(skill_label) == normalize_for_match(pattern_raw)


def skill_pattern_hit_count(skill_label: str, pattern_raw: str, corpus_raw: str, corpus_norm: str) -> int:
    if not corpus_raw and not corpus_norm:
        return 0

    raw_text = corpus_raw or ""
    norm_text = corpus_norm or ""

    if skill_label == "C++":
        return len(re.findall(r"(?<![a-z0-9])c\+\+(?![a-z0-9])", raw_text, flags=re.IGNORECASE))

    if skill_label == "C":
        strict_c_patterns = [
            r"\bprogramaci[oó]n\s+en\s+c\b",
            r"\blenguaje\s+c\b",
            r"\bansi\s+c\b",
            r"\biso\s+c\b",
        ]
        return sum(len(re.findall(regex, raw_text, flags=re.IGNORECASE)) for regex in strict_c_patterns)

    target_norm = normalize_for_match(pattern_raw)
    if not target_norm:
        return 0
    return len(re.findall(build_word_boundary_pattern(target_norm), norm_text))


def format_canonical_label(term: str) -> str:
    norm = normalize_for_match(term)
    if not norm:
        return ""
    if norm in CANONICAL_TERM_LABELS:
        return CANONICAL_TERM_LABELS[norm]
    return normalize_whitespace(term).strip(" .,:;\t").lower()


def build_concept_lexicon() -> Dict[str, str]:
    lexicon: Dict[str, str] = {}

    for term in DISTINCTIVE_TERMS:
        norm = normalize_for_match(term)
        if len(norm) < 3:
            continue
        lexicon[norm] = format_canonical_label(term)

    for terms in DOMAIN_CONCEPT_LEXICON.values():
        for term in terms:
            term_norm = normalize_for_match(term)
            if len(term_norm) < 3:
                continue
            lexicon[term_norm] = format_canonical_label(term)

    return lexicon


def normalize_concept_candidate(text: str) -> str:
    candidate = normalize_whitespace(text).strip(" .,:;\t-")
    if not candidate:
        return ""

    candidate = re.sub(
        r"^(unidad|tema|modulo|módulo)\s*([ivxlcdm]+|\d+)?\s*[:\.-]?\s*",
        "",
        candidate,
        flags=re.IGNORECASE,
    )
    candidate = re.sub(r"^(de|del|la|el|los|las)\s+", "", candidate, flags=re.IGNORECASE)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    candidate = candidate.replace(":", " ")
    candidate = re.sub(r"\s+", " ", candidate).strip()

    words = candidate.split()
    if len(words) < 1 or len(words) > 5:
        return ""

    first = normalize_for_match(words[0])
    if first in CONCEPT_STARTING_VERBS:
        return ""
    if first in CONCEPT_CONNECTOR_STARTS:
        return ""
    if first in CONCEPT_STOPWORDS and len(words) <= 2:
        return ""

    norm = normalize_for_match(candidate)
    if len(norm) < 3:
        return ""
    if norm in {"e s", "es"}:
        return ""
    if len(words) > 3 and (" y " in f" {norm} " or " que " in f" {norm} "):
        return ""
    if re.search(r"\b(aprend|comprend|resolver|analizar|identificar|utilizar|manejar|incluye|incluyen|anadir|añadir|operaciones)\b", norm):
        return ""
    if norm in {normalize_for_match(item) for item in GENERIC_SINGLE_WORDS}:
        return ""
    if has_transversal_content(candidate) or is_noise_text(candidate):
        return ""

    return format_canonical_label(candidate)


def is_clean_concept(concept: str) -> bool:
    norm = normalize_for_match(concept)
    if not norm:
        return False
    if norm in {"e s", "es"}:
        return False
    words = norm.split()
    if len(words) < 1 or len(words) > 5:
        return False
    if len(words) > 3 and (" y " in f" {norm} " or " que " in f" {norm} "):
        return False
    if words and words[0] in CONCEPT_CONNECTOR_STARTS:
        return False
    if re.search(r"\b(aprend|comprend|resolver|analizar|identificar|utilizar|manejar|incluye|incluyen|anadir|añadir|operaciones)\b", norm):
        return False
    return True


def extract_keyword_phrases(text: str, max_phrase_words: int = 8) -> List[str]:
    repaired = repair_line_breaks(text)
    if not repaired:
        return []

    candidates: List[str] = []
    chunks = re.split(r"\.|;|\n|\(|\)", repaired)
    for chunk in chunks:
        cleaned_chunk = normalize_whitespace(chunk)
        if not cleaned_chunk:
            continue

        for piece in re.split(r",|/", cleaned_chunk):
            phrase = normalize_whitespace(piece).strip(" .,:;\t-")
            if not phrase:
                continue
            phrase = re.sub(
                r"^(unidad|tema|modulo|módulo)\s*([ivxlcdm]+|\d+)?\s*[:\.-]?\s*",
                "",
                phrase,
                flags=re.IGNORECASE,
            )
            words = phrase.split()
            if len(words) < 1 or len(words) > max_phrase_words:
                continue
            first_word = normalize_for_match(words[0])
            if first_word in CONCEPT_CONNECTOR_STARTS:
                continue
            if len(normalize_for_match(phrase)) < 3:
                continue
            norm_phrase = normalize_for_match(phrase)
            if re.search(r"\b(incluye|incluyen|operaciones|introduccion|introducción)\b", norm_phrase):
                continue
            if has_transversal_content(phrase) or is_noise_text(phrase):
                continue
            if len(words) == 1 and normalize_for_match(phrase) in {normalize_for_match(item) for item in GENERIC_SINGLE_WORDS}:
                continue
            candidates.append(format_canonical_label(phrase))

    return dedupe_and_trim(candidates, 30)


def find_evidence_span(section_text: str, signal_norm: str) -> str:
    if not section_text or not signal_norm:
        return ""

    repaired = repair_line_breaks(section_text)
    pattern = build_word_boundary_pattern(signal_norm)

    for sentence in split_sentences(repaired):
        sentence_norm = normalize_for_match(sentence)
        if re.search(pattern, sentence_norm):
            return normalize_whitespace(sentence)[:220]

    sentences = split_bullets_or_lines(repaired)
    for sentence in sentences:
        sentence_norm = normalize_for_match(sentence)
        if re.search(pattern, sentence_norm):
            return normalize_whitespace(sentence)[:220]

    return ""


def build_area_evidence(
    areas: List[str],
    raw_sections: Dict[str, str],
    course_name: str,
    area_validation_map: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    objectives_core, objectives_transversal = split_objectives_sections(raw_sections.get("objectives_raw", ""))
    section_texts = {
        "course_name": course_name,
        "objectives_raw": objectives_core,
        "minimum_contents_raw": raw_sections.get("minimum_contents_raw", ""),
        "conceptual_contents_raw": raw_sections.get("conceptual_contents_raw", ""),
        "procedural_contents_raw": raw_sections.get("procedural_contents_raw", ""),
        "contents_raw": raw_sections.get("contents_raw", ""),
        "objectives_transversal": objectives_transversal,
    }

    evidence_items: List[Dict[str, Any]] = []
    for area in areas:
        validation_meta = (area_validation_map or {}).get(area, {})
        profile = AREA_PROFILES.get(area, {})
        signals: List[Tuple[str, int]] = []
        signals.extend([(item, 3) for item in profile.get("strong", [])])
        signals.extend([(item, 2) for item in profile.get("medium", [])])
        signals.extend([(item, 1) for item in profile.get("light", [])])

        best_signal = "name_or_context_match"
        best_source = "course_name"
        best_span = ""
        best_score = 0.0
        total_count = 0
        best_priority = "secondary_section"

        for signal, signal_weight in signals:
            norm_signal = normalize_for_match(signal)
            if not norm_signal:
                continue
            pattern = build_word_boundary_pattern(norm_signal)

            for section in SECTION_PRIORITY_FOR_EVIDENCE:
                section_text = section_texts.get(section, "")
                if not section_text:
                    continue
                section_norm = normalize_for_match(section_text)
                count = len(re.findall(pattern, section_norm))
                if count <= 0:
                    continue

                total_count += count
                score = signal_weight * count * SECTION_EVIDENCE_WEIGHT.get(section, 0.5)
                priority = SECTION_EVIDENCE_PRIORITY.get(section, "secondary_section")
                priority_score = SECTION_EVIDENCE_CONFIDENCE.get(priority, 0.5)
                adjusted_score = score * priority_score
                if adjusted_score > best_score or (adjusted_score == best_score and priority == "core_curricular_section"):
                    best_score = adjusted_score
                    best_signal = signal
                    best_source = section
                    best_span = find_evidence_span(section_text, norm_signal)
                    best_priority = priority

        strength = 0.22
        if total_count > 0:
            strength = min(0.98, 0.4 + (0.07 * min(total_count, 5)) + (0.05 * min(best_score, 5)))
        elif normalize_for_match(best_signal) in {"name_or_context_match", "name or context match"}:
            strength = 0.18
        if best_priority == "transversal_institutional_section":
            strength = min(strength, 0.4)

        evidence_items.append(
            {
                "area": area,
                "area_id": canonical_id("area", area),
                "area_label": area,
                "matched_signal": format_canonical_label(best_signal),
                "evidence_source_section": best_source,
                "evidence_priority": best_priority,
                "evidence_section_kind": SECTION_EVIDENCE_PRIORITY.get(best_source, "secondary_section"),
                "evidence_text_span": best_span,
                "evidence_strength": round(strength, 2),
                "evidence_count": total_count,
                "raw_area_signal_score": float(validation_meta.get("raw_area_signal_score", 0.0)),
                "validated_area_score": float(validation_meta.get("validated_area_score", 0.0)),
                "validation_flags": validation_meta.get("validation_flags", []),
                "validation_generic_hits": int(validation_meta.get("generic_hits", 0)),
                "validation_ambiguous_missing_context": int(validation_meta.get("ambiguous_missing_context", 0)),
                "validation_ambiguous_forbidden_context": int(validation_meta.get("ambiguous_forbidden_context", 0)),
            }
        )

    evidence_items.sort(
        key=lambda item: (item.get("validated_area_score", 0.0), item.get("evidence_strength", 0.0)),
        reverse=True,
    )
    return evidence_items


def build_distribution_reason(area_evidence: Dict[str, Any]) -> str:
    signal = area_evidence.get("matched_signal", "")
    count = area_evidence.get("evidence_count", 0)
    source = area_evidence.get("evidence_source_section", "contenido principal")
    section_kind = area_evidence.get("evidence_section_kind", "secondary_section")
    return (
        f"Presencia de la senal '{signal}' con {count} coincidencias en {source} ({section_kind}), "
        "lo que sugiere dedicacion significativa en esta area."
    )


def split_objectives_sections(text: str) -> Tuple[str, str]:
    normalized = normalize_whitespace(text or "")
    if not normalized:
        return "", ""

    cut_index = -1
    for pattern in INSTITUTIONAL_CUTOFF_PATTERNS:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match and (cut_index == -1 or match.start() < cut_index):
            cut_index = match.start()

    if cut_index == -1:
        return normalized, ""

    return normalized[:cut_index].strip(), normalized[cut_index:].strip()


def sanitize_contents_section(text: str) -> str:
    normalized = normalize_whitespace(text or "")
    if not normalized:
        return ""

    has_institutional_block = any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in INSTITUTIONAL_CUTOFF_PATTERNS)
    if not has_institutional_block:
        return normalized

    marker_matches = [
        re.search(r"\bunidad\s+[ivxlcdm0-9]+\b", normalized, flags=re.IGNORECASE),
        re.search(r"\btema\s+[ivxlcdm0-9]+\b", normalized, flags=re.IGNORECASE),
    ]
    starts = [match.start() for match in marker_matches if match]
    if not starts:
        return normalized

    first_curricular_idx = min(starts)
    if first_curricular_idx <= 0:
        return normalized

    return normalized[first_curricular_idx:].strip()


def build_curricular_contents_text(raw_sections: Dict[str, str], contents_keys: List[str]) -> str:
    parts: List[str] = []
    for key in contents_keys:
        value = raw_sections.get(key, "")
        if not value:
            continue
        if key == "contents_raw":
            value = sanitize_contents_section(value)
        parts.append(value)

    return repair_line_breaks("\n".join(parts))


def build_transversal_noise_risk(objectives_raw: str) -> float:
    core, transversal = split_objectives_sections(objectives_raw)
    if not transversal:
        return 0.0

    core_norm = normalize_for_match(core)
    transversal_norm = normalize_for_match(transversal)
    noise_hits = sum(1 for pattern in TRANSVERSAL_PATTERNS if normalize_for_match(pattern) in transversal_norm)
    total_norm_length = max(1, len(core_norm) + len(transversal_norm))
    return round(min(1.0, (noise_hits / 6.0) + (len(transversal_norm) / total_norm_length) * 0.5), 3)


def find_distinctive_terms(text: str) -> List[str]:
    norm_text = normalize_for_match(text)
    found: List[str] = []
    for term in DISTINCTIVE_TERMS:
        normalized_term = normalize_for_match(term)
        if len(normalized_term) <= 2:
            continue
        pattern = r"(?<![a-z0-9])" + re.escape(normalized_term) + r"(?![a-z0-9])"
        if re.search(pattern, norm_text):
            found.append(term)
    return dedupe_and_trim(found, 8)


def dedupe_and_trim(items: List[str], max_items: int) -> List[str]:
    seen = set()
    result = []
    for item in items:
        cleaned = normalize_whitespace(item.strip(" .,:;\t"))
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
        if len(result) >= max_items:
            break
    return result
