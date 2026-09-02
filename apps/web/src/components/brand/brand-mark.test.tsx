import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandMark } from '@/components/brand/brand-mark';

describe('BrandMark', () => {
  it('renders the Scope text fallback when no logo asset is requested', () => {
    render(<BrandMark descriptor="Public verification" />);

    expect(screen.getByText('Scope')).toBeTruthy();
    expect(screen.getByText('Public verification')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('keeps the inverse text fallback independent from the authenticated asset', () => {
    render(<BrandMark tone="inverse" descriptor="Portal del emisor" />);

    expect(screen.getByText('Scope')).toBeTruthy();
    expect(screen.getByText('Portal del emisor')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('uses the inverted Scope asset for authenticated dark shells', () => {
    render(
      <BrandMark
        authenticatedDark
        tone="inverse"
        descriptor="Portal del emisor"
      />
    );

    const logo = document.querySelector('img');

    expect(screen.getByRole('img', { name: 'Scope' })).toBe(logo);
    expect(screen.queryByText('Scope')).toBeNull();
    expect(
      decodeURIComponent(decodeURIComponent(logo?.getAttribute('src') ?? ''))
    ).toContain('Logo Scope Invertido.png');
    expect(logo?.className).toContain('object-contain');
  });

  it('uses the approved Scope logo when requested on a light surface', () => {
    render(<BrandMark lightLogo descriptor="Public verification" />);

    const logo = document.querySelector('img');

    expect(screen.getByRole('img', { name: 'Scope' })).toBe(logo);
    expect(screen.queryByText('Scope')).toBeNull();
    expect(
      decodeURIComponent(decodeURIComponent(logo?.getAttribute('src') ?? ''))
    ).toContain('Logo Scope 2.png');
    expect(logo?.className).toContain('object-contain');
  });
});
