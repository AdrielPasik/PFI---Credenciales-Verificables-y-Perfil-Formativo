import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  [
    'inline-flex min-h-6 w-fit items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-semibold tracking-[-0.01em] whitespace-nowrap',
    '[&_svg]:size-3.5 [&_svg]:shrink-0'
  ],
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-on-primary shadow-xs',
        secondary:
          'border-accent/20 bg-accent-tint text-accent',
        outline:
          'border-border-strong bg-surface text-link'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

export function Badge({
  asChild = false,
  className,
  variant,
  ...props
}: BadgeProps) {
  const Component = asChild ? Slot : 'span';

  return (
    <Component
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { badgeVariants };
