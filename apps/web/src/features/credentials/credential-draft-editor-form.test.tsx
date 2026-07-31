import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CredentialDraftEditorForm } from '@/features/credentials/credential-draft-editor-form';
import { ApiError } from '@/lib/errors/api-error';
import type {
  CredentialFeedback,
  CredentialType,
  IssuerCredentialDetailVM,
  UpdateIssuerCredentialDraftCommand
} from '@/models/credentials';

type SaveDraft = (
  command: UpdateIssuerCredentialDraftCommand
) => Promise<IssuerCredentialDetailVM>;
type ReloadDraft = () => Promise<IssuerCredentialDetailVM>;
type HandleTerminalError = (feedback: CredentialFeedback) => void;

function detailFixture(
  type: CredentialType = 'course',
  subjectOverrides: Partial<
    IssuerCredentialDetailVM['credentialSubject']
  > = {}
): IssuerCredentialDetailVM {
  return {
    credentialReference: 'credential-internal-reference',
    title: 'Arquitectura de Software',
    description: 'Descripción inicial',
    hours: '24.00',
    type,
    typeLabel: 'Tipo de prueba',
    status: 'draft',
    statusLabel: 'Borrador',
    issuer: {
      displayName: 'Universidad Seleccionada',
      did: null
    },
    credentialSubject: {
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
      ...subjectOverrides
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder@example.com',
      did: null
    },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T13:00:00.000Z'
  };
}

function renderEditor(options?: {
  detail?: IssuerCredentialDetailVM;
  onReloadLatest?: ReloadDraft;
  onSave?: SaveDraft;
  onTerminalError?: HandleTerminalError;
}) {
  const detail = options?.detail ?? detailFixture();
  const onSave =
    options?.onSave ?? vi.fn<SaveDraft>().mockResolvedValue(detail);
  const onReloadLatest =
    options?.onReloadLatest ??
    vi.fn<ReloadDraft>().mockResolvedValue(detail);
  const onTerminalError =
    options?.onTerminalError ?? vi.fn<HandleTerminalError>();

  render(
    <CredentialDraftEditorForm
      detail={detail}
      issuerReference="issuer-internal-reference"
      onSave={onSave}
      onReloadLatest={onReloadLatest}
      onTerminalError={onTerminalError}
    />
  );

  return { detail, onReloadLatest, onSave, onTerminalError };
}

