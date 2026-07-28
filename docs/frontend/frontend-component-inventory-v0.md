# Traza: Inventario de componentes frontend v0

## 1. Propósito

Este documento define el inventario normativo de componentes conceptuales de
Traza. Traduce la marca, la arquitectura de información y los contratos de
datos en bloques de interfaz con responsabilidades explícitas.

El inventario establece:

- qué componentes se justifican;
- qué modelo seguro recibe cada componente;
- qué intención de producto puede emitir;
- qué estados y variantes soporta;
- qué responsabilidades le pertenecen;
- qué responsabilidades quedan fuera;
- en qué experiencias puede reutilizarse;
- qué comportamiento responsive y accesible requiere;
- cuándo conviene implementarlo;
- qué componentes están bloqueados o son futuros.

No define todavía:

- composición final de pantallas;
- wireframes o mockups;
- archivos React;
- firmas TypeScript;
- librerías;
- fetching;
- rutas;
- layouts definitivos.

Estado:

```text
versión: v0
carácter: normativo
alcance: taxonomía y contratos conceptuales de componentes frontend
aplicación: Traza web
locale: es-AR
```

## 2. Snapshot y fuentes de verdad

Snapshot usado:

```text
fecha: 2026-07-27
branch: main
commit: e7319e1
```

Actualizaciones posteriores al snapshot base:

- P0.1 protegió `POST /credentials/draft`.
- P0.2 agregó issuer summaries seguros en `GET /auth/me`.

Documentos normativos leídos:

```text
docs/frontend/frontend-brand-and-design-system-v0.md
docs/frontend/frontend-information-architecture-v0.md
docs/frontend/frontend-data-and-view-models-v0.md
```

Contexto adicional consultado:

```text
docs/frontend/frontend-roadmap-v0.md
docs/frontend/ui-ux-handoff-context-v0.md
```

Ante contradicciones, aplicar esta precedencia:

1. Backend real para datos, permisos y capacidades.
2. `frontend-data-and-view-models-v0.md` para transport models, adapters,
   view models, privacidad y campos prohibidos.
3. `frontend-information-architecture-v0.md` para actores, rutas, navegación
   y disponibilidad A/B/C/D.
4. `frontend-brand-and-design-system-v0.md` para marca, tokens, responsive,
   accesibilidad y tono.
5. Este documento para taxonomía, responsabilidad, composición y fases de
   componentes.

Decisiones de precedencia aplicadas:

- la sugerencia histórica de permitir DTOs en componentes queda descartada;
  los componentes reciben únicamente view models, form models y display
  primitives;
- la sugerencia histórica de un `AppShell` universal queda descartada; las
  experiencias usan shells contextuales;
- el portal institucional es web responsive, no una experiencia limitada a
  desktop ni tablet;
- las rutas y capacidades clasificadas C o D no generan componentes
  funcionales ni placeholders.

## 3. Ubicación en el proceso

La secuencia documental y de implementación es:

```text
Brand and Design System
-> Information Architecture
-> Data and View Models
-> Component Inventory
-> Screen Specifications
-> Implementation
```

El inventario define las piezas disponibles y sus límites. Las futuras screen
specifications decidirán qué piezas componen cada pantalla, en qué orden y con
qué jerarquía.

Este documento no debe usarse como una especificación de pantalla encubierta.

## 4. Principios obligatorios

### Frontera de datos

Los componentes:

- consumen view models, form models y display primitives aprobados;
- no consumen DTOs backend;
- no reciben responses completas;
- no reciben `unknown`, `any` ni JSON arbitrario como contenido renderizable;
- no reciben artifacts IA;
- no reciben `analysisJson`;
- no reciben `profileJson` completo;
- no reciben `textForEmbedding`;
- no reciben `rawData`;
- no reciben tipos Prisma;
- no reciben objetos ethers;
- no reciben tipos FastAPI;
- no reciben modelos Solidity ni clientes blockchain.

Un componente no puede aceptar una response mediante spread ni usar un
`record` genérico para descubrir qué mostrar.

### Frontera funcional

Los componentes:

- no llaman endpoints;
- no instancian API clients;
- no ejecutan adapters;
- no traducen enums backend localmente;
- no resuelven autenticación;
- no deciden permisos efectivos;
- no autorizan operaciones;
- no persisten responses;
- no deciden redirects globales;
- no encadenan endpoints para completar datos faltantes.

El frontend consume exclusivamente NestJS. Ningún componente llama FastAPI,
PostgreSQL, Prisma, Anvil o un contrato.

### Honestidad de dominio

Los componentes:

- no inventan estados;
- no interpretan confidence como capacidad del titular;
- no confunden credencial emitida con verificación válida;
- no confunden análisis completado con evidencia registrada;
- no confunden evidencia registrada con validez total;
- no muestran nombres técnicos como labels de producto;
- no usan IDs como identidad humana;
- no presentan acceso por ID como consentimiento o sharing seguro;
- no tratan catálogos online como prueba de finalización.

Para cursos sin PDF o una futura carga textual, la carga corresponde a un
usuario institucional autorizado, `admin` u `operator`. Nunca corresponde al
titular como autodeclaración de formación completada.

### Seguridad de contenido

Todo texto dinámico se considera no confiable.

Los componentes:

- renderizan texto plano por defecto;
- no usan `dangerouslySetInnerHTML` con contenido recibido;
- no interpretan Markdown automáticamente;
- no insertan strings backend como HTML, CSS, clase o URL;
- reciben warnings y errores ya sanitizados y normalizados;
- muestran nombres de archivo como nombres, no como paths;
- validan links futuros mediante un contrato específico antes de mostrarlos.

## 5. Orquestación y presentación

### Capa de orquestación de ruta o pantalla

Responsabilidades:

- ejecutar data fetching;
- invocar el API client;
- validar transport models;
- ejecutar adapters;
- construir commands;
- resolver autenticación y contexto;
- manejar navegación y redirects;
- mantener action states;
- coordinar reintentos;
- seleccionar los view models que recibe cada componente;
- conservar `returnTo` interno seguro cuando corresponda.

Esta capa se detallará en screen specifications y decisiones técnicas
posteriores. No es un componente visual genérico.

### Componentes de presentación y dominio

Responsabilidades:

- renderizar view models;
- presentar estados de dominio y request;
- capturar interacción;
- emitir intenciones semánticas;
- mantener estado local de interacción cuando corresponda;
- aplicar reglas visuales y de accesibilidad.

No son responsables de:

- consultar endpoints;
- construir adapters;
- interpretar DTOs;
- autorizar;
- persistir;
- decidir redirects;
- resolver ownership;
- ejecutar comandos HTTP directamente.

No se crearán abstracciones ambiguas como:

```text
SmartCredentialPage
DataFetchingCard
```

## 6. Criterios para justificar un componente

Un componente existe cuando cumple al menos una condición:

- encapsula comportamiento accesible no trivial;
- centraliza una regla visual o semántica de dominio;
- se reutiliza entre más de un contexto real;
- protege un límite de privacidad o datos;
- representa una unidad funcional clara;
- evita duplicación significativa;
- requiere variantes controladas.

No se crea una abstracción solo porque:

- un fragmento aparece una vez;
- contiene pocos elementos HTML;
- podría aceptar muchas props genéricas;
- anticipa una reutilización hipotética;
- su nombre coincide con una sección de pantalla.

Principio:

```text
Primero una responsabilidad clara; después la reutilización.
```

## 7. Fases del inventario

