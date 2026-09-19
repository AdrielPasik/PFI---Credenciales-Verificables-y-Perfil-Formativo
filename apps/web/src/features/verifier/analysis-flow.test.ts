import { describe, expect, it } from 'vitest';

import { failureCopy, publicErrorCopy, stepForResult, stepForSession } from './analysis-flow';
import { ApiError } from '@/lib/errors/api-error';
import type { PublicAnalysisResultVM, PublicVerificationSessionVM } from '@/models/public-analysis';

function session(status: PublicVerificationSessionVM['status']): PublicVerificationSessionVM {
  return {
    status,
    objectiveType: 'EMPLOYMENT',
    objectiveTypeLabel: 'Busqueda laboral',
    rawObjectiveText: 'texto',
    objectiveTitle: null,
    proposal: null,
    proposalInProgress: false,
    confirmedRequirements: [],
    expiresAtLabel: null
  };
}

function result(state: PublicAnalysisResultVM['state']): PublicAnalysisResultVM {
  return { state, objective: null, completedAtLabel: null, failure: null, result: null };
}

describe('paso visible', () => {
  it('sale del estado del servidor, nunca de un índice local', () => {
    expect(stepForSession(session('draft'))).toBe('requirements');
    expect(stepForSession(session('requirements_proposed'))).toBe('requirements');
    expect(stepForSession(session('requirements_confirmed'))).toBe('ready');
    expect(stepForSession(session('consumed'))).toBe('processing');

    expect(stepForResult(result('AWAITING_REQUIREMENTS'))).toBe('requirements');
    expect(stepForResult(result('READY_TO_EXECUTE'))).toBe('ready');
    expect(stepForResult(result('PROCESSING'))).toBe('processing');
    expect(stepForResult(result('COMPLETED'))).toBe('completed');
    expect(stepForResult(result('FAILED'))).toBe('failed');
  });
});

describe('recuperación de fallos', () => {
  it('solo un fallo temporal reintenta el MISMO análisis', () => {
    expect(
      failureCopy({ category: 'TEMPORARILY_UNAVAILABLE', retryable: true }, true).recovery
    ).toBe('RETRY_SAME_ANALYSIS');
  });

  it('un run interrumpido nunca ofrece reintentar: solo un análisis nuevo', () => {
    const copy = failureCopy({ category: 'EXECUTION_INTERRUPTED', retryable: false }, true);
    expect(copy.recovery).toBe('START_NEW_ANALYSIS');
    expect(copy.title).toBe('Este análisis no pudo finalizar');
  });

  it('sin autorización vigente no se ofrece ningún camino', () => {
    for (const category of [
      'AUTHORIZATION_WITHDRAWN',
      'EXECUTION_INTERRUPTED',
      'RETRY_BUDGET_EXHAUSTED',
      'EXECUTION_FAILED'
    ] as const) {
      expect(failureCopy({ category, retryable: false }, false).recovery).toBe('NONE');
    }
  });

  it('el presupuesto agotado no reintenta el mismo run y no menciona intentos', () => {
    const copy = failureCopy({ category: 'RETRY_BUDGET_EXHAUSTED', retryable: false }, true);
    expect(copy.recovery).toBe('START_NEW_ANALYSIS');
    expect(`${copy.title} ${copy.description}`).not.toMatch(/intentos|presupuesto|proveedor/i);
  });

  it('la autorización retirada no nombra credenciales ni acciones del titular', () => {
    const copy = failureCopy({ category: 'AUTHORIZATION_WITHDRAWN', retryable: false }, true);
    expect(copy.description).toBe('Se detuvo porque cambió la autorización del perfil.');
    expect(copy.description).not.toMatch(/credencial|revoc|titular|holder/i);
  });
});

describe('errores públicos', () => {
  it('traduce códigos estables sin mostrarlos', () => {
    const copy = publicErrorCopy(new ApiError('x', 'http', 409, 'EXECUTION_IN_PROGRESS'));
    expect(copy.retryable).toBe(true);
    expect(copy.message).not.toMatch(/EXECUTION_IN_PROGRESS/);
  });

  it('un enlace no disponible es fatal', () => {
    expect(publicErrorCopy(new ApiError('x', 'http', 404, 'SHARE_NOT_AVAILABLE')).fatal).toBe(true);
    expect(publicErrorCopy(new ApiError('x', 'http', 404)).fatal).toBe(true);
  });

  it('una sesión inexistente marca la sesión como perdida, no como fatal', () => {
    const copy = publicErrorCopy(new ApiError('x', 'http', 404, 'REQUEST_NOT_AVAILABLE'));
    expect(copy.sessionLost).toBe(true);
    expect(copy.fatal).toBe(false);
  });

  it('un error desconocido cae en copy genérica y reintentable', () => {
    const copy = publicErrorCopy(new Error('boom'));
    expect(copy.fatal).toBe(false);
    expect(copy.message).toBe('No pudimos completar la operación. Intentá de nuevo.');
  });
});
