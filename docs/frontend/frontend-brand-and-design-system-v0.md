# Traza: Frontend Brand and Design System v0

## 1. Propósito del documento

Este documento define la identidad de marca, el lenguaje visual y las reglas
base de implementación frontend de Traza.

Es una referencia obligatoria para cualquier tarea futura que cree o
modifique:

- pantallas;
- layouts;
- componentes;
- estados visuales;
- microcopy;
- navegación;
- estilos Tailwind;
- experiencias del emisor, holder o verificador.

Su objetivo es evitar decisiones visuales aisladas y asegurar que las tres
experiencias pertenezcan al mismo producto.

Estado del documento:

```text
versión: v0
carácter: normativo
alcance: frontend web inicial
marca: Traza
```

Una tarea de frontend no puede reemplazar estas decisiones por preferencias
genéricas. Cualquier cambio de marca, paleta, tipografía o significado
semántico requiere una decisión explícita y una nueva versión documental.

### Precedencia documental

Cuando dos documentos se superpongan, aplicar este orden:

1. Los contratos y reglas de dominio del backend son la fuente de verdad para
   permisos, datos, estados y comportamiento.
2. Este documento es la fuente de verdad para marca, tono, tokens y reglas
   visuales.
3. `frontend-information-architecture-v0.md` será la fuente de verdad para
   rutas y navegación.
4. `frontend-data-and-view-models-v0.md` será la fuente de verdad para la
   adaptación de DTOs.
5. Las especificaciones de pantalla serán la fuente de verdad para la
   composición e interacción de cada vista.

Si existe una contradicción o falta un dato, Codex debe informarlo. No debe
inventar comportamiento, endpoints, estados, permisos o contenido.

## 2. Contexto del producto

Traza es una plataforma de credenciales educativas verificables y análisis
inteligente de trayectorias formativas.

El producto conecta:

```text
instituciones que emiten
-> personas que reciben
-> terceros que verifican
```

Capacidades principales:

- emisión de credenciales educativas;
- hash canónico y evidencia de integridad;
- evidencia blockchain;
- wallet interna del holder;
- análisis semántico asistido por IA;
- perfil formativo agregado;
- verificación pública.

El frontend consume exclusivamente el backend NestJS. No consume el AI
Service FastAPI de manera directa.

El backend:

- autentica;
- autoriza;
- valida;
- persiste;
- asocia resultados a usuarios y credenciales;
- expone DTOs seguros.

Los artifacts internos de IA, estructuras Prisma y objetos de librerías
blockchain no deben mostrarse crudos al usuario final.

## 3. Marca y naming

### Nombre oficial

```text
Traza
```

Usar `Traza` sin agregados como nombre visible principal.

Razones:

- es corto;
- es recordable;
- es fácil de pronunciar;
- funciona en contextos institucionales y personales;
- conecta trayectoria y trazabilidad;
- no limita el producto solo a credenciales.

### Logo y wordmark provisional

No existe todavía un logo gráfico final aprobado.

Para v0:

- usar `Traza` como wordmark tipográfico con Inter `700`;
- usar el wordmark textual en encabezados, login y navegación mientras no
  exista un asset aprobado;
- no inventar isotipos complejos, escudos, NFT, certificados, cadenas,
  hexágonos o logos blockchain;
- no generar un SVG de marca definitivo durante la implementación de una
  pantalla;
- tratar cualquier símbolo futuro como una decisión separada que requiere
  aprobación.

Un símbolo futuro puede explorar un trazo continuo, dos nodos conectados o un
recorrido. Esta dirección es exploratoria y no autoriza a Codex a crear un
logo definitivo.

### Descriptor

Cuando el contexto requiera explicar el producto:

```text
Traza
Plataforma de credenciales y trayectorias formativas verificables.
```

El descriptor no es una parte obligatoria del logo.

### Arquitectura verbal

Expresiones admitidas:

- `Traza Emisor`: nombre conceptual del portal institucional;
- `Mi Traza`: nombre posible para la experiencia del holder;
- `Verificar en Traza`: acción o encabezado del verificador público;
- `Tu traza formativa`: expresión conceptual o de comunicación.

No son necesariamente labels definitivos de navegación. Son una familia
verbal coherente para explorar dentro de cada experiencia.

### Variantes descartadas como marca principal

- `Traza Formativa`: demasiado descriptiva y extensa;
- `Traza ID`: reduce el producto a identidad, DID o autenticación;
- `Traza Credentials`: mezcla idiomas y reduce el peso del perfil formativo.

Codex no debe renombrar el producto ni usar estas variantes como marca
principal.

## 4. Tagline y mensajes principales

### Tagline principal

```text
Credenciales verificables para trayectorias formativas confiables.
```

Es la frase institucional oficial de v0. Puede usarse en:

- login;
- presentaciones;
- documentación;
- tesis;
- landing futura;
- encabezados de marca.

### Frase secundaria para holder

```text
Tu formación, clara y verificable.
```

Puede usarse en `Mi Traza`, onboarding o comunicaciones más cercanas.

### Mensaje operativo

```text
Emití, reuní y verificá credenciales educativas en un solo lugar.
```

Es apropiado para introducciones de producto, pero no reemplaza el tagline
institucional.

## 5. Personalidad de marca

Traza debe sentirse:

- clara;
- profesional;
- serena;
- precisa;
- transparente;
- institucional;
- accesible;
- moderna;
- confiable;
- tecnológicamente competente sin exhibicionismo.

Concepto rector:

```text
precisión amable
```

La interfaz combina estructura rigurosa con lenguaje comprensible. No intenta
impresionar mediante complejidad técnica.

Traza no debe sentirse:

- cripto especulativa;
- futurista;
- infantil;
- ludificada;
- fría o burocrática;
- excesivamente minimalista;
- genérica como un dashboard SaaS intercambiable.

## 6. Audiencias y experiencias

Traza comparte una identidad y un sistema de componentes, pero presenta tres
experiencias con prioridades distintas.

### Portal del emisor

Actores:

- universidad;
- institución;
- plataforma de cursos;
- `admin`;
- `operator`.

Prioridades:

