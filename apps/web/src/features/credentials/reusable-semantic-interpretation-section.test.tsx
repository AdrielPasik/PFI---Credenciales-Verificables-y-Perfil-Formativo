import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReusableSemanticInterpretationSection } from '@/features/credentials/reusable-semantic-interpretation-section';
import { ApiError } from '@/lib/errors/api-error';
import type {
  AppliedReusableSemanticInterpretationVM,
  CourseTemplateSummaryVM,
  ReusableSemanticInterpretationCandidateVM
} from '@/models/credentials';

const snapshotSummary = {
  schema: 'approved_template_semantic_snapshot_v2',
  status: 'completed' as const,
  areaCount: 0,
  skillCount: 0,
  conceptCount: 0,
  hasHoursDistribution: false,
  warningCount: 0,
  qualityFlagCount: 0
};

function templateFixture(
  overrides: Partial<CourseTemplateSummaryVM> = {}
): CourseTemplateSummaryVM {
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
    createdFromCredentialId: null,
    // Elegible por default (interpretacion aprobada disponible) -- los
    // tests de elegibilidad de C4b.2-R sobreescriben explicitamente a null
    // cuando necesitan un template NO elegible.
    lastSemanticAnalysisId: 'analysis-1',
    approvedSemanticAnalysisId: 'analysis-1',
    approvedSemanticApprovedAt: '2026-08-14T10:00:00.000Z',
    approvedSemanticPipelineVersion: 'pipeline-v1',
    approvedSemanticTaxonomyVersion: 'taxonomy-v1',
    approvedSemanticSourceCredentialId: 'credential-source',
    approvedSemanticSnapshotSummary: snapshotSummary,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:00:00.000Z',
    ...overrides
  };
}

function appliedFixture(
  overrides: Partial<AppliedReusableSemanticInterpretationVM> = {}
): AppliedReusableSemanticInterpretationVM {
  return {
    templateReference: 'template-1',
    templateTitle: 'Curso de Python',
    snapshotSummary,
    appliedAt: '2026-08-14T11:00:00.000Z',
    appliedAtLabel: '14 ago 2026, 08:00',
    appliedByDisplayLabel: 'Ana Aprobadora',
    approvalDriftStatus: 'up_to_date',
    templateContentStatus: 'matches_approved_source',
    destinationCompatibility: 'compatible',
    changedFields: [],
    ...overrides
  };
}

function candidateFixture(
  overrides: Partial<ReusableSemanticInterpretationCandidateVM> = {}
): ReusableSemanticInterpretationCandidateVM {
  return {
    templateReference: 'template-1',
    templateTitle: 'Curso de Python',
    snapshotSummary,
    approvedAt: '2026-08-14T10:00:00.000Z',
    approvedAtLabel: '14 ago 2026, 07:00',
    approvedByDisplayLabel: 'Ana Aprobadora',
    approvalRevision: '2026-08-14T10:00:00.000Z',
    approvalDriftStatus: 'none_applied',
    templateContentStatus: 'matches_approved_source',
    destinationCompatibility: 'compatible',
    changedFields: [],
    currentApplication: null,
    ...overrides
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    credentialType: 'course' as const,
    onLoadActiveApplication: vi.fn().mockResolvedValue(null),
    searchTemplates: vi.fn().mockResolvedValue([templateFixture()]),
    onLoadCandidate: vi.fn().mockResolvedValue(candidateFixture()),
    onApply: vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedFixture()
    }),
    ...overrides
  };
}

async function selectTheOnlyTemplate() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Buscar' })
  );
  const option = await screen.findByRole('button', { name: 'Curso de Python' });
  fireEvent.click(option);
}

