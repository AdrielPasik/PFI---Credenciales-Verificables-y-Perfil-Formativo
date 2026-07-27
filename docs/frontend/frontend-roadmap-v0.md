# Frontend Roadmap v0

## 1. Objetivo

El producto no tiene un unico frontend conceptual. Tiene tres experiencias
con actores, permisos y prioridades diferentes:

```text
Portal del emisor
Wallet y perfil del holder
Verificador publico
```

La recomendacion es implementarlas de forma incremental, reutilizando un
sistema visual comun pero sin mezclar sus reglas de dominio.

## 2. Estado backend relevante

Ya existen:

- login JWT y consulta de usuario actual;
- draft y emision protegida;
- hash canonico y evidencia blockchain local;
- upload PDF protegido y analisis mediante AI Service;
- wallet read-only del holder;
- build y lectura de perfil formativo IA;
- verificacion publica.

Gaps que afectan al frontend:

- no existe listado issuer-facing de credenciales institucionales;
- `POST /credentials/draft` todavia es publico;
- no hay endpoint de analisis desde texto;
- no hay upload a storage;
- no hay jobs ni progreso asincronico;
- no hay sharing links o QR;
- no hay revocacion backend completa.

Estos gaps deben mostrarse en el roadmap y no resolverse con datos fake.

## 3. Experiencia A: Portal del emisor

### Actor

- universidad;
- plataforma de cursos;
- institucion emisora;
- usuario `admin` u `operator` con membresia activa.

La institucion es un `Issuer`; quien inicia sesion es un `User` autorizado
mediante `IssuerMembership`.

### Responsabilidades

- login;
- seleccionar o visualizar el issuer activo;
- crear una credencial draft;
- emitir la credencial para un holder;
- subir PDF de programa o plan de estudio;
- solicitar analisis IA;
- ver resumen semantico y advertencias;
- monitorear estado de credenciales emitidas;
- distinguir emision, blockchain y analisis semantico.

Para cursos sin PDF, estilo Udemy u otras plataformas, el texto descriptivo,
skills declaradas, horas y fuente deben ser cargados por el emisor,
`admin` u `operator`. El holder no declara unilateralmente formacion como si
fuera una credencial emitida.

### Pantallas MVP

1. Login.
2. Dashboard del issuer.
3. Lista de credenciales institucionales.
4. Crear credential draft.
5. Detalle de credencial.
6. Emitir credencial.
7. Upload PDF y accion "Analizar PDF con IA".
8. Estado y resumen del analisis.

### Dependencia backend pendiente

Antes de una implementacion completa hacen falta:

- endpoint issuer-facing para listar credenciales del issuer;
- proteccion de `POST /credentials/draft`;
- definicion de paginacion y filtros basicos.

Para una demo temprana, crear y abrir una credencial por ID es posible, pero
no debe ocultarse esta deuda con una lista hardcodeada.

## 4. Experiencia B: Wallet y perfil del holder

### Actor

Receptor o titular de credenciales.

El holder:

- inicia sesion con cuenta interna;
- tiene DID asociado;
- no usa MetaMask;
- no firma transacciones blockchain;
- no emite credenciales.

### Responsabilidades

- ver credenciales propias `issued` o `revoked`;
- abrir el detalle de una credencial;
- consultar issuer, hash y evidencia;
- seleccionar credenciales propias analizadas;
- construir perfil formativo IA;
- consultar el perfil current;
- revisar areas, skills, conceptos, warnings y confianza;
- compartir credenciales o perfil en una etapa futura.

### Pantallas MVP

1. Login.
2. Mi wallet.
3. Detalle de credencial.
4. Selector de credenciales para perfil.
5. Mi perfil formativo.
6. Accion "Construir perfil con IA".
7. Vista de areas, skills, conceptos, advertencias y confianza.

La wallet debe consumir datos reales de:

```text
GET /me/credentials
GET /me/credentials/:id
POST /me/profile/build-from-ai
GET /me/profile/current
```

No debe inventar credenciales ni perfiles localmente.

## 5. Experiencia C: Verificador

### Actor

- empresa;
- recruiter;
- tercero externo;
- institucion verificadora.

### Responsabilidades

- abrir link o QR;
- consultar una credencial;
- ver estado `valid`, `revoked`, `draft` o `incomplete`;
- identificar al issuer;
- revisar hash y version canonica;
- revisar evidencia blockchain persistida;
- ver resumen semantico permitido.

