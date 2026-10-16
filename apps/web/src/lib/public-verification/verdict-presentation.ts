import type {
  PublicVerificationHeadline,
  PublicVerificationStatus
} from '@/models/public-verification';

/**
 * Presentacion del veredicto de verificacion -- UNICA fuente.
 *
 * El servidor decide el titular (`headline`); esta funcion solo lo traduce a
 * texto y tono. NO recalcula nada: ni mira la firma ni la cadena. Dos reglas
 * defensivas, ambas monotonas hacia lo MAS cauteloso:
 *
 *   - `INVALID` nunca se suaviza, ni siquiera si el estado dice revocada;
 *   - `status === 'revoked'` domina sobre un titular positivo.
 *
 * Y la regla central: ningun titular distinto de `VERIFIED` puede producir el
 * tono `verified`. El texto y el estilo positivos solo salen de `VERIFIED`.
 */

export type VerdictTone = 'verified' | 'limited' | 'indeterminate' | 'invalid' | 'revoked';

export interface VerdictPresentation {
  headline: PublicVerificationHeadline;
  tone: VerdictTone;
  /** Texto corto de insignia. */
  badge: string;
  /** Titulo del resultado. */
  title: string;
}

const PRESENTATION: Record<PublicVerificationHeadline, Omit<VerdictPresentation, 'headline'>> = {
  VERIFIED: {
    tone: 'verified',
    badge: 'Verificada',
    title: 'Credencial verificada'
  },
  VERIFIED_WITH_LIMITED_EVIDENCE: {
    tone: 'limited',
    badge: 'Verificada con evidencia limitada',
    title: 'Autoría verificada, con evidencia de red limitada'
  },
  INDETERMINATE: {
    tone: 'indeterminate',
    badge: 'No determinada',
    title: 'No se pudo determinar la autenticidad'
  },
  INVALID: {
    tone: 'invalid',
    badge: 'No válida',
    title: 'La credencial no supera la verificación'
  },
  REVOKED: {
    tone: 'revoked',
    badge: 'Revocada',
    title: 'Credencial revocada'
  }
};

export function effectiveHeadline(
  headline: PublicVerificationHeadline,
  status: PublicVerificationStatus
): PublicVerificationHeadline {
  if (headline === 'INVALID') {
    return 'INVALID';
  }

  if (status === 'revoked') {
    return 'REVOKED';
  }

  return headline;
}

export function presentVerdict(
  headline: PublicVerificationHeadline,
  status: PublicVerificationStatus
): VerdictPresentation {
  const effective = effectiveHeadline(headline, status);

  return { headline: effective, ...PRESENTATION[effective] };
}
