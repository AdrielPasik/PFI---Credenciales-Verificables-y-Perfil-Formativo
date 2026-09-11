/**
 * Contrato REAL de la respuesta de detalle de Objective — P2.3.
 *
 * POR QUE EXISTE ESTE FICHERO APARTE.
 *
 * El primer smoke web de P2.3 fallo porque `adaptObjectiveDetail` esperaba
 * `definition.source: { inputType, originalText }` —la forma de la PETICION de
 * creacion— mientras que la RESPUESTA aplana esos campos. El test de adapter que
 * existia usaba un payload construido a partir de la misma lectura equivocada
 * del contrato, asi que no podia detectar el error: un fixture inventado por
 * quien malinterpreto el contrato reproduce la malinterpretacion.
 *
 * El fixture de aqui esta copiado de la FORMA OBSERVADA en el endpoint real
 * durante ese smoke (`GET /me/objectives/:id` sobre el Objective persistido).
 * El contenido es sintetico y minimo; lo que se preserva exactamente es la
 * FORMA DE LOS CAMPOS.
 *
 * LA ASIMETRIA QUE ESTE FICHERO CONGELA:
 *
 *     PETICION de creacion   source: { inputType, originalText }    ANIDADO
 *     RESPUESTA de lectura   sourceInputType, sourceOriginalText    PLANO
 *
 * No es un descuido del backend: `objective.mapper.ts` la documenta y la eligio.
 * El cliente se adapta; el contrato no se cambia para que parezca simetrico.
 */

import { describe, expect, it } from 'vitest';

import {
  adaptObjectiveDetail,
  adaptObjectiveSummaries
} from '@/lib/adapters/objectives.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

/** Texto con LF inicial/final y un caracter astral, como el objetivo real. */
const SOURCE_TEXT = '\n## Requisitos \u{1F680}\n\n- Experiencia con Python.\n';

/**
 * REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE
 *
 * Forma observada en el endpoint real. Claves de nivel superior:
 *   createdAt, definition, objectiveReference, objectiveType, status,
 *   supersedesObjectiveReference, title
 * Claves de `definition`:
 *   objectiveContext, objectiveType, requirements, schemaVersion,
 *   sourceInputType, sourceOriginalText
 * Claves de cada requirement:
 *   order, provenanceKind, qualifiers, requirementId, requirementText,
 *   sourceQuote
 */
const REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE = {
  objectiveReference: 'cd7151c7-8a3d-4746-b1fb-a787d1fd2e4f',
  objectiveType: 'EMPLOYMENT',
  title: 'Ingeniero/a de Plataforma Backend',
  status: 'active',
  supersedesObjectiveReference: null,
  createdAt: '2026-09-11T12:30:00.000Z',
  definition: {
    schemaVersion: 'objective_definition_v1',
    objectiveType: 'EMPLOYMENT',
    objectiveContext: '',
    sourceInputType: 'PASTED_TEXT',
    sourceOriginalText: SOURCE_TEXT,
    requirements: [
      {
        requirementId: 'req_01',
        order: 1,
        requirementText: 'Experiencia con Python.',
        provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
        sourceQuote: '- Experiencia con Python.',
        qualifiers: []
      },
      {
        requirementId: 'req_02',
        order: 2,
        requirementText: 'Experiencia colaborando con equipos multidisciplinarios.',
        provenanceKind: 'DIRECT_STRUCTURED_INPUT',
        sourceQuote: null,
        qualifiers: []
      }
    ]
  }
};

