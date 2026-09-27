import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ObjectiveIntakeScreen } from '@/features/objectives/objective-intake-screen';
import {
  objectiveDetailPayload,
  proposalPayload
} from '@/test/objective-fixtures';
import type { RouteMap, StubResponse } from '@/test/http';
import { renderWithProviders } from '@/test/render';

const PROPOSAL_ROUTE = 'POST /me/objective-requirement-proposals';
const CREATE_ROUTE = 'POST /me/objectives';

function routes({
  proposal = { body: proposalPayload() },
  create = { body: objectiveDetailPayload() }
}: { proposal?: StubResponse; create?: StubResponse } = {}): RouteMap {
  return {
    [PROPOSAL_ROUTE]: proposal,
    [CREATE_ROUTE]: create
  };
}

async function renderIntake(routeMap: RouteMap = routes()) {
  return renderWithProviders(<ObjectiveIntakeScreen />, { routes: routeMap });
}

async function fillIntake() {
  await fireEvent.press(screen.getByTestId('objective-type-EMPLOYMENT'));
  await fireEvent.changeText(
    screen.getByTestId('objective-title'),
    'Analista de datos'
  );
  await fireEvent.changeText(
    screen.getByTestId('objective-text'),
    'Requisitos del puesto:\n- Python avanzado\n- SQL intermedio\n- Tres años de experiencia profesional\n'
  );
}

describe('carga del objetivo', () => {
  it('NO llama al proveedor al montar la pantalla', async () => {
    const { calls } = await renderIntake();

    expect(
      calls.some((call) => call.path === '/me/objective-requirement-proposals')
    ).toBe(false);
  });

  it('no trae ningún tipo de objetivo preseleccionado', async () => {
    await renderIntake();

    for (const type of [
      'EMPLOYMENT',
      'SCHOLARSHIP',
      'ADMISSION',
      'EQUIVALENCE',
      'OTHER'
    ]) {
      const option = screen.getByTestId(`objective-type-${type}`);
      expect(option.props.accessibilityState.selected).toBe(false);
    }
  });

  it('muestra los cinco tipos con etiqueta de producto, no el token', async () => {
    await renderIntake();

    expect(screen.getByText('Búsqueda laboral')).toBeTruthy();
    expect(screen.getByText('Beca')).toBeTruthy();
    expect(screen.getByText('Admisión a un programa')).toBeTruthy();
    expect(screen.getByText('Equivalencia o convalidación')).toBeTruthy();
    expect(screen.getByText('Otro')).toBeTruthy();
    expect(screen.queryByText('EMPLOYMENT')).toBeNull();
  });

  it('valida antes de gastar una llamada al proveedor', async () => {
    const { calls } = await renderIntake();

    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(screen.getByText('Elegí el tipo de objetivo.')).toBeTruthy()
    );
    expect(
      calls.filter(
        (call) => call.path === '/me/objective-requirement-proposals'
      )
    ).toHaveLength(0);
  });

  it('exige el nombre del objetivo', async () => {
    const { calls } = await renderIntake();

    await fireEvent.press(screen.getByTestId('objective-type-EMPLOYMENT'));
    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(screen.getByText('Ponele un nombre al objetivo.')).toBeTruthy()
    );
    expect(
      calls.filter(
        (call) => call.path === '/me/objective-requirement-proposals'
      )
    ).toHaveLength(0);
  });

  it('exige el texto del objetivo', async () => {
    const { calls } = await renderIntake();

    await fireEvent.press(screen.getByTestId('objective-type-EMPLOYMENT'));
    await fireEvent.changeText(screen.getByTestId('objective-title'), 'X');
    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(screen.getByText('Pegá el texto del objetivo.')).toBeTruthy()
    );
    expect(
      calls.filter(
        (call) => call.path === '/me/objective-requirement-proposals'
      )
    ).toHaveLength(0);
  });

  it('un toque de Analizar produce UNA sola petición', async () => {
    const { calls } = await renderIntake();
    await fillIntake();

    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(screen.getByTestId('review-summary')).toBeTruthy()
    );
    expect(
      calls.filter(
        (call) => call.path === '/me/objective-requirement-proposals'
      )
    ).toHaveLength(1);
  });

  it('envía el texto VERBATIM, sin trim ni normalización', async () => {
    const { calls } = await renderIntake();

    await fireEvent.press(screen.getByTestId('objective-type-SCHOLARSHIP'));
    await fireEvent.changeText(screen.getByTestId('objective-title'), '  Beca  ');
    await fireEvent.changeText(
      screen.getByTestId('objective-text'),
      '  texto\n\ncon saltos  '
    );
    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.path === '/me/objective-requirement-proposals'
        )
      ).toBe(true)
    );

    const call = calls.find(
      (entry) => entry.path === '/me/objective-requirement-proposals'
    );
    const body = JSON.parse(call!.body!) as Record<string, unknown>;

    expect(body.objectiveType).toBe('SCHOLARSHIP');
    expect(body.title).toBe('  Beca  ');
    expect(body.rawObjectiveText).toBe('  texto\n\ncon saltos  ');
  });

  it('un fallo del proveedor conserva el texto pegado', async () => {
    await renderIntake(routes({ proposal: { status: 503 } }));
    await fillIntake();

    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(
        screen.getByText('El servicio no está disponible en este momento.')
      ).toBeTruthy()
    );
    expect(screen.getByTestId('objective-text').props.value).toContain(
      'Python avanzado'
    );
  });

  it('un 422 explica que no se pudo generar una propuesta confiable', async () => {
    await renderIntake(routes({ proposal: { status: 422 } }));
    await fillIntake();

    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(screen.getByText(/no pudimos generar una propuesta/i)).toBeTruthy()
    );
  });

  it('un 413 invita a acortar el texto, no a reintentar', async () => {
    await renderIntake(routes({ proposal: { status: 413 } }));
    await fillIntake();

    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(screen.getByText(/demasiado largo para analizarlo/i)).toBeTruthy()
    );
  });

  it('el error nunca menciona proveedor, modelo ni códigos HTTP', async () => {
    await renderIntake(routes({ proposal: { status: 503 } }));
    await fillIntake();

    await fireEvent.press(screen.getByTestId('objective-analyze'));

    await waitFor(() =>
      expect(screen.getByText(/no está disponible/i)).toBeTruthy()
    );
    expect(screen.queryByText(/openai|gpt|503|model|prompt/i)).toBeNull();
  });
});

