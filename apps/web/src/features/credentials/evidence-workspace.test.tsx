import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it } from 'vitest';

import { DocumentEvidenceSection } from '@/features/credentials/document-evidence-section';
import { EvidenceWorkspace } from '@/features/credentials/evidence-workspace';
import { TextEvidenceSection } from '@/features/credentials/text-evidence-section';
import type {
  DocumentEvidenceVM,
  TextEvidenceVM
} from '@/models/credentials';

describe('EvidenceWorkspace', () => {
  it('defaults to both composers when document and textual evidence are editable', () => {
    renderWorkspace();

    expect(
      (screen.getByRole('radio', { name: 'Ambas' }) as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(screen.getByLabelText('Seleccionar archivo de evidencia')).toBeTruthy();
    expect(screen.getByLabelText('Contenido de respaldo')).toBeTruthy();
  });

  it('shows only the requested composer without hiding persisted evidence', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('radio', { name: 'Documental' }));

    expect(screen.getByLabelText('Seleccionar archivo de evidencia')).toBeTruthy();
    expect(
      screen.getByLabelText('Contenido de respaldo').closest('[hidden]')
    ).toBeTruthy();
    expect(screen.getByText('Documento vigente')).toBeTruthy();
    expect(screen.getByText('Temario vigente')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Textual' }));

    expect(
      screen
        .getByLabelText('Seleccionar archivo de evidencia')
        .closest('[hidden]')
    ).toBeTruthy();
    expect(screen.getByLabelText('Contenido de respaldo')).toBeTruthy();
    expect(screen.getByText('Documento vigente')).toBeTruthy();
    expect(screen.getByText('Temario vigente')).toBeTruthy();
  });

  it('preserves the textual draft while its composer is visually hidden', () => {
    renderWorkspace();
    const content = screen.getByLabelText(
      'Contenido de respaldo'
    ) as HTMLTextAreaElement;

    fireEvent.change(content, { target: { value: 'Temario institucional' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Documental' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Textual' }));

    expect(
      (screen.getByLabelText('Contenido de respaldo') as HTMLTextAreaElement)
        .value
    ).toBe('Temario institucional');
  });

  it('changes only local presentation state and never calls evidence mutations', () => {
    let uploadCalls = 0;
    let submitCalls = 0;
    const onUpload = async (_file: File): Promise<DocumentEvidenceVM> => {
      void _file;
      uploadCalls += 1;
      throw new Error('This test does not submit evidence.');
    };
    const onSubmit = async (_command: {
      label: string | null;
      content: string;
    }): Promise<TextEvidenceVM> => {
      void _command;
      submitCalls += 1;
      throw new Error('This test does not submit evidence.');
    };
    renderWorkspace({ onSubmit, onUpload });

    fireEvent.click(screen.getByRole('radio', { name: 'Documental' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Textual' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Ambas' }));

    expect(uploadCalls).toBe(0);
    expect(submitCalls).toBe(0);
  });

  it('keeps declared capabilities with the textual composer and preserves all local values between modes', async () => {
    render(<WorkspaceWithDeclaredCapabilities />);

    expect(
      await screen.findByRole('heading', {
        name: 'Capacidades declaradas por la institución'
      })
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Contenido de respaldo'), {
      target: { value: 'Programa institucional' }
    });
    fireEvent.change(screen.getByLabelText('Habilidades técnicas (opcional)'), {
      target: { value: 'SQL' }
    });
    fireEvent.change(screen.getByLabelText('Competencias formativas (opcional)'), {
      target: { value: 'Resolver problemas' }
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Documental' }));
    expect(
      screen
        .getByRole('heading', {
          hidden: true,
          name: 'Capacidades declaradas por la institución'
        })
        .closest('[hidden]')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Textual' }));
    expect(
      (screen.getByLabelText('Contenido de respaldo') as HTMLTextAreaElement)
        .value
    ).toBe('Programa institucional');
    expect(
      (screen.getByLabelText(
        'Habilidades técnicas (opcional)'
      ) as HTMLTextAreaElement).value
    ).toBe('SQL');
    expect(
      (screen.getByLabelText(
        'Competencias formativas (opcional)'
      ) as HTMLTextAreaElement).value
    ).toBe('Resolver problemas');

    fireEvent.click(screen.getByRole('radio', { name: 'Ambas' }));
    expect(
      screen.getByRole('heading', {
        name: 'Capacidades declaradas por la institución'
      })
    ).toBeTruthy();
  });
});

function WorkspaceWithDeclaredCapabilities() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [skills, setSkills] = useState('');
  const [competencies, setCompetencies] = useState('');

  return (
    <>
      <EvidenceWorkspace
        canComposeDocument
        canComposeText
        documentCurrent={null}
        documentComposer={
          <DocumentEvidenceSection
            credentialStatus="draft"
            currentDocument={null}
            display="composer"
            onUpload={async () => {
              throw new Error('This test does not upload evidence.');
            }}
            showHeading={false}
          />
        }
        onTextualCapabilitiesTargetChange={setTarget}
        textCurrent={null}
        textComposer={
          <TextEvidenceSection
            credentialStatus="draft"
            currentText={null}
            display="composer"
            onSubmit={async () => {
              throw new Error('This test does not submit evidence.');
            }}
            showHeading={false}
          />
        }
      />
      {target
        ? createPortal(
            <section aria-labelledby="declared-capabilities-title">
              <h3 id="declared-capabilities-title">
                Capacidades declaradas por la institución
              </h3>
              <label htmlFor="declared-skills">Habilidades técnicas (opcional)</label>
              <textarea
                id="declared-skills"
                value={skills}
                onChange={(event) => setSkills(event.target.value)}
              />
              <label htmlFor="declared-competencies">
                Competencias formativas (opcional)
              </label>
              <textarea
                id="declared-competencies"
                value={competencies}
                onChange={(event) => setCompetencies(event.target.value)}
              />
            </section>,
            target
          )
        : null}
    </>
  );
}

function renderWorkspace({
  onSubmit = async () => {
    throw new Error('This test does not submit evidence.');
  },
  onUpload = async () => {
    throw new Error('This test does not upload evidence.');
  }
}: {
  onSubmit?: (command: {
    label: string | null;
    content: string;
  }) => Promise<TextEvidenceVM>;
  onUpload?: (file: File) => Promise<DocumentEvidenceVM>;
} = {}) {
  render(
    <EvidenceWorkspace
      canComposeDocument
      canComposeText
      documentCurrent={<p>Documento vigente</p>}
      documentComposer={
        <DocumentEvidenceSection
          credentialStatus="draft"
          currentDocument={null}
          display="composer"
          onUpload={onUpload}
          showHeading={false}
        />
      }
      textCurrent={<p>Temario vigente</p>}
      textComposer={
        <TextEvidenceSection
          credentialStatus="draft"
          currentText={null}
          display="composer"
          onSubmit={onSubmit}
          showHeading={false}
        />
      }
    />
  );
}
