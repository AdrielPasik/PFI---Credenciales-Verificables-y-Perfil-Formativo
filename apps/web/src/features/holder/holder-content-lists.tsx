import { Badge } from '@/components/ui/badge';

/** Holder-only representations keep declared evidence distinct from taxonomy. */
export function HolderTaxonomyList({
  title,
  items
}: {
  title: string;
  items: string[];
}) {
  if (!items.length) return null;

  return (
    <section data-testid="holder-taxonomy-list" className="min-w-0">
      <h3 className="text-sm font-semibold text-text-strong">{title}</h3>
      <ul className="mt-2 flex min-w-0 flex-wrap gap-2">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="min-w-0 max-w-full">
            <Badge
              variant="outline"
              className="max-w-full whitespace-normal break-words px-3 py-1.5 text-left"
            >
              {item}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HolderDeclaredTextList({
  title,
  items
}: {
  title: string;
  items: string[];
}) {
  if (!items.length) return null;

  return (
    <section data-testid="holder-declared-text-list" className="grid min-w-0 gap-3 border-t border-border-default pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-text-strong">{title}</h3>
      <ul className="grid min-w-0 gap-2.5">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className="min-w-0 rounded-control border border-border-default bg-surface px-3 py-2.5 text-sm leading-6 text-text-default whitespace-normal break-words"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
