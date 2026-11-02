/**
 * `prefers-color-scheme` controlable para tests (jsdom no implementa
 * `matchMedia`). Una sola lista compartida: `appearance.ts` se suscribe a ella
 * la primera vez y despues alcanza con cambiar `setSystemDark`.
 */
export function installSystemAppearance() {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const list = {
    matches: false,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener)
  };
  window.matchMedia = ((query: string) =>
    query === list.media ? list : { ...list, matches: false }) as unknown as typeof window.matchMedia;

  return {
    setSystemDark(dark: boolean) {
      list.matches = dark;
      for (const listener of listeners) listener({ matches: dark } as MediaQueryListEvent);
    }
  };
}
