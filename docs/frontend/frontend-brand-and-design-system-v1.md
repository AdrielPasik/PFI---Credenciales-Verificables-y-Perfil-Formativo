# Scope: Frontend Brand and Design System v1

## 1. Estado, propósito y precedencia

```text
versión: v1
carácter: normativo
alcance: identidad, lenguaje visual, accesibilidad y reglas frontend
marca vigente: Scope
tagline: Una nueva forma de entender tu trayectoria.
```

Este documento es la fuente de verdad activa para la marca, el sistema visual,
el tono, las decisiones de responsive y los componentes de Scope. Reemplaza
`frontend-brand-and-design-system-v0.md`, que permanece como snapshot histórico
de la etapa Traza. No habilita cambios de comportamiento, rutas, datos, permisos
ni contratos: el backend y sus DTOs reales tienen precedencia sobre toda
decisión de presentación.

Ante una contradicción, aplicar este orden:

1. código y contratos reales para capacidades, permisos y estados;
2. `scope-product-positioning-v1.md` para la narrativa de producto;
3. este documento para identidad, componentes, estados visuales y responsive;
4. arquitectura de información y view models para rutas y fronteras;
5. screen specs y handoffs para composición puntual.

## 2. Fundamento de marca

Scope ayuda a comprender trayectorias formativas a partir de credenciales,
evidencia e interpretación asistida. La experiencia debe priorizar comprensión,
contexto y lectura progresiva antes que la exhibición de tecnología. La IA es un
apoyo para organizar e interpretar información; la evidencia de integridad es
una capa técnica secundaria de confianza.

La promesa no es afirmar capacidades absolutas ni convertir la interfaz en un
sistema de recruiting. Scope puede resultar útil en educación, empleo, becas,
admisión, equivalencias y otros contextos, pero sus pantallas muestran solo lo
que la evidencia y los contratos disponibles permiten sostener.

## 3. Personalidad, audiencias y arquitectura verbal

La personalidad es clara, institucional contemporánea, humana y rigurosa.
Debe sentirse serena, no burocrática; tecnológica, no futurista; y útil, no
publicitaria. Se escribe en español es-AR. `Scope` conserva su nombre propio en
inglés.

| Audiencia | Necesidad principal | Prioridad visual |
| --- | --- | --- |
| Institución emisora | Operar credenciales, evidencia y contexto institucional. | Densidad operativa y claridad de acciones. |
| Titular | Comprender el perfil y las fuentes que lo respaldan. | Lectura personal, profile-first y mobile-first. |
| Verificador | Consultar una credencial sin sesión. | Resultado focal, sobrio y fácil de interpretar. |

Usar `Portal del Emisor`, `Mi perfil formativo`, `Mis credenciales`,
`Verificar credencial`, `Institución emisora`, `Titular`, `Evidencia` e
`Interpretación asistida`. No usar la marca como posesivo dentro de labels
funcionales ni convertir segmentos de URL en títulos visibles.

## 4. Logo y assets aprobados

Los assets existentes en `apps/web/public/brand` son la referencia visual
aprobada para Scope:

| Asset | Superficie prevista | Uso |
| --- | --- | --- |
| `Logo Scope 2.png` | Clara | Marca principal, login, verificador y contenido editorial claro. |
| `Logo Scope Invertido.png` | Navy | Shells autenticados o cabeceras oscuras. |

Reglas del logo:

- preservar proporción y renderizar completo con `object-contain`;
- elegir la variante por contraste, no mediante filtros CSS;
- mantener un área de protección equivalente, como mínimo, a la altura del
  símbolo alrededor del lockup;
- usar la marca una vez por shell o pantalla principal, no dentro de cada card;
- proveer texto alternativo `Scope` cuando el asset comunique identidad;
- no recortar, estirar, recolorear, invertir, aplicar sombras duras ni crear
  un símbolo alternativo.

El símbolo expresa persona o perfil, educación, credenciales, trayectoria e
integración. No se interpreta como blockchain, red descentralizada ni grafo.

