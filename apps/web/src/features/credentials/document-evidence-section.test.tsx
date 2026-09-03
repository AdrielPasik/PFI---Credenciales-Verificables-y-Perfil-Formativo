import {
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentEvidenceSection } from '@/features/credentials/document-evidence-section';
import { ApiError } from '@/lib/errors/api-error';
import type { DocumentEvidenceVM } from '@/models/credentials';

const hash = 'a1b2c3d4e5f6'.padEnd(56, '0') + '9a8b7c6d';

function documentFixture(
  overrides: Partial<DocumentEvidenceVM> = {}
): DocumentEvidenceVM {
  return {
    evidenceReference: 'evidence-internal-reference',
    kind: 'pdf',
    status: 'current',
    originalFileName: 'programa.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1536,
    sizeLabel: '1,5 KB',
    sha256: hash,
    sha256Short: 'a1b2c3d4e5f6…9a8b7c6d',
    uploadedAt: '2026-08-03T12:00:00.000Z',
    uploadedAtLabel: '3 ago 2026, 09:00',
    ...overrides
  };
}

function selectFile(name: string, type: string, content = 'document') {
  const input = screen.getByLabelText(
    'Seleccionar archivo de evidencia'
  ) as HTMLInputElement;
  const file = new File([content], name, { type });

  fireEvent.change(input, { target: { files: [file] } });

  return { file, input };
}

