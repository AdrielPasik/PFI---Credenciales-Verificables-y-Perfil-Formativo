import {
  adaptMyCredential,
  adaptMyCredentials,
  adaptMyCurrentProfile
} from '@/lib/adapters/holder.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';
import {
  credentialDetailPayload,
  credentialDetailTorturePayload,
  credentialListPayload,
  credentialSummaryPayload,
  currentProfilePayload,
  legacyProfilePayload,
  LONG_DID,
  LONG_HASH,
  LONG_TEXT_500
} from '@/test/fixtures';

describe('adaptMyCredentials', () => {
  it('adapta los cuatro tipos de credencial que puede recibir un titular', () => {
    const credentials = adaptMyCredentials(credentialListPayload());

    expect(credentials.map((credential) => credential.type)).toEqual([
      'academic_subject',
      'course',
      'certification',
      'degree'
    ]);
    expect(credentials.map((credential) => credential.typeLabel)).toEqual([
      'Asignatura académica',
      'Curso',
      'Certificación',
      'Título académico'
    ]);
  });

  it('distingue emitida de revocada con etiqueta de texto, no sólo estado', () => {
    const credentials = adaptMyCredentials(credentialListPayload());

    expect(credentials[0]?.statusLabel).toBe('Emitida');
    expect(credentials[1]?.status).toBe('revoked');
    expect(credentials[1]?.statusLabel).toBe('Revocada');
  });

  it('acepta issuedAt nulo sin romper', () => {
    const credentials = adaptMyCredentials([
      credentialSummaryPayload({ issuedAt: null })
    ]);

    expect(credentials[0]?.issuedAtLabel).toBeNull();
  });

  it('rechaza un tipo de credencial desconocido en vez de mostrarlo crudo', () => {
    expect(() =>
      adaptMyCredentials([credentialSummaryPayload({ type: 'diploma_raro' })])
    ).toThrow(IncompatiblePayloadError);
  });

  it('rechaza un estado desconocido', () => {
    expect(() =>
      adaptMyCredentials([credentialSummaryPayload({ status: 'draft' })])
    ).toThrow(IncompatiblePayloadError);
  });

  it('informa la ruta exacta del campo incompatible', () => {
    try {
      adaptMyCredentials([credentialSummaryPayload({ hasAnalysis: 'si' })]);
      throw new Error('debería haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatiblePayloadError);
      expect((error as IncompatiblePayloadError).diagnostic).toEqual({
        path: 'credentials[0].hasAnalysis',
        expected: 'boolean',
        actualCategory: 'string'
      });
    }
  });
});

describe('adaptMyCredential', () => {
  it('conserva contenido declarado de 500 caracteres sin truncarlo', () => {
    const detail = adaptMyCredential(credentialDetailPayload());

    expect(detail.subject.competencies[0]).toHaveLength(500);
    expect(detail.subject.competencies[0]).toBe(LONG_TEXT_500);
    expect(detail.subject.learningOutcomes[0]).toHaveLength(500);
  });

  it('conserva el hash canónico completo y expone además una versión corta', () => {
    const detail = adaptMyCredential(credentialDetailPayload());

    expect(detail.integrity.canonicalHash).toBe(LONG_HASH);
    expect(detail.integrity.canonicalHashShort).toContain('...');
    expect(detail.integrity.canonicalHashShort!.length).toBeLessThan(
      LONG_HASH.length
    );
  });

  it('conserva un DID largo íntegro', () => {
    const detail = adaptMyCredential(credentialDetailPayload());

    expect(detail.issuerDid).toBe(LONG_DID);
  });

  it('conserva el txHash completo para poder copiarlo', () => {
    const detail = adaptMyCredential(credentialDetailPayload());

    expect(detail.integrity.records[0]?.txHash).toBe(LONG_HASH);
    expect(detail.integrity.records[0]?.txHashShort).toContain('...');
  });

  it('normaliza el email del titular a minúsculas', () => {
    const detail = adaptMyCredential(credentialDetailPayload());

    expect(detail.holderEmail).toBe('titular@example.com');
  });

  it('acepta descriptores semánticos como objeto y como string', () => {
    const detail = adaptMyCredential(credentialDetailTorturePayload());

    expect(detail.analysis?.areas).toEqual(['Redes de computadoras']);
    expect(detail.analysis?.skills).toEqual(['Configuración de routers']);
    expect(detail.analysis?.concepts).toEqual([
      'Modelo OSI',
      'Direccionamiento IP'
    ]);
  });

  it('acepta alias históricos snake_case en credentialSubject', () => {
    const detail = adaptMyCredential(credentialDetailTorturePayload());

    expect(detail.subject.institutionName).toBe('Instituto Ejemplo');
    expect(detail.subject.academicPeriod).toBe('2025');
    expect(detail.subject.programName).toBe('Tecnicatura en Redes');
    expect(detail.subject.externalUrl).toBe(
      'https://cursos.example.org/redes'
    );
    expect(detail.subject.learningOutcomes[0]).toHaveLength(500);
  });

  it('tolera evidencia documental y textual ausentes del payload', () => {
    const detail = adaptMyCredential(credentialDetailTorturePayload());

    expect(detail.documentEvidence).toBeNull();
    expect(detail.textEvidence).toBeNull();
  });

  it('tolera evidencia declarada explícitamente como null', () => {
    const detail = adaptMyCredential(
      credentialDetailPayload({ documentEvidence: null, textEvidence: null })
    );

    expect(detail.documentEvidence).toBeNull();
    expect(detail.textEvidence).toBeNull();
  });

  it('no muestra skills declaradas en una credencial de curso', () => {
    const detail = adaptMyCredential(credentialDetailTorturePayload());

    expect(detail.type).toBe('course');
    expect(detail.subject.skills).toEqual([]);
  });

  it('derivada hasAnalysis y hasIntegrityEvidence del propio detalle', () => {
    const withoutEvidence = adaptMyCredential(
      credentialDetailPayload({
        blockchainRecords: [],
        latestSemanticAnalysis: null
      })
    );

    expect(withoutEvidence.hasIntegrityEvidence).toBe(false);
    expect(withoutEvidence.hasAnalysis).toBe(false);
    expect(withoutEvidence.analysis).toBeNull();
  });

  it('etiqueta el análisis parcial como parcial', () => {
    const detail = adaptMyCredential(credentialDetailPayload());

    expect(detail.analysis?.status).toBe('partial');
    expect(detail.analysis?.statusLabel).toBe('Análisis parcial');
    expect(detail.analysis?.confidenceLabel).toBe('62% de confianza');
  });

  it('no inventa confianza cuando el backend no la provee', () => {
    const detail = adaptMyCredential(credentialDetailTorturePayload());

    expect(detail.analysis?.confidenceLabel).toBeNull();
  });

  it('humaniza los quality flags sin perder los desconocidos', () => {
    const detail = adaptMyCredential(
      credentialDetailPayload({
        latestSemanticAnalysis: {
          status: 'completed',
          confidence: 0.9,
          areas: [],
          skills: [],
          concepts: [],
          qualityFlags: ['low_evidence', 'flag_totalmente_nuevo'],
          analyzedAt: '2026-03-15T12:00:00.000Z'
        }
      })
    );

    expect(detail.analysis?.qualityFlags).toEqual([
      'evidencia limitada',
      'flag totalmente nuevo'
    ]);
  });

  it('rechaza una URL externa que no sea http(s)', () => {
    expect(() =>
      adaptMyCredential(
        credentialDetailPayload({
          type: 'course',
          credentialSubject: {
            ...(credentialDetailPayload().credentialSubject as object),
            externalUrl: 'javascript:alert(1)'
          }
        })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('rechaza un hash canónico con formato inválido', () => {
    expect(() =>
      adaptMyCredential(credentialDetailPayload({ canonicalHash: '0x123' }))
    ).toThrow(IncompatiblePayloadError);
  });

  it('rechaza más de 30 entradas declaradas', () => {
    const subject = credentialDetailPayload().credentialSubject as Record<
      string,
      unknown
    >;

    expect(() =>
      adaptMyCredential(
        credentialDetailPayload({
          credentialSubject: {
            ...subject,
            competencies: Array.from({ length: 31 }, (_, i) => `Item ${i}`)
          }
        })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('rechaza una entrada declarada de más de 500 caracteres', () => {
    const subject = credentialDetailPayload().credentialSubject as Record<
      string,
      unknown
    >;

    expect(() =>
      adaptMyCredential(
        credentialDetailPayload({
          credentialSubject: {
            ...subject,
            competencies: ['x'.repeat(501)]
          }
        })
      )
    ).toThrow(IncompatiblePayloadError);
  });

  it('adapta una credencial revocada conservando su contenido', () => {
    const detail = adaptMyCredential(
      credentialDetailPayload({
        status: 'revoked',
        revokedAt: '2026-05-01T10:00:00.000Z',
        revocationReason: 'Error administrativo en la carga.'
      })
    );

    expect(detail.status).toBe('revoked');
    expect(detail.statusLabel).toBe('Revocada');
    expect(detail.revokedAtLabel).not.toBeNull();
    expect(detail.revocationReason).toBe('Error administrativo en la carga.');
    // El contenido formativo sigue disponible: revocada no es "oculta".
    expect(detail.subject.competencies).toHaveLength(1);
  });
});

describe('adaptMyCurrentProfile', () => {
  it('devuelve null cuando todavía no hay perfil (no es un error)', () => {
    expect(adaptMyCurrentProfile({ currentProfile: null })).toBeNull();
  });

  it('adapta el perfil vigente completo', () => {
    const profile = adaptMyCurrentProfile(currentProfilePayload());

    expect(profile?.credentialsCount).toBe(4);
    expect(profile?.totalOfficialHoursLabel).toBe(
      '240 horas oficiales declaradas'
    );
    expect(profile?.areas[0]?.label).toBe('Infraestructura');
    expect(profile?.areas[0]?.estimatedHoursLabel).toBe(
      '120 horas estimadas por IA'
    );
    expect(profile?.skills[0]?.confidenceLabel).toBe('71% de confianza');
    expect(profile?.concepts).toEqual([
      'Planificación de procesos',
      'Modelo OSI'
    ]);
  });

  it('construye los avisos de cobertura con la pluralización correcta', () => {
    const profile = adaptMyCurrentProfile(currentProfilePayload());

    expect(profile?.hoursCoverageNoticeLabel).toBe(
      '1 credencial no informa horas.'
    );
    expect(profile?.semanticCoverageNoticeLabel).toBe(
      '2 credenciales todavía no tienen análisis semántico.'
    );
    expect(profile?.reviewedInterpretationNoticeLabel).toBe(
      '1 credencial cuenta con una interpretación revisada por el emisor.'
    );
  });

  it('no muestra aviso de cobertura cuando el contador es cero', () => {
    const profile = adaptMyCurrentProfile(
      currentProfilePayload({
        credentialsWithoutHours: 0,
        credentialsWithoutSemanticCoverage: 0,
        credentialsWithReviewedInterpretation: 0
      })
    );

    expect(profile?.hoursCoverageNoticeLabel).toBeNull();
    expect(profile?.semanticCoverageNoticeLabel).toBeNull();
    expect(profile?.reviewedInterpretationNoticeLabel).toBeNull();
  });

  it('conserva competencias declaradas de 500 caracteres', () => {
    const profile = adaptMyCurrentProfile(currentProfilePayload());

    expect(profile?.emittedCompetencies[0]).toHaveLength(500);
    expect(profile?.emittedLearningOutcomes[0]).toBe(LONG_TEXT_500);
  });

  it('proyecta la procedencia como lenguaje de producto, no como enums', () => {
    const profile = adaptMyCurrentProfile(currentProfilePayload());

    expect(profile?.areas[0]?.provenance).toEqual({
      issuerReviewedLabel: 'Revisado por el emisor',
      aiInferredLabel: '2 aportes interpretados con IA'
    });
    expect(profile?.areas[1]?.provenance).toBeNull();
    expect(profile?.skills[0]?.provenance).toEqual({
      issuerReviewedLabel: null,
      aiInferredLabel: 'Interpretado con IA'
    });
  });

  it('degrada una procedencia malformada a null sin tirar abajo el perfil', () => {
    const payload = currentProfilePayload();
    const currentProfile = payload.currentProfile as Record<string, unknown>;
    const areas = currentProfile.areas as Record<string, unknown>[];
    areas[0]!.provenanceSummary = { issuerReviewedCount: 'muchos' };

    const profile = adaptMyCurrentProfile(payload);

    expect(profile).not.toBeNull();
    expect(profile?.areas[0]?.provenance).toBeNull();
  });

  it('lee un perfil histórico con areasSummary, skillsSummary y profileJson', () => {
    const profile = adaptMyCurrentProfile(legacyProfilePayload());

    expect(profile?.totalOfficialHoursLabel).toBe(
      '80 horas oficiales declaradas'
    );
    expect(profile?.areas[0]?.label).toBe('Infraestructura');
    expect(profile?.skills[0]?.label).toBe('Administración de sistemas');
    expect(profile?.concepts).toEqual(['Sistemas operativos']);
    expect(profile?.narrative).toBe('Perfil generado por una versión anterior.');
    expect(profile?.confidenceLabel).toBe('40% de confianza');
    // Ausentes en un perfil viejo: nunca se fabrica un aviso.
    expect(profile?.hoursCoverageNoticeLabel).toBeNull();
    expect(profile?.semanticCoverageNoticeLabel).toBeNull();
  });

  it('acepta emittedCompetencies como descriptores con label', () => {
    const profile = adaptMyCurrentProfile(legacyProfilePayload());

    expect(profile?.emittedCompetencies[0]).toHaveLength(500);
  });

  it('trata los campos emitted ausentes como listas vacías', () => {
    const payload = currentProfilePayload();
    const currentProfile = payload.currentProfile as Record<string, unknown>;
    delete currentProfile.emittedSkills;
    delete currentProfile.emittedCompetencies;
    delete currentProfile.emittedLearningOutcomes;

    const profile = adaptMyCurrentProfile(payload);

    expect(profile?.emittedSkills).toEqual([]);
    expect(profile?.emittedCompetencies).toEqual([]);
    expect(profile?.emittedLearningOutcomes).toEqual([]);
  });

  it('rechaza un campo emitted presente pero inválido', () => {
    expect(() =>
      adaptMyCurrentProfile(currentProfilePayload({ emittedSkills: 42 }))
    ).toThrow(IncompatiblePayloadError);
  });

  it('rechaza una confianza fuera del rango 0..1', () => {
    expect(() =>
      adaptMyCurrentProfile(currentProfilePayload({ confidence: 1.4 }))
    ).toThrow(IncompatiblePayloadError);
  });

  it('no cae al alias histórico cuando el campo vigente vino null', () => {
    const profile = adaptMyCurrentProfile(
      currentProfilePayload({ totalOfficialHours: null, totalHours: 999 })
    );

    expect(profile?.totalOfficialHoursLabel).toBeNull();
  });
});
