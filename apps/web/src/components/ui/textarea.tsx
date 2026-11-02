import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="textarea"
    className={cn(
      [
        'flex min-h-28 w-full resize-y rounded-control border border-border-control bg-surface px-3.5 py-2.5 text-base text-text-strong shadow-xs outline-none transition-colors sm:text-sm',
        'placeholder:text-text-subtle hover:border-interactive hover:shadow-sm',
        'focus-visible:border-interactive focus-visible:ring-3 focus-visible:ring-focus-ring/40',
        'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:opacity-70',
        'aria-invalid:border-status-error aria-invalid:ring-status-error/20'
      ],
      className
    )}
    {...props}
  />
));

Textarea.displayName = 'Textarea';
