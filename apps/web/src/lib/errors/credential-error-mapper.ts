import {
  ApiError,
  IncompatiblePayloadError
} from '@/lib/errors/api-error';
import type {
  CredentialFeedback,
  CredentialFeedbackCode
} from '@/models/credentials';

type CredentialOperation =
  | 'holder-resolution'
  | 'draft-create'
  | 'draft-update'
  | 'document-evidence-upload'
  | 'text-evidence-submit'
  | 'issue'
  | 'detail'
  | 'save-reusable-template'
  | 'template-search';

function feedback(
  code: CredentialFeedbackCode,
  message: string
): CredentialFeedback {
  return { code, message };
}

export function mapCredentialError(
  error: unknown,
  operation: CredentialOperation
): CredentialFeedback {
  if (error instanceof IncompatiblePayloadError) {
    return feedback(
      'incompatible_response',
      'El servicio respondió con un formato incompatible. Intentá nuevamente.'
    );
  }

  if (!(error instanceof ApiError)) {
    return feedback(
      'unexpected',
      'No pudimos completar la operación. Intentá nuevamente.'
    );
  }

  if (error.kind === 'network') {
    if (operation === 'issue') {
      return feedback(
        'network',
        'No pudimos confirmar el resultado de la emisión. Actualizá el detalle antes de volver a intentarlo.'
      );
    }

    if (operation === 'text-evidence-submit') {
      return feedback(
        'network',
        'No pudimos conectarnos con el servicio. Conservamos el texto para que puedas reintentar.'
      );
    }

    return feedback(
      'network',
      operation === 'document-evidence-upload'
        ? 'No pudimos conectarnos con el servicio. Conservamos el archivo seleccionado para que puedas reintentar.'
        : 'No pudimos conectar con el servicio. Revisá la conexión e intentá nuevamente.'
    );
  }

  if (error.kind === 'invalid-response') {
    return feedback(
      'incompatible_response',
      'El servicio respondió con un formato incompatible. Intentá nuevamente.'
    );
  }

  if (error.status === 401) {
    return feedback(
      'session_expired',
      'Tu sesión venció. Volvé a iniciar sesión.'
    );
  }

  if (error.status === 403) {
    if (operation === 'issue') {
      return feedback(
        'forbidden',
        'No tenés permisos para emitir credenciales en esta institución.'
      );
    }

    if (operation === 'text-evidence-submit') {
      return feedback(
        'forbidden',
        'No tenés permisos para registrar evidencia textual en esta institución.'
      );
    }

    if (operation === 'save-reusable-template') {
      return feedback(
        'forbidden',
        'No tenés permisos para guardar contenido reutilizable en esta institución.'
      );
    }

    return feedback(
      'forbidden',
      operation === 'document-evidence-upload'
        ? 'No tenés permisos para adjuntar evidencia en esta institución.'
        : 'No tenés permisos para operar con esta institución.'
    );
  }

  if (error.status === 404) {
    if (operation === 'holder-resolution') {
      return feedback(
        'not_found',
        'No encontramos un titular disponible con ese correo. Verificá el email o consultá con la institución.'
      );
    }

    if (operation === 'text-evidence-submit') {
      return feedback(
        'not_found',
        'No encontramos la credencial dentro del contexto institucional activo.'
      );
    }

    if (operation === 'issue') {
      return feedback(
        'not_found',
        'No encontramos la credencial dentro del contexto institucional activo.'
      );
    }

    if (operation === 'save-reusable-template') {
      return feedback(
        'not_found',
        'No encontramos la credencial dentro del contexto institucional activo.'
      );
    }

    return feedback(
      'not_found',
      operation === 'document-evidence-upload'
        ? 'No encontramos la credencial dentro del contexto institucional activo.'
        : 'No encontramos la credencial solicitada.'
    );
  }

  if (operation === 'save-reusable-template') {
    if (error.status === 409) {
      return feedback(
        'conflict',
        'Este contenido ya fue guardado como reutilizable.'
      );
    }

    if (error.status === 400) {
      return feedback(
        'invalid_input',
        'No pudimos guardar este contenido como reutilizable. Revisá los datos e intentá nuevamente.'
      );
    }
  }

  if (operation === 'document-evidence-upload') {
    if (error.status === 409) {
      return feedback(
        'conflict',
        'La evidencia solo puede modificarse mientras la credencial está en borrador.'
      );
    }

    if (error.status === 413) {
      return feedback(
        'invalid_input',
        'El archivo supera el máximo permitido de 20 MB.'
      );
    }

    if (error.status === 415) {
      return feedback(
        'invalid_input',
        'El formato no es compatible. Usá PDF, PNG o JPEG.'
      );
    }

    if (error.status === 400) {
      return feedback(
        'invalid_input',
        'No pudimos procesar el archivo. Revisalo e intentá nuevamente.'
      );
    }
  }

  if (operation === 'text-evidence-submit') {
    if (error.status === 409) {
      return feedback(
        'conflict',
        'La evidencia textual solo puede modificarse mientras la credencial está en borrador.'
      );
    }

    if (error.status === 400) {
      return feedback(
        'invalid_input',
        'Revisá el texto ingresado e intentá nuevamente.'
      );
    }
  }

  if (operation === 'template-search' && error.status === 400) {
    return feedback(
      'invalid_input',
      'No pudimos buscar contenido reutilizable. Intentá nuevamente.'
    );
  }

  if (error.status === 409 && operation === 'draft-update') {
    return feedback(
      'conflict',
      'Este borrador fue actualizado desde otra sesión.'
    );
  }

  if (error.status === 409 && operation === 'issue') {
    return feedback(
      'conflict',
      'La credencial ya no está en borrador o no puede emitirse.'
    );
  }

  if (error.status === 400 && operation === 'issue') {
    return feedback(
      'invalid_input',
      'La credencial no reúne los datos o la configuración necesarios para emitirse.'
    );
  }

  if (error.status === 400) {
    return feedback(
      'invalid_input',
      operation === 'holder-resolution'
        ? 'Revisá el correo ingresado e intentá nuevamente.'
        : 'Revisá los datos del borrador e intentá nuevamente.'
    );
  }

  if (error.status !== null && error.status >= 500) {
    if (operation === 'issue') {
      return feedback(
        'service_unavailable',
        'No pudimos completar el registro técnico de la emisión. Intentá nuevamente más tarde.'
      );
    }

    return feedback(
      'service_unavailable',
      'El servicio no está disponible temporalmente. Intentá nuevamente más tarde.'
    );
  }

  return feedback(
    'unexpected',
    'No pudimos completar la operación. Intentá nuevamente.'
  );
}