| Fase | Significado |
|---|---|
| `F0` | Fundamento compartido |
| `F1` | Portal del Emisor mínimo |
| `F2` | Wallet y Perfil |
| `F3` | Verificador Público |
| `B` | Bloqueado por una capacidad backend faltante |
| `D` | Futuro o fuera del MVP |

La fase indica prioridad de implementación, no disponibilidad de ruta.

Un componente puede implementarse en F1 y reutilizarse luego en F2 o F3.

## 8. Taxonomía

### A. Primitivas visuales

No conocen dominio. Encapsulan interacción, accesibilidad y tokens visuales.

Inventario aprobado:

- `Button`;
- `IconButton`;
- `TextInput`;
- `Textarea`;
- `Select`;
- `Checkbox`;
- `FileInput`;
- `FormField`;
- `FieldLabel`;
- `FieldMessage`;
- `Card`;
- `Divider`;
- `Dialog`;
- `Alert`;
- `Toast`;
- `Tooltip`;
- `Skeleton`;
- `Spinner`;
- `EmptyState`;
- `ErrorState`;
- `CopyButton`;
- `Disclosure`.

Inventario condicionado:

- `RadioGroup`: solo cuando una screen specification confirme una elección
  mutuamente excluyente que no se resuelva mejor con `Select`;
- `FileDropzone`: puede ser variante progresiva de `FileInput`, nunca el único
  mecanismo de carga;
- `Drawer`: solo cuando una necesidad responsive confirmada lo requiera;
- `TruncatedText`: solo si puede preservar acceso al valor y semántica.

No implementar todavía:

- `Table`, porque el listado institucional está bloqueado;
- `Tabs`, hasta que una screen specification demuestre su necesidad;
- una primitiva genérica sin consumidor previsto.

### B. Display primitives

Presentan valores ya normalizados:

- `DisplayDate`;
- `DisplayIdentifier`;
- `TechnicalDetailItem`;
- `TechnicalDetailsDisclosure`;
- `StatusLabel`;
- `ConfidenceDisplay`;
- `CountDisplay`;
- `TruncatedText`, cuando exista necesidad accesible confirmada.

Reciben `DisplayDateVM`, `DisplayIdentifierVM`, `TechnicalDetailVM` o
submodelos normalizados. No reciben valores backend crudos.

### C. Feedback y estado de dominio

- `CredentialStatusBadge`;
- `AnalysisStatusBadge`;
- `VerificationStatusBadge`;
- `EvidenceStatusBadge`;
- `FeedbackAlert`;
- `InlineError`;
- `ActionFeedback`;
- `LoadingState`;
- `UnsupportedDataState`.

Cada componente:

- usa un token semántico definido;
- muestra label e ícono;
- no recibe colores arbitrarios;
- no comparte enums entre dominios;
- no confunde estado persistido con estado de request.

### D. Dominio compartido

- `CredentialIdentitySummary`;
- `CredentialLifecycleTimeline`;
- `CredentialSubjectSummary`;
- `EvidenceSummary`;
- `SemanticAnalysisSummary`;
- `ConfidenceSummary`;
- `WarningsList`;
- `QualityFlagsList`;
- `TechnicalEvidenceDetails`;
- `IssuerSummary`;
- `HolderSummary`, solo donde la política de visibilidad lo permita;
- `FormativeProfileSummary`;
- `FormativeProfileAreaList`;
- `FormativeProfileSkillList`;
- `FormativeProfileConceptList`.

`CredentialCard` no se establece como abstracción base en F0. La jerarquía
operativa del emisor, la lectura personal del titular y el resultado focal del
verificador son diferentes. Puede evaluarse después de F2 si aparece una
estructura verdaderamente común; mientras tanto se reutilizan subcomponentes
de identidad, estado y evidencia.

No se crean simultáneamente `ConfidenceDisplay`, `ConfidencePanel` y
`ConfidenceCard`. `ConfidenceDisplay` presenta el valor normalizado;
`ConfidenceSummary` agrega explicación, drivers o limitaciones cuando el VM
los provee.

### E. Portal del Emisor

- `IssuerHomeIntro`;
- `CreateCredentialDraftForm`;
- `CredentialDraftSummary`;
- `IssueCredentialSection`;
- `IssuerCredentialLifecycleSection`;
- `PdfAnalysisUploadSection`;
- `PdfAnalysisResultSection`;
- `IssuerCredentialEvidenceSection`;
- `IssuerCredentialActions`.

No existe `IssuerCredentialDetailView`: una pantalla completa será definida
por la screen specification correspondiente.

### F. Wallet y Perfil

- `HolderCredentialList`;
- `HolderCredentialListItem`;
- `HolderCredentialSummary`;
- `ProfileCredentialSelector`;
- `ProfileCredentialEligibilityItem`;
- `CurrentProfileState`;
- `BuildProfileSection`;
- `ProfileSourcesSummary`;
- `ProfileLimitationsList`.

La composición completa de `/wallet/credentials/[id]` y `/wallet/profile`
queda fuera de este documento.

### G. Verificador Público

- `VerifyCredentialSearchForm`;
- `VerificationStatusHero`;
- `VerificationCredentialSummary`;
- `PublicEvidenceSummary`;
- `VerificationAnalysisSummary`;
- `VerificationTechnicalDetails`;
- `VerificationNotFoundState`.

No se crea dashboard, historial ni navegación autenticada.

### H. Shells y navegación

- `AuthLayout`;
- `IssuerShell`;
- `WalletShell`;
- `PublicVerificationLayout`;
- `ProductHeader`;
- `AuthenticatedUserMenu`;
- `IssuerNavigation`;
- `WalletNavigation`;
- `SkipLink`;
- `MobileNavigation`, cuando la screen specification confirme su patrón.

`Breadcrumbs` queda condicionado a que las screen specifications demuestren
valor real y definan labels centralizados.

No se crea:

- un `AppShell` universal;
- `ContextSwitcherPlaceholder`;
- un selector multi-issuer vacío.

El cambio de contexto se incorporará solo cuando exista soporte real.

## 9. Variantes y estados normativos

### `Button`

```text
variant: primary | secondary | tertiary | destructive
size: sm | md | lg | icon
state: default | loading | disabled
```

Hover, focus y active son estados de interacción visual, no necesariamente
props.

### `CredentialStatusBadge`

```text
draft | issued | revoked | unknown
```

### `AnalysisStatusBadge`

```text
not_analyzed | completed | partial | unknown
```

### `VerificationStatusBadge`

```text
valid | revoked | incomplete | draft | not_found | unknown
```

### `EvidenceStatusBadge`

Consume `EvidenceStatusVM`. No reduce evidencia a un string único.

Debe considerar por separado:

- `registrationStatus`;
- `recordStatus`;
- `environment`;
- provenance.

### Feedback

```text
info | success | warning | error
```

### Action state

```text
idle | validating | submitting | success | error
```

`validating` se usa solo en flujos que realmente realizan una validación local
distinguible.

### `CurrentProfileState`

Consume exactamente:

```text
empty | available | unsupported
```

Nunca convierte `unsupported` en `empty`.

## 10. Eventos e intenciones

Los componentes emiten intenciones de producto:

- `onSubmitLogin`;
- `onCreateDraft`;
- `onIssueCredential`;
- `onSelectPdf`;
- `onAnalyzePdf`;
- `onRetry`;
- `onCopyIdentifier`;
- `onSelectCredentialForProfile`;
- `onBuildProfile`;
- `onVerifyCredential`;
- `onLogout`;
- `onOpenCredential`;
- `onConfirm`;
- `onCancel`;
- `onToggleTechnicalDetails`.

