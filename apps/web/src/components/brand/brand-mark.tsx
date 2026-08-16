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
      aria-label="Traza"
      className={cn('flex min-w-0 items-center gap-3', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-pill bg-brand-accent ring-4',
          tone === 'inverse' ? 'ring-white/10' : 'ring-brand-accent/10'
        )}
      />
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
            'hidden border-l pl-3 text-xs font-semibold tracking-wide sm:inline',
            tone === 'inverse'
              ? 'border-white/25 text-brand-100/80'
              : 'border-border-strong text-text-muted'
          )}
        >
          {descriptor}
        </span>
      ) : null}
    </div>
  );
}
