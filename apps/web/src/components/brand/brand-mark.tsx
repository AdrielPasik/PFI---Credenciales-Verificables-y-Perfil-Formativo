import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  descriptor?: string;
  tone?: 'default' | 'inverse';
}

export function BrandMark({
  className,
  descriptor,
  tone = 'default'
}: BrandMarkProps) {
  return (
    <div
      aria-label="Traza, identidad temporal"
      data-brand-status="temporary"
      className={cn('flex min-w-0 items-baseline gap-3', className)}
    >
      <span
        className={cn(
          'text-xl font-bold tracking-tight',
          tone === 'inverse' ? 'text-white' : 'text-brand-900'
        )}
      >
        Traza
      </span>
      {descriptor ? (
        <span
          className={cn(
            'hidden text-xs font-medium sm:inline',
            tone === 'inverse' ? 'text-brand-100/80' : 'text-text-muted'
          )}
        >
          {descriptor}
        </span>
      ) : null}
    </div>
  );
}
