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
  const logoSource = usesAuthenticatedAsset
    ? '/brand/Logo%20Scope%20Invertido.png'
    : usesLightAsset
      ? '/brand/Logo%20Scope%202.png'
      : null;

  return (
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      {logoSource ? (
        <Image
          alt="Scope"
          className="size-11 shrink-0 object-contain sm:size-12"
          height={1254}
          priority
          src={logoSource}
          width={1254}
        />
      ) : (
        <span
          className={cn(
            'text-xl font-bold tracking-[-0.035em]',
            tone === 'inverse' ? 'text-white' : 'text-brand-900'
          )}
        >
          Scope
        </span>
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
