import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SaveReusableTemplateSection } from '@/features/credentials/save-reusable-template-section';
import { ApiError } from '@/lib/errors/api-error';
import type { CourseTemplateSummaryVM } from '@/models/credentials';

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
    createdFromCredentialId: 'credential-1',
    lastSemanticAnalysisId: null,
    approvedSemanticAnalysisId: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    approvedSemanticSnapshotSummary: null,
    createdAt: '2026-08-11T10:00:00.000Z',
    updatedAt: '2026-08-11T10:00:00.000Z',
    ...overrides
  } as CourseTemplateSummaryVM;
}

describe('SaveReusableTemplateSection', () => {
  it('idle: shows the type-specific label and no feedback', () => {
    render(
      <SaveReusableTemplateSection
        credentialType="course"
        onSave={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Guardar como curso reutilizable' })
    ).toBeTruthy();
    expect(screen.queryByText(/guardado como reutilizable/i)).toBeNull();
  });

  it('idle: certification uses its own label', () => {
    render(
      <SaveReusableTemplateSection
        credentialType="certification"
        onSave={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'Guardar como certificación reutilizable'
      })
    ).toBeTruthy();
  });

  it('loading: disables the button and never calls onSave twice on a double click', async () => {
    let resolveSave: (value: CourseTemplateSummaryVM) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<CourseTemplateSummaryVM>((resolve) => {
          resolveSave = resolve;
        })
    );
    render(<SaveReusableTemplateSection credentialType="course" onSave={onSave} />);

    const button = screen.getByRole('button', {
      name: 'Guardar como curso reutilizable'
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Guardando…' })).toBeTruthy()
    );
    // El boton en loading queda disabled -- un segundo click no dispara un
    // segundo onSave (ni por el atributo disabled del DOM ni por el guard
    // requestInFlight interno del componente).
    fireEvent.click(screen.getByRole('button', { name: 'Guardando…' }));
    expect(onSave).toHaveBeenCalledTimes(1);

    resolveSave(templateFixture());
    await waitFor(() =>
      expect(screen.getByText('Curso guardado como reutilizable.')).toBeTruthy()
    );
  });

  it('success: shows the success feedback and disables further clicks', async () => {
    const onSave = vi.fn().mockResolvedValue(templateFixture());
    render(<SaveReusableTemplateSection credentialType="course" onSave={onSave} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar como curso reutilizable' })
    );

    expect(
      await screen.findByText('Curso guardado como reutilizable.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Disponible para reutilizar en futuras credenciales de este emisor.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Guardar como curso reutilizable' })
    ).toHaveProperty('disabled', true);
  });

  it('409 duplicate: shows the duplicate feedback, never a generic error', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('conflict', 'http', 409));
    render(<SaveReusableTemplateSection credentialType="course" onSave={onSave} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar como curso reutilizable' })
    );

    expect(
      await screen.findByText('Este curso ya fue guardado como reutilizable.')
    ).toBeTruthy();
    expect(
      screen.getByText('No se creó un registro nuevo para evitar duplicados.')
    ).toBeTruthy();
    // Tras un duplicado el boton vuelve a estar disponible (no es un
    // estado terminal como success).
    expect(
      screen.getByRole('button', { name: 'Guardar como curso reutilizable' })
    ).toHaveProperty('disabled', false);
  });

  it('409 duplicate: certification uses its own duplicate copy', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('conflict', 'http', 409));
    render(
      <SaveReusableTemplateSection
        credentialType="certification"
        onSave={onSave}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Guardar como certificación reutilizable'
      })
    );

    expect(
      await screen.findByText(
        'Esta certificación ya fue guardada como reutilizable.'
      )
    ).toBeTruthy();
  });

  it('generic error: shows a recoverable error message, keeps the button usable', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('boom', 'http', 500));
    render(<SaveReusableTemplateSection credentialType="course" onSave={onSave} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar como curso reutilizable' })
    );

    expect(
      await screen.findByText('No pudimos guardar este contenido como reutilizable')
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Guardar como curso reutilizable' })
    ).toHaveProperty('disabled', false);
  });
});
