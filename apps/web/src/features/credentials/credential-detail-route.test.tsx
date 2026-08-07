import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CredentialDetailController,
  CredentialDetailView
} from '@/features/credentials/credential-detail-route';
import { ApiError } from '@/lib/errors/api-error';
import type { IssuerCredentialDetailVM } from '@/models/credentials';

const sessionMocks = vi.hoisted(() => ({
  requestAuthenticated: vi.fn()
}));

const unusedDocumentUpload = vi.fn(async () => {
  throw new Error('Document upload is not used in this test.');
});

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    requestAuthenticated: sessionMocks.requestAuthenticated
  })
}));

const membership = {
  issuerReference: 'issuer-selected-reference',
  issuerName: 'Universidad Seleccionada',
  issuerDid: 'did:example:issuer',
  issuerAuthorizationStatus: 'authorized' as const,
  issuerAuthorizationLabel: 'Autorizada',
  role: 'admin' as const,
  roleLabel: 'Administrador',
  status: 'active' as const,
  operational: true
};

const evidenceHash = 'b'.repeat(64);
const uploadResponse = {
  evidenceReference: 'evidence-internal-reference',
  kind: 'pdf',
  status: 'current',
  originalFileName: 'programa.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 8,
  sha256: evidenceHash,
  uploadedAt: '2026-08-03T12:00:00.000Z'
};
const textEvidenceContent = 'Línea uno\nLínea dos';
const textEvidenceResponse = {
  textEvidenceReference: 'text-evidence-internal-reference',
  status: 'current',
  label: 'Temario institucional',
  content: textEvidenceContent,
  characterCount: Array.from(textEvidenceContent).length,
  sha256: 'c'.repeat(64),
  submittedAt: '2026-08-03T12:00:00.000Z'
};
const analysisTriggerResponse = {
  analysisRunId: 'analysis-run-private-reference',
  credentialId: 'credential-internal-reference',
  status: 'completed',
  semanticAnalysisId: 'semantic-private-reference',
  artifactStatus: 'partial',
  sourceCount: 1,
  completedAt: '2026-08-05T12:00:08.000Z'
};
const analysisRunResponse = {
  analysisRunId: 'analysis-run-private-reference',
  credentialId: 'credential-internal-reference',
  status: 'completed',
  inputMode: 'document',
  trigger: 'manual',
  requestedPipelineVersion: 'pipeline-v1',
  requestedTaxonomyVersion: 'taxonomy-v1',
  sourceCount: 1,
  sourceTypes: ['document_evidence'],
  createdAt: '2026-08-05T12:00:00.000Z',
  startedAt: '2026-08-05T12:00:01.000Z',
  completedAt: '2026-08-05T12:00:08.000Z',
  failedAt: null,
  errorCode: null,
  errorMessage: null,
  semanticAnalysis: {
    semanticAnalysisId: 'semantic-private-reference',
    status: 'partial',
    pipelineVersion: 'pipeline-v1',
    taxonomyVersion: 'taxonomy-v1',
    confidence: null,
    areasCount: 0,
    skillsCount: 0,
    conceptsCount: 0,
    qualityFlags: [],
    analyzedAt: '2026-08-05T12:00:08.000Z'
  }
};

const draftResponse = {
  id: 'credential-internal-reference',
  title: 'Arquitectura de Software',
  description: null,
  hours: null,
  type: 'course',
  sourceType: 'manual_issuer',
  status: 'draft',
  issuedAt: null,
  canonicalHash: null,
  canonicalizationVersion: null,
  blockchainEvidence: null,
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  credentialSubject: {
    achievement_name: 'Arquitectura de Software',
    institution_name: 'Universidad Seleccionada',
    completion_date: null,
    academic_period: null,
    program_name: null,
    grade: null,
    provider_name: null,
    platform_name: null,
    modality: null,
    level: null,
    certification_code: null,
    expiration_date: null,
    external_url: null,
    skills: [],
    competencies: [],
    learning_outcomes: []
  },
  issuer: {
    displayName: 'Universidad Seleccionada',
    did: 'did:example:issuer'
  },
  holder: {
    displayLabel: 'Demo Holder',
    email: 'holder@example.com',
    did: 'did:example:holder'
  },
  academicCourse: null,
  documentEvidence: { currentDocument: null },
  textEvidence: { currentText: null }
};

