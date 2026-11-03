import * as SecureStore from 'expo-secure-store';

/**
 * Persistencia de la apariencia elegida (claro, oscuro o según el sistema).
 *
 * No es un dato sensible, pero se reutiliza `expo-secure-store` porque ya es
 * el único almacenamiento clave-valor nativo de la app: no se suma una
 * dependencia nativa (y una build nueva) sólo para guardar una preferencia.
 */

export type AppearancePreference = 'system' | 'light' | 'dark';

const APPEARANCE_KEY = 'scope.appearance.preference';

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export interface AppearanceStorage {
  getPreference(): Promise<AppearancePreference | null>;
  setPreference(preference: AppearancePreference): Promise<void>;
}

/**
 * Un fallo de lectura o un valor desconocido se trata como "sin preferencia":
 * la app sigue al sistema en vez de fallar el arranque.
 */
export class SecureAppearanceStorage implements AppearanceStorage {
  async getPreference(): Promise<AppearancePreference | null> {
    try {
      const value = await SecureStore.getItemAsync(APPEARANCE_KEY);
      return isAppearancePreference(value) ? value : null;
    } catch {
      return null;
    }
  }

  async setPreference(preference: AppearancePreference): Promise<void> {
    try {
      await SecureStore.setItemAsync(APPEARANCE_KEY, preference);
    } catch {
      // Si no se puede guardar, la elección vale para esta sesión de uso.
    }
  }
}

/** Implementación en memoria, para tests. Nunca se usa en runtime real. */
export class InMemoryAppearanceStorage implements AppearanceStorage {
  constructor(private preference: AppearancePreference | null = null) {}

  async getPreference(): Promise<AppearancePreference | null> {
    return this.preference;
  }

  async setPreference(preference: AppearancePreference): Promise<void> {
    this.preference = preference;
  }
}
