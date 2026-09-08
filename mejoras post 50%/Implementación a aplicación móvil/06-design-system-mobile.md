# Design system móvil

Archivo único de tokens: `apps/mobile/src/lib/theme/tokens.ts`.
Ningún componente escribe un color literal.

## 1. Origen

Los valores se derivan de los tokens de Scope Web
(`apps/web/src/app/globals.css`). **No se importa nada de `apps/web`**: se
replican como constantes nativas. Si la marca cambia en Web, `tokens.ts` es el
único archivo de Mobile que hay que tocar.

Paridad visual sin paridad tecnológica: Web usa Tailwind, Mobile usa
`StyleSheet`. Los valores son los mismos.

## 2. Colores

### Marca

| Token | Valor | Uso |
| --- | --- | --- |
| `brand.navy` | `#0B1D3A` | Superficie de resumen, botón primario, texto fuerte. |
| `brand.navyStrong` | `#12315C` | Borde de la superficie navy, procedencia "Emisor". |
| `brand.navySoft` | `#174671` | Reservado. |
| `brand.tint` | `#E5F2F4` | Fondo de avisos informativos y del pill "Emisor". |
| `brand.teal` | `#167F89` | Acento principal, pestaña activa, iconos. |
| `brand.tealBright` | `#2097A1` | Acento reforzado. |
| `brand.cyan` | `#BFE6EA` | Acento sobre navy. |

### Superficies y texto

| Token | Valor |
| --- | --- |
| `surface.background` | `#EEF2F5` |
| `surface.card` | `#FFFFFF` |
| `surface.muted` | `#F7FAFB` |
| `surface.inverse` | `#0B1D3A` |
| `text.strong` | `#0B1D3A` |
| `text.default` | `#31445F` |
| `text.muted` | `#5F7084` |
| `text.subtle` | `#7B8998` |
| `text.onInverse` | `#FFFFFF` |
| `text.onInverseMuted` | `#D5E6EA` |
| `border.default` | `#D9E3E8` |
| `border.strong` | `#BDCCD5` |
| `border.onInverse` | `rgba(255,255,255,0.18)` |

### Semánticos

| Token | Valor | Uso |
| --- | --- | --- |
| `status.issued` / `issuedSoft` | `#2563A6` / `#EAF2FB` | Credencial emitida. |
| `status.revoked` / `revokedSoft` | `#A93647` / `#F9E8EC` | Credencial revocada. |
| `status.analysis` / `analysisSoft` | `#197278` / `#E5F4F3` | Interpretación asistida, pill "IA". |
| `status.warning` / `warningSoft` / `warningBorder` | `#89520D` / `#FFF3D9` / `#E4C58A` | Cobertura, revocación, fallos recuperables. |
| `status.error` / `errorSoft` / `errorBorder` | `#A92F39` / `#FCEBEC` / `#E9B4B8` | Errores. |
| `status.success` / `successSoft` | `#176B49` / `#E8F6EE` | Confirmación de "copiado". |
| `status.neutral` / `neutralSoft` | `#56636C` / `#EFF2F3` | Tipo de credencial, etiquetas neutras. |

**El color nunca comunica solo.** Todo estado lleva texto: "Emitida",
"Revocada", "Cobertura del perfil", "Emisor", "IA".

## 3. Espaciado, radios y elevación

| Escala | Valores (pt) |
| --- | --- |
| `spacing` | `xs 4` · `sm 8` · `md 12` · `lg 16` · `xl 20` · `xxl 24` · `xxxl 32` · `huge 40` |
| `radii` | `sm 8` · `control 12` · `card 16` · `dialog 20` · `pill 999` |

`elevation` define tres niveles (`none`, `card`, `raised`) con propiedades para
iOS (`shadowColor/Opacity/Radius/Offset`) **y** Android (`elevation`). Son
sombras discretas, nunca las sombras grandes de la web.

`layout`:

| Token | Valor | Uso |
| --- | --- | --- |
| `touchTarget` | `44` | Mínimo de todo control interactivo. |
| `contentMaxWidth` | `640` | En tablet el texto no se estira de borde a borde. |
| `screenPaddingHorizontal` | `20` | Margen lateral de pantalla. |
| `hairline` | `1` | Borde fino. |

## 4. Tipografía

Familia: **Inter** (`@expo-google-fonts/inter`), en 400 / 500 / 600 / 700.
Fallback: la tipografía del sistema si las fuentes no cargan.