- operación;
- densidad informativa;
- control;
- trazabilidad;
- carga y revisión;
- estados del flujo.

Orientación:

```text
web responsive para tareas institucionales
```

El Portal del Emisor es una experiencia web responsive dentro del mismo
frontend Next.js. Se optimiza para tareas institucionales en resoluciones
medianas y amplias, pero debe ser funcional, comprensible y operable en
pantallas pequeñas.

Esto no convierte al portal en `mobile-first`: su densidad puede aprovechar
tablas, paneles y formularios en varias columnas cuando el espacio lo permite,
sin establecer tablet como ancho mínimo funcional ni excluir mobile.

### Wallet y perfil del holder

Actor:

- receptor o titular de credenciales.

Prioridades:

- claridad personal;
- lectura;
- selección;
- comprensión de trayectoria;
- confianza;
- acceso mobile.

Orientación:

```text
mobile-first
```

El holder no usa MetaMask, no firma transacciones y no emite credenciales.

### Verificador público

Actores:

- empresa;
- recruiter;
- tercero;
- institución verificadora.

Prioridades:

- respuesta directa;
- autenticidad;
- estado;
- institución emisora;
- evidencia;
- comprensión rápida.

Orientación:

```text
mobile-first, pública, focalizada y responsive
```

Su acceso futuro desde QR exige una experiencia completa y directa en
pantallas pequeñas.

## 7. Principios visuales

### Estructura clara

La jerarquía debe ser evidente mediante:

- tipografía;
- spacing;
- alineación;
- contraste;
- agrupación;
- encabezados consistentes.

### Color controlado

El color comunica marca, interacción o estado. No se usa como decoración
arbitraria.

Proporción orientativa:

```text
65% fondos y neutrales
20% azul primario
10% teal
5% acentos y estados
```

### Superficies definidas

Los bordes definen la mayoría de cards, inputs y tablas. Las sombras son
secundarias.

### Trazos, conexiones e hitos

El recurso distintivo de Traza son:

- recorridos;
- líneas;
- nodos;
- hitos;
- relaciones.

Debe aplicarse con moderación, principalmente en timelines, encabezados o
detalles de marca. No debe convertirse en un fondo decorativo invasivo.

### Tecnología en segundo plano

IA y blockchain respaldan la experiencia, pero no dominan la identidad.

### Accesibilidad semántica

Ningún significado depende solo del color. Todo estado incluye:

- texto explícito;
- ícono;
- contexto;
- explicación cuando tenga consecuencias importantes.

## 8. Paleta de colores

### Colores de marca y superficie

| Función | Nombre | Hex | Uso principal |
|---|---|---:|---|
| Primario | Traza Ink | `#16324F` | Marca, navegación, títulos, CTA principal |
| Secundario | Traza Teal | `#197278` | Análisis, formación, interacción secundaria |
| Acento | Traza Amber | `#C68A2D` | Hitos y selección puntual |
| Fondo | Canvas | `#F6F8F8` | Fondo general |
| Superficie | Surface | `#FFFFFF` | Cards, modales, tablas, formularios |
| Texto fuerte | Text Strong | `#1B2936` | Títulos y contenido principal |
| Texto secundario | Text Muted | `#5D6B76` | Metadata y descripciones |
| Borde | Border | `#DCE3E5` | Separadores, inputs y cards |
| Fondo suave | Surface Muted | `#EEF3F3` | Bloques informativos y filtros |

### Razón de la combinación

- Traza Ink aporta confianza y seriedad.
- Traza Teal representa formación, conexión y análisis.
- Traza Amber marca recorrido e hitos sin reemplazar warnings.
- Los neutrales mantienen una interfaz institucional y legible.

### Restricciones

- El ámbar no domina pantallas completas.
- El teal no reemplaza todos los CTA primarios.
- El verde no se usa como color de marca general.
- No usar gradientes como superficie dominante.
- No crear variantes saturadas sin documentar su función.
- `amber-600` puede usarse como acento gráfico, borde, nodo o superficie
  puntual, pero no como texto pequeño sobre blanco.
- El ámbar de marca no sustituye el tratamiento visual de una advertencia.

## 9. Tokens de color sugeridos

### Marca

| Token | Valor |
|---|---:|
| `brand-900` | `#16324F` |
| `brand-700` | `#1E496B` |
| `brand-600` | `#256087` |
| `brand-100` | `#EAF2F7` |
| `teal-700` | `#197278` |
| `teal-600` | `#23838A` |
| `teal-100` | `#E5F4F3` |
| `amber-600` | `#C68A2D` |
| `amber-800` | `#7A4D08` |
| `amber-100` | `#FFF3D9` |

### Neutrales

| Token | Valor |
|---|---:|
| `canvas` | `#F6F8F8` |
| `surface` | `#FFFFFF` |
| `surface-muted` | `#EEF3F3` |
| `text-strong` | `#1B2936` |
| `text-default` | `#344451` |
| `text-muted` | `#5D6B76` |
| `text-subtle` | `#7C8992` |
| `border-default` | `#DCE3E5` |
| `border-strong` | `#C6D0D3` |

### Regla de uso

Los componentes de dominio consumen nombres semánticos o tokens de marca. No
deben incluir hexadecimales repetidos dentro de JSX.

Cuando se necesite texto ámbar accesible, usar `amber-800`. Los componentes de
warning consumen tokens de feedback o estado, no tokens decorativos de marca.

## 10. Sistema semántico de estados

| Token | Foreground | Fondo suave | Ícono sugerido | Etiqueta |
|---|---:|---:|---|---|
| `status-issued` | `#2563A6` | `#EAF2FB` | Documento con check | Emitida |
| `status-analysis` | `#197278` | `#E5F4F3` | Destellos o nodos | Análisis completado |
| `status-valid` | `#176B49` | `#E8F6EE` | Escudo con check | Credencial válida |
| `status-evidence` | `#5966A8` | `#EEEEFA` | Cadena o registro | Evidencia registrada |
| `status-warning` | `#89520D` | `#FFF3D9` | Triángulo | Requiere atención |
| `status-error` | `#A92F39` | `#FCEBEC` | Círculo con alerta | No se pudo completar |
| `status-revoked` | `#A93647` | `#F9E8EC` | Documento bloqueado | Revocada |
| `status-draft` | `#56636C` | `#EFF2F3` | Documento editable | Borrador |
| `status-analysis-partial` | `#80520F` | `#FFF3D9` | Círculo parcial | Análisis parcial |
| `status-unknown` | `#56636C` | `#EFF2F3` | Signo de pregunta | No disponible |

