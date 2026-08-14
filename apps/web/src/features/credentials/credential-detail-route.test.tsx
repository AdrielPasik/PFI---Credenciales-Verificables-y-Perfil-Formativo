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

const navigationMocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams()
}));

const unusedDocumentUpload = vi.fn(async () => {
  throw new Error('Document upload is not used in this test.');
});

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({
    requestAuthenticated: sessionMocks.requestAuthenticated
  })
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigationMocks.searchParams
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
    // C4a.2: busqueda automatica de un template reutilizable existente.
    // Por default no hay ninguno -- mismo estado que "no se pudo conocer
    // el templateId" (solo queda disponible guardar como reutilizable).
    if (path.includes('/course-templates')) {
      return Promise.resolve([]);
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
    navigationMocks.searchParams = new URLSearchParams();
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
    // C4x: "Universidad Seleccionada" ahora tambien aparece en el campo
    // read-only "Entidad emisora" del editor (curso en borrador), ademas
    // de la fila "Institución emisora" de arriba.
    expect(screen.getAllByText('Universidad Seleccionada').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('did:example:issuer')).toBeTruthy();
    expect(screen.getAllByText('Demo Holder').length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText('holder@example.com · did:example:holder')
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Evidencia documental' })
    ).toBeTruthy();
    // C4y: course no muestra ni carga manual ni explicación técnica
    // permanente sobre evidencia textual.
    expect(
      screen.queryByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeNull();
    expect(screen.queryByText('Base textual para la interpretación asistida')).toBeNull();
    expect(
      screen.getByRole('heading', {
        name: 'Análisis inteligente de la credencial'
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
    expect(screen.queryByText('Consultar último análisis')).toBeNull();
    expect(screen.queryByText('Verificación pública')).toBeNull();
    expect(document.body.textContent).not.toContain('AnalysisRun');
    expect(document.body.textContent).not.toMatch(
      /guardar en base|crear curso reutilizable|agregar al catálogo|IA certificó|IA verificó/i
    );
    expect(document.body.textContent).not.toMatch(
      /F1c|F1d|contrato de detalle|readiness/i
    );
    // +1 respecto a C3c: C4a.2 agrega la busqueda automatica (best-effort)
    // de un template reutilizable existente para esta credencial.
    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(3)
    );
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

    // +1 respecto a C3c: C4a.2 agrega la busqueda automatica de un
    // template reutilizable existente, ademas del PATCH del draft.
    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(4)
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
      detail: {
        ...draftResponse,
        documentEvidence: { currentDocument: uploadResponse }
      },
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
        name: 'Análisis inteligente de la credencial'
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Evidencia documental' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Analizar documento' })
    ).toBeNull();
    expect(screen.queryByText('Verificación pública')).toBeNull();
    expect(screen.queryByText('Consultar último análisis')).toBeNull();
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
    // +1 respecto a C3c: C4a.2 agrega la busqueda automatica de un
    // template reutilizable existente, ademas del upload de evidencia.
    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(4)
    );
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
    // +1 respecto a C3c: C4a.2 agrega la busqueda automatica de un
    // template reutilizable existente.
    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(3)
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
  });

  // C4x: la carga manual de "Contenido textual de respaldo" queda oculta
  // para course/certification (ver institutional-textual-backing.ts), asi
  // que este flujo se sigue probando con un tipo que todavia la usa sin
  // cambios (degree/academic_subject).
  it('submits one textual source and updates only its current snapshot', async () => {
    mockCredentialDetailApi({
      detail: {
        ...draftResponse,
        type: 'degree',
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
    // Sin +1 de C4a.2 aca: la busqueda automatica de template reutilizable
    // solo se dispara para course/certification (este fixture es degree).
    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(3)
    );
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

  // C4x: mismo motivo que el test anterior -- "Fuente textual actual" solo
  // se muestra para tipos que conservan la carga manual de TextEvidence
  // (degree/academic_subject), ya no para course/certification.
  it('reconstructs current text and document evidence together from GET', async () => {
    mockCredentialDetailApi({
      detail: {
        ...draftResponse,
        type: 'degree',
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
    // Sin +1 de C4a.2 aca: la busqueda automatica de template reutilizable
    // solo se dispara para course/certification (este fixture es degree).
    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(2)
    );
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
    // +1 respecto a C3c: C4a.2 agrega la busqueda automatica de un
    // template reutilizable existente.
    await waitFor(() =>
      expect(sessionMocks.requestAuthenticated).toHaveBeenCalledTimes(3)
    );
    expect(sessionMocks.requestAuthenticated).toHaveBeenCalledWith(
      '/issuers/issuer-selected-reference/credentials/credential-internal-reference'
    );
  });

  it('keeps credential and evidence visible when latest analysis fails', async () => {
    sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
      if (path.endsWith('/analysis-runs/latest')) {
        return Promise.reject(new ApiError('private upstream', 'http', 503));
      }
      if (path.includes('/course-templates')) {
        return Promise.resolve([]);
      }
      return Promise.resolve({
        ...draftResponse,
        type: 'degree',
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

  it('does not offer or call the manual document-analysis trigger from issuer detail', async () => {
    sessionMocks.requestAuthenticated.mockImplementation((path: string) => {
      if (path.endsWith('/analysis-runs/latest')) return Promise.resolve(null);
      if (path.endsWith('/analysis-runs/document')) {
        return Promise.reject(new Error('manual trigger must not be called'));
      }
      if (path.includes('/course-templates')) {
        return Promise.resolve([]);
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

    await screen.findByText('Traza generará el análisis automáticamente al emitir la credencial.');
    expect(screen.queryByRole('button', { name: 'Analizar documento' })).toBeNull();
    expect(
      sessionMocks.requestAuthenticated.mock.calls.filter(([path]) =>
        String(path).endsWith('/analysis-runs/document')
      )
    ).toHaveLength(0);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.filter(([path]) =>
        String(path).endsWith('/analysis-runs/latest')
      )
    ).toHaveLength(1);
    expect(
      sessionMocks.requestAuthenticated.mock.calls.some(
        ([path]) => /fastapi|blockchain/i.test(String(path))
      )
    ).toBe(false);
  });
});

describe('CredentialDetailController templateApplyFailed warning (C3c fix)', () => {
  beforeEach(() => {
    sessionMocks.requestAuthenticated.mockReset();
    navigationMocks.searchParams = new URLSearchParams();
  });

  it('shows the warning when redirected with ?templateApply=failed', async () => {
    navigationMocks.searchParams = new URLSearchParams('templateApply=failed');
    mockCredentialDetailApi();

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    expect(
      await screen.findByText(
        'El borrador se creó, pero no pudimos aplicar todos los datos del contenido reutilizable'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Podés completarlos manualmente en el editor.')
    ).toBeTruthy();
  });

  it('does not show the warning when there is no failure query param', async () => {
    mockCredentialDetailApi();

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    await screen.findByRole('heading', { name: 'Arquitectura de Software' });
    expect(
      screen.queryByText(
        'El borrador se creó, pero no pudimos aplicar todos los datos del contenido reutilizable'
      )
    ).toBeNull();
  });

  it('never exposes raw backend detail in the warning', async () => {
    navigationMocks.searchParams = new URLSearchParams('templateApply=failed');
    mockCredentialDetailApi();

    render(
      <CredentialDetailController
        credentialReference="credential-internal-reference"
        membership={membership}
      />
    );

    await screen.findByText(
      'El borrador se creó, pero no pudimos aplicar todos los datos del contenido reutilizable'
    );
    expect(document.body.textContent).not.toMatch(
      /stack|token|payload|templateId|Error:/i
    );
  });
});

describe('CredentialDetailView templateApplyFailed warning (C3c fix)', () => {
  it('renders a warning FeedbackAlert, not an error/danger one', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ type: 'course', status: 'issued' })}
        templateApplyFailed
      />
    );

    const alert = screen.getByText(
      'El borrador se creó, pero no pudimos aplicar todos los datos del contenido reutilizable'
    );
    expect(alert).toBeTruthy();
    // El aviso es no-danger: no debe usar role="alert" (exclusivo de error).
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not render the warning by default', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture()}
      />
    );

    expect(
      screen.queryByText(
        'El borrador se creó, pero no pudimos aplicar todos los datos del contenido reutilizable'
      )
    ).toBeNull();
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

    expect(screen.getAllByText('Arquitectura de Software')).toHaveLength(2);
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

    expect(screen.getAllByText('Arquitectura de Software')).toHaveLength(2);
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

  it('shows a read-only declared course data card for an issued course credential', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          type: 'course',
          typeLabel: 'Curso',
          status: 'issued',
          statusLabel: 'Emitida',
          credentialSubject: {
            platformName: 'Campus Virtual Demo',
            modality: 'Online asincrónica',
            externalUrl: 'https://plataforma-demo.example.com/curso/123',
            skills: []
          }
        })}
      />
    );

    expect(screen.getByText('Datos declarados del curso')).toBeTruthy();
    // C4x: platformName ya no se muestra como campo "Plataforma" principal
    // -- solo como nota legacy de solo lectura.
    expect(screen.queryByText('Plataforma')).toBeNull();
    expect(
      screen.getByText(
        'Plataforma declarada (dato legacy, solo lectura): Campus Virtual Demo'
      )
    ).toBeTruthy();
    expect(screen.getByText('Online asincrónica')).toBeTruthy();
    expect(screen.queryByText('Proveedor')).toBeNull();
    expect(screen.queryByText('Nivel')).toBeNull();
    expect(screen.queryByText('Cloud')).toBeNull();

    const link = screen.getByRole('link', {
      name: 'https://plataforma-demo.example.com/curso/123'
    }) as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noreferrer');
    expect(link.rel).toContain('noopener');
    expect(document.body.textContent).not.toMatch(/verificado por|udemy|coursera|aws/i);
  });

  it('does not show the declared course data card for a draft course credential', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          type: 'course',
          typeLabel: 'Curso',
          status: 'draft',
          statusLabel: 'Borrador',
          credentialSubject: {
            platformName: 'Campus Virtual Demo'
          }
        })}
      />
    );

    expect(screen.queryByText('Datos declarados del curso')).toBeNull();
  });

  it('does not show the declared course data card for an issued academic_subject credential', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          status: 'issued',
          statusLabel: 'Emitida'
        })}
      />
    );

    expect(screen.queryByText('Datos declarados del curso')).toBeNull();
  });
});