function detailFixture(
  overrides: Partial<
    Omit<IssuerCredentialDetailVM, 'credentialSubject'>
  > & {
    credentialSubject?: Partial<
      IssuerCredentialDetailVM['credentialSubject']
    >;
  } = {}
): IssuerCredentialDetailVM {
  const credentialSubject: IssuerCredentialDetailVM['credentialSubject'] = {
    achievementName: 'Arquitectura de Software',
    institutionName: 'Universidad Seleccionada',
    completionDate: null,
    academicPeriod: null,
    programName: null,
    grade: null,
    providerName: null,
    platformName: null,
    modality: null,
    level: null,
    certificationCode: null,
    expirationDate: null,
    externalUrl: null,
    skills: [],
    competencies: [],
    learningOutcomes: [],
    ...overrides.credentialSubject
  };

  return {
    credentialReference: 'credential-internal-reference',
    title: 'Arquitectura de Software',
    description: null,
    hours: null,
    type: 'academic_subject',
    typeLabel: 'Asignatura académica',
    status: 'draft',
    statusLabel: 'Borrador',
    issuedAt: null,
    issuedAtLabel: null,
    canonicalHash: null,
    canonicalHashShort: null,
    canonicalizationVersion: null,
    blockchainEvidence: null,
    issuer: {
      displayName: 'Universidad Seleccionada',
      did: 'did:example:issuer'
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder@example.com',
      did: 'did:example:holder'
    },
    academicCourse: null,
    documentEvidence: { currentDocument: null },
    textEvidence: { currentText: null },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    ...overrides,
    credentialSubject
  };
}

function mockCredentialDetailApi({
  detail = draftResponse,
  documentUpload,
  issue,
  latest = null,
  patch,
  textEvidence
}: {
  detail?: unknown;
  documentUpload?: unknown;
  issue?: unknown;
  latest?: unknown;
  patch?: unknown;
  textEvidence?: unknown;
} = {}) {
  sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
    if (path.endsWith('/analysis-runs/latest')) {
      return Promise.resolve(latest);
    }
    if (path.endsWith('/evidence/documents') && documentUpload !== undefined) {
      return Promise.resolve(documentUpload);
    }
    if (path.endsWith('/evidence/texts') && textEvidence !== undefined) {
      return Promise.resolve(textEvidence);
    }
    if (path.endsWith('/draft') && patch !== undefined) {
      return Promise.resolve(patch);
    }
    if (path.endsWith('/issue') && issue !== undefined) {
      return Promise.resolve(issue);
    }
    return Promise.resolve(detail);
  });
}

