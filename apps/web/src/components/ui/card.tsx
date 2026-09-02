import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export const Card = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="card"
    className={cn(
      'rounded-card border border-border-default/90 bg-surface text-text-default shadow-xs',
      className
    )}
    {...props}
  />
));

Card.displayName = 'Card';

export const CardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="card-header"
    className={cn('grid gap-3 p-5 sm:p-7', className)}
    {...props}
  />
));

CardHeader.displayName = 'CardHeader';

export const CardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="card-content"
    className={cn('px-5 pb-5 sm:px-7 sm:pb-7', className)}
    {...props}
  />
));

CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="card-footer"
    className={cn('flex items-center px-5 pb-5 sm:px-7 sm:pb-7', className)}
    {...props}
  />
));

CardFooter.displayName = 'CardFooter';
