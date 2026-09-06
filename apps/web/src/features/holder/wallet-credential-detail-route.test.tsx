import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mapCredentialDetailError,
  WalletCredentialDetailContent,
  WalletCredentialDetailView
} from '@/features/holder/wallet-credential-detail-route';
import { adaptMyCredential } from '@/lib/adapters/holder.adapter';
import { ApiError, IncompatiblePayloadError } from '@/lib/errors/api-error';
import type { HolderCredentialDetailVM } from '@/models/holder';

const routeMocks = vi.hoisted(() => ({
  credentialReference: 'credential-reference',
  getMyCredentialRequest: vi.fn(),
  requestAuthenticated: vi.fn()
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ credentialId: routeMocks.credentialReference })
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: routeMocks.requestAuthenticated })
}));

vi.mock('@/lib/api/holder-api', () => ({
  getMyCredentialRequest: routeMocks.getMyCredentialRequest
}));

const detail: HolderCredentialDetailVM = {
  credentialReference: 'credential-reference', title: 'Arquitectura de software', type: 'course', typeLabel: 'Curso',
  status: 'issued', statusLabel: 'Emitida', issuerName: 'Institución demo', issuedAtLabel: '1 ago 2026',
  hasIntegrityEvidence: true, hasAnalysis: true, description: null, hoursLabel: null,
  issuerDid: null, holderLabel: 'Titular demo', holderEmail: 'holder@example.com', holderDid: null,
  revokedAtLabel: null, revocationReason: null,
  subject: {
    achievementName: null, institutionName: null, completionDate: null, academicPeriod: null, programName: null, grade: null,
    providerName: null, platformName: null, modality: null, level: null, externalUrl: null,
    skills: ['Diseño'], competencies: [], learningOutcomes: []
  },
  documentEvidence: null, textEvidence: null,
  integrity: { canonicalHash: null, canonicalHashShort: null, canonicalizationVersion: null, records: [] },
  analysis: { status: 'partial', statusLabel: 'Análisis parcial', confidenceLabel: null, areas: ['Software'], skills: [], concepts: [], qualityFlags: ['Información parcial'], analyzedAtLabel: '1 ago 2026' }
};

const courseDetailWithDeclaredData: HolderCredentialDetailVM = {
  ...detail,
  subject: {
    ...detail.subject,
    platformName: 'Campus Virtual Demo',
    modality: 'Online asincrónica',
    externalUrl: 'https://plataforma-demo.example.com/curso/123'
  }
};

const academicSubjectDetail: HolderCredentialDetailVM = {
  ...detail,
  type: 'academic_subject',
  typeLabel: 'Asignatura académica'
};

describe('WalletCredentialDetailContent error recovery', () => {
  beforeEach(() => {
    routeMocks.credentialReference = 'credential-reference';
    routeMocks.getMyCredentialRequest.mockReset();
    routeMocks.requestAuthenticated.mockReset();
  });

  it.each([
    [404, 'No encontramos esta credencial en tu espacio personal.'],
    [403, 'No tenés acceso a esta credencial.']
  ])('maps HTTP %i without offering a misleading retry', async (status, message) => {
    routeMocks.getMyCredentialRequest.mockRejectedValue(
      new ApiError('safe', 'http', status)
    );

    render(<WalletCredentialDetailContent />);

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });

  it.each([
    new ApiError('safe', 'http', 500),
    new ApiError('safe', 'network'),
    new IncompatiblePayloadError()
  ])('shows a safe recoverable state for %s instead of a false 404', async (requestError) => {
    routeMocks.getMyCredentialRequest.mockRejectedValue(requestError);

    render(<WalletCredentialDetailContent />);

    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeTruthy();
    expect(screen.queryByText('No encontramos esta credencial en tu espacio personal.')).toBeNull();
  });

  it('does not classify a surfaced 304 as not found', () => {
    expect(mapCredentialDetailError(new ApiError('safe', 'http', 304))).toEqual({
      title: 'No pudimos cargar la credencial',
      message: 'Volvé a intentar en unos instantes.',
      retryable: true
    });
  });

  it('retries the same holder credential GET and renders a valid Course', async () => {
    routeMocks.getMyCredentialRequest
      .mockRejectedValueOnce(new ApiError('safe', 'network'))
      .mockResolvedValueOnce(detail);

    render(<WalletCredentialDetailContent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { name: 'Arquitectura de software' })).toBeTruthy();
    expect(routeMocks.getMyCredentialRequest).toHaveBeenCalledTimes(2);
    expect(routeMocks.getMyCredentialRequest).toHaveBeenNthCalledWith(
      2,
      routeMocks.requestAuthenticated,
      'credential-reference'
    );
  });

  it('keeps an incompatible payload distinct from not found', async () => {
    routeMocks.getMyCredentialRequest.mockRejectedValue(
      new IncompatiblePayloadError()
    );

    render(<WalletCredentialDetailContent />);

    expect(await screen.findByText('No pudimos cargar correctamente la información de esta credencial')).toBeTruthy();
    expect(screen.queryByText('No encontramos esta credencial en tu espacio personal.')).toBeNull();
  });
});