## 5. Principios visuales

1. **Comprensión antes que exhibición.** Mostrar primero la lectura útil y
   revelar la evidencia técnica de forma progresiva.
2. **Jerarquía editorial.** Una pantalla debe tener una pregunta principal,
   una acción dominante cuando exista y grupos de información claramente
   diferenciados.
3. **Profundidad sobria.** Construir jerarquía con capas, bordes y contraste
   antes que con una acumulación de cards blancas iguales.
4. **Datos con procedencia.** Distinguir información declarada, evidencia,
   interpretación asistida e interpretación revisada.
5. **Estados explícitos.** El color acompaña texto, icono y estructura; nunca
   es la única señal de estado.
6. **Tecnología en segundo plano.** IA, hashes y red técnica se explican solo
   cuando ayudan a comprender un estado real.

Evitar estética crypto/Web3, cadenas o nodos decorativos, purple AI,
gradientes dominantes, glassmorphism, neones, dashboards SaaS intercambiables,
métricas falsas y futurismo ornamental. No recuperar trazos, rutas o hitos como
motivos de marca: pertenecen a la identidad histórica, no a Scope.

## 6. Sistema de color

La siguiente paleta es normativa para diseño y futuras migraciones de tokens.
No obliga por sí sola a renombrar variables CSS existentes.

| Token futuro | Valor | Uso principal |
| --- | --- | --- |
| `scope-navy` | `#0B1D3A` | Identidad institucional, navegación, headings y jerarquía fuerte. |
| `scope-teal` | `#2097A1` | Acción principal, foco, interpretación y actividad relevante. |
| `scope-sky` | `#BFE6EA` | Superficies de apoyo, selecciones suaves y acentos de baja intensidad. |
| `scope-cloud` | `#EEF2F5` | Canvas, fondos por capas y separaciones ligeras. |
| `scope-white` | `#FFFFFF` | Superficies de foreground y controles. |
| `scope-ink` | `#132238` | Texto fuerte sobre fondos claros. |
| `scope-slate` | `#526275` | Texto secundario y etiquetas de soporte. |
| `scope-line` | `#D7E0E7` | Bordes, divisores y contornos no interactivos. |

Los nombres `Traza Ink`, `Traza Teal`, los prefijos `traza-*` y sus valores
son históricos. Una futura migración debe mapear semántica, contraste y estados
con cuidado; no puede cambiar visualmente el significado de un control por un
reemplazo mecánico. El ámbar no es color de marca: queda reservado para warning
puntual, cobertura parcial o atención real.

## 7. Tokens de marca, semántica y feedback

Separar siempre tres capas de tokens:

| Capa | Ejemplos | Regla |
| --- | --- | --- |
| Marca | `scope-navy`, `scope-teal`, `scope-sky` | Expresa identidad y jerarquía general. |
| Semántica de dominio | `credential-issued`, `analysis-partial`, `verification-valid` | Representa un estado de producto real. |
| Feedback de interfaz | `info`, `success`, `warning`, `error` | Comunica resultado de una interacción o mensaje. |

Un token de feedback no reemplaza una condición de dominio. Por ejemplo, una
credencial `issued` puede usar una presentación de estado propia y un mensaje
`success` puede informar que se guardó un borrador: no son equivalentes.

## 8. Sistema completo de estados

### Credencial

| Estado | Tratamiento visible |
| --- | --- |
| `draft` | Borrador institucional; acciones de edición solo si el contrato las permite. |
| `issued` | Emitida; presentar como credencial vigente según su estado actual. |
| `revoked` | Revocada; mantener historia permitida, sin presentarla como vigente. |

### Análisis

| Estado | Tratamiento visible |
| --- | --- |
| not analyzed | Explicar ausencia sin insinuar falla ni falta de capacidad. |
| completed | Interpretación disponible; no equivale a aprobación humana. |
| partial | Interpretación disponible con cobertura o calidad limitada. |
| unknown | Estado no determinable; usar copy honesto y recuperación si existe. |

