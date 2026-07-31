import { LogOut, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface AccountMenuProps {
  email: string;
  canChangeIssuer?: boolean;
  onChangeIssuer?: () => void;
  onLogout: () => void;
  inverse?: boolean;
}

export function AccountMenu({
  canChangeIssuer = false,
  email,
  inverse = false,
  onChangeIssuer,
  onLogout
}: AccountMenuProps) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
      <span
        className={
          inverse
            ? 'min-w-0 flex-1 truncate text-sm text-brand-100 sm:max-w-64 sm:flex-none'
            : 'min-w-0 flex-1 truncate text-sm text-text-muted sm:max-w-64 sm:flex-none'
        }
      >
        {email}
      </span>
      {canChangeIssuer ? (
        <Button
          variant={inverse ? 'secondary' : 'ghost'}
          size="sm"
          className="shrink-0"
          onClick={onChangeIssuer}
        >
          <RefreshCw aria-hidden="true" />
          Cambiar institución
        </Button>
      ) : null}
      <Button
        variant={inverse ? 'secondary' : 'ghost'}
        size="sm"
        className="shrink-0"
        onClick={onLogout}
      >
        <LogOut aria-hidden="true" />
        Cerrar sesión
      </Button>
    </div>
  );
}