function reusableTemplateFixture(overrides: Record<string, unknown> = {}) {
  return {
    reference: 'template-1',
    credentialType: 'course',
    title: 'Curso de Python',
    description: null,
    hours: null,
    modality: null,
    platformName: null,
    externalUrl: null,
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: [],
    learningOutcomes: [],
    status: 'active',
    createdFromCredentialId: 'credential-internal-reference',
    lastSemanticAnalysisId: 'analysis-1',
    approvedSemanticAnalysisId: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    approvedSemanticSnapshotSummary: null,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:00:00.000Z',
    ...overrides
  };
}

function semanticApprovalCandidateFixture(
  overrides: Record<string, unknown> = {}
) {
  return {
    semanticAnalysisReference: 'analysis-1',
    status: 'completed',
    pipelineVersion: 'pipeline-v1',
    taxonomyVersion: 'taxonomy-v1',
    sourceCredentialReference: 'credential-internal-reference',
    areas: [{ label: 'Gestión de Proyectos Tecnológicos', confidence: 0.9 }],
    skills: [{ label: 'Scrum', confidence: 0.8 }],
    concepts: [{ label: 'backlog', confidence: null }],
    warnings: [],
    qualityNotes: ['La asignación de área tiene confianza baja.'],
    summary: {
      schema: 'approved_template_semantic_snapshot_v1',
      status: 'completed',
      areaCount: 2,
      skillCount: 3,
      conceptCount: 1,
      hasHoursDistribution: true,
      warningCount: 0,
      qualityFlagCount: 1
    },
    ...overrides
  };
}