Cada token debe exponer al menos:

```text
foreground
soft-background
label
icon
```

El borde puede usar `border-default` hasta validar una escala semántica
específica con contraste accesible.

Cada par de `foreground` y `soft-background` debe alcanzar como mínimo WCAG
AA para texto normal. La validación debe realizarse sobre la combinación
efectivamente implementada, no sobre cada color de manera aislada.

## 11. Reglas para diferenciar estados

### Credencial emitida

- pertenece al ciclo de vida de `Credential`;
- significa que la institución confirmó la emisión;
- usa azul;
- no significa verificación válida;
- no significa análisis completado.

### Análisis IA completado

- pertenece a `SemanticAnalysis`;
- significa que finalizó la interpretación semántica;
- usa teal;
- no significa certeza absoluta;
- no significa que la credencial sea válida.

### Verificación válida

- pertenece al resultado consolidado de verificación;
- responde si la credencial es válida según la evidencia disponible;
- reserva el verde;
- tiene mayor prioridad visual en el verificador.

### Evidencia registrada

- pertenece a la capa blockchain/evidencia;
- usa indigo;
- confirma un registro técnico asociado;
- no demuestra validez completa por sí sola.

### Revocada

- es un estado fuerte y terminal para la lectura;
- usa rojo semántico;
- no se representa como warning ámbar;
- debe explicar fecha o motivo cuando exista.

### Análisis parcial

- indica que el proceso produjo resultado con limitaciones;
- muestra advertencias;
- no usa el mismo tratamiento que un error total.

### Verificación incompleta

- label: `Verificación incompleta`;
- usa tratamiento de warning;
- significa que falta una o más evidencias necesarias para confirmar la
  validez;
- no debe presentarse automáticamente como una credencial inválida.

### Credencial no encontrada

- label: `Credencial no encontrada`;
- usa tratamiento neutral o negativo moderado;
- explica que se puede revisar el identificador o enlace;
- no muestra `404` ni otro error técnico como contenido principal.

### Credencial en borrador durante verificación

- label: `Credencial no emitida`;
- usa tratamiento neutral;
- explica que un borrador todavía no constituye una credencial verificable;
- no lo presenta como credencial inválida o revocada.

### Sin análisis

- label: `Sin análisis formativo`;
- usa tratamiento neutral;
- no es un error;
- no se presenta como análisis pendiente salvo que exista un job real y el
  backend exponga ese estado.

### Evidencia no disponible

- label: `Evidencia no disponible`;
- usa tratamiento neutral o warning según el resultado consolidado;
- no afirma que esté pendiente si el backend no informa ese estado.

### Estados de dominio y feedback

Los colores pueden compartir una base, pero los componentes de dominio y el
feedback transitorio no comparten un único namespace conceptual:

```text
CredentialStatusBadge:
draft | issued | revoked

AnalysisStatusBadge:
not-analyzed | completed | partial

VerificationStatusBadge:
valid | revoked | incomplete | draft | not-found

EvidenceStatusBadge:
registered | local-demo | unavailable

FeedbackAlert:
info | success | warning | error
```

Reglas:

- un fallo HTTP o de formulario usa `FeedbackAlert`, `InlineError` o
  `ErrorState`, no un estado persistido de credencial;
- un análisis que falla durante un request no se muestra como artifact
  `failed` salvo que el backend exponga ese estado persistido;
- `revoked` es un estado de dominio, no un error de sistema;
- `not-found` usa copy comprensible, no copy técnico;
- cada componente recibe un enum o view model explícito y nunca infiere el
  estado desde strings parciales.

### Regla transversal

No usar un único badge verde para todo lo correcto. Nunca depender solamente
del color.

## 12. Tipografía

### Familia oficial

```text
Inter
```

Usar para:

- marca textual;
- navegación;
- títulos;
- cuerpo;
- formularios;
- tablas;
- metadata;
- badges.

Integración recomendada en Next.js:

```text
next/font
```

No introducir una segunda familia en v0.

### Pesos

| Peso | Uso |
|---:|---|
| `400` | Cuerpo y contenido |
| `500` | Navegación, controles, metadata destacada |
| `600` | Botones, subtítulos, labels relevantes |
| `700` | Títulos principales |

Evitar `800` y `900`, salvo una pieza puntual de marca aprobada.

### Escala sugerida

| Rol | Tamaño/line-height orientativo |
|---|---|
| Display | `32/40` desktop, `28/36` mobile |
| H1 | `28/36` |
| H2 | `22/30` |
| H3 | `18/26` |
| Body | `16/24` |
| Body small | `14/20` |
| Metadata | `13/18` |
| Badge | `12-13/16` |

Esta escala puede ajustarse de forma sistémica por accesibilidad, no por
componente aislado.

### Datos técnicos

Hashes, IDs y referencias técnicas usan:

```css
ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
```

No agregar una fuente monoespaciada externa.

## 13. Layout, spacing y responsive

### Escala de spacing

Base:

```text
4 px
```

| Token | Pixel |
|---:|---:|
| `1` | `4` |
| `2` | `8` |
| `3` | `12` |
| `4` | `16` |
| `5` | `20` |
| `6` | `24` |
| `8` | `32` |
| `10` | `40` |
| `12` | `48` |
| `16` | `64` |

Reglas:

- gap interno de controles: `8-12 px`;
- padding de cards compactas: `16 px`;
- padding de cards normales: `20-24 px`;
- separación entre secciones: `32-48 px`;
- evitar valores arbitrarios como `13`, `18` o `27 px`.

### Contenedores

