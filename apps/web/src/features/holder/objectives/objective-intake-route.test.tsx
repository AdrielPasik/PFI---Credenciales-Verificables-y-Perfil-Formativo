/**
 * Flujo completo de intake + revision — P2.3.
 *
 * Los tests de confirmacion son los de mayor prioridad: afirman el CUERPO EXACTO
 * que se manda a F2. El backend no puede detectar una edicion, asi que si esta
 * transformacion se rompiera, el sistema afirmaria un respaldo documental que
 * nadie verifico y nada lo atajaria.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectiveIntakeRoute } from '@/features/holder/objectives/objective-intake-route';
import { ApiError } from '@/lib/errors/api-error';

const mocks = vi.hoisted(() => ({
  propose: vi.fn(),
  create: vi.fn(),
  requestAuthenticated: vi.fn(),
  push: vi.fn()
}));

vi.mock('@/lib/session/session-provider', () => ({
  useSession: () => ({ requestAuthenticated: mocks.requestAuthenticated })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({})
}));

vi.mock('@/lib/api/objectives-api', () => ({
  proposeObjectiveRequirementsRequest: mocks.propose,
  createObjectiveRequest: mocks.create
}));

const RAW = '\n## Requisitos\n\n- Experiencia con Python.\n- Titulo universitario.\n';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'cand_01',
    proposedRequirementText: 'Experiencia con Python.',
    primaryExcerpt: '- Experiencia con Python.',
    excerptRange: { start: 17, end: 42 },
    grounding: 'UNIQUE' as const,
    confirmableAsSourceDerived: true,
    sourceSectionLabel: '## Requisitos',
    isExactDuplicate: false,
    ...overrides
  };
}

function proposalWith(candidates: ReturnType<typeof candidate>[], unresolved = 0) {
  return { candidates, unresolvedPassageCount: unresolved };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.propose.mockResolvedValue(proposalWith([candidate()]));
  mocks.create.mockResolvedValue({ objectiveReference: 'obj-1' });
});

function fillIntake(
  options: { title?: string; text?: string; type?: string } = {}
) {
  fireEvent.click(screen.getByRole('radio', { name: options.type ?? 'Busqueda laboral' }));
  fireEvent.change(screen.getByLabelText('Nombre del objetivo'), {
    target: { value: options.title ?? 'Backend Engineer' }
  });
  fireEvent.change(screen.getByLabelText('Texto del objetivo'), {
    target: { value: options.text ?? RAW }
  });
}

function analyze() {
  fireEvent.click(screen.getByRole('button', { name: 'Analizar objetivo' }));
}

async function reachReview() {
  render(<ObjectiveIntakeRoute />);
  fillIntake();
  analyze();
  await screen.findByRole('heading', { name: 'Revisa los requisitos' });
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

describe('intake', () => {
  it('keeps the objective flow inside the Holder breadcrumb hierarchy', () => {
    render(<ObjectiveIntakeRoute />);

    expect(screen.getByRole('navigation', { name: 'Ubicacion' })).toBeTruthy();
    expect(screen.getAllByText('Mi perfil formativo').length).toBeGreaterThan(0);
    expect(screen.getByText('Nuevo objetivo')).toBeTruthy();
  });

  it('exige tipo, nombre y texto antes de tocar la red', async () => {
    render(<ObjectiveIntakeRoute />);
    analyze();
    expect(await screen.findByText('Elegi el tipo de objetivo.')).toBeTruthy();
    expect(mocks.propose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: 'Beca' }));
    analyze();
    expect(await screen.findByText('Ponele un nombre al objetivo.')).toBeTruthy();
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it('envia exactamente los tres campos del contrato', async () => {
    render(<ObjectiveIntakeRoute />);
    fillIntake();
    analyze();

    await waitFor(() => expect(mocks.propose).toHaveBeenCalledTimes(1));
    const body = mocks.propose.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual([
      'objectiveType',
      'rawObjectiveText',
      'title'
    ]);
    expect(body.objectiveType).toBe('EMPLOYMENT');
  });

  // Nota: un <textarea> normaliza CRLF a LF por especificacion HTML (su "API
  // value" siempre usa LF), asi que el CRLF nunca llega a nuestro codigo. Lo que
  // si depende de nosotros —LF inicial y final, espacios al borde, caracteres
  // astrales— se verifica aca; la preservacion byte a byte del snapshot esta
  // cubierta en review-draft.test.ts.
  it('manda el texto VERBATIM: LF inicial y final, espacios y caracteres astrales', async () => {
    const tricky = '\n\u{1F680} Requisitos\n- Experiencia.\n  \n';
    render(<ObjectiveIntakeRoute />);
    fillIntake({ text: tricky });
    analyze();

    await waitFor(() => expect(mocks.propose).toHaveBeenCalledTimes(1));
    expect(mocks.propose.mock.calls[0][1].rawObjectiveText).toBe(tricky);
  });

  it('un doble clic produce UNA sola peticion', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.propose.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<ObjectiveIntakeRoute />);
    fillIntake();
    // El boton cambia de etiqueta al cargar, asi que se toma UNA vez.
    const button = screen.getByRole('button', { name: 'Analizar objetivo' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mocks.propose).toHaveBeenCalledTimes(1);
    resolve(proposalWith([candidate()]));
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });
  });

  it('muestra el estado largo sin porcentaje inventado', async () => {
    mocks.propose.mockReturnValue(new Promise(() => {}));
    render(<ObjectiveIntakeRoute />);
    fillIntake();
    analyze();

    expect(await screen.findByText('Identificando requisitos...')).toBeTruthy();
    expect(screen.getByText('Puede tardar hasta un minuto.')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    expect((screen.getByLabelText('Texto del objetivo') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('un error conserva todo lo escrito', async () => {
    mocks.propose.mockRejectedValue(new ApiError('x', 'http', 503));
    render(<ObjectiveIntakeRoute />);
    fillIntake();
    analyze();

    expect(
      await screen.findByText('El servicio no esta disponible en este momento.')
    ).toBeTruthy();
    expect((screen.getByLabelText('Texto del objetivo') as HTMLTextAreaElement).value).toBe(RAW);
    expect((screen.getByLabelText('Nombre del objetivo') as HTMLInputElement).value).toBe(
      'Backend Engineer'
    );
  });

  it('traduce cada error sin nombrar proveedor ni modelo', async () => {
    const cases: Array<[number, string]> = [
      [400, 'Revisa los datos del objetivo antes de analizarlo.'],
      [413, /demasiado largo para analizarlo de una vez/ as unknown as string],
      [422, /propuesta confiable/ as unknown as string],
      [503, 'El servicio no esta disponible en este momento.']
    ];

    for (const [status, expected] of cases) {
      vi.clearAllMocks();
      mocks.propose.mockRejectedValue(new ApiError('private', 'http', status));
      const view = render(<ObjectiveIntakeRoute />);
      fillIntake();
      analyze();
      await screen.findByText(expected as string | RegExp);
      const body = document.body.textContent ?? '';
      for (const forbidden of ['OpenAI', 'gpt-', 'schema', 'parser', String(status)]) {
        expect(body.includes(forbidden)).toBe(false);
      }
      view.unmount();
    }
  });

  it('mientras una peticion esta en vuelo no se puede lanzar otra', async () => {
    // Esta es la proteccion REAL contra una respuesta obsoleta: la UI congela
    // las entradas y el boton durante el vuelo, asi que no existe camino de
    // usuario que produzca dos propuestas compitiendo.
    //
    // El guard de identidad de peticion (`requestIdRef`) sigue en el codigo como
    // defensa en profundidad para el desmontaje, pero la UI lo hace inalcanzable
    // desde el navegador, y por eso no se prueba un escenario que no puede
    // ocurrir.
    mocks.propose.mockReturnValue(new Promise(() => {}));

    render(<ObjectiveIntakeRoute />);
    fillIntake();
    const button = screen.getByRole('button', { name: 'Analizar objetivo' });
    fireEvent.click(button);

    await screen.findByText('Identificando requisitos...');

    const analyzing = screen.getByRole('button', { name: /Identificando/ });
    expect((analyzing as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText('Texto del objetivo') as HTMLTextAreaElement).disabled
    ).toBe(true);
    expect(
      (screen.getByLabelText('Nombre del objetivo') as HTMLInputElement).disabled
    ).toBe(true);

    fireEvent.click(analyzing);
    expect(mocks.propose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Revision
// ---------------------------------------------------------------------------

describe('revision', () => {
  it('no filtra identidad ni detalle tecnico', async () => {
    await reachReview();
    const body = document.body.textContent ?? '';
    for (const forbidden of [
      'cand_01',
      'charStart',
      'charEnd',
      'UNICODE_CODE_POINT',
      'UNIQUE',
      'objective_requirement_proposal_v1',
      'DERIVED_FROM_SOURCE_TEXT',
      'openai',
      'gpt-'
    ]) {
      expect(body.includes(forbidden)).toBe(false);
    }
  });

  it('muestra el fragmento y su seccion sin los almohadillas del markdown', async () => {
    await reachReview();

    const section = screen.getByText(/En el objetivo, seccion/);
    expect(section.textContent).toContain('Requisitos');
    expect((document.body.textContent ?? '').includes('## Requisitos')).toBe(false);
  });

  it('editar marca Editado y revertir NO lo desmarca', async () => {
    await reachReview();
    const textarea = screen.getByLabelText('Requisito 1');

    fireEvent.change(textarea, { target: { value: 'Experiencia avanzada con Python.' } });
    expect(await screen.findByText('· Editado')).toBeTruthy();

    fireEvent.change(textarea, { target: { value: 'Experiencia con Python.' } });
    expect(screen.getByText('· Editado')).toBeTruthy();
  });

  it('eliminar y deshacer restituye el item con su estado', async () => {
    await reachReview();
    fireEvent.change(screen.getByLabelText('Requisito 1'), {
      target: { value: 'Texto editado.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar requisito 1' }));

    expect(screen.queryByLabelText('Requisito 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));

    expect(await screen.findByDisplayValue('Texto editado.')).toBeTruthy();
    expect(screen.getByText('· Editado')).toBeTruthy();
  });

  it('agregar crea un requisito manual vacio', async () => {
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar requisito' }));

    const second = await screen.findByLabelText('Requisito 2');
    expect((second as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Agregado por vos')).toBeTruthy();
  });

  it('reordenar cambia el orden y NO marca editado', async () => {
    mocks.propose.mockResolvedValue(
      proposalWith([
        candidate({ candidateId: 'cand_01', proposedRequirementText: 'Primero.' }),
        candidate({ candidateId: 'cand_02', proposedRequirementText: 'Segundo.' })
      ])
    );
    await reachReview();

    fireEvent.click(screen.getByRole('button', { name: 'Bajar requisito 1' }));

    expect((screen.getByLabelText('Requisito 1') as HTMLTextAreaElement).value).toBe(
      'Segundo.'
    );
    expect((screen.getByLabelText('Requisito 2') as HTMLTextAreaElement).value).toBe(
      'Primero.'
    );
    expect(screen.queryByText('· Editado')).toBeNull();
  });

  it('ninguna operacion local llama a la red', async () => {
    await reachReview();
    mocks.propose.mockClear();

    fireEvent.change(screen.getByLabelText('Requisito 1'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar requisito' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar requisito 1' }));

    expect(mocks.propose).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('anclaje ambiguo y no hallado avisan y no ofrecen fragmento', async () => {
    mocks.propose.mockResolvedValue(
      proposalWith([
        candidate({
          candidateId: 'cand_01',
          grounding: 'AMBIGUOUS',
          confirmableAsSourceDerived: false,
          primaryExcerpt: null,
          excerptRange: null
        }),
        candidate({
          candidateId: 'cand_02',
          proposedRequirementText: 'Otro.',
          grounding: 'NOT_FOUND',
          confirmableAsSourceDerived: false,
          primaryExcerpt: null,
          excerptRange: null
        })
      ])
    );
    await reachReview();

    expect(
      screen.getByText('Esta frase aparece varias veces en el objetivo.')
    ).toBeTruthy();
    expect(screen.getByText(/No pudimos ubicar la frase exacta/)).toBeTruthy();
    expect(screen.queryByText('Ver fragmento del objetivo')).toBeNull();
  });

  it('marca los duplicados exactos sin borrarlos', async () => {
    mocks.propose.mockResolvedValue(
      proposalWith([
        candidate({ candidateId: 'cand_01' }),
        candidate({ candidateId: 'cand_02', isExactDuplicate: true })
      ])
    );
    await reachReview();

    expect(screen.getByText('· Repetido')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Requisito \d$/).length).toBe(2);
  });

  it('avisa de pasajes no resueltos sin volcar objetos tecnicos', async () => {
    mocks.propose.mockResolvedValue(proposalWith([candidate()], 3));
    await reachReview();

    expect(screen.getByText(/Hay 3 fragmentos del objetivo/)).toBeTruthy();
    expect((document.body.textContent ?? '').includes('reason')).toBe(false);
  });

  it('cero candidatos ofrece agregar a mano', async () => {
    mocks.propose.mockResolvedValue(proposalWith([]));
    await reachReview();

    expect(screen.getByText(/No identificamos requisitos/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Agregar requisito' })).toBeTruthy();
  });

  it('volver y editar descarta la revision tras confirmar', async () => {
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Volver y editar' }));

    expect(screen.getByText('Vas a perder los requisitos que revisaste.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(
      await screen.findByRole('heading', { name: 'Analizar un objetivo' })
    ).toBeTruthy();
    expect((screen.getByLabelText('Texto del objetivo') as HTMLTextAreaElement).value).toBe(RAW);
  });
});

// ---------------------------------------------------------------------------
// Objetivo completo
// ---------------------------------------------------------------------------

describe('objetivo completo', () => {
  it('resalta el fragmento por code points tras un caracter astral', async () => {
    const text = '\u{1F680} Requisitos: experiencia con Python.';
    const start = Array.from(text).indexOf('e', 13);
    mocks.propose.mockResolvedValue(
      proposalWith([
        candidate({
          primaryExcerpt: Array.from(text).slice(start, start + 10).join(''),
          excerptRange: { start, end: start + 10 }
        })
      ])
    );

    render(<ObjectiveIntakeRoute />);
    fillIntake({ text });
    analyze();
    await screen.findByRole('heading', { name: 'Revisa los requisitos' });

    // El contenido de <details> ya esta en el DOM aunque este cerrado.
    fireEvent.click(screen.getByRole('button', { name: 'Ver en el objetivo completo' }));

    const dialog = await screen.findByRole('dialog');
    const mark = dialog.querySelector('mark');
    // El resaltado correcto por code points; con slice UTF-16 estaria corrido.
    expect(mark?.textContent).toBe(Array.from(text).slice(start, start + 10).join(''));
    expect(mark?.textContent).not.toBe(text.slice(start, start + 10));
  });

  it('no muestra offsets', async () => {
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Ver objetivo original' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/charStart|charEnd|\b17\b.*\b42\b/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Confirmacion — los tests de mayor prioridad
// ---------------------------------------------------------------------------

describe('confirmacion', () => {
  function confirm() {
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar objetivo' }));
  }

  it('candidato intacto con anclaje unico conserva la procedencia derivada', async () => {
    await reachReview();
    confirm();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const body = mocks.create.mock.calls[0][1];
    expect(body.requirements).toEqual([
      {
        requirementText: 'Experiencia con Python.',
        provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
        sourceQuote: '- Experiencia con Python.'
      }
    ]);
  });

  it('el texto original es identico al analizado', async () => {
    await reachReview();
    confirm();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const body = mocks.create.mock.calls[0][1];
    expect(body.source.originalText).toBe(RAW);
    expect(body.source.inputType).toBe('PASTED_TEXT');
    expect(body.objectiveContext).toBe('');
    expect(body.title).toBe('Backend Engineer');
  });

  it('editado -> entrada directa sin cita', async () => {
    await reachReview();
    fireEvent.change(screen.getByLabelText('Requisito 1'), {
      target: { value: 'Experiencia avanzada con Python.' }
    });
    confirm();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][1].requirements[0]).toEqual({
      requirementText: 'Experiencia avanzada con Python.',
      provenanceKind: 'DIRECT_STRUCTURED_INPUT',
      sourceQuote: null
    });
  });

  it('editado y revertido SIGUE siendo entrada directa', async () => {
    await reachReview();
    const textarea = screen.getByLabelText('Requisito 1');
    fireEvent.change(textarea, { target: { value: 'Otra cosa.' } });
    fireEvent.change(textarea, { target: { value: 'Experiencia con Python.' } });
    confirm();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][1].requirements[0]).toEqual({
      requirementText: 'Experiencia con Python.',
      provenanceKind: 'DIRECT_STRUCTURED_INPUT',
      sourceQuote: null
    });
  });

  it('manual -> entrada directa sin cita', async () => {
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: '+ Agregar requisito' }));
    fireEvent.change(await screen.findByLabelText('Requisito 2'), {
      target: { value: 'Disponibilidad para viajar.' }
    });
    confirm();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][1].requirements[1]).toEqual({
      requirementText: 'Disponibilidad para viajar.',
      provenanceKind: 'DIRECT_STRUCTURED_INPUT',
      sourceQuote: null
    });
  });

  it('reordenado e intacto SIGUE siendo derivado, en el orden visible', async () => {
    mocks.propose.mockResolvedValue(
      proposalWith([
        candidate({ candidateId: 'cand_01', proposedRequirementText: 'Primero.' }),
        candidate({ candidateId: 'cand_02', proposedRequirementText: 'Segundo.' })
      ])
    );
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Bajar requisito 1' }));
    confirm();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const { requirements } = mocks.create.mock.calls[0][1];
    expect(requirements.map((r: { requirementText: string }) => r.requirementText)).toEqual([
      'Segundo.',
      'Primero.'
    ]);
    expect(requirements[0].provenanceKind).toBe('DERIVED_FROM_SOURCE_TEXT');
    expect(requirements[1].provenanceKind).toBe('DERIVED_FROM_SOURCE_TEXT');
  });

  it('no envia ningun campo que pone el servidor', async () => {
    await reachReview();
    confirm();

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const serialized = JSON.stringify(mocks.create.mock.calls[0][1]);
    for (const forbidden of [
      'order',
      'requirementId',
      'qualifiers',
      'candidateId',
      'schemaVersion',
      'status',
      'ownerUserId'
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('bloquea con cero requisitos', async () => {
    mocks.propose.mockResolvedValue(proposalWith([]));
    await reachReview();
    confirm();

    expect(
      await screen.findByText('Agrega al menos un requisito para confirmar el objetivo.')
    ).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('bloquea con un requisito en blanco', async () => {
    await reachReview();
    fireEvent.change(screen.getByLabelText('Requisito 1'), { target: { value: '  ' } });
    confirm();

    expect(
      await screen.findByText('Hay un requisito sin texto. Completalo o eliminalo.')
    ).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('un doble clic confirma UNA sola vez', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.create.mockReturnValue(new Promise((r) => (resolve = r)));

    await reachReview();
    const button = screen.getByRole('button', { name: 'Confirmar objetivo' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    resolve({ objectiveReference: 'obj-1' });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/wallet/objectives/obj-1'));
  });

  it('un fallo conserva TODA la revision y no re-analiza', async () => {
    mocks.create.mockRejectedValue(new ApiError('x', 'network'));
    await reachReview();
    fireEvent.change(screen.getByLabelText('Requisito 1'), {
      target: { value: 'Texto revisado a mano.' }
    });
    mocks.propose.mockClear();
    confirm();

    await screen.findByText(/No pudimos conectar con el servicio/);
    expect(screen.getByDisplayValue('Texto revisado a mano.')).toBeTruthy();
    expect(screen.getByText('· Editado')).toBeTruthy();
    // Lo decisivo: un fallo de creacion NUNCA vuelve a llamar al proveedor.
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar objetivo' })).toBeTruthy();
  });

  it('el exito navega al detalle', async () => {
    await reachReview();
    confirm();
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith('/wallet/objectives/obj-1')
    );
  });

  it('nunca dispara un ReasoningRun', async () => {
    await reachReview();
    confirm();
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());

    for (const call of mocks.requestAuthenticated.mock.calls) {
      expect(String(call[0])).not.toContain('reasoning');
    }
  });
});
