/**
 * Tokens de diseño nativos de Scope.
 *
 * Derivados de los tokens de Scope Web (`apps/web/src/app/globals.css`).
 * NO se importa nada desde `apps/web`: los valores se replican acá como
 * constantes nativas. Si la marca cambia en Web, este archivo es el único
 * lugar que hay que actualizar en mobile (ver `06-design-system-mobile.md`).
 *
 * Los colores existen en dos paletas con la MISMA forma: `lightColors` (la
 * apariencia original de la app) y `darkColors` (azul tinta y petróleo, la
 * paleta oscura aprobada en Web). Cada clave es un rol, no un tono: en oscuro
 * toma el valor que cumple ese rol con contraste suficiente.
 *
 * Ningún componente debe escribir un color literal ni importar una paleta
 * directamente: siempre `useTheme().colors` o `makeStyles` (ver
 * `theme-provider.tsx`).
 */

export const lightColors = {
  brand: {
    navy: '#0B1D3A',
    navyStrong: '#12315C',
    navySoft: '#174671',
    tint: '#E5F2F4',
    teal: '#167F89',
    tealBright: '#2097A1',
    cyan: '#BFE6EA'
  },
  /** Acción principal (botón primario, opción elegida). */
  action: {
    primary: '#0B1D3A',
    primaryBorder: '#0B1D3A',
    onPrimary: '#FFFFFF'
  },
  surface: {
    background: '#EEF2F5',
    card: '#FFFFFF',
    muted: '#F7FAFB',
    inverse: '#0B1D3A',
    /** Fondo del fragmento citado dentro de un texto. */
    highlight: '#BFE6EA'
  },
  text: {
    strong: '#0B1D3A',
    default: '#31445F',
    muted: '#5F7084',
    subtle: '#7B8998',
    onInverse: '#FFFFFF',
    onInverseMuted: '#D5E6EA',
    onHighlight: '#0B1D3A'
  },
  border: {
    default: '#D9E3E8',
    strong: '#BDCCD5',
    onInverse: 'rgba(255, 255, 255, 0.18)',
    inverse: '#12315C'
  },
  status: {
    issued: '#2563A6',
    issuedSoft: '#EAF2FB',
    analysis: '#197278',
    analysisSoft: '#E5F4F3',
    success: '#176B49',
    successSoft: '#E8F6EE',
    warning: '#89520D',
    warningSoft: '#FFF3D9',
    warningBorder: '#E4C58A',
    error: '#A92F39',
    errorSoft: '#FCEBEC',
    errorBorder: '#E9B4B8',
    revoked: '#A93647',
    revokedSoft: '#F9E8EC',
    neutral: '#56636C',
    neutralSoft: '#EFF2F3'
  },
  /**
   * Banda de bienvenida del inicio: degradado azul tinta con halos petróleo.
   * Es una superficie inversa en los dos temas; en oscuro se funde con el
   * fondo y los halos bajan de intensidad.
   */
  band: {
    start: '#0B1D3A',
    end: '#12315C',
    halo: 'rgba(47, 143, 153, 0.42)',
    haloSecondary: 'rgba(37, 96, 135, 0.38)',
    text: '#FFFFFF',
    muted: '#D5E6EA',
    eyebrow: '#9FD0D6',
    tile: 'rgba(255, 255, 255, 0.08)',
    tileBorder: 'rgba(255, 255, 255, 0.16)',
    action: '#24727E',
    actionBorder: '#9FD0D6',
    onAction: '#FFFFFF',
    secondary: 'rgba(255, 255, 255, 0.08)',
    secondaryBorder: 'rgba(255, 255, 255, 0.28)'
  },
  focusRing: '#256087',
  overlay: 'rgba(11, 29, 58, 0.45)',
  shadow: '#0B1D3A'
};

export type ScopeColors = typeof lightColors;

/**
 * Paleta oscura: fondo azul tinta, superficies diferenciadas y acento
 * petróleo. Valores tomados de `:root[data-theme="dark"]` de Scope Web.
 *
 * En oscuro, `brand.teal` y `brand.navy` dejan de ser colores de relleno y
 * pasan a ser color de texto/ícono legible sobre la tinta; los rellenos
 * sólidos de acción usan `action.*`.
 */