it('orders holder credential information before secondary integrity evidence', () => {
  render(<WalletCredentialDetailView detail={detail} />);
  const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
  expect(headings).toEqual([
    'Identidad de la credencial',
    'Aporte formativo de esta credencial',
    'Fuentes de respaldo',
    'Evidencia de integridad'
  ]);
  expect(screen.getByText('Información emitida por la institución')).toBeTruthy();
  expect(screen.getByText('Interpretación asistida por IA')).toBeTruthy();
  expect(screen.queryByText('credential-reference')).toBeNull();
});

it('shows declared course data separated from the AI interpretation section', () => {
  render(<WalletCredentialDetailView detail={courseDetailWithDeclaredData} />);

  expect(screen.getByText('Información declarada del curso')).toBeTruthy();
  expect(
    screen.getByText('Estos datos fueron declarados por la institución emisora de la credencial.')
  ).toBeTruthy();
  expect(screen.getByText('Campus Virtual Demo')).toBeTruthy();
  expect(screen.getByText('Online asincrónica')).toBeTruthy();

  const link = screen.getByRole('link', {
    name: 'https://plataforma-demo.example.com/curso/123'
  }) as HTMLAnchorElement;
  expect(link.target).toBe('_blank');
  expect(link.rel).toContain('noreferrer');
  expect(link.rel).toContain('noopener');
  expect(
    screen.getByText('Enlace declarado por la institución emisora. No implica verificación oficial externa.')
  ).toBeTruthy();

  const declaredHeadingIndex = screen.getAllByText(/Información declarada del curso|Interpretación asistida por IA/)
    .map((node) => node.textContent);
  expect(declaredHeadingIndex).toEqual([
    'Información declarada del curso',
    'Interpretación asistida por IA'
  ]);
  expect(document.body.textContent).not.toMatch(/verificado por|udemy|coursera|aws/i);
});

it('does not show declared course data for academic_subject credentials', () => {
  render(<WalletCredentialDetailView detail={academicSubjectDetail} />);

  expect(screen.queryByText('Información declarada del curso')).toBeNull();
});

it('does not show declared course data for a course credential without declared platform fields', () => {
  render(<WalletCredentialDetailView detail={detail} />);

  expect(screen.queryByText('Información declarada del curso')).toBeNull();
});

it('C2c: labels declared hours as official hours and never ties them to a specific skill or area', () => {
  const detailWithHours = { ...detail, hoursLabel: '64 horas' };
  render(<WalletCredentialDetailView detail={detailWithHours} />);

  expect(screen.getByText('Horas oficiales declaradas')).toBeTruthy();
  expect(screen.getByText('64 horas')).toBeTruthy();
  expect(screen.queryByText('Horas')).toBeNull();
  expect(document.body.textContent).not.toMatch(/horas de\s+(software|diseño|arquitectura)/i);
});

