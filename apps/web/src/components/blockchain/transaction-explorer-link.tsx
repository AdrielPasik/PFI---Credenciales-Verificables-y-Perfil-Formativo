import { ExternalLink } from 'lucide-react';

import { BASESCAN_TRANSACTION_LINK_LABEL } from '@/lib/public-verification/explorer';

/**
 * Enlace al explorador de la red para una transaccion REAL.
 *
 * Recibe una URL ya resuelta por `buildTransactionExplorerUrl` (que exige un hash
 * valido y una red soportada). Sin URL no renderiza nada: nunca un enlace vacio
 * ni uno armado a mano. Se abre en otra pestana con `noopener noreferrer`.
 */
export function TransactionExplorerLink({ href }: { href: string | null }) {
  if (!href) {
    return null;
  }

  return (
    <a
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 underline underline-offset-2"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {BASESCAN_TRANSACTION_LINK_LABEL}
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}
