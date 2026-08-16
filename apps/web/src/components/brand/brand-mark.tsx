import Image from 'next/image';

import { cn } from '@/lib/utils';

interface BrandMarkProps {
  authenticatedDark?: boolean;
  className?: string;
  descriptor?: string;
  lightLogo?: boolean;
  tone?: 'default' | 'inverse';
}

export function BrandMark({
  authenticatedDark = false,
  className,
  descriptor,
  lightLogo = false,
  tone = 'default'
}: BrandMarkProps) {
  const usesAuthenticatedAsset = authenticatedDark && tone === 'inverse';
  const usesLightAsset = lightLogo && tone === 'default';

  return (
    <div
      aria-label="Traza"
      className={cn('flex min-w-0 items-center gap-3', className)}
    >
      {usesAuthenticatedAsset ? (
        <Image
          alt=""
          aria-hidden="true"
          className="size-12 shrink-0 object-contain sm:size-14"
          height={1254}
          priority
          src="/brand/LOGO-TRAZA-FONDO-AZUL.png"
          width={1254}
        />
      ) : usesLightAsset ? (
        <Image
          alt=""
          aria-hidden="true"
          className="size-14 shrink-0 object-contain sm:size-16"
          height={1254}
          priority
          src="/brand/LOGO%20TRAZA%20SIN%20FONDO.png"
          width={1254}
        />
      ) : (
        <>
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
        </>
      )}
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
