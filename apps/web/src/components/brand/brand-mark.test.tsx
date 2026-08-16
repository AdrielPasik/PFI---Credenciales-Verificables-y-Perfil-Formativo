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

  it('keeps the inverse wordmark legible without filters or image crops', () => {
    render(<BrandMark tone="inverse" descriptor="Portal del emisor" />);

    expect(screen.getByLabelText('Traza')).toBeTruthy();
    expect(screen.getByText('Traza')).toBeTruthy();
    expect(screen.getByText('Portal del emisor')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });
});