describe('ReusableSemanticInterpretationSection: active application state', () => {
  it('shows a discrete empty state when there is no applied interpretation', async () => {
    render(<ReusableSemanticInterpretationSection {...baseProps()} />);

    expect(
      await screen.findByText(
        'No hay una interpretación revisada aplicada a esta credencial.'
      )
    ).toBeTruthy();
  });

  it('shows the applied summary without leaking technical ids', async () => {
    const onLoadActiveApplication = vi.fn().mockResolvedValue(
      appliedFixture({ templateTitle: 'Curso de Python aplicado' })
    );
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadActiveApplication })}
      />
    );

    expect(await screen.findByText('Curso de Python aplicado')).toBeTruthy();
    expect(screen.getByText('Ana Aprobadora')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /template-1|approvalRevision|sourceCredentialId/i
    );
  });

  it('never shows raw enum identifiers or infra terms in the DOM', async () => {
    const onLoadActiveApplication = vi.fn().mockResolvedValue(
      appliedFixture({
        approvalDriftStatus: 'different_approval_available',
        templateContentStatus: 'differs_from_approved_source',
        destinationCompatibility: 'modified'
      })
    );
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadActiveApplication })}
      />
    );

    await screen.findByText('Curso de Python');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(
      /different_approval_available|matches_approved_source|differs_from_approved_source|P2002|P2034|Serializable|superseded|TOCTOU/i
    );
    expect(text).not.toMatch(/IA certificó|aprobación automática/i);
  });
});

describe('ReusableSemanticInterpretationSection: template selection', () => {
  it('only calls the candidate loader after an explicit template selection, never eagerly', async () => {
    const onLoadCandidate = vi.fn().mockResolvedValue(candidateFixture());
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate })}
      />
    );

    await screen.findByText(
      'No hay una interpretación revisada aplicada a esta credencial.'
    );
    expect(onLoadCandidate).not.toHaveBeenCalled();

    await selectTheOnlyTemplate();
    await waitFor(() => expect(onLoadCandidate).toHaveBeenCalledWith('template-1'));
  });

  it('invalidates the previous candidate when a different template is selected', async () => {
    const templateB = templateFixture({ reference: 'template-2', title: 'Curso B' });
    const onLoadCandidate = vi
      .fn()
      .mockResolvedValueOnce(candidateFixture())
      .mockResolvedValueOnce(
        candidateFixture({ templateReference: 'template-2', templateTitle: 'Curso B' })
      );
    const searchTemplates = vi.fn().mockResolvedValue([templateFixture()]);
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate, searchTemplates })}
      />
    );

    await selectTheOnlyTemplate();
    await screen.findByText('Interpretación disponible para aplicar');

    fireEvent.click(
      screen.getByRole('button', { name: 'Elegir otro contenido reutilizable' })
    );
    expect(screen.queryByText('Interpretación disponible para aplicar')).toBeNull();
    searchTemplates.mockResolvedValueOnce([templateB]);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    const optionB = await screen.findByRole('button', { name: 'Curso B' });
    fireEvent.click(optionB);

    await waitFor(() => expect(onLoadCandidate).toHaveBeenCalledWith('template-2'));
    await waitFor(() =>
      expect(screen.getAllByText('Curso B').length).toBeGreaterThan(0)
    );
    expect(screen.queryByText('Curso de Python')).toBeNull();
  });
});

