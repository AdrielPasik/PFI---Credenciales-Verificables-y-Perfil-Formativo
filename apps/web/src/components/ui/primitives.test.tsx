import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FeedbackAlert } from '@/components/feedback/feedback-alert';
import { TextField } from '@/components/forms/text-field';

import { Button } from './button';

describe('frontend primitives', () => {
  it('renders a disabled native button', () => {
    render(<Button disabled>Continuar</Button>);

    const button = screen.getByRole('button', { name: 'Continuar' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('centralizes button variants through CVA', () => {
    render(<Button variant="destructive">Revocar</Button>);

    expect(
      screen.getByRole('button', { name: 'Revocar' }).className
    ).toContain('bg-status-error');
  });

  it('associates a permanent label, description and error with the input', () => {
    render(
      <TextField
        id="email"
        label="Correo electrónico"
        description="Usá el correo institucional."
        error="Revisá el formato ingresado."
      />
    );

    const input = screen.getByLabelText('Correo electrónico');
    expect(input.id).toBe('email');
    expect(input.getAttribute('aria-describedby')).toBe(
      'email-description email-error'
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Usá el correo institucional.').id).toBe(
      'email-description'
    );
    expect(screen.getByRole('alert').id).toBe('email-error');
  });

  it('announces non-destructive feedback without relying only on color', () => {
    render(
      <FeedbackAlert variant="information" title="Estado">
        La base frontend está en preparación.
      </FeedbackAlert>
    );

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Información');
    expect(status.textContent).toContain('Estado');
    expect(status.textContent).toContain('La base frontend está en preparación.');
    expect(
      status
        .querySelector('[data-slot="feedback-alert-icon"]')
        ?.getAttribute('aria-hidden')
    ).toBe('true');
  });
});
