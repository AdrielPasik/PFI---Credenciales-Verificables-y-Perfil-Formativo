import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandMark } from '@/components/brand/brand-mark';

describe('BrandMark', () => {
  it('renders an accessible light wordmark without a cropped image asset', () => {
    render(<BrandMark descriptor="Public verification" />);

    expect(screen.getByLabelText('Traza')).toBeTruthy();
    expect(screen.getByText('Traza')).toBeTruthy();
    expect(screen.getByText('Public verification')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('keeps the public inverse wordmark independent from the authenticated asset', () => {
    render(<BrandMark tone="inverse" descriptor="Portal del emisor" />);

    expect(screen.getByLabelText('Traza')).toBeTruthy();
    expect(screen.getByText('Traza')).toBeTruthy();
    expect(screen.getByText('Portal del emisor')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('uses the dedicated blue-background asset for authenticated dark shells', () => {
    render(
      <BrandMark
        authenticatedDark
        tone="inverse"
        descriptor="Portal del emisor"
      />
    );

    const logo = document.querySelector('img');

    expect(screen.getByLabelText('Traza')).toBeTruthy();
    expect(logo?.getAttribute('src')).toContain(
      'LOGO-TRAZA-FONDO-AZUL.png'
    );
    expect(logo?.className).toContain('object-contain');
  });

  it('uses the original transparent Traza logo when requested on a light surface', () => {
    render(<BrandMark lightLogo descriptor="Public verification" />);

    const logo = document.querySelector('img');

    expect(
      decodeURIComponent(decodeURIComponent(logo?.getAttribute('src') ?? ''))
    ).toContain('LOGO TRAZA SIN FONDO.png');
    expect(logo?.className).toContain('object-contain');
  });
});