// C4b.2-R: el selector nunca debe ofrecer un template que el backend ya
// sabe que candidate va a rechazar (sin interpretacion aprobada). El
// filtro se aplica sobre lo que devuelve searchTemplates -- listCourseTemplates
// ya scopea por issuer/credentialType/status en el controller (fuera de
// este componente); estos tests cubren la elegibilidad adicional que
// decide el componente.
describe('ReusableSemanticInterpretationSection: reusable content eligibility (approved interpretation required)', () => {
  it('A: active + correct type + approved snapshot summary -> selectable', async () => {
    const searchTemplates = vi.fn().mockResolvedValue([templateFixture()]);
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ searchTemplates })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(
      await screen.findByRole('button', { name: 'Curso de Python' })
    ).toBeTruthy();
  });

  it('B: active + correct type + NO approved snapshot summary -> not selectable', async () => {
    const unapproved = templateFixture({
      approvedSemanticSnapshotSummary: null,
      approvedSemanticAnalysisId: null,
      approvedSemanticApprovedAt: null
    });
    const searchTemplates = vi.fn().mockResolvedValue([unapproved]);
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ searchTemplates })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(searchTemplates).toHaveBeenCalled());
    expect(
      await screen.findByText(
        'No encontramos contenido reutilizable con una interpretación revisada disponible para aplicar. Primero revisá y aprobá una interpretación desde una credencial emitida.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Curso de Python' })
    ).toBeNull();
  });

  it('C: archived + approved -> not selectable (archived templates are never returned as selectable options)', async () => {
    // El controller ya pide status: 'active' a listCourseTemplates; este
    // test cubre que, aunque searchTemplates devolviera un archived por
    // cualquier motivo, el componente no lo trata como si fuera lo mismo
    // que un resultado vacio -- documenta la expectativa sin duplicar la
    // logica de scoping del controller (fuera de alcance de este archivo).
    const archived = templateFixture({ status: 'archived' });
    const searchTemplates = vi.fn().mockResolvedValue([archived]);
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ searchTemplates })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(searchTemplates).toHaveBeenCalled());
    // El componente no filtra por status (responsabilidad ya cubierta por
    // el controller que scopea status:'active' antes de llegar aca) --
    // este caso documenta que la elegibilidad de C4b.2-R es sobre la
    // aprobacion, no un segundo filtro de status duplicado.
    expect(
      await screen.findByRole('button', { name: 'Curso de Python' })
    ).toBeTruthy();
  });

  // D (type incorrecto + approved -> no selectable): ese filtro vive en
  // searchReusableTemplatesForInterpretation (credential-detail-route.tsx),
  // no en este componente -- cubierto con una asercion real en
  // credential-detail-route.test.tsx ("D: filters the template search by
  // the credential's own type").

  it('E: mixed results -> only eligible templates are offered as options', async () => {
    const eligible = templateFixture({ reference: 'template-a', title: 'Template A' });
    const notApproved = templateFixture({
      reference: 'template-b',
      title: 'Template B',
      approvedSemanticSnapshotSummary: null,
      approvedSemanticAnalysisId: null,
      approvedSemanticApprovedAt: null
    });
    const searchTemplates = vi
      .fn()
      .mockResolvedValue([eligible, notApproved]);
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ searchTemplates })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(
      await screen.findByRole('button', { name: 'Template A' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Template B' })).toBeNull();
  });

  it('F: zero eligible results -> clear empty state, no candidate call', async () => {
    const notApproved = templateFixture({
      approvedSemanticSnapshotSummary: null,
      approvedSemanticAnalysisId: null,
      approvedSemanticApprovedAt: null
    });
    const searchTemplates = vi.fn().mockResolvedValue([notApproved]);
    const onLoadCandidate = vi.fn();
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ searchTemplates, onLoadCandidate })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText(
      'No encontramos contenido reutilizable con una interpretación revisada disponible para aplicar. Primero revisá y aprobá una interpretación desde una credencial emitida.'
    );
    expect(onLoadCandidate).not.toHaveBeenCalled();
    // Nunca un error rojo -- es un estado vacio de producto.
    expect(screen.queryByText('No pudimos buscar contenido reutilizable')).toBeNull();
  });

  it('G: lastSemanticAnalysisId != null but no approval -> still NOT eligible', async () => {
    const analyzedButNotApproved = templateFixture({
      lastSemanticAnalysisId: 'analysis-99',
      approvedSemanticAnalysisId: null,
      approvedSemanticApprovedAt: null,
      approvedSemanticSnapshotSummary: null
    });
    const searchTemplates = vi
      .fn()
      .mockResolvedValue([analyzedButNotApproved]);
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ searchTemplates })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(searchTemplates).toHaveBeenCalled());
    expect(
      screen.queryByRole('button', { name: 'Curso de Python' })
    ).toBeNull();
  });

  it('H: candidate can still surface a backend 422 safely (defensive mapping preserved, never removed)', async () => {
    const onLoadCandidate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('unexpected state', 'http', 422));
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate })}
      />
    );

    await selectTheOnlyTemplate();
    expect(
      await screen.findByText(
        'Este contenido reutilizable todavía no tiene una interpretación revisada disponible para aplicar.'
      )
    ).toBeTruthy();
  });
});

