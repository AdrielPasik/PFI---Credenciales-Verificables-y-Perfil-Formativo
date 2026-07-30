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
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <span
        className={
          inverse
            ? 'max-w-64 truncate text-sm text-brand-100'
            : 'max-w-64 truncate text-sm text-text-muted'
        }
      >
        {email}
      </span>
      {canChangeIssuer ? (
        <Button
          variant={inverse ? 'secondary' : 'ghost'}
          size="sm"
          onClick={onChangeIssuer}
        >
          <RefreshCw aria-hidden="true" />
          Cambiar institución
        </Button>
      ) : null}
      <Button
        variant={inverse ? 'secondary' : 'ghost'}
        size="sm"
        onClick={onLogout}
      >
        <LogOut aria-hidden="true" />
        Cerrar sesión
      </Button>
    </div>
  );
}