Reglas:

- una intención describe una acción del producto;
- el componente no ejecuta el endpoint;
- no existen callbacks tecnológicos como `onCallApi`;
- los formularios emiten form models validados localmente;
- la orquestación construye command payloads;
- una acción irreversible requiere confirmación cuando corresponda;
- este documento no fija firmas TypeScript finales.

## 11. Reglas de composición

- una pantalla compone componentes, pero no transforma DTOs;
- un componente de dominio recibe un VM específico;
- una primitiva no recibe enums backend;
- un badge de dominio no recibe colores ni labels arbitrarios;
- un componente público recibe únicamente VMs públicos minimizados;
- ningún componente recibe una response mediante spread;
- ningún componente acepta `data: any`, `record: unknown` o JSON para render
  genérico;
- evitar componentes con decenas de props opcionales;
- preferir VMs discriminados;
- evitar `CredentialEverythingCard`;
- evitar un componente distinto por ruta si comparte responsabilidad de
  dominio;
- no anidar cards sin una jerarquía real;
- no usar toast como único canal para errores importantes;
- no ocultar información crítica en tooltips;
- no eliminar acciones en mobile: reorganizarlas;
- no convertir una card completa en botón si contiene acciones internas;
- no duplicar lógica de status, confidence o evidencia.

Una variante contextual es suficiente cuando conserva el mismo VM, semántica
y responsabilidad y solo cambia densidad o jerarquía visual. Se justifica un
componente específico cuando cambia el contrato de privacidad, la intención o
la unidad funcional.

## 12. Matriz componente-modelo: fundamentos

| Componente | Categoría | Experiencia | Modelo recibido | Intenciones emitidas | Responsabilidad | Variantes/estados | Responsive | Accesibilidad | Reutilización | Fase | No debe conocer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `Button` | Primitiva | Todas | Label seguro y action state local | Intención semántica asignada | Ejecutar una acción visible | Variantes y tamaños normativos | Target mínimo 44 px; puede ocupar ancho disponible | Focus visible; disabled real; loading anunciado | Alta | F0 | Endpoint, permiso, enum backend |
| `IconButton` | Primitiva | Todas | Label accesible e ícono aprobado | Intención semántica | Acción compacta sin perder nombre | Default, loading, disabled | Target 44 x 44 px | Nombre accesible; tooltip complementario | Alta | F0 | Acción tecnológica, color arbitrario |
| `TextInput` | Primitiva | Auth y forms | Valor de form model y estado de campo | Cambio o blur semántico | Captura texto corto | Default, focus, error, disabled | Ancho fluido | Label asociado; error descrito; no depender de placeholder | Alta | F0 | Command, response, regla backend |
| `Textarea` | Primitiva | Emisor | Valor de form model | Cambio semántico | Captura texto multilinea | Default, focus, error, disabled | Ancho completo en mobile | Label, contador futuro accesible si existe límite | Media | F0 | HTML, Markdown, metadata arbitraria |
| `Select` | Primitiva | Forms | Opciones frontend normalizadas | Selección semántica | Elegir valor permitido | Default, error, disabled | Fluido y táctil | Label; teclado; estado seleccionado | Alta | F0 | Enum backend sin adaptar |
| `Checkbox` | Primitiva | Perfil/forms | Boolean local normalizado | Toggle semántico | Selección independiente | Checked, unchecked, disabled, error | Target táctil | Label clickeable; estado anunciado | Alta | F0 | Ownership o elegibilidad derivada localmente |
| `FileInput` | Primitiva | Emisor | `PdfAnalysisFormModel` en su parte de archivo | `onSelectPdf` | Selección y reemplazo de PDF | Empty, selected, error, disabled | Operable sin drag and drop | Label, nombre, tamaño, errores asociados | Media | F0 | File path, upload HTTP, artifact |
| `FormField` | Primitiva | Forms | Estado normalizado de campo | Ninguna directa | Componer label, control, ayuda y error | Default, required, error, disabled | Se apila en mobile | Asociación mediante IDs | Alta | F0 | DTO, command o status HTTP |
| `FieldLabel` | Primitiva | Forms | Label seguro y estado required | Ninguna | Nombrar un control de forma persistente | Default, required, disabled | No se oculta en mobile | Asociación programática con el control | Alta | F0 | Placeholder o label backend |
| `FieldMessage` | Primitiva | Forms | Mensaje seguro | Ninguna | Mostrar ayuda o error | Help, error | Fluido | Vinculado al control; error anunciado cuando cambia | Alta | F0 | Detail backend crudo |
| `Card` | Primitiva | Todas | Contenido ya compuesto | Ninguna por defecto | Superficie y jerarquía | Base, interactive, status, technical | Padding y densidad adaptables | Semántica depende del contenido; foco si es interactiva | Alta | F0 | Dominio, fetching, click global implícito |
| `Divider` | Primitiva | Todas | Ningún dato de dominio | Ninguna | Separar secciones con jerarquía real | Horizontal; vertical solo si se justifica | Se adapta a la dirección del contenido | Decorativo o separador semántico según contexto | Alta | F0 | Estado, label o navegación |
| `Alert` | Primitiva | Todas | Feedback seguro | Acción opcional de recuperación | Mensaje persistente contextual | Info, success, warning, error | Ancho fluido | Rol y live region según urgencia | Alta | F0 | Stack trace o status como copy |
| `Toast` | Primitiva | Todas | Confirmación segura no crítica | Acción breve opcional | Feedback global efímero | Info, success, warning, error | No tapa acciones ni navegación | Región anunciable y cierre accesible | Media | F0 | Ser único canal de error crítico |
| `Tooltip` | Primitiva | Todas | Ayuda breve segura | Ninguna | Aclaración complementaria | Open, closed | No contiene información indispensable | Disponible por foco y hover; asociado al control | Media | F0 | Ocultar consecuencias o labels requeridos |
| `Dialog` | Primitiva | Emisor y acciones críticas | Título, consecuencia y action state seguros | `onConfirm`, `onCancel` | Confirmación modal | Default, submitting, error | Full-width acotado en mobile | Nombre, foco inicial, trap, Escape y restauración | Alta | F0 | Ejecutar emisión o autorización |
| `Skeleton` | Primitiva | Lecturas | Estructura conocida, sin datos | Ninguna | Reservar espacio durante carga | Variantes estructurales acotadas | Replica estructura responsive | Oculto a lectura cuando no aporta | Alta | F0 | Porcentajes o datos fake |
| `Spinner` | Primitiva | Acciones | Estado submitting | Ninguna | Indicar trabajo indeterminado | Inline o bloque | Tamaño controlado | Label accesible cuando es único indicador | Alta | F0 | Progreso inventado |
| `EmptyState` | Primitiva | Todas | Copy seguro e intención permitida | Acción opcional real | Explicar ausencia conocida | Sin datos, sin filtros futuros | Centrado o inline sin perder acción | Heading y acción clara | Alta | F0 | Capacidad futura o CTA falso |
| `ErrorState` | Primitiva | Todas | `FeedbackErrorVM` | `onRetry` o recuperación | Error de bloque o pantalla | Recuperable o terminal | Acción visible y apilable | Foco gestionado; mensaje persistente | Alta | F0 | Response, stack o detail crudo |
| `CopyButton` | Primitiva | Todas | `DisplayIdentifierVM` | `onCopyIdentifier` | Copiar valor permitido | Idle, copied, error | Target táctil | Nombre explícito y confirmación anunciable | Alta | F0 | Inventar o recuperar identificadores |
| `Disclosure` | Primitiva | Todas | Label y contenido seguro | `onToggleTechnicalDetails` | Mostrar detalle progresivo | Collapsed, expanded | Colapsa contenido secundario | `aria-expanded`, teclado y asociación | Alta | F0 | Objeto arbitrario |
| `DisplayDate` | Display | Todas | `DisplayDateVM` | Ninguna | Mostrar fecha `es-AR` preservando semántica | Present, unknown | Evita saltos y truncado ambiguo | Elemento `time` cuando aplica | Alta | F0 | ISO crudo como label principal |
| `DisplayIdentifier` | Display | Todas | `DisplayIdentifierVM` | `onCopyIdentifier` | Mostrar abreviado y permitir copia | Compact, technical | Truncado visual no destructivo | Valor completo accesible al copiar/expandir | Alta | F0 | ID como identidad humana |
| `TechnicalDetailItem` | Display | Todas | `TechnicalDetailVM` | Copia opcional | Mostrar un par label-valor técnico | Secondary, technical | Label y valor apilables | `dl` semántica; copia accesible | Alta | F0 | JSON u objetos de librerías |
| `TechnicalDetailsDisclosure` | Display | Todas | `TechnicalDetailVM[]` | Toggle y copy | Agrupar detalle técnico opcional | Collapsed, expanded, empty omitido | Colapsado temprano en mobile | Botón expandible y contenido asociado | Alta | F0 | Response completa, artifact |
| `StatusLabel` | Display | Todas | Estado frontend normalizado | Ninguna | Presentar label e ícono semánticos | Según dominio delegado | Una línea sin perder texto | No depende solo del color | Alta | F0 | Enum backend o token arbitrario |
| `ConfidenceDisplay` | Display | IA y perfil | Confidence VM normalizado | Ninguna | Explicar confianza del análisis | Score, qualitative, unavailable | Compacto sin gauge | Texto equivalente; no solo color | Alta | F0 | Nivel o capacidad del titular |
| `CountDisplay` | Display | IA y perfil | Conteo con semántica confirmada | Ninguna | Mostrar cantidad y unidad correctas | Known, unavailable | Label y valor se mantienen juntos | Unidad explícita y legible | Media | F0 | Inferir que artifacts son credenciales |
| `FeedbackAlert` | Feedback | Todas | `FeedbackErrorVM` o feedback seguro | `onRetry` o recuperación | Feedback persistente de operación | Info, success, warning, error | Inline o bloque | Live region controlada; no repetitiva | Alta | F0 | Error backend sin mapping |
| `InlineError` | Feedback | Forms | Error de campo o sección seguro | Ninguna | Explicar error cerca de su origen | Field, section | Se adapta al ancho del control | Asociado mediante descripción y anunciado al cambiar | Alta | F0 | Status HTTP o detail crudo |
| `ActionFeedback` | Feedback | Forms/acciones | `AsyncActionStateVM` | `onRetry` cuando aplica | Estado transitorio de una acción | Idle, validating, submitting, success, error | Mantiene acción visible | Loading y resultado anunciados | Alta | F0 | Estado de dominio persistido |
| `LoadingState` | Feedback | Lecturas | Read action state normalizado | Ninguna | Estado de carga de una región conocida | Skeleton o indeterminado | Conserva jerarquía responsive | Label solo cuando aporta; evita anuncios repetidos | Alta | F0 | Progreso o job inventado |
| `UnsupportedDataState` | Feedback | Perfil y datos versionados | Variante `unsupported` del VM | Recuperación segura si existe | Explicar dato existente no presentable | Inline o bloque | Prioriza explicación | No se presenta como empty | Media | F0 | `profileJson` o fallback inventado |
| `ProductHeader` | Shell | Todas | Contexto visual y sesión minimizada | Navegación o logout | Marca y acciones globales permitidas | Public, authenticated | Navegación se reorganiza sin perder acciones | Header landmark; foco y labels | Alta | F0 | Permisos efectivos o API |
| `SkipLink` | Shell | Todas | Destino interno de contenido | Saltar a contenido | Evitar navegación repetitiva | Visible al foco | Igual en todos los tamaños | Primer foco útil | Alta | F0 | Rutas de dominio |
| `AuthLayout` | Shell | Login | Marca y contenido de auth | Ninguna de negocio | Marco compartido del acceso | Default, error global | Columna legible mobile/desktop | Main landmark y orden de foco | Media | F0 | Autenticar o almacenar JWT |
| `LoginForm` | Auth | Institucional y titular | `LoginFormModel` | `onSubmitLogin` | Capturar credenciales y feedback | Idle, submitting, invalid, error | Una columna y CTA táctil | Autocomplete, labels, foco en error | Media | F1 | Token, response o redirect global |

