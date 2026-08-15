import Image from 'next/image';

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
      <span aria-hidden="true" className="relative block size-9 shrink-0 overflow-hidden">
        <Image
          alt=""
          className={cn(
            'absolute top-[-0.2rem] left-[-0.65rem] max-w-none w-14',
            tone === 'inverse' && 'brightness-0 invert'
          )}
          height={56}
          priority
          src="/brand/LOGO TRAZA SIN FONDO.png"
          width={56}
        />
      </span>
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