### Verificación

| Estado | Tratamiento visible |
| --- | --- |
| valid | Estado técnico verificable bajo el contrato público. |
| revoked | No vigente; mostrar la revocación con claridad. |
| incomplete | Información técnica insuficiente para confirmar el estado esperado. |
| draft | Credencial no emitida. No equivale a inválida ni revocada; preservar las reglas de privacidad aplicables a borradores. |
| not found | Referencia no disponible públicamente; no revelar borradores. |

### Evidencia y feedback

| Estado | Tratamiento visible |
| --- | --- |
| registered | Evidencia asociada según el read model. |
| local/demo | Entorno técnico o demostrativo, nunca red pública productiva. |
| unavailable | No hay evidencia disponible para mostrar o consultar. |
| info | Contexto útil sin urgencia. |
| success | Resultado positivo de una acción concreta. |
| warning | Atención, cobertura limitada o confirmación necesaria. |
| error | Operación no completada; explicar recuperación segura. |

Regla transversal obligatoria:

```text
credential issued != analysis completed != evidence registered != verification valid
```

No fundir estos estados en un badge único, no presentar análisis como condición
implícita de emisión y no inferir validez académica a partir de un hash o una
red técnica. Los únicos estados persistidos/documentables del análisis son
`not analyzed`, `completed`, `partial` y `unknown`. `loading`, `submitting` o
`Analizando...` son estados transitorios de interfaz durante una request, no un
estado persistido de `SemanticAnalysis`.

## 9. Tipografía y datos técnicos

Familia principal activa: `Inter`, declarada en
`apps/web/src/app/globals.css` mediante `--traza-font-sans`, con fallback
`ui-sans-serif`, fuentes de sistema y `sans-serif`. No introducir otra fuente
ni modificar esta cadena sin una decisión explícita de performance, licencia y
migración visual.

| Rol | Tamaño orientativo | Peso | Interlineado |
| --- | --- | --- | --- |
| Display o hero | 36-48 px | 650-750 | 1.05-1.15 |
| H1 | 30-40 px | 650-750 | 1.15 |
| H2 | 24-30 px | 650-700 | 1.2 |
| H3 | 18-22 px | 600-700 | 1.25 |
| Cuerpo | 15-17 px | 400-500 | 1.5-1.65 |
| Etiqueta | 12-14 px | 600-700 | 1.3 |
| Helper/caption | 12-14 px | 400-500 | 1.4-1.55 |

Usar una familia monoespaciada solo para hash corto, DID, referencia técnica o
valor que deba copiarse. Debe tener etiqueta humana, truncamiento seguro y
nunca reemplazar el título o el nombre de una persona o institución.

## 10. Layout, espaciado y contenedores

Usar una escala consistente de `4, 8, 12, 16, 24, 32, 40, 48, 64, 80` px.
Los saltos mayores deben expresar cambio de sección, no compensar falta de
jerarquía. Un grupo de label + dato mantiene separación menor que dos bloques
de dominio distintos.

| Contenedor | Uso | Máximo orientativo |
| --- | --- | --- |
| `issuer` | Workspace institucional, formularios y detalle operativo. | 1200-1440 px |
| `reading` | Perfil, detalle narrativo y contenido de lectura. | 760-960 px |
| `holder` | Perfil personal y listas de credenciales. | 680-960 px |
| `verifier` | Consulta pública focal. | 640-800 px |

Primitives de composición:

- `PageFrame`: canvas, ancho, safe padding y skip link;
- `Section`: título, descripción opcional y contenido asociado;
- `Stack`: separación vertical semántica;
- `Cluster`: elementos breves que pueden envolver;
- `Split`: dos columnas solo cuando ambas aporten lectura real;
- `ActionBar`: acciones relacionadas, sin convertirlas en navegación global;
- `Disclosure`: detalle técnico o limitación progresiva.