## 13. Matriz componente-modelo: estados y dominio compartido

| Componente | Categoría | Experiencia | Modelo recibido | Intenciones emitidas | Responsabilidad | Variantes/estados | Responsive | Accesibilidad | Reutilización | Fase | No debe conocer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `CredentialStatusBadge` | Estado | Todas | `CredentialStatusVM` | Ninguna | Estado lifecycle de credencial | Draft, issued, revoked, unknown | Compacto; no truncar label | Label e ícono; no solo color | Alta | F0 | Analysis o verification status |
| `AnalysisStatusBadge` | Estado | Todas | `AnalysisStatusVM` | Ninguna | Estado persistido del análisis | Not analyzed, completed, partial, unknown | Compacto | Label e ícono; partial explicado | Alta | F0 | Request loading o certeza absoluta |
| `VerificationStatusBadge` | Estado | Verificador | `VerificationStatusVM` | Ninguna | Resultado consolidado | Valid, revoked, incomplete, draft, not found, unknown | Prioridad adaptable | Texto dominante e ícono | Media | F3 | Credential status aislado |
| `EvidenceStatusBadge` | Estado | Todas | `EvidenceStatusVM` | Ninguna | Resumen de evidencia multidimensional | Registrada, no disponible, local/demo, unknown según VM | Compacto | Label e explicación accesible | Alta | F0 | String arbitrario o blockchain en vivo |
| `CredentialIdentitySummary` | Dominio | Todas | Submodelo de identidad de credential VM | Abrir detalle cuando el contexto lo permite | Título, tipo e issuer seguro | Compact, standard, public | Reordena metadata | Heading correcto; no card-botón con acciones | Alta | F0 | PII o issuer inventado |
| `CredentialLifecycleTimeline` | Dominio | Emisor y titular | `CredentialLifecycleVM` | Ninguna | Hitos confirmados de lifecycle | Draft, issued, evidence, analyzed, revoked según datos | Vertical en mobile; más compacto en amplio | Lista ordenada y estado textual | Alta | F1 | Pasos futuros o jobs inventados |
| `CredentialSubjectSummary` | Dominio | Emisor y titular | Submodelo allowlisted de credential detail VM | Ninguna | Mostrar campos permitidos del logro | Campos presentes, ausencia parcial | Definition list apilada | Labels explícitos; listas semánticas | Alta | F1 | JSON, claves desconocidas, PII no autorizada |
| `EvidenceSummary` | Dominio | Todas | `EvidenceStatusVM` | Expandir o copiar | Explicar evidencia disponible | Available, unavailable, local/demo, unknown | Resumen visible; técnico colapsable | Estado textual y relación clara | Alta | F1 | Validez completa o consulta on-chain |
| `SemanticAnalysisSummary` | Dominio | Todas | `SemanticAnalysisSummaryVM` | Ninguna | Resumen seguro de análisis | Not analyzed, completed, partial, unknown | Conteos y warnings se apilan | Heading, listas y estado textual | Alta | F1 | Artifact, embedding, analysisJson |
| `ConfidenceSummary` | Dominio | IA y perfil | Confidence VM normalizado | Expandir explicación si existe | Contextualizar confidence y limitaciones | Numeric, qualitative, unavailable | Resumen compacto y detalle apilado | No usar gauge; texto equivalente | Alta | F1 | Competencia personal o thresholds inventados |
| `WarningsList` | Dominio | Todas | Strings seguros normalizados | Ninguna | Mostrar advertencias sin ocultarlas | Empty omitido, list | Lista fluida | Lista semántica; texto plano | Alta | F1 | HTML, Markdown o detail upstream |
| `QualityFlagsList` | Dominio | IA y perfil | Strings seguros normalizados | Ninguna | Mostrar quality flags con copy de producto | Empty omitido, list | Lista fluida | Labels comprensibles | Media | F1 | Códigos internos sin mapping |
| `TechnicalEvidenceDetails` | Dominio | Todas | `TechnicalDetailVM[]` y `EvidenceStatusVM` | Copy y toggle | Detalle técnico de evidencia | Collapsed, expanded, unavailable | Colapsado por defecto en mobile | Disclosure y definition list | Alta | F1 | Objetos ethers, RPC o private key |
| `IssuerSummary` | Dominio | Todas | Issuer summary seguro del VM contextual | Ninguna | Identidad institucional | Available, unavailable, unsupported | Compacto o standard | No usar ID como nombre | Alta | F1 | Membership o autoridad inferida |
| `HolderSummary` | Dominio | Emisor autorizado y titular | Holder submodelo permitido | Ninguna | Identidad del titular según política | Available, hidden, unsupported | Datos se apilan | Labels humanos; PII minimizada | Media | F1 | PII pública o consentimiento inferido |
| `FormativeProfileSummary` | Dominio | Titular | `SafeFormativeProfileVM` | Ninguna | Resumen honesto del perfil | Available | Se prioriza en mobile | Heading y conteos explicados | Media | F2 | ProfileJson, ranking o nivel |
| `FormativeProfileAreaList` | Dominio | Titular | `FormativeProfileAreaVM[]` | Ninguna | Áreas con evidencia disponible | Empty, list | Lista/cards adaptables | Lista y horas con labels | Media | F2 | Inferir áreas nuevas |
| `FormativeProfileSkillList` | Dominio | Titular | `FormativeProfileSkillVM[]` | Ninguna | Skills observadas | Empty, list | Wrap sin perder lectura | Lista, no estrellas o ranking | Media | F2 | Nivel del titular |
| `FormativeProfileConceptList` | Dominio | Titular | `FormativeProfileConceptVM[]` | Ninguna | Conceptos observados | Empty, list | Lista compacta | Estructura semántica | Media | F2 | Inferencia o scoring nuevo |

