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
    'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/50',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4'
  ],
  {
    variants: {
      variant: {
        default:
          'border-primary bg-primary text-on-primary shadow-xs hover:border-primary-hover hover:bg-primary-hover hover:shadow-sm active:border-primary-active active:bg-primary-active',
        secondary:
          'border-border-strong bg-surface text-text-strong shadow-xs hover:border-interactive hover:bg-surface-muted hover:shadow-sm active:border-interactive',
        ghost:
          'border-transparent bg-transparent text-link hover:bg-highlight active:text-link-hover',
        destructive:
          'border-status-error bg-status-error text-on-destructive shadow-xs hover:opacity-90 active:opacity-80',
        // Accion principal sobre una banda invertida: clara en el tema claro,
        // petroleo en el oscuro.
        inverseAction:
          'border-inverse-action-border bg-inverse-action text-on-inverse-action shadow-xs hover:bg-inverse-action-hover focus-visible:ring-white/60',
        // Sobre el header y los paneles invertidos, oscuros en ambos temas.
        inverse:
          'border-white/25 bg-transparent text-white hover:border-white/40 hover:bg-white/10 active:bg-white/15 focus-visible:ring-white/60'
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
