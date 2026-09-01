# UI/UX Handoff Context v0 (histórico)

> **Estado histórico.** Este contexto conserva un snapshot técnico anterior.
> Para la marca y el posicionamiento vigentes de Scope usar
> `scope-product-positioning-v1.md` y
> `frontend-brand-and-design-system-v1.md`. No actualizar sus rutas, endpoints
> o flujos por inferencia desde este archivo.

## Brief copiable

Actua como product designer senior y especialista UI/UX. Necesito disenar el
frontend de un PFI sobre credenciales educativas verificables e inteligencia
formativa. No inventes funcionalidades que el backend no tenga. Primero
propone arquitectura de informacion y user flows; despues pantallas,
componentes y estados.

## 1. Proyecto

El sistema permite:

- emision de credenciales educativas por instituciones o plataformas;
- hash canonico y evidencia blockchain;
- wallet interna para el holder;
- verificacion externa;
- analisis IA del contenido formativo;
- construccion de un perfil formativo agregado.

La IA interpreta contenido, pero no emite credenciales. Blockchain registra
evidencia del hash, pero no almacena el perfil formativo.

## 2. Repositorios y carpetas

```text
Repo principal:
PFI---Credenciales-Verificables-y-Perfil-Formativo

Backend NestJS:
services/api

Documentacion:
docs/architecture
docs/frontend
docs/demo

Contratos JSON compartidos:
packages/schemas

Modulo IA separado:
Extractor Materias

AI Service FastAPI:
Extractor Materias/src/api
```

El frontend debe consumir NestJS. Nunca debe llamar directamente a FastAPI.

## 3. Actores

### Emisor, admin u operator

- es una persona autenticada;
- opera para una institucion `Issuer`;
- crea y emite credenciales;
- carga PDFs o informacion de cursos;
- solicita analisis IA;
- consulta resultados institucionales.

### Holder o receptor

- recibe credenciales;
- consulta su wallet interna;
- construye su perfil desde credenciales emitidas;
- no usa MetaMask;
- no firma transacciones;
- no declara unilateralmente formacion como si fuera el emisor.

### Verificador externo

- consulta autenticidad y estado;
- revisa issuer, hash y evidencia;
- no necesita login en v0;
- puede llegar por ruta publica y, en el futuro, link o QR.

## 4. Endpoints relevantes

### Auth

```text
POST /auth/login
GET  /auth/me
```

### Credenciales

```text
POST /credentials/draft
POST /issuers/:issuerId/holders/resolve
POST /credentials/:id/issue
GET  /credentials/:id
GET  /credentials/:id/status
GET  /credentials/:id/semantic-analysis/latest
```

`issue` y `draft` requieren JWT y permiso institucional. En `draft`, el
`issuerId` del body se valida contra la membership activa del usuario.

La resolución del titular también requiere ese contexto institucional. Busca
por igualdad exacta de email, devuelve un resumen minimizado con DID nullable
y entrega el `id` solo para construir `subjectUserId` command-only. No lista
usuarios ni admite autocomplete.

### IA mediante backend

```text
POST /credentials/:id/semantic-analysis/from-pdf
POST /me/profile/build-from-ai
```

El primer endpoint requiere `admin` u `operator` del issuer. El segundo usa
el holder del JWT y credenciales propias `issued` con analisis persistido.

### Holder

```text
GET  /me/credentials
GET  /me/credentials/:id
GET  /me/profile/current
POST /me/profile/rebuild
POST /me/profile/build-from-ai
```

`rebuild` produce el fallback backend deterministico.
`build-from-ai` produce un perfil real `formative_profile_result_v0`.

### Verificacion

```text
GET /verify/credentials/:id
```

## 5. Pantallas a disenar

### Portal del emisor

1. Login.
2. Dashboard institucional.
3. Lista de credenciales.
4. Crear credential draft.
5. Detalle de credential.
6. Emision.
7. Upload PDF.
8. Analisis IA y resumen.
9. Estado de emision, blockchain y analisis.

Gap actual: no existe listado issuer-facing. No resolverlo con datos fake;
marcarlo como dependencia backend.

P0.3 de resolución del titular está implementado. F0/F1 puede usar el flujo
email exacto -> titular resuelto -> draft, sin mostrar UUID ni aceptar
`userId` editable.

### Wallet del holder

1. Login.
2. Wallet de credenciales.
3. Detalle de credential.
4. Seleccion para perfil.
5. Perfil formativo IA.
6. CTA "Construir perfil con IA".
7. Areas, skills y conceptos.
8. Warnings, quality flags y confidence.

### Verificador

1. Pagina publica por ID.
2. Estado de credencial.
3. Issuer.
4. Hash y version canonica.
5. Evidencia blockchain.
6. Analisis semantico permitido.
7. Preparacion visual futura para link/QR.

## 6. Direccion visual

Evitar una estetica cripto agresiva. La interfaz debe sentirse:

- academica;
- profesional;
- moderna;
- confiable;
- clara;
- accesible.

Direccion sugerida:

- dashboard limpio;
- tipografia con personalidad institucional;
- colores sobrios con acentos por estado;
- cards con jerarquia fuerte;
- badges para `draft`, `issued`, `revoked`, `partial`, `valid`;
- timeline de emision, analisis y verificacion;
- hashes copiables pero secundarios;
- explicaciones simples de IA y blockchain;
- desktop-first para portal emisor;
- responsive para wallet y verificador.

No usar el patron generico purple-on-white ni una estetica intercambiable de
dashboard SaaS.

## 7. Decisiones cerradas

- El holder no usa MetaMask.
- El holder no firma transacciones blockchain.
- El signer corresponde al issuer o backend local/dev.
- Blockchain funciona como evidencia del hash.
- La IA no emite credenciales.
- El backend valida y persiste artifacts IA.
- El frontend nunca llama directo a FastAPI.
- `semantic_analysis_v1` no participa en `canon_v1`.
- `formative_profile_result_v0` no participa en hash ni blockchain.
- Catalogos online no prueban completion.
- Para cursos sin PDF, el emisor carga texto y datos; no el holder.
- Credencial, analisis semantico, perfil y verificacion son conceptos
  distintos.

## 8. Estados que la UX debe contemplar

- loading;
- lista vacia;
- credencial draft;
- credencial issued;
- credencial revoked;
- verificacion valid;
- verificacion incomplete;
- analisis completed;
- analisis partial;
- sin SemanticAnalysis;
- perfil inexistente;
- build en curso;
- warnings;
- confidence unavailable;
- `401` sesion ausente;
- `403` permiso insuficiente;
- `404` recurso no visible;
- `400/422` datos o PDF invalidos;
- `502/503/504` AI Service con problemas.

No ocultar errores bajo mensajes genericos. Proponer copy humano y una accion
de recuperacion para cada estado.

## 9. Output esperado

Entrega:

1. mapa de pantallas;
2. user flow por actor;
3. prioridades del MVP;
4. arquitectura de navegacion;
5. wireframes textuales;
6. componentes principales;
7. estructura visual por pantalla;
8. copy sugerido;
9. empty, loading, success y error states;
10. modelo visual de cards;
11. reglas responsive;
12. sistema de badges y estados;
13. riesgos UX;
14. handoff concreto para que Codex implemente el frontend.

Separa claramente:

```text
implementable ahora
requiere endpoint backend pendiente
futuro
```
