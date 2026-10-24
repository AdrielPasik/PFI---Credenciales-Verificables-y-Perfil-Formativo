import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DocumentEvidenceSection } from '@/features/credentials/document-evidence-section';
import { EvidenceWorkspace } from '@/features/credentials/evidence-workspace';
import { TextEvidenceSection } from '@/features/credentials/text-evidence-section';
import type {
  DocumentEvidenceVM,
  TextEvidenceVM
} from '@/models/credentials';

describe('EvidenceWorkspace', () => {
  it('starts compact: optional, nothing loaded and both composers folded', () => {
    renderWorkspace();

    expect(
      screen.getByRole('heading', { name: 'Fuentes de respaldo' })
    ).toBeTruthy();
    expect(screen.getByText('Opcional')).toBeTruthy();
    expect(screen.getByText('Sin fuentes cargadas.')).toBeTruthy();

    for (const name of ['Agregar documento', 'Agregar fuente textual']) {
      expect(
        screen.getByRole('button', { name }).getAttribute('aria-expanded')
      ).toBe('false');
    }
    expect(
      screen.getByLabelText('Seleccionar archivo de evidencia').closest('[hidden]')
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Contenido de respaldo').closest('[hidden]')
    ).toBeTruthy();
    // El selector Documental / Textual / Ambas ya no existe.
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('opens each composer independently and links the button to its panel', () => {
    renderWorkspace();
    const documentToggle = screen.getByRole('button', {
      name: 'Agregar documento'
    });
    const textToggle = screen.getByRole('button', {
      name: 'Agregar fuente textual'
    });

    fireEvent.click(documentToggle);

    expect(documentToggle.getAttribute('aria-expanded')).toBe('true');
    expect(textToggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.getByLabelText('Seleccionar archivo de evidencia').closest('[hidden]')
    ).toBeNull();
    expect(
      screen.getByLabelText('Contenido de respaldo').closest('[hidden]')
    ).toBeTruthy();
    const panelId = documentToggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).toBeTruthy();

    fireEvent.click(textToggle);
    expect(
      screen.getByLabelText('Contenido de respaldo').closest('[hidden]')
    ).toBeNull();

    fireEvent.click(documentToggle);
    expect(documentToggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.getByLabelText('Contenido de respaldo').closest('[hidden]')
    ).toBeNull();
  });

  it('keeps persisted sources visible and identifiable while the composers are folded', () => {
    renderWorkspace({ withCurrent: true });

    expect(screen.getByText('Fuentes cargadas')).toBeTruthy();
    expect(screen.getByText('Documento vigente')).toBeTruthy();
    expect(screen.getByText('Temario vigente')).toBeTruthy();
    expect(screen.queryByText('Sin fuentes cargadas.')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Cambiar documento' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Cambiar fuente textual' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agregar documento' })).toBeNull();
  });

  it('preserves the unsaved textual draft across folding and unfolding, and says so when folded', () => {
    renderWorkspace();
    const toggle = screen.getByRole('button', { name: 'Agregar fuente textual' });

    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('Contenido de respaldo'), {
      target: { value: 'Temario institucional' }
    });
    fireEvent.change(screen.getByLabelText('Nombre de la fuente (opcional)'), {
      target: { value: 'Programa 2026' }
    });

    // Abierto: el propio formulario ya muestra el texto, sin aviso aparte.
    expect(screen.queryByText('Tenés cambios sin guardar')).toBeNull();

    fireEvent.click(toggle);

    // Plegado: el texto sigue ahi, y el pliegue NO lo esconde en silencio.
    expect(screen.getByRole('status').textContent).toBe(
      'Tenés cambios sin guardar'
    );
    expect(
      screen.getByLabelText('Contenido de respaldo').closest('[hidden]')
    ).toBeTruthy();

    fireEvent.click(toggle);

    expect(screen.queryByText('Tenés cambios sin guardar')).toBeNull();
    expect(
      (screen.getByLabelText('Contenido de respaldo') as HTMLTextAreaElement)
        .value
    ).toBe('Temario institucional');
    expect(
      (screen.getByLabelText('Nombre de la fuente (opcional)') as HTMLInputElement)
        .value
    ).toBe('Programa 2026');
  });

  it('keeps a chosen file and flags it when the document composer is folded', () => {
    renderWorkspace();
    const toggle = screen.getByRole('button', { name: 'Agregar documento' });

    fireEvent.click(toggle);
    const file = new File(['%PDF-1.4'], 'programa.pdf', {
      type: 'application/pdf'
    });
    fireEvent.change(screen.getByLabelText('Seleccionar archivo de evidencia'), {
      target: { files: [file] }
    });
    expect(screen.getByText('programa.pdf')).toBeTruthy();

    fireEvent.click(toggle);

    expect(screen.getByRole('status').textContent).toBe(
      'Tenés cambios sin guardar'
    );
    fireEvent.click(toggle);
    expect(screen.getByText('programa.pdf')).toBeTruthy();
  });

  it('only changes local presentation and never calls evidence mutations', () => {
    let uploadCalls = 0;
    let submitCalls = 0;
    renderWorkspace({
      onSubmit: async () => {
        submitCalls += 1;
        throw new Error('This test does not submit evidence.');
      },
      onUpload: async () => {
        uploadCalls += 1;
        throw new Error('This test does not upload evidence.');
      }
    });

    for (const name of ['Agregar documento', 'Agregar fuente textual']) {
      const toggle = screen.getByRole('button', { name });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
    }

    expect(uploadCalls).toBe(0);
    expect(submitCalls).toBe(0);
  });

  it('offers no composer when the credential is not editable', () => {
    renderWorkspace({
      canCompose: false,
      withCurrent: true
    });

    expect(screen.getByText('Documento vigente')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /documento|fuente textual/i })).toBeNull();
    expect(screen.queryByLabelText('Seleccionar archivo de evidencia')).toBeNull();
    expect(screen.queryByText('Sin fuentes cargadas.')).toBeNull();
  });

  it('shows the source priority only when the caller provides it', () => {
    const { unmount } = renderWorkspace({ withPriority: true });

    expect(
      screen.getByText('Qué usa Scope para la interpretación asistida')
    ).toBeTruthy();
    expect(screen.getByText(/Si no hay PDF, una fuente de respaldo textual/)).toBeTruthy();

    unmount();
    renderWorkspace();
    expect(
      screen.queryByText('Qué usa Scope para la interpretación asistida')
    ).toBeNull();
  });
});