## 14. Matriz componente-modelo: Portal del Emisor

| Componente | Categoría | Experiencia | Modelo recibido | Intenciones emitidas | Responsabilidad | Variantes/estados | Responsive | Accesibilidad | Reutilización | Fase | No debe conocer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `IssuerShell` | Shell | Emisor | `UserContextVM` e identidad segura | Navegación y logout | Marco institucional contextual | Context available, known non-operational, unavailable | Navegación adaptable; funciones completas | Landmarks, skip link, foco lógico | Baja | F1 | Fetching, membership efectiva |
| `IssuerNavigation` | Shell | Emisor | Destinos habilitados por la arquitectura vigente | Navegar | Mostrar solo áreas reales | Inicio; futuras rutas solo cuando existan | Compacta o mobile navigation confirmada | Estado activo y teclado | Baja | F1 | Rutas C/D o permisos efectivos |
| `AuthenticatedUserMenu` | Shell | Emisor y titular | `CurrentUserVM` minimizado | `onLogout` | Identidad de sesión y cierre | Open, closed | Menú o patrón móvil equivalente | Control expandible y foco | Alta | F1 | JWT, AuthCredential, password |
| `IssuerHomeIntro` | Feature | Emisor | `IssuerHomeVM` | Ir a crear draft | Explicar flujo y acción real | Context available, known non-operational, unavailable | Texto y CTA se apilan | Heading y acción clara | Baja | F1 | Métricas, lista reciente, issuer inventado |
| `CreateCredentialDraftForm` | Feature | Emisor | `CreateCredentialDraftFormModel` | `onCreateDraft` | Capturar datos humanos permitidos | Idle, validating, submitting, error | Varias columnas solo en ancho suficiente | Labels, errores asociados, foco en primer error | Baja | F1 | `issuerId` editable, JSON, rawData |
| `CredentialDraftSummary` | Feature | Emisor | `IssuerCredentialDetailVM` parcial | Abrir detalle o continuar | Confirmar draft creado | Draft, incomplete read | Apilado en mobile | Heading y estado explícito | Baja | F1 | Verificación válida o issuer inventado |
| `IssueCredentialSection` | Feature | Emisor | `IssuerCredentialDetailVM`, `IssueCredentialActionVM` | `onIssueCredential` | Explicar y confirmar emisión | Available, submitting, success, conflict, forbidden | CTA y consecuencias apiladas | Confirmación en dialog; resultado persistente | Baja | F1 | Hashing, signer, endpoint directo |
| `IssuerCredentialLifecycleSection` | Feature | Emisor | `CredentialLifecycleVM` | Ninguna | Enmarcar timeline operativo | Estados confirmados | Una columna en mobile | Heading y lista ordenada | Baja | F1 | Pasos no confirmados |
| `PdfAnalysisUploadSection` | Feature | Emisor | `PdfAnalysisFormModel` | `onSelectPdf`, `onAnalyzePdf`, `onRetry` | Selección y envío conceptual del PDF | Empty, selected, validating, submitting, error | Dropzone opcional más input siempre operable | Input nativo, errores, nombre y tamaño | Baja | F1 | FastAPI, file path, progreso fake |
| `PdfAnalysisResultSection` | Feature | Emisor | `PdfAnalysisResultVM` | Reintento explícito si corresponde | Resultado seguro del análisis | Completed, partial, error | Conteos/listas apilados | Estado anunciado; warnings persistentes | Baja | F1 | Artifact, analysisJson, textForEmbedding |
| `IssuerCredentialEvidenceSection` | Feature | Emisor | `EvidenceStatusVM` y detalles permitidos | Copy/toggle | Evidencia posterior a emisión | Available, unavailable, local/demo | Técnico colapsable | Disclosure y copia accesibles | Baja | F1 | Cliente blockchain o validez total |
| `IssuerCredentialActions` | Feature | Emisor | Allowed actions del VM y action states | Emitir, analizar, reintentar | Agrupar acciones reales de la credencial | Según lifecycle y permiso ya resuelto | Se apila o pasa a región móvil; no desaparece | Orden, labels y disabled explicado | Baja | F1 | Autorizar o inventar acciones |

## 15. Matriz componente-modelo: Wallet y Perfil

