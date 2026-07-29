import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  descriptor?: string;
}

export function BrandMark({ className, descriptor }: BrandMarkProps) {
  return (
    <div
      aria-label="Traza, identidad temporal"
      data-brand-status="temporary"
      className={cn('flex min-w-0 items-baseline gap-3', className)}
    >
      <span className="text-xl font-bold tracking-tight text-brand-900">
        Traza
      </span>
      {descriptor ? (
        <span className="hidden text-xs font-medium text-text-muted sm:inline">
          {descriptor}
        </span>
      ) : null}
    </div>
  );
}