describe('CredentialDetailController', () => {
  beforeEach(() => {
    sessionMocks.requestAuthenticated.mockReset();
  });

  it('loads the direct URL and latest analysis through issuer-scoped reads', () => {
    sessionMocks.requestAuthenticated.mockReturnValue(
      new Promise(() => undefined)
    );

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(screen.getByText('Cargando borrador')).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(2);
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/analysis-runs/latest'
    );
  });

  it('renders the safe institutional read model without technical IDs or future actions', async () => {
    mockCredentialDetailApi();

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Arquitectura de Software'
      })
    ).toBeTruthy();
    expect(screen.getByText('Borrador')).toBeTruthy();
    expect(screen.getAllByText('Curso').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(screen.getByText('did:example:issuer')).toBeTruthy();
    expect(screen.getByText('Demo Holder')).toBeTruthy();
    expect(
      screen.getByText('holder@example.com · did:example:holder')
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Evidencia de respaldo' })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Análisis inteligente del documento'
      })
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'credential-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'issuer-selected-reference'
    );
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull();
    expect(document.body.textContent).not.toContain('Blockchain');
    expect(document.body.textContent).not.toContain('Análisis IA');
    expect(document.body.textContent).not.toContain('Subir PDF');
    expect(document.body.textContent).not.toMatch(
      /guardar en base|crear curso reutilizable|agregar al catálogo|IA certificó|IA verificó/i
    );
    expect(document.body.textContent).not.toMatch(
      /F1c|F1d|contrato de detalle|readiness/i
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(2);
  });

  it('patches edits through the selected issuer context and accepts the response as truth', async () => {
    mockCredentialDetailApi({
      patch: {
        ...draftResponse,
        description: 'Descripción persistida',
        updatedAt: '2026-07-30T13:00:00.000Z'
      }
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    const description = await screen.findByLabelText('Descripción');
    fireEvent.change(description, {
      target: { value: 'Descripción persistida' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(3)
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/draft',
      {
        method: 'PATCH',
        body: {
          expectedUpdatedAt: '2026-07-30T12:00:00.000Z',
          description: 'Descripción persistida'
        }
      }
    );
    expect(await screen.findByText('Cambios guardados')).toBeTruthy();
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Descripción persistida');
  });

  it('issues once through the issuer-scoped endpoint and keeps analysis visible', async () => {
    const canonicalHash = `0x${'a'.repeat(64)}`;
    mockCredentialDetailApi({
      issue: {
        ...draftResponse,
        status: 'issued',
        issuedAt: '2026-08-06T12:00:00.000Z',
        canonicalHash,
        canonicalizationVersion: 'canon_v1',
        blockchainEvidence: null
      }
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    await screen.findByRole('heading', { name: 'Arquitectura de Software' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Emitir credencial' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Emitir credencial' })
    );

    expect(await screen.findByText('Credencial emitida')).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/issue',
      { method: 'POST' }
    );
    expect(
      sessionMocks.requestAuthenticated.mock.calls.filter(([path]) =>
        String(path).endsWith('/issue')
      )
    ).toHaveLength(1);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.filter(([path]) =>
        String(path).endsWith('/analysis-runs/latest')
      )
    ).toHaveLength(2);
    expect(
      screen.getByRole('heading', {
        name: 'Análisis inteligente del documento'
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Evidencia documental' })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Analizar documento' })
    ).toBeNull();
  });

  it('uploads one multipart document and updates only the current evidence snapshot', async () => {
    mockCredentialDetailApi({ documentUpload: uploadResponse });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    const input = (await screen.findByLabelText(
      'Seleccionar archivo de evidencia'
    )) as HTMLInputElement;
    const file = new File(['document'], 'programa.pdf', {
      type: 'application/pdf'
    });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Subir evidencia' }));

    expect(await screen.findByText('Evidencia actual')).toBeTruthy();
    expect(screen.getByText('programa.pdf')).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(3);
    const [path, options] = sessionMocks.requestAuthenticated.mock.calls.find(
      ([pathValue]) => String(pathValue).endsWith('/evidence/documents')
    )!;
    expect(path).toBe(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/evidence/documents'
    );
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    expect(Array.from((options.body as FormData).entries())).toEqual([
      ['file', file]
    ]);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(
        ([, requestOptions]) => requestOptions?.method === 'PATCH'
      )
    ).toBe(false);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(([pathValue]) =>
        String(pathValue).match(/\/ai(?:\/|$)|\/issue(?:\/|$)|blockchain/i)
      )
    ).toBe(false);
    expect(screen.getByRole('heading', { name: draftResponse.title })).toBeTruthy();
  });

  it('reconstructs current evidence from the issuer read model on direct load', async () => {
    mockCredentialDetailApi({
      detail: {
        ...draftResponse,
        documentEvidence: { currentDocument: uploadResponse }
      }
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(await screen.findByText('Evidencia actual')).toBeTruthy();
    expect(screen.getByText('programa.pdf')).toBeTruthy();
    expect(screen.getByText('Documento PDF')).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(2);
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
  });

  it('submits one textual source and updates only its current snapshot', async () => {
    mockCredentialDetailApi({
      detail: {
        ...draftResponse,
        documentEvidence: { currentDocument: uploadResponse }
      },
      textEvidence: textEvidenceResponse
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    fireEvent.change(
      await screen.findByLabelText('Nombre de la fuente (opcional)'),
      { target: { value: '  Temario institucional  ' } }
    );
    fireEvent.change(screen.getByLabelText('Contenido de respaldo'), {
      target: { value: '  Línea uno\r\nLínea dos  ' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar evidencia textual' })
    );

    expect(await screen.findByText('Fuente textual actual')).toBeTruthy();
    expect(
      screen.getByLabelText('Contenido de la fuente textual').textContent
    ).toBe(textEvidenceContent);
    expect(screen.getByText('programa.pdf')).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(3);
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/evidence/texts',
      {
        method: 'POST',
        body: {
          content: textEvidenceContent,
          label: 'Temario institucional'
        }
      }
    );
    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(
        ([, requestOptions]) => requestOptions?.method === 'PATCH'
      )
    ).toBe(false);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(([pathValue]) =>
        String(pathValue).match(/\/ai(?:\/|$)|\/issue(?:\/|$)|blockchain/i)
      )
    ).toBe(false);
  });

  it('reconstructs current text and document evidence together from GET', async () => {
    mockCredentialDetailApi({
      detail: {
        ...draftResponse,
        documentEvidence: { currentDocument: uploadResponse },
        textEvidence: { currentText: textEvidenceResponse }
      }
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(await screen.findByText('Fuente textual actual')).toBeTruthy();
    expect(
      screen.getByLabelText('Contenido de la fuente textual').textContent
    ).toBe(textEvidenceContent);
    expect(screen.getByText('Evidencia actual')).toBeTruthy();
    expect(screen.getByText('programa.pdf')).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(2);
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
  });

  it('loads the curriculum-scoped catalog through the authenticated controller boundary', async () => {
    sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
      if (path.endsWith('/analysis-runs/latest')) {
        return Promise.resolve(null);
      }
      if (path.endsWith('/catalog/academic-programs?query=1621&limit=20')) {
        return Promise.resolve({
          items: [
            {
              programReference: 'program-reference',
              programCode: '1621',
              programName: 'Ingeniería en Informática',
              curriculumReference: 'curriculum-reference',
              curriculumCode: '2026'
            }
          ]
        });
      }

      if (path.includes('/curriculum-versions/curriculum-reference/')) {
        return Promise.resolve({
          items: [
            {
              academicCourseReference: 'course-reference',
              code: '3.4.213',
              name: 'Ingeniería de Datos II',
              description: null,
              hours: null,
              programReference: 'program-reference',
              programCode: '1621',
              programName: 'Ingeniería en Informática',
              curriculumReference: 'curriculum-reference',
              curriculumCode: '2026'
            }
          ]
        });
      }

      return Promise.resolve({
        ...draftResponse,
        type: 'academic_subject',
        academicCourse: null
      });
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    fireEvent.change(
      await screen.findByLabelText('Buscar carrera o plan académico'),
      { target: { value: '1621' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Buscar carrera' }));
    fireEvent.click(await screen.findByText('Ingeniería en Informática'));
    fireEvent.change(screen.getByLabelText('Buscar materia de la carrera'), {
      target: { value: 'Datos' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar materia' }));
    fireEvent.click(await screen.findByText('Ingeniería de Datos II'));

    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/catalog/academic-programs?query=1621&limit=20',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/catalog/curriculum-versions/curriculum-reference/academic-subjects?query=Datos&limit=20',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(await screen.findByText('Selección pendiente')).toBeTruthy();
  });

  it('shows a controlled 404', async () => {
    sessionMocks.requestAuthenticated.mockImplementation((path: string) =>
      path.endsWith('/analysis-runs/latest')
        ? Promise.resolve(null)
        : Promise.reject(new ApiError('private upstream detail', 'http', 404))
    );

    render(
      <CredentialDetailController
        credentialReference="missing-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByText('No encontramos la credencial solicitada.')
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'private upstream detail'
    );
  });

  it('presents discrepancies without issuing a corrective request', async () => {
    mockCredentialDetailApi({
      detail: {
        ...draftResponse,
        credentialSubject: {
          ...draftResponse.credentialSubject,
          achievement_name: 'Arquitectura Aplicada',
          institution_name: 'Institución Histórica'
        }
      }
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByText(
        'La institución registrada en el borrador no coincide con el contexto institucional actual.'
      )
    ).toBeTruthy();
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(2);
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
  });

  it('keeps credential and evidence visible when latest analysis fails', async () => {
    sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
      if (path.endsWith('/analysis-runs/latest')) {
        return Promise.reject(new ApiError('private upstream', 'http', 503));
      }
      return Promise.resolve({
        ...draftResponse,
        documentEvidence: { currentDocument: uploadResponse },
        textEvidence: { currentText: textEvidenceResponse }
      });
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(await screen.findByText('programa.pdf')).toBeTruthy();
    expect(screen.getByText('Fuente textual actual')).toBeTruthy();
    expect(
      await screen.findByText(
        'No pudimos consultar el estado del análisis. El resto de la credencial sigue disponible.'
      )
    ).toBeTruthy();
  });

  it('triggers once and reads the exact created run instead of latest', async () => {
    sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
      if (path.endsWith('/analysis-runs/latest')) return Promise.resolve(null);
      if (path.endsWith('/analysis-runs/document')) {
        return Promise.resolve(analysisTriggerResponse);
      }
      if (path.endsWith('/analysis-runs/analysis-run-private-reference')) {
        return Promise.resolve(analysisRunResponse);
      }
      return Promise.resolve({
        ...draftResponse,
        documentEvidence: { currentDocument: uploadResponse }
      });
    });

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    const trigger = await screen.findByRole('button', {
      name: 'Analizar documento'
    });
    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(await screen.findByText('Habilidades detectadas')).toBeTruthy();
    expect(screen.getByText('No informada')).toBeTruthy();
    expect(
      sessionMocks.requestAuthenticated.mock.calls.filter(([path]) =>
        String(path).endsWith('/analysis-runs/document')
      )
    ).toHaveLength(1);
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference/analysis-runs/analysis-run-private-reference'
    );
    expect(
      sessionMocks.requestAuthenticated.mock.calls.filter(([path]) =>
        String(path).endsWith('/analysis-runs/latest')
      )
    ).toHaveLength(1);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(
        ([path]) => /fastapi|blockchain|\/issue(?:\/|$)/i.test(String(path))
      )
    ).toBe(false);
  });
});

describe('CredentialDetailView institutional consistency', () => {
  it('shows one institution when issuer and draft values match after trim', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          credentialSubject: {
            institutionName: '  Universidad Seleccionada  '
          }
        })}
      />
    );

    expect(screen.getAllByText('Universidad Seleccionada')).toHaveLength(1);
    expect(
      screen.queryByText(/institución registrada en el borrador no coincide/i)
    ).toBeNull();
  });

  it('uses issuer displayName without warning when draft institution is null', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          credentialSubject: { institutionName: null }
        })}
      />
    );

    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(
      screen.queryByText(/institución registrada en el borrador no coincide/i)
    ).toBeNull();
  });

  it('shows an honest fallback when the issuer DID is unavailable', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          issuer: {
            displayName: 'Universidad Seleccionada',
            did: null
          }
        })}
      />
    );

    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(screen.getByText('DID institucional no disponible')).toBeTruthy();
  });

  it('keeps issuer displayName authoritative and warns about a different draft institution', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          credentialSubject: {
            institutionName: 'Institución Histórica'
          }
        })}
      />
    );

    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(
      screen.getByText(
        'La institución registrada en el borrador no coincide con el contexto institucional actual.'
      )
    ).toBeTruthy();
    expect(screen.getByText(/Institución registrada en el borrador:/)).toBeTruthy();
    expect(screen.getByText('Institución Histórica')).toBeTruthy();
  });

  it('does not duplicate the title when the draft achievement matches', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          credentialSubject: {
            achievementName: '  Arquitectura de Software  '
          }
        })}
      />
    );

    expect(screen.getAllByText('Arquitectura de Software')).toHaveLength(1);
    expect(
      screen.queryByText(/nombre registrado en el borrador no coincide/i)
    ).toBeNull();
  });

  it('keeps title usable without a draft achievement name', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          credentialSubject: { achievementName: null }
        })}
      />
    );

    expect(screen.getByText('Arquitectura de Software')).toBeTruthy();
    expect(
      screen.queryByText(/nombre registrado en el borrador no coincide/i)
    ).toBeNull();
  });

  it('keeps title authoritative and warns about a different draft achievement name', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          credentialSubject: {
            achievementName: 'Arquitectura Aplicada'
          }
        })}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Arquitectura de Software' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'El nombre registrado en el borrador no coincide con el título principal de la credencial.'
      )
    ).toBeTruthy();
    expect(screen.getByText(/Nombre registrado en el borrador:/)).toBeTruthy();
    expect(screen.getByText('Arquitectura Aplicada')).toBeTruthy();
  });
});