No usar un único max-width universal. El emisor requiere ancho operativo; el
verificador y el perfil necesitan foco de lectura.

## 11. Responsive por experiencia

Los breakpoints son puntos de cambio de composición, no dispositivos rígidos:

| Rango | Comportamiento esperado |
| --- | --- |
| Mobile, hasta 639 px | Una columna, targets táctiles cómodos, acciones apiladas y lectura priorizada. |
| Tablet, 640-1023 px | Reorganizar grupos y conservar acciones completas; no tratarla como desktop reducido. |
| Desktop, desde 1024 px | Aprovechar contexto lateral, paneles de apoyo y anchura sin expandir líneas de texto excesivas. |

- **Portal del Emisor:** web responsive. Puede usar dos columnas en desktop,
  pero los formularios, detalles y acciones siguen completos en pantallas
  pequeñas.
- **Titular:** mobile-first. El perfil precede a las listas, no depende de una
  sidebar y evita tablas densas.
- **Verificador:** mobile-first y focal. Resultado primero, evidencia técnica
  después mediante disclosure o secciones cortas.

No depender de hover, scroll horizontal, targets menores a 44 x 44 px ni
acciones críticas ocultas detrás de iconos sin nombre accesible.

## 12. Forma, bordes y profundidad

| Alias | Uso |
| --- | --- |
| `radius-control` | Inputs, botones, badges y campos compactos. |
| `radius-card` | Cards, alertas y panels. |
| `radius-panel` | Superficies de gran sección o dialog. |
| `radius-pill` | Solo filtros, chips o estados que sean genuinamente compactos. |

Preferir radios moderados y consistentes. La profundidad se logra con:

- canvas y superficies de niveles distinguibles;
- borde `scope-line` o equivalente semántico;
- una sombra suave, corta y de baja opacidad solo cuando separe una superficie;
- acento lineal o color de sección cuando aporte jerarquía.

Evitar sombras pesadas, bordes de colores por decoración, múltiples capas de
card dentro de card y esquinas excesivamente redondeadas que borren jerarquía.

## 13. Botones y acciones

| Variante | Uso |
| --- | --- |
| Primaria | Una acción principal del contexto: guardar, emitir, verificar o continuar. |
| Secundaria | Acción relevante pero no dominante. |
| Terciaria/ghost | Navegación contextual, acciones de baja intensidad o disclosure. |
| Destructiva | Acción irreversible real; requiere confirmación si el contrato lo permite. |

Tamaños orientativos: `sm` para barras compactas, `md` como default, `lg`
para una acción principal especialmente importante. Mantener etiqueta verbal
clara; un icono puede acompañar, no reemplazar, una acción crítica.

Estados obligatorios:

- default, hover, focus-visible, active, disabled y loading;
- loading conserva ancho y nombre de la acción, anuncia el estado y bloquea
  duplicación cuando la lógica ya lo requiere;
- disabled explica la condición cercana solo si es útil; no se usa como CTA
  falsa;
- `focus-visible` tiene contraste alto, no depende únicamente de box-shadow
  sutil y no se elimina con `outline: none` sin reemplazo.

## 14. Inputs, formularios y carga documental

Cada control necesita label permanente, helper cuando agregue contexto y error
asociado mediante `aria-describedby`. Agrupar campos por decisión de dominio,
no por tipo HTML. Los errores deben quedar cerca del campo y el resumen de
error debe poder llevar el foco al primer problema relevante.

Reglas:

- no usar placeholder como label;
- mostrar requerido y restricciones sin hacer depender la comprensión del color;
- `select`, radios o checks solo cuando expresen una decisión real;
- conservar valores recuperables ante error de red o validación;
- no mostrar IDs técnicos como opción humana;
- el submit usa loading indeterminado, no porcentajes inventados.

La carga documental es una operación de evidencia, no un widget genérico:
mostrar tipo permitido, estado del archivo cuando el contrato lo devuelve,
error seguro y la diferencia entre borrador editable y lectura emitida/revocada.
No prometer análisis, almacenamiento o reemplazo que el endpoint actual no
realice.