- Portal emisor: contenido amplio, con máximo orientativo de `1440 px`.
- Áreas de lectura: máximo orientativo de `1120-1200 px`.
- Perfil holder: ancho fluido mobile y lectura contenida en desktop.
- Verificador: columna focal, máximo orientativo de `760-880 px`.

Los máximos deben definirse como tokens/layout primitives, no repetirse en
cada página.

### Responsive

- Portal emisor: web responsive, optimizado para tareas institucionales en
  resoluciones medianas y amplias.
- En layouts amplios, el portal puede aprovechar tablas, paneles y formularios
  en varias columnas.
- En pantallas pequeñas, tablas y grupos de acciones deben reorganizarse en
  listas, cards, drawers o secciones apiladas.
- El portal debe seguir siendo funcional en mobile; no se establece tablet
  como ancho mínimo.
- Esta regla no convierte al portal en `mobile-first`: mantiene mayor densidad
  operativa cuando el espacio lo permite.
- Wallet: mobile-first y táctil.
- Verificador: mobile-first por acceso futuro desde QR.
- Tablas se convierten en filas apiladas o cards en mobile.
- El scroll horizontal no puede ser la única adaptación responsive.
- Targets táctiles: mínimo `44 x 44 px`.

Usar breakpoints estándar de Tailwind salvo una necesidad documentada.

## 14. Border radius y sombras

### Radius

| Token | Valor |
|---|---:|
| `radius-sm` | `6 px` |
| `radius-md` | `10 px` |
| `radius-lg` | `14 px` |
| `radius-xl` | `18 px` |
| `radius-full` | `9999 px` |

Uso:

- inputs y botones: `md`;
- cards: `lg`;
- modales o cards destacadas: `xl`;
- badges: `full` o `sm`;
- superficies principales: nunca más de `18 px`.

La aplicación no debe verse excesivamente redondeada.

Los componentes deben preferir aliases semánticos:

| Alias | Valor | Uso |
|---|---:|---|
| `radius-control` | `10 px` | Inputs, selects y botones |
| `radius-card` | `14 px` | Cards y paneles |
| `radius-dialog` | `18 px` | Modales y superficies destacadas |
| `radius-pill` | `9999 px` | Badges y elementos compactos |

Clases conceptuales:

```text
rounded-control
rounded-card
rounded-dialog
rounded-pill
```

Codex debe registrar estos aliases en la configuración o capa de tokens
correspondiente. No debe asumir que `rounded-lg` de Tailwind equivale a
`14 px`. La escala numérica se conserva como referencia interna.

### Sombras

```css
--shadow-xs: 0 1px 2px rgba(22, 50, 79, 0.05);
--shadow-sm: 0 2px 8px rgba(22, 50, 79, 0.07);
--shadow-md: 0 8px 24px rgba(22, 50, 79, 0.10);
```

Uso:

- cards: ninguna o `shadow-xs`;
- dropdowns: `shadow-sm`;
- modal/dialog: `shadow-md`;
- evitar sombras oscuras o difusas;
- preferir borde para definir superficies.

## 15. Botones

Variantes:

```text
primary | secondary | tertiary | destructive
```

Tamaños:

```text
sm | md | lg | icon
```

`md` es el default para interfaces institucionales. Todo control táctil,
incluidos los botones `icon`, conserva un target mínimo de `44 x 44 px`.

### Primario

- fondo `brand-900`;
- texto blanco;
- hover ligeramente más claro;
- altura `40 px` desktop;
- altura mínima `44 px` mobile;
- peso `600`;
- ícono opcional a la izquierda;
- un único primario dominante por región.

### Secundario

- fondo `surface`;
- borde `border-strong`;
- texto `brand-900`;
- hover `surface-muted`.

### Terciario

- sin superficie permanente;
- texto `brand-700`;
- hover suave;
- acciones de menor prioridad.

### Destructivo

- usa estado destructivo rojo;
- reservado para revocación o acciones irreversibles;
- exige confirmación clara;
- no puede parecer una acción primaria común.

### Estados obligatorios

Todo botón contempla:

- default;
- hover;
- focus-visible;
- active;
- disabled;
- loading.

Reglas:

- no usar gradientes;
- no ocultar label en desktop sin motivo;
- loading no cambia el ancho de forma brusca;
- icon-only requiere `aria-label` y tooltip cuando corresponda.

## 16. Inputs y formularios

- altura base y token `input-height-default`: `44 px`;
- fondo `surface`;
- borde visible;
- radius `radius-control`;
- label permanente encima;
- placeholder solo como ejemplo;
- focus ring general `focus-ring-default`: `brand-600`;
- error debajo del campo;
- helper separado del error;
- campos técnicos monoespaciados solo cuando corresponda.

Nunca usar placeholder como única etiqueta.

El teal no se usa como focus ring general porque se reserva principalmente
para análisis y contenido formativo. Los errores de campo usan borde y focus
destructivos.

### Upload de PDF

Debe mostrar:

- formatos aceptados;
- límite de `20 MB`;
- nombre del archivo;
- tamaño;
- posibilidad de reemplazo;
- loading de upload/procesamiento;
- error recuperable;
- aclaración de que el análisis es asistido.

No mezclar en un único estado:

```text
archivo seleccionado
archivo enviado
análisis iniciado
análisis completado
análisis parcial
análisis fallido
```

### Procesamiento síncrono actual

El frontend actual no dispone de endpoints de progreso ni jobs asíncronos
para análisis de PDF o construcción de perfil.

Reglas:

- usar loading indeterminado durante el request;
- no inventar porcentajes;
- no afirmar `seguiremos procesando en segundo plano`;
- no mostrar `pendiente` como estado persistido si el backend no lo devuelve;
- distinguir selección de archivo, request en curso, respuesta completada,
  respuesta parcial y fallo.

### Validación

- validar temprano sin bloquear escritura;
- conservar input cuando el request falla;
- traducir errores backend a copy comprensible;
- no mostrar solo códigos `400`, `422`, `503` o `504`.

## 17. Badges

- altura aproximada `24 px`;
- padding horizontal `8-10 px`;
- texto `12-13 px`;
- peso `600`;
- ícono opcional de `12-14 px`;
- una sola línea;
- label corto;
- color semántico por dominio.