describe('CredentialDraftEditorForm', () => {
  it('renders common and course fields with an initially disabled save', () => {
    renderEditor();

    expect(screen.getByLabelText('Tipo de credencial')).toBeTruthy();
    expect(screen.getByLabelText('Nombre del logro')).toBeTruthy();
    expect(screen.getByLabelText('Descripción')).toBeTruthy();
    expect(screen.getByLabelText('Horas')).toBeTruthy();
    expect(screen.getByLabelText('Fecha de finalización')).toBeTruthy();
    expect(screen.getByLabelText('Proveedor')).toBeTruthy();
    expect(screen.getByLabelText('Plataforma')).toBeTruthy();
    expect(screen.getByLabelText('Modalidad')).toBeTruthy();
    expect(screen.getByLabelText('Nivel')).toBeTruthy();
    expect(screen.getByLabelText('Skills')).toBeTruthy();
    expect(screen.getByLabelText('Competencias')).toBeTruthy();
    expect(screen.getByLabelText('Resultados de aprendizaje')).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: 'Guardar cambios'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(document.body.textContent).not.toMatch(
      /readiness|emitir|pdf|blockchain|análisis ia/i
    );
    expect(document.body.textContent).not.toContain(
      'credential-internal-reference'
    );
    expect(document.body.textContent).not.toContain(
      'issuer-internal-reference'
    );
  });

  it.each([
    ['academic_subject', 'Fecha de aprobación', 'Período académico'],
    ['course', 'Fecha de finalización', 'Plataforma'],
    ['certification', 'Fecha de obtención', 'Código de certificación'],
    ['degree', 'Fecha de graduación', 'Programa o carrera']
  ] as const)(
    'renders the controlled fields for %s',
    (type, dateLabel, specificLabel) => {
      renderEditor({ detail: detailFixture(type) });

      expect(screen.getByLabelText(dateLabel)).toBeTruthy();
      expect(screen.getByLabelText(specificLabel)).toBeTruthy();
    }
  );

  it('changes type directly when there is no incompatible populated data', () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });

    expect(screen.queryByText('Revisá el cambio de tipo')).toBeNull();
    expect(screen.getByLabelText('Código de certificación')).toBeTruthy();
    expect(screen.queryByLabelText('Plataforma')).toBeNull();
    expect(
      (screen.getByRole('button', {
        name: 'Guardar cambios'
      }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('asks before clearing incompatible data and does not patch automatically', () => {
    const onSave = vi.fn();
    renderEditor({
      detail: detailFixture('course', {
        platformName: 'Campus Virtual',
        learningOutcomes: ['Documentar decisiones']
      }),
      onSave
    });

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });

    expect(screen.getByText('Revisá el cambio de tipo')).toBeTruthy();
    expect(
      (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
        .value
    ).toBe('course');
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar tipo' }));

    expect(
      (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
        .value
    ).toBe('certification');
    expect(screen.queryByLabelText('Plataforma')).toBeNull();
    expect(screen.queryByLabelText('Resultados de aprendizaje')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancels a pending type change without clearing values', () => {
    renderEditor({
      detail: detailFixture('course', { platformName: 'Campus Virtual' })
    });

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(
      (screen.getByLabelText('Tipo de credencial') as HTMLSelectElement)
        .value
    ).toBe('course');
    expect(
      (screen.getByLabelText('Plataforma') as HTMLInputElement).value
    ).toBe('Campus Virtual');
  });

  it('saves a sparse command with the last accepted updatedAt and resets dirty state', async () => {
    const detail = detailFixture();
    const saved = {
      ...detail,
      title: 'Arquitectura Aplicada',
      updatedAt: '2026-07-30T14:00:00.000Z',
      credentialSubject: {
        ...detail.credentialSubject,
        achievementName: 'Arquitectura Aplicada'
      }
    };
    const onSave = vi.fn().mockResolvedValue(saved);
    renderEditor({ detail, onSave });

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Arquitectura Aplicada' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({
      issuerReference: 'issuer-internal-reference',
      credentialReference: 'credential-internal-reference',
      expectedUpdatedAt: '2026-07-30T13:00:00.000Z',
      achievementName: 'Arquitectura Aplicada'
    });
    expect(await screen.findByText('Cambios guardados')).toBeTruthy();
    expect(
      (screen.getByLabelText('Nombre del logro') as HTMLInputElement).value
    ).toBe('Arquitectura Aplicada');
    expect(
      (screen.getByRole('button', {
        name: 'Guardar cambios'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('prevents duplicate submits while a save is pending', async () => {
    const onSave = vi.fn().mockReturnValue(new Promise(() => undefined));
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Descripción actualizada' }
    });
    const saveButton = screen.getByRole('button', {
      name: 'Guardar cambios'
    });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(
      (screen.getByRole('button', {
        name: 'Guardando…'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('keeps edited values on a 400 response', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('upstream detail', 'http', 400));
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Descripción local' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Revisá los datos del borrador e intentá nuevamente.')
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Descripción local');
  });

  it('preserves local changes on 409 and reloads only after explicit confirmation', async () => {
    const detail = detailFixture();
    const latest = {
      ...detail,
      description: 'Versión guardada por otra sesión',
      updatedAt: '2026-07-30T15:00:00.000Z'
    };
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('conflict', 'http', 409));
    const onReloadLatest = vi.fn().mockResolvedValue(latest);
    renderEditor({ detail, onReloadLatest, onSave });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Mi versión local' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText('Este borrador fue actualizado desde otra sesión.')
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Mi versión local');
    expect(onReloadLatest).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Recargar última versión' })
    );

    await waitFor(() => expect(onReloadLatest).toHaveBeenCalledOnce());
    expect(
      (screen.getByLabelText('Descripción') as HTMLTextAreaElement).value
    ).toBe('Versión guardada por otra sesión');
  });

  it('moves terminal authorization errors out of the partial editor', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new ApiError('forbidden', 'http', 403));
    const onTerminalError = vi.fn();
    renderEditor({ onSave, onTerminalError });

    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Cambio local' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onTerminalError).toHaveBeenCalledOnce());
    expect(onTerminalError).toHaveBeenCalledWith({
      code: 'forbidden',
      message: 'No tenés permisos para operar con esta institución.'
    });
  });

  it('focuses the first invalid common field and never submits it', () => {
    const onSave = vi.fn();
    renderEditor({ onSave });

    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: ' ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(document.activeElement).toBe(
      screen.getByLabelText('Nombre del logro')
    );
    expect(screen.getByText('Ingresá el nombre del logro.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});
