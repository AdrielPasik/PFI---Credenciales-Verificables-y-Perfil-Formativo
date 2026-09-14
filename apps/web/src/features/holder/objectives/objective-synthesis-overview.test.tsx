import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ObjectiveSynthesisOverview } from '@/features/holder/objectives/objective-synthesis-overview';
import type { ObjectiveSynthesisVM } from '@/models/reasoning-runs';

function positiveConclusion(
  index: number,
  finalState: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' = 'PARTIALLY_SUPPORTED'
): ObjectiveSynthesisVM['positiveConclusions'][number] {
  return {
    requirementId: `req_${String(index).padStart(2, '0')}`,
    requirementText: `Requisito positivo ${index}`,
    finalState,
    supportedWeakerClaim:
      finalState === 'PARTIALLY_SUPPORTED' ? `Alcance parcial ${index}.` : null,
    supportingCredentialReferences: ['cred-python']
  };
}

function synthesis(overrides: Partial<ObjectiveSynthesisVM> = {}): ObjectiveSynthesisVM {
  return {
    schemaVersion: 'objective_synthesis_v1',
    reasoningRunReference: 'run-1',
    objectiveReference: 'obj-1',
    stateSummary: {
      supportedCount: 0,
      partiallySupportedCount: 1,
      insufficientEvidenceCount: 5,
      abstainCount: 2,
      notAssessableCount: 6
    },
    requirements: Array.from({ length: 14 }, (_, offset) => {
      const index = offset + 1;
      return {
        requirementId: `req_${String(index).padStart(2, '0')}`,
        order: index,
        requirementText:
          index === 4
            ? 'Desarrollar y programar aplicaciones de soporte para la gestión.'
            : `Requisito confirmado ${index}`,
        finalState:
          index === 4
            ? 'PARTIALLY_SUPPORTED'
            : index <= 6
              ? 'INSUFFICIENT_EVIDENCE'
              : index <= 8
                ? 'ABSTAIN'
                : 'NOT_ASSESSABLE'
      };
    }),
    positiveConclusions: [
      {
        requirementId: 'req_04',
        requirementText: 'Desarrollar y programar aplicaciones de soporte para la gestión.',
        finalState: 'PARTIALLY_SUPPORTED',
        supportedWeakerClaim:
          'Formación introductoria en programación con Python para el manejo de datos empresariales.',
        supportingCredentialReferences: ['cred-python']
      }
    ],
    credentialsSupportingPositiveConclusions: [
      {
        credentialReference: 'cred-python',
        credentialDisplay: {
          title: 'Análisis de datos con Python para negocios',
          credentialType: 'course',
          issuerName: 'Plataforma de Cursos Demo',
          currentStatus: 'revoked'
        },
        supportedRequirementIds: [],
        partiallySupportedRequirementIds: ['req_04']
      }
    ],
    ...overrides
  };
}

describe('overview determinista de objetivo', () => {
  it('omite la fecha cuando la respuesta compatible no informa completedAt', () => {
    render(<ObjectiveSynthesisOverview synthesis={synthesis()} completedAtLabel={null} />);

    expect(screen.queryByText(/Analizado el/i)).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Tu trayectoria frente a este objetivo' })
    ).toBeTruthy();
  });

  it('presenta el caso real de catorce requisitos sin puntaje ni promociones negativas', () => {
    render(
      <ObjectiveSynthesisOverview
        synthesis={synthesis()}
        completedAtLabel="11 de septiembre de 2026"
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Tu trayectoria frente a este objetivo' })
    ).toBeTruthy();
    expect(screen.getByText('1 respaldado parcialmente')).toBeTruthy();
    expect(screen.getByText('5 con evidencia insuficiente')).toBeTruthy();
    expect(screen.getByText('2 sin conclusión confiable')).toBeTruthy();
    expect(screen.getByText('6 no evaluables con evidencia formativa')).toBeTruthy();
    expect(screen.getByText('Lo que sí puede justificarse')).toBeTruthy();
    expect(
      screen.getByText(
        'Formación introductoria en programación con Python para el manejo de datos empresariales.'
      )
    ).toBeTruthy();

    const conclusions = screen
      .getByRole('heading', { name: 'Conclusiones respaldadas por tu formación' })
      .closest('section');
    expect(conclusions).not.toBeNull();
    expect(
      within(conclusions!).getByText('Análisis de datos con Python para negocios')
    ).toBeTruthy();
    expect(within(conclusions!).getByText(/Estado actual: Revocada/)).toBeTruthy();
    expect(within(conclusions!).queryByText('Credencial no promovida')).toBeNull();

    const body = document.body.textContent ?? '';
    expect(body).not.toContain('1/14');
    expect(body).not.toMatch(/puntaje|score|ranking|compatibilidad/i);
  });

  it('no dibuja una seccion vacia cuando no hay conclusiones positivas', () => {
    render(
      <ObjectiveSynthesisOverview
        synthesis={
          synthesis({
            stateSummary: {
              supportedCount: 0,
              partiallySupportedCount: 0,
              insufficientEvidenceCount: 5,
              abstainCount: 2,
              notAssessableCount: 7
            },
            positiveConclusions: [],
            credentialsSupportingPositiveConclusions: []
          })
        }
        completedAtLabel="11 de septiembre de 2026"
      />
    );

    expect(
      screen.getByText(
        'Este análisis no identificó requisitos respaldados ni parcialmente respaldados con la evidencia formativa disponible.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Conclusiones respaldadas por tu formación')).toBeNull();
  });

  it('presenta supported, conserva el orden y revela conclusiones restantes sin ranking', () => {
    const conclusions = [
      positiveConclusion(1, 'SUPPORTED'),
      positiveConclusion(2),
      positiveConclusion(3),
      positiveConclusion(4)
    ];
    render(
      <ObjectiveSynthesisOverview
        synthesis={
          synthesis({
            stateSummary: {
              supportedCount: 1,
              partiallySupportedCount: 3,
              insufficientEvidenceCount: 0,
              abstainCount: 0,
              notAssessableCount: 0
            },
            positiveConclusions: conclusions
          })
        }
        completedAtLabel="11 de septiembre de 2026"
      />
    );

    expect(screen.getByText('1 respaldado')).toBeTruthy();
    expect(screen.getByText('Requisito positivo 1')).toBeTruthy();
    expect(screen.getByText('Requisito positivo 3')).toBeTruthy();
    expect(screen.queryByText('Requisito positivo 4')).toBeNull();

    const disclosure = screen.getByRole('button', {
      name: 'Ver conclusiones restantes'
    });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Requisito positivo 4')).toBeTruthy();
  });

  it('describe el caso completamente no evaluable sin tratarlo como fallo', () => {
    render(
      <ObjectiveSynthesisOverview
        synthesis={
          synthesis({
            stateSummary: {
              supportedCount: 0,
              partiallySupportedCount: 0,
              insufficientEvidenceCount: 0,
              abstainCount: 0,
              notAssessableCount: 14
            },
            positiveConclusions: [],
            credentialsSupportingPositiveConclusions: []
          })
        }
        completedAtLabel="11 de septiembre de 2026"
      />
    );

    expect(
      screen.getByText(
        'Los requisitos de este objetivo no pueden evaluarse con evidencia formativa disponible.'
      )
    ).toBeTruthy();
    expect((document.body.textContent ?? '')).not.toMatch(/fall[oó]|reprob/i);
  });
});
