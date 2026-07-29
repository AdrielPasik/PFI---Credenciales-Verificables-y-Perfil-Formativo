import {
  forwardRef,
  useId,
  type InputHTMLAttributes
} from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id?: string;
  label: string;
  description?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      'aria-describedby': externalDescribedBy,
      className,
      description,
      error,
      id,
      label,
      ...inputProps
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const descriptionId = description ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [externalDescribedBy, descriptionId, errorId]
      .filter(Boolean)
      .join(' ');

    return (
      <div data-slot="text-field" className="grid gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        <Input
          ref={ref}
          id={inputId}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          className={cn(className)}
          {...inputProps}
        />
        {description ? (
          <p id={descriptionId} className="text-sm leading-5 text-text-muted">
            {description}
          </p>
        ) : null}
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="text-sm leading-5 font-medium text-status-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }
);

TextField.displayName = 'TextField';