Los badges no reemplazan explicaciones cuando el estado tiene consecuencias.

No usar `rounded-full` para todos los labels de la interfaz. Reservarlo para
badges y elementos compactos.

`Badge` puede existir como primitiva visual, pero los estados de dominio deben
encapsular su mapping en componentes explícitos:

```text
CredentialStatusBadge
AnalysisStatusBadge
VerificationStatusBadge
EvidenceStatusBadge
```

No pasar strings arbitrarios ni colores directamente desde una pantalla.

## 18. Cards y patrones base

### Card base

- fondo `surface`;
- borde `border-default`;
- radius `radius-card`;
- sombra opcional `xs`;
- padding `20-24 px`.

### Card interactiva

- cambio sutil de borde;
- sombra leve;
- cursor coherente;
- foco visible;
- sin salto vertical exagerado.

### Card de estado

- banda, ícono o encabezado semántico;
- superficie mayormente neutral;
- no pintar toda la card con color saturado.

### Card técnica

- fondo `surface-muted`;
- hash abreviado;
- tipografía monoespaciada;
- detalles expandibles;
- acción copiar visible.

### Regla de composición

No convertir cada bloque interno en otra card. Usar:

- secciones;
- divisores;
- listas;
- definition lists;
- tablas;

antes de anidar superficies.

### Alert

- variantes: `info`, `success`, `warning`, `error`;
- título opcional, descripción y acción de recuperación;
- uso inline cuando afecte un formulario o bloque;
- no usar toast como único canal para errores importantes.

### Toast

- reservado para confirmaciones no críticas o feedback global breve;
- no ocultar revocaciones, errores de emisión o fallos de análisis solamente
  en un toast;
- debe ser anunciable mediante tecnologías asistivas.

### EmptyState

- explica por qué no hay contenido;
- ofrece una acción solo si el actor realmente puede realizarla;
- diferencia lista vacía de resultado vacío por filtros;
- no usa ilustraciones infantiles.

### LoadingState y Skeleton

- preservan la estructura y evitan saltos;
- usar skeleton para lectura o listas;
- usar spinner o indicador indeterminado para acciones;
- no mostrar porcentajes falsos.

### ErrorState

- explica qué no pudo completarse;
- preserva datos del formulario cuando sea posible;
- ofrece reintento o navegación segura;
- no muestra códigos HTTP como mensaje principal.

### Dialog de confirmación

- se usa para emisión irreversible, revocación futura y acciones destructivas;
- indica el objeto, la consecuencia y la acción;
- diferencia claramente el botón destructivo;
- controla el foco y permite un cierre accesible.

Los props detallados se definen en
`frontend-component-inventory-v0.md`.

## 19. Tablas

- encabezados discretos;
- filas de altura cómoda;
- separadores horizontales;
- pocas líneas verticales;
- estado con badge y label;
- acciones secundarias en menú contextual;
- IDs y hashes truncados;
- fila completa accesible cuando sea interactiva.

En mobile:

- convertir a cards o filas apiladas;
- preservar labels de cada valor;
- priorizar título, institución emisora, estado y fecha;
- no depender exclusivamente de scroll horizontal.

Estados necesarios:

- loading;
- empty;
- error;
- sin resultados por filtro;
- paginación futura.

## 20. Timelines

El timeline es un recurso distintivo de Traza.

Hitos reales:

```text
Borrador creado
-> Credencial emitida
-> Evidencia registrada
-> Contenido analizado
```

Características:

- línea fina;
- nodos pequeños;
- fecha;
- label;
- completado o actual;
- pendiente solo cuando el backend confirme un paso futuro real;
- ícono semántico;
- explicación opcional.

No inventar pasos que el backend no pueda confirmar. No usar animaciones
llamativas ni recorridos decorativos continuos.

## 21. Diseño de credenciales

Una credencial no debe parecer:

- certificado impreso;
- NFT;
- tarjeta bancaria cripto;
- coleccionable.

Información principal:

- institución emisora;
- título del logro;
- titular;
- tipo;
- fecha;
- estado;
- identificador secundario;
- acceso a detalle y evidencia.

Puede incluir un patrón gráfico sutil basado en trazos o nodos.

### Portal emisor

- versión compacta;
- más metadata;
- acciones operativas;
- estado de emisión, IA y evidencia separados.

### Wallet holder

- versión más visual;
- título e institución emisora dominantes;
- lectura táctil;
- estado claro;
- acceso fácil al detalle.

### Verificador

- estado de verificación dominante;
- institución emisora y evidencia visibles;
- decoración mínima.

## 22. Diseño del perfil formativo

El perfil es una lectura estructurada de trayectoria, no un ranking personal.

Mostrar:

- áreas;
- skills;
- conceptos;
- horas cuando sean confiables;
- fuentes utilizadas;
- confianza del análisis;
- advertencias;
- fecha de generación;
- `Credenciales utilizadas` solo cuando el DTO represente realmente una
  cantidad de credenciales;
- `Fuentes analizadas` cuando el dato represente artifacts semánticos o
  fuentes.

Reglas de honestidad:

- nunca mostrar `artifact` como término de producto;
- no asumir que `artifactCount` equivale a credenciales completadas;
- un catálogo online no prueba finalización;
- no mostrar una cantidad ambigua si el backend no permite explicarla con
  precisión.

Evitar:

- porcentajes de dominio;
- estrellas;
- niveles inventados;
- rankings;
- comparaciones competitivas;
- etiquetas como `experto`;
- barras personales sin evidencia.

### Jerarquía sugerida

1. Resumen y fecha.
2. Áreas principales.
3. Skills.
4. Conceptos.
5. Fuentes y evidencia.
6. Confianza y advertencias.
7. Detalle técnico expandible, si corresponde.

No mostrar `profileJson` o artifacts completos como contenido de usuario.

### Confianza del análisis

La confianza describe la confiabilidad o cobertura de la interpretación
semántica. No representa nivel, dominio o capacidad del titular.

Reglas:

- no usar `84% competente`, `nivel de habilidad`, `dominio` ni expresiones
  equivalentes;