describe('CredentialDetailView C5 reusable semantic review', () => {
  const documentAnalysis = {
    state: {
      latestStatus: 'ready' as const,
      latestError: null,
      triggering: false,
      refreshing: false,
      actionError: null,
      successMessage: null,
      currentRun: {
        analysisRunReference: 'run-1', credentialReference: 'credential-internal-reference',
        status: 'completed' as const, statusLabel: 'Completado', inputMode: 'text' as const,
        inputModeLabel: 'Texto', trigger: 'system' as const, requestedPipelineVersion: 'pipeline-v1',
        requestedTaxonomyVersion: 'taxonomy-v1', sourceCount: 1, sourceTypes: ['text_evidence' as const],
        sourceLabels: ['Información declarada'], createdAt: '2026-08-12T10:00:00.000Z', createdAtLabel: '12 ago 2026',
        startedAt: null, startedAtLabel: null, completedAt: '2026-08-12T10:01:00.000Z', completedAtLabel: '12 ago 2026',
        failedAt: null, failedAtLabel: null, errorCode: null, errorMessage: null,
        semanticAnalysis: { semanticAnalysisReference: 'analysis-1', status: 'partial' as const,
          pipelineVersion: 'pipeline-v1', taxonomyVersion: 'taxonomy-v1', confidence: 0.8,
          confidenceLabel: '80% de confianza', areasCount: 1, skillsCount: 1, conceptsCount: 1,
          qualityFlags: [], qualityFlagLabels: [], analyzedAt: '2026-08-12T10:01:00.000Z', analyzedAtLabel: '12 ago 2026' }
      }
    },
    onRetry: vi.fn(async () => undefined)
  };

  it('keeps draft reusable intent local and does not render a persistence button', () => {
    render(<CredentialDetailView onUploadDocumentEvidence={unusedDocumentUpload} detail={detailFixture({ type: 'course', status: 'draft' })} />);
    expect(screen.getByTestId('reusable-template-intent')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /guardar como reutilizable/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /guardar como .*reutilizable/i })).toBeNull();
  });

  it('shows reviewed values and only persists when the issuer explicitly approves', async () => {
    const onLoadCredentialSemanticApprovalCandidate = vi.fn().mockResolvedValue(semanticApprovalCandidateFixture());
    const onApproveCredentialSemanticAnalysis = vi.fn().mockResolvedValue(reusableTemplateFixture({ approvedSemanticAnalysisId: 'analysis-1' }));
    render(<CredentialDetailView onUploadDocumentEvidence={unusedDocumentUpload} detail={detailFixture({ type: 'course', status: 'issued' })} documentAnalysis={documentAnalysis} onLoadCredentialSemanticApprovalCandidate={onLoadCredentialSemanticApprovalCandidate} onApproveCredentialSemanticAnalysis={onApproveCredentialSemanticAnalysis} />);
    await waitFor(() => expect(onLoadCredentialSemanticApprovalCandidate).toHaveBeenCalledWith('analysis-1'));
    expect(await screen.findByText('Gestión de Proyectos Tecnológicos')).toBeTruthy();
    expect(screen.getByText('Scrum')).toBeTruthy();
    expect(screen.getByText('backlog')).toBeTruthy();
    expect(screen.getByText('La asignación de área tiene confianza baja.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/area_assignment_low_confidence|semantic_quality_low/i);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Scrum' }));
    fireEvent.change(screen.getByLabelText('Agregar habilidades'), { target: { value: 'Kanban' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Agregar' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar interpretación revisada' }));
    await waitFor(() => expect(onApproveCredentialSemanticAnalysis).toHaveBeenCalledWith('analysis-1', expect.objectContaining({ reviewedSkills: [{ label: 'Kanban' }] })));
    expect(await screen.findByText('Interpretación aprobada para reutilización.')).toBeTruthy();
  });

  it('keeps evidence and analysis inside the primary flow, right after declared data, instead of trailing the whole sidebar', async () => {
    const onLoadCredentialSemanticApprovalCandidate = vi.fn().mockResolvedValue(semanticApprovalCandidateFixture());
    render(<CredentialDetailView onUploadDocumentEvidence={unusedDocumentUpload} detail={detailFixture({ type: 'course', status: 'issued' })} documentAnalysis={documentAnalysis} onLoadCredentialSemanticApprovalCandidate={onLoadCredentialSemanticApprovalCandidate} />);
    const mainData = screen.getByRole('heading', { name: 'Registro del logro' });
    const evidence = screen.getByRole('heading', { name: 'Evidencia documental' });
    const issuance = screen.getByRole('heading', { name: 'Emisión de credencial' });
    // La evidencia sigue en el flujo principal, inmediatamente despues de
    // los datos principales -- nunca despues de toda la sidebar (acciones de
    // emision), que ahora es una columna independiente en el grid.
    expect(mainData.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(evidence.compareDocumentPosition(issuance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByTestId('semantic-approval-section')).toBeTruthy();
  });

  it('does not show C5 review controls for academic types', () => {
    render(<CredentialDetailView onUploadDocumentEvidence={unusedDocumentUpload} detail={detailFixture({ type: 'academic_subject', status: 'issued' })} documentAnalysis={documentAnalysis} />);
    expect(screen.queryByTestId('semantic-approval-section')).toBeNull();
  });

  it('never shows a "Verificación pública" action in issuer detail regardless of status', () => {
    const { rerender } = render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ status: 'issued' })}
      />
    );
    expect(screen.queryByRole('link', { name: 'Verificación pública' })).toBeNull();
    expect(screen.queryByText('Verificación pública')).toBeNull();

    rerender(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ status: 'revoked' })}
      />
    );
    expect(screen.queryByRole('link', { name: 'Verificación pública' })).toBeNull();

    rerender(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ status: 'draft' })}
      />
    );
    expect(screen.queryByRole('link', { name: 'Verificación pública' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C4x: dedicated coverage for the domain/UX hardening items.
// ---------------------------------------------------------------------------
describe('CredentialDetailView C4y textual-backing UX', () => {
  it('never shows "Contenido textual de respaldo" for course', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ type: 'course', status: 'draft' })}
      />
    );

    expect(
      screen.queryByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeNull();
    expect(screen.queryByText('Base textual para la interpretación asistida')).toBeNull();
  });

  it('never shows "Contenido textual de respaldo" for certification', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ type: 'certification', status: 'draft' })}
      />
    );

    expect(
      screen.queryByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeNull();
    expect(screen.queryByText('Base textual para la interpretación asistida')).toBeNull();
  });

  it('still shows "Contenido textual de respaldo" for academic_subject (unaffected)', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ type: 'academic_subject', status: 'draft' })}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeTruthy();
    expect(screen.queryByText('Base textual para la interpretación asistida')).toBeNull();
  });

  it('still shows "Contenido textual de respaldo" for degree (unaffected)', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ type: 'degree', status: 'draft' })}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Contenido textual de respaldo' })
    ).toBeTruthy();
  });

  it('does not replace the hidden manual textual flow with a technical backing card', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          type: 'course',
          status: 'draft',
          credentialSubject: { competencies: ['Programación en Python'] }
        })}
      />
    );

    expect(screen.queryByText('Respaldo textual institucional')).toBeNull();
    expect(
      screen.queryByText('Información insuficiente para la interpretación asistida')
    ).toBeNull();
  });

  it('shows the "insufficient declared data" warning for a course with no declared data', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({ type: 'course', status: 'draft' })}
      />
    );

    // La advertencia de emisión sigue siendo útil, pero no se duplica en una
    // tarjeta técnica de evidencia textual.
    expect(
      screen.getAllByText('Información insuficiente para la interpretación asistida').length
    ).toBeGreaterThanOrEqual(1);
  });

  it('never renders prohibited copy after removing the textual-backing notice', () => {
    render(
      <CredentialDetailView
        onUploadDocumentEvidence={unusedDocumentUpload}
        detail={detailFixture({
          type: 'course',
          status: 'draft',
          credentialSubject: { competencies: ['Programación en Python'] }
        })}
      />
    );

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/IA certificó/i);
    expect(text).not.toMatch(/blockchain valida/i);
    expect(text).not.toMatch(/verificado por|udemy|coursera|aws/i);
    expect(text).not.toMatch(/certificación de competencias por IA/i);
    expect(text).not.toMatch(/Base textual para la interpretación asistida/i);
  });
});
