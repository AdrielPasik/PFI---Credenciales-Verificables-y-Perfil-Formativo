# Scope: posicionamiento de producto frontend v1

## Estado

```text
versión: v1
carácter: normativo
alcance: narrativa de producto y terminología visible del frontend
marca vigente: Scope
tagline: Una nueva forma de entender tu trayectoria.
locale: es-AR
```

Este documento reemplaza la narrativa de marca de los snapshots frontend anteriores. No modifica contratos, rutas, permisos, modelos de vista ni capacidades runtime. Ante una diferencia factual, el backend y los contratos vigentes describen lo implementado.

## Idea de producto

Scope es una plataforma para comprender trayectorias formativas a partir de evidencia verificable. Conecta credenciales, contenido formativo e interpretación inteligente para construir perfiles más claros y explicar qué puede respaldarse frente a un objetivo concreto.

La secuencia conceptual es:

```text
credenciales y experiencias formativas
-> evidencia formativa
-> verificabilidad y provenance
-> interpretación estructurada
-> perfil formativo
-> contexto u objetivo futuro
-> explicación humana de lo respaldado, parcial o sin evidencia
```

La verificabilidad aporta confianza sobre una fuente; la IA ayuda a interpretar su significado; el contexto determina su relevancia. Ninguna capa sustituye la autoridad institucional ni afirma conocimiento universal de una persona.

## Problema que aborda

Las trayectorias suelen fragmentarse entre títulos, materias, cursos, certificaciones, capacidades declaradas, palabras clave y CVs. Esa fragmentación dificulta explicar de dónde surge una capacidad, cuál es su evidencia, qué contenido tenía una formación, si fue emitida y qué puede justificarse a partir de ella.

Incluso una credencial auténtica aporta poco si solo se conoce su título. Scope une credencial, contenido, evidencia, provenance e interpretación para ofrecer una lectura formativa más útil y prudente.

## IA, evidencia y blockchain

### IA: diferencial principal

La interpretación asistida permite estructurar contenido formativo, identificar áreas, habilidades y conceptos, construir una comprensión agregada de la trayectoria y, en futuras capacidades, relacionar evidencia con requisitos o contextos. No es un chatbot, un generador de texto, un extractor aislado de keywords ni una autoridad certificadora.

La documentación y UI deben conservar la separación entre:

```text
evidencia
-> interpretación IA
-> interpretación revisada/aprobada cuando exista contrato
-> perfil formativo
```

### Integridad: capa secundaria

La evidencia de integridad permite consultar origen, estado y consistencia de una credencial o fuente. Blockchain, hashes, DID y registros técnicos continúan siendo verdaderos donde el runtime los provee, pero no son el centro de la narrativa visual ni el criterio de valor del producto.

Nunca afirmar que blockchain valida el contenido académico ni que IA certifica competencias.

## Contextos de uso

El empleo y los filtros ATS son un caso de uso importante, no el dominio completo. Frente a una lógica de “¿el perfil contiene esta palabra?”, Scope propone preguntar “¿qué puede respaldarse a partir de la evidencia formativa disponible?”. Esto puede ser relevante también para becas, admisión, posgrado, equivalencias y futuros objetivos.

No presentar resultados inexistentes como porcentaje de match, expertise, proficiency ni score arbitrario. La regla epistemológica es:

```text
sin evidencia no equivale a que la persona no posea esa capacidad
```

## Estado actual y dirección objetivo

| Estado actual documentable | Dirección de producto, no runtime actual |
| --- | --- |
| Credenciales, evidencia, perfil formativo, interpretación asistida y verificación técnica bajo contratos existentes. | `ContextualAnalysis`, extracción de requisitos, matching de evidencia, gaps y explicación frente a un objetivo. |
| Áreas, habilidades y conceptos provienen de evidencia disponible y reglas/contratos actuales. | Conclusiones contextualizadas con fuentes concretas y lenguaje prudente. |
| Verificador público focal y sin análisis crudo. | Experiencias de sharing/contexto cuando existan endpoints y reglas de privacidad. |

No inventar rutas, endpoints, estados o scores para la segunda columna.

## Arquitectura verbal

La marca global es `Scope`; el tagline oficial es `Una nueva forma de entender tu trayectoria.` La UI permanece en español es-AR.

Preferir labels funcionales:

- `Portal del Emisor`;
- `Mi perfil formativo`;
- `Mis credenciales`;
- `Verificar credencial`.

No reemplazar literalmente expresiones históricas por “Mi Scope” o “Scope Emisor”. El nombre del producto no necesita replicarse dentro de cada label.

## Personalidad

Scope debe sentirse humana, inteligente, moderna, educativa, clara, rigurosa, tecnológica, premium e institucional contemporánea. No debe sentirse crypto, Web3, ATS/recruiting-only, LMS tradicional, certificadora tradicional, chatbot ni startup AI genérica.

La aplicación de estas decisiones visuales se define en `frontend-brand-and-design-system-v1.md`. Las capacidades mobile del Titular se detallan en `scope-holder-mobile-handoff-v0.md`.
