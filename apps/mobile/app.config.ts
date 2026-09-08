import type { ExpoConfig } from 'expo/config';

/**
 * Configuracion de la aplicacion movil Holder de Scope.
 *
 * IDENTIFICADORES DE TIENDA: `com.scope.holder` es PROVISIONAL. Debe
 * confirmarse (y, si corresponde, reemplazarse por el dominio real que
 * controle el proyecto) ANTES de cualquier publicacion en Play Store o App
 * Store. Ver `10-plan-de-deployment.md`.
 *
 * Nada en este archivo es secreto: solo configuracion publica de la app.
 * Las URLs de backend se leen de variables `EXPO_PUBLIC_*` en runtime
 * (ver `src/lib/config/app-config.ts`), no se hardcodean aca.
 */
const APP_VERSION = '0.1.0';
const ANDROID_VERSION_CODE = 1;
const IOS_BUILD_NUMBER = '1';

const config: ExpoConfig = {
  name: 'Scope',
  slug: 'scope-holder',
  scheme: 'scope',
  version: APP_VERSION,
  orientation: 'portrait',
  // v1 se entrega solo en tema claro: Scope Web todavia no define un tema
  // oscuro completo y un dark mode a medias seria peor que ninguno.
  userInterfaceStyle: 'light',
  platforms: ['android', 'ios'],
  icon: './assets/icon.png',
  backgroundColor: '#EEF2F5',
  // La Nueva Arquitectura de React Native es la unica soportada en SDK 57:
  // ya no se declara con `newArchEnabled`.
  //
  // El splash se configura EXCLUSIVAMENTE con el plugin `expo-splash-screen`
  // (mas abajo); el campo `splash` de nivel superior quedo obsoleto.
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.scope.holder',
    buildNumber: IOS_BUILD_NUMBER,
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false
    }
  },
  android: {
    package: 'com.scope.holder',
    versionCode: ANDROID_VERSION_CODE,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B1D3A'
    }
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#0B1D3A'
      }
    ],
    [
      'expo-font',
      {
        fonts: []
      }
    ]
  ],
  experiments: {
    typedRoutes: true
  },
  extra: {
    eas: {
      // Se completa con `eas init` cuando el proyecto se registre en EAS.
      // Hasta entonces queda vacio a proposito: no inventamos un projectId.
      projectId: undefined
    }
  }
};

export default config;