export const darkColors: ScopeColors = {
  brand: {
    navy: '#EEF3F8',
    navyStrong: '#A9D2D8',
    navySoft: '#C6D2DF',
    tint: '#173842',
    teal: '#82BCC4',
    tealBright: '#A9D2D8',
    cyan: '#2F7F8A'
  },
  action: {
    primary: '#24727E',
    primaryBorder: '#9FD0D6',
    onPrimary: '#FFFFFF'
  },
  surface: {
    background: '#0A1424',
    card: '#101D33',
    muted: '#0C182B',
    inverse: '#0E223F',
    highlight: '#24546A'
  },
  text: {
    strong: '#EEF3F8',
    default: '#C6D2DF',
    muted: '#97A8BB',
    subtle: '#8394A8',
    onInverse: '#FFFFFF',
    onInverseMuted: '#C6D2DF',
    onHighlight: '#EEF3F8'
  },
  border: {
    default: '#24364F',
    strong: '#314A6A',
    onInverse: 'rgba(255, 255, 255, 0.16)',
    inverse: '#1D3A5F'
  },
  status: {
    issued: '#93B6E0',
    issuedSoft: '#142840',
    analysis: '#80C0BC',
    analysisSoft: '#0F2A2D',
    success: '#7CC7A2',
    successSoft: '#112B22',
    warning: '#E3B56E',
    warningSoft: '#30240F',
    warningBorder: '#6B5226',
    error: '#F0999D',
    errorSoft: '#3A181C',
    errorBorder: '#6E3439',
    revoked: '#F09AA8',
    revokedSoft: '#3A1822',
    neutral: '#A9B6C1',
    neutralSoft: '#1A2431'
  },
  band: {
    start: '#0E223F',
    end: '#0A1424',
    halo: 'rgba(47, 143, 153, 0.30)',
    haloSecondary: 'rgba(37, 96, 135, 0.24)',
    text: '#FFFFFF',
    muted: '#C6D2DF',
    eyebrow: '#9FD0D6',
    tile: 'rgba(255, 255, 255, 0.06)',
    tileBorder: 'rgba(255, 255, 255, 0.14)',
    action: '#24727E',
    actionBorder: '#9FD0D6',
    onAction: '#FFFFFF',
    secondary: 'rgba(255, 255, 255, 0.06)',
    secondaryBorder: 'rgba(255, 255, 255, 0.24)'
  },
  focusRing: '#8FB8D8',
  overlay: 'rgba(2, 6, 14, 0.68)',
  shadow: '#000000'
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40
} as const;

export const radii = {
  sm: 8,
  control: 12,
  card: 16,
  dialog: 20,
  pill: 999
} as const;

/**
 * Alturas mínimas de interacción. 44 es el mínimo cómodo recomendado tanto
 * por iOS HIG como por Material; nunca bajar de ahí en un control táctil.
 */
export const layout = {
  touchTarget: 44,
  contentMaxWidth: 640,
  screenPaddingHorizontal: 20,
  hairline: 1
} as const;

/**
 * Elevación discreta. Android usa `elevation`, iOS usa shadow*: por eso los
 * tokens llevan ambas familias de propiedades. El color de sombra depende de
 * la paleta: navy en claro, negro en oscuro.
 */
export function createElevation(colors: ScopeColors) {
  return {
    none: {
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0
    },
    card: {
      shadowColor: colors.shadow,
      shadowOpacity: colors === lightColors ? 0.06 : 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2
    },
    raised: {
      shadowColor: colors.shadow,
      shadowOpacity: colors === lightColors ? 0.1 : 0.42,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 },
      elevation: 4
    }
  } as const;
}

export type ScopeElevation = ReturnType<typeof createElevation>;

export const fontFamilies = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  /** Monoespaciada de sistema, para valores técnicos (hashes, DIDs). */
  mono: undefined as string | undefined
} as const;

/**
 * Roles tipográficos. No se fijan `height` en los contenedores que los usan:
 * el texto tiene que poder crecer con el escalado de fuente del sistema.
 */
export const typography = {
  display: { fontFamily: fontFamilies.bold, fontSize: 28, lineHeight: 34 },
  screenTitle: { fontFamily: fontFamilies.bold, fontSize: 24, lineHeight: 30 },
  sectionTitle: { fontFamily: fontFamilies.semiBold, fontSize: 17, lineHeight: 24 },
  cardTitle: { fontFamily: fontFamilies.semiBold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fontFamilies.regular, fontSize: 15, lineHeight: 23 },
  bodyStrong: { fontFamily: fontFamilies.semiBold, fontSize: 15, lineHeight: 23 },
  small: { fontFamily: fontFamilies.regular, fontSize: 13, lineHeight: 20 },
  smallStrong: { fontFamily: fontFamilies.semiBold, fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 17 },
  overline: {
    fontFamily: fontFamilies.semiBold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.9,
    textTransform: 'uppercase' as const
  },
  technical: { fontFamily: fontFamilies.mono, fontSize: 12, lineHeight: 19 }
} as const;