function Harness({
  canCompose = true,
  onSubmit,
  onUpload,
  withCurrent = false,
  withPriority = false
}: {
  canCompose?: boolean;
  onSubmit: (command: {
    label: string | null;
    content: string;
  }) => Promise<TextEvidenceVM>;
  onUpload: (file: File) => Promise<DocumentEvidenceVM>;
  withCurrent?: boolean;
  withPriority?: boolean;
}) {
  const [documentAttention, setDocumentAttention] = useState(false);
  const [textAttention, setTextAttention] = useState(false);

  return (
    <EvidenceWorkspace
      canComposeDocument={canCompose}
      canComposeText={canCompose}
      description="Descripción de prueba."
      documentCurrent={withCurrent ? <p>Documento vigente</p> : null}
      documentComposer={
        <DocumentEvidenceSection
          credentialStatus="draft"
          currentDocument={null}
          display="composer"
          onAttentionChange={setDocumentAttention}
          onUpload={onUpload}
          showHeading={false}
        />
      }
      documentNeedsAttention={documentAttention}
      hasDocument={withCurrent}
      hasText={withCurrent}
      sourcePriority={
        withPriority ? (
          <>
            <p>Qué usa Scope para la interpretación asistida</p>
            <ol>
              <li>Si no hay PDF, una fuente de respaldo textual.</li>
            </ol>
          </>
        ) : null
      }
      textComposer={
        <TextEvidenceSection
          credentialStatus="draft"
          currentText={null}
          display="composer"
          onAttentionChange={setTextAttention}
          onSubmit={onSubmit}
          showHeading={false}
        />
      }
      textCurrent={withCurrent ? <p>Temario vigente</p> : null}
      textNeedsAttention={textAttention}
    />
  );
}

function renderWorkspace({
  canCompose,
  onSubmit = async () => {
    throw new Error('This test does not submit evidence.');
  },
  onUpload = async () => {
    throw new Error('This test does not upload evidence.');
  },
  withCurrent,
  withPriority
}: {
  canCompose?: boolean;
  onSubmit?: (command: {
    label: string | null;
    content: string;
  }) => Promise<TextEvidenceVM>;
  onUpload?: (file: File) => Promise<DocumentEvidenceVM>;
  withCurrent?: boolean;
  withPriority?: boolean;
} = {}) {
  return render(
    <Harness
      canCompose={canCompose}
      onSubmit={onSubmit}
      onUpload={onUpload}
      withCurrent={withCurrent}
      withPriority={withPriority}
    />
  );
}
