/**
 * Tokens de diseño nativos de Scope.
 *
 * Derivados de los tokens de Scope Web (`apps/web/src/app/globals.css`).
 * NO se importa nada desde `apps/web`: los valores se replican acá como
 * constantes nativas. Si la marca cambia en Web, este archivo es el único
 * lugar que hay que actualizar en mobile (ver `06-design-system-mobile.md`).
 *
 * Ningún componente debe escribir un color literal: siempre `colors.*`.
 */

export const colors = {
  brand: {
    navy: '#0B1D3A',
    navyStrong: '#12315C',
    navySoft: '#174671',
    tint: '#E5F2F4',
    teal: '#167F89',
    tealBright: '#2097A1',
    cyan: '#BFE6EA'
  },
  surface: {
    background: '#EEF2F5',
    card: '#FFFFFF',
    muted: '#F7FAFB',
    inverse: '#0B1D3A'
  },
  text: {
    strong: '#0B1D3A',
    default: '#31445F',
    muted: '#5F7084',
    subtle: '#7B8998',
    onInverse: '#FFFFFF',
    onInverseMuted: '#D5E6EA'
  },
  border: {
    default: '#D9E3E8',
    strong: '#BDCCD5',
    onInverse: 'rgba(255, 255, 255, 0.18)'
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
  focusRing: '#256087',
  overlay: 'rgba(11, 29, 58, 0.45)'
} as const;

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
 * tokens llevan ambas familias de propiedades.
 */
export const elevation = {
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  },
  card: {
    shadowColor: colors.brand.navy,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  raised: {
    shadowColor: colors.brand.navy,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  }
} as const;

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

export const theme = {
  colors,
  spacing,
  radii,
  layout,
  elevation,
  typography,
  fontFamilies
} as const;

export type ScopeTheme = typeof theme;