En v0 no necesita login:

```text
GET /verify/credentials/:id
```

### Pantalla MVP

Una pagina publica con:

- estado principal;
- titulo de credencial;
- issuer;
- fechas relevantes;
- hash y `canonicalizationVersion`;
- evidencia blockchain;
- ultimo analisis semantico resumido;
- explicaciones comprensibles de cada bloque.

Link/QR todavia no esta implementado. Para el primer frontend se puede abrir
la ruta con el ID, sin afirmar que sharing seguro ya existe.

## 6. Orden recomendado

### 1. Portal del emisor minimo

Es el primer frontend recomendado porque genera el insumo real:

```text
Credential draft
-> issue
-> canonicalHash
-> BlockchainRecord
-> PDF
-> SemanticAnalysis
```

Sin credenciales emitidas y analizadas, la wallet y el perfil del holder
quedan vacios.

### 2. Wallet y perfil del holder

Una vez que el portal genera datos reales, permite demostrar:

```text
credenciales propias
-> seleccion
-> build profile IA
-> FormativeProfile current
```

### 3. Verificador publico

Es simple y valioso para la defensa, pero conviene construirlo despues de
tener credenciales reales y evidencia consistente que mostrar.

## 7. Fases de implementacion

### Fase 0: sistema visual y base tecnica

- shell de aplicacion;
- routing;
- cliente HTTP backend;
- manejo de JWT;
- tokens de color, tipografia y espaciado;
- componentes de estado;
- responsive desktop-first.

### Fase 1: emisor demo

- login real;
- `/auth/me`;
- creacion de draft;
- emision protegida;
- detalle por ID;
- upload PDF;
- resumen IA;
- errores `400/401/403/404/502/503/504`.

### Fase 2: holder

- login;
- wallet real;
- detalle propio;
- seleccion de credenciales;
- build profile;
- perfil current;
- empty, loading y error states.

### Fase 3: verificador

- ruta publica;
- estado visual;
- issuer y evidencia;
- semantica resumida;
- preparacion futura para QR.

## 8. Reglas UX

- No presentar la app como producto cripto especulativo.
- No pedir MetaMask al holder.
- Explicar blockchain como evidencia de integridad.
- Explicar IA como asistencia interpretativa, no verdad absoluta.
- Mostrar `confidence`, warnings y quality flags.
- Diferenciar visualmente credencial, analisis, perfil y verificacion.
- No convertir `online_course_catalog` en evidencia de completion.
- No permitir que el holder cargue texto como si fuera el emisor.
- No ocultar estados `partial`, `incomplete`, `revoked` o errores de IA.
- No mostrar hashes largos como contenido principal; permitir copiarlos.

## 9. Componentes compartidos sugeridos

- `AppShell`;
- `ActorNavigation`;
- `CredentialCard`;
- `CredentialStatusBadge`;
- `IssuerBadge`;
- `BlockchainEvidenceCard`;
- `SemanticAnalysisSummary`;
- `ConfidenceIndicator`;
- `WarningList`;
- `ProfileAreaCard`;
- `SkillBadge`;
- `EmptyState`;
- `LoadingState`;
- `ErrorState`;
- `CopyableHash`;
- `Timeline`.

Los componentes deben recibir DTOs del backend o view models frontend, nunca
tipos internos de Prisma, FastAPI, ethers o artifacts Python.

## 10. Futuro

Agregar despues del MVP:

- `POST /credentials/:id/semantic-analysis/from-text` para emisor;
- Firebase Storage u object storage para PDFs;
- jobs asincronicos y progreso;
- reintentos e idempotencia;
- endpoint issuer-facing completo;
- revocacion protegida;
- share links;
- QR;
- permisos y auditoria productivos;
- mobile/PWA;
- Base Sepolia solo cuando el flujo local sea estable.

## 11. Recomendacion final

Empezar por un Portal del emisor minimo, pero primero cerrar los dos gaps
backend que bloquean una UI honesta:

```text
proteger create draft
agregar listado issuer-facing
```

Mientras esos endpoints se preparan, se puede implementar login, sistema
visual, detalle de credencial y upload PDF contra datos reales. La wallet del
holder debe ser el segundo vertical frontend.