| Componente | Categoría | Experiencia | Modelo recibido | Intenciones emitidas | Responsabilidad | Variantes/estados | Responsive | Accesibilidad | Reutilización | Fase | No debe conocer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `WalletShell` | Shell | Titular | `CurrentUserVM` | Navegación y logout | Marco personal mobile-first | Authenticated | Navegación corta y táctil | Landmarks, skip link, foco | Baja | F2 | Issuer operations |
| `WalletNavigation` | Shell | Titular | Destinos wallet aprobados | Navegar | Mis credenciales y perfil | Active route | Mobile-first sin ocultar destinos | Estado activo y teclado | Baja | F2 | Sharing o rutas futuras |
| `HolderCredentialList` | Feature | Titular | `HolderCredentialListItemVM[]` | Abrir credencial | Listar credenciales propias | Loading, empty, list, error | Cards mobile; densidad mayor en desktop | Lista semántica y headings | Baja | F2 | Drafts, credenciales ajenas, fetching |
| `HolderCredentialListItem` | Feature | Titular | `HolderCredentialListItemVM` | `onOpenCredential`, selección futura separada | Resumen táctil de una credencial | Issued, revoked; evidence/analysis variants | Card mobile-first | No card-botón si agrega controles; foco visible | Baja | F2 | Raw DTO o issuer authority |
| `HolderCredentialSummary` | Feature | Titular | `HolderCredentialDetailVM` | Ninguna | Identidad y lifecycle propio | Issued, revoked | Jerarquía personal apilada | Heading, labels y fechas semánticas | Baja | F2 | Datos de otros holders |
| `ProfileCredentialSelector` | Feature | Titular | `ProfileCredentialEligibilityVM[]`, `BuildProfileFormModel` | `onSelectCredentialForProfile` | Elegir fuentes elegibles | Empty, selectable, no eligible, error | Lista táctil | Fieldset/legend; selección por teclado | Baja | F2 | UserId, ownership local, artifacts |
| `ProfileCredentialEligibilityItem` | Feature | Titular | Item de elegibilidad y resumen seguro | Toggle si eligible | Explicar selección o motivo | Eligible, revoked, missing analysis, unsupported | Fila/card apilada | Disabled con motivo visible | Baja | F2 | Pending inventado |
| `CurrentProfileState` | Feature | Titular | `CurrentProfileVM` | Acción de build cuando corresponda | Resolver empty, available o unsupported | Exactamente tres variantes | Contenido principal mobile-first | Unsupported no se anuncia como empty | Baja | F2 | ProfileJson o versión inventada |
| `BuildProfileSection` | Feature | Titular | `BuildProfileFormModel`, action state | `onBuildProfile`, `onRetry` | Confirmar selección y construir perfil | Idle, submitting, success, error | CTA visible sin overlay permanente | Resultado y errores anunciados | Baja | F2 | UserId, FastAPI, profile rebuild |
| `ProfileSourcesSummary` | Feature | Titular | Source count discriminado del profile VM | Ninguna | Explicar fuentes realmente representadas | Credential count, artifact count, unavailable | Resumen apilable | No confundir labels ni conteos | Baja | F2 | Completion inferida |
| `ProfileLimitationsList` | Feature | Titular | Limitations y warnings seguros | Ninguna | Mantener límites visibles | Empty omitido, list | Lista legible | Heading y lista semántica | Baja | F2 | Claims absolutos |

## 16. Matriz componente-modelo: Verificador Público

| Componente | Categoría | Experiencia | Modelo recibido | Intenciones emitidas | Responsabilidad | Variantes/estados | Responsive | Accesibilidad | Reutilización | Fase | No debe conocer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `PublicVerificationLayout` | Shell | Verificador | Marca y contenido público | Volver a verificar | Marco público focal | Search, result | Columna focal mobile-first | Main landmark y skip link | Baja | F3 | Sesión o navegación privada |
| `VerifyCredentialSearchForm` | Feature | Verificador | Form model de identificador validado localmente | `onVerifyCredential` | Capturar credential ID para navegación | Idle, validating, error | Input y CTA apilables | Label, ayuda y error asociado | Baja | F3 | Endpoint directo o sharing |
| `VerificationStatusHero` | Feature | Verificador | `VerificationStatusVM` | Ninguna | Responder temprano el resultado | Valid, revoked, incomplete, draft, not found, unknown | Visible temprano en mobile | Heading, ícono y explicación | Baja | F3 | Un único status backend aislado |
| `VerificationCredentialSummary` | Feature | Verificador | `VerificationCredentialVM` público | Ninguna | Identidad pública minimizada | Data available/partial | Una columna focal | Headings y datos etiquetados | Baja | F3 | PII, issuer inventado, credentialSubject no contratado |
| `PublicEvidenceSummary` | Feature | Verificador | `VerificationEvidenceVM` | Copy/toggle | Explicar evidencia persistida | Records, empty, unknown | Resumen primero, técnico después | Estados textuales y disclosure | Baja | F3 | Consulta on-chain en vivo |
| `VerificationAnalysisSummary` | Feature | Verificador | `VerificationAnalysisSummaryVM` | Ninguna | Mostrar análisis permitido | None, completed, partial, unknown | Conteos compactos | Confidence explicada y warnings visibles | Baja | F3 | Artifact o perfil |
| `VerificationTechnicalDetails` | Feature | Verificador | `VerificationTechnicalDetailVM[]` | Copy/toggle | Datos técnicos públicos permitidos | Collapsed, expanded | Colapsado por defecto | Disclosure, `dl`, copy feedback | Baja | F3 | PII o endpoints adicionales |
| `VerificationNotFoundState` | Feature | Verificador | Variante `not_found` | Volver a verificar | Explicar ausencia sin jerga | Not found | Resultado focal | Heading y recuperación clara | Baja | F3 | Códigos HTTP o existencia de otros recursos |

## 17. Componentes mínimos del primer vertical slice

El primer vertical slice frontend es:

```text
Login
-> Entrada del Emisor
-> Crear draft
-> Detalle recién creado
-> Emitir credencial
-> Subir PDF
-> Mostrar análisis
```

### F0: fundamentos necesarios

Implementar únicamente lo consumido por F1:

- `AuthLayout`;
- `ProductHeader`;
- `SkipLink`;
- `Button`;
- `IconButton`;
- `TextInput`;
- `Textarea`;
- `Select`;
- `FormField`;
- `FieldLabel`;
- `FieldMessage`;
- `Card`;
- `Alert`;
- `Dialog`;
- `FileInput`;
- `Skeleton`;
- `Spinner`;
- `ErrorState`;
- `EmptyState`;
- `CopyButton`;
- `Disclosure`;
- `DisplayDate`;
- `DisplayIdentifier`;
- `TechnicalDetailItem`;
- `TechnicalDetailsDisclosure`;
- `FeedbackAlert`;
- `ActionFeedback`;
- `CredentialStatusBadge`;
- `AnalysisStatusBadge`;
- `EvidenceStatusBadge`;
- `CredentialIdentitySummary`;
- `CredentialLifecycleTimeline`;
- `EvidenceSummary`;
- `SemanticAnalysisSummary`;
- `WarningsList`.

`Checkbox`, `ConfidenceDisplay`, `QualityFlagsList`, `IssuerSummary` y
`HolderSummary` se implementan en F0/F1 solo si el flujo y los VMs del primer
slice realmente los consumen.

### F1: Portal del Emisor mínimo

- `LoginForm`;
- `IssuerShell`;
- `IssuerNavigation`;
- `AuthenticatedUserMenu`;
- `IssuerHomeIntro`;
- `CreateCredentialDraftForm`;
- `CredentialDraftSummary`;
- `IssueCredentialSection`;
- `IssuerCredentialLifecycleSection`;
- `PdfAnalysisUploadSection`;
- `PdfAnalysisResultSection`;
- `IssuerCredentialEvidenceSection`;
- `IssuerCredentialActions`.

Restricciones:

