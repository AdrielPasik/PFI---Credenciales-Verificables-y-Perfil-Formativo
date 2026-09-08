import * as SecureStore from 'expo-secure-store';

/**
 * Persistencia del material de sesión.
 *
 * El access token es material sensible: va a `expo-secure-store` (Keychain en
 * iOS, EncryptedSharedPreferences/Keystore en Android). NUNCA a AsyncStorage.
 *
 * NUNCA se persiste la contraseña. Tampoco se persiste el perfil ni las
 * credenciales del titular: son datos personales y el beneficio de cachearlos
 * en disco no justifica el riesgo en v1 (ver `05-autenticacion-y-sesion.md`).
 */

const ACCESS_TOKEN_KEY = 'scope.session.accessToken';

export interface SessionStorage {
  getAccessToken(): Promise<string | null>;
  setAccessToken(accessToken: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * SecureStore puede fallar (dispositivo sin bloqueo configurado, backend de
 * seguridad no disponible, entorno de test). Un fallo de lectura se trata como
 * "no hay sesión" en vez de dejar al usuario atrapado en el arranque.
 */
export class SecureSessionStorage implements SessionStorage {
  async getAccessToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  async setAccessToken(accessToken: string): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
  }

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      // Borrar una clave inexistente no es un error para el usuario.
    }
  }
}

/** Implementación en memoria, para tests. Nunca se usa en runtime real. */
export class InMemorySessionStorage implements SessionStorage {
  private accessToken: string | null = null;

  constructor(initialToken: string | null = null) {
    this.accessToken = initialToken;
  }

  async getAccessToken(): Promise<string | null> {
    return this.accessToken;
  }

  async setAccessToken(accessToken: string): Promise<void> {
    this.accessToken = accessToken;
  }

  async clear(): Promise<void> {
    this.accessToken = null;
  }
}