// C4a.2: la revision/aprobacion de interpretacion semantica reutilizable es
// exclusivamente issuer-facing (credential-detail-route.tsx). La wallet del
// titular nunca la importa ni la renderiza -- se verifica que no aparezca
// ningun rastro de su copy en ningun escenario de esta vista.
it('never shows issuer-facing semantic approval copy in the holder wallet', () => {
  render(<WalletCredentialDetailView detail={courseDetailWithDeclaredData} />);

  expect(screen.queryByText('Interpretación semántica revisable')).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Aprobar interpretación para reutilización'
    })
  ).toBeNull();
  expect(screen.queryByTestId('semantic-approval-section')).toBeNull();
  expect(document.body.textContent).not.toMatch(
    /aprobar interpretación para reutilización/i
  );
});

it('renders a backend-equivalent issued Course with evidence, semantic descriptors and integrity', () => {
  const backendPayload = {
    id: 'credential-reference',
    title: 'Análisis de datos con Python para negocios',
    type: 'course',
    status: 'issued',
    description: 'Curso aplicado',
    hours: 24,
    issuedAt: '2026-08-01T10:00:00.000Z',
    revokedAt: null,
    revocationReason: null,
    canonicalHash: `0x${'a'.repeat(64)}`,
    canonicalizationVersion: 'canon_v1',
    issuer: { name: 'Plataforma de Cursos Demo', did: 'did:example:course-issuer' },
    subject: {
      displayLabel: 'Titular registrado',
      email: 'holder@example.com',
      did: 'did:example:holder'
    },
    credentialSubject: {
      achievementName: 'Análisis de datos con Python para negocios',
      institutionName: 'Plataforma de Cursos Demo',
      completionDate: '2026-08-01',
      academicPeriod: null,
      programName: null,
      grade: null,
      providerName: 'Proveedor institucional',
      platformName: null,
      modality: 'Virtual',
      level: 'Intermedio',
      externalUrl: null,
      skills: [],
      competencies: ['Aplicar análisis de datos'],
      learningOutcomes: ['Interpretar resultados']
    },
    documentEvidence: {
      originalFileName: 'evidencia.pdf', mimeType: 'application/pdf', sizeBytes: 2048,
      sha256: 'c'.repeat(64), uploadedAt: '2026-08-01T10:15:00.000Z'
    },
    textEvidence: {
      label: 'Contenido declarado', preview: 'Python y decisiones de negocio.', characterCount: 31,
      sha256: 'd'.repeat(64), submittedAt: '2026-08-01T10:20:00.000Z'
    },
    blockchainRecords: [{
      network: 'anvil', chainId: 31337, txHash: `0x${'b'.repeat(64)}`,
      status: 'registered', registeredAt: '2026-08-01T10:05:00.000Z'
    }],
    latestSemanticAnalysis: {
      status: 'completed', confidence: 0.87,
      areas: [{ id: 'area-data', label: 'Datos', confidence: 0.9 }],
      skills: [{ id: 'skill-python', skill: 'Python', confidence: 0.88 }],
      concepts: [{ id: 'concept-business', concept: 'Analítica de negocios' }],
      qualityFlags: [], analyzedAt: '2026-08-01T10:10:00.000Z'
    }
  };

  render(<WalletCredentialDetailView detail={adaptMyCredential(backendPayload)} />);

  expect(screen.getByRole('heading', { name: 'Análisis de datos con Python para negocios' })).toBeTruthy();
  expect(screen.getByText('evidencia.pdf')).toBeTruthy();
  expect(screen.getByText('Datos')).toBeTruthy();
  expect(screen.getByText('Python')).toBeTruthy();
  expect(screen.getByText('Entorno técnico/demo')).toBeTruthy();
  expect(document.body.textContent).not.toContain('area-data');
});

it('shares an issued or revoked holder credential through the public verifier without exposing extra data', () => {
  render(<WalletCredentialDetailView detail={detail} />);

  fireEvent.click(screen.getByRole('button', { name: 'Compartir credencial' }));
  const link = screen.getByRole('link', { name: 'Ver vista pública' });
  expect((link as HTMLAnchorElement).getAttribute('href')).toBe(
    '/verify?credential=credential-reference'
  );
  expect(screen.getByDisplayValue('credential-reference')).toBeTruthy();
  expect(screen.getByText(/No es la huella canónica/i)).toBeTruthy();
});
