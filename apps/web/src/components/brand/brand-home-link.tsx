import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * La marca del header lleva a la raiz del espacio actual. Es el "inicio" de cada
 * espacio; no reemplaza al regreso contextual de las pantallas internas.
 */
export function BrandHomeLink({
  href,
  label,
  children
}: {
  href: string | null;
  label: string;
  children: ReactNode;
}) {
  if (href === null) return <>{children}</>;
  return (
    <Link
      href={href}
      aria-label={label}
      className="min-w-0 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-900"
    >
      {children}
    </Link>
  );
}
