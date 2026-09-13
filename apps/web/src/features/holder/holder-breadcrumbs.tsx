import Link from 'next/link';

export interface HolderBreadcrumbItem {
  label: string;
  href?: string;
}

/** Secondary navigation shared by Holder sub-routes. */
export function HolderBreadcrumbs({ items }: { items: HolderBreadcrumbItem[] }) {
  return (
    <nav aria-label="Ubicacion" className="text-sm text-text-muted">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-x-2">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {item.href && !isCurrent ? (
                <Link
                  href={item.href}
                  className="underline decoration-border-strong underline-offset-4 transition hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isCurrent ? 'page' : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