describe('DocumentEvidenceSection', () => {
  it('renders the accessible draft empty state and keeps upload disabled without a file', () => {
    render(
      <DocumentEvidenceSection
        credentialStatus="draft"
        currentDocument={null}
        onUpload={vi.fn()}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Evidencia documental' })
    ).toBeTruthy();
    expect(
      screen.getByText(
        'La evidencia respalda el borrador. Si hay un PDF vigente, Scope intentará analizarlo automáticamente al emitir.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('Formatos: PDF, PNG o JPEG · Tamaño máximo: 20 MB')
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: 'Subir evidencia'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      screen
        .getByLabelText('Seleccionar archivo de evidencia')
        .getAttribute('accept')
    ).toBe('.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg');
  });

  it('shows selected metadata, prevents double submit and clears the input on success', async () => {
    let resolveUpload: ((value: DocumentEvidenceVM) => void) | undefined;
    const onUpload = vi.fn(
      () =>
        new Promise<DocumentEvidenceVM>((resolve) => {
          resolveUpload = resolve;
        })
    );
    render(
      <DocumentEvidenceSection
        credentialStatus="draft"
        currentDocument={null}
        onUpload={onUpload}
      />
    );
    const { file, input } = selectFile(
      'programa.pdf',
      'application/pdf'
    );
    const button = screen.getByRole('button', { name: 'Subir evidencia' });

    expect(screen.getByText('programa.pdf')).toBeTruthy();
    expect(screen.getByText('8 bytes')).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onUpload).toHaveBeenCalledOnce();
    expect(onUpload).toHaveBeenCalledWith(file);
    expect(screen.getByText('Subiendo evidencia…')).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: 'Subiendo evidencia'
      }) as HTMLButtonElement).disabled
    ).toBe(true);

    resolveUpload?.(documentFixture());
    expect(await screen.findByText('Evidencia actualizada')).toBeTruthy();
    expect(input.value).toBe('');
  });

  it('blocks an invalid file locally without calling upload', () => {
    const onUpload = vi.fn();
    render(
      <DocumentEvidenceSection
        credentialStatus="draft"
        currentDocument={null}
        onUpload={onUpload}
      />
    );

    selectFile('notas.txt', 'text/plain');

    expect(
      screen
        .getByText('El formato no es compatible. Usá PDF, PNG o JPEG.')
        .getAttribute('role')
    ).toBe('alert');
    expect(
      (screen.getByRole('button', {
        name: 'Subir evidencia'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('shows only safe current metadata and never renders references as product content', () => {
    render(
      <DocumentEvidenceSection
        credentialStatus="draft"
        currentDocument={documentFixture()}
        onUpload={vi.fn()}
      />
    );

    expect(screen.getByText('Documento actual')).toBeTruthy();
    expect(screen.getByText('programa.pdf')).toBeTruthy();
    expect(screen.getByText('Documento PDF')).toBeTruthy();
    expect(screen.getByText('1,5 KB')).toBeTruthy();
    expect(
      screen
        .getByText('a1b2c3d4e5f6…9a8b7c6d')
        .getAttribute('title')
    ).toBe(hash);
    expect(screen.queryByRole('link', { name: 'programa.pdf' })).toBeNull();
    expect(document.body.textContent).not.toContain(
      'evidence-internal-reference'
    );
    expect(document.body.textContent).not.toMatch(
      /storageKey|storageProvider|uploadedByUserId|credentialId/
    );
  });

  it('requires explicit replacement and cancel keeps the current evidence', () => {
    const onUpload = vi.fn();
    render(
      <DocumentEvidenceSection
        credentialStatus="draft"
        currentDocument={documentFixture()}
        onUpload={onUpload}
      />
    );

    expect(
      screen.queryByLabelText('Seleccionar archivo de evidencia')
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reemplazar evidencia' })
    );
    selectFile('nueva.png', 'image/png');

    expect(screen.getByText('Selección pendiente')).toBeTruthy();
    expect(
      screen.getByText(
        'Este documento pasará a ser la evidencia vigente. La evidencia anterior se conservará en el historial institucional.'
      )
    ).toBeTruthy();
    expect(onUpload).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancelar reemplazo' })
    );

    expect(screen.getByText('programa.pdf')).toBeTruthy();
    expect(screen.queryByText('nueva.png')).toBeNull();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('turns a confirmed replacement into the new current snapshot', async () => {
    const replacement = documentFixture({
      evidenceReference: 'replacement-reference',
      kind: 'image',
      originalFileName: 'constancia.png',
      mimeType: 'image/png'
    });
    const onUpload = vi
      .fn<(file: File) => Promise<DocumentEvidenceVM>>()
      .mockResolvedValue(replacement);

    function Harness() {
      const [current, setCurrent] = useState<DocumentEvidenceVM | null>(
        documentFixture()
      );

      return (
        <DocumentEvidenceSection
          credentialStatus="draft"
          currentDocument={current}
          onUpload={async (file) => {
            const uploaded = await onUpload(file);
            setCurrent(uploaded);
            return uploaded;
          }}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Reemplazar evidencia' })
    );
    selectFile('constancia.png', 'image/png');
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirmar reemplazo' })
    );

    expect(await screen.findByText('constancia.png')).toBeTruthy();
    expect(screen.queryByText('programa.pdf')).toBeNull();
    expect(screen.getByText('Imagen PNG')).toBeTruthy();
    expect(screen.getByText('Evidencia actualizada')).toBeTruthy();
    expect(onUpload).toHaveBeenCalledOnce();
  });

  it.each([
    [413, 'El archivo supera el máximo permitido de 20 MB.'],
    [415, 'El formato no es compatible. Usá PDF, PNG o JPEG.'],
    [409, 'La evidencia solo puede modificarse mientras la credencial está en borrador.']
  ])(
    'keeps the selected file and current evidence after HTTP %i',
    async (status, message) => {
      const onUpload = vi.fn(async () => {
        throw new ApiError('private detail', 'http', status);
      });
      render(
        <DocumentEvidenceSection
          credentialStatus="draft"
          currentDocument={documentFixture()}
          onUpload={onUpload}
        />
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Reemplazar evidencia' })
      );
      const { input } = selectFile('nueva.png', 'image/png');
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmar reemplazo' })
      );

      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.getByText('programa.pdf')).toBeTruthy();
      expect(screen.getByText('nueva.png')).toBeTruthy();
      expect(input.files?.[0]?.name).toBe('nueva.png');
    }
  );

  it.each(['issued', 'revoked'] as const)(
    'renders %s evidence read-only without upload controls',
    (credentialStatus) => {
      render(
        <DocumentEvidenceSection
          credentialStatus={credentialStatus}
          currentDocument={documentFixture()}
          onUpload={vi.fn()}
        />
      );

      expect(screen.getByText('programa.pdf')).toBeTruthy();
      expect(
        screen.getByText(
          'Esta evidencia quedó asociada a la credencial emitida.'
        )
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Las modificaciones de evidencia solo están disponibles mientras la credencial está en borrador.'
        )
      ).toBeTruthy();
      expect(
        screen.queryByLabelText('Seleccionar archivo de evidencia')
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Reemplazar evidencia' })
      ).toBeNull();
    }
  );

  it('shows an honest empty read-only state', () => {
    render(
      <DocumentEvidenceSection
        credentialStatus="issued"
        currentDocument={null}
        onUpload={vi.fn()}
      />
    );

    expect(
      screen.getByText('No hay evidencia documental registrada.')
    ).toBeTruthy();
    expect(
      screen.queryByLabelText('Seleccionar archivo de evidencia')
    ).toBeNull();
  });
});