- no construir listado institucional;
- no construir tabla issuer-facing;
- no hardcodear titulares como UX productiva;
- no inventar issuer summary;
- no crear dashboard analítico;
- no persistir responses o artifacts en el browser;
- no tratar la protección de rutas frontend como autorización.

## 18. Componentes F2 y F3

### F2: Wallet y Perfil

- `WalletShell`;
- `WalletNavigation`;
- `HolderCredentialList`;
- `HolderCredentialListItem`;
- `HolderCredentialSummary`;
- `ProfileCredentialSelector`;
- `ProfileCredentialEligibilityItem`;
- `CurrentProfileState`;
- `BuildProfileSection`;
- `FormativeProfileSummary`;
- `FormativeProfileAreaList`;
- `FormativeProfileSkillList`;
- `FormativeProfileConceptList`;
- `ProfileSourcesSummary`;
- `ProfileLimitationsList`;
- componentes compartidos de estado, evidencia, análisis y detalle técnico.

### F3: Verificador Público

- `PublicVerificationLayout`;
- `VerifyCredentialSearchForm`;
- `VerificationStatusHero`;
- `VerificationCredentialSummary`;
- `PublicEvidenceSummary`;
- `VerificationAnalysisSummary`;
- `VerificationTechnicalDetails`;
- `VerificationNotFoundState`;
- display primitives compartidos.

## 19. Componentes bloqueados o futuros

No se implementan placeholders ni opciones `Próximamente`.

| Componente | Fase | Dependencia faltante | Motivo | Qué no debe simularse |
|---|---|---|---|---|
| `IssuerCredentialList` | B | Listado protegido por issuer | No existe colección institucional autorizada | Credenciales seed o array hardcodeado |
| `IssuerCredentialFilters` | B | Listado, paginación y filtros backend | No hay dataset issuer-facing | Filtros locales sobre datos fake |
| `IssuerAnalyticsDashboard` | D | Endpoints agregados y métricas definidas | No existe contrato analítico | KPIs, gráficos o actividad reciente |
| `IssuerUsersManagement` | D | Gestión de memberships y permisos | No hay endpoints administrativos | Altas, bajas o roles ficticios |
| `IssuerSettings` | D | Configuración institucional | No hay contrato de lectura/escritura | Nombre, DID o signer editable fake |
| `MultiIssuerSwitcher` | B | Selección explícita y persistencia de contexto | `/auth/me` ya ofrece summaries, pero no define selección | Selector con UUID o elección silenciosa |
| `SharingPanel` | D | Grants, expiración y revocación | Acceso por ID no es sharing seguro | Links compartidos con falsa privacidad |
| `QrSharePanel` | D | Sharing grant y QR real | No existe token controlado | QR que codifica solo un ID |
| `RevocationPanel` | B | Endpoint protegido de revocación | Lifecycle incompleto | Botón sin efecto o estado local |
| `AsyncJobProgress` | B | Job ID, status y progreso backend | IA actual es síncrona | Porcentajes o segundo plano falsos |
| `VerificationHistory` | D | Endpoint de eventos de verificación | No hay historial visible | Eventos inventados |
| `CredentialTemplateBuilder` | D | Modelo y CRUD de templates | Fuera del MVP | Editor genérico de JSON |
| `PublicHolderIdentity` | B | Política PII y DTO público explícito | Verify no autoriza datos del titular | Email, DID, nombre o grade |
| `OnChainLiveVerificationIndicator` | B | Consulta on-chain integrada al verify read model | Verify usa evidencia persistida | Estado live inferido del record |

`Table`, filtros, paginación y acciones masivas se reconsideran cuando
`IssuerCredentialList` deje de estar bloqueado.

## 20. Tabla de reutilización

| Componente | Emisor | Titular | Verificador | Reutilización | Diferencia contextual |
|---|---:|---:|---:|---|---|
| `CredentialStatusBadge` | Sí | Sí | Sí | Alta | En verify queda subordinado al resultado consolidado |
| `AnalysisStatusBadge` | Sí | Sí | Sí | Alta | El resumen público recibe menos datos |
| `EvidenceStatusBadge` | Sí | Sí | Sí | Alta | El verificador prioriza evidencia permitida; no cambia el VM base |
| `CredentialIdentitySummary` | Sí | Sí | Sí | Alta | Densidad operativa, personal o pública |
| `CredentialLifecycleTimeline` | Sí | Sí | No inicialmente | Media | El verificador usa resultado focal, no timeline operativo |
| `CredentialSubjectSummary` | Sí | Sí | No actualmente | Media | Verify no tiene contrato público para esos campos |
| `EvidenceSummary` | Sí | Sí | Sí | Alta | Copy y jerarquía cambian; semántica no |
| `SemanticAnalysisSummary` | Sí | Sí | Sí | Alta | Cada actor recibe una allowlist distinta |
| `WarningsList` | Sí | Sí | Sí | Alta | Solo strings seguros autorizados para el actor |
| `TechnicalDetailsDisclosure` | Sí | Sí | Sí | Alta | Cada contexto entrega su propia lista minimizada |
| `ConfidenceDisplay` | Sí | Sí | Sí | Alta | Siempre describe análisis, nunca capacidad |

Reutilizar no habilita a compartir datos, permisos ni jerarquía. La
compatibilidad exige el mismo contrato semántico, aunque la variante visual
cambie.

## 21. Contratos mínimos de accesibilidad

### Inputs y formularios

- labels asociados;
- errores vinculados al control;
- navegación por teclado;
- estado required accesible;
- placeholder nunca usado como label;
- foco conservado o dirigido al primer error relevante;
- autocomplete apropiado en login.

### Dialog

- nombre accesible;
- foco inicial coherente;
- focus trap;
- restauración del foco;
- cierre por teclado cuando corresponda;
- consecuencia y acción claramente diferenciadas.

### Estados y alerts

- label además de color;
- icono acompañado por texto;
- `aria-live` solo para resultados transitorios;
- contenido estático no anunciado repetidamente;
- feedback crítico persistente además del toast.

### File input

- operable sin drag and drop;
- nombre y tamaño legibles;
- errores asociados;
- reemplazo accesible;
- formatos y límite visibles.

### Disclosure técnico

- botón con estado expandido;
- control por teclado;
- asociación entre control y contenido;
- foco visible;
- contenido en estructura semántica.

### Copy button

- nombre accesible;
- confirmación no dependiente solo del color;
- feedback breve anunciable;
- conserva el valor original autorizado.

### Navegación

- landmarks;
- skip link;
- estado activo;
- orden de foco lógico;
- menú móvil equivalente, no recortado.

### Listas y cards interactivas

- estructura de lista cuando corresponda;
- heading comprensible;
- no convertir toda la card en botón si contiene controles;
- target mínimo de 44 x 44 px;
- estado disabled acompañado por motivo.

## 22. Responsabilidad responsive

Reglas compartidas:

- los shells adaptan navegación sin perder funciones;
- grupos de acciones pueden apilarse o pasar a un drawer confirmado;
- formularios pasan de múltiples columnas a una;
- detalle técnico se colapsa progresivamente;
- listas pueden adaptarse a cards;
- targets táctiles mantienen al menos 44 x 44 px;
- scroll horizontal no es la única solución;
- acciones importantes se reorganizan, no se eliminan;
- no se crean breakpoints fuera de los admitidos por el design system.

Portal del Emisor:

- mantiene funcionalidad completa en pantallas pequeñas;
- aprovecha mayor densidad en resoluciones medianas y amplias;
- conserva acciones de emisión y análisis visibles y ordenadas;
- no establece tablet como mínimo funcional.

