import {
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TextEvidenceSection } from '@/features/credentials/text-evidence-section';
import { ApiError } from '@/lib/errors/api-error';
import type { TextEvidenceVM } from '@/models/credentials';

const hash = 'a1b2c3d4e5f6'.padEnd(56, '0') + '9a8b7c6d';

function textEvidenceFixture(
  overrides: Partial<TextEvidenceVM> = {}
): TextEvidenceVM {
  const content = overrides.content ?? 'Línea uno\nLínea dos';
  const characterCount = Array.from(content).length;

  return {
    textEvidenceReference: 'text-evidence-internal-reference',
    status: 'current',
    label: 'Temario institucional',
    content,
    characterCount,
    characterCountLabel: `${characterCount} caracteres`,
    sha256: hash,
    sha256Short: 'a1b2c3d4e5f6…9a8b7c6d',
    submittedAt: '2026-08-03T12:00:00.000Z',
    submittedAtLabel: '3 ago 2026, 09:00',
    ...overrides
  };
}

describe('TextEvidenceSection', () => {
  it('renders the honest empty draft form and keeps raw input untouched', () => {
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={null}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Evidencia textual' })).toBeTruthy();
    expect(
      screen.getByText(
        'La evidencia textual se conserva como fuente institucional. No modifica automáticamente los campos oficiales de la credencial.'
      )
    ).toBeTruthy();
    expect(screen.getByLabelText('Nombre de la fuente (opcional)')).toBeTruthy();
    const textarea = screen.getByLabelText(
      'Contenido de respaldo'
    ) as HTMLTextAreaElement;
    const submit = screen.getByRole('button', {
      name: 'Guardar evidencia textual'
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: '  😀\r\nTexto  ' } });

    // Native textareas canonicalize CRLF to LF; the component preserves the
    // remaining raw whitespace instead of trimming on change.
    expect(textarea.value).toBe('  😀\nTexto  ');
    expect(screen.getByText('7 / 50.000 caracteres')).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('normalizes only the submitted command', async () => {
    const onSubmit = vi.fn().mockResolvedValue(textEvidenceFixture());
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={null}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Nombre de la fuente (opcional)'), {
      target: { value: '  Temario\u00A0 institucional  ' }
    });
    fireEvent.change(screen.getByLabelText('Contenido de respaldo'), {
      target: { value: '  Línea uno\r\nLínea dos  ' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar evidencia textual' })
    );

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      label: 'Temario institucional',
      content: 'Línea uno\nLínea dos'
    });
    expect(await screen.findByText('Evidencia textual actualizada')).toBeTruthy();
  });

  it('blocks oversized Unicode content and associates the error', () => {
    const onSubmit = vi.fn();
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={null}
        onSubmit={onSubmit}
      />
    );

    const textarea = screen.getByLabelText('Contenido de respaldo');
    fireEvent.change(textarea, { target: { value: '😀'.repeat(50_001) } });

    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('50.001 / 50.000 caracteres')).toBeTruthy();
    expect(
      screen.getByText('El contenido supera el máximo de 50.000 caracteres.')
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Guardar evidencia textual'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders current content literally with line breaks and no internal reference', () => {
    const content = '<script>alert("x")</script>\nSegunda línea';
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={textEvidenceFixture({ content })}
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByLabelText('Contenido de la fuente textual').textContent
    ).toBe(content);
    expect(document.querySelector('script')).toBeNull();
    expect(document.body.textContent).not.toContain(
      'text-evidence-internal-reference'
    );
    expect(screen.getByText('Temario institucional')).toBeTruthy();
    expect(screen.getByText('Texto vigente')).toBeTruthy();
  });

  it('uses an honest fallback when the current source has no label', () => {
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={textEvidenceFixture({ label: null })}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText('Fuente institucional sin nombre')).toBeTruthy();
  });

  it('collapses and expands long text without changing it', () => {
    const content = 'Línea extensa\n'.repeat(13) + 'Final';
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={textEvidenceFixture({ content })}
        onSubmit={vi.fn()}
      />
    );

    const toggle = screen.getByRole('button', { name: 'Ver texto completo' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain('Final');

    fireEvent.click(toggle);

    expect(
      screen
        .getByRole('button', { name: 'Ocultar texto' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(document.body.textContent).toContain('Final');
  });

  it('opens an explicit empty replacement form and can cancel it', () => {
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={textEvidenceFixture()}
        onSubmit={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Reemplazar evidencia textual' })
    );
    expect(screen.getByText('Reemplazo pendiente')).toBeTruthy();
    expect(
      (screen.getByLabelText('Contenido de respaldo') as HTMLTextAreaElement)
        .value
    ).toBe('');
    expect(
      screen.getByLabelText('Contenido de la fuente textual').textContent
    ).toBe('Línea uno\nLínea dos');

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancelar reemplazo' })
    );
    expect(screen.queryByLabelText('Contenido de respaldo')).toBeNull();
    expect(
      screen.getByLabelText('Contenido de la fuente textual').textContent
    ).toBe('Línea uno\nLínea dos');
  });

  it('prevents a double replacement submit', async () => {
    let resolveSubmission: ((value: TextEvidenceVM) => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<TextEvidenceVM>((resolve) => {
          resolveSubmission = resolve;
        })
    );
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={textEvidenceFixture()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Reemplazar evidencia textual' })
    );
    fireEvent.change(screen.getByLabelText('Contenido de respaldo'), {
      target: { value: 'Nueva fuente' }
    });
    const submit = screen.getByRole('button', { name: 'Confirmar reemplazo' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByText('Guardando evidencia textual…')).toBeTruthy();
    resolveSubmission?.(textEvidenceFixture({ content: 'Nueva fuente' }));
    await screen.findByText('Evidencia textual actualizada');
  });

  it.each([
    [400, 'Revisá el texto ingresado e intentá nuevamente.'],
    [409, 'La evidencia textual solo puede modificarse mientras la credencial está en borrador.']
  ])('preserves replacement input after HTTP %i', async (status, message) => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError('private detail', 'http', status));
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={textEvidenceFixture()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Reemplazar evidencia textual' })
    );
    fireEvent.change(screen.getByLabelText('Contenido de respaldo'), {
      target: { value: 'Texto para reintentar' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar reemplazo' })
    );

    expect(await screen.findByText(message)).toBeTruthy();
    expect(
      (screen.getByLabelText('Contenido de respaldo') as HTMLTextAreaElement)
        .value
    ).toBe('Texto para reintentar');
    expect(
      screen.getByLabelText('Contenido de la fuente textual').textContent
    ).toBe('Línea uno\nLínea dos');
  });

  it('preserves text and uses the recovery message after network failure', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError('private detail', 'network'));
    render(
      <TextEvidenceSection
        credentialStatus="draft"
        currentText={null}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByLabelText('Contenido de respaldo'), {
      target: { value: 'Texto conservado' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar evidencia textual' })
    );

    expect(
      await screen.findByText(
        'No pudimos conectarnos con el servicio. Conservamos el texto para que puedas reintentar.'
      )
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('Contenido de respaldo') as HTMLTextAreaElement)
        .value
    ).toBe('Texto conservado');
  });

  it.each(['issued', 'revoked'] as const)(
    'renders %s evidence read-only',
    (credentialStatus) => {
      render(
        <TextEvidenceSection
          credentialStatus={credentialStatus}
          currentText={textEvidenceFixture()}
          onSubmit={vi.fn()}
        />
      );

      expect(screen.getByText('Fuente textual actual')).toBeTruthy();
      expect(
        screen.getByText(
          'La evidencia textual solo puede modificarse mientras la credencial está en borrador.'
        )
      ).toBeTruthy();
      expect(screen.queryByLabelText('Contenido de respaldo')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Reemplazar evidencia textual' })
      ).toBeNull();
    }
  );

  it.each(['issued', 'revoked'] as const)(
    'shows an honest empty state for %s without editing controls',
    (credentialStatus) => {
      render(
        <TextEvidenceSection
          credentialStatus={credentialStatus}
          currentText={null}
          onSubmit={vi.fn()}
        />
      );

      expect(screen.getByText('No hay evidencia textual registrada.')).toBeTruthy();
      expect(screen.queryByLabelText('Contenido de respaldo')).toBeNull();
    }
  );
});