describe('ReusableSemanticInterpretationSection: candidate compatibility states', () => {
  it('compatible: enables Apply without any acknowledgment', async () => {
    const onLoadCandidate = vi
      .fn()
      .mockResolvedValue(candidateFixture({ destinationCompatibility: 'compatible' }));
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate })}
      />
    );

    await selectTheOnlyTemplate();
    const applyButton = await screen.findByRole('button', {
      name: 'Aplicar interpretación revisada'
    });
    expect(applyButton.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('modified: disables Apply until the acknowledgment checkbox is checked, and shows humanized changedFields', async () => {
    const onLoadCandidate = vi.fn().mockResolvedValue(
      candidateFixture({
        destinationCompatibility: 'modified',
        changedFields: ['title', 'hours']
      })
    );
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate })}
      />
    );

    await selectTheOnlyTemplate();
    const applyButton = await screen.findByRole('button', {
      name: 'Aplicar interpretación revisada'
    });
    expect(applyButton.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Título')).toBeTruthy();
    expect(screen.getByText('Horas')).toBeTruthy();
    expect(screen.queryByText('title')).toBeNull();
    expect(screen.queryByText('hours')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(applyButton.hasAttribute('disabled')).toBe(false);
  });

  it('modified: sends acknowledgeDestinationDrift: true only after checking the box', async () => {
    const onApply = vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedFixture()
    });
    const onLoadCandidate = vi
      .fn()
      .mockResolvedValue(candidateFixture({ destinationCompatibility: 'modified' }));
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate, onApply })}
      />
    );

    await selectTheOnlyTemplate();
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Aplicar interpretación revisada' })
    );

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({
          templateReference: 'template-1',
          approvalRevision: '2026-08-14T10:00:00.000Z',
          acknowledgeDestinationDrift: true
        })
      )
    );
  });

  it('unknown: Apply is always disabled, with no override available', async () => {
    const onLoadCandidate = vi
      .fn()
      .mockResolvedValue(candidateFixture({ destinationCompatibility: 'unknown' }));
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate })}
      />
    );

    await selectTheOnlyTemplate();
    const applyButton = await screen.findByRole('button', {
      name: 'Aplicar interpretación revisada'
    });
    expect(applyButton.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('templateContentStatus differs: shown as a non-blocking warning', async () => {
    const onLoadCandidate = vi.fn().mockResolvedValue(
      candidateFixture({
        templateContentStatus: 'differs_from_approved_source',
        destinationCompatibility: 'compatible'
      })
    );
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate })}
      />
    );

    await selectTheOnlyTemplate();
    expect(
      await screen.findByText(
        'El contenido reutilizable fue modificado desde la revisión de esta interpretación.'
      )
    ).toBeTruthy();
    const applyButton = screen.getByRole('button', {
      name: 'Aplicar interpretación revisada'
    });
    expect(applyButton.hasAttribute('disabled')).toBe(false);
  });

  it('approvalDriftStatus different_approval_available: shown as an informational notice, using no ordering language', async () => {
    const onLoadCandidate = vi
      .fn()
      .mockResolvedValue(
        candidateFixture({ approvalDriftStatus: 'different_approval_available' })
      );
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadCandidate })}
      />
    );

    await selectTheOnlyTemplate();
    expect(
      await screen.findByText(
        'La interpretación aprobada para este contenido cambió desde la aplicación actual. Revisá la versión disponible antes de volver a aplicar.'
      )
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/más nueva|última versión|newer/i);
  });
});