describe('CredentialDetailView read-only states', () => {
  it('represents a non-draft state without inventing later controls', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          status: 'issued',
          statusLabel: 'Emitida',
          credentialSubject: {
            achievementName: null,
            institutionName: null
          },
          holder: {
            displayLabel: 'Demo Holder',
            email: null,
            did: null
          }
        })}
      />
    );

    expect(screen.getByText('Emitida')).toBeTruthy();
    expect(screen.getByText('Universidad Seleccionada')).toBeTruthy();
    expect(screen.getByText('Email no disponible · DID no disponible')).toBeTruthy();
    expect(
      screen.getByText(
        'Esta credencial está disponible en modo lectura. Las acciones para este estado todavía no están disponibles.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emitir' })).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /F1c|F1d|contrato de detalle|readiness/i
    );
  });

  it.each([
    ['issued', 'Emitida'],
    ['revoked', 'Revocada']
  ] as const)('does not render the draft editor for %s', (status, statusLabel) => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ status, statusLabel })}
        draftEditor={{
          issuerReference: 'issuer-selected-reference',
          onSave: vi.fn(),
          onReloadLatest: vi.fn(),
          searchPrograms: vi.fn().mockResolvedValue([]),
          searchSubjects: vi.fn().mockResolvedValue([]),
          onTerminalError: vi.fn()
        }}
      />
    );

    expect(screen.queryByLabelText('Nombre del logro')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  });
});
