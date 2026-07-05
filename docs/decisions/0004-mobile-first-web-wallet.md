# ADR 0004 - Wallet Web Mobile-first

## Contexto

El usuario final necesita consultar y compartir credenciales desde el celular, pero el alcance inicial del proyecto no admite sostener una app nativa separada.

## Decision

Implementar la wallet inicialmente como una ruta dentro de la app web principal, con enfoque mobile-first y preparacion para PWA.

## Justificacion

- reduce complejidad operativa en la primera etapa;
- acelera iteracion funcional y pruebas de usabilidad;
- mantiene una sola base de codigo frontend;
- cubre el caso de uso principal desde dispositivos moviles sin entrar en React Native o Expo.

## Consecuencias

- la experiencia mobile depende de una web app bien disenada;
- ciertas capacidades nativas quedan fuera del alcance inicial;
- el frontend debe priorizar responsive design desde el inicio.

## Alternativas descartadas

- wallet nativa separada en React Native;
- apps distintas para issuer, verifier y wallet;
- wallet acoplada directamente a blockchain sin pasar por backend.
