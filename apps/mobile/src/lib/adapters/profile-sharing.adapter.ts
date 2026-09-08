import { invalid, record, requiredString } from '@/lib/adapters/contract';
import { formatDate } from '@/lib/format/display';
import type { ProfileShareLinkVM } from '@/types/sharing';

/**
 * El backend devuelve una RUTA relativa opaca, no una URL absoluta. Se valida
 * con la misma forma que Holder Web para no aceptar nunca una redirección
 * arbitraria disfrazada de `sharePath`.
 */
const SHARE_PATH_PATTERN = /^\/share\/profile\/[A-Za-z0-9_-]{32,200}$/;

export function adaptProfileShareLink(payload: unknown): ProfileShareLinkVM {
  const value = record(payload, 'profileShare');
  const sharePath = requiredString(value.sharePath, 'profileShare.sharePath');

  if (!SHARE_PATH_PATTERN.test(sharePath)) {
    invalid(
      'profileShare.sharePath',
      'opaque /share/profile/<token> path',
      value.sharePath
    );
  }

  return {
    sharePath,
    expiresAtLabel: optionalDateLabel(
      value.expiresAt,
      'profileShare.expiresAt'
    )
  };
}

function optionalDateLabel(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  const text = requiredString(value, path);

  if (!Number.isFinite(Date.parse(text))) {
    invalid(path, 'ISO date string or null', value);
  }

  return formatDate(text);
}