describe('contrato real de la respuesta de detalle', () => {
  it('adapta la forma PLANA que devuelve el endpoint', () => {
    const detail = adaptObjectiveDetail(REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE);

    expect(detail.objectiveReference).toBe('cd7151c7-8a3d-4746-b1fb-a787d1fd2e4f');
    expect(detail.objectiveType).toBe('EMPLOYMENT');
    expect(detail.objectiveTypeLabel).toBe('Busqueda laboral');
    expect(detail.title).toBe('Ingeniero/a de Plataforma Backend');
    expect(detail.sourceInputType).toBe('PASTED_TEXT');
  });

  it('preserva el texto fuente VERBATIM, con LF y caracter astral', () => {
    const detail = adaptObjectiveDetail(REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE);

    expect(detail.sourceOriginalText).toBe(SOURCE_TEXT);
    expect(detail.sourceOriginalText?.[0]).toBe('\n');
    expect(detail.sourceOriginalText?.endsWith('\n')).toBe(true);
    expect(detail.sourceOriginalText).toContain('\u{1F680}');
  });

  it('adapta los requisitos conservando procedencia y cita', () => {
    const { requirements } = adaptObjectiveDetail(REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE);

    expect(requirements).toHaveLength(2);

    expect(requirements[0].requirementId).toBe('req_01');
    expect(requirements[0].requirementText).toBe('Experiencia con Python.');
    expect(requirements[0].provenanceKind).toBe('DERIVED_FROM_SOURCE_TEXT');
    expect(requirements[0].sourceQuote).toBe('- Experiencia con Python.');
    expect(requirements[0].originLabel).toBe('Del objetivo');

    expect(requirements[1].provenanceKind).toBe('DIRECT_STRUCTURED_INPUT');
    expect(requirements[1].sourceQuote).toBeNull();
    expect(requirements[1].originLabel).toBe('Agregado por vos');
  });

  it('la cita derivada sigue siendo subcadena literal del texto fuente', () => {
    const detail = adaptObjectiveDetail(REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE);
    const quote = detail.requirements[0].sourceQuote as string;
    expect(detail.sourceOriginalText?.includes(quote)).toBe(true);
  });

  it('el mismo adapter sirve para la respuesta 201 de creacion', () => {
    // `POST /me/objectives`, `GET /me/objectives/:id` y las revisiones usan el
    // mismo `mapObjectiveDetail` del backend, asi que el cuerpo del 201 tiene
    // exactamente esta forma. Si este camino se rompiera, el holder no podria
    // navegar al objetivo que acaba de confirmar — que es como fallo el primer
    // smoke.
    const created = adaptObjectiveDetail(REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE);
    expect(created.objectiveReference).toBe('cd7151c7-8a3d-4746-b1fb-a787d1fd2e4f');
    expect(created.requirements).toHaveLength(2);
  });

  it('el resumen de la lista se adapta con su propio contrato, sin definition', () => {
    const [summary] = adaptObjectiveSummaries([
      {
        objectiveReference: 'obj-1',
        objectiveType: 'EMPLOYMENT',
        title: 'Backend Engineer',
        status: 'active',
        supersedesObjectiveReference: null,
        createdAt: '2026-09-11T12:30:00.000Z'
      }
    ]);
    expect(summary.objectiveReference).toBe('obj-1');
  });
});

describe('guard de la asimetria peticion/respuesta', () => {
  it('la forma ANIDADA de la peticion NO se acepta como respuesta', () => {
    // Este es el guard que congela la asimetria. Si alguien "corrigiera" el
    // fixture a `definition.source`, o volviera a hacer que el adapter lea esa
    // forma, este test falla y dice por que.
    const withRequestShape = {
      ...REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE,
      definition: {
        schemaVersion: 'objective_definition_v1',
        objectiveType: 'EMPLOYMENT',
        objectiveContext: '',
        // Forma de la PETICION de creacion: el endpoint NUNCA responde asi.
        source: { inputType: 'PASTED_TEXT', originalText: SOURCE_TEXT },
        requirements: REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE.definition.requirements
      }
    };

    expect(() => adaptObjectiveDetail(withRequestShape)).toThrow(
      IncompatiblePayloadError
    );
  });

  it('el fixture real declara los campos planos y no el anidado', () => {
    const definition = REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE.definition;
    expect(Object.keys(definition).sort()).toEqual([
      'objectiveContext',
      'objectiveType',
      'requirements',
      'schemaVersion',
      'sourceInputType',
      'sourceOriginalText'
    ]);
    expect('source' in definition).toBe(false);
  });

  it('una respuesta sin los campos planos se rechaza con su ruta exacta', () => {
    const missing = {
      ...REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE,
      definition: {
        ...REAL_OBJECTIVE_DETAIL_RESPONSE_FIXTURE.definition,
        sourceInputType: undefined
      }
    };
    expect(() => adaptObjectiveDetail(missing)).toThrow(IncompatiblePayloadError);
  });
});
