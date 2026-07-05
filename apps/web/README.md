# Web App

Aplicacion web unica prevista para Next.js con enfoque mobile-first y soporte futuro de PWA.

## Rutas previstas

- `/issuer`: portal de emision y administracion institucional.
- `/verifier`: flujo de verificacion de credenciales.
- `/wallet`: wallet web responsive para el usuario final.

## Estado actual

Solo se dejo la estructura minima del modulo para evitar acoplamiento prematuro. Todavia no se genero el scaffold ejecutable de Next.js ni se implementaron pantallas funcionales.

## Lineamientos

- Mantener una sola app web inicial.
- No crear app mobile nativa en esta etapa.
- Centralizar toda integracion con backend via API, no directamente con blockchain.