| Rol | Tamaño / interlínea | Uso |
| --- | --- | --- |
| `display` | 28 / 34 | Reservado. |
| `screenTitle` | 24 / 30 | Título de pantalla (uno por pantalla). |
| `sectionTitle` | 17 / 24 | Encabezado de sección. |
| `cardTitle` | 16 / 22 | Título de tarjeta. |
| `body` | 15 / 23 | Texto general. |
| `bodyStrong` | 15 / 23, 600 | Énfasis, etiquetas de botón. |
| `small` | 13 / 20 | Texto secundario. |
| `smallStrong` | 13 / 20, 600 | Encabezado de bloque. |
| `caption` | 12 / 17 | Metadatos. |
| `overline` | 11 / 16, mayúsculas, `letterSpacing 0.9` | Etiqueta de campo. |
| `technical` | 12 / 19, monoespaciada del sistema | Hash, DID, transacción. |

**Ningún contenedor de texto fija `height`.** El texto tiene que poder crecer con
el escalado de fuente del sistema sin romper el layout ni recortarse.

## 5. Componentes

### Primitivas (`src/components/ui/`)

| Componente | Archivo | Rol |
| --- | --- | --- |
| `ScopeText` | `text.tsx` | Único componente de texto. Variante + tono. |
| `ScopeButton` | `button.tsx` | `primary` / `secondary` / `ghost`, con estado de carga. |
| `ScopeTextField` | `text-field.tsx` | Campo accesible con error y alternador de contraseña. |
| `ScopeCard` | `surfaces.tsx` | Tarjeta (`surface` / `inverse` / `muted`). |
| `ScopeSection` | `surfaces.tsx` | Sección con título, descripción y acción. |
| `ScopeDivider` | `surfaces.tsx` | Separador de 1 pt. |
| `ScopeDefinitionRow` | `surfaces.tsx` | Etiqueta arriba, valor abajo. |
| `ScopeBadge` | `badge.tsx` | Estado como texto en pastilla. |
| `ScopeChip` | `badge.tsx` | Etiqueta de taxonomía que envuelve. |
| `ScopeScreen` | `screen.tsx` | Fondo, padding, ancho máximo, área segura, pull-to-refresh. |
| `ScopeScreenHeading` | `screen.tsx` | Encabezado de contenido. |
| `ScopeNotice` | `states.tsx` | Aviso inline (`warning`/`error`/`info`/`success`). |
| `ScopeLoadingState` | `states.tsx` | Carga inicial con etiqueta. |
| `ScopeSkeletonBlock` | `states.tsx` | Bloque de esqueleto. |
| `ScopeEmptyState` | `states.tsx` | Estado vacío. |
| `ScopeErrorState` | `states.tsx` | Error con acción de reintento. |
| `DeclaredTextList` | `content-lists.tsx` | **Texto largo declarado.** |
| `TaxonomyList` | `content-lists.tsx` | **Etiquetas cortas** como chips. |
| `ProvenanceIndicator` | `content-lists.tsx` | Pills "Emisor" / "IA". |
| `TechnicalValue` | `content-lists.tsx` | Valor técnico con acción de copiar. |

### De feature

| Componente | Archivo |
| --- | --- |
| `CredentialCard` | `features/credentials/credential-card.tsx` |
| `ProfilePanel` | `features/profile/profile-panel.tsx` |
| `ShareAction` | `features/sharing/share-action.tsx` |
| `AccountMenuButton` | `features/auth/account-menu-button.tsx` |

Se construyó **sólo lo que las pantallas usan**. No hay un framework de
componentes de empresa.

## 6. La distinción chip / texto (regla dura)

| Contenido | Componente | Por qué |
| --- | --- | --- |
| Área, habilidad, concepto | `TaxonomyList` → chips | Etiquetas cortas de taxonomía. |
| Competencia, resultado de aprendizaje, contenido declarado | `DeclaredTextList` → filas de texto | Llegan a **500 caracteres**: son párrafos. |

Renderizar un párrafo de 500 caracteres como pastilla de una línea fue
exactamente el problema que Holder Web tuvo que arreglar. Mobile lo evita por
construcción y hay tests que lo verifican, incluida la comprobación de que no se
aplique `numberOfLines`.

## 7. Accesibilidad

| Regla | Implementación |
| --- | --- |
| Objetivo táctil ≥ 44×44 | `layout.touchTarget` en botones, alternador de contraseña, botón de copiar, menú de cuenta, disclosure. |
| Todo botón con etiqueta | `accessibilityRole="button"` + `accessibilityLabel` descriptiva. Nunca "botón 1" ni "icono". |
| Iconos decorativos ocultos | `accessibilityElementsHidden` + `importantForAccessibility="no"`. El icono refuerza, nunca reemplaza al texto. |
| Estado no sólo por color | Toda insignia y todo aviso llevan texto. |
| Errores de formulario asociados | El campo anuncia `"<etiqueta>. <error>"` y el error usa `accessibilityLiveRegion="polite"`. |
| Encabezados | `accessibilityRole="header"` en títulos de pantalla y de sección. |
| Estados dinámicos | `accessibilityState` con `disabled`, `busy`, `expanded`, `selected`. |
| Anuncios de acción | "Enlace copiado." y "… copiada." con `accessibilityLiveRegion`. |
| Tarjeta de credencial | Etiqueta compuesta: título + tipo + emisor + estado + fecha; pista "Abre el detalle de la credencial". |
| Valores técnicos | `accessibilityLabel` con el valor completo, para que el lector no deletree la abreviatura. |
| Procedencia | Texto visible "Emisor"/"IA" **más** `accessibilityLabel` con el detalle ("2 aportes interpretados con IA"). En táctil no hay hover: un tooltip no sería accesible. |
| Escalado de fuente | Sin alturas fijas de texto; `flexShrink` donde puede desbordar. |

