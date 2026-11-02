import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppearanceControl } from '@/components/navigation/appearance-control';
import { APPEARANCE_STORAGE_KEY } from '@/lib/appearance/appearance';
import { installSystemAppearance } from '@/lib/appearance/appearance-test-utils';

let system: ReturnType<typeof installSystemAppearance>;

beforeAll(() => {
  system = installSystemAppearance();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  system.setSystemDark(false);
  document.documentElement.dataset.theme = 'light';
});

function renderControl() {
  document.documentElement.dataset.theme = 'light';
  return render(
    <div>
      <AppearanceControl tone="inverse" />
      <button type="button">Afuera</button>
    </div>
  );
}

const menuButton = () => screen.getByRole('button', { name: 'Opciones de apariencia' });
const item = (name: string) => screen.getByRole('menuitemradio', { name });

describe('AppearanceControl', () => {
  it('toggles directly between light and dark and remembers the choice', () => {
    renderControl();

    fireEvent.click(screen.getByRole('button', { name: 'Activar tema oscuro' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Activar tema claro' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('light');
  });

  it('opens a menu with the three options and marks the current one', () => {
    renderControl();

    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(menuButton());

    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Apariencia' })).toBeTruthy();
    expect(item('Claro').getAttribute('aria-checked')).toBe('false');
    expect(item('Oscuro').getAttribute('aria-checked')).toBe('false');
    expect(item('Según el sistema').getAttribute('aria-checked')).toBe('true');
    // El foco entra en la opcion vigente.
    expect(document.activeElement).toBe(item('Según el sistema'));
  });

  it('moves focus with the arrow keys, wrapping around, and Home/End', () => {
    renderControl();
    fireEvent.click(menuButton());
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('Claro'));
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('Según el sistema'));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(item('Claro'));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(item('Según el sistema'));
  });

  it('opens from the keyboard with the arrow keys', () => {
    renderControl();

    fireEvent.keyDown(menuButton(), { key: 'ArrowDown' });

    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes with Escape and returns focus to the menu button', () => {
    renderControl();
    fireEvent.click(menuButton());

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it('closes on an outside click', () => {
    renderControl();
    fireEvent.click(menuButton());

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Afuera' }));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('choosing an option applies it, closes the menu and returns focus', () => {
    renderControl();
    fireEvent.click(menuButton());

    fireEvent.click(item('Oscuro'));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it('"Según el sistema" forgets the choice and follows later system changes', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'light');
    renderControl();
    fireEvent.click(menuButton());

    fireEvent.click(item('Según el sistema'));
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();

    act(() => system.setSystemDark(true));

    expect(document.documentElement.dataset.theme).toBe('dark');
    // El toggle refleja el tema visible.
    expect(screen.getByRole('button', { name: 'Activar tema claro' })).toBeTruthy();
  });

  it('keeps 44px touch targets on narrow screens', () => {
    renderControl();

    const toggle = screen.getByRole('button', { name: 'Activar tema oscuro' });
    expect(toggle.className).toContain('w-11');
    expect(toggle.parentElement?.className).toContain('h-11');
  });
});