- `unavailable`, `null` o ausencia de score no equivalen a `0%`;
- mostrar `Confianza no disponible` cuando corresponda;
- si el backend entrega solo una valoración cualitativa, mostrar únicamente
  esa valoración;
- si existe un score numérico válido y documentado, mostrarlo como dato
  secundario con una explicación;
- no usar gauges llamativos, rankings, estrellas ni barras competitivas;
- mantener visibles warnings y partial reasons aunque el score sea alto;
- no inventar thresholds frontend para `alta`, `media` o `baja`;
- cualquier threshold debe provenir de un contrato acordado o de un mapper
  central documentado;
- conservar `measured`, `derived`, `heuristic` o `unavailable` en el view
  model cuando exista, y explicarlo en el detalle técnico si aporta valor.

## 23. Representación visual de IA

Nombre de capacidad:

```text
Análisis formativo asistido
```

Tratamiento:

- teal;
- ícono de nodos, capas o destellos discretos;
- resumen estructurado;
- confianza visible con la semántica definida en este documento;
- advertencias visibles;
- estado completo o parcial;
- fecha del análisis;
- explicación de la fuente.

Copy recomendado:

```text
El análisis identificó habilidades y áreas a partir del contenido aportado.
```

No usar:

- robot;
- cerebro;
- antropomorfismo;
- gradiente violeta-neón;
- partículas;
- `la IA comprendió completamente`;
- `certificación por IA`;
- `inteligencia definitiva`.

La IA asiste la interpretación; no prueba finalización, no emite y no
determina la validez blockchain.

## 24. Representación visual de blockchain

Nombre recomendado:

```text
Evidencia de integridad
```

Es un bloque técnico secundario y expandible.

Contenido:

- estado del registro;
- red;
- hash abreviado;
- versión de canonicalización, solo en detalle técnico;
- referencia de transacción;
- acción copiar;
- explicación simple.

Tratamiento:

- indigo semántico;
- superficie neutra o muted;
- tipografía monoespaciada para datos;
- jerarquía secundaria.

No usar:

- logos grandes de criptomonedas;
- fondos negros;
- cadenas 3D;
- hexágonos decorativos;
- neones;
- `secured by blockchain` como protagonista.

El holder no necesita comprender wallets, gas, private keys o contratos para
usar Traza. No se le pide MetaMask.

### Evidencia real, local o mock

- usar `Evidencia de integridad` como nombre general del bloque;
- usar `Evidencia registrada` cuando exista un registro técnico asociado;
- usar `Evidencia registrada en entorno local/demo` cuando el backend o la
  configuración indiquen un adaptador local o mock;
- afirmar `Registro blockchain disponible` o `Registrada en blockchain`
  únicamente cuando el DTO confirme una red y un registro blockchain real;
- mostrar red, chain ID, contrato o transacción solo cuando estén disponibles;
- no inventar exploradores, enlaces de transacción ni estado on-chain;
- recordar que evidencia registrada no equivale por sí sola a verificación
  válida.

## 25. Iconografía

Biblioteca recomendada:

```text
Lucide
```

Reglas:

- una sola biblioteca;
- estilo lineal;
- trazo consistente;
- `16 px` en controles;
- `20 px` en cards;
- `24 px` en encabezados;
- no mezclar familias;
- no usar ícono como único significado.

Los íconos deben acompañar labels y respetar `aria-hidden` o nombres accesibles
según su función.

## 26. Animaciones

- duración `150-220 ms`;
- easing suave;
- solo feedback, hover, expansión y cambio de estado;
- respetar `prefers-reduced-motion`;
- evitar desplazamientos grandes;
- evitar animaciones decorativas continuas.

No animar cadenas, nodos, fondos o partículas como recurso cripto.

Las cargas largas deben usar:

- indicador de progreso si existe información real;
- estado indeterminado si no existe;
- copy explicativo;
- opción de recuperación ante error.

## 27. Dark mode

No incluir dark mode en el MVP.

La identidad v0 se define sobre una interfaz clara e institucional. Dark mode
duplicaría decisiones y validaciones sin aportar valor directo a la demo.

No agregar clases `dark:*` de forma preventiva.

## 28. Tono verbal y microcopy

Traza habla de manera:

- clara;
- profesional;
- serena;
- precisa;
- transparente;
- orientada a la acción;
- comprensible para personas no técnicas.

### Glosario interno y visible

Los nombres internos pueden mantenerse en código o documentación técnica, pero
no deben filtrarse automáticamente a la interfaz.

| Término interno | Etiqueta visible recomendada |
|---|---|
| `issuer` | Institución emisora |
| `holder` | Titular |
| `wallet` | Mis credenciales o Mi Traza |
| `SemanticAnalysis` | Análisis formativo |
| `confidence` | Confianza del análisis |
| `warnings` | Advertencias |
| `artifact` | No mostrar como label |
| `BlockchainRecord` | Evidencia de integridad o Registro de evidencia |
| `canonicalizationVersion` | Versión de canonicalización, solo en detalle técnico |

`Mi Traza` continúa como opción de arquitectura verbal; no queda fijado todavía
como label definitivo de navegación.

### Explicar antes que exhibir tecnología

Usar:

```text
La evidencia registrada permite comprobar que el contenido no fue alterado.
```

Evitar:

```text
Hash inmutable asegurado criptográficamente on-chain.
```

### Describir lo que ocurrió

Usar:

```text
El análisis identificó 8 habilidades y 3 áreas formativas.
```

Evitar:

```text
La IA comprendió completamente tu formación.
```

### Reconocer limitaciones

Usar:

```text
Algunos contenidos no pudieron clasificarse con suficiente confianza.
```

Evitar:

```text
Análisis exitoso.
```

No usar ese mensaje si existen advertencias relevantes.

### Ofrecer recuperación

Usar:

```text
No pudimos analizar el PDF. Revisá que el archivo sea válido e intentá
nuevamente.
```

Evitar:

```text
Error 422.
```

### Segunda persona

La interfaz inicial usa español de Argentina con voseo moderado en
instrucciones y acciones dirigidas a la persona:

