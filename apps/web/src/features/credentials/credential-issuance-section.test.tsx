import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CredentialIssuanceSection } from '@/features/credentials/credential-issuance-section';
import { ApiError } from '@/lib/errors/api-error';
import type {
  DocumentEvidenceVM,
  IssuerCredentialDetailVM,
  TextEvidenceVM
} from '@/models/credentials';

function pdfEvidenceFixture(): DocumentEvidenceVM {
  return {
    evidenceReference: 'document-private-reference',
    kind: 'pdf',
    status: 'current',
    originalFileName: 'respaldo.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    sizeLabel: '10 bytes',
    sha256: 'a'.repeat(64),
    sha256Short: 'aaaaaaaaaaaa…aaaaaaaa',
    uploadedAt: '2026-08-05T12:00:00.000Z',
    uploadedAtLabel: '5 ago 2026, 09:00'
  };
}

function textEvidenceFixture(): TextEvidenceVM {
  return {
    textEvidenceReference: 'text-private-reference',
    status: 'current',
    label: 'Temario',
    content: 'Contenido institucional',
    characterCount: 23,
    characterCountLabel: '23 caracteres',
    sha256: 'b'.repeat(64),
    sha256Short: 'bbbbbbbbbbbb…bbbbbbbb',
    submittedAt: '2026-08-05T12:00:00.000Z',
    submittedAtLabel: '5 ago 2026, 09:00'
  };
}

function detailFixture(
  overrides: Partial<IssuerCredentialDetailVM> = {}
): IssuerCredentialDetailVM {
  return {
    credentialReference: 'credential-private-reference',
    title: 'Arquitectura de Software',
    description: null,
    hours: null,
    type: 'course',
    typeLabel: 'Curso',
    status: 'draft',
    statusLabel: 'Borrador',
    issuer: { displayName: 'Universidad Demo', did: null },
    holder: {
      displayLabel: 'Titular Demo',
      email: 'holder@example.com',
      did: null
    },
    credentialSubject: {
      achievementName: 'Arquitectura de Software',
      institutionName: 'Universidad Demo',
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
      learningOutcomes: []
    },
    academicCourse: null,
    documentEvidence: { currentDocument: null },
    textEvidence: { currentText: null },
    issuedAt: null,
    issuedAtLabel: null,
    canonicalHash: null,
    canonicalHashShort: null,
    canonicalizationVersion: null,
    blockchainEvidence: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    updatedAt: '2026-08-05T12:00:00.000Z',
    ...overrides
  };
}

function draftWithPdf() {
  return detailFixture({
    documentEvidence: { currentDocument: pdfEvidenceFixture() }
  });
}

function issuedFixture(
  overrides: Partial<IssuerCredentialDetailVM> = {}
) {
  const canonicalHash = `0x${'a'.repeat(64)}`;
  const txHash = `0x${'b'.repeat(64)}`;

  return detailFixture({
    status: 'issued',
    statusLabel: 'Emitida',
    issuedAt: '2026-08-06T12:00:00.000Z',
    issuedAtLabel: '6 ago 2026, 09:00',
    canonicalHash,
    canonicalHashShort: `${canonicalHash.slice(0, 12)}…${canonicalHash.slice(-8)}`,
    canonicalizationVersion: 'canon_v1',
    blockchainEvidence: {
      network: 'anvil',
      networkLabel: 'Entorno técnico/demo',
      chainId: 31337,
      txHash,
      txHashShort: `${txHash.slice(0, 12)}…${txHash.slice(-8)}`,
      status: 'registered',
      statusLabel: 'Registrada',
      registeredAt: '2026-08-06T12:00:02.000Z',
      registeredAtLabel: '6 ago 2026, 09:00',
    },
    ...overrides
  });
}

