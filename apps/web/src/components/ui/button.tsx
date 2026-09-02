import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  type ButtonHTMLAttributes
} from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control border px-4 text-sm font-semibold tracking-[-0.01em]',
    'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/30',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4'
  ],
  {
    variants: {
      variant: {
        default:
          'border-brand-900 bg-brand-900 text-white shadow-xs hover:border-brand-700 hover:bg-brand-700 hover:shadow-sm active:bg-brand-600',
        secondary:
          'border-border-default bg-surface text-brand-900 shadow-xs hover:border-brand-600 hover:bg-surface-muted hover:shadow-sm active:border-brand-600',
        ghost:
          'border-transparent bg-transparent text-brand-700 hover:bg-brand-100 active:text-brand-900',
        destructive:
          'border-status-error bg-status-error text-white shadow-xs hover:opacity-90 active:opacity-80'
      },
      size: {
        sm: 'min-h-9 px-3 text-xs',
        default: 'px-4',
        lg: 'min-h-12 px-6 text-base',
        icon: 'size-11 p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      className,
      size,
      type = 'button',
      variant,
      ...props
    },
    ref
  ) => {
    const Component = asChild ? Slot : 'button';

    return (
      <Component
        ref={ref}
        data-slot="button"
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ size, variant }), className)}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { buttonVariants };