- `Revisá los datos`;
- `Seleccioná las credenciales`;
- `Subí un archivo PDF`;
- `Intentá nuevamente`;
- `Emití, reuní y verificá credenciales educativas en un solo lugar`.

Los mensajes de resultado generados por el sistema usan construcción neutral:

- `La credencial fue emitida`;
- `El análisis se completó parcialmente`.

Reglas:

- no mezclar voseo, tuteo y tratamiento de usted dentro del mismo flujo;
- usar verbos de acción breves en botones;
- usar lenguaje neutral para estados generados por el sistema.

### Locale y formato local

Locale inicial:

```text
es-AR
```

Reglas:

- interfaz en español;
- fechas legibles, nunca ISO crudo como formato principal;
- usar formato corto o textual según el contexto, por ejemplo `25 jul 2026`;
- usar horario de 24 horas;
- mostrar duraciones como `64 h`;
- reservar IDs, hashes y timestamps completos para el detalle técnico;
- conservar los datos originales del backend sin reinterpretarlos;
- centralizar el formateo futuro y no dispersarlo manualmente por componentes.

No hace falta implementar todavía un sistema completo de
internacionalización.

## 29. Palabras recomendadas

- credencial;
- trayectoria;
- evidencia;
- verificar;
- emitir;
- institución emisora;
- titular;
- contenido formativo;
- análisis;
- interpretación;
- confianza;
- advertencia;
- integridad;
- registro;
- perfil formativo;
- fuente;
- trazabilidad.

Palabras técnicas permitidas con explicación:

- blockchain;
- hash;
- canonicalización;
- DID;
- artifact;
- pipeline;
- taxonomía;
- score;
- on-chain;
- off-chain.

Usarlas principalmente en detalles técnicos o vistas avanzadas.

## 30. Palabras a evitar

- NFT;
- tokenizar tu educación;
- wallet cripto;
- inteligencia definitiva;
- certificación por IA;
- perfil garantizado por IA;
- conocimiento validado por blockchain;
- experto;
- dominio total;
- prueba absoluta;
- infalible;
- revolucionario;
- disruptivo;
- mágico.

No usar claims que excedan la evidencia disponible.

## 31. Reglas específicas por experiencia

### Portal emisor

- web responsive, optimizado para resoluciones medianas y amplias;
- mayor densidad;
- navegación estable;
- tablas y filtros;
- acciones operativas claras;
- institución emisora visible;
- upload y análisis separados;
- confirmación en emisión y acciones irreversibles;
- no ocultar advertencias del análisis;
- reorganizar tablas y acciones como listas, cards, drawers o secciones
  apiladas en pantallas pequeñas;
- no usar scroll horizontal como única adaptación;
- no excluir mobile ni establecer tablet como ancho mínimo funcional.

El usuario opera dentro del contexto de una institución emisora obtenido desde
su sesión, sus memberships y la credencial persistida.

Reglas de autoridad:

- no pedir al usuario que escriba o manipule un `issuerId` como mecanismo de
  autoridad;
- mostrar el nombre y contexto institucional, no IDs internos como elemento
  principal;
- dejar la validación de permisos y autoridad en el backend;
- no asumir autorización por ocultar o mostrar controles.

Para cursos sin PDF, la carga textual futura corresponde al emisor,
`admin` u `operator`, nunca al holder.

### Wallet holder

- mobile-first;
- lenguaje personal;
- cards táctiles;
- institución emisora y título prioritarios;
- detalle técnico progresivo;
- CTA de perfil claro;
- no mostrar drafts;
- no permitir carga unilateral de formación;
- no pedir wallet cripto ni firma;
- confianza del análisis y advertencias comprensibles.

### Verificador público

- mobile-first, responsive, público y focal;
- estado de verificación dominante;
- institución emisora y credencial legibles;
- evidencia secundaria expandible;
- hash copiable;
- semántica permitida, no artifact crudo;
- sin dashboard innecesario;
- sin login en v0;
- preparado para acceso futuro por QR.

## 32. Convenciones de implementación en Tailwind

### Fuente y tokens

- cargar Inter una vez mediante `next/font`;
- exponer la familia como variable/token;
- definir colores como tokens Tailwind o CSS variables;
- mantener nombres estables aunque cambie la forma de configurar Tailwind.

Referencia conceptual:

```css
:root {
  --color-brand-900: #16324F;
  --color-brand-700: #1E496B;
  --color-brand-600: #256087;
  --color-brand-100: #EAF2F7;

  --color-teal-700: #197278;
  --color-teal-600: #23838A;
  --color-teal-100: #E5F4F3;

  --color-amber-600: #C68A2D;
  --color-amber-800: #7A4D08;
  --color-amber-100: #FFF3D9;

  --color-canvas: #F6F8F8;
  --color-surface: #FFFFFF;
  --color-surface-muted: #EEF3F3;

  --color-text-strong: #1B2936;
  --color-text-default: #344451;
  --color-text-muted: #5D6B76;
  --color-text-subtle: #7C8992;

  --color-border-default: #DCE3E5;
  --color-border-strong: #C6D0D3;

  --focus-ring-default: var(--color-brand-600);
  --input-height-default: 44px;

  --radius-control: 10px;
  --radius-card: 14px;
  --radius-dialog: 18px;
  --radius-pill: 9999px;
}
```

Los tokens de estados deben vivir separados de la marca:

```text
status-issued
status-analysis
status-valid
status-evidence
status-warning
status-error
status-revoked
status-draft
status-analysis-partial
status-unknown
```

Estos tokens de color no sustituyen los componentes de dominio
`CredentialStatusBadge`, `AnalysisStatusBadge`, `VerificationStatusBadge` y
`EvidenceStatusBadge`, ni los componentes de feedback.

### Prohibiciones

No usar dentro de componentes de dominio:

```text
bg-green-500
text-blue-600
border-red-400
bg-[#16324F]
rounded-[17px]
p-[18px]
```

salvo que exista una excepción documentada.

Usar:

```text
bg-brand-900
text-status-valid
bg-status-valid-soft
border-border-default
rounded-card
p-6
```

Los nombres exactos de clases dependen de la configuración Tailwind, pero la
semántica debe mantenerse.

