import { type IssuerReadinessResult } from '../issuers/issuer-readiness';
import { type AdminIssuerTechnicalIdentityDto } from './dto/admin-issuer-summary-response.dto';

/**
 * Proyeccion de la readiness UNICA a los campos del panel de admin -- S8c9.
 *
 * Los tres campos historicos se conservan con su nombre y su tipo porque el web
 * los exige, pero salen del modelo tecnico final. Ninguno se deriva de
 * `Issuer.did` ni de `Issuer.walletAddress`.
 */
export function projectAdminIssuerReadiness(
  readiness: IssuerReadinessResult
): AdminIssuerTechnicalIdentityDto {
  return {
    didConfigured: readiness.compatibility.didConfigured,
    walletConfigured: readiness.compatibility.walletConfigured,
    readyToIssue: readiness.readyToIssue,
    administrativelyAuthorized: readiness.administrativelyAuthorized,
    configurationReady: readiness.configurationReady,
    hasCredentialCapabilities: readiness.hasCredentialCapabilities
  };
}
