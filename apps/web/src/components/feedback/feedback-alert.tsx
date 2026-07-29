import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Alert,
  AlertDescription,
  AlertTitle
} from '@/components/ui/alert';

type FeedbackVariant = 'information' | 'success' | 'warning' | 'error';

interface FeedbackAlertProps {
  variant?: FeedbackVariant;
  title?: string;
  children: ReactNode;
}

const feedbackVariants: Record<
  FeedbackVariant,
  { icon: LucideIcon; label: string }
> = {
  information: {
    icon: Info,
    label: 'Información'
  },
  success: {
    icon: CircleCheck,
    label: 'Correcto'
  },
  warning: {
    icon: TriangleAlert,
    label: 'Advertencia'
  },
  error: {
    icon: CircleAlert,
    label: 'Error'
  }
};

export function FeedbackAlert({
  variant = 'information',
  title,
  children
}: FeedbackAlertProps) {
  const feedback = feedbackVariants[variant];
  const Icon = feedback.icon;

  return (
    <Alert
      variant={variant}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
    >
      <Icon aria-hidden="true" data-slot="feedback-alert-icon" />
      <AlertTitle>
        <span className="block text-xs font-bold tracking-wider uppercase">
          {feedback.label}
        </span>
        {title ? <span className="mt-1 block">{title}</span> : null}
      </AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