## 15. Componentes base y feedback

| Componente | Regla Scope |
| --- | --- |
| Badge | Un estado breve con texto explícito; no apilar cinco badges equivalentes. |
| Card | Agrupa una decisión, resumen o superficie con jerarquía. No usarla como wrapper universal. |
| Alert | Mensaje persistente cuando cambia comprensión, riesgo o recuperación. |
| Toast | Confirmación breve de una operación que no requiere lectura sostenida. |
| Dialog | Confirmación de acción relevante; foco contenido y retorno al disparador. |
| Empty state | Explica qué falta y la siguiente acción real si existe. |
| Loading/Skeleton | Preserva geometría y comunica espera sin flash de contenido falso. |
| Error state | Copy seguro, acción de recuperación cuando exista y sin detalles internos. |
| Technical disclosure | Datos técnicos permitidos bajo demanda, con label y contexto humano. |

No usar toasts como único canal para errores que bloquean una tarea. No usar
modals para contenido largo ni anuncios críticos que deban permanecer visibles.

## 16. Patrones de dominio

### Credencial

El título, tipo, estado, institución y titular permitido forman la lectura
principal. La referencia técnica puede existir en URL o disclosure, nunca como
identidad dominante. Diferenciar borrador, emitida y revocada con texto, icono
y estructura.

### Perfil formativo

El perfil presenta una síntesis prudente, áreas, habilidades, conceptos y
fuentes de respaldo dentro del volumen que el contrato permita. Mantener
separadas las horas oficiales declaradas y las horas estimadas por IA. La
interpretación no reemplaza la información declarada por el emisor.

### Confianza, cobertura y calidad

Una confianza disponible se presenta como contexto, no como score teatral. Si
es baja, parcial o ausente, explicar la limitación. Nunca convertir un porcentaje
en prueba de capacidad, empleabilidad o validez académica.

### Evidencia e integridad

La evidencia documental o textual se describe con su estado real. Hashes,
redes y registros son evidencia técnica de integridad; no prueban por sí mismos
el contenido académico. Para `mock`, `anvil` u otro entorno no productivo,
mostrar `Entorno técnico/demo` y evitar lenguaje de red pública.

### Análisis asistido

Presentar la interpretación como lectura disponible, parcial o no disponible.
Durante una operación transitoria puede comunicarse `Analizando...`, sin
presentarlo como estado persistido. No decir que la IA certifica, aprueba
automáticamente o decide la validez de una credencial. Los flags internos se
humanizan y los desconocidos usan una observación genérica, nunca su
identificador crudo.

### Verificación pública

El verificador prioriza resultado, estado, emisor, titular mínimo permitido y
evidencia técnica. Debe proteger borradores como no disponibles y no mostrar
email, análisis crudo, rutas de storage, artifacts, tokens ni errores internos.

## 17. Iconografía y datos técnicos

Lucide es la única familia de iconos. Cada icono debe aclarar una acción,
sección o estado; no se usa como ornamentación repetida. Mantener un nombre
accesible para botones solo-icono, tamaño táctil adecuado y contraste suficiente.

Los hashes, DID, chain ID o referencias visibles deben:

- estar allowlisted por el view model;
- usar fuente monoespaciada y truncamiento que preserve inicio y final;
- incluir un label humano y, cuando exista, acción de copia accesible;
- evitarse en resúmenes si no aportan a la tarea;
- no incluir secrets, paths, keys, payloads crudos ni identificadores internos
  sin necesidad de producto.

## 18. Motion y feedback temporal

El motion comunica relación espacial, feedback o cambio de estado; no decora.
Usar transiciones cortas y discretas para aparición, expansión y reordenamiento
real. Respetar `prefers-reduced-motion`; la versión reducida debe mantener
comprensión sin depender de animación.