describe('CredentialIssuanceSection', () => {
  it('asks for confirmation and cancel does not issue', () => {
    const onIssue = vi.fn();
    render(
      <CredentialIssuanceSection detail={draftWithPdf()} onIssue={onIssue} />
    );

    expect(screen.getByText('Emisión de credencial')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    expect(screen.getByText('Confirmar emisión')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onIssue).not.toHaveBeenCalled();
    expect(screen.queryByText('Confirmar emisión')).toBeNull();
  });

  it('issues once, shows loading and replaces the draft with the issued snapshot', async () => {
    let resolveIssue: ((detail: IssuerCredentialDetailVM) => void) | undefined;
    const onIssue = vi.fn(
      () =>
        new Promise<IssuerCredentialDetailVM>((resolve) => {
          resolveIssue = resolve;
        })
    );

    function Harness() {
      const [detail, setDetail] = useState(
        detailFixture({
          documentEvidence: { currentDocument: pdfEvidenceFixture() }
        })
      );

      return (
        <CredentialIssuanceSection
          detail={detail}
          onIssue={async () => {
            const issued = await onIssue();
            setDetail(issued);
            return issued;
          }}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(
      (
        screen.getByRole('button', {
          name: 'Emitiendo credencial…'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Emitiendo credencial…' }));
    expect(onIssue).toHaveBeenCalledOnce();

    resolveIssue?.(issuedFixture());

    await waitFor(() => {
      expect(screen.getByText('Credencial emitida')).toBeTruthy();
    });
    expect(screen.getByText('canon_v1')).toBeTruthy();
    expect(screen.getByText('Entorno técnico/demo')).toBeTruthy();
    expect(screen.getByText('anvil')).toBeTruthy();
    expect(screen.getByText('31337')).toBeTruthy();
    expect(screen.getAllByText('Registrada').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/no a una red pública productiva/i)
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emitir credencial' })).toBeNull();
  });

  // C4x: para course/certification, "sin fuente de respaldo" se reemplaza
  // por un aviso de "informacion insuficiente" cuando no hay ni evidencia
  // cargada ni respaldo declarativo (descripcion/competencias/contenido
  // adicional/skills). El fixture por default (course, sin ningun dato
  // declarado) es exactamente ese caso.
  it('requires an additional explicit acknowledgement before issuing a course with insufficient declared data', () => {
    render(
      <CredentialIssuanceSection detail={detailFixture()} onIssue={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(
      screen.getByText('Información insuficiente para la interpretación asistida')
    ).toBeTruthy();
    expect(screen.queryByText('Sin fuente de respaldo')).toBeNull();
    expect(
      screen.getByText(
        'No se generará una interpretación asistida robusta porque hay poca información declarada.'
      )
    ).toBeTruthy();
    const confirm = screen.getByRole('button', {
      name: 'Emitir credencial'
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(
      screen.getByLabelText(
        'Confirmo emitir esta credencial con información declarada insuficiente para la interpretación asistida.'
      )
    );
    expect(confirm.disabled).toBe(false);
  });

  it('still shows the original "sin fuente de respaldo" copy for academic_subject/degree (unaffected by the course/certification textual-backing rule)', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({ type: 'academic_subject', typeLabel: 'Asignatura académica' })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(screen.getByText('Sin fuente de respaldo')).toBeTruthy();
    expect(
      screen.getByText(
        'No se generará análisis automático porque no hay evidencia de respaldo cargada.'
      )
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Confirmo emitir esta credencial sin una fuente de respaldo cargada en Traza.'
      )
    ).toBeTruthy();
  });

  it('does not show the "sin respaldo"/insufficient-info warning for a course with sufficient declared competencies', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({
          credentialSubject: {
            ...detailFixture().credentialSubject,
            competencies: ['Programación orientada a objetos']
          }
        })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(
      screen.queryByText('Información insuficiente para la interpretación asistida')
    ).toBeNull();
    expect(screen.queryByText('Sin fuente de respaldo')).toBeNull();
    expect(screen.queryByText('Respaldo textual institucional')).toBeNull();
    expect(screen.getByText('Se ejecutará al emitir con datos declarados')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Emitir credencial' })
        .getAttribute('disabled')
    ).toBeNull();
  });

  it('does not show the "sin respaldo" warning for a certification with sufficient skills/competencies/description', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({
          type: 'certification',
          typeLabel: 'Certificación',
          credentialSubject: {
            ...detailFixture().credentialSubject,
            skills: ['Cloud']
          }
        })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(screen.queryByText('Sin fuente de respaldo')).toBeNull();
    expect(screen.queryByText('Respaldo textual institucional')).toBeNull();
    expect(screen.getByText('Se ejecutará al emitir con datos declarados')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Emitir credencial' })
        .getAttribute('disabled')
    ).toBeNull();
  });

  it('uses a reusable credential text source without claiming that analysis requires a PDF', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({
          textEvidence: { currentText: textEvidenceFixture() }
        })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(screen.getByText('Evidencia textual vigente')).toBeTruthy();
    expect(
      screen.queryByText(/análisis textual queda pendiente para una iteración posterior/i)
    ).toBeNull();
    expect(screen.queryByText(/requiere una evidencia documental PDF/i)).toBeNull();
    expect(screen.getByText(/a partir de la información declarada disponible/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Emitir credencial' })
      .getAttribute('disabled')
    ).toBeNull();
  });

  it('uses course-specific optional-data recommendations in a PDF confirmation', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({
          documentEvidence: { currentDocument: pdfEvidenceFixture() }
        })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(
      screen.getByText(/intentará generar automáticamente un análisis documental/i)
    ).toBeTruthy();
    expect(screen.getByText('Datos recomendados pendientes')).toBeTruthy();
    const warning = screen.getByText(/campos opcionales incompletos/i)
      .parentElement?.textContent ?? '';
    expect(warning).toMatch(
      /descripción, horas oficiales declaradas, modalidad, competencias, contenido e información adicional, URL del curso/i
    );
    expect(warning).not.toMatch(/período académico|calificación|habilidades/i);
  });

  it('keeps academic recommendations scoped to academic subjects', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({ type: 'academic_subject' })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    const warning = screen.getByText(/campos opcionales incompletos/i)
      .parentElement?.textContent ?? '';
    expect(warning).toMatch(/período académico|calificación/i);
    expect(warning).not.toMatch(/URL del curso|modalidad/i);
  });

  it('uses certification fields without academic or course-only recommendations', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({ type: 'certification' })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    const warning = screen.getByText(/campos opcionales incompletos/i)
      .parentElement?.textContent ?? '';
    expect(warning).toMatch(/código de certificación|proveedor de la certificación/i);
    expect(warning).not.toMatch(/período académico|calificación|modalidad|platformName/i);
  });

  it('shows an honest issued state without blockchain evidence', () => {
    render(
      <CredentialIssuanceSection
        detail={issuedFixture({ blockchainEvidence: null })}
        onIssue={vi.fn()}
      />
    );

    expect(
      screen.getByText(
        'La credencial fue emitida, pero no hay evidencia blockchain disponible para mostrar.'
      )
    ).toBeTruthy();
  });

  it('keeps revoked historical evidence read-only', () => {
    render(
      <CredentialIssuanceSection
        detail={issuedFixture({
          status: 'revoked',
          statusLabel: 'Revocada',
          blockchainEvidence: {
            ...issuedFixture().blockchainEvidence!,
            status: 'revoked',
            statusLabel: 'Revocada'
          }
        })}
        onIssue={vi.fn()}
      />
    );

    expect(screen.getByText('Credencial revocada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Emitir credencial' })).toBeNull();
    expect(screen.getAllByText('Revocada').length).toBeGreaterThan(0);
  });

  it.each([
    [400, /datos o la configuración necesarios/i],
    [401, /sesión venció/i],
    [403, /permisos para emitir/i],
    [404, /contexto institucional activo/i],
    [409, /ya no está en borrador/i],
    [502, /registro técnico/i],
    [503, /registro técnico/i],
    [504, /registro técnico/i]
  ])('maps issuance HTTP %i to safe copy', async (status, message) => {
    const onIssue = vi
      .fn()
      .mockRejectedValue(new ApiError('private upstream detail', 'http', status));
    render(
      <CredentialIssuanceSection detail={draftWithPdf()} onIssue={onIssue} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(/private upstream detail/i)).toBeNull();
  });

  it('describes an uncertain network result without exposing internals', async () => {
    const onIssue = vi
      .fn()
      .mockRejectedValue(new ApiError('private RPC URL', 'network'));
    render(
      <CredentialIssuanceSection detail={draftWithPdf()} onIssue={onIssue} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    expect(
      await screen.findByText(/actualizá el detalle antes de volver a intentarlo/i)
    ).toBeTruthy();
    expect(screen.queryByText(/private RPC URL/i)).toBeNull();
  });

  it('does not render prohibited claims or dangerous fields', () => {
    render(
      <CredentialIssuanceSection detail={issuedFixture()} onIssue={vi.fn()} />
    );

    const content = document.body.textContent ?? '';
    expect(content).not.toMatch(
      /100% verificado|inmutable para siempre|verificación garantizada|blockchain certificó|IA certificó|privateKey|rpcUrl|storageKey|rawData/i
    );
  });

  // C4x: el nuevo copy de respaldo declarativo tampoco debe afirmar
  // certificacion de IA ni validacion de blockchain sobre el contenido.
  it('never claims AI certification or blockchain validation in the declarative-backing copy', () => {
    render(
      <CredentialIssuanceSection
        detail={detailFixture({
          credentialSubject: {
            ...detailFixture().credentialSubject,
            competencies: ['Programación orientada a objetos']
          }
        })}
        onIssue={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Emitir credencial' }));

    const content = document.body.textContent ?? '';
    expect(content).not.toMatch(/IA certificó/i);
    expect(content).not.toMatch(/blockchain valida/i);
    expect(content).not.toMatch(/verificado por|udemy|coursera|aws/i);
    expect(content).not.toMatch(/certificación de competencias por IA/i);
  });
});
