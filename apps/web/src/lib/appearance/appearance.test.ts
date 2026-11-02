import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  APPEARANCE_INIT_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  readPreference,
  readResolvedTheme,
  resolveTheme,
  setAppearancePreference,
  subscribeAppearance,
  type AppearancePreference
} from '@/lib/appearance/appearance';
import { installSystemAppearance } from '@/lib/appearance/appearance-test-utils';

let system: ReturnType<typeof installSystemAppearance>;

beforeAll(() => {
  system = installSystemAppearance();
});

afterEach(() => {
  window.localStorage.clear();
  system.setSystemDark(false);
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

function runInitScript() {
  new Function(APPEARANCE_INIT_SCRIPT)();
  return document.documentElement.dataset.theme;
}

describe('resolveTheme', () => {
  it('fixed preferences win over the system; system follows it', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('readPreference', () => {
  it('defaults to system without a stored value', () => {
    expect(readPreference()).toBe('system');
  });

  it('ignores unknown stored values', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'sepia');
    expect(readPreference()).toBe('system');
  });

  it('falls back to system when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readPreference()).toBe('system');
  });
});

describe('initial script', () => {
  const cases: Array<[AppearancePreference | null, boolean]> = [
    [null, false],
    [null, true],
    ['system', true],
    ['light', true],
    ['dark', false]
  ];

  it.each(cases)('stored %s with system dark=%s matches resolveTheme', (stored, dark) => {
    if (stored) window.localStorage.setItem(APPEARANCE_STORAGE_KEY, stored);
    system.setSystemDark(dark);

    expect(runInitScript()).toBe(resolveTheme(stored ?? 'system', dark));
  });

  it('resolves against the system when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    system.setSystemDark(true);

    expect(runInitScript()).toBe('dark');
  });
});

describe('setAppearancePreference', () => {
  it('persists a fixed choice and applies it', () => {
    setAppearancePreference('dark');

    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(readResolvedTheme()).toBe('dark');
  });

  it('system removes the stored choice and resolves against the system', () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'light');
    system.setSystemDark(true);

    setAppearancePreference('system');

    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(readResolvedTheme()).toBe('dark');
  });

  it('still applies the theme when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    setAppearancePreference('dark');

    expect(readResolvedTheme()).toBe('dark');
  });

  it('notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppearance(listener);

    setAppearancePreference('light');
    unsubscribe();
    setAppearancePreference('dark');

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('environment sync', () => {
  it('follows system changes only while the preference is system', () => {
    const unsubscribe = subscribeAppearance(() => {});
    setAppearancePreference('system');

    system.setSystemDark(true);
    expect(readResolvedTheme()).toBe('dark');

    setAppearancePreference('light');
    system.setSystemDark(false);
    system.setSystemDark(true);
    expect(readResolvedTheme()).toBe('light');

    unsubscribe();
  });

  it('applies a choice made in another tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppearance(listener);
    setAppearancePreference('light');
    listener.mockClear();

    // Otra pestana escribe el storage y el navegador emite `storage` aca.
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEY }));

    expect(readResolvedTheme()).toBe('dark');
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('ignores unrelated storage keys', () => {
    const unsubscribe = subscribeAppearance(() => {});
    setAppearancePreference('light');

    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));

    expect(readResolvedTheme()).toBe('light');
    unsubscribe();
  });
});
