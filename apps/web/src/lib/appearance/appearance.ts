/**
 * Apariencia de Scope Web: claro, oscuro o segun el sistema.
 *
 * - La PREFERENCIA (`light | dark | system`) es del dispositivo, no de la
 *   sesion: vive en `localStorage` y no viaja al backend. Sin valor guardado
 *   (o con storage bloqueado) vale `system`.
 * - El TEMA RESUELTO (`light | dark`) vive en `<html data-theme>`. Lo fija el
 *   script inicial antes del primer pintado (sin parpadeo) y despues este
 *   modulo, que es el unico que lo modifica.
 * - Los componentes leen ambos con `useAppearance` (`use-appearance.ts`).
 */

export type AppearancePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'scope.appearance';
export const APPEARANCE_PREFERENCES: readonly AppearancePreference[] = [
  'light',
  'dark',
  'system'
];
const DARK_QUERY = '(prefers-color-scheme: dark)';
const SWITCHING_CLASS = 'appearance-switching';

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readPreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearancePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(preference: AppearancePreference) {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
    }
  } catch {
    // Storage bloqueado (navegacion privada, politicas): la eleccion rige
    // solo en esta pagina. No es un error para la persona.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(
  preference: AppearancePreference,
  prefersDark: boolean
): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

export function readResolvedTheme(): ResolvedTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Aplica el tema al documento. Durante el cambio se suspenden las transiciones
 * un cuadro para que todos los colores cambien a la vez.
 */
function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;

  root.classList.add(SWITCHING_CLASS);
  root.dataset.theme = theme;
  // Forzar el estilo con las transiciones suspendidas antes de reactivarlas.
  void window.getComputedStyle(root).color;
  window.requestAnimationFrame(() => root.classList.remove(SWITCHING_CLASS));
}

const listeners = new Set<() => void>();
let listening = false;

function notify() {
  for (const listener of listeners) listener();
}

function syncWithEnvironment() {
  applyTheme(resolveTheme(readPreference(), systemPrefersDark()));
  notify();
}

function startListening() {
  if (listening) return;
  listening = true;

  // Cambio de apariencia del sistema: solo importa si la preferencia es `system`
  // (`syncWithEnvironment` resuelve contra la preferencia vigente).
  if (typeof window.matchMedia === 'function') {
    window.matchMedia(DARK_QUERY).addEventListener('change', syncWithEnvironment);
  }

  // Otra pestana cambio la preferencia (o borro el storage).
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) syncWithEnvironment();
  });
}

export function subscribeAppearance(listener: () => void) {
  startListening();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAppearancePreference(preference: AppearancePreference) {
  writePreference(preference);
  applyTheme(resolveTheme(preference, systemPrefersDark()));
  notify();
}

/**
 * Script bloqueante del `<head>`: resuelve el tema antes del primer pintado.
 * Repite la logica de `readPreference` + `resolveTheme` porque corre antes de
 * que exista cualquier bundle; `appearance.test.ts` verifica que coincidan.
 */
export const APPEARANCE_INIT_SCRIPT = `(function(){var p='system';try{var s=window.localStorage.getItem('${APPEARANCE_STORAGE_KEY}');if(s==='light'||s==='dark')p=s}catch(e){}var d=p==='system'?!!(window.matchMedia&&window.matchMedia('${DARK_QUERY}').matches):p==='dark';document.documentElement.dataset.theme=d?'dark':'light'})()`;
