import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { Button } from '@/components/ui/button';
import type { AuthFeedback } from '@/models/auth-session';

interface SessionErrorStateProps {
  feedback: AuthFeedback;
  onLogout: () => void;
  onRetry: () => void;
}

export function SessionErrorState({
  feedback,
  onLogout,
  onRetry
}: SessionErrorStateProps) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-5 self-center">
      <FeedbackAlert variant="error" title="No pudimos validar la sesión">
        {feedback.message}
      </FeedbackAlert>
      <div className="flex flex-col gap-3 sm:flex-row">
        {feedback.recoverable ? (
          <Button onClick={onRetry}>Reintentar</Button>
        ) : null}
        <Button variant="secondary" onClick={onLogout}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
