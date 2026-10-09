import type { IssuerMembershipSummaryVM } from '@/models/issuer-context';

/**
 * Elegibilidad para la CONFIGURACION TECNICA del emisor -- S8c9.
 *
 *   membership activa + rol admin
 *
 * y NADA mas: a diferencia de `isOperationalIssuerMembership`, NO exige que el
 * issuer este autorizado (la pagina existe justamente para ver por que no lo
 * esta), y NO admite operator ni viewer. Un PlatformAdmin sin membership no
 * aparece aca: no tiene ninguna fila en `issuerContexts`.
 *
 * ES SOLO UX. La autoridad es el backend
 * (`assertUserCanReadTechnicalIdentityForIssuer`), que exige exactamente esta
 * misma membership en cada request. Esta funcion evita ofrecer una pantalla
 * que el servidor va a rechazar.
 *
 * Esta regla NO sustituye ni modifica la elegibilidad OPERATIVA
 * (`models/issuer-context.ts`), que queda intacta.
 */
export function isTechnicalAdminMembership(
  membership: Pick<IssuerMembershipSummaryVM, 'role' | 'status'>
): boolean {
  return membership.status === 'active' && membership.role === 'admin';
}

/** Conjunto de candidatos, sin duplicados por `issuerReference`. */
export function listTechnicalAdminMemberships(
  issuerContexts: readonly IssuerMembershipSummaryVM[]
): IssuerMembershipSummaryVM[] {
  const seen = new Set<string>();
  const candidates: IssuerMembershipSummaryVM[] = [];

  for (const membership of issuerContexts) {
    if (
      isTechnicalAdminMembership(membership) &&
      !seen.has(membership.issuerReference)
    ) {
      seen.add(membership.issuerReference);
      candidates.push(membership);
    }
  }

  return candidates;
}

/**
 * Candidatos que ademas NO estan autorizados administrativamente: son los que
 * justifican el enlace desde la pantalla de acceso pendiente.
 */
export function listUnauthorizedTechnicalAdminMemberships(
  issuerContexts: readonly IssuerMembershipSummaryVM[]
): IssuerMembershipSummaryVM[] {
  return listTechnicalAdminMemberships(issuerContexts).filter(
    (membership) => membership.issuerAuthorizationStatus !== 'authorized'
  );
}

export type TechnicalIssuerResolution =
  | { kind: 'none' }
  | { kind: 'selection-required' }
  | { kind: 'selected'; membership: IssuerMembershipSummaryVM };

/**
 * Decide que issuer muestra la pagina. SIEMPRE sale del conjunto de candidatos
 * vigente: una seleccion local que ya no es elegible se IGNORA (no se
 * preserva un id arbitrario).
 *
 *   1. seleccion local, si sigue siendo candidata;
 *   2. el unico candidato, si hay exactamente uno;
 *   3. el issuer operativo global, SOLO si es el mismo que un candidato;
 *   4. si no, hay que elegir explicitamente.
 */
export function resolveTechnicalIssuer(input: {
  candidates: readonly IssuerMembershipSummaryVM[];
  localSelectionReference: string | null;
  globalSelectedReference: string | null;
}): TechnicalIssuerResolution {
  const { candidates } = input;

  if (candidates.length === 0) {
    return { kind: 'none' };
  }

  const find = (reference: string | null) =>
    reference === null
      ? undefined
      : candidates.find((candidate) => candidate.issuerReference === reference);

  const local = find(input.localSelectionReference);
  if (local) {
    return { kind: 'selected', membership: local };
  }

  if (candidates.length === 1) {
    return { kind: 'selected', membership: candidates[0] };
  }

  const global = find(input.globalSelectedReference);
  if (global) {
    return { kind: 'selected', membership: global };
  }

  return { kind: 'selection-required' };
}