describe('revisión de requisitos', () => {
  async function reachReview(routeMap: RouteMap = routes()) {
    const rendered = await renderIntake(routeMap);
    await fillIntake();
    await fireEvent.press(screen.getByTestId('objective-analyze'));
    await waitFor(() =>
      expect(screen.getByTestId('review-summary')).toBeTruthy()
    );
    return rendered;
  }

  it('muestra los candidatos propuestos', async () => {
    await reachReview();

    expect(screen.getByText('2 propuestos · 2 quedan')).toBeTruthy();

    const inputs = screen.getAllByLabelText(/^Texto del requisito/);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.props.value).toBe('Python avanzado');
    expect(inputs[1]!.props.value).toBe(
      'Tres años de experiencia profesional'
    );
  });

  it('informa los pasajes que no se pudieron convertir', async () => {
    await reachReview();

    expect(screen.getByText(/1 pasaje del objetivo/)).toBeTruthy();
  });

  it('ofrece ver el fragmento sólo cuando hay cita anclada', async () => {
    await reachReview();

    // El primer candidato ancla; el segundo no.
    const sourceButtons = screen.queryAllByText('Ver fragmento');
    expect(sourceButtons).toHaveLength(1);
  });

  it('muestra el fragmento exacto sin exponer offsets ni ids', async () => {
    await reachReview();

    await fireEvent.press(screen.getByText('Ver fragmento'));

    await waitFor(() =>
      expect(screen.getByTestId('objective-source-excerpt')).toBeTruthy()
    );
    expect(screen.queryByText(/charStart|charEnd|cand_01|UNICODE/)).toBeNull();
  });

  it('permite ver la cita en el objetivo completo', async () => {
    await reachReview();

    await fireEvent.press(screen.getByText('Ver fragmento'));
    await waitFor(() =>
      expect(screen.getByTestId('objective-source-toggle')).toBeTruthy()
    );
    await fireEvent.press(screen.getByTestId('objective-source-toggle'));

    await waitFor(() =>
      expect(screen.getByTestId('objective-source-full')).toBeTruthy()
    );
  });

  it('agregar un requisito lo suma al final', async () => {
    await reachReview();

    await fireEvent.press(screen.getByTestId('review-add'));

    await waitFor(() =>
      expect(screen.getByText('2 propuestos · 3 quedan · 1 agregados')).toBeTruthy()
    );
  });

  it('eliminar ofrece deshacer y restituye el requisito', async () => {
    await reachReview();

    const removeButtons = screen.getAllByLabelText(/^Eliminar el requisito/);
    await fireEvent.press(removeButtons[0]!);

    await waitFor(() =>
      expect(screen.getByText('Requisito eliminado')).toBeTruthy()
    );
    expect(screen.getByText('2 propuestos · 1 quedan · 1 eliminados')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('review-undo'));

    await waitFor(() =>
      expect(screen.getByText('2 propuestos · 2 quedan')).toBeTruthy()
    );
  });

  it('eliminar NO pide confirmación: la semántica es eliminar + deshacer', async () => {
    await reachReview();

    const removeButtons = screen.getAllByLabelText(/^Eliminar el requisito/);
    await fireEvent.press(removeButtons[0]!);

    await waitFor(() =>
      expect(screen.getByText('Requisito eliminado')).toBeTruthy()
    );
    expect(screen.queryByText(/¿Estás seguro|Confirmar eliminación/i)).toBeNull();
  });

  it('el reordenamiento usa botones con etiqueta accesible, no drag and drop', async () => {
    await reachReview();

    expect(screen.getAllByLabelText(/^Subir el requisito/).length).toBe(2);
    expect(screen.getAllByLabelText(/^Bajar el requisito/).length).toBe(2);

    // El primero no puede subir; el último no puede bajar.
    expect(
      screen.getAllByLabelText(/^Subir el requisito/)[0]!.props
        .accessibilityState.disabled
    ).toBe(true);
    expect(
      screen.getAllByLabelText(/^Bajar el requisito/)[1]!.props
        .accessibilityState.disabled
    ).toBe(true);
  });

  it('no permite confirmar con un requisito en blanco', async () => {
    const { calls } = await reachReview();
    const before = calls.length;

    await fireEvent.press(screen.getByTestId('review-add'));
    await fireEvent.press(screen.getByTestId('review-confirm'));

    await waitFor(() =>
      expect(
        screen.getByText('Hay un requisito sin texto. Completalo o eliminalo.')
      ).toBeTruthy()
    );
    expect(calls.length).toBe(before);
  });

  it('confirmar envía el cuerpo exacto del contrato', async () => {
    const { calls } = await reachReview();

    await fireEvent.press(screen.getByTestId('review-confirm'));

    await waitFor(() =>
      expect(calls.some((call) => call.path === '/me/objectives')).toBe(true)
    );

    const call = calls.find((entry) => entry.path === '/me/objectives');
    const body = JSON.parse(call!.body!) as Record<string, unknown>;
    const source = body.source as Record<string, unknown>;
    const requirements = body.requirements as Record<string, unknown>[];

    expect(body.objectiveType).toBe('EMPLOYMENT');
    expect(body.objectiveContext).toBe('');
    expect(source.inputType).toBe('PASTED_TEXT');
    expect(source.originalText).toContain('Python avanzado');

    // Procedencia: el primero ancla, el segundo no.
    expect(requirements[0]!.provenanceKind).toBe('DERIVED_FROM_SOURCE_TEXT');
    expect(requirements[0]!.sourceQuote).toBe('Python avanzado');
    expect(requirements[1]!.provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
    expect(requirements[1]!.sourceQuote).toBeNull();

    // Nada técnico viaja.
    expect(call!.body).not.toContain('candidateId');
    expect(call!.body).not.toContain('requirementId');
    expect(call!.body).not.toContain('order');
  });

  it('editar un requisito lo convierte en entrada directa, sin cita', async () => {
    const { calls } = await reachReview();

    const inputs = screen.getAllByLabelText(/^Texto del requisito/);
    await fireEvent.changeText(inputs[0]!, 'Python experto');
    await fireEvent.press(screen.getByTestId('review-confirm'));

    await waitFor(() =>
      expect(calls.some((call) => call.path === '/me/objectives')).toBe(true)
    );

    const call = calls.find((entry) => entry.path === '/me/objectives');
    const body = JSON.parse(call!.body!) as Record<string, unknown>;
    const requirements = body.requirements as Record<string, unknown>[];

    expect(requirements[0]!.requirementText).toBe('Python experto');
    expect(requirements[0]!.provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
    expect(requirements[0]!.sourceQuote).toBeNull();
  });

  it('un fallo al confirmar conserva la revisión y NO repite la propuesta', async () => {
    const { calls } = await reachReview(routes({ create: { status: 503 } }));

    await fireEvent.press(screen.getByTestId('review-confirm'));

    await waitFor(() =>
      expect(screen.getByText(/no está disponible/i)).toBeTruthy()
    );

    // La revisión sigue en pantalla.
    expect(screen.getByTestId('review-summary')).toBeTruthy();
    // Y la propuesta NO se volvió a pedir.
    expect(
      calls.filter(
        (call) => call.path === '/me/objective-requirement-proposals'
      )
    ).toHaveLength(1);
  });

  it('volver a editar descarta la propuesta y avisa', async () => {
    await reachReview();

    await fireEvent.press(screen.getByTestId('review-discard'));

    await waitFor(() =>
      expect(screen.getByTestId('objective-analyze')).toBeTruthy()
    );
    expect(screen.queryByTestId('review-summary')).toBeNull();
  });

  it('nunca muestra identificadores técnicos de la propuesta', async () => {
    await reachReview();

    expect(screen.queryByText(/cand_01|cand_02|req_01|localKey/)).toBeNull();
    expect(
      screen.queryByText(/UNIQUE|NOT_FOUND|AMBIGUOUS|PROPOSAL_ONLY/)
    ).toBeNull();
  });
});
