// C4b.1b: body de POST .../reusable-semantic-interpretation/apply.
// approvalRevision es la precondicion TOCTOU devuelta por candidate
// (ver toApprovalRevision) -- el servidor SIEMPRE revalida contra el
// estado actual del template server-side, nunca confia en este valor mas
// alla de compararlo. acknowledgeDestinationDrift solo importa cuando
// destinationCompatibility recalculado server-side es 'modified'; nunca
// sortea 'unknown'.
export class ApplyReusableSemanticInterpretationDto {
  templateId!: string;
  approvalRevision!: string;
  acknowledgeDestinationDrift?: boolean;
}