Wallet:

- prioriza cards y navegación mobile-first;
- muestra título, issuer y estado antes que datos técnicos;
- mantiene la selección de perfil operable táctilmente.

Verificador:

- mantiene el resultado principal visible temprano;
- usa una columna focal;
- deja evidencia y detalle técnico en jerarquía secundaria.

## 23. Privacidad y seguridad por componente

- los componentes públicos reciben VMs minimizados;
- el verificador no recibe PII no contratada;
- el titular recibe sus datos desde `/me/*`;
- el emisor recibe solo datos necesarios para una operación autorizada;
- `CredentialSubjectSummary` usa exclusivamente la allowlist aprobada;
- `grade` y datos del titular respetan la matriz de visibilidad;
- `TechnicalDetailsDisclosure` recibe `TechnicalDetailVM[]`;
- `WarningsList` recibe strings sanitizados y normalizados;
- `ConfidenceDisplay` explica confianza del análisis;
- ningún componente encadena endpoints para buscar datos faltantes;
- ningún componente interpreta acceso por ID como consentimiento;
- issuer ausente permanece `unsupported`;
- un campo persistido no se considera público por defecto.

Allowlist v0 de `credentialSubject`:

```text
achievement_name
institution_name
program_name
academic_period
completion_date
grade
skills
competencies
```

Todo campo desconocido se descarta antes de llegar al componente.

## 24. Anti-patterns prohibidos

```text
AnyJsonViewer
ArtifactViewer
RawDtoTable
UniversalStatusBadge
CredentialEverythingCard
SmartCredentialPage
DashboardStats sin endpoint
BlockchainHero
AiMagicPanel
ProfileScoreGauge
SkillLevelStars
FakeProgressBar
IssuerIdLabel
ContextSwitcherPlaceholder
FastApiClient frontend
PrismaType frontend
componente con data: any
componente con response completa
componente con colores arbitrarios para estados
componente View que define una pantalla completa
componente diferente por ruta sin responsabilidad diferenciada
tabla responsive basada solo en scroll horizontal
toast como único error crítico
```

También están prohibidos:

- render genérico de JSON;
- props opcionales que admiten estados imposibles;
- status universal compartido entre dominios;
- card completa clickeable con acciones internas;
- componente que autoriza por visibilidad;
- componente que suma horas o deriva confidence;
- componente que ejecuta FastAPI o blockchain;
- placeholder de una capacidad C o D.

## 25. Riesgos y mitigaciones

| Riesgo | Consecuencia | Mitigación |
|---|---|---|
| Inventario genérico demasiado grande | Biblioteca sin consumidores | Implementar solo F0 consumido por la fase activa |
| Abstracciones prematuras | Props artificiales y acoplamiento | Extraer después de confirmar responsabilidad |
| Componentes gigantes | Estados y privacidad mezclados | Separar identidad, lifecycle, evidencia y análisis |
| Componentes ultra específicos | Duplicación por ruta | Reutilizar dominio cuando VM y semántica coincidan |
| Duplicación entre experiencias | Divergencia visual y semántica | Variantes contextuales controladas |
| Componentes que hacen fetching | Mezcla de presentación y transporte | Fetching exclusivo de orquestación |
| Componentes que interpretan DTOs | Contract drift y fuga de datos | Adapter obligatorio antes de render |
| Estados mezclados | Claims incorrectos | Badges separados por dominio |
| Props opcionales excesivas | Estados imposibles | VMs discriminados |
| VMs públicos con PII | Incidente de privacidad | Minimización por actor y omisión por defecto |
| Panel técnico con objeto arbitrario | Exposición de datos internos | Solo `TechnicalDetailVM[]` |
| Falta de accesibilidad | Flujo inoperable | Contratos accesibles en primitivas y tests futuros |
| Mobile como versión recortada | Acciones institucionales ausentes | Reorganizar, no eliminar |
| Placeholders futuros | Producto engañoso | No implementar B/D hasta resolver dependencia |
| Shell global | Contextos y permisos mezclados | Shells separados por experiencia |
| Inventario convertido en screen spec | Composición cerrada prematuramente | Dejar layout y orden a las specs |
| `CredentialCard` universal prematuro | Jerarquías incompatibles | Evaluarlo después de F2 con VMs reales |
| Confianza mostrada como score personal | Claim dañino | `ConfidenceDisplay` contextual y textual |
| Error crítico solo en toast | Pérdida de feedback | Alert o ErrorState persistente |
| Issuer ID como identidad | UX técnica y engañosa | Issuer summary o ausencia transparente |

## 26. Decisiones pendientes

No cerrar todavía:

- nombres exactos de archivos;
- estructura final de carpetas;
- librería de componentes base;
- Radix, Headless UI u otra alternativa;
- React Query o SWR;
- state management;
- validación runtime;
- almacenamiento de sesión;
- firmas TypeScript finales;
- API exacta de props;
- composición de páginas;
- layouts;
- breadcrumbs definitivos;
- estrategia concreta de mobile navigation;
- microcopy definitivo;
- animaciones específicas;
- test framework frontend;
- estrategia final de `CredentialCard`;
- uso concreto de `Drawer`, `RadioGroup`, `Tabs` o `Table`.

## 27. Relación con screen specifications

Las futuras screen specifications podrán definir:

- composición de componentes;
- layout;
- jerarquía y orden;
- copy final;
- estados concretos;
- responsive por pantalla;
- acciones y navegación;
- sticky regions;
- prioridades de contenido.

No podrán:

- introducir DTOs en componentes;
- inventar endpoints;
- crear estados de dominio nuevos;
- exponer artifacts;
- romper privacidad;
- cambiar marca;
- implementar componentes bloqueados;
- convertir una screen specification en autorización backend;
- reemplazar un estado `unsupported` por contenido inventado.

No se usarán componentes llamados `IssuerCredentialDetailView` o equivalentes
como sustitutos de una especificación de pantalla.

## 28. Criterios de aceptación

El inventario queda aprobado si:

- usa los tres documentos normativos;
- no reabre marca, rutas ni contratos de datos;
- separa orquestación y presentación;
- define una taxonomía clara;
- diferencia primitivas, display primitives, feedback, dominio, features y
  shells;
- justifica la existencia de cada componente;
- incluye matrices componente-modelo;
- no asigna DTOs como modelos recibidos;
- documenta intenciones semánticas;
- incluye accesibilidad mínima;
- define responsabilidad responsive;
- clasifica F0, F1, F2, F3, B y D;
- identifica el primer vertical slice;
- identifica componentes bloqueados y futuros;
- evita pantallas disfrazadas de componentes;
- evita componentes genéricos gigantes;
- no crea placeholders;
- documenta privacidad;
- documenta anti-patterns;
- mantiene `CurrentProfileState` con `empty`, `available` y `unsupported`;
- mantiene separados los estados de credencial, análisis, evidencia y
  verificación;
- no diseña pantallas;
- no implementa código;
- no modifica backend.

## 29. Próximo paso

El próximo documento recomendado es:

```text
docs/frontend/frontend-issuer-portal-screen-spec-v0.md
```

Debe especificar las pantallas reales del vertical institucional:

- login compartido;
- entrada del emisor;
- creación de draft;
- detalle de credencial;
- emisión;
- análisis de PDF;
- resultado;
- estados;
- responsive;
- composición.

Después:

```text
docs/frontend/frontend-holder-wallet-profile-screen-spec-v0.md
docs/frontend/frontend-public-verifier-screen-spec-v0.md
```

Estas especificaciones no se redactan en este documento.