## 8. Teclado

En la pantalla de acceso:

- `KeyboardAvoidingView` (`padding` en iOS, comportamiento nativo en Android).
- `keyboardShouldPersistTaps="handled"`.
- Email: `keyboardType="email-address"`, `inputMode="email"`,
  `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="email"`,
  `textContentType="emailAddress"`, `returnKeyType="next"` → enfoca la contraseña.
- Contraseña: `secureTextEntry`, `autoComplete="current-password"`,
  `textContentType="password"`, `returnKeyType="go"` → envía.

## 9. Áreas seguras

`SafeAreaProvider` en la raíz. `ScopeScreen` y la lista de credenciales suman
`insets.bottom` a su padding inferior. El área superior la maneja el encabezado
de Expo Router. Ningún contenido queda bajo el notch, la Dynamic Island, la
barra de estado ni el indicador de home.

## 10. Adaptación a tamaños

| Ancho | Comportamiento |
| --- | --- |
| ~320–360 (teléfono chico) | Todo envuelve; los chips pasan a varias líneas. |
| ~390 (estándar) | Objetivo de diseño. |
| ~430 (teléfono grande) | Igual, con más aire. |
| Tablet | El contenido se centra con `maxWidth: 640`. No se estira ni se convierte en dos columnas: v1 no optimiza para tablet, pero no se rompe. |

No hay desbordamiento horizontal en ninguna pantalla: no se usan anchos fijos ni
scroll horizontal en la taxonomía.

## 11. Tema y apariencia

`userInterfaceStyle: 'light'` en `app.config.ts`. **v1 es sólo tema claro.**

Scope Web no define un tema oscuro completo, y un modo oscuro a medias (con
inputs o barra de estado ilegibles) sería peor que ninguno. La consistencia vale
más que un theming incompleto. El modo oscuro está registrado como trabajo
futuro.

Fondo claro (`#EEF2F5`) con acentos navy y teal. El navy se usa para superficies
de resumen **acotadas**, no para pantallas enteras.

## 12. Animación y haptics

No se agregó ninguna animación decorativa ni feedback háptico. Las transiciones
de navegación son las nativas de la plataforma. `motion-reduce` no hace falta
porque no hay movimiento propio que reducir.

## 13. Iconos

Familia única: **Ionicons** vía `@expo/vector-icons`, siempre en variante
`-outline` para un peso visual coherente. Los iconos acompañan al texto; nunca lo
sustituyen en una acción importante.

## 14. Assets de marca

| Archivo | Tamaño | Derivación |
| --- | --- | --- |
| `assets/icon.png` | 1024×1024 | Símbolo del logo invertido sobre navy, al 68 % del lienzo. |
| `assets/adaptive-icon.png` | 1024×1024 | Símbolo sobre transparente al 58 % (dentro de la zona segura del 66 % de Android). |
| `assets/splash-icon.png` | 512×512 | Símbolo sobre transparente. |
| `assets/brand-lockup.png` | 640×792 | Lockup completo del logo principal, recortado a su bounding box. |
| `assets/brand-lockup-inverse.png` | 640×795 | Idem, versión invertida. |

**Procedencia:** todos se derivan de los logos aprobados
`apps/web/public/brand/Logo Scope 2.png` y `Logo Scope Invertido.png`
(1254×1254) mediante `scripts/generate-brand-assets.js`, que:

1. detecta la banda transparente que separa el símbolo del wordmark (filas
   899-910 en el asset actual) en vez de asumir coordenadas;
2. recorta el símbolo a su bounding box real;
3. lo escala **uniformemente** y lo centra.

Nunca se altera la proporción del logo, no se redibuja nada y no se creó ninguna
marca nueva. `assets/brand-assets.manifest.json` registra las fuentes, las
coordenadas detectadas y las salidas, para que la derivación sea auditable y
reproducible.

**Por qué el icono lleva sólo el símbolo:** el wordmark "Scope" completo es
ilegible a 48 px. La guía de producto pide priorizar el símbolo aprobado.

Para regenerarlos:

```bash
node scripts/generate-brand-assets.js
```
