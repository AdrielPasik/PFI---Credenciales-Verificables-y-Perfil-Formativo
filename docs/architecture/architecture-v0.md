# Arquitectura v0

> Este documento describe la arquitectura logica inicial del sistema. No define aun la arquitectura final de despliegue ni decisiones de infraestructura productiva.

## 1. Objetivo del sistema

Construir una plataforma para emitir, almacenar, verificar y analizar credenciales educativas digitales verificables. El sistema busca combinar confianza criptografica con interpretacion semantica del contenido formativo para generar perfiles estructurados reutilizables.

## 2. Actores

- Institucion emisora o entidad formativa.
- Usuario titular de credenciales.
- Verificador externo.
- Backend API como orquestador.
- AI service como servicio semantico especializado.
- Red blockchain como capa de evidencia verificable.

## 3. Modulos principales

- Portal emisor dentro de la app web.
- Wallet web del usuario dentro de la app web.
- Plataforma verificador dentro de la app web.
- Backend API en NestJS.
- Base de datos PostgreSQL off-chain.
- AI service en FastAPI.
- Smart contracts Solidity sobre Foundry.

## 4. Responsabilidades por modulo

### Portal emisor

- cargar o seleccionar datos academicos;
- iniciar emision de credenciales;
- consultar historial y revocaciones;
- administrar identidad institucional.

### Wallet web

- listar credenciales;
- consultar detalle y estado;
- compartir QR o link;
- visualizar perfil formativo compartible.

### Plataforma verificador

- recibir credencial o identificador;
- solicitar validacion al backend;
- mostrar emisor, validez y revocacion;
- opcionalmente mostrar perfil autorizado por el usuario.

### Backend API

- validar entradas;
- construir credenciales normalizadas;
- persistir datos off-chain;
- calcular hashes;
- invocar blockchain y AI service;
- consolidar respuestas de verificacion;
- auditar eventos relevantes.

### AI service

- normalizar texto formativo;
- inferir areas, skills y conceptos;
- producir resultados estructurados;
- construir o regenerar perfiles formativos.

### Blockchain

- registrar evidencia minima;
- validar emisores autorizados;
- soportar consulta de estado;
- permitir revocacion.

## 5. Arquitectura logica

```text
Portal emisor / Wallet / Verifier
                |
                v
        Backend API orquestador
         /          |           \
        v           v            v
 PostgreSQL    AI service    Smart contracts
 off-chain     semantico     evidencia minima
```

El backend es el punto de integracion obligatorio. El frontend no interactua directamente con blockchain ni con el servicio de IA.

## 6. Flujo de emision

1. El emisor inicia la emision desde `/issuer`.
2. El backend valida y normaliza los datos.
3. Se construye la credencial estructurada `credential_v1`.
4. Se calcula un hash canonico de la credencial.
5. Se registra la evidencia minima on-chain.
6. Se persiste la credencial completa off-chain.
7. La credencial se asocia al usuario.
8. Se habilita el analisis semantico asincrono o diferido.

## 7. Flujo de verificacion

1. El usuario comparte un link, QR o identificador.
2. El verificador consulta al backend.
3. El backend valida estructura y procedencia.
4. Recalcula hash o recupera referencia verificable.
5. Consulta blockchain para estado, emisor y revocacion.
6. Devuelve un resultado interpretable para el verificador.

## 8. Flujo de analisis semantico

1. El backend envia una credencial verificada al AI service.
2. El AI service normaliza el contenido educativo.
3. Detecta areas, skills, conceptos y evidencia.
4. Devuelve `semantic_analysis_v1`.
5. El backend persiste el analisis.
6. El backend actualiza `formative_profile_v1`.

## 9. Informacion on-chain

- identificadores o hashes de credenciales;
- emisores autorizados;
- timestamps de emision;
- estado de revocacion;
- referencias minimas necesarias para verificacion.

## 10. Informacion off-chain

- contenido completo de la credencial;
- datos personales del usuario;
- catalogos academicos;
- metadatos institucionales;
- resultados semanticos;
- perfiles formativos;
- eventos de verificacion;
- auditoria interna.

## 11. Alcance para entrega 50%

- monorepo inicial operativo;
- documentacion de arquitectura y flujos;
- contratos de datos iniciales;
- scaffold de modulos principales;
- esquema conceptual de blockchain, IA y base de datos.

## 12. Alcance para entrega 75%

- frontend con rutas base funcionales;
- backend con primeros endpoints de emision y verificacion;
- persistencia inicial en PostgreSQL con Prisma;
- contrato blockchain minimo para registrar hashes;
- AI service con pipeline semantico acotado.

## 13. Alcance final

- emision completa de credenciales verificables;
- consulta de wallet y verificacion externa;
- revocacion y trazabilidad;
- analisis semantico integrado;
- perfil formativo consolidado y reutilizable.

## 14. Decisiones abiertas

- estrategia exacta de identidad digital y formato DID;
- mecanismo de firma de credenciales off-chain;
- canonizacion exacta para hashing de credenciales;
- definicion final del schema Prisma;
- estrategia de colas o asincronia para analisis semantico;
- politica de privacidad y consentimiento para compartir perfil.

## 15. Riesgos tecnicos

- acoplar demasiado pronto el modelo de datos al primer frontend;
- mezclar informacion sensible con evidencia on-chain;
- definir hashes sin una representacion canonica estable;
- divergencia entre schemas JSON, DTOs y schema de base de datos;
- sobrecargar al backend con procesos semanticos sin desacoplar;
- subestimar la gestion de revocacion y trazabilidad verificable.