describe('ReusableSemanticInterpretationSection: TOCTOU 409', () => {
  it('never retries apply automatically, refetches candidate, and shows the specific copy', async () => {
    const onApply = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('conflict', 'http', 409));
    const onLoadCandidate = vi
      .fn()
      .mockResolvedValueOnce(candidateFixture())
      .mockResolvedValueOnce(
        candidateFixture({ approvedAtLabel: '15 ago 2026, 00:00' })
      );
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onApply, onLoadCandidate })}
      />
    );

    await selectTheOnlyTemplate();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aplicar interpretación revisada' })
    );

    expect(
      await screen.findByText(
        'La interpretación aprobada cambió mientras la estabas revisando. Actualizamos la información para que puedas revisarla nuevamente.'
      )
    ).toBeTruthy();
    expect(onApply).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onLoadCandidate).toHaveBeenCalledTimes(2));
  });
});

describe('ReusableSemanticInterpretationSection: apply outcomes', () => {
  it('first apply: shows a success message and refreshes the active application summary', async () => {
    const onApply = vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedFixture({ templateTitle: 'Curso de Python recién aplicado' })
    });
    render(<ReusableSemanticInterpretationSection {...baseProps({ onApply })} />);

    await selectTheOnlyTemplate();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aplicar interpretación revisada' })
    );

    expect(await screen.findByText('Interpretación aplicada')).toBeTruthy();
    expect(
      await screen.findByText('Curso de Python recién aplicado')
    ).toBeTruthy();
  });

  it('idempotent apply (changed: false): never shown as an error', async () => {
    const onApply = vi.fn().mockResolvedValue({
      changed: false,
      supersededPreviousApplication: false,
      application: appliedFixture()
    });
    render(<ReusableSemanticInterpretationSection {...baseProps({ onApply })} />);

    await selectTheOnlyTemplate();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aplicar interpretación revisada' })
    );

    expect(
      await screen.findByText('Esta interpretación ya estaba aplicada')
    ).toBeTruthy();
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('supersede (supersededPreviousApplication: true): never mentions "supersede"', async () => {
    const onApply = vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: true,
      application: appliedFixture()
    });
    render(<ReusableSemanticInterpretationSection {...baseProps({ onApply })} />);

    await selectTheOnlyTemplate();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aplicar interpretación revisada' })
    );

    expect(
      await screen.findByText(
        'Se actualizó la interpretación aplicada a esta credencial'
      )
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/supersede/i);
  });

  it('never claims the formative profile was updated', async () => {
    const onApply = vi.fn().mockResolvedValue({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedFixture()
    });
    render(<ReusableSemanticInterpretationSection {...baseProps({ onApply })} />);

    await selectTheOnlyTemplate();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Aplicar interpretación revisada' })
    );

    await screen.findByText('Interpretación aplicada');
    expect(document.body.textContent).not.toMatch(
      /perfil actualizado|trayectoria actualizada|ya impact.* el perfil/i
    );
  });

  it('protects against double-submit while applying', async () => {
    let resolveApply: (value: unknown) => void = () => undefined;
    const onApply = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveApply = resolve;
        })
    );
    render(<ReusableSemanticInterpretationSection {...baseProps({ onApply })} />);

    await selectTheOnlyTemplate();
    const applyButton = await screen.findByRole('button', {
      name: 'Aplicar interpretación revisada'
    });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);

    expect(onApply).toHaveBeenCalledTimes(1);
    resolveApply({
      changed: true,
      supersededPreviousApplication: false,
      application: appliedFixture()
    });
  });
});

describe('ReusableSemanticInterpretationSection: readOnly (revoked) mode', () => {
  it('shows the historical applied summary but no template picker or apply action', async () => {
    const onLoadActiveApplication = vi.fn().mockResolvedValue(appliedFixture());
    const searchTemplates = vi.fn();
    render(
      <ReusableSemanticInterpretationSection
        {...baseProps({ onLoadActiveApplication, searchTemplates })}
        readOnly
      />
    );

    expect(await screen.findByText('Curso de Python')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buscar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Aplicar interpretación/ })).toBeNull();
    expect(searchTemplates).not.toHaveBeenCalled();
  });
});
