# Arquitectura v1

> Este documento evoluciona la arquitectura v0 hacia una arquitectura de dominio implementable. Sigue siendo una arquitectura logica, no un diseno final de despliegue.

## 1. Objetivo de la arquitectura v1

Definir una base de dominio suficientemente precisa para implementar de forma incremental el backend NestJS + Prisma, la integracion inicial con el AI service y la evidencia blockchain, sin introducir ambiguedades entre datos educativos, datos operativos, hashing, verificacion y perfil formativo.

## 2. Modulos principales

- App web Next.js con rutas `/issuer`, `/wallet` y `/verifier`.
- Backend API NestJS como unico orquestador de negocio.
- PostgreSQL como almacenamiento principal off-chain.
- AI service FastAPI desacoplado para analisis semantico.
- Smart contracts Solidity para evidencia minima verificable.
- Paquete de schemas JSON como contrato transversal entre modulos.

## 3. Responsabilidades por modulo

### App web

- presentar experiencias separadas por actor sin multiplicar aplicaciones;
- consumir exclusivamente la API del backend;
- priorizar uso mobile-first y PWA para wallet;
- no interactuar directamente con blockchain ni con el AI service.

### Backend API

- autenticar y autorizar solicitudes;
- normalizar credenciales;
- persistir datos off-chain;
- construir la representacion canonica para hashing;
- integrar blockchain y AI service;
- exponer contratos HTTP para emision, verificacion y perfil;
- registrar auditoria y eventos operativos.

### PostgreSQL

- almacenar credenciales completas;
- persistir usuarios, emisores, programas y cursos;
- almacenar analisis semanticos y perfiles formativos;
- conservar eventos de verificacion y auditoria;
- no replicar informacion que solo tenga sentido on-chain.

### AI service

- recibir payloads normalizados desde backend;
- ejecutar pipeline semantico versionado;
- devolver `semantic_analysis_v1` o errores estructurados;
- no acceder directamente a blockchain ni exponerse al frontend.

### Blockchain

- registrar emisores autorizados o su estado;
- registrar el hash canonico de una credencial emitida;
- exponer estado de revocacion;
- guardar evidencia minima, no el contenido completo de la credencial.

## 4. Limites y dependencias

### Frontend -> Backend

- interfaz HTTP/JSON exclusivamente;
- sin logica de verificacion criptografica en cliente;
- sin acceso directo a PostgreSQL, AI service o smart contracts.

### Backend -> PostgreSQL

- almacenamiento fuente de verdad para datos completos y operativos;
- trazabilidad entre credencial, analisis, perfil y evidencia blockchain.

### Backend -> AI service

- integracion HTTP interna;
- payloads normalizados y versionados;
- errores semanticos controlados por backend.

### Backend -> Blockchain

- integracion a traves de libreria cliente desde Node;
- registro y consulta de evidencia minima;
- desacople entre transaccion blockchain y modelo relacional interno.

## 5. Separacion on-chain / off-chain

### On-chain

- `canonical_hash` de la credencial emitida;
- `chain_id`, direccion de contrato y transaccion;
- estado de revocacion;
- autorizacion minima del emisor;
- timestamp de registro on-chain.

### Off-chain

- contenido completo de `credential_v1`;
- datos personales y DIDs del titular;
- catalogos academicos y programas;
- analisis semanticos y perfiles;
- auditoria, eventos y sharing links.

## 6. Criterios mobile-first y evolucion futura

- la wallet sigue siendo web mobile-first en esta etapa;
- el modelo de dominio no debe depender de una UI concreta;
- los contratos de backend deben permitir una futura app movil nativa sin rehacer el dominio;
- la PWA es una decision de experiencia, no un cambio del limite backend.

## 7. Flujo v1 de emision

1. El emisor crea o actualiza un borrador de credencial.
2. El backend valida permisos, consistencia y campos requeridos.
3. El backend persiste la credencial como `draft`.
4. Cuando la emision se confirma, el backend fija `issued_at`.
5. El backend construye la proyeccion canonica versionada.
6. Calcula `canonical_hash`.
7. Registra la evidencia minima en blockchain o en un adaptador local/mock.
8. Persiste `blockchain_record_v1`.
9. Habilita la ejecucion inicial del analisis semantico.

## 8. Flujo v1 de verificacion

1. El verificador recibe una credencial, token o link compartido.
2. El backend resuelve la credencial y sus permisos de acceso.
3. Recalcula o recupera el `canonical_hash`.
4. Consulta el registro blockchain asociado.
5. Verifica autorizacion del emisor, coincidencia de hash y revocacion.
6. Devuelve un resultado comprensible con evidencia suficiente.
7. Registra `VerificationEvent`.

## 9. Flujo v1 de analisis semantico

1. El backend selecciona una credencial emitida o un conjunto acotado de credenciales.
2. Construye un payload normalizado para el AI service.
3. El AI service devuelve `semantic_analysis_v1` con `pipeline_version`, `taxonomy_version` y `status`.
4. El backend persiste el analisis.
5. Si corresponde, recalcula el perfil formativo del usuario.

## 10. Flujo v1 de perfil formativo

1. El backend agrega credenciales emitidas y analisis disponibles del usuario.
2. Consolida areas, skills, horas y evidencia.
3. Genera `formative_profile_v1`.
4. Expone el perfil a wallet y, solo con autorizacion, a verificadores.

## 11. Alcance esperado para entrega 50%

- arquitectura de dominio y contratos documentados;
- backend inicial con endpoints base o contratos listos para implementacion;
- modelo relacional conceptual estabilizado y Prisma proximo a implementarse;
- `credential_v1` preparada para emision y hashing canonico;
- persistencia off-chain inicial;
- AI service FastAPI con scaffold minimo o endpoint inicial funcional;
- integracion backend <-> AI service preparada o implementada de forma acotada;
- capacidad real de generar o persistir `semantic_analysis_v1` para credenciales seleccionadas;
- el alcance puede ser limitado y no definitivo, pero la IA debe formar parte efectiva de la entrega 50;
- blockchain local con Anvil, mockeada o documentada para integracion inmediata segun alcance real.

## 12. Alcance esperado para entrega 75%

- primeros endpoints NestJS funcionando sobre PostgreSQL;
- flujo de emision con hash canonico implementado;
- integracion inicial con AI service operativa;
- verificacion basica desde backend;
- registro blockchain local o de prueba funcionando para credenciales seleccionadas.

## 13. Alcance esperado para entrega final

- emision, verificacion y revocacion consistentes;
- perfil formativo consolidado;
- sharing controlado por permisos;
- integracion madura con blockchain y AI service;
- soporte de trazabilidad y auditoria de punta a punta.

## 14. Decisiones abiertas

- formato definitivo de DID y resolucion de identidades;
- esquema exacto de autenticacion y gestion de sesiones;
- politica final para sharing grants y expiracion de links;
- estrategia de asincronia para analisis semantico;
- criterio final para revocacion parcial o total de credenciales.

## 15. Riesgos tecnicos principales

- mezclar identificadores internos con datos firmables o hasheables;
- permitir que metadata mutable afecte el `canonical_hash`;
- acoplar demasiado pronto el modelo relacional al primer caso de uso UI;
- sobredisenar los schemas JSON intentando reemplazar Prisma;
- subestimar latencia o fallos de integracion con AI service y blockchain.
