import { LoaderCircle } from 'lucide-react';

export function SessionLoadingState({
  label = 'Validando sesión'
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-64 w-full flex-col items-center justify-center gap-4 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-pill border border-border-default bg-surface text-brand-700 shadow-xs">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
      </span>
      <div>
        <p className="font-semibold text-text-strong">{label}</p>
        <p className="mt-1 text-sm text-text-muted">
          Esto puede tomar unos instantes.
        </p>
      </div>
    </div>
  );
}
