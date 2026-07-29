import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-slot="input"
    className={cn(
      [
        'flex min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-base text-text-strong shadow-xs outline-none transition-colors sm:text-sm',
        'placeholder:text-text-subtle hover:border-brand-600',
        'focus-visible:border-brand-600 focus-visible:ring-3 focus-visible:ring-focus-ring/25',
        'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:opacity-70',
        'aria-invalid:border-status-error aria-invalid:ring-status-error/20'
      ],
      className
    )}
    {...props}
  />
));

Input.displayName = 'Input';