Registrar `rounded-control`, `rounded-card`, `rounded-dialog` y
`rounded-pill` como aliases semánticos. No depender de los valores default de
`rounded-lg`, `rounded-xl` o equivalentes.

### Variantes de componentes

Centralizar variantes:

```text
Button variants: primary | secondary | tertiary | destructive
Button sizes: sm | md | lg | icon
CredentialStatusBadge: draft | issued | revoked
AnalysisStatusBadge: not-analyzed | completed | partial
VerificationStatusBadge: valid | revoked | incomplete | draft | not-found
EvidenceStatusBadge: registered | local-demo | unavailable
FeedbackAlert: info | success | warning | error
Card: base | interactive | status | technical
```

No construir colores mediante concatenación dinámica de strings que Tailwind
no pueda detectar.

### Responsive

- usar breakpoints Tailwind consistentes;
- no agregar media queries aisladas si una utility resuelve el caso;
- portal responsive con densidad optimizada para resoluciones medianas y
  amplias;
- wallet y verificador mobile-first;
- no establecer tablet como mínimo funcional del portal;
- reorganizar tablas y acciones en pantallas pequeñas;
- preservar targets de `44 px`.

### Focus y accesibilidad

- `focus-visible` obligatorio en controles;
- no remover outline sin reemplazo;
- usar `brand-600` mediante `focus-ring-default` como focus general;
- usar focus y borde destructivos para campos con error;
- contraste WCAG debe validarse en implementación;
- labels asociados a inputs;
- icon-only con nombre accesible;
- tablas con estructura semántica;
- estados anunciables para tecnologías asistivas.

### Motion

Usar utilities compatibles con:

```text
motion-reduce
```

No crear transiciones globales sobre todas las propiedades.

### Datos

- mapear DTOs backend a view models cuando sea necesario;
- no importar tipos Prisma, ethers o FastAPI en componentes;
- no renderizar `analysisJson`, `profileJson` o artifacts completos;
- centralizar labels y visuales de estados;
- no deducir estados a partir de colores o strings parciales.

## 33. Decisiones que Codex no puede modificar libremente

Defaults obligatorios:

- marca: `Traza`;
- tagline: `Credenciales verificables para trayectorias formativas confiables`;
- tipografía: Inter;
- primario: azul tinta;
- secundario: teal;
- acento: ámbar sobrio;
- verde reservado principalmente para verificación válida;
- IA en teal como interpretación asistida;
- blockchain en indigo como evidencia secundaria;
- portal emisor web responsive, optimizado para tareas institucionales;
- wallet holder mobile-first;
- verificador público mobile-first, responsive y focal;
- locale inicial `es-AR`;
- wordmark textual `Traza` con Inter `700` hasta aprobar un logo;
- sin dark mode en MVP;
- sin MetaMask para holder;
- sin gradientes dominantes;
- sin neones;
- sin estética NFT;
- sin gamificación infantil;
- sin dashboard genérico;
- sin artifacts crudos;
- sin acceso frontend directo a FastAPI.

Codex tampoco puede:

- confundir credencial emitida con verificación válida;
- confundir análisis completado con certeza;
- confundir evidencia registrada con validez total;
- convertir catálogo online en prueba de finalización;
- permitir que el holder cargue formación como emisor;
- inventar datos, estados o pasos no confirmados por backend.

## 34. Criterios de aceptación visual

Toda pantalla o componente nuevo debe pasar este checklist:

### Marca

- usa Traza correctamente;
- respeta tagline y tono;
- no introduce identidad alternativa;
- usa el wordmark textual mientras no exista un logo aprobado.

### Color

- usa tokens;
- reserva verde para `valid`;
- diferencia emisión, IA, verificación y evidencia;
- no depende solo del color.

### Tipografía

- usa Inter;
- respeta jerarquía;
- limita monoespaciada a datos técnicos.

### Componentes

- usa spacing de 4 px;
- respeta aliases semánticos de radius y sombras;
- tiene estados hover/focus/disabled/loading;
- no abusa de cards o pills;
- separa estados de dominio de feedback.

### Responsive

- las tres experiencias funcionan en pantallas pequeñas;
- el portal aprovecha resoluciones amplias sin excluir mobile;
- mantiene targets táctiles;
- no depende solo de tabla horizontal.

### Accesibilidad

- labels visibles;
- focus visible;
- íconos con significado acompañado;
- contraste validado;
- reduced motion respetado.

### Dominio

- no expone artifacts crudos;
- no inventa datos;
- no mezcla estados;
- IA y blockchain son secundarios;
- holder no firma ni usa MetaMask;
- frontend solo consume NestJS.

### Copy

- explica el resultado;
- reconoce limitaciones;
- ofrece recuperación;
- evita claims absolutos y jerga innecesaria;
- mantiene voseo moderado y locale `es-AR`;
- no filtra nombres internos como labels.

Una implementación que no cumpla estos puntos no se considera terminada,
aunque sea funcional.

## 35. Próximos documentos frontend sugeridos

1. `frontend-information-architecture-v0.md`
   - rutas;
   - navegación;
   - jerarquía por actor.

2. `frontend-data-and-view-models-v0.md`
   - DTOs backend;
   - view models;
   - mapeo de estados;
   - datos técnicos expandibles.

3. `frontend-component-inventory-v0.md`
   - componentes;
   - props;
   - variantes;
   - ownership.

4. Especificación del Portal del Emisor.

5. Especificación de Wallet y Perfil del Titular.

6. Especificación del Verificador Público.

7. `frontend-content-and-microcopy-v0.md`
   - labels;
   - mensajes;
   - errores;
   - empty states;
   - consolidación del copy de los flujos.

8. `frontend-accessibility-checklist-v0.md`
   - WCAG;
   - teclado;
   - lectores de pantalla;
   - contraste.

Estos documentos deben extender este design system, no reemplazarlo.

Orientación de implementación funcional:

```text
fundamentos compartidos
-> Portal del Emisor mínimo
-> Wallet y perfil del titular
-> Verificador Público
```

Este orden orienta la implementación. No constituye una especificación de
pantallas ni incorpora wireframes en este documento.