No animar continuamente, no retrasar navegación o submit, no usar contadores
falsos, no incorporar porcentajes de IA ni skeletons que simulen datos reales.

## 19. Accesibilidad

Toda implementación Scope debe verificar:

- contraste suficiente para texto, foco, estado y controles;
- orden de teclado equivalente al orden visual;
- skip link en shells largos;
- headings secuenciales y regiones con nombres útiles;
- labels permanentes y mensajes asociados a inputs;
- `aria-live` para resultados de submit, loading y cambios relevantes;
- foco gestionado en dialog y en el primer error importante, sin autofocus
  agresivo tras cada render;
- targets táctiles y espacio entre acciones;
- zoom, reflow y ausencia de overflow horizontal a 320 px;
- color acompañado por texto, icono o forma;
- formatos es-AR para fechas, horas y cantidades cuando el view model lo provea.

## 20. Tono, microcopy y límites epistemológicos

Preferir frases claras, en segunda persona rioplatense cuando corresponda y
verbos de acción concretos: `Consultá`, `Guardá`, `Revisá`, `Volvé a intentar`.
Explicar qué ocurrió y qué puede hacer la persona sin exponer HTTP, DTOs,
servicios upstream ni detalles de infraestructura.

Usar: `evidencia formativa`, `interpretación asistida`, `información declarada
por el emisor`, `resumen semántico`, `confianza del análisis`, `evidencia de
integridad`, `sin evidencia disponible`.

Evitar: `la IA certifica`, `blockchain valida el contenido`, `100% verificado`,
`inmutable para siempre`, `match 93%`, `experto`, `garantizado`, `sin evidencia
significa sin capacidad` y cualquier afirmación de integración oficial con una
plataforma externa si no existe.

## 21. Convenciones de implementación

- Las variables CSS vigentes son la fuente de verdad en runtime; esta versión
  define la migración semántica futura hacia Scope.
- Tailwind resuelve composición y responsive; no repetir hexadecimales en JSX.
- Construir dominio sobre primitives code-owned compatibles con shadcn/Radix,
  CVA y `cn()` cuando el repositorio ya los usa.
- No importar DTOs backend directamente en componentes de presentación ni hacer
  fetching dentro de componentes puramente visuales.
- No construir clases Tailwind dinámicas, no mezclar familias de iconos y no
  crear primitives sin consumidor real.
- Usar shells contextuales para emisor, titular y verificador; no crear un
  shell universal que mezcle permisos y jerarquías.

## 22. Criterios de aceptación visual

Una pantalla Scope está lista para revisión cuando:

- usa la variante correcta del logo y no altera sus proporciones;
- mantiene una jerarquía editorial y una acción principal comprensible;
- distingue estado de credencial, análisis, evidencia, verificación y feedback;
- funciona a 390 x 844, 768 x 900 y 1440 x 900 sin overflow horizontal;
- conserva foco, teclado, contraste, labels y feedback accesible;
- no expone IDs, secretos, artifacts ni detalles técnicos innecesarios;
- no presenta datos inventados, métricas decorativas o promesas técnicas falsas;
- trata holder y verificador como mobile-first y emisor como web responsive;
- respeta límites de producto y contratos reales.

## 23. Reglas históricas descartadas

Las siguientes reglas de `frontend-brand-and-design-system-v0.md` no se
promueven a Scope: nombre y tagline de Traza, assets históricos, paleta y
prefijos Traza, ámbar como acento identitario, motivos de trazos, conexiones e
hitos, y cualquier metáfora visual de red o blockchain. El documento v0 se
conserva para trazabilidad, no como guía de implementación activa.

## 24. Evolución controlada

Antes de un redesign de código, inspeccionar assets reales, tokens existentes,
shells por actor, contratos y capturas mobile/tablet/desktop. Una tarea visual
no puede inventar estados, datos o navegación ni transformar blockchain en
propuesta de valor principal. La evolución de producto hacia análisis
contextual es futura y no debe materializarse como placeholder funcional.
