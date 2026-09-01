# Guía de implementación UI frontend v1

> **Actualización Scope.** Esta guía mantiene su versión técnica y adopta la
> identidad normativa de `frontend-brand-and-design-system-v1.md`. No modifica
> runtime, contratos, rutas ni responsabilidades de componentes.

## 1. Propósito y precedencia

Esta guía define reglas operativas para implementar interfaces de Scope. No
reemplaza los documentos normativos existentes.

Ante una contradicción, aplicar esta precedencia:

1. backend real para capacidades, permisos y datos;
2. `frontend-data-and-view-models-v0.md` para fronteras y modelos;
3. `frontend-information-architecture-v0.md` para rutas y navegación;
4. `frontend-brand-and-design-system-v1.md` para marca y sistema visual;
5. `frontend-component-inventory-v0.md` para responsabilidades;
6. screen specs para composición e interacción;
7. esta guía para decisiones de implementación.

No completar gaps documentales inventando UI, estados o datos.

## 2. Stack oficial

- Next.js con App Router;
- React;
- TypeScript estricto;
- Tailwind CSS 4;
- componentes code-owned compatibles con shadcn/ui;
- Radix UI cuando una primitive lo justifica;
- Lucide React como única familia de iconos;
- Class Variance Authority para variantes;
- `clsx` y `tailwind-merge` mediante `cn()`;
- Motion for React solo cuando exista una interacción funcional justificada.

## 3. Componentes

- Preferir primitives shadcn/Radix aprobadas antes de crear primitives desde
  cero.
- Los componentes shadcn son code-owned y se tematizan con Scope.
- Construir componentes de dominio sobre primitives técnicas.
- Centralizar variantes con CVA y combinar clases con `cn()`.
- Conservar props nativas y forwarding de `ref` cuando corresponda.
- No importar DTOs backend en componentes.
- No hacer fetching desde componentes de presentación.
- No construir clases Tailwind mediante concatenaciones dinámicas.
- No mezclar familias de iconos.
- Usar shells contextuales; nunca crear un `AppShell` universal.
- No crear una primitive sin un consumidor real.

## 4. CSS y tokens

- Las variables CSS vigentes son la fuente de verdad; una futura migración de
  tokens a la nomenclatura Scope debe preservar la semántica existente.
- Tailwind se usa para composición y responsive.
- `globals.css` contiene tokens y estilos base, no reglas de componentes o
  páginas.
- Evitar CSS específico por componente salvo necesidad demostrada.
- No repetir hexadecimales en JSX.
- No inventar tokens locales sin documentarlos.
- No copiar el aspecto default de shadcn sin tematización Scope.

## 5. Calidad visual

La interfaz debe sentirse institucional, tecnológica, sobria y precisa:

- jerarquía clara;
- densidad controlada;
- profundidad sutil;
- responsive real;
- estados completos;
- foco visible;
- feedback persistente cuando el error es importante;
- motion corto y funcional.

Quedan prohibidos:

- estética Web3 genérica;
- neón o gradientes dominantes;
- glassmorphism dominante;
- dashboard o métricas fake;
- datos mock presentados como reales;
- componentes gigantes;
- primitives artesanales cuando exista una alternativa aprobada;
- efectos usados solo como espectáculo.

## 6. Motion

- Instalar Motion solo cuando una transición funcional lo requiera.
- Respetar `prefers-reduced-motion`.
- No animar continuamente ni demorar tareas.
- No inventar porcentajes o progreso.

## 7. Marca

`BrandMark` integra la marca aprobada según la superficie. Usa `Logo Scope 2.png`
en superficies claras y `Logo Scope Invertido.png` en shells autenticados navy.
El wordmark textual permanece como fallback accesible para contextos que no
soliciten asset.

Los layouts no deben depender de recortes, offsets negativos, filtros de
inversión ni de dimensiones intrínsecas del PNG: las variantes se renderizan
completas con `object-contain`.

## 8. Dirección artística de Scope

- Navy es la base institucional para navegación y jerarquía principal.
- Teal identifica foco, interpretación y actividad relevante; ámbar queda
  reservado para warnings o cobertura parcial, no para identidad de marca.
- Las superficies blancas funcionan como foreground. No deben convertirse en
  el canvas dominante ni producir una sucesión de cards idénticas.
- La profundidad se construye con fondos por capas, bordes sutiles, acentos
  lineales y sombras controladas.
- La composición debe ser editorial, contextual y profile-first, no un
  dashboard genérico ni una superficie crypto.
- Lucide es la única familia de iconos y sus símbolos deben aclarar acciones o
  estados reales.
- El motion debe ser corto, funcional y respetar `prefers-reduced-motion`.
- Quedan prohibidas la estética cripto, los neones, el glassmorphism dominante
  y los datos decorativos o métricas falsas.

## 9. Checklist para futuras pantallas

- [ ] Se leyeron los documentos normativos aplicables.
- [ ] Se reutilizaron primitives y componentes existentes.
- [ ] Los estados empty, loading, success, error y unsupported aplicables están
      definidos.
- [ ] Mobile, tablet y desktop fueron revisados.
- [ ] Labels, teclado, foco, contraste y anuncios accesibles funcionan.
- [ ] No hay datos, acciones, rutas ni capacidades fake.
- [ ] No se muestran IDs técnicos como identidad humana.
- [ ] No se importan DTOs backend en presentación.
- [ ] No hay fetching dentro de componentes visuales.
- [ ] Typecheck, lint, tests y build pasan.
- [ ] Se realizó revisión visual sin errores de consola.
