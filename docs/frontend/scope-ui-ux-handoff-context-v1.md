# Scope: UI/UX handoff context v1

## Uso de este documento

Este es el brief activo para diseño y UX del frontend Scope. Se usa junto con `scope-product-positioning-v1.md`, `frontend-brand-and-design-system-v1.md` y los contratos reales. No autoriza a inventar capabilities, datos, navegación o estados; el código backend define qué puede mostrarse y operar hoy.

## Producto actual

Scope reúne credenciales, contenido formativo, evidencia e interpretación asistida para ayudar a comprender una trayectoria. La experiencia debe hacer visible la diferencia entre información declarada por el emisor, evidencia disponible, interpretación semántica y perfil agregado.

La integridad técnica respalda la proveniencia y el estado de una credencial. No debe dominar la narrativa visual ni presentarse como validación académica. La IA estructura evidencia y ayuda a explicarla; no certifica, no emite y no define por sí sola qué sabe una persona.

## Audiencias y prioridades

| Audiencia | Necesidad principal | Forma de experiencia |
| --- | --- | --- |
| Institución emisora | Operar credenciales y evidencia con claridad contextual. | Workspace web responsive. |
| Titular | Entender su perfil y las fuentes que lo respaldan. | Holder Web responsive, profile-first y desktop-capable. |
| Verificador | Consultar estado y evidencia técnica mínima sin login. | Público, focal y simple. |

## Experiencias actuales

### Portal del Emisor

La prioridad es operación institucional: contexto activo, creación/edición permitida de borradores, evidencia, análisis disponible y emisión según los contratos actuales. Evitar dashboards con métricas ficticias, referencias técnicas como identidad y estética blockchain.

### Perfil y credenciales del Titular

El perfil es la lectura principal de la trayectoria. Las áreas, habilidades y
conceptos se presentan con cobertura y confianza prudentes; las credenciales
funcionan como evidencia de respaldo. La arquitectura debe poder pasar a móvil
sin depender de una tabla desktop o una sidebar compleja. La web del Titular no
es un mock de la futura app móvil: reutilizan producto, contratos y
terminología, no necesariamente layout ni componentes visuales. El blueprint
móvil activo es `scope-holder-mobile-app-blueprint-v1.md`.

La ruta actual `/wallet` renderiza `Mi perfil formativo`; `/wallet/credentials`
es la lista de fuentes y `/wallet/credentials/[credentialId]` su detalle. No
proponer `/wallet/profile` mientras esa ruta no exista realmente.

El Holder puede compartir un perfil current desde la acción existente dentro de
`/wallet`. El grant usa un token opaco y la vista pública es allowlisted; no
equivale a compartir una credencial por verificación pública, a QR, a gestión
de grants ni a compartir Contextual Analysis. La gestión/revocación de grants
por Holder todavía no tiene UI.

### Verificador público

La consulta se centra en la credencial, su estado, la institución emisora y evidencia de integridad allowlisted. No expone email, contenido crudo, artifacts IA, storage ni navegación privada. Un borrador no se revela como existente.

## Dirección visual

Scope debe sentirse como un producto de inteligencia educativa: claro, institucional contemporáneo, humano y riguroso. Priorizar superficies por capas, jerarquía editorial, lectura progresiva y el perfil como punto de integración. Usar el logo Scope como marca, no como decoración repetida.

No usar nodos/cadenas decorativas, símbolos Web3, purple AI, glassmorphism, gradientes dominantes, dashboards SaaS intercambiables ni resultados inventados.

## Copy y límites epistemológicos

Preferir “evidencia formativa”, “interpretación asistida”, “perfil formativo”, “institución emisora”, “titular” y “evidencia de integridad”. Evitar afirmar dominio, expertise, certificación por IA, validación académica por blockchain, match porcentual o ausencia de capacidad por falta de evidencia.

La formulación segura es: Scope muestra qué puede respaldarse a partir de la evidencia disponible. Si falta evidencia, la conclusión es “sin evidencia disponible”, no una negación sobre la persona.

## Dirección futura, no implementada

El producto puede evolucionar a análisis frente a un contexto u objetivo:

```text
objetivo -> requisitos -> evidencia relacionada -> respaldo parcial o ausente
-> fuentes concretas -> explicación humana
```

No representar todavía esa secuencia como pantalla, endpoint, score, matching o acción real. Empleo/ATS puede ser un contexto de uso, junto con becas, admisión, posgrado y equivalencias; Scope no es una app de recruiting.

## Checklist para una tarea de UI

- confirmar ruta, permisos, estado y datos contra contrato real;
- distinguir evidencia, interpretación y perfil;
- mantener Holder Web profile-first y responsive; remitir la app móvil futura
  a `scope-holder-mobile-app-blueprint-v1.md`;
- no exponer IDs, tokens, storage, artifacts crudos ni errores internos;
- no convertir una dirección futura en placeholder funcional;
- documentar cualquier necesidad de backend como gap;
- aplicar el design system Scope sin modificar tokens/código salvo un slice visual explícito.
