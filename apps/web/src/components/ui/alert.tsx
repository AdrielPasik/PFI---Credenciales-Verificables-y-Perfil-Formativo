import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const alertVariants = cva(
  [
    'grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-card border px-4 py-4 text-sm',
    '[&>svg]:row-span-2 [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0'
  ],
  {
    variants: {
      variant: {
        information:
          'border-feedback-information/20 bg-feedback-information-soft text-feedback-information',
        success:
          'border-feedback-success/20 bg-feedback-success-soft text-feedback-success',
        warning:
          'border-status-warning/20 bg-status-warning-soft text-status-warning',
        error:
          'border-status-error/20 bg-status-error-soft text-status-error'
      }
    },
    defaultVariants: {
      variant: 'information'
    }
  }
);

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
);

Alert.displayName = 'Alert';

export const AlertTitle = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="alert-title"
    className={cn('col-start-2 font-semibold leading-5', className)}
    {...props}
  />
));

AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="alert-description"
    className={cn('col-start-2 leading-6 text-current/90', className)}
    {...props}
  />
));

AlertDescription.displayName = 'AlertDescription';

export { alertVariants };
