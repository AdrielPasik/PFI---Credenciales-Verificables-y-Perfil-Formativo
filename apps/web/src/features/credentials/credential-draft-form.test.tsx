import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CredentialDraftForm } from '@/features/credentials/credential-draft-form';
import { ApiError } from '@/lib/errors/api-error';
import type {
  CredentialType,
  HolderSummaryVM
} from '@/models/credentials';

const holder = {
  holderReference: 'holder-internal-reference',
  email: 'holder@example.com',
  did: 'did:example:holder',
  displayLabel: 'Titular Demo'
};

function renderForm(options?: {
  onResolveHolder?: (email: string) => Promise<HolderSummaryVM>;
  onCreateDraft?: (input: {
    achievementName: string;
    credentialType: CredentialType;
    holder: HolderSummaryVM;
  }) => Promise<void>;
}) {
  const onResolveHolder =
    options?.onResolveHolder ?? vi.fn().mockResolvedValue(holder);
  const onCreateDraft =
    options?.onCreateDraft ?? vi.fn().mockResolvedValue(undefined);

  render(
    <CredentialDraftForm
      issuerName="Universidad Contextual"
      onResolveHolder={onResolveHolder}
      onCreateDraft={onCreateDraft}
    />
  );

  return { onResolveHolder, onCreateDraft };
}

async function resolveVisibleHolder() {
  fireEvent.change(screen.getByLabelText('Email del titular'), {
    target: { value: ' holder@example.com ' }
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Buscar titular' })
  );
  await screen.findByText('Titular Demo');
}

describe('CredentialDraftForm', () => {
  it('shows the four closed credential types with no initial selection', () => {
    renderForm();

    const select = screen.getByLabelText(
      'Tipo de credencial'
    ) as HTMLSelectElement;

    expect(select.value).toBe('');
    expect(
      Array.from(select.options).map((option) => option.textContent)
    ).toEqual([
      'Seleccioná un tipo',
      'Curso',
      'Certificación',
      'Asignatura académica',
      'Título académico'
    ]);
  });

  it('requires a valid email and focuses the field', () => {
    const { onResolveHolder } = renderForm();
    const email = screen.getByLabelText('Email del titular');

    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );

    expect(
      screen.getByText('Ingresá el correo electrónico del titular.')
    ).toBeTruthy();
    expect(email).toBe(document.activeElement);
    expect(onResolveHolder).not.toHaveBeenCalled();

    fireEvent.change(email, { target: { value: 'invalid-email' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );
    expect(
      screen.getByText('Ingresá un correo electrónico válido.')
    ).toBeTruthy();
    expect(onResolveHolder).not.toHaveBeenCalled();
  });

  it('normalizes email and shows only the safe holder summary', async () => {
    const { onResolveHolder } = renderForm({
      onResolveHolder: vi.fn().mockResolvedValue({
        ...holder,
        did: null
      })
    });

    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: ' HOLDER@EXAMPLE.COM ' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );

    await waitFor(() => {
      expect(onResolveHolder).toHaveBeenCalledWith('holder@example.com');
    });
    expect(await screen.findByText('Titular Demo')).toBeTruthy();
    expect(screen.getByText('holder@example.com')).toBeTruthy();
    expect(screen.getByText('DID no disponible')).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      'holder-internal-reference'
    );
  });

  it('clears a previous resolution when changing holder', async () => {
    renderForm();
    await resolveVisibleHolder();

    fireEvent.click(
      screen.getByRole('button', { name: 'Cambiar titular' })
    );

    expect(screen.queryByText('Titular Demo')).toBeNull();
    await waitFor(() => {
      expect(screen.getByLabelText('Email del titular')).toBe(
        document.activeElement
      );
    });
  });

  it('shows the issuer context as read-only information', () => {
    renderForm();

    expect(screen.getByText('Universidad Contextual')).toBeTruthy();
    expect(screen.getByText('Definida por tu sesión')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Contexto bloqueado');
    expect(
      screen.queryByRole('textbox', { name: /institución/i })
    ).toBeNull();
  });

  it('requires type and achievement, focusing each invalid field', async () => {
    const { onCreateDraft } = renderForm();
    const submit = screen.getByRole('button', {
      name: 'Guardar borrador'
    }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    await resolveVisibleHolder();
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(
      screen.getByText('Seleccioná un tipo de credencial.')
    ).toBeTruthy();
    expect(screen.getByLabelText('Tipo de credencial')).toBe(
      document.activeElement
    );
    expect(onCreateDraft).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });
    fireEvent.click(submit);
    expect(screen.getByText('Ingresá el nombre del logro.')).toBeTruthy();
    expect(screen.getByLabelText('Nombre del logro')).toBe(
      document.activeElement
    );
    expect(onCreateDraft).not.toHaveBeenCalled();
  });

  it('submits normalized achievement data with the resolved holder', async () => {
    const { onCreateDraft } = renderForm();
    await resolveVisibleHolder();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'course' }
    });
    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: '  Arquitectura   de Software  ' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar borrador' })
    );

    await waitFor(() => {
      expect(onCreateDraft).toHaveBeenCalledWith({
        achievementName: 'Arquitectura de Software',
        credentialType: 'course',
        holder
      });
    });
    expect(document.body.textContent).not.toContain(
      'holder-internal-reference'
    );
  });

  it('prevents duplicate draft submissions', async () => {
    const onCreateDraft = vi.fn(
      () => new Promise<void>(() => undefined)
    );
    renderForm({ onCreateDraft });
    await resolveVisibleHolder();

    fireEvent.change(screen.getByLabelText('Tipo de credencial'), {
      target: { value: 'certification' }
    });
    fireEvent.change(screen.getByLabelText('Nombre del logro'), {
      target: { value: 'Arquitectura de Software' }
    });
    const submit = screen.getByRole('button', {
      name: 'Guardar borrador'
    });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Guardando borrador' })
    ).toBeTruthy();
  });

  it('renders the uniform safe 404 without offering user creation', async () => {
    renderForm({
      onResolveHolder: vi
        .fn()
        .mockRejectedValue(new ApiError('private detail', 'http', 404))
    });

    fireEvent.change(screen.getByLabelText('Email del titular'), {
      target: { value: 'missing@example.com' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Buscar titular' })
    );

    expect(
      await screen.findByText(
        'No encontramos un titular disponible con ese correo. Verificá el email o consultá con la institución.'
      )
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('private detail');
    expect(document.body.textContent).not.toContain('Crear usuario');
  });
});
